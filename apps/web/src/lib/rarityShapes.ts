// ─────────────────────────────────────────────────────────────────────────────
// Optical glyph sizing for rarity marks.
//
// THE PROBLEM. Every rarity glyph is drawn in the same 24×24 viewBox, so their
// BOUNDING BOXES match — but a five-point star covers only ~16.5% of that box
// while a circle covers ~78.5% (π/4). Equal boxes with unequal ink is exactly
// what makes the stars read smaller than the circles: a star and a circle of
// the same bounding box do NOT look the same size, because the star has far
// less ink. This is the classic optical-vs-geometric sizing problem.
//
// THE SYSTEM. Each shape is registered as MEASURABLE GEOMETRY — a polygon's
// vertices or a circle's radius — not an opaque SVG path string. The ink area
// is computed from that geometry (the shoelace formula for polygons, πr² for
// circles), and the optical scale is √(TARGET / area): the scale that lands
// every glyph on the same ink, because scaling a 2-D shape by k multiplies its
// area by k². A future TCG that adds a new shape only registers its geometry
// here and inherits correct optical sizing without tuning any magic number —
// the scale is DERIVED from the shape's own geometry, never hand-entered.
//
// OUTLINES. A stroked outline (star-outline) carries less ink than its filled
// twin. Its ink is modelled as the STROKED BAND area — perimeter × stroke
// width — rather than the filled area, so a hollow mark scales UP to read the
// same weight as its solid twin. This is the "filled area × stroke coverage
// fraction" model (fraction = perimeter × strokeWidth / filledArea); computing
// the exact inset-star ring (outer polygon area minus inner polygon area) is
// impractical for a five-point star, so the standard round-joined-stroke band
// approximation is used instead. The shape's EXTENT includes the stroke (the
// outer edge of the band), since the stroke is the shape, not a decoration.
//
// TARGET_INK_AREA. The one tuned constant — the only judgement call in the
// system. It is the ink area every glyph is scaled to share. It is bounded
// ABOVE by the SPARSEST shape — the four-point sparkle (star-double-stroke),
// area 80, polygon extent 20 — whose scaled extent must stay ≤ 24:
//   20 × √(TARGET / 80) ≤ 24  ⟹  TARGET ≤ 576 × 80 / 20² = 115.2
// The sparkle also carries a 1px decorative white edge (strokeWidth 1, half of
// which extends past the polygon), making its rendered extent 21; with that,
//   21 × √(TARGET / 80) ≤ 24  ⟹  TARGET ≤ 576 × 80 / 21² ≈ 104.5
// 100 is chosen with margin below that ceiling, so the sparkle's tips (edge
// included) still clear the box at every render size. Lowering the target
// further would shrink the dense shapes (circle, diamond) more than needed;
// raising it past ~104.5 would clip the sparkle. This is the correct direction
// for icon design: the dense circle and diamond come DOWN to meet the sparse
// stars, rather than the stars growing out of the box.
// ─────────────────────────────────────────────────────────────────────────────

import type { RarityShape } from './rarity'

// A shape is described by geometry the code can MEASURE, not an opaque path.
// `polygon` is a closed polygon authored in the 24×24 box. `circle` is a disc.
// `outline` is a polygon drawn as a stroked ring (the stroke IS the shape);
// its ink is the band (perimeter × strokeWidth) and its extent grows by the
// stroke width. `none` is the no-mark case.
export type Shape =
  | { kind: 'polygon'; points: ReadonlyArray<readonly [number, number]> }
  | { kind: 'circle'; cx: number; cy: number; r: number }
  | { kind: 'outline'; points: ReadonlyArray<readonly [number, number]>; strokeWidth: number }
  | { kind: 'none' }

// Five-point star, outer radius 9, inner radius 3.6, pointing up — the vertices
// of RarityMark.tsx's STAR_D, in winding order (shoelace takes the absolute
// value, so winding direction does not matter).
const STAR_POINTS: ReadonlyArray<readonly [number, number]> = [
  [12, 3],
  [14.12, 9.09],
  [20.56, 9.22],
  [15.42, 13.11],
  [17.29, 19.28],
  [12, 15.6],
  [6.71, 19.28],
  [8.58, 13.11],
  [3.44, 9.22],
  [9.88, 9.09],
]

// Four-point sparkle (Mega Hyper Rare), the vertices of SPARKLE_D — visibly
// distinct from the five-point star and the sparsest shape in the set.
const SPARKLE_POINTS: ReadonlyArray<readonly [number, number]> = [
  [12, 2],
  [14, 10],
  [22, 12],
  [14, 14],
  [12, 22],
  [10, 14],
  [2, 12],
  [10, 10],
]

