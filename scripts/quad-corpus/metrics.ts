// Scoring for the quad-corpus evaluator: the research's definitions, in code.
//
// Every definition here is quoted from the document that set the gate it feeds,
// so a number this module produces can be checked against the number it is
// compared with. Nothing in here touches pixels or a model; eval.ts does that
// through the shipping engine and hands this module quads.
//
//   ON-CARD        field-check.mjs (R5 §3, phase 0a §3, phase 0b §2.3): the best
//                  MEAN corner distance over all 8 orderings/reversals of the
//                  predicted quad is <= 14 px. R5 §4.1 is explicit that the 14 px
//                  is a DISPLAY tolerance on its 360x480 frames and must not be
//                  applied in some other resolution's native pixels, so here it
//                  is scaled to the canonical square by short side (the canonical
//                  square IS the frame the user now sees): 14 * 416/360.
//
//   INTERIOR LOCK  R5 §5 / flags-raw-r2/_analyse.py `classify`, the taxonomy the
//                  Phase 1 gate's own comparison number (fused 32.1%) came from:
//                  not perimeter, >= 90% of the quad inside the card, and
//                  <= 90% of the card's area (art-interior <= 55% plus
//                  partial-inset <= 90%). Containment is _analyse.py's 24x24
//                  sample grid over the quad's bounding box, reproduced exactly.
//
//   INTERIOR LOCK (phase 0)  phase0a/run_docaligner.py `classify`, which phase 0b
//                  also used for its 2.7%: not on-card, area < 70% of the card,
//                  and >= 85% of the quad's area inside it (exact polygon
//                  intersection). Reported beside the R5 one, never instead of it.
//
//   MISS           R5 §3.2 / PHASE0-CLOSEOUT §2.2: a card is present and no quad
//                  was emitted — here, the cold presence gate stayed shut.
//
//   FALSE QUAD     notes-fused.md / PHASE0-CLOSEOUT §2.2: a quad emitted on a
//                  frame with no card in it. The Phase 1 gate is stated on
//                  DISTRACTOR-ONLY frames (RECOMMENDATION §3 Phase 1).

import type { Quad } from '../../apps/web/src/scan/engine/contract'
import { CANONICAL_SIZE } from '../../apps/web/src/scan/engine/frame'
import { clipPoly, isConvexQuad, polyArea, polyIoU, type Point } from '../../apps/web/src/scan/engine/geometry'
import { cornerDeltas } from '../../apps/web/src/scan/engine/__tests__/offline-harness'

// ---------------------------------------------------------------------------
// thresholds
// ---------------------------------------------------------------------------

/** R5's frames were 360x480 and its 14 px was a display tolerance on them
 *  (R5 §4.1). The canonical square's side is the stream's SHORT side, so the
 *  equivalent tolerance scales by 416/360. */
export const R5_SHORT_SIDE = 360
/** Phase 0b scored 14 px natively on 480x640 frames; reported for continuity. */
export const P0B_SHORT_SIDE = 480

export const THRESHOLDS = {
  /** THE GATE: R5's 14 px, in canonical px (16.18). */
  t14: (14 * CANONICAL_SIZE) / R5_SHORT_SIDE,
  /** R5 / phase 0a's secondary 20 px cut, in canonical px (23.11). */
  t20: (20 * CANONICAL_SIZE) / R5_SHORT_SIDE,
  /** Phase 0b's 14 px at 480x640, in canonical px (12.13) — stricter. */
  t14p0b: (14 * CANONICAL_SIZE) / P0B_SHORT_SIDE,
} as const

/** The Phase 1 gates (RECOMMENDATION §3 Phase 1; DECISIONS 2026-09-02). */
export const GATES = {
  onCardMin: 0.8,
  interiorLockMax: 0.05,
  missMax: 0.15,
  falseQuadMax: 0.2,
} as const

/** Negative reasons that mean "no card in the frame at all" — the population
 *  the false-quad gate is stated on. The other reasons have a card in frame that
 *  a human declined to quad (blur, glare, occlusion, ...). */
export const DISTRACTOR_REASONS = new Set(['no_card', 'not_a_card', 'no_card(v1: mixed with not_a_card)'])

