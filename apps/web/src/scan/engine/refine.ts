// The classical sub-pixel refiner, kept as the POLISH layer.
//
// DECISIONS.md 2026-09-02: the learned model replaces classical detection, but
// "the classical sub-pixel refiner [is] kept as the polish layer". This is a
// direct port of p2-work/detector-hybrid-v3.mjs's `refineQuad` (+ its
// `frontEnd` gradient front end, `sampleMagBilinear`, and the OUTPUT VALIDITY
// GATE that follows it), rewritten as pure typed functions over ImageData so
// it can run at capture resolution and be unit-tested under node.
//
// WHY IT EARNS ITS PLACE. Of the 21 non-clean card frames in PHASE0-CLOSEOUT's
// live batch, three are "sloppy but on-perimeter" — one corner out, or inside
// the sleeve-rim label slop (§2.5) — and §3.2 names this refiner as "exactly
// the tool for these". It cannot fix a miss, a merge or an interior lock; it
// moves a corner that is already within a few pixels of an edge ONTO that
// edge, and refuses to move it at all when the evidence is not there.
//
// THE METHOD, per side:
//   1. walk `samples` points along the side (12%..88%, so corners — where two
//      edges interfere — are never sampled, only extrapolated to),
//   2. at each, search +-`half` px along the side's NORMAL for the strongest
//      gradient ridge, counting only gradients that actually point across the
//      side (|cos| >= orientT) so a parallel neighbouring texture cannot win,
//   3. refine that discrete peak to sub-pixel with a 3-point parabola,
//   4. fit a total-least-squares line through the surviving points, re-fit
//      once without the >1.6 px outliers,
//   5. intersect adjacent side lines for the corners.
//
// Each stage has its own refusal: a side with fewer than 4 usable points keeps
// its original line; a ridge weaker than `minPeak` is not a point; a corner
// that wants to move further than `maxMove` keeps its input position. So the
// refiner degrades to "return what you were given", never to "invent".
//
// CALIBRATION. The constants below are v3's, measured on ~320 px-wide working
// frames. `maxMove` and `minPeak` are the two that are scale-dependent (a
// 14 px leash is generous at 320 px wide and tight at 1280); the engine passes
// its own working scale rather than assuming.

import type { Quad } from './contract'
import {
  fitLineTLS,
  lineFromPts,
  lineIntersect,
  orderQuad,
  type ImageDataLike,
  type Line,
  type Point,
} from './geometry'

/** Oriented gradient field: magnitude plus the UNIT gradient direction of the
 *  strongest colour channel at each pixel. Colour, not luminance: a red-on-blue
 *  card border can be invisible to a grayscale gradient. */
export interface GradientField {
  readonly width: number
  readonly height: number
  /** Sobel magnitude, summed over the three channels. */
  readonly mag: Float32Array
  /** Unit gradient x/y of the strongest channel. */
  readonly gxo: Float32Array
  readonly gyo: Float32Array
  readonly maxMag: number
}

export interface RefineOptions {
  /** Points sampled along each side. v3: 17. */
  samples?: number
  /** Perpendicular search half-width in px. v3 runs two passes, 6 then 3. */
  half?: number
  /** A ridge weaker than this is not evidence. v3: 90. */
  minPeak?: number
  /** A corner refusing to move further than this stays put. v3: 14. */
  maxMove?: number
  /** |cos| between the gradient and the side normal. v3: 0.68. */
  orientT?: number
}

export const REFINE_DEFAULTS = {
  samples: 17,
  half: 3,
  minPeak: 90,
  maxMove: 14,
  orientT: 0.68,
} as const

/** v3's two-pass schedule: a wide capture pass, then a tight settle pass. */
export const REFINE_PASS_HALVES = [6, 3] as const

/**
 * Sobel front end. Ported from detector-hybrid-v3.mjs `frontEnd`.
 *
 * `mag` is the L2 norm of the per-channel Sobel responses summed in quadrature
 * (so a strong edge in ANY channel registers); `gxo`/`gyo` are the unit
 * direction of the single strongest channel, which is what the orientation
 * gate needs — an average direction across channels is meaningless where two
 * channels disagree.
 *
 * The 1 px border is left at zero, which is why every sampler below refuses to
 * read within 2 px of the edge.
 */
export function gradientField(img: ImageDataLike): GradientField {
  const W = img.width
  const H = img.height
  const data = img.data
  const N = W * H
  const mag = new Float32Array(N)
  const gxo = new Float32Array(N)
  const gyo = new Float32Array(N)
  const rowW = W * 4
  let maxMag = 0
  for (let y = 1; y < H - 1; y++) {
    let p = (y * W + 1) * 4
    const row = y * W
    for (let x = 1; x < W - 1; x++, p += 4) {
      let gx2 = 0
      let gy2 = 0
      let bestE = -1
      let bgx = 0
      let bgy = 0
      for (let c = 0; c < 3; c++) {
        const i = p + c
        const tl = data[i - rowW - 4]
        const tc = data[i - rowW]
        const tr = data[i - rowW + 4]
        const ml = data[i - 4]
        const mr = data[i + 4]
        const bl = data[i + rowW - 4]
        const bc = data[i + rowW]
        const br = data[i + rowW + 4]
        const gx = tr + 2 * mr + br - tl - 2 * ml - bl
        const gy = bl + 2 * bc + br - tl - 2 * tc - tr
        gx2 += gx * gx
        gy2 += gy * gy
        const e = gx * gx + gy * gy
        if (e > bestE) {
          bestE = e
          bgx = gx
          bgy = gy
        }
      }
      const m = Math.sqrt(gx2 + gy2)
      const i2 = row + x
      mag[i2] = m
      const nm = Math.sqrt(bestE) || 1
      gxo[i2] = bgx / nm
      gyo[i2] = bgy / nm
      if (m > maxMag) maxMag = m
    }
  }
  return { width: W, height: H, mag, gxo, gyo, maxMag }
}

