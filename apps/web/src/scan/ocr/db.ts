// DB DETECTION POST-PROCESSING — probability map to text boxes.
//
// PP-OCRv4's detector is a Differentiable Binarization net: it outputs one
// probability channel at the input's own resolution, and every box in it has to
// be recovered by classical geometry. The reference implementation
// (`@gutenye/ocr-common/src/backend/splitIntoLineImages.ts`, the code path the
// bakeoff's 21-crop measurement actually ran) does that with two WASM libraries:
// `@techstark/opencv-js` for `findContours` / `minAreaRect` / `warpPerspective`
// and `js-clipper` for the polygon offset.
//
// ── WHY THIS IS ~200 LINES INSTEAD OF TWO IMPORTS ───────────────────────────
//
// OpenCV.js is 13.3 MB — the app already carries a copy under `dev-assets/` for
// `/dev/scan-harness`'s Engine A/B toggle, and `vite.config.ts` excludes it from
// the precache with a comment about exactly this: a heavy payload must be
// fetched only by whoever opens that route. Adding it to the SHIPPING scanner
// would very nearly double the OCR lane's 15.6 MB, to run four functions.
// REPORT.md §5.2's whole case for PP-OCRv4 is "reuses the ORT runtime and proxy
// worker entirely"; pulling in a second WASM runtime to post-process its output
// would spend the margin that argument earned.
//
// ── AND WHAT IS DELIBERATELY NOT REPRODUCED ─────────────────────────────────
//
// Each departure from the reference is named where it happens, but the three
// that matter, together, so a reviewer can find them:
//
//  1. CONNECTED COMPONENTS instead of `findContours(RETR_LIST)`. Equivalent for
//     this purpose and stated at `components()`.
//  2. RECTANGLE EXPANSION instead of a Clipper polygon offset. Provably
//     identical for the rectangles this is ever handed — stated at `unclip()`.
//  3. NO 90° ROTATION of tall crops. Stated at `detectBoxes()`.

import type { Box, Point } from './raster'

/**
 * The binarisation threshold on the probability map.
 *
 * 0.03, not PaddleOCR's own default of 0.3. This is the reference
 * implementation's number (`Detection.run`: `outputToImage(modelOutput, 0.03)`)
 * and therefore the number every accuracy figure in REPORT.md was measured at.
 * It is an order of magnitude more permissive than upstream, which on a card is
 * the right direction — the set badge is white-on-dark at roughly 26×12 px and
 * is the lowest-confidence text on the card (§4.1) — and the cost of a
 * permissive threshold is extra junk boxes, which the recogniser's own 0.5 mean
 * -confidence filter and the field extractor's furniture rules then discard.
 */
export const DB_THRESHOLD = 0.03

/** Minimum short side of a raw contour's box, in detector-input pixels. Below
 *  this it cannot be a line of text at any scale we feed. */
const MIN_SIDE = 3
/** Minimum short side AFTER unclipping. The reference uses `minSize + 2`. */
const MIN_SIDE_UNCLIPPED = MIN_SIDE + 2
/** The DB unclip ratio. PaddleOCR's default, and the reference's. */
const UNCLIP_RATIO = 1.5

/** An axis-agnostic rotated rectangle: centre, extent, rotation in radians. */
interface RotRect {
  cx: number
  cy: number
  w: number
  h: number
  /** Direction of the `w` axis. */
  angle: number
}

/**
 * Label 8-connected runs of above-threshold pixels.
 *
 * ── WHY THIS REPLACES `findContours` WITHOUT CHANGING THE ANSWER ────────────
 *
 * The reference calls `findContours(RETR_LIST, CHAIN_APPROX_SIMPLE)` and hands
 * each contour to `minAreaRect`. The minimum-area rectangle of a point set is a
 * property of that set's CONVEX HULL, and the convex hull of a connected
 * component is the convex hull of its boundary — so the rectangle computed from
 * a component's pixels and the rectangle computed from its traced contour are
 * the same rectangle. What `RETR_LIST` adds is HOLE contours (the inside of an
 * `O`), which produce boxes strictly smaller than the component containing them
 * and are dropped by the `MIN_SIDE` gates below; on a 3×-upscaled card band they
 * are a handful of pixels across.
 *
 * Returned as flat index runs rather than point arrays: a 1408×416 detector
 * input is 585k pixels and the components on a text band are large.
 */
function components(bin: Uint8Array, w: number, h: number): Int32Array[] {
  const seen = new Uint8Array(bin.length)
  const out: Int32Array[] = []
  const stack: number[] = []
  for (let start = 0; start < bin.length; start++) {
    if (!bin[start] || seen[start]) continue
    const pixels: number[] = []
    stack.push(start)
    seen[start] = 1
    while (stack.length) {
      const p = stack.pop() as number
      pixels.push(p)
      const x = p % w
      const y = (p / w) | 0
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy
        if (ny < 0 || ny >= h) continue
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx
          if (nx < 0 || nx >= w) continue
          const q = ny * w + nx
          if (!bin[q] || seen[q]) continue
          seen[q] = 1
          stack.push(q)
        }
      }
    }
    out.push(Int32Array.from(pixels))
  }
  return out
}

