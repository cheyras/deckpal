// Contract test for an exported model: run it through the SHIPPING TypeScript
// preprocessing and mapping, exactly as the offline harness runs lc050.onnx, and
// report the quads the engine would draw.
//
//   node_modules/.bin/tsx tools/quad-train/ts/contract_ts.mts <model.onnx> <job.json> <out.json>
//
// The pixels come from the harness (engineInput = sharp + the engine's own
// LetterboxTransform; the pipeline-v3 centre square as clutter-lock replays it),
// the tensor from rgbaToBGRPlanar, the inference from ort_sidecar.py (python
// onnxruntime, because ORT-web cannot load in node -- see offline-harness.ts),
// and every mapping, gate and shape check from the engine's own exports. Only
// the model path differs from what the harness hard-codes, which is why this
// calls the sidecar directly instead of the harness's runModel().

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { Quad } from '../../../apps/web/src/scan/engine/contract'
import { isConvexQuad, quadAspectRatio, type ImageDataLike } from '../../../apps/web/src/scan/engine/geometry'
import { MODEL_SIZE, modelPointsToQuad, rgbaToBGRPlanar } from '../../../apps/web/src/scan/engine/preprocess'
import { inferenceTransform, isCardShaped, isSingleCardShaped } from '../../../apps/web/src/scan/engine/index'
import { modelPointsToCanonicalQuad, squareCrop } from '../../../apps/web/src/scan/engine/frame'
import { createPresenceGate } from '../../../apps/web/src/scan/engine/gate'
import { engineInput, PY, sharp, toTensor } from '../../../apps/web/src/scan/engine/__tests__/offline-harness'

interface Job {
  frames: Array<{ name: string; png: string; w: number; h: number }>
}

const [modelPath, jobPath, outPath] = process.argv.slice(2)
if (!modelPath || !jobPath || !outPath) throw new Error('usage: contract_ts.mts <model.onnx> <job.json> <out.json>')
const job: Job = JSON.parse(fs.readFileSync(jobPath, 'utf8'))
const SIDECAR = path.resolve('apps/web/src/scan/engine/__tests__/ort_sidecar.py')

async function squareInput(file: string, w: number, h: number): Promise<ImageDataLike> {
  const S = await sharp()
  const c = squareCrop(w, h)
  const buf = await S(file)
    .extract({ left: c.x, top: c.y, width: c.size, height: c.size })
    .resize({ width: MODEL_SIZE, height: MODEL_SIZE, fit: 'fill', kernel: 'lanczos3' })
    .ensureAlpha()
    .raw()
    .toBuffer()
  return { width: MODEL_SIZE, height: MODEL_SIZE, data: new Uint8ClampedArray(buf.buffer, buf.byteOffset, buf.length) }
}

function run(model: string, inputs: Float32Array[]): Array<{ points: number[]; hasObj: number }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qt-contract-'))
  try {
    const per = inputs[0].length
    const all = new Float32Array(per * inputs.length)
    inputs.forEach((v, i) => all.set(v, i * per))
    fs.writeFileSync(path.join(dir, 'in.bin'), Buffer.from(all.buffer))
    execFileSync(PY, [SIDECAR, model, path.join(dir, 'in.bin'), String(inputs.length), path.join(dir, 'out.json')])
    return JSON.parse(fs.readFileSync(path.join(dir, 'out.json'), 'utf8'))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

const v2: Float32Array[] = []
const v3: Float32Array[] = []
for (const f of job.frames) {
  v2.push(toTensor(await engineInput(f.png, inferenceTransform(f.w, f.h))))
  v3.push(rgbaToBGRPlanar(await squareInput(f.png, f.w, f.h)))
}

function judge(quad: Quad | null, hasObj: number) {
  const gate = createPresenceGate() // cold gate: opens at DEFAULT_ACQUIRE
  return {
    quad,
    hasObj,
    gateOpen: gate.update(hasObj),
    finite: quad !== null,
    convex: quad ? isConvexQuad(quad) : false,
    aspect: quad ? quadAspectRatio(quad) : null,
    cardShaped: quad ? isCardShaped(quad) : false,
    singleCard: quad ? isSingleCardShaped(quad) : false,
  }
}

const o2 = run(modelPath, v2)
const o3 = run(modelPath, v3)
const out = job.frames.map((f, i) => ({
  name: f.name,
  v2: judge(modelPointsToQuad(inferenceTransform(f.w, f.h), o2[i].points), o2[i].hasObj),
  v3: judge(modelPointsToCanonicalQuad(o3[i].points), o3[i].hasObj),
  canonicalCrop: squareCrop(f.w, f.h),
}))
fs.writeFileSync(outPath, JSON.stringify(out))
console.log(`contract_ts: ${job.frames.length} frames through ${path.basename(modelPath)}`)
