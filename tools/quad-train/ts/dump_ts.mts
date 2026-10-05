// Dump what the SHIPPING TypeScript produces, so parity_preprocess.py can hold
// the Python port to it. Nothing here re-implements engine logic: every value is
// computed by the engine's own exports (preprocess.ts, index.ts, frame.ts) or by
// the offline harness the engine's integration tests already use.
//
//   node_modules/.bin/tsx tools/quad-train/ts/dump_ts.mts <job.json> <outdir>
//
// The job file is written by parity_preprocess.py. Outputs:
//   geometry.json            letterbox transforms, point mappings, square crops
//   <name>.decoded.rgba      the frame as sharp decodes it (harness loadRGBA)
//   <name>.nearest.{rgba,f32} letterboxRGBA(inferenceTransform) + rgbaToBGRPlanar
//   <name>.engine.{rgba,f32}  harness engineInput (sharp lanczos3) + rgbaToBGRPlanar
//   <name>.v3.{rgba,f32}      centre square -> 256 (sharp lanczos3, clutter-lock's
//                             pipeline-v3 replay) + rgbaToBGRPlanar
//   <name>.f32               rgbaToBGRPlanar of an RGBA buffer Python supplied
//   model.json               harness runModel (python ORT sidecar) on the engine
//                            and v3 tensors, mapped back by the engine's own
//                            modelPointsToQuad / modelPointsToCanonicalQuad

import fs from 'node:fs'
import path from 'node:path'

import type { ImageDataLike, Rect } from '../../../apps/web/src/scan/engine/geometry'
import {
  computeLetterbox,
  frameToModelNorm,
  letterboxRGBA,
  modelNormToFrame,
  modelPointsToQuad,
  MODEL_SIZE,
  PAD_VALUE,
  rgbaToBGRPlanar,
  type LetterboxTransform,
} from '../../../apps/web/src/scan/engine/preprocess'
import { INFERENCE_RECT, inferenceTransform } from '../../../apps/web/src/scan/engine/index'
import {
  CANONICAL_SIZE,
  canonicalToStream,
  modelPointsToCanonicalQuad,
  squareCrop,
  streamQuadToCanonical,
} from '../../../apps/web/src/scan/engine/frame'
import {
  engineInput,
  loadRGBA,
  ortAvailable,
  runModel,
  sharp,
  toTensor,
} from '../../../apps/web/src/scan/engine/__tests__/offline-harness'
import type { Quad } from '../../../apps/web/src/scan/engine/contract'

interface Job {
  geometry: Array<{ w: number; h: number; rect: Rect | null }>
  points: number[][]
  streams: Array<{ w: number; h: number; quad: number[][] }>
  frames: Array<{ name: string; png: string; w: number; h: number }>
  rgba: Array<{ name: string; file: string; w: number; h: number }>
  runModel: boolean
}

const [jobPath, outDir] = process.argv.slice(2)
if (!jobPath || !outDir) throw new Error('usage: dump_ts.mts <job.json> <outdir>')
const job: Job = JSON.parse(fs.readFileSync(jobPath, 'utf8'))
fs.mkdirSync(outDir, { recursive: true })

function writeBytes(file: string, a: Uint8ClampedArray | Float32Array): void {
  fs.writeFileSync(path.join(outDir, file), Buffer.from(a.buffer, a.byteOffset, a.byteLength))
}