/** Monotone-chain convex hull, counter-clockwise, no collinear points. */
function convexHull(pts: Point[]): Point[] {
  if (pts.length < 3) return pts
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const cross = (o: Point, a: Point, b: Point) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const build = (src: Point[]): Point[] => {
    const st: Point[] = []
    for (const q of src) {
      while (st.length >= 2 && cross(st[st.length - 2], st[st.length - 1], q) <= 0) st.pop()
      st.push(q)
    }
    st.pop()
    return st
  }
  return [...build(p), ...build([...p].reverse())]
}

/**
 * Minimum-area enclosing rectangle — OpenCV's `minAreaRect`, by rotating-hull.
 *
 * The minimum-area rectangle of a convex polygon always has one side flush with
 * a hull edge (a standard result), so trying every hull edge as the rectangle's
 * axis and keeping the smallest is exact, not an approximation. Hulls here have
 * tens of vertices, so the O(n²) is a few hundred operations per box and the
 * rotating-calipers version would buy nothing but a chance to get it wrong.
 */
function minAreaRect(pts: Point[]): RotRect | null {
  const hull = convexHull(pts)
  if (hull.length === 0) return null
  if (hull.length < 3) {
    const xs = hull.map((p) => p[0])
    const ys = hull.map((p) => p[1])
    const x0 = Math.min(...xs), x1 = Math.max(...xs)
    const y0 = Math.min(...ys), y1 = Math.max(...ys)
    return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0, angle: 0 }
  }
  let best: RotRect | null = null
  let bestArea = Number.POSITIVE_INFINITY
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i]
    const b = hull[(i + 1) % hull.length]
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (len < 1e-9) continue
    const ux = (b[0] - a[0]) / len
    const uy = (b[1] - a[1]) / len
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity
    for (const p of hull) {
      const u = p[0] * ux + p[1] * uy
      const v = -p[0] * uy + p[1] * ux
      if (u < minU) minU = u
      if (u > maxU) maxU = u
      if (v < minV) minV = v
      if (v > maxV) maxV = v
    }
    const w = maxU - minU
    const h = maxV - minV
    const area = w * h
    if (area >= bestArea) continue
    bestArea = area
    const cu = (minU + maxU) / 2
    const cv = (minV + maxV) / 2
    best = { cx: cu * ux - cv * uy, cy: cu * uy + cv * ux, w, h, angle: Math.atan2(uy, ux) }
  }
  return best
}

/**
 * The DB "unclip" — grow the box back out to cover the glyphs, not just their
 * shrunk probability blob.
 *
 * DB is trained to predict a SHRUNK version of each text region, so every box
 * must be expanded by `area * ratio / perimeter` before it means anything. The
 * reference does that with a Clipper polygon offset followed by a second
 * `minAreaRect`.
 *
 * FOR A RECTANGLE THAT IS THE SAME ANSWER, EXACTLY. Offsetting a rectangle
 * outward by `d` produces that rectangle grown by `d` on all four sides, with
 * rounded corners of radius `d`; the minimum-area rectangle of THAT shape is the
 * rectangle grown by `d` on all four sides. The corners are the only difference
 * and they are discarded by the very next operation. And a rectangle is all this
 * is ever handed — the input is `minAreaRect`'s own output, never a general
 * polygon — so this is an identity rather than an approximation, and it costs a
 * 100 KB dependency less.
 *
 * With `area = w·h` and `perimeter = 2(w+h)`, `d = ratio·w·h / (2(w+h))`.
 */
function unclip(rect: RotRect, ratio = UNCLIP_RATIO): RotRect {
  const perimeter = 2 * (rect.w + rect.h)
  if (perimeter <= 0) return rect
  const d = (ratio * rect.w * rect.h) / perimeter
  return { ...rect, w: rect.w + 2 * d, h: rect.h + 2 * d }
}

/** The four corners of a rotated rect, ordered [TL, TR, BR, BL] the way
 *  `getMiniBoxes` orders them: sort by x, then split by y within each pair. */
function corners(r: RotRect): Box {
  const c = Math.cos(r.angle)
  const s = Math.sin(r.angle)
  const hw = r.w / 2
  const hh = r.h / 2
  const raw: Point[] = [
    [r.cx - hw * c + hh * s, r.cy - hw * s - hh * c],
    [r.cx + hw * c + hh * s, r.cy + hw * s - hh * c],
    [r.cx + hw * c - hh * s, r.cy + hw * s + hh * c],
    [r.cx - hw * c - hh * s, r.cy - hw * s + hh * c],
  ]
  const p = [...raw].sort((a, b) => a[0] - b[0])
  const [l1, l2] = p[1][1] > p[0][1] ? [p[0], p[1]] : [p[1], p[0]]
  const [r1, r2] = p[3][1] > p[2][1] ? [p[2], p[3]] : [p[3], p[2]]
  return [l1, r1, r2, l2]
}

