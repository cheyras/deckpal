/**
 * The labeler's own seed, offline: the shipping detector (LC050) and refiner on
 * a square crop of a photo, built the way the quad labeler builds its working
 * frame (`apps/web/src/scan/labeler/workingFrame.ts`, `detectSeed.ts`).
 *
 * Shared by `propose.ts` (proposals for queued photos) and `calibrate.ts`
 * (how far those proposals sit from the owner's own labels).
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'

import sharp from 'sharp'

import type { Quad } from '../../apps/web/src/scan/engine/contract.js'
import { CANONICAL_SIZE, modelPointsToCanonicalQuad } from '../../apps/web/src/scan/engine/frame.js'
import { DEFAULT_ACQUIRE } from '../../apps/web/src/scan/engine/gate.js'
import type { ImageDataLike } from '../../apps/web/src/scan/engine/geometry.js'
import { MODEL_SIZE, rgbaToBGRPlanar } from '../../apps/web/src/scan/engine/preprocess.js'
import { gradientField, refineQuadChecked } from '../../apps/web/src/scan/engine/refine.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..')
export const DATA = process.env.LABEL_ASSIST_DIR ?? path.join(os.homedir(), 'deckpal-data', 'labeler')
const PY = process.env.PY ?? path.join(os.homedir(), 'deckpal-data', 'venvs', 'scanid', 'Scripts', 'python.exe')
const MODEL = path.join(REPO, 'apps/web/public/scan-assets/lc050.onnx')
const SIDECAR = path.join(REPO, 'scripts/scan-bench/video/lc050_stream.py')

export { CANONICAL_SIZE, DEFAULT_ACQUIRE }

export interface Crop {
  x: number
  y: number
  size: number
}

/** LC050 in one long-lived python process (the video bench's sidecar). */
export class Lc050 {
  private proc: ChildProcessWithoutNullStreams
  private waiting: Array<{ resolve: (r: { points: number[]; hasObj: number }[]) => void; reject: (e: Error) => void }> = []
  private stderr = ''
  constructor() {
    this.proc = spawn(PY, [SIDECAR, MODEL], { env: { ...process.env, OPENBLAS_NUM_THREADS: '1' }, stdio: ['pipe', 'pipe', 'pipe'] })
    this.proc.stderr.on('data', (d) => (this.stderr += d))
    readline.createInterface({ input: this.proc.stdout }).on('line', (line) => {
      const w = this.waiting.shift()
      if (w) w.resolve(JSON.parse(line))
    })
    this.proc.on('close', (code) => {
      for (const w of this.waiting.splice(0)) w.reject(new Error(`LC050 sidecar exited ${code}: ${this.stderr.slice(-500)}`))
    })
  }
  run(tensor: Float32Array): Promise<{ points: number[]; hasObj: number }> {
    const head = Buffer.alloc(4)
    head.writeUInt32LE(1, 0)
    const p = new Promise<{ points: number[]; hasObj: number }[]>((resolve, reject) => this.waiting.push({ resolve, reject }))
    this.proc.stdin.write(head)
    this.proc.stdin.write(Buffer.from(tensor.buffer, tensor.byteOffset, tensor.byteLength))
    return p.then((r) => r[0]!)
  }
  async close(): Promise<void> {
    this.proc.stdin.end(Buffer.alloc(4))
    await new Promise((r) => this.proc.on('close', r))
  }
}

/**
 * A square crop of the photo, mirrored where it leaves the photo (the
 * labeler's own rule, workingFrame.ts: "the gap is mirrored rather than
 * invented"), as raw RGBA at `size` px.
 */
export async function squareOf(photo: Buffer, crop: Crop, size: number): Promise<Buffer> {
  const img = sharp(photo).rotate()
  const meta = await sharp(await img.toBuffer()).metadata()
  const W = meta.width!
  const H = meta.height!
  const x = Math.round(crop.x)
  const y = Math.round(crop.y)
  const s = Math.round(crop.size)
  const left = Math.max(0, -x)
  const top = Math.max(0, -y)
  const right = Math.max(0, x + s - W)
  const bottom = Math.max(0, y + s - H)
  let pipe = sharp(await img.toBuffer())
  if (left || top || right || bottom) {
    pipe = sharp(await pipe.extend({ left, top, right, bottom, extendWith: 'mirror' }).toBuffer())
  }
  return pipe
    .extract({ left: x + left, top: y + top, width: s, height: s })
    .resize(size, size, { fit: 'fill', kernel: 'lanczos3' })
    .ensureAlpha()
    .raw()
    .toBuffer()
}

export async function photoSize(photo: Buffer): Promise<{ width: number; height: number }> {
  const m = await sharp(await sharp(photo).rotate().toBuffer()).metadata()
  return { width: m.width!, height: m.height! }
}

/** The centre square, `engine/frame.ts` `squareCrop`. */
export function centreSquare(w: number, h: number): Crop {
  const size = Math.min(w, h)
  return { x: Math.round((w - size) / 2), y: Math.round((h - size) / 2), size }
}

export interface Detection {
  hasObj: number
  /** Refined quad, canonical px, or null when the model emitted no quad. */
  quad: Quad | null
}

/** The seed on one canonical frame: LC050 on the MODEL_SIZE resize, the
 *  refiner on the 416 working image (detectSeed.ts, line for line). */
export async function detect(lc: Lc050, rgba416: Buffer): Promise<Detection> {
  const work: ImageDataLike = { width: CANONICAL_SIZE, height: CANONICAL_SIZE, data: new Uint8ClampedArray(rgba416.buffer, rgba416.byteOffset, rgba416.length) }
  const small = await sharp(rgba416, { raw: { width: CANONICAL_SIZE, height: CANONICAL_SIZE, channels: 4 } })
    .resize(MODEL_SIZE, MODEL_SIZE, { fit: 'fill', kernel: 'lanczos3' })
    .ensureAlpha()
    .raw()
    .toBuffer()
  const tensor = rgbaToBGRPlanar({ width: MODEL_SIZE, height: MODEL_SIZE, data: new Uint8ClampedArray(small.buffer, small.byteOffset, small.length) })
  const out = await lc.run(tensor)
  const raw = modelPointsToCanonicalQuad(out.points)
  const quad = raw ? (refineQuadChecked(raw, gradientField(work)) ?? raw) : null
  return { hasObj: out.hasObj, quad }
}

/** Snap a rough quad (canonical px) to the card's edges, as the editor's seed does. */
export function refineOn(rgba416: Buffer, quad: Quad): Quad {
  const work: ImageDataLike = { width: CANONICAL_SIZE, height: CANONICAL_SIZE, data: new Uint8ClampedArray(rgba416.buffer, rgba416.byteOffset, rgba416.length) }
  return refineQuadChecked(quad, gradientField(work)) ?? quad
}

/** Mean distance between two quads' corners under the best cyclic pairing
 *  (either winding), in the units of the inputs. */
export function quadError(a: Quad, b: Quad): number {
  let best = Infinity
  for (const seq of [b, [...b].reverse() as Quad]) {
    for (let k = 0; k < 4; k++) {
      let s = 0
      for (let i = 0; i < 4; i++) {
        const p = a[i]!
        const q = seq[(i + k) % 4]!
        s += Math.hypot(p[0] - q[0], p[1] - q[1])
      }
      best = Math.min(best, s / 4)
    }
  }
  return best
}