// ---------------------------------------------------------------------------
// geometry
// ---------------------------------------------------------------------------

/** _analyse.py `inside`: even-odd ray cast. */
function insidePoly(x: number, y: number, poly: readonly Point[]): boolean {
  let c = false
  const n = poly.length
  for (let i = 0; i < n; i++) {
    const [x1, y1] = poly[i]
    const [x2, y2] = poly[(i + 1) % n]
    if (y1 > y !== y2 > y && x < ((x2 - x1) * (y - y1)) / (y2 - y1 + 1e-12) + x1) c = !c
  }
  return c
}

/** _analyse.py `contained_frac`, verbatim: the fraction of `a`'s N x N
 *  bounding-box samples that are inside `a` and also inside `b`. */
export function containedFracGrid(a: readonly Point[], b: readonly Point[], N = 24): number {
  const xs = a.map((p) => p[0])
  const ys = a.map((p) => p[1])
  const x0 = Math.min(...xs)
  const x1 = Math.max(...xs)
  const y0 = Math.min(...ys)
  const y1 = Math.max(...ys)
  let inn = 0
  let tot = 0
  for (let i = 0; i < N; i++)
    for (let j = 0; j < N; j++) {
      const px = x0 + ((x1 - x0) * (i + 0.5)) / N
      const py = y0 + ((y1 - y0) * (j + 0.5)) / N
      if (insidePoly(px, py, a)) {
        tot++
        if (insidePoly(px, py, b)) inn++
      }
    }
  return tot ? inn / tot : 0
}

/** run_docaligner.py `geometry().containment`: area(q ∩ g) / area(q), exact.
 *  clipPoly needs a CONVEX clip polygon; a non-convex label (the harvest keeps
 *  a handful) falls back to the sample grid. */
export function containmentExact(q: Quad, g: Quad): number {
  const qa = polyArea(q)
  if (!(qa > 0)) return 0
  if (!isConvexQuad(g)) return containedFracGrid(q, g, 48)
  const inter = clipPoly(q, g)
  return inter.length >= 3 ? Math.min(1, polyArea(inter) / qa) : 0
}

// ---------------------------------------------------------------------------
// per-row scoring
// ---------------------------------------------------------------------------

export type PositiveClass = 'perimeter' | 'art-interior' | 'partial-inset' | 'partial-overhang' | 'off-object' | 'miss'

export interface QuadScore {
  /** Per-corner distance, canonical px, under the best of the 8 alignments. */
  cornerErr: number[]
  meanErr: number
  maxErr: number
  iou: number
  /** predicted area / label area. */
  areaRatio: number
  /** R5 grid containment of the prediction in the label. */
  containedR5: number
  /** Exact containment (phase 0 definition). */
  containedExact: number
  onCard: boolean
  onCard20: boolean
  onCardP0b: boolean
  /** All four corners within the gate tolerance — stricter than on-card. */
  allCornersWithin: boolean
  cls: PositiveClass
  interiorLock: boolean
  interiorLockP0: boolean
}

/** Score one predicted quad against one label, both in canonical px. */
export function scoreQuad(q: Quad, gt: Quad): QuadScore {
  const d = cornerDeltas(gt, q)
  const meanErr = d.reduce((a, b) => a + b, 0) / 4
  const maxErr = Math.max(...d)
  const ag = polyArea(gt)
  const aq = polyArea(q)
  const areaRatio = ag > 0 ? aq / ag : 0
  const containedR5 = containedFracGrid(q, gt)
  const containedExact = containmentExact(q, gt)
  const onCard = meanErr <= THRESHOLDS.t14
  // _analyse.py classify, line for line.
  let cls: PositiveClass
  if (onCard) cls = 'perimeter'
  else if (containedR5 >= 0.9 && areaRatio <= 0.55) cls = 'art-interior'
  else if (containedR5 >= 0.9 && areaRatio <= 0.9) cls = 'partial-inset'
  else if (containedR5 >= 0.55) cls = 'partial-overhang'
  else cls = 'off-object'
  return {
    cornerErr: d,
    meanErr,
    maxErr,
    iou: polyIoU(q, gt),
    areaRatio,
    containedR5,
    containedExact,
    onCard,
    onCard20: meanErr <= THRESHOLDS.t20,
    onCardP0b: meanErr <= THRESHOLDS.t14p0b,
    allCornersWithin: maxErr <= THRESHOLDS.t14,
    cls,
    interiorLock: cls === 'art-interior' || cls === 'partial-inset',
    // run_docaligner.py classify: on-card wins first, then area < 0.70 AND
    // containment >= 0.85.
    interiorLockP0: !onCard && areaRatio < 0.7 && containedExact >= 0.85,
  }
}

