// Pure quad/polygon geometry shared by the scan engine's layers.
//
// Every function here is dependency-free, deterministic and DOM-free, so the
// refiner, the tracker and the rectifier can all be unit-tested under plain
// node. The implementations are ported verbatim in behaviour (not in style)
// from the two files this engine replaces:
//
//   p2-work/tracker.mjs            — polyArea, centroid, clipPoly, polyIoU,
//                                    isConvexQuad, alignToReference, defaultReticle
//   p2-work/detector-hybrid-v3.mjs — isStrictlyConvex, orderQuad (the OUTPUT
//                                    VALIDITY GATE), lineFromPts, lineIntersect,
//                                    fitLineTLS
//
// Keeping one copy of them means the tracker's convexity gate and the
// refiner's output gate cannot drift apart, which is precisely what happened
// between the harness's two detectors.

import type { Quad } from './contract'

export type Point = [number, number]

/** A rect in whatever space the caller is working in (frame px, or fractions). */
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** The subset of ImageData the pure functions need — so node tests can pass a
 *  plain object and the browser can pass a real ImageData. */
export interface ImageDataLike {
  readonly width: number
  readonly height: number
  readonly data: Uint8ClampedArray | Uint8Array
}

/** 63 mm x 88 mm — the trading card, portrait. */
export const CARD_ASPECT_W_OVER_H = 63 / 88

export function cloneQuad(q: Quad): Quad {
  return [
    [q[0][0], q[0][1]],
    [q[1][0], q[1][1]],
    [q[2][0], q[2][1]],
    [q[3][0], q[3][1]],
  ]
}

export function polyArea(pts: readonly Point[]): number {
  let a = 0
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length
    a += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1]
  }
  return Math.abs(a) / 2
}

export function centroid(pts: readonly Point[]): Point {
  let x = 0
  let y = 0
  for (const p of pts) {
    x += p[0]
    y += p[1]
  }
  return [x / pts.length, y / pts.length]
}

export function isFiniteQuad(q: unknown): q is Quad {
  if (!Array.isArray(q) || q.length !== 4) return false
  for (const p of q) {
    if (!Array.isArray(p) || p.length < 2) return false
    if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) return false
  }
  return true
}

/** Cross-product sign consistency. Tolerates collinear corners (skips them),
 *  which is why it is a *screen*, not the output gate — see isStrictlyConvexQuad. */
export function isConvexQuad(q: Quad): boolean {
  let sign = 0
  for (let i = 0; i < 4; i++) {
    const a = q[i]
    const b = q[(i + 1) % 4]
    const c = q[(i + 2) % 4]
    const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])
    if (Math.abs(cr) < 1e-9) continue
    const s = cr > 0 ? 1 : -1
    if (sign === 0) sign = s
    else if (s !== sign) return false
  }
  return sign !== 0
}

/** The OUTPUT VALIDITY GATE (detector-hybrid-v3.mjs §"OUTPUT VALIDITY GATE"):
 *  a quad is acceptable only if it is a SIMPLE, STRICTLY convex quadrilateral.
 *  Rejects duplicate corners and collinear (sliver) corners that isConvexQuad
 *  waves through. */
export function isStrictlyConvexQuad(q: Quad): boolean {
  let sign = 0
  for (let i = 0; i < 4; i++) {
    const a = q[i]
    const b = q[(i + 1) % 4]
    const c = q[(i + 2) % 4]
    const ux = b[0] - a[0]
    const uy = b[1] - a[1]
    const vx = c[0] - b[0]
    const vy = c[1] - b[1]
    const lu = Math.hypot(ux, uy)
    const lv = Math.hypot(vx, vy)
    if (lu < 1e-6 || lv < 1e-6) return false // duplicate corner
    const cr = (ux * vy - uy * vx) / (lu * lv) // sin of the turn angle
    if (Math.abs(cr) < 1e-3) return false // collinear -> degenerate
    const s = cr > 0 ? 1 : -1
    if (sign === 0) sign = s
    else if (s !== sign) return false
  }
  return sign !== 0
}

