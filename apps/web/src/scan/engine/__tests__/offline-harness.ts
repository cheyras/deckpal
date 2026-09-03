// Offline integration harness: run the REAL engine code path over the real
// camera frames phase 0b captured, with no device and no browser.
//
// WHY THIS EXISTS. Every pure function in this engine round-trips to 1e-9 in
// its own unit test and the whole thing was still wrong on a phone. A unit test
// pins a function against its own definition; only a frame pins the PIPELINE
// against the world. So this module supplies the three things node is missing —
// pixels, a model, and a way to look at the answer — and nothing else: the
// preprocessing, the mapping, the refinement and the rectification all come
// from the shipping modules, unmodified.
//
// THREE SUBSTITUTIONS, each named so nobody mistakes it for the product:
//
//   1. PIXELS. The browser reads frames through canvas drawImage/getImageData;
//      here sharp decodes the PNG and does the same crop/scale. Both are
//      smooth-filtered downscales of the same source, and the harness also runs
//      the engine's own nearest-neighbour reference (preprocess.letterboxRGBA)
//      so the sensitivity to the resampler is a measured number rather than an
//      assumption.
//
//   2. THE MODEL. onnxruntime-web's wasm bundle resolves its .wasm relative to
//      its own module URL with fetch(), which node cannot drive. The ONNX graph
//      is identical, so the harness runs it under python onnxruntime through
//      ort_sidecar.py. What is NOT covered by this harness is therefore exactly
//      ORT-web's loader — not preprocessing, not mapping, not geometry.
//
//   3. ENCODING. rectifyToJpeg needs OffscreenCanvas; the harness calls
//      rectifyImageData (the pure half it wraps) and writes a PNG.

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { Quad } from '../contract'
import { defaultReticle, type ImageDataLike, type Point, type Rect } from '../geometry'
import {
  computeLetterbox,
  MODEL_SIZE,
  PAD_VALUE,
  rgbaToBGRPlanar,
  type LetterboxTransform,
} from '../preprocess'

// --------------------------------------------------------------------------
// where the world lives
// --------------------------------------------------------------------------

/** phase 0b session 2: 87 probe-flag frames at 480x640, the live claim the
 *  probe drew on each, and 19 hand-labelled ground-truth quads. */
export const SESSION2 =
  'E:/users/cheyr/deckpal/roadmap/plans/card-scanner-redesign/p2-work/phase0b/session2'
export const MODEL_PATH =
  'E:/users/cheyr/deckpal-wt/scan-harness/apps/web/public/scan-assets/lc050.onnx'
/** phase 0a's interpreter — onnxruntime + numpy already installed there. */
export const PY =
  'E:/users/cheyr/deckpal/roadmap/plans/card-scanner-redesign/p2-work/phase0a/.venv/Scripts/python.exe'

const SIDECAR = path.join(import.meta.dirname, 'ort_sidecar.py')

/** Metadata files in session2 that are analyses, not frame metadata. */
const NOT_A_FRAME = new Set([
  'list.json',
  'features.json',
  'triage.json',
  'gt.json',
  'gt_scores.json',
  'offline.json',
])

export interface FlagFrame {
  /** The upload's timestamp key; `<id>.png` is the frame. */
  id: string
  /** F000..F086 — index within probe-flags ordered by elapsed, which is the
   *  naming build_overlays.py and gt.json already use. */
  name: string
  elapsed: number
  width: number
  height: number
  png: string
  /** meta.model.points: the GATED live claim, normalised over the WHOLE frame
   *  (the probe stretched the full frame, so a model fraction is a frame
   *  fraction). Null when the live gate suppressed it. */
  livePoints: number[] | null
  liveHasObj: number
  /** Hand-labelled corners in frame pixels, for the 19 frames that have them. */
  gt: Quad | null
}