// The registry. Every RarityShape has an entry; the keys line up 1:1 with the
// `RarityShape` union in rarity.ts. `promo-star` and `wordmark` are star-based
// marks — their glyph slot is the five-point star, so they share the star's
// geometry (the reversed-out band on the promo star and the suffix word on the
// wordmark are rendered by the parent and do not change the glyph's optical
// size class). `none` is the no-mark case.
export const RARITY_SHAPES: Record<RarityShape, Shape> = {
  circle: { kind: 'circle', cx: 12, cy: 12, r: 9 },
  diamond: { kind: 'polygon', points: [[12, 3], [21, 12], [12, 21], [3, 12]] },
  star: { kind: 'polygon', points: STAR_POINTS },
  'star-outline': { kind: 'outline', points: STAR_POINTS, strokeWidth: 1.8 },
  'star-double-stroke': { kind: 'polygon', points: SPARKLE_POINTS },
  'promo-star': { kind: 'polygon', points: STAR_POINTS },
  wordmark: { kind: 'polygon', points: STAR_POINTS },
  none: { kind: 'none' },
}

// The ink area every glyph is scaled to share. See the header for how it is
// bounded by the four-point sparkle (the sparsest shape) and why 100 is chosen.
export const TARGET_INK_AREA = 100

// The gap between glyphs in a multi-glyph mark, as a fraction of the glyph
// (rendered) size. At most 0.12 so a row of stars reads as one cluster, not
// separate marks; tightened from the old 0.12 so multi-star marks sit closer.
export const GLYPH_GAP_RATIO = 0.08

// ── geometry maths (dependency-free) ──────────────────────────────────────

// Shoelace formula: 0.5 × |Σ (x_i × y_{i+1} − x_{i+1} × y_i)|. The absolute
// value makes the result independent of winding direction.
function polygonArea(points: ReadonlyArray<readonly [number, number]>): number {
  let sum = 0
  const n = points.length
  for (let i = 0; i < n; i++) {
    const [x1, y1] = points[i]
    const [x2, y2] = points[(i + 1) % n]
    sum += x1 * y2 - x2 * y1
  }
  return Math.abs(sum) / 2
}

function polygonExtent(points: ReadonlyArray<readonly [number, number]>): number {
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const [x, y] of points) {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  return Math.max(maxX - minX, maxY - minY)
}

function polygonPerimeter(points: ReadonlyArray<readonly [number, number]>): number {
  let sum = 0
  const n = points.length
  for (let i = 0; i < n; i++) {
    const [x1, y1] = points[i]
    const [x2, y2] = points[(i + 1) % n]
    sum += Math.hypot(x2 - x1, y2 - y1)
  }
  return sum
}

// ── public API ─────────────────────────────────────────────────────────────

/**
 * The ink area of a registered shape, computed from its geometry. Circles use
 * πr²; polygons use the shoelace formula; outlines use the stroked band
 * (perimeter × stroke width); `none` has no ink. Returns 0 for an unknown name.
 */
export function shapeInkArea(name: string): number {
  const shape = RARITY_SHAPES[name as RarityShape]
  if (!shape) return 0
  if (shape.kind === 'circle') return Math.PI * shape.r * shape.r
  if (shape.kind === 'polygon') return polygonArea(shape.points)
  if (shape.kind === 'outline') return polygonPerimeter(shape.points) * shape.strokeWidth
  return 0 // none
}

/**
 * The shape's largest dimension, unscaled (in the 24×24 authoring box). Circles
 * are the diameter; polygons are the larger of the x/y span; outlines add the
 * stroke width (the outer edge of the band). Returns 0 for an unknown name.
 */
export function shapeExtent(name: string): number {
  const shape = RARITY_SHAPES[name as RarityShape]
  if (!shape) return 0
  if (shape.kind === 'circle') return shape.r * 2
  if (shape.kind === 'polygon') return polygonExtent(shape.points)
  if (shape.kind === 'outline') return polygonExtent(shape.points) + shape.strokeWidth
  return 0 // none
}

/**
 * The scale that lands the glyph on TARGET_INK_AREA: √(TARGET / area). Scaling
 * a 2-D shape by k multiplies its area by k², so this is the exact factor that
 * equalises ink across every shape. Returns 0 for a shape with no ink (`none`).
 * The renderer filters `none` out before applying a scale, so the degenerate
 * value is never used — this guard only prevents division by zero.
 */
export function opticalScale(name: string): number {
  const ink = shapeInkArea(name)
  return ink > 0 ? Math.sqrt(TARGET_INK_AREA / ink) : 0
}