/** Repair + gate. A self-intersecting "bowtie" is very often nothing but a
 *  corner PERMUTATION of a perfectly good quad — two adjacent corners swapped
 *  by a refinement that crossed two side lines. Sorting the corners by angle
 *  about their centroid undoes exactly that, and is a no-op on an
 *  already-correct quad. Still not strictly convex afterwards => genuinely
 *  malformed => null.
 *
 *  `minSide` is the shortest side length tolerated (v3 used 1 px at 320-wide
 *  working scale); pass a larger value when working at capture resolution. */
export function orderQuad(q: Quad | null | undefined, minSide = 1): Quad | null {
  if (!isFiniteQuad(q)) return null
  const c = centroid(q)
  const idx = [0, 1, 2, 3].sort(
    (i, j) => Math.atan2(q[i][1] - c[1], q[i][0] - c[0]) - Math.atan2(q[j][1] - c[1], q[j][0] - c[0]),
  )
  const out: Quad = [
    [q[idx[0]][0], q[idx[0]][1]],
    [q[idx[1]][0], q[idx[1]][1]],
    [q[idx[2]][0], q[idx[2]][1]],
    [q[idx[3]][0], q[idx[3]][1]],
  ]
  for (let i = 0; i < 4; i++) {
    const a = out[i]
    const b = out[(i + 1) % 4]
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < minSide) return null
  }
  return isStrictlyConvexQuad(out) ? out : null
}

/** Sutherland-Hodgman: clip polygon `subject` by CONVEX polygon `clip`. */
export function clipPoly(subject: readonly Point[], clip: readonly Point[]): Point[] {
  let out: Point[] = subject.map((p) => [p[0], p[1]])
  const nc = clip.length
  let signedArea2 = 0
  for (let i = 0; i < nc; i++) {
    const j = (i + 1) % nc
    signedArea2 += clip[i][0] * clip[j][1] - clip[j][0] * clip[i][1]
  }
  const ccw = signedArea2 > 0 ? 1 : -1
  for (let e = 0; e < nc && out.length; e++) {
    const A = clip[e]
    const B = clip[(e + 1) % nc]
    const ex = B[0] - A[0]
    const ey = B[1] - A[1]
    const side = (p: Point) => ccw * (ex * (p[1] - A[1]) - ey * (p[0] - A[0]))
    const next: Point[] = []
    for (let i = 0; i < out.length; i++) {
      const cur = out[i]
      const prev = out[(i - 1 + out.length) % out.length]
      const sc = side(cur)
      const sp = side(prev)
      if (sc >= 0) {
        if (sp < 0) {
          const t = sp / (sp - sc)
          next.push([prev[0] + (cur[0] - prev[0]) * t, prev[1] + (cur[1] - prev[1]) * t])
        }
        next.push(cur)
      } else if (sp >= 0) {
        const t = sp / (sp - sc)
        next.push([prev[0] + (cur[0] - prev[0]) * t, prev[1] + (cur[1] - prev[1]) * t])
      }
    }
    out = next
  }
  return out
}

export function polyIoU(a: readonly Point[], b: readonly Point[]): number {
  const inter = clipPoly(a, b)
  if (inter.length < 3) return 0
  const ia = polyArea(inter)
  const u = polyArea(a) + polyArea(b) - ia
  return u > 0 ? ia / u : 0
}

export function rectPoly(r: Rect): Quad {
  return [
    [r.x, r.y],
    [r.x + r.w, r.y],
    [r.x + r.w, r.y + r.h],
    [r.x, r.y + r.h],
  ]
}