/** Bilinear sample of the magnitude map, clamped at the border. */
export function sampleMagBilinear(F: GradientField, x: number, y: number): number {
  const W = F.width
  const H = F.height
  if (x < 0) x = 0
  else if (x > W - 1) x = W - 1
  if (y < 0) y = 0
  else if (y > H - 1) y = H - 1
  const x0 = x | 0
  const y0 = y | 0
  const x1 = x0 + 1 < W ? x0 + 1 : x0
  const y1 = y0 + 1 < H ? y0 + 1 : y0
  const fx = x - x0
  const fy = y - y0
  const a = F.mag[y0 * W + x0]
  const b = F.mag[y0 * W + x1]
  const c = F.mag[y1 * W + x0]
  const d = F.mag[y1 * W + x1]
  const t = a + (b - a) * fx
  const u = c + (d - c) * fx
  return t + (u - t) * fy
}

/**
 * One refinement pass. Returns a quad in the same coordinate space as the
 * input, corner-for-corner (index i in === index i out).
 */
export function refineQuad(quad: Quad, F: GradientField, opts: RefineOptions = {}): Quad {
  const K = opts.samples ?? REFINE_DEFAULTS.samples
  const half = opts.half ?? REFINE_DEFAULTS.half
  const minPeak = opts.minPeak ?? REFINE_DEFAULTS.minPeak
  const maxMove = opts.maxMove ?? REFINE_DEFAULTS.maxMove
  const orientT = opts.orientT ?? REFINE_DEFAULTS.orientT
  const W = F.width
  const H = F.height

  const lines: Line[] = []
  for (let i = 0; i < 4; i++) {
    const c0 = quad[i]
    const c1 = quad[(i + 1) % 4]
    const dx = c1[0] - c0[0]
    const dy = c1[1] - c0[1]
    const Ln = Math.hypot(dx, dy)
    if (Ln < 8) {
      lines.push(lineFromPts(c0, c1))
      continue
    }
    const nx = -dy / Ln
    const ny = dx / Ln
    const pts: Point[] = []
    for (let s = 0; s < K; s++) {
      const t = 0.12 + (0.76 * s) / (K - 1)
      const px = c0[0] + dx * t
      const py = c0[1] + dy * t
      if (px < 2 || py < 2 || px > W - 3 || py > H - 3) continue
      let bv = -1
      let bo = 0
      for (let o = -half; o <= half; o += 0.5) {
        const qx = px + nx * o
        const qy = py + ny * o
        if (qx < 1 || qy < 1 || qx > W - 2 || qy > H - 2) continue
        const idx = Math.round(qy) * W + Math.round(qx)
        // Orientation gate: only a gradient pointing ACROSS this side counts.
        if (Math.abs(F.gxo[idx] * nx + F.gyo[idx] * ny) < orientT) continue
        const v = sampleMagBilinear(F, qx, qy)
        if (v > bv) {
          bv = v
          bo = o
        }
      }
      if (bv < minPeak) continue
      // 3-point parabola through the ridge crest, +-0.6 px either side.
      const vm = sampleMagBilinear(F, px + nx * (bo - 0.6), py + ny * (bo - 0.6))
      const vp = sampleMagBilinear(F, px + nx * (bo + 0.6), py + ny * (bo + 0.6))
      const dn = vm - 2 * bv + vp
      let o = bo
      if (Math.abs(dn) > 1e-6) {
        const corr = (0.6 * (vm - vp)) / (2 * dn)
        if (Math.abs(corr) <= 0.6) o = bo + corr
      }
      pts.push([px + nx * o, py + ny * o])
    }
    if (pts.length < 4) {
      lines.push(lineFromPts(c0, c1))
      continue
    }
    let ln = fitLineTLS(pts)
    const keep: Point[] = []
    for (const p of pts) if (Math.abs(ln[0] * p[0] + ln[1] * p[1] - ln[2]) < 1.6) keep.push(p)
    if (keep.length >= 4 && keep.length < pts.length) ln = fitLineTLS(keep)
    lines.push(ln)
  }

  const out: Point[] = []
  for (let i = 0; i < 4; i++) {
    // corner i is where side i (i -> i+1) meets side i-1 (i-1 -> i)
    const p = lineIntersect(lines[i], lines[(i + 3) % 4])
    if (
      !p ||
      !Number.isFinite(p[0]) ||
      !Number.isFinite(p[1]) ||
      Math.hypot(p[0] - quad[i][0], p[1] - quad[i][1]) > maxMove
    ) {
      out.push([quad[i][0], quad[i][1]])
    } else {
      out.push(p)
    }
  }
  return [out[0], out[1], out[2], out[3]]
}

/**
 * The shipping entry point: v3's two-pass schedule (wide capture, tight
 * settle) followed by the OUTPUT VALIDITY GATE.
 *
 * Returns null when refinement produced something that is not a simple,
 * strictly convex quadrilateral — a bowtie that corner-reordering could not
 * repair, a sliver, a duplicated corner. The caller must then fall back to the
 * model's own (already convex) output rather than display the wreckage: the
 * tracker's law is that it may never draw worse than the model did.
 */
export function refineQuadChecked(
  quad: Quad,
  F: GradientField,
  opts: RefineOptions = {},
  halves: readonly number[] = REFINE_PASS_HALVES,
): Quad | null {
  let q = quad
  for (const half of halves) q = refineQuad(q, F, { ...opts, half })
  return orderQuad(q)
}