export interface DetectedBox {
  box: Box
  /** Short side after unclipping, in detector-input pixels — the size gate's
   *  own measurement, kept so a caller can log why a box survived. */
  side: number
}

/**
 * Probability map → text boxes, in the coordinate space of the map itself
 * (which is the detector input's space: PP-OCRv4's DB head outputs at 1:1).
 *
 * NO 90° ROTATION OF TALL CROPS. The reference rotates a crop whose
 * height/width ratio is ≥ 1.5, on the assumption it is vertical Chinese text.
 * Two reasons not to: the ROIs here are horizontal bands of a rectified,
 * upright card, so a box that tall is an artefact (a card border, a rarity
 * glyph, an energy symbol) rather than a line; and the reference's own rotation
 * path is visibly wrong — it builds the rotation centre as
 * `new cv.Point(dst.cols / 2, dst.cols / 2)`, using the width for both axes.
 * Reproducing it would reproduce the bug. Such boxes are kept, unrotated: they
 * recognise as junk, and junk is what the 0.5 mean-confidence filter and the
 * extractor's furniture rules exist to absorb.
 */
export function detectBoxes(
  prob: Float32Array | Float64Array,
  w: number,
  h: number,
  threshold = DB_THRESHOLD,
): DetectedBox[] {
  const bin = new Uint8Array(w * h)
  for (let i = 0; i < bin.length; i++) bin[i] = prob[i] > threshold ? 1 : 0

  const out: DetectedBox[] = []
  for (const comp of components(bin, w, h)) {
    // Every pixel of the component, as its four corners would be too many
    // points for no gain: the hull of the pixel CENTRES differs from the hull of
    // the pixel SQUARES by half a pixel, and the unclip below adds several.
    const pts: Point[] = new Array(comp.length)
    for (let i = 0; i < comp.length; i++) pts[i] = [comp[i] % w, (comp[i] / w) | 0]

    const rect = minAreaRect(pts)
    if (!rect) continue
    if (Math.min(rect.w, rect.h) < MIN_SIDE) continue

    const grown = unclip(rect)
    const side = Math.min(grown.w, grown.h)
    if (side < MIN_SIDE_UNCLIPPED) continue

    const box = corners(grown).map(
      (p) => [clamp(Math.round(p[0]), 0, w), clamp(Math.round(p[1]), 0, h)] as Point,
    ) as unknown as Box
    // The reference's own last gate, on the ROUNDED box: a degenerate sliver
    // cannot be warped into anything a recogniser can read.
    if (Math.trunc(Math.hypot(box[0][0] - box[1][0], box[0][1] - box[1][1])) <= 3) continue
    if (Math.trunc(Math.hypot(box[0][0] - box[3][0], box[0][1] - box[3][1])) <= 3) continue
    out.push({ box, side })
  }
  return out
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

/**
 * Assemble recognised fragments into LINES, the way the reference's `afAfRec`
 * does — and this matters more than it looks.
 *
 * The detector splits the bottom strip into several boxes, so `DRIEN`,
 * `089/182` and a scrap of flavour text arrive as three separate recognitions.
 * The extractor's number rule looks for `NNN/NNN` and its badge rule looks at
 * "the text left of the number ON THE SAME LINE" — both of which need those
 * three glued back together in reading order. Every raw line recorded in the
 * bakeoff's `results.json` (`"DRIEN089/182 inc"`, `"116/182 neversecretepo"`) is
 * post-grouping, so the extractor's unit tests are tests of the pair.
 *
 * Boxes whose vertical midlines differ by less than half the mean box height are
 * one line; within a line, left to right; lines, top to bottom.
 */
export function groupIntoLines<T extends { box: Box; text: string; mean: number }>(
  items: readonly T[],
): { text: string; mean: number; y: number }[] {
  if (items.length === 0) return []
  const midline = (b: Box) => (b[0][1] + b[2][1]) / 2
  const height = (b: Box) => Math.abs(b[2][1] - b[0][1])
  const avgH = items.reduce((s, it) => s + height(it.box), 0) / items.length
  const groups: T[][] = []
  for (const it of items) {
    const g = groups.find((grp) => Math.abs(midline(grp[0].box) - midline(it.box)) < avgH / 2)
    if (g) g.push(it)
    else groups.push([it])
  }
  return groups
    .map((g) => {
      const sorted = [...g].sort((a, b) => a.box[0][0] - b.box[0][0])
      return {
        text: sorted.map((s) => s.text).join(' '),
        mean: sorted.reduce((s, x) => s + x.mean, 0) / sorted.length,
        y: midline(sorted[0].box),
      }
    })
    .sort((a, b) => a.y - b.y)
}