/** Fraction of `quad`'s own area that lies inside `rect`. */
export function insideFraction(quad: Quad, rect: Rect): number {
  const area = polyArea(quad)
  if (!(area > 0)) return 0
  const inter = clipPoly(quad, rectPoly(rect))
  return inter.length >= 3 ? polyArea(inter) / area : 0
}

export function pointInRect(p: Point, r: Rect): boolean {
  return p[0] >= r.x && p[0] <= r.x + r.w && p[1] >= r.y && p[1] <= r.y + r.h
}

/** Rotate `quad`'s starting corner (keeping winding direction) to whichever
 *  offset best aligns it with `ref`'s corner order, so corner-wise blending
 *  never averages a top-left corner into a bottom-right one because the
 *  detector's winding did not start at the same physical corner this tick. */
export function alignToReference(ref: Quad, quad: Quad): Quad {
  let best = quad
  let bestD = Infinity
  for (let r = 0; r < 4; r++) {
    const rotated: Quad = [quad[r % 4], quad[(r + 1) % 4], quad[(r + 2) % 4], quad[(r + 3) % 4]]
    let d = 0
    for (let i = 0; i < 4; i++) {
      const dx = rotated[i][0] - ref[i][0]
      const dy = rotated[i][1] - ref[i][1]
      d += dx * dx + dy * dy
    }
    if (d < bestD) {
      bestD = d
      best = rotated
    }
  }
  return cloneQuad(best)
}

/** Mean per-corner Euclidean distance between two corner-aligned quads. */
export function meanCornerDelta(a: Quad, b: Quad): number {
  let s = 0
  for (let i = 0; i < 4; i++) s += Math.hypot(a[i][0] - b[i][0], a[i][1] - b[i][1])
  return s / 4
}

/**
 * A quad's SHORT-over-LONG side ratio — directly comparable to
 * CARD_ASPECT_W_OVER_H (0.7159) with no knowledge of which way up the quad is.
 *
 * Opposite sides are averaged rather than taken individually so a keystoned
 * card (near side longer than far side, which every hand-held frame has) reads
 * as its own aspect rather than as the more extreme of its two edges. Returns 0
 * for a degenerate quad, which every caller must treat as "fails any tolerance".
 */
export function quadAspectRatio(q: Quad): number {
  const side = (i: number) => Math.hypot(q[(i + 1) % 4][0] - q[i][0], q[(i + 1) % 4][1] - q[i][1])
  const a = (side(0) + side(2)) / 2
  const b = (side(1) + side(3)) / 2
  const lo = Math.min(a, b)
  const hi = Math.max(a, b)
  return hi > 0 ? lo / hi : 0
}

/**
 * THE STRADDLE TEST: how nearly the quad's opposite sides are equal, as the
 * WORSE of the two opposite-side ratios (1.0 = a perfect parallelogram).
 *
 * WHAT IT CATCHES, AND WHY CONVEXITY CANNOT. The 2026-09-04 e2e drive found 5 of
 * 13 captures were one convex quad thrown across TWO STACKED CARDS — the
 * detector finding a plausible rectangle spanning a card and its neighbour.
 * Every one passed `isConvexQuad`, so the bowtie gate is no help: a straddle is
 * a perfectly good quadrilateral, just not of one card.
 *
 * What a straddle is NOT is a parallelogram. A real card under perspective
 * keystones gently — opposite sides stay within a few percent — while a quad
 * stretched across two offset cards has one pair grossly unequal. Measured on
 * the drive's 13 captures, hand-judged, taking the WORSE of the two pairs:
 *
 *   class     n   worse opposite-side ratio
 *   GOOD      6   0.858 - 0.988
 *   PARTIAL   2   0.784 - 0.817
 *   BAD       5   0.506 - 0.659      <- every straddle
 *
 * No overlap: 0.659 to 0.784 is empty.
 *
 * THE WORSE OF BOTH PAIRS, NOT ONE OF THEM. Scoring only the second pair (sides
 * 1-2 and 3-0) separates these particular captures more widely — 0.882 to 0.659
 * — but that pair is whichever two edges the MODEL's corner winding happened to
 * put there, not the card's left and right. On the same 13 captures the first
 * pair alone does not separate the classes at all (usable from 0.784, straddles
 * up to 0.824), so a straddle oriented the other way would pass a one-pair test.
 * Taking the minimum is index- and orientation-independent, which is worth the
 * narrower band. See DEFAULT_LOCK_PARALLEL_MIN.
 */