// ---------------------------------------------------------------------------
// aggregation
// ---------------------------------------------------------------------------

/** The per-row record eval.ts produces and this module aggregates. */
export interface RowResult {
  id: string
  verdict: string
  positive: boolean
  face: string
  reason: string | null
  source: string
  day: string
  fill: number | null
  fillBucket: string
  hasObj: number
  /** Presence gate open AND four finite corners: what the engine would draw. */
  emitted: boolean
  /** The shipped quad (refined ?? raw), canonical px — null when not emitted. */
  quad: Quad | null
  /** The same quad regardless of the presence gate (diagnostic). */
  ungatedQuad: Quad | null
  refined: boolean
  gt: Quad | null
  /** Scored when a label exists and a quad was emitted. */
  score: QuadScore | null
  /** Scored when a label exists, ignoring presence — separates the corner head
   *  from the presence head. */
  ungatedScore: QuadScore | null
  /** R5 class for positives (`miss` when nothing was emitted); for negatives
   *  `false-quad` or `silent`. */
  cls: string
  /** hasObj the labeler recorded in the browser at label time, when present. */
  labelHasObj: number | null
}

/** Fill buckets exactly as harvest.mjs `bucket` draws them. */
export function fillBucket(fill: number | null): string {
  if (fill == null) return 'n/a'
  const edges = [0.1, 0.25, 0.5, 0.75, 0.9]
  const labels = ['<10%', '10-25%', '25-50%', '50-75%', '75-90%', '>=90%']
  for (let i = 0; i < edges.length; i++) if (fill < edges[i]) return labels[i]
  return labels[labels.length - 1]
}
export const FILL_ORDER = ['<10%', '10-25%', '25-50%', '50-75%', '75-90%', '>=90%', 'n/a']
// TIGHT FRAMING IS MEASURED BY SIDE, NOT AREA. A 63:88 card upright in a square
// can never cover more than ~72% of its AREA, and the scanner reticle covers only
// ~61%, so an area cut at 75% was unreachable by any fully visible card (the
// 2026-10-04 audit reported "zero tight framings" for exactly that reason). The
// card bounding box long side as a share of the square side is what "the card
// fills the frame" means; the reticle spans 92% of it.
export const TIGHT_EXTENT = 0.8

/** The card bounding-box long side as a fraction of the square side (corners normalized to [0,1]). */
export function cardExtent(corners: readonly (readonly number[])[] | null | undefined): number | null {
  if (!corners || corners.length !== 4) return null
  const xs = corners.map((p) => p[0]!)
  const ys = corners.map((p) => p[1]!)
  return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))
}

export function isTight(corners: readonly (readonly number[])[] | null | undefined): boolean {
  return (cardExtent(corners) ?? 0) >= TIGHT_EXTENT
}

/** Wilson 95% interval — n is small enough everywhere that a bare rate lies. */
export function wilson(k: number, n: number): [number, number] {
  if (!n) return [NaN, NaN]
  const z = 1.96
  const p = k / n
  const den = 1 + (z * z) / n
  const c = (p + (z * z) / (2 * n)) / den
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / den
  return [Math.max(0, c - h), Math.min(1, c + h)]
}

export function quantile(xs: readonly number[], q: number): number {
  if (!xs.length) return NaN
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]
}

const mean = (xs: readonly number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN)

export interface Rate {
  k: number
  n: number
  rate: number
  ci: [number, number]
}
function rate(k: number, n: number): Rate {
  return { k, n, rate: n ? k / n : NaN, ci: wilson(k, n) }
}

