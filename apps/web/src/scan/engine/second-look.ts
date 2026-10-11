// THE SECOND LOOK — when LC050's presence head doubts a frame, ask it again on a
// crop around the quad it returned anyway, and believe the more confident one.
//
// WHY THE PRESENCE HEAD NEEDS IT. LC050's `has_obj` is a GlobalAveragePool over
// the backbone's last stage, then one Gemm and a sigmoid (tools/quad-train
// README, read off the graph). It never sees the decoder. So every pixel of the
// input votes on "is there a card" with equal weight, and a scene full of other
// print and other rectangles out-votes a card that the CORNER head, which
// attends locally, has found perfectly well. Measured on WuheDPVq_Bo (a card held
// in front of shelves of boxed product), the phone aimed so the card is fully in
// the square, over the 101 frames whose quad was card-shaped:
//
//   model input                                         has_obj >= 0.80
//   the square, as the engine sees it                         32%
//   the card pasted on flat grey / white / dark          100% / 100% / 100%
//   the scene kept within 30% of the card, the rest blurred   94%
//   the scene kept within 60%, the rest blurred               80%
//   brightness x0.7 / x1.3, contrast x1.5, blur 2 px    no change (all <2%)
//
// The card, the hand holding it, the stack behind it and the subtitles touching
// it are fine; it is the FAR scene. Cropping around the first quad removes the
// far scene the same way the blur did: over all 147 frames of that video's
// capturable cards, 24.5% -> 58.5% of frames reach the acquire threshold
// (scale 1.3). A fixed centre crop of the square reached only 40.8%; on the
// unaimed square, where the card sits off-centre with an edge already out of
// view, a 70% or 60% centre crop cut away more of it (0.7% -> 0%).
//
// WHAT IS KEPT FROM WHICH LOOK. The crop's PRESENCE, the first look's QUAD. A
// tight input is LC050's known failure: it returns an interior rectangle (art
// window, text panel) instead of the card's edge — index.ts INFERENCE_RECT has
// the measurement. Replayed over the video bench (scripts/scan-bench/video),
// taking the crop's quad too fired captures on text panels and moved the
// capture onto worse frames: auto-ID on the aimed WuheDPVq_Bo went 13 -> 13.
// Keeping the full-frame quad and taking only the crop's verdict: 13 -> 20.
// Requiring the two looks to agree on the rectangle (IoU >= 0.5) cost nothing
// there and dropped one stray capture.
//
// WHAT IT COSTS. One more inference on every tick whose first has_obj is below
// acquire and whose first quad is centred in the reticle — 33-96% of ticks on
// the bench videos, 76% overall. The engine's options keep it OFF by default.
//
// PURE. Geometry and the merge rule only, in FRACTIONS of the square the model
// was shown — the same space LC050's `points` are in — so the engine, the video
// replay and the tests all run exactly this code.

import type { Quad } from './contract'
import { centroid, pointInRect, polyIoU, type Rect } from './geometry'

/** Crop side over the first quad's larger extent. The plateau on the bench:
 *  1.1 -> 57%, 1.2 -> 63%, 1.3 -> 59%, 1.4 -> 54%, 2.0 -> 27% of card frames at
 *  acquire; 1.3 keeps the most margin of the plateau (see INFERENCE_RECT on why
 *  margin matters to this model). */
export const DEFAULT_SECOND_LOOK_SCALE = 1.3

/** The smallest crop, as a fraction of the square. Below this the model would
 *  be upsampling a few dozen source pixels into its whole input. */
export const SECOND_LOOK_MIN_SIDE = 0.35

/** The two looks must find the same rectangle at least this well (polygon IoU)
 *  before the second one's verdict is believed. 0 disables the check. */
export const DEFAULT_SECOND_LOOK_AGREE_IOU = 0.5

export interface ModelAnswer {
  /** LC050 `points`: [x0,y0,..,x3,y3] as fractions of the input. */
  points: ArrayLike<number>
  hasObj: number
}

function quadOf(p: ArrayLike<number>): Quad | null {
  if (!p || p.length < 8) return null
  for (let i = 0; i < 8; i++) if (!Number.isFinite(p[i])) return null
  return [
    [p[0], p[1]],
    [p[2], p[3]],
    [p[4], p[5]],
    [p[6], p[7]],
  ]
}