export function oppositeSideRatio(q: Quad): number {
  const side = (i: number) => Math.hypot(q[(i + 1) % 4][0] - q[i][0], q[(i + 1) % 4][1] - q[i][1])
  const pair = (a: number, b: number) => {
    const lo = Math.min(a, b)
    const hi = Math.max(a, b)
    return hi > 0 ? lo / hi : 0
  }
  // Both opposite pairs; the worse governs, since a straddle can skew either.
  return Math.min(pair(side(0), side(2)), pair(side(1), side(3)))
}

/** Largest per-corner Euclidean distance between two corner-aligned quads. */
export function maxCornerDelta(a: Quad, b: Quad): number {
  let m = 0
  for (let i = 0; i < 4; i++) {
    const d = Math.hypot(a[i][0] - b[i][0], a[i][1] - b[i][1])
    if (d > m) m = d
  }
  return m
}

/** Contain-fit a card-aspect (63:88) box within `maxWFrac` of frame width and
 *  `maxHFrac` of frame height, whichever is tighter, then centre it. Returned
 *  as FRACTIONS of the frame, which is the shape EngineState.reticle wants.
 *
 *  Ported from tracker.mjs's defaultReticle. On a portrait phone stream the
 *  width cap wins and the box really is ~72% of frame width ("mostly aligning
 *  it, but not so dang exact"). On a landscape frame the height cap wins
 *  instead, so a 63:88 portrait shape still fits on-screen rather than running
 *  off the top and bottom — a deliberate adaptation, not a literal 72% box. */
export function defaultReticle(frameW: number, frameH: number, maxWFrac = 0.72, maxHFrac = 0.92): Rect {
  const wFromWidthCap = maxWFrac * frameW
  const wFromHeightCap = maxHFrac * frameH * CARD_ASPECT_W_OVER_H
  const wPx = Math.min(wFromWidthCap, wFromHeightCap)
  const hPx = wPx / CARD_ASPECT_W_OVER_H
  return { x: (1 - wPx / frameW) / 2, y: (1 - hPx / frameH) / 2, w: wPx / frameW, h: hPx / frameH }
}

/**
 * The part of the frame the user can actually SEE, in frame pixels, when the
 * video is rendered into a `boxW`x`boxH` element with `object-fit: cover`.
 *
 * WHY THIS EXISTS (the 2026-09-03 field-test bug). `defaultReticle` fits a
 * 63:88 box inside the FRAME. The product renders the frame into a camera box
 * that is a different aspect and lets `object-fit: cover` crop the overflow —
 * and on a portrait phone stream in a landscape camera box, cover throws away
 * the top and bottom of the frame. Measured against the owner's build (frame
 * portrait, box 428x324 CSS): the reticle landed at CSS y -53..377 in a 324-tall
 * box, i.e. BOTH its horizontal edges off-screen, so it drew as two full-height
 * dashed verticals and stopped reading as a target at all.
 *
 * Worse than cosmetic: `tracker.passesReticle` gates on that same rect, so the
 * gate covered 1.33x MORE rows than the user could see — every visible row was
 * inside it, plus a tall invisible band above and below. Vertical gating became
 * a no-op and off-screen clutter could be tracked, locked and auto-captured.
 *
 * The fix is to fit the reticle inside THIS rect instead of inside the frame.
 * A `null`/degenerate box means "no viewport information" and yields the whole
 * frame, which is exactly the old behaviour — offline harnesses and unit tests
 * that never set a viewport are unaffected.
 */