export interface GroupStats {
  rows: number
  positives: number
  /** Positives with a label (on-card / interior-lock denominators). */
  scored: number
  negatives: number
  onCard: Rate
  onCard20: Rate
  onCardP0b: Rate
  allCornersWithin: Rate
  interiorLock: Rate
  interiorLockP0: Rate
  miss: Rate
  /** On-card ignoring the presence gate: the corner head alone. */
  onCardUngated: Rate
  classes: Record<string, number>
  /** Over emitted, labelled positives. */
  meanErr: { median: number; mean: number; p90: number }
  iou: { median: number; mean: number }
  areaRatio: { median: number; p10: number; p90: number }
  /** Over every negative. */
  falseQuad: Rate
  /** Over distractor-only negatives — the gate's population. */
  falseQuadDistractor: Rate
  falseQuadByReason: Record<string, Rate>
}

export function aggregate(rows: readonly RowResult[]): GroupStats {
  const pos = rows.filter((r) => r.positive)
  const scored = pos.filter((r) => r.gt)
  const neg = rows.filter((r) => !r.positive)
  const dis = neg.filter((r) => r.reason && DISTRACTOR_REASONS.has(r.reason))
  const hits = scored.filter((r) => r.score)
  const errs = hits.map((r) => r.score!.meanErr)
  const ious = hits.map((r) => r.score!.iou)
  const areas = hits.map((r) => r.score!.areaRatio)
  const classes: Record<string, number> = {}
  for (const r of scored) classes[r.cls] = (classes[r.cls] ?? 0) + 1
  const byReason: Record<string, Rate> = {}
  const reasons = [...new Set(neg.map((r) => r.reason ?? '(none)'))].sort()
  for (const re of reasons) {
    const sub = neg.filter((r) => (r.reason ?? '(none)') === re)
    byReason[re] = rate(sub.filter((r) => r.emitted).length, sub.length)
  }
  const count = (f: (r: RowResult) => boolean) => scored.filter(f).length
  return {
    rows: rows.length,
    positives: pos.length,
    scored: scored.length,
    negatives: neg.length,
    onCard: rate(count((r) => !!r.score?.onCard), scored.length),
    onCard20: rate(count((r) => !!r.score?.onCard20), scored.length),
    onCardP0b: rate(count((r) => !!r.score?.onCardP0b), scored.length),
    allCornersWithin: rate(count((r) => !!r.score?.allCornersWithin), scored.length),
    interiorLock: rate(count((r) => !!r.score?.interiorLock), scored.length),
    interiorLockP0: rate(count((r) => !!r.score?.interiorLockP0), scored.length),
    miss: rate(pos.filter((r) => !r.emitted).length, pos.length),
    onCardUngated: rate(count((r) => !!r.ungatedScore?.onCard), scored.length),
    classes,
    meanErr: { median: quantile(errs, 0.5), mean: mean(errs), p90: quantile(errs, 0.9) },
    iou: { median: quantile(ious, 0.5), mean: mean(ious) },
    areaRatio: { median: quantile(areas, 0.5), p10: quantile(areas, 0.1), p90: quantile(areas, 0.9) },
    falseQuad: rate(neg.filter((r) => r.emitted).length, neg.length),
    falseQuadDistractor: rate(dis.filter((r) => r.emitted).length, dis.length),
    falseQuadByReason: byReason,
  }
}

export interface GateResult {
  name: string
  target: string
  value: Rate
  pass: boolean | null
}

export function gates(s: GroupStats): GateResult[] {
  const g = (name: string, target: string, value: Rate, ok: (x: number) => boolean): GateResult => ({
    name,
    target,
    value,
    pass: value.n ? ok(value.rate) : null,
  })
  return [
    g(`on-card @14px (${THRESHOLDS.t14.toFixed(1)} canonical px)`, '>= 80%', s.onCard, (x) => x >= GATES.onCardMin),
    g('interior-lock rate (R5)', '<= 5%', s.interiorLock, (x) => x <= GATES.interiorLockMax),
    g('miss rate', '<= 15%', s.miss, (x) => x <= GATES.missMax),
    g('false-quad rate, distractor-only negatives', '<= 20%', s.falseQuadDistractor, (x) => x <= GATES.falseQuadMax),
  ]
}