export function listFlagFrames(): FlagFrame[] {
  const gt: Record<string, number[][]> = JSON.parse(
    fs.readFileSync(path.join(SESSION2, 'gt.json'), 'utf8'),
  )
  const metas: Array<{ id: string; m: Record<string, unknown> }> = []
  for (const f of fs.readdirSync(SESSION2)) {
    if (!f.endsWith('.json') || NOT_A_FRAME.has(f)) continue
    const m = JSON.parse(fs.readFileSync(path.join(SESSION2, f), 'utf8'))
    if (m.type !== 'probe-flag') continue
    metas.push({ id: f.slice(0, -5), m })
  }
  metas.sort((a, b) => (a.m.elapsed as number) - (b.m.elapsed as number))
  return metas.map(({ id, m }, i) => {
    const name = `F${String(i).padStart(3, '0')}`
    const g = gt[name]
    const model = m.model as { points?: number[] } | null
    const dims = m.dims as { width: number; height: number }
    return {
      id,
      name,
      elapsed: m.elapsed as number,
      width: dims.width,
      height: dims.height,
      png: path.join(SESSION2, `${id}.png`),
      livePoints: model?.points ?? null,
      liveHasObj: ((m.telemetry as { hasObj?: number })?.hasObj ?? 0) as number,
      gt: g ? ([[g[0][0], g[0][1]], [g[1][0], g[1][1]], [g[2][0], g[2][1]], [g[3][0], g[3][1]]] as Quad) : null,
    }
  })
}

// --------------------------------------------------------------------------
// pixels (sharp stands in for canvas)
// --------------------------------------------------------------------------

interface SharpLike {
  (input?: string | Buffer | Record<string, unknown>, options?: Record<string, unknown>): SharpInstance
}
interface SharpInstance {
  extract(r: { left: number; top: number; width: number; height: number }): SharpInstance
  resize(o: Record<string, unknown>): SharpInstance
  composite(o: Array<Record<string, unknown>>): SharpInstance
  ensureAlpha(): SharpInstance
  removeAlpha(): SharpInstance
  raw(): SharpInstance
  png(): SharpInstance
  toBuffer(o?: { resolveWithObject?: boolean }): Promise<Buffer>
  toFile(p: string): Promise<unknown>
}

let sharpMod: SharpLike | null = null
export async function sharp(): Promise<SharpLike> {
  if (!sharpMod) sharpMod = ((await import('sharp')) as unknown as { default: SharpLike }).default
  return sharpMod
}

/** Decode to straight RGBA — the shape every pure function in the engine takes. */
export async function loadRGBA(file: string, w: number, h: number): Promise<ImageDataLike> {
  const S = await sharp()
  const buf = await S(file).ensureAlpha().raw().toBuffer()
  return { width: w, height: h, data: new Uint8ClampedArray(buf.buffer, buf.byteOffset, buf.length) }
}

function rgbaOf(buf: Buffer, w: number, h: number): ImageDataLike {
  return { width: w, height: h, data: new Uint8ClampedArray(buf.buffer, buf.byteOffset, buf.length) }
}

/**
 * THE PROBE'S preprocessing, reproduced: stretch the WHOLE frame to 256x256.
 * probe.html's fixed frameToTensor drew the video into a 256x256 canvas with a
 * single drawImage and no source rect, i.e. `fit: 'fill'`. This is the tensor
 * that measured 85.5% on-card live, so it is the baseline every engine stage is
 * compared against.
 */
export async function probeInput(file: string): Promise<ImageDataLike> {
  const S = await sharp()
  const buf = await S(file)
    .resize({ width: MODEL_SIZE, height: MODEL_SIZE, fit: 'fill', kernel: 'lanczos3' })
    .ensureAlpha()
    .raw()
    .toBuffer()
  return rgbaOf(buf, MODEL_SIZE, MODEL_SIZE)
}

/**
 * THE ENGINE's preprocessing as the BROWSER performs it: preprocess.drawLetterbox
 * is a gray fill plus one smooth-filtered drawImage of the crop, so this is a
 * gray canvas plus one smooth-filtered sharp resize of the same crop, composited
 * at the same place. The transform is the engine's own; only the resampler is
 * substituted.
 *
 * The destination box is rounded to whole pixels because a composite is, exactly
 * as drawImage rounds internally; the mapping back deliberately keeps the exact
 * fractional transform, so this reproduces the sub-pixel residual production has
 * rather than cancelling it out.
 */