export function visibleRect(frameW: number, frameH: number, boxW?: number | null, boxH?: number | null): Rect {
  if (!frameW || !frameH) return { x: 0, y: 0, w: 0, h: 0 }
  if (!boxW || !boxH || boxW <= 0 || boxH <= 0) return { x: 0, y: 0, w: frameW, h: frameH }
  // object-fit: cover — one scale, centred, the larger of the two ratios.
  const scale = Math.max(boxW / frameW, boxH / frameH)
  const w = Math.min(frameW, boxW / scale)
  const h = Math.min(frameH, boxH / scale)
  return { x: (frameW - w) / 2, y: (frameH - h) / 2, w, h }
}

/**
 * `defaultReticle`'s 63:88 contain-fit, performed inside `vis` (frame pixels)
 * and reported back as FRACTIONS OF THE FRAME — which is what
 * `EngineState.reticle` has always been, so every existing consumer
 * (QuadOverlay, coords.reticleToCss, the tracker's gate) keeps working
 * unchanged and simply receives a rect that is now fully on screen.
 */
export function reticleWithin(frameW: number, frameH: number, vis: Rect, maxWFrac = 0.72, maxHFrac = 0.92): Rect {
  if (!frameW || !frameH || !vis.w || !vis.h) return defaultReticle(frameW || 1, frameH || 1, maxWFrac, maxHFrac)
  const local = defaultReticle(vis.w, vis.h, maxWFrac, maxHFrac)
  return {
    x: (vis.x + local.x * vis.w) / frameW,
    y: (vis.y + local.y * vis.h) / frameH,
    w: (local.w * vis.w) / frameW,
    h: (local.h * vis.h) / frameH,
  }
}

// ---------------------------------------------------------------------------
// line algebra (used by the sub-pixel refiner)
// ---------------------------------------------------------------------------

/** A line as [a, b, c] with a*x + b*y = c and hypot(a,b) === 1. */
export type Line = [number, number, number]

export function lineFromPts(p1: Point, p2: Point): Line {
  let a = p2[1] - p1[1]
  let b = p1[0] - p2[0]
  const nm = Math.hypot(a, b) || 1
  a /= nm
  b /= nm
  return [a, b, a * p1[0] + b * p1[1]]
}

export function lineIntersect(l1: Line, l2: Line): Point | null {
  const det = l1[0] * l2[1] - l2[0] * l1[1]
  if (Math.abs(det) < 1e-9) return null
  return [(l1[2] * l2[1] - l2[2] * l1[1]) / det, (l1[0] * l2[2] - l2[0] * l1[2]) / det]
}

/** Total-least-squares (orthogonal) line fit — minimises perpendicular
 *  distance, unlike an ordinary least-squares fit which cannot represent a
 *  vertical edge at all. */
export function fitLineTLS(pts: readonly Point[]): Line {
  const N = pts.length
  let mx = 0
  let my = 0
  for (const p of pts) {
    mx += p[0]
    my += p[1]
  }
  mx /= N
  my /= N
  let sxx = 0
  let sxy = 0
  let syy = 0
  for (const p of pts) {
    const dx = p[0] - mx
    const dy = p[1] - my
    sxx += dx * dx
    sxy += dx * dy
    syy += dy * dy
  }
  const tr = sxx + syy
  const det = sxx * syy - sxy * sxy
  const lam = (tr - Math.sqrt(Math.max(0, tr * tr - 4 * det))) / 2
  let a = sxy
  let b = lam - sxx
  if (Math.abs(a) < 1e-9 && Math.abs(b) < 1e-9) {
    a = sxx <= syy ? 1 : 0
    b = sxx <= syy ? 0 : 1
  }
  const nm = Math.hypot(a, b) || 1
  a /= nm
  b /= nm
  return [a, b, a * mx + b * my]
}
