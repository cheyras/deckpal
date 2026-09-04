// THE CANONICAL FRAME — the one spec that says what detection looks at.
//
// ── THE INVARIANT (owner ruling, 2026-09-04) ────────────────────────────────
//
//   "Standardize the photos/photo stream to take square photos, and have a
//    standardized reticule size within that square."
//
//   and, on why it must be enforced rather than merely intended: a display
//   change — the photo window's height, the card list growing, a phone rotating
//   — must NEVER change what detection sees.
//
// So the canonical frame is a PURE FUNCTION OF THE CAMERA STREAM: the centre
// square of the sensor image, resampled to one fixed resolution. Nothing about
// layout, CSS, the camera box, or the viewport is an input, and there is no code
// path by which it can become one. `__tests__/frame-invariant.test.ts` asserts
// both halves of that: the dimensions depend only on stream dimensions, and this
// module (plus preprocess) may not import anything from the UI layer.
//
// WHY THIS WAS NOT ALREADY TRUE. The previous pipeline letterboxed the whole
// non-square frame and derived the reticle from the rendered camera box, so a
// portrait stream in a landscape box produced a reticle whose gate covered 1.33x
// the visible height, and resizing the card list changed the aiming target. Two
// different failure reports traced back to that coupling. A square removes the
// class of bug rather than fixing an instance of it.
//
// ── WHAT IS UNIVERSAL AND WHAT IS PER-GAME ──────────────────────────────────
//
// Universal (this file): the square, its resolution, and the standardized
// TOP/BOTTOM MARGIN.
//
// Per-game (a parameter, defaulted to Pokémon): the CARD ASPECT. Different card
// games have different aspects, and this product will hold more of them. So the
// reticle's HEIGHT is universal — square minus the two margins — and its WIDTH
// is height x the game's aspect, centred. A new TCG supplies one number and
// changes nothing about the frame spec.

import { CARD_ASPECT_W_OVER_H, type Point, type Rect } from './geometry'
import type { Quad } from './contract'

/**
 * Bumped whenever the frame spec changes, so a recorded event can be read
 * against the pipeline that produced it.
 *
 *   1  letterboxed reticle crop      (phase 0b)
 *   2  letterboxed FULL frame        (INFERENCE_RECT, 2026-09-02)
 *   3  CANONICAL SQUARE              (this file, 2026-09-04)
 *
 * Version 3 changes what a quad's coordinates MEAN — they are canonical-square
 * pixels now, not stream pixels — so anything reading recorded quads must branch
 * on this. The phase-0b corpus is a version-2 dataset: still usable for offline
 * evaluation through `squareCrop`, but new collection is square-only.
 */
export const PIPELINE_VERSION = 3

/**
 * The canonical frame's side, in pixels.
 *
 * 416x416 = 173,056 px, just inside the ~172.8k working-pixel budget the
 * previous pipeline ran at, and 23% FEWER pixels than the 437x512 working frame
 * the 2026-09-04 e2e drive measured at 16.1 ms median detect (p90 18.1) — so
 * this is a reduction in work, not an increase. 416 is also a multiple of 32,
 * which keeps the resize to the model's 256 input on clean ratios.
 */
export const CANONICAL_SIZE = 416

/**
 * THE STANDARDIZED MARGIN: the fraction of the square left empty above AND below
 * the reticle. Universal across every card game — it is what makes the aiming
 * target feel the same everywhere, and it is the only vertical constant.
 *
 * Sized on the 19 hand-labelled cards of the phase-0b corpus, expressed as a
 * fraction of the centre square they sit in:
 *
 *   card height in square:  min 0.452   p10 0.496   median 0.667   p90 0.879
 *
 *   margin   reticle height   labelled cards it contains
 *    0.04         0.92                19/19
 *    0.06         0.88                18/19      <- shipped
 *    0.08         0.84                17/19
 *    0.10         0.80                16/19
 *    0.12         0.76                14/19
 *
 * 0.06 sits just above the p90 presentation (0.879) and still leaves a visible
 * band top and bottom, so the reticle reads as a target inside the frame rather
 * than as the frame's own edge. 0.04 buys the last card by erasing that band;
 * anything from 0.08 up starts refusing presentations the corpus says are
 * normal. The one card 0.06 does not contain (0.892 of the square) overfills the
 * reticle rather than missing it, which the tracker's 65% inside-fraction gate
 * tolerates by design.
 */
export const RETICLE_MARGIN_FRAC = 0.06

/** Today's only game. Threaded as a PARAMETER everywhere, never assumed. */
export const DEFAULT_CARD_ASPECT = CARD_ASPECT_W_OVER_H // 63:88 = 0.71591