export async function engineInput(file: string, t: LetterboxTransform): Promise<ImageDataLike> {
  const S = await sharp()
  const dw = Math.max(1, Math.round(t.crop.w * t.scale))
  const dh = Math.max(1, Math.round(t.crop.h * t.scale))
  const inner = await S(file)
    .extract({ left: t.crop.x, top: t.crop.y, width: t.crop.w, height: t.crop.h })
    .resize({ width: dw, height: dh, fit: 'fill', kernel: 'lanczos3' })
    .removeAlpha()
    .raw()
    .toBuffer()
  const buf = await S({
    create: {
      width: t.size,
      height: t.size,
      channels: 4,
      background: { r: PAD_VALUE, g: PAD_VALUE, b: PAD_VALUE, alpha: 1 },
    },
  })
    .composite([
      {
        input: inner,
        raw: { width: dw, height: dh, channels: 3 },
        left: Math.round(t.padX),
        top: Math.round(t.padY),
      },
    ])
    .raw()
    .toBuffer()
  return rgbaOf(buf, t.size, t.size)
}

/** index.ts grabWork(), offline: the reticle crop at up to `longSide`. */
export async function workImage(file: string, crop: Rect, longSide: number): Promise<ImageDataLike> {
  const S = await sharp()
  const s = Math.min(1, longSide / Math.max(crop.w, crop.h))
  const rw = Math.max(16, Math.round(crop.w * s))
  const rh = Math.max(16, Math.round(crop.h * s))
  const buf = await S(file)
    .extract({ left: crop.x, top: crop.y, width: crop.w, height: crop.h })
    .resize({ width: rw, height: rh, fit: 'fill', kernel: 'lanczos3' })
    .ensureAlpha()
    .raw()
    .toBuffer()
  return rgbaOf(buf, rw, rh)
}

// --------------------------------------------------------------------------
// the model
// --------------------------------------------------------------------------

export interface RawModelOut {
  points: number[]
  hasObj: number
}

export function ortAvailable(): boolean {
  return fs.existsSync(PY) && fs.existsSync(MODEL_PATH) && fs.existsSync(SIDECAR)
}

/** Run N already-preprocessed tensors through LC050. One subprocess per batch:
 *  session creation dominates, inference does not. */