/**
 * The square crop (fractions of the model's square) for a second inference,
 * centred on the first answer's corners, or null when those corners give
 * nothing to look at (fewer than 8 numbers, non-finite, zero extent).
 *
 * The crop is clamped INSIDE the square by sliding, never by shrinking or
 * padding: a pad is an artificial straight edge, exactly what a boundary model
 * likes (preprocess.ts PAD_VALUE).
 */
export function secondLookRect(
  points: ArrayLike<number>,
  scale = DEFAULT_SECOND_LOOK_SCALE,
  minSide = SECOND_LOOK_MIN_SIDE,
): Rect | null {
  const q = quadOf(points)
  if (!q) return null
  const xs = q.map((p) => p[0])
  const ys = q.map((p) => p[1])
  const extent = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))
  if (!(extent > 0)) return null
  const side = Math.min(1, Math.max(minSide, scale * extent))
  const [cx, cy] = centroid(q)
  const clamp = (v: number) => Math.min(1 - side, Math.max(0, v))
  return { x: clamp(cx - side / 2), y: clamp(cy - side / 2), w: side, h: side }
}

/**
 * Should this tick take a second look, and at what? Null unless the first
 * has_obj is below `acquire` (above it the gate opens anyway) and the first
 * quad's centroid lies in the reticle (`reticle` in fractions, as
 * EngineState.reticle) — a crop around a quad the tracker would drop
 * (tracker.passesReticle) cannot lead to a lock, so it is not worth the cost.
 */
export function secondLookCrop(
  first: ModelAnswer,
  opts: { acquire: number; reticle: Rect; scale?: number },
): Rect | null {
  if (!(first.hasObj < opts.acquire)) return null
  const q = quadOf(first.points)
  if (!q || !pointInRect(centroid(q), opts.reticle)) return null
  return secondLookRect(first.points, opts.scale ?? DEFAULT_SECOND_LOOK_SCALE)
}

/** The second inference's `points` (fractions of the CROP) as fractions of the
 *  square — the space every consumer of `points` expects. */
export function secondLookPointsToSquare(points: ArrayLike<number>, crop: Rect): number[] {
  const out: number[] = []
  for (let i = 0; i < 4; i++) {
    out.push(crop.x + points[i * 2] * crop.w, crop.y + points[i * 2 + 1] * crop.h)
  }
  return out
}

export interface SecondLookMergeOptions {
  /** Polygon IoU the two looks' quads must reach (default
   *  DEFAULT_SECOND_LOOK_AGREE_IOU); 0 disables the check. */
  agreeIoU?: number
  /** Keep the FIRST look's quad and take only the second's has_obj (default
   *  true — see the header for why). */
  keepFirstQuad?: boolean
}

/**
 * The tick's answer. The second look counts only when its presence head is
 * MORE sure than the first's (and, with `agreeIoU`, when it found the same
 * rectangle); ties, NaNs and disagreements keep the first answer untouched, so
 * the second look can only ever add acquisitions, never take one away.
 */
export function mergeSecondLook(
  first: ModelAnswer,
  second: ModelAnswer | null,
  crop: Rect | null,
  opts: SecondLookMergeOptions = {},
): { points: number[]; hasObj: number; used: boolean; iou: number | null } {
  const agreeIoU = opts.agreeIoU ?? DEFAULT_SECOND_LOOK_AGREE_IOU
  const keepFirstQuad = opts.keepFirstQuad ?? true
  const keep = (iou: number | null) => ({ points: Array.from(first.points), hasObj: first.hasObj, used: false, iou })
  if (!second || !crop || !Number.isFinite(second.hasObj) || second.hasObj <= first.hasObj) return keep(null)
  const mapped = secondLookPointsToSquare(second.points, crop)
  const qa = quadOf(first.points)
  const qb = quadOf(mapped)
  const iou = qa && qb ? polyIoU(qa, qb) : null
  if (agreeIoU > 0 && !(iou !== null && iou >= agreeIoU)) return keep(iou)
  return { points: keepFirstQuad ? Array.from(first.points) : mapped, hasObj: second.hasObj, used: true, iou }
}