// ── geometry ────────────────────────────────────────────────────────────────
const geometry = {
  constants: { MODEL_SIZE, PAD_VALUE, CANONICAL_SIZE, INFERENCE_RECT },
  letterbox: job.geometry.map((g) => {
    const t: LetterboxTransform = g.rect ? computeLetterbox(g.w, g.h, g.rect) : inferenceTransform(g.w, g.h)
    return {
      t,
      mapped: job.points.map((p) => {
        const quad = modelPointsToQuad(t, p)
        return {
          quad,
          norm0: modelNormToFrame(t, p[0], p[1]),
          back: quad ? quad.map((q) => frameToModelNorm(t, q[0], q[1])) : null,
        }
      }),
    }
  }),
  canonical: job.points.map((p) => modelPointsToCanonicalQuad(p)),
  squares: job.streams.map((s) => {
    const c = squareCrop(s.w, s.h)
    return {
      crop: c,
      toCanonical: streamQuadToCanonical(s.quad as unknown as Quad, c),
      toStream: s.quad.map((p) => canonicalToStream([p[0], p[1]], c)),
    }
  }),
}
fs.writeFileSync(path.join(outDir, 'geometry.json'), JSON.stringify(geometry))

// ── pixels ──────────────────────────────────────────────────────────────────
/** clutter-lock.ts squareInput, verbatim in effect: the centre square, one
 *  lanczos3 resize to `out`. That is the pipeline-v3 replay the harness uses. */
async function squareInput(file: string, w: number, h: number, out: number): Promise<ImageDataLike> {
  const S = await sharp()
  const c = squareCrop(w, h)
  const buf = await S(file)
    .extract({ left: c.x, top: c.y, width: c.size, height: c.size })
    .resize({ width: out, height: out, fit: 'fill', kernel: 'lanczos3' })
    .ensureAlpha()
    .raw()
    .toBuffer()
  return { width: out, height: out, data: new Uint8ClampedArray(buf.buffer, buf.byteOffset, buf.length) }
}

const engineTensors: Float32Array[] = []
const v3Tensors: Float32Array[] = []
for (const f of job.frames) {
  const decoded = await loadRGBA(f.png, f.w, f.h)
  writeBytes(`${f.name}.decoded.rgba`, decoded.data)

  const t = inferenceTransform(f.w, f.h)
  const nearest = letterboxRGBA(decoded, t)
  writeBytes(`${f.name}.nearest.rgba`, nearest.data)
  writeBytes(`${f.name}.nearest.f32`, rgbaToBGRPlanar(nearest))

  const eng = await engineInput(f.png, t)
  writeBytes(`${f.name}.engine.rgba`, eng.data)
  const et = toTensor(eng)
  writeBytes(`${f.name}.engine.f32`, et)
  engineTensors.push(et)

  const v3 = await squareInput(f.png, f.w, f.h, MODEL_SIZE)
  writeBytes(`${f.name}.v3.rgba`, v3.data)
  const vt = rgbaToBGRPlanar(v3)
  writeBytes(`${f.name}.v3.f32`, vt)
  v3Tensors.push(vt)
}

for (const r of job.rgba) {
  const buf = fs.readFileSync(r.file)
  const img: ImageDataLike = {
    width: r.w,
    height: r.h,
    data: new Uint8ClampedArray(buf.buffer, buf.byteOffset, buf.length),
  }
  writeBytes(`${r.name}.f32`, rgbaToBGRPlanar(img))
}

// ── the model, through the harness's own sidecar ────────────────────────────
if (job.runModel && job.frames.length) {
  if (!ortAvailable()) throw new Error('offline harness: python ORT sidecar or model not found')
  const eOut = runModel(engineTensors)
  const vOut = runModel(v3Tensors)
  const model = {
    engine: job.frames.map((f, i) => ({
      name: f.name,
      points: eOut[i].points,
      hasObj: eOut[i].hasObj,
      quad: modelPointsToQuad(inferenceTransform(f.w, f.h), eOut[i].points),
    })),
    v3: job.frames.map((f, i) => ({
      name: f.name,
      points: vOut[i].points,
      hasObj: vOut[i].hasObj,
      quad: modelPointsToCanonicalQuad(vOut[i].points),
    })),
  }
  fs.writeFileSync(path.join(outDir, 'model.json'), JSON.stringify(model))
}
console.log(`dump_ts: ${job.frames.length} frames, ${job.geometry.length} transforms -> ${outDir}`)