export function runModel(inputs: readonly Float32Array[]): RawModelOut[] {
  if (inputs.length === 0) return []
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lc050-'))
  const binp = path.join(dir, 'in.bin')
  const outp = path.join(dir, 'out.json')
  try {
    const per = inputs[0].length
    const all = new Float32Array(per * inputs.length)
    inputs.forEach((v, i) => all.set(v, i * per))
    fs.writeFileSync(binp, Buffer.from(all.buffer, all.byteOffset, all.byteLength))
    execFileSync(PY, [SIDECAR, MODEL_PATH, binp, String(inputs.length), outp], {
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
    })
    return JSON.parse(fs.readFileSync(outp, 'utf8'))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

/** The tensor the engine hands the model, built by the engine's own function. */
export function toTensor(img: ImageDataLike): Float32Array {
  return rgbaToBGRPlanar(img)
}

// --------------------------------------------------------------------------
// coordinates
// --------------------------------------------------------------------------

/** The probe's mapping back: model fractions ARE frame fractions, because the
 *  whole frame was stretched (probe.html:626-636). */
export function probePointsToQuad(points: ArrayLike<number>, w: number, h: number): Quad | null {
  if (points.length < 8) return null
  const q: Point[] = []
  for (let i = 0; i < 4; i++) {
    const x = points[i * 2] * w
    const y = points[i * 2 + 1] * h
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null
    q.push([x, y])
  }
  return [q[0], q[1], q[2], q[3]]
}

export function reticleFor(w: number, h: number): Rect {
  return defaultReticle(w, h)
}

export function letterboxFor(w: number, h: number): LetterboxTransform {
  return computeLetterbox(w, h, defaultReticle(w, h))
}

/** Reticle rect in FRAME PIXELS (what the tracker's gate and the overlays use). */
export function reticlePx(w: number, h: number): Rect {
  const r = defaultReticle(w, h)
  return { x: r.x * w, y: r.y * h, w: r.w * w, h: r.h * h }
}

// --------------------------------------------------------------------------
// scoring
// --------------------------------------------------------------------------

/** Corner-to-corner distances under the best cyclic alignment (either winding).
 *  A quad carries no canonical starting corner, so comparing index-for-index
 *  would report a rotation as an error. */
export function cornerDeltas(a: Quad, b: Quad): number[] {
  let best: number[] = []
  let bestSum = Infinity
  for (const flip of [false, true]) {
    const bb: Quad = flip ? [b[0], b[3], b[2], b[1]] : b
    for (let r = 0; r < 4; r++) {
      const d = [0, 1, 2, 3].map((i) => Math.hypot(a[i][0] - bb[(i + r) % 4][0], a[i][1] - bb[(i + r) % 4][1]))
      const s = d.reduce((x, y) => x + y, 0)
      if (s < bestSum) {
        bestSum = s
        best = d
      }
    }
  }
  return best
}

export function meanDelta(a: Quad, b: Quad): number {
  const d = cornerDeltas(a, b)
  return d.reduce((x, y) => x + y, 0) / 4
}

export function maxDelta(a: Quad, b: Quad): number {
  return Math.max(...cornerDeltas(a, b))
}

export function quantiles(xs: readonly number[]): { median: number; p90: number; max: number; mean: number } {
  if (!xs.length) return { median: NaN, p90: NaN, max: NaN, mean: NaN }
  const s = [...xs].sort((a, b) => a - b)
  const at = (q: number) => s[Math.min(s.length - 1, Math.floor(q * s.length))]
  return {
    median: at(0.5),
    p90: at(0.9),
    max: s[s.length - 1],
    mean: s.reduce((a, b) => a + b, 0) / s.length,
  }
}

// --------------------------------------------------------------------------
// looking at it
// --------------------------------------------------------------------------

export type RGB = [number, number, number]

function plot(img: ImageDataLike, x: number, y: number, c: RGB): void {
  const xi = Math.round(x)
  const yi = Math.round(y)
  if (xi < 0 || yi < 0 || xi >= img.width || yi >= img.height) return
  const o = (yi * img.width + xi) * 4
  img.data[o] = c[0]
  img.data[o + 1] = c[1]
  img.data[o + 2] = c[2]
  img.data[o + 3] = 255
}

export function drawLine(img: ImageDataLike, a: Point, b: Point, c: RGB, wdt = 1): void {
  const n = Math.max(2, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) * 2))
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const x = a[0] + (b[0] - a[0]) * t
    const y = a[1] + (b[1] - a[1]) * t
    for (let dy = -(wdt - 1); dy <= wdt - 1; dy++)
      for (let dx = -(wdt - 1); dx <= wdt - 1; dx++) plot(img, x + dx, y + dy, c)
  }
}

export function drawQuad(img: ImageDataLike, q: Quad, c: RGB, wdt = 1, marks = true): void {
  for (let i = 0; i < 4; i++) drawLine(img, q[i], q[(i + 1) % 4], c, wdt)
  if (!marks) return
  for (let i = 0; i < 4; i++) {
    // corner index as a dot cluster: 0 is a single dot, 3 is four -- so a
    // scrambled winding is visible without reading numbers off the image.
    for (let k = 0; k <= i; k++) {
      const t = 6 + k * 4
      const nx = q[(i + 1) % 4][0] - q[i][0]
      const ny = q[(i + 1) % 4][1] - q[i][1]
      const L = Math.hypot(nx, ny) || 1
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++)
          plot(img, q[i][0] + (nx / L) * t + dx, q[i][1] + (ny / L) * t + dy, c)
    }
  }
}

export function drawRect(img: ImageDataLike, r: Rect, c: RGB, wdt = 1): void {
  drawQuad(
    img,
    [
      [r.x, r.y],
      [r.x + r.w, r.y],
      [r.x + r.w, r.y + r.h],
      [r.x, r.y + r.h],
    ],
    c,
    wdt,
    false,
  )
}

export async function writePNG(img: ImageDataLike, file: string): Promise<void> {
  const S = await sharp()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  await S(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.length), {
    raw: { width: img.width, height: img.height, channels: 4 },
  })
    .png()
    .toFile(file)
}

export function copyRGBA(img: ImageDataLike): ImageDataLike {
  return { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) }
}
