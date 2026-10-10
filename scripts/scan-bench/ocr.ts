// The device's OCR read (PP-OCRv4, two-band recipe + escalation), run in Node
// with the SHIPPED pure modules (`apps/web/src/scan/ocr/pipeline.ts` and
// everything under it) and the SHIPPED model files. Only two pieces are
// replaced, and both are the ones the web code itself marks as DOM-bound:
//
//   * `capture.ts`'s canvas rasterising -> sharp. The lane's own measurement
//     (capture.ts header) found lanczos3, mitchell and cubic upscales give
//     IDENTICAL reads on all six columns, so sharp's lanczos3 stands in exactly.
//   * `session.ts`'s browser loader -> the vendored ORT-web bundle loaded the way
//     the API's `queryEmbed.ts` loads it under Node (wasmBinary, 1 thread).
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import sharp from 'sharp'

import { parseKeys } from '../../apps/web/src/scan/ocr/ctc.js'
import { readFields, type FullCropInput, type OcrRead, type RoiInput } from '../../apps/web/src/scan/ocr/pipeline.js'
import { detInputSize, ROI_SCALE, ROIS, roiPixels, type RoiName } from '../../apps/web/src/scan/ocr/rois.js'
import type { OcrGraph, OcrSession } from '../../apps/web/src/scan/ocr/session.js'

const REPO = resolve(fileURLToPath(import.meta.url), '..', '..', '..')
const ASSETS = join(REPO, 'apps', 'web', 'public', 'scan-assets')

interface OrtTensor {
  readonly data: Float32Array
  readonly dims: readonly number[]
}
interface OrtModule {
  env: { wasm: { simd: boolean; proxy: boolean; numThreads: number; wasmBinary?: ArrayBuffer }; logLevel?: string }
  Tensor: new (type: 'float32', data: Float32Array, dims: readonly number[]) => OrtTensor
  InferenceSession: {
    create(
      model: Uint8Array,
      o: { executionProviders: string[]; graphOptimizationLevel: string },
    ): Promise<{
      inputNames: string[]
      outputNames: string[]
      run(f: Record<string, OrtTensor>): Promise<Record<string, OrtTensor>>
    }>
  }
}

let session: Promise<OcrSession> | null = null

export function loadOcr(): Promise<OcrSession> {
  session ??= (async () => {
    const t0 = performance.now()
    const mod = (await import(pathToFileURL(join(ASSETS, 'ort.wasm.min.mjs')).href)) as { default?: OrtModule }
    const ort = (mod.default ?? (mod as unknown)) as OrtModule
    const wasm = readFileSync(join(ASSETS, 'ort-wasm-simd-threaded.wasm'))
    ort.env.wasm.wasmBinary = wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength)
    ort.env.wasm.numThreads = 1
    ort.env.wasm.proxy = false
    ort.env.wasm.simd = true
    ort.env.logLevel = 'error'
    const opts = { executionProviders: ['wasm'], graphOptimizationLevel: 'all' }
    const [det, rec] = await Promise.all([
      ort.InferenceSession.create(readFileSync(join(ASSETS, 'ppocr-v4-det.onnx')), opts),
      ort.InferenceSession.create(readFileSync(join(ASSETS, 'ppocr-v4-rec.onnx')), opts),
    ])
    const wrap = (s: typeof det): OcrGraph => ({
      async run(input, dims) {
        const out = await s.run({ [s.inputNames[0] ?? 'x']: new ort.Tensor('float32', input, dims) })
        const t = out[s.outputNames[0] ?? ''] ?? Object.values(out)[0]
        if (!t) throw new Error('OCR model returned no output')
        return { data: t.data, dims: t.dims }
      },
    })
    return {
      det: wrap(det),
      rec: wrap(rec),
      keys: parseKeys(readFileSync(join(ASSETS, 'ppocr-keys-v1.txt'), 'utf8')),
      loadMs: performance.now() - t0,
    }
  })()
  return session
}

interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** `capture.ts`'s `rasterise`, with sharp in place of the canvas: scale, then
 *  contain-fit into the multiple-of-32 detector input on a black pad. */
async function rasterise(img: Buffer, box: Box, scale: number) {
  const scaledW = Math.round(box.w * scale)
  const scaledH = Math.round(box.h * scale)
  const input = detInputSize(scaledW, scaledH)
  const fit = Math.min(input.w / scaledW, input.h / scaledH)
  const drawW = Math.round(scaledW * fit)
  const drawH = Math.round(scaledH * fit)
  const dx = Math.round((input.w - drawW) / 2)
  const dy = Math.round((input.h - drawH) / 2)
  const region = await sharp(img)
    .extract({ left: box.x, top: box.y, width: box.w, height: box.h })
    .resize(drawW, drawH, { kernel: 'lanczos3', fit: 'fill' })
    .ensureAlpha()
    .raw()
    .toBuffer()
  const data = new Uint8ClampedArray(input.w * input.h * 4)
  for (let i = 3; i < data.length; i += 4) data[i] = 255 // opaque black pad
  for (let y = 0; y < drawH; y++) {
    data.set(region.subarray(y * drawW * 4, (y + 1) * drawW * 4), ((y + dy) * input.w + dx) * 4)
  }
  return { raster: { width: input.w, height: input.h, data }, drawn: { x: dx, y: dy, w: drawW, h: drawH } }
}

/** The device read of one rectified crop (JPEG/PNG bytes, ideally 480×670). */
export async function readCard(img: Buffer, opts: { escalate?: boolean } = {}): Promise<OcrRead> {
  const s = await loadOcr()
  const meta = await sharp(img).metadata()
  const W = meta.width!
  const H = meta.height!
  const rois: RoiName[] = ['name', 'strip']
  const inputs: RoiInput[] = []
  for (const roi of rois) inputs.push({ roi, raster: (await rasterise(img, roiPixels(ROIS[roi], W, H), ROI_SCALE)).raster })
  // The escalation's raster is prepared lazily on the device; here it is made
  // eagerly (it is cheap off-device) and handed over through the same thunk.
  let full: FullCropInput | null = null
  if (opts.escalate !== false) full = await rasterise(img, { x: 0, y: 0, w: W, h: H }, 1)
  return readFields(s, inputs, full ? () => full : undefined)
}