/** The centre-square crop of a camera stream, in STREAM pixels. */
export interface SquareCrop {
  x: number
  y: number
  size: number
}

/**
 * The centre square of the stream. The ONLY place the sensor's aspect is
 * consulted, and it consults nothing else.
 */
export function squareCrop(streamW: number, streamH: number): SquareCrop {
  const size = Math.max(1, Math.min(streamW | 0, streamH | 0))
  return { x: Math.round((streamW - size) / 2), y: Math.round((streamH - size) / 2), size }
}

/**
 * The canonical frame's dimensions. A pure function of the stream's, and — since
 * the canonical frame is a fixed square — a constant for any valid stream. It
 * takes the stream dimensions anyway so that the DEPENDENCY is explicit and the
 * contract test has something to vary.
 */
export function canonicalFrame(streamW: number, streamH: number): { width: number; height: number } {
  if (!streamW || !streamH) return { width: 0, height: 0 }
  return { width: CANONICAL_SIZE, height: CANONICAL_SIZE }
}

/**
 * The reticle, in FRACTIONS of the canonical square.
 *
 * Height is the universal (square minus both margins); width follows from the
 * game's own aspect and is centred. Pokémon's 63:88 at a 0.06 margin gives a
 * 0.630 x 0.880 box.
 */
export function reticleForAspect(cardAspect: number = DEFAULT_CARD_ASPECT): Rect {
  const h = 1 - 2 * RETICLE_MARGIN_FRAC
  const w = h * cardAspect
  return { x: (1 - w) / 2, y: RETICLE_MARGIN_FRAC, w, h }
}

// ---------------------------------------------------------------------------
// coordinate mappings — canonical square <-> full-resolution stream
// ---------------------------------------------------------------------------
//
// Detection, tracking, the reticle and every recorded quad live in CANONICAL
// pixels (0..CANONICAL_SIZE). The capture warp reads the FULL-RESOLUTION square
// crop, because a hash wants every sensor pixel it can get. These two functions
// are the whole bridge, and `frame-invariant.test.ts` round-trips them exactly.

/** Scale factor taking one canonical pixel to one full-res crop pixel. */
export function canonicalToCropScale(crop: SquareCrop): number {
  return crop.size / CANONICAL_SIZE
}

/** A canonical-space point -> a point in the FULL-RES CROP's own coordinates
 *  (which is what `capture()` warps, since its retained buffer IS the crop). */
export function canonicalToCrop(p: Point, crop: SquareCrop): Point {
  const s = canonicalToCropScale(crop)
  return [p[0] * s, p[1] * s]
}

/** A canonical-space point -> ABSOLUTE stream coordinates. The crop offset is
 *  what distinguishes this from `canonicalToCrop`; telemetry and any future
 *  labeler that works against raw stream frames wants this one. */
export function canonicalToStream(p: Point, crop: SquareCrop): Point {
  const s = canonicalToCropScale(crop)
  return [crop.x + p[0] * s, crop.y + p[1] * s]
}

/** Inverse of `canonicalToStream`. */
export function streamToCanonical(p: Point, crop: SquareCrop): Point {
  const s = canonicalToCropScale(crop)
  return [(p[0] - crop.x) / s, (p[1] - crop.y) / s]
}

export function canonicalQuadToCrop(q: Quad, crop: SquareCrop): Quad {
  return [canonicalToCrop(q[0], crop), canonicalToCrop(q[1], crop), canonicalToCrop(q[2], crop), canonicalToCrop(q[3], crop)]
}

export function canonicalQuadToStream(q: Quad, crop: SquareCrop): Quad {
  return [
    canonicalToStream(q[0], crop),
    canonicalToStream(q[1], crop),
    canonicalToStream(q[2], crop),
    canonicalToStream(q[3], crop),
  ]
}

export function streamQuadToCanonical(q: Quad, crop: SquareCrop): Quad {
  return [
    streamToCanonical(q[0], crop),
    streamToCanonical(q[1], crop),
    streamToCanonical(q[2], crop),
    streamToCanonical(q[3], crop),
  ]
}

/** Model output (unit fractions of its square input) -> canonical pixels. The
 *  model sees a plain resize of the square, so a model fraction IS a canonical
 *  fraction — no letterbox padding to undo. */
export function modelPointsToCanonicalQuad(points: ArrayLike<number>): Quad | null {
  if (!points || points.length < 8) return null
  const out: Point[] = []
  for (let i = 0; i < 4; i++) {
    const x = points[i * 2] * CANONICAL_SIZE
    const y = points[i * 2 + 1] * CANONICAL_SIZE
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null
    out.push([x, y])
  }
  return [out[0], out[1], out[2], out[3]]
}
