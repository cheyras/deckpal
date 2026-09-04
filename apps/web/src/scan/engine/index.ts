// createScanEngine — the whole pipeline, wired.
//
//   video frame
//     -> letterbox to 256 BGR/255                     (preprocess.ts)
//     -> LC050, WASM, in ORT's proxy worker           (model.ts)
//     -> hysteresis on the presence head              (gate.ts)
//     -> sub-pixel refinement at working resolution   (refine.ts)
//     -> tracking, capped smoothing, bounded coasting (tracker.ts)
//     -> EngineState to the UI                        (contract.ts)
//     -> on capture: the quad widened by CAPTURE_MARGIN, then a homography
//        from the FULL-RES frame to a 63:88 JPEG      (rectify.ts)
//
// TWO CLOCKS, DELIBERATELY. The rAF loop runs at display rate and does almost
// nothing; a DETECT TICK happens only when cadenceMs has elapsed AND the
// previous tick has finished. That is the harness's shouldDetect pattern
// (harness-v2.html:5442) and it is what "the engine stretches when slow"
// (contract.ts EngineOptions.cadenceMs) means in practice: the in-flight guard
// makes the cadence a FLOOR, never a queue. Without it a device that needs
// 200 ms per inference would accumulate an unbounded backlog of frames it has
// already fallen behind, and every quad it drew would describe the past.
//
// WHY THE DETECTOR RUNS AT ~8 Hz AND NOT AT 50. The device sustains 46-85
// inf/s (PHASE0-CLOSEOUT §1.2) — this engine deliberately spends almost none
// of it. A tracked, smoothed quad at 8 Hz looks the same as one at 50 Hz and
// leaves the phone cool, the preview at full frame rate, and the thermal
// roll-off (85 -> 46 inf/s over 20 minutes, §1.3) unspent. The headroom is the
// budget for the refiner, which is the accuracy layer.
//
// ON-MAIN-THREAD WORK, NAMED HONESTLY: drawImage + getImageData for the model
// input (256x256) and for the refiner (<=512 long side). Inference itself is
// off-thread in ORT's proxy worker. Reading video frames off the main thread
// would need MediaStreamTrackProcessor, which iOS Safari does not reliably
// support, so this is the same trade the endurance run made and measured.

import type {
  CaptureResult,
  CreateScanEngine,
  EngineOptions,
  EngineState,
  Quad,
  ScanEngine,
  TrackedQuad,
} from './contract'
import { createPresenceGate, DEFAULT_ACQUIRE, DEFAULT_HOLD } from './gate'
import {
  centroid,
  oppositeSideRatio,
  pointInRect,
  polyIoU,
  quadAspectRatio,
  type ImageDataLike,
  type Rect,
} from './geometry'
import {
  canonicalFrame,
  canonicalQuadToCrop,
  CANONICAL_SIZE,
  DEFAULT_CARD_ASPECT,
  modelPointsToCanonicalQuad,
  reticleForAspect,
  squareCrop,
  type SquareCrop,
} from './frame'
import { loadModel, type ModelSession } from './model'
import { computeLetterbox, rgbaToBGRPlanar, MODEL_SIZE, type LetterboxTransform } from './preprocess'
import { gradientField, quadMeanSaturation, refineQuadChecked } from './refine'
import { cardRectSize, CAPTURE_QUALITY, rectifyToJpeg } from './rectify'
import { createTracker } from './tracker'

/** Detect-tick floor. ~8 Hz: fast enough that a tracked quad reads as
 *  continuous, slow enough to leave the thermal budget alone. */
export const DEFAULT_CADENCE_MS = 120
/** Consecutive ticks a stable track must sit centred before it can be captured. */
export const DEFAULT_LOCK_TICKS = 3

/**
 * How far a locked candidate's short/long side ratio may sit from a card's own
 * 63:88 (0.7159), as a ratio either way. 0.15 admits 0.609..0.823.
 *
 * WHY A LOCK NEEDS AN ASPECT PRIOR AT ALL. LC050 is a document-corner model and
 * a cluttered table is full of documents: BLIND-VERIFICATION.md judged the
 * engine drawing a confident quad on 24 of 26 no-card frames, including "a
 * confident tight lock on the laptop" (F020). Nothing between the model and
 * `capture()` had ever asked whether the thing it found was CARD-SHAPED — the
 * presence head asks "is there an object", the reticle asks "is it aimed at",
 * and neither asks "is it 63:88".
 *
 * WHY IT IS DELIBERATELY LOOSE. A card at a raking angle is genuinely not 63:88
 * on screen — foreshortening compresses one axis — and the corpus's own tilted
 * frames are exactly the ones a tight prior would refuse.
 *
 * AND IT ONLY GATES THE LOCK. A quad failing it is still tracked and still
 * drawn: the user keeps seeing what the engine sees, the manual Capture button
 * still works on it, and only the AUTOMATIC fire is withheld. That is the same
 * failure direction gate.ts chose — refuse to act, never refuse to show.
 *
 * SIZED ON REAL PRODUCT CAPTURES, not on the corpus — and the difference
 * matters. An earlier pass tuned this to 0.15 against the phase-0b corpus. The
 * 2026-09-04 e2e drive then recorded 13 captures the SHIPPED product actually
 * made, hand-judged, and their short/long ratios say 0.15 was far too tight:
 *
 *   drive captures   short/long ratio
 *   6 GOOD           0.694 - 0.901
 *   2 PARTIAL        (both inside that range)
 *   5 BAD            0.348 - 0.532
 *
 * 0.15 admits only 0.609-0.823, which would have REFUSED three of the six good
 * captures — every one of them a card held at a modest tilt. 0.28 admits
 * 0.515-0.916: all 8 usable captures kept, 4 of the 5 bad ones refused on aspect
 * alone, and the fifth (0.532) taken by the straddle gate.
 *
 * WHY THE CORPUS MISLED. It is a version-2 dataset, framed for a 3:4 portrait
 * view. Replaying it through the canonical CENTRE SQUARE clips cards that sat
 * near the top or bottom of those frames, and a clipped card measures more
 * square than it is — which pushed a dozen corpus cards into the 0.83-0.94 band
 * and made a tight prior look cheap. On a device the user aims inside the square
 * they can see, so that clipping does not occur. Real captures win.
 *
 * The corpus sweep at this setting (mid-session gate, straddle gate on) is
 * 9/26 clutter locks against ~55/61 card locks, versus 14/26 and 60/61 with no
 * priors at all.
 */
export const DEFAULT_LOCK_ASPECT_TOL = 0.28

/**
 * Minimum opposite-side ratio for a lock — THE STRADDLE GATE. See
 * `isSingleCardShaped` for the sizing and geometry.oppositeSideRatio for what it
 * measures and why convexity cannot substitute for it.
 */
export const DEFAULT_LOCK_PARALLEL_MIN = 0.72

/**
 * Minimum mean colour saturation inside a locked quad — a WHITE-PAPER REJECTOR.
 *
 * ── WHAT IT ACTUALLY IS, NAMED HONESTLY ────────────────────────────────────
 *
 * It is NOT a card detector, and the measurements say so plainly. Over the
 * phase-0b corpus, run through the shipping pipeline, the two classes overlap
 * almost completely on this statistic:
 *
 *   corpus CARD frames      min 0.149  p10 0.227  median 0.375  max 0.730
 *   corpus NO-CARD frames   min 0.159  p10 0.162  median 0.302  max 0.571
 *
 * Household clutter is colourful, so saturation cannot separate a card from a
 * cereal box and this gate removes essentially no corpus clutter.
 *
 * What it does separate is PRINTED MAIL, and that is the specific regression it
 * exists for. The 2026-09-04 drive auto-captured a postal envelope twice, and
 * ink on white paper sits far below everything else measured:
 *
 *   drive MAIL (2)          0.108 - 0.112
 *   drive card captures(30) 0.356 - 0.499
 *   corpus cards (61)       0.149 and up
 *
 * 0.13 refuses both envelopes and keeps EVERY card in both datasets. The margins
 * are thin and symmetric — 0.018 above the mail, 0.019 below the least colourful
 * card (F069) — and that is the honest width of the gap, not a comfortable one.
 *
 * WHY NOT 0.16, WHICH LOOKED BETTER. It rejected one more corpus clutter frame,
 * but given the classes overlap that rejection is noise rather than signal, and
 * it cost a real card (F069 at 0.149). Buying a coin-flip with a card is the
 * wrong trade when the card is still drawn, still tracked, and one tap away from
 * a manual capture.
 *
 * Set to 0 to disable. See `refine.quadMeanSaturation` for the measurement.
 */
export const DEFAULT_LOCK_MIN_SATURATION = 0.13

/**
 * PIPELINE VERSION 2 CONSTANTS — kept only so the offline harness can replay the
 * phase-0b corpus, which was collected under the letterboxed full-frame spec.
 * The live pipeline is version 3 (frame.ts): a square canonical frame whose
 * working image is CANONICAL_SIZE and whose model input is a plain resize.
 * Nothing in the hot path reads these any more.
 */
export const REFINE_LONG_SIDE = 512

/**
 * VERSION 2. The rect INFERENCE ran on, as fractions of the frame — the whole
 * frame, with the reticle as a POST-filter. Superseded by the canonical square;
 * retained for the offline harness and for the reasoning below, which is still
 * why inference is not cropped to the reticle.
 *
 * It is the whole frame,
 * and the reticle is a POST-filter — which reverses the reticle-crop half of
 * DECISIONS.md 2026-09-02, on measurement.
 *
 * WHAT THE CROP WAS FOR. PHASE0-CLOSEOUT §3.4 item 2 credited the reticle crop
 * with deleting 6 of 14 failures by construction (4 multi-instance unions, 2
 * adjacent-object merges): a competing object outside the reticle cannot be
 * unioned into the quad if it is not in the model's input.
 *
 * WHAT IT ACTUALLY COST. LC050 is a zero-training DocAligner checkpoint, and
 * DocAligner is trained on documents photographed WITH MARGIN. The reticle is
 * 72% of frame width and the card is most of it, so cropping to the reticle
 * hands the model an input the card fills edge to edge — and it stops returning
 * the card's outer boundary and starts returning an interior rectangle: the
 * illustration window, or the text panel. Not a subtle bias, a different
 * rectangle. Measured over the 19 hand-labelled frames of phase 0b session 2
 * (__tests__/diag-run.ts), mean corner error in frame px and the predicted
 * quad's linear scale against ground truth:
 *
 *   inference input        median   p90    max   mean   scale   on-card <=12px
 *   reticle crop (was)      22.2   92.0   92.4   32.3   0.886       7/19
 *   reticle x1.15           13.8   97.3  103.0   25.7   0.928       8/19
 *   reticle x1.30           12.8   57.1   68.2   19.9   0.971       9/19
 *   FULL FRAME (is)         11.6   49.9   58.8   18.0   0.985      11/19
 *   full frame, stretched   9.1    73.6   74.5   19.7   0.964      13/19
 *
 * Monotone in the margin, and the shrink is the tell: a scale of 0.886 is the
 * model reporting a box ~11% too small on every axis, which is the interior
 * lock, which is the owner's "basically never gets the outer edge". It is also
 * why the captures came back corner-pin deformed: an art window is landscape, so
 * rectify.orderQuadForCard dutifully rotated it 90 degrees into portrait.
 *
 * The presence head agrees: has_obj >= the 0.80 acquire threshold on 67/87
 * frames full-frame versus 58/87 stretched — and the crop's apparent 70/87 is
 * worthless, because it is confidently reporting the wrong rectangle.
 *
 * THE TRADE, STATED PLAINLY. The crop deleted unions by construction; the
 * post-filter can only REJECT them. tracker.passesReticle requires the quad's
 * centroid inside the reticle and 65% of its area with it, and a quad that has
 * unioned in an object outside the reticle fails that by a wide margin — so the
 * safety is kept and the cost is recall: those frames now draw nothing for a
 * tick instead of drawing a wrong quad. That is the same failure direction
 * gate.ts already chose for a miss, and it is worth 14 px of mean corner error.
 *
 * Note the reticle is unchanged as the AIMING GUIDE: EngineState.reticle still
 * reports defaultReticle, the UI still draws it, and the user still lines the
 * card up with it. Only what the model is shown has changed.
 */
export const INFERENCE_RECT: Rect = { x: 0, y: 0, w: 1, h: 1 }

/** The transform the engine feeds the model for a frame of this size. Exported
 *  so the offline harness measures the SHIPPING decision instead of a copy. */
export function inferenceTransform(frameW: number, frameH: number): LetterboxTransform {
  return computeLetterbox(frameW, frameH, INFERENCE_RECT)
}

/** Is this quad's short/long ratio within `tol` of a card's 63:88?
 *  See DEFAULT_LOCK_ASPECT_TOL for why a LOCK needs this and a DRAW does not. */
export function isCardShaped(
  quad: Quad,
  tol: number = DEFAULT_LOCK_ASPECT_TOL,
  cardAspect: number = DEFAULT_CARD_ASPECT,
): boolean {
  if (!(tol > 0)) return true
  const r = quadAspectRatio(quad)
  if (!(r > 0)) return false
  return r >= cardAspect * (1 - tol) && r <= cardAspect * (1 + tol)
}

/**
 * THE STRADDLE GATE: refuse to auto-capture a quad whose opposite sides are too
 * unequal to be one card under perspective.
 *
 * 0.72 is the midpoint of the empty band the 2026-09-04 e2e drive measured
 * between usable captures (worst 0.784) and every straddle (best 0.659) — see
 * geometry.oppositeSideRatio.
 *
 * WHY NOT THE 0.85 THE E2E REPORT PROPOSED. That number came from `parLR`, which
 * is ONE of the two opposite-side pairs — sides 1-2 and 3-0 as the model happened
 * to emit the corners. On the drive's 13 captures that pair separated beautifully
 * (usable 0.882-0.995, straddles 0.506-0.659), but the separation is an artifact
 * of corner INDEXING, not a geometric property: the raw quad's winding comes from
 * the model, so "the second pair" is not reliably the left and right edges, and a
 * straddle across a horizontally-stacked pair of cards would skew the OTHER pair
 * and slip straight through. Measured on the same 13 captures, the top/bottom
 * pair alone does NOT separate the classes at all (usable from 0.784, straddles
 * up to 0.824).
 *
 * So the shipped metric is the WORSE of both pairs, which is orientation- and
 * index-independent, and the price is a narrower band: 0.659 to 0.784 rather than
 * 0.659 to 0.882. 0.72 sits in the middle of it, 0.061 above the worst straddle
 * and 0.064 below the worst usable capture. Still rejects 5/5 straddles and keeps
 * 8/8 usable captures; it is simply honest about having less headroom than a
 * metric that only worked because of how these particular quads were wound.
 *
 * Like the aspect prior this gates the LOCK only: a straddling quad is still
 * tracked, still drawn, and still capturable by hand. What it stops is the
 * product deciding by itself that two cards are one.
 */
export function isSingleCardShaped(quad: Quad, minRatio: number = DEFAULT_LOCK_PARALLEL_MIN): boolean {
  if (!(minRatio > 0)) return true
  return oppositeSideRatio(quad) >= minRatio
}

export interface LockPolicy {
  /**
   * Feed ONE detect tick's stable tracks plus the reticle in FRAME FRACTIONS.
   * Returns the capture candidate, or null.
   *
   * `saturationOf` supplies the card signature for a track when one has been
   * measured. It is optional and FAILS OPEN — a track with no measurement is
   * judged on geometry alone, because a missing signal must never be able to
   * stop the scanner working.
   */
  update(
    stable: readonly TrackedQuad[],
    reticle: Rect,
    frameW: number,
    frameH: number,
    saturationOf?: (trackId: number) => number | undefined,
  ): TrackedQuad | null
  reset(): void
}

/**
 * THE AUTO-CAPTURE POLICY, as a pure object so the offline harness measures the
 * SHIPPING decision rather than a re-implementation of it — the same reason
 * `inferenceTransform` is exported. `__tests__/clutter-lock.ts` drives this
 * exact function over the phase-0b corpus; if the policy below changes, that
 * measurement changes with it and cannot silently go stale.
 *
 * A track locks when, for `lockTicks` CONSECUTIVE ticks, it is stable, not
 * coasting, centred in the reticle, and card-shaped. Any tick that fails resets
 * the counter to zero: the dwell must be uninterrupted, because a thing that
 * flickers in and out of card-shape is precisely the clutter this exists to
 * refuse.
 */
export function createLockPolicy(
  opts: {
    lockTicks?: number
    lockAspectTol?: number
    lockParallelMin?: number
    cardAspect?: number
    minSaturation?: number
  } = {},
): LockPolicy {
  const lockTicks = opts.lockTicks ?? DEFAULT_LOCK_TICKS
  const tol = opts.lockAspectTol ?? DEFAULT_LOCK_ASPECT_TOL
  const parMin = opts.lockParallelMin ?? DEFAULT_LOCK_PARALLEL_MIN
  const aspect = opts.cardAspect ?? DEFAULT_CARD_ASPECT
  const minSat = opts.minSaturation ?? DEFAULT_LOCK_MIN_SATURATION
  const lockCounts = new Map<number, number>()
  return {
    update(stable, rect, frameW, frameH, saturationOf) {
      const px: Rect = { x: rect.x * frameW, y: rect.y * frameH, w: rect.w * frameW, h: rect.h * frameH }
      const alive = new Set<number>()
      let locked: TrackedQuad | null = null
      for (const t of stable) {
        alive.add(t.id)
        // FAILS OPEN: an unmeasured track is judged on geometry alone.
        const sat = saturationOf?.(t.id)
        const colourful = !(minSat > 0) || sat === undefined || sat >= minSat
        const centred =
          !t.coasting &&
          pointInRect(centroid(t.quad), px) &&
          isCardShaped(t.quad, tol, aspect) &&
          isSingleCardShaped(t.quad, parMin) &&
          colourful
        const n = centred ? (lockCounts.get(t.id) ?? 0) + 1 : 0
        lockCounts.set(t.id, n)
        // Oldest qualifying track wins, so two cards in the reticle resolve to
        // the one the user has been holding there — not to list order.
        if (n >= lockTicks && (!locked || t.age > locked.age)) locked = t
      }
      for (const id of [...lockCounts.keys()]) if (!alive.has(id)) lockCounts.delete(id)
      return locked
    },
    reset() {
      lockCounts.clear()
    },
  }
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

export const createScanEngine: CreateScanEngine = (opts: EngineOptions = {}): ScanEngine => {
  const cadenceMs = opts.cadenceMs ?? DEFAULT_CADENCE_MS
  const lockTicks = opts.lockTicks ?? DEFAULT_LOCK_TICKS
  const lockAspectTol = opts.lockAspectTol ?? DEFAULT_LOCK_ASPECT_TOL
  const lockParallelMin = opts.lockParallelMin ?? DEFAULT_LOCK_PARALLEL_MIN
  /** THE PER-GAME PARAMETER. Everything else in the frame spec is universal;
   *  this is the one number a new TCG supplies. */
  const cardAspect = opts.cardAspect ?? DEFAULT_CARD_ASPECT

  const gate = createPresenceGate(opts.acquire ?? DEFAULT_ACQUIRE, opts.hold ?? DEFAULT_HOLD)
  const tracker = createTracker()

  const listeners = new Set<(s: EngineState) => void>()

  let session: ModelSession | null = null
  let video: HTMLVideoElement | null = null
  let raf = 0
  let running = false
  let inFlight = false
  let lastDetectAt = 0
  let lastTickStart = 0
  let hz = 0
  let lastState: EngineState | null = null
  const lockPolicy = createLockPolicy({
    lockTicks,
    lockAspectTol,
    lockParallelMin,
    cardAspect,
    minSaturation: opts.minSaturation,
  })
  /** Latest card signature per track id — see DEFAULT_LOCK_MIN_SATURATION. */
  const saturations = new Map<number, number>()

  // Canvases are created once and resized in place — allocating a canvas per
  // tick is how you get a GC pause in the middle of a camera preview.
  let prep: HTMLCanvasElement | null = null
  let prepCtx: CanvasRenderingContext2D | null = null
  let work: HTMLCanvasElement | null = null
  let workCtx: CanvasRenderingContext2D | null = null

  /**
   * THE CAPTURE FRAME, DOUBLE-BUFFERED — the fix for capture-time incoherence.
   *
   * `capture()` used to call `drawImage(video)` itself, warping whatever the
   * camera showed AT CAPTURE TIME with a quad measured on a frame from an
   * earlier instant. Those instants are far apart: the tick reads its pixels
   * BEFORE the inference await, detect ticks are >=120 ms apart, and the UI then
   * needs a React state commit plus an effect before it calls capture(). The
   * phone moves in that window, so a quad that looked perfect on screen still
   * warped a card that was no longer there — background on one side, a clipped
   * edge on the other, and a perceptual hash taken over the difference.
   *
   * So the full-resolution frame is now grabbed at TICK START, back to back with
   * the model's own input and the refiner's working image (grabWork's comment
   * explains why those two are adjacent; this is the third read of the same
   * instant). Two buffers, because a tick that has STARTED but not yet emitted
   * must not overwrite the frame belonging to the state the UI is currently
   * acting on: the writer is swapped in only at emit, so `capRead` and
   * `lastState` always come from the same tick.
   *
   * Cost is one extra full-res canvas; `full`/`fullCtx` are gone, since nothing
   * reads the live video at capture time any more.
   */
  let capA: HTMLCanvasElement | null = null
  let capB: HTMLCanvasElement | null = null
  /** The buffer the NEXT tick draws into. */
  let capWrite: HTMLCanvasElement | null = null
  /** The buffer belonging to `lastState`; null until the first tick emits. */
  let capRead: HTMLCanvasElement | null = null

  /**
   * THE RETICLE, as fractions of the canonical square.
   *
   * A CONSTANT now, not a function of the frame or of anything the UI does. The
   * square is the same on every device, so the reticle inside it is too: a fixed
   * top/bottom margin (frame.RETICLE_MARGIN_FRAC, universal) with the width
   * following from this game's card aspect. Nothing here can be influenced by
   * the camera box's size — which is the whole point of the 2026-09-04 ruling.
   */
  const reticle: Rect = reticleForAspect(cardAspect)

  /**
   * The stream's centre-square crop for the CURRENT stream size, memoised.
   * `capture()` needs it to map canonical coordinates back to the full-res
   * buffer, and it is a pure function of the stream's own dimensions.
   */
  let crop: SquareCrop = { x: 0, y: 0, size: 0 }
  let cropForW = 0
  let cropForH = 0
  function cropFor(streamW: number, streamH: number): SquareCrop {
    if (streamW !== cropForW || streamH !== cropForH) {
      crop = squareCrop(streamW, streamH)
      cropForW = streamW
      cropForH = streamH
    }
    return crop
  }

  function prepContext(): CanvasRenderingContext2D | null {
    if (!prepCtx) {
      prep = makeCanvas(MODEL_SIZE, MODEL_SIZE)
      prepCtx = prep.getContext('2d', { willReadFrequently: true })
    }
    return prepCtx
  }

  /** The model's input: the stream's centre square, resized to MODEL_SIZE.
   *
   *  NO LETTERBOX. The old pipeline padded a non-square frame into a square
   *  tensor and then had to undo the padding to map points back; a square source
   *  makes that a plain resize, so a model fraction IS a canonical fraction and
   *  the inverse mapping disappears entirely (frame.modelPointsToCanonicalQuad).
   *  preprocess.ts keeps its letterbox utilities for the paths where a non-square
   *  input still exists — uploads — which now centre-square first. */
  function drawModelInput(ctx: CanvasRenderingContext2D, src: CanvasImageSource, c: SquareCrop): void {
    ctx.drawImage(src, c.x, c.y, c.size, c.size, 0, 0, MODEL_SIZE, MODEL_SIZE)
  }

  /** Grab the pixels the refiner will read: the inference rect at up to
   *  REFINE_LONG_SIDE. It is the SAME rect the model was shown, so every quad
   *  the model can return is inside these pixels — which was not true while
   *  inference was cropped to the reticle and the quad was not.
   *
   *  THIS RUNS BEFORE THE INFERENCE AWAIT, ON PURPOSE. The refiner must see
   *  the SAME frame the model saw. PHASE0-CLOSEOUT §2.0 measured what happens
   *  when two stages of one pipeline read the camera tens of milliseconds
   *  apart under hand motion: a median 1.5 px and p90 6.1 px disagreement,
   *  which is the entire size of the error the refiner exists to remove. So
   *  both reads happen back to back, and the ~17 ms inference sits after them
   *  rather than between them. */
  function grabWork(src: CanvasImageSource, c: SquareCrop): ImageDataLike | null {
    if (!workCtx || !work) {
      work = makeCanvas(CANONICAL_SIZE, CANONICAL_SIZE)
      workCtx = work.getContext('2d', { willReadFrequently: true })
    }
    if (!workCtx || !work) return null
    if (work.width !== CANONICAL_SIZE || work.height !== CANONICAL_SIZE) {
      work.width = CANONICAL_SIZE
      work.height = CANONICAL_SIZE
    }
    workCtx.drawImage(src, c.x, c.y, c.size, c.size, 0, 0, CANONICAL_SIZE, CANONICAL_SIZE)
    return workCtx.getImageData(0, 0, CANONICAL_SIZE, CANONICAL_SIZE)
  }

  /** Grab the FULL-RESOLUTION CENTRE SQUARE this tick is about to reason about,
   *  into the write buffer. Only a GPU blit here — the expensive `getImageData`
   *  is deferred to `capture()`, which usually never happens for a given tick.
   *
   *  The buffer holds the CROP, not the whole stream, so `capture()` warps in
   *  crop coordinates and the canonical->crop mapping is a single scale. */
  function grabCaptureFrame(src: CanvasImageSource, c: SquareCrop): void {
    if (!capA) capA = makeCanvas(c.size, c.size)
    if (!capB) capB = makeCanvas(c.size, c.size)
    if (!capWrite) capWrite = capA
    if (capWrite.width !== c.size || capWrite.height !== c.size) {
      capWrite.width = c.size
      capWrite.height = c.size
    }
    const ctx = capWrite.getContext('2d', { willReadFrequently: true })
    if (!ctx) return
    ctx.drawImage(src, c.x, c.y, c.size, c.size, 0, 0, c.size, c.size)
  }

  /** Publish the frame this tick grabbed, and point the writer at the other
   *  buffer. Called at emit, so `capRead` and `lastState` are always paired. */
  function commitCaptureFrame(): void {
    if (!capWrite) return
    capRead = capWrite
    capWrite = capWrite === capA ? capB : capA
  }

  /** Refine the model's quad against the working pixels. The working image IS
   *  the canonical frame, so there is no coordinate change at all here any more
   *  — quad in, quad out, both canonical. */
  function refine(img: ImageDataLike, quad: Quad): Quad | null {
    return refineQuadChecked(quad, gradientField(img))
  }

  function emit(state: EngineState) {
    lastState = state
    for (const cb of listeners) {
      try {
        cb(state)
      } catch {
        // A throwing subscriber must not kill the detect loop.
      }
    }
  }

  async function tick(v: HTMLVideoElement, now: number): Promise<void> {
    const ctx = prepContext()
    if (!ctx || !session) return

    // THE CANONICAL FRAME: the stream's centre square, at CANONICAL_SIZE. Note
    // what is NOT consulted here — no camera box, no viewport, no layout. See
    // frame.ts for the ruling this enforces.
    const c = cropFor(v.videoWidth, v.videoHeight)
    if (!c.size) return
    const rect = reticle

    // A plain resize of the square, not a letterbox.
    drawModelInput(ctx, v, c)
    const input = rgbaToBGRPlanar(ctx.getImageData(0, 0, MODEL_SIZE, MODEL_SIZE))
    // All THREE reads of the video happen here, back to back, before the
    // inference await: the model's input, the refiner's working image, and the
    // full-resolution square any capture of this tick will be warped from.
    const workImg = grabWork(v, c)
    grabCaptureFrame(v, c)

    const { points, hasObj } = await session.run(input)

    const quads: Quad[] = []
    /** This tick's card signature for the detected quad, if there was one. */
    let tickSaturation: number | null = null
    if (gate.update(hasObj)) {
      // A model fraction IS a canonical fraction — no letterbox padding to undo.
      const raw = modelPointsToCanonicalQuad(points)
      if (raw) {
        const q = (workImg && refine(workImg, raw)) ?? raw
        quads.push(q)
        // Measured on the working image, which IS the canonical frame — so the
        // quad needs no transform. Cheap: a 24x24 sample grid, not a full scan.
        if (workImg) tickSaturation = quadMeanSaturation(workImg, q)
      }
    }

    // The reticle gate works in canonical pixels; EngineState reports fractions.
    tracker.setReticle({
      x: rect.x * CANONICAL_SIZE,
      y: rect.y * CANONICAL_SIZE,
      w: rect.w * CANONICAL_SIZE,
      h: rect.h * CANONICAL_SIZE,
    })
    const { stable, pending, jitter } = tracker.update(quads)

    // Attach this tick's signature to whichever track the tracker associated the
    // detection with — by overlap, since the tracker owns the association and
    // does not report it. Values persist across coasting ticks (no new
    // measurement) and are dropped with the track.
    if (tickSaturation !== null && quads.length) {
      let best: TrackedQuad | null = null
      let bestIoU = 0.3
      for (const t of [...stable, ...pending]) {
        const iou = polyIoU(t.quad, quads[0])
        if (iou > bestIoU) {
          bestIoU = iou
          best = t
        }
      }
      if (best) saturations.set(best.id, tickSaturation)
    }
    const liveIds = new Set([...stable, ...pending].map((t) => t.id))
    for (const id of [...saturations.keys()]) if (!liveIds.has(id)) saturations.delete(id)

    const detectMs = performance.now() - now
    if (lastTickStart) {
      const dt = now - lastTickStart
      // EMA so a single slow tick does not make the readout jump.
      if (dt > 0) hz = hz ? hz * 0.8 + (1000 / dt) * 0.2 : 1000 / dt
    }
    lastTickStart = now

    // Publish this tick's frame and its state together — they are a pair, and
    // `capture()` relies on them being one.
    commitCaptureFrame()
    emit({
      // The CANONICAL frame, not the stream's. Every quad, the reticle and the
      // capture mapping are in these coordinates; `stream` records what they
      // came from so a consumer can map back (frame.canonicalQuadToStream).
      frame: canonicalFrame(v.videoWidth, v.videoHeight),
      stream: { width: v.videoWidth, height: v.videoHeight },
      reticle: { ...rect },
      hasObj,
      stable,
      pending,
      locked: lockPolicy.update(stable, rect, CANONICAL_SIZE, CANONICAL_SIZE, (id) => saturations.get(id)),
      perf: { detectMs, hz, jitterPx: jitter.displayedPx },
    })
  }

  function loop() {
    if (!running) return
    raf = requestAnimationFrame(loop)
    const v = video
    if (!v || inFlight) return
    const now = performance.now()
    if (now - lastDetectAt < cadenceMs) return
    if (!v.videoWidth || !v.videoHeight) return
    if (!session) return
    inFlight = true
    lastDetectAt = now
    tick(v, now)
      .catch(() => {
        // One bad tick (a detached buffer, a frame captured mid-teardown) must
        // not end the run; the next tick re-reads the video from scratch.
      })
      .finally(() => {
        inFlight = false
      })
  }

  return {
    async ready(): Promise<void> {
      session = await loadModel()
    },

    start(v: HTMLVideoElement): void {
      video = v
      if (running) return
      running = true
      lastDetectAt = 0
      lastTickStart = 0
      // start() before ready() is legitimate — the loop simply idles until the
      // session lands, so the UI can show the camera immediately.
      if (!session) void loadModel().then((s) => (session = s)).catch(() => {})
      raf = requestAnimationFrame(loop)
    },

    stop(): void {
      running = false
      if (raf) cancelAnimationFrame(raf)
      raf = 0
      video = null
      tracker.reset()
      gate.reset()
      lockPolicy.reset()
      hz = 0
      lastState = null
      // The retained frame belongs to a state that no longer exists; keeping it
      // would let a capture after a restart warp a stale scene.
      capRead = null
      capWrite = capA
    },

    onState(cb: (s: EngineState) => void): () => void {
      listeners.add(cb)
      return () => {
        listeners.delete(cb)
      }
    },

    async capture(trackId: number): Promise<CaptureResult> {
      const track =
        lastState?.stable.find((t) => t.id === trackId) ?? lastState?.pending.find((t) => t.id === trackId)
      if (!track) throw new Error(`scan engine: no track ${trackId}`)
      // THE FRAME THIS TRACK WAS MEASURED ON — not the live video. See the
      // capA/capB declaration for why reading the camera here was wrong: the
      // quad below describes an instant tens of milliseconds in the past, and
      // warping newer pixels with it puts the card's edge somewhere the
      // homography does not expect.
      const src = capRead
      if (!src || !src.width || !src.height) throw new Error('scan engine: no frame to capture')
      const srcCtx = src.getContext('2d', { willReadFrequently: true })
      if (!srcCtx) throw new Error('scan engine: no 2d context')
      const frame: ImageDataLike = srcCtx.getImageData(0, 0, src.width, src.height)
      // The retained buffer is the FULL-RESOLUTION centre square; the quad is in
      // canonical (416) coordinates. One scale factor bridges them, and the warp
      // then runs at sensor resolution rather than at detection resolution —
      // which is the whole reason the buffer is kept at full size.
      const toCrop = { x: 0, y: 0, size: src.width }
      // THE OBSERVATION, NOT THE DISPLAY POSE. `track.quad` is the tracker's EMA
      // — deliberately lagged, and a blend of several ticks, so it matches no
      // single frame. `track.raw` is what the detector actually measured on THIS
      // frame. A coasting track has no observation, and falls back to the
      // smoothed pose: that is the best available, and auto-capture never takes
      // this path because a coasting track cannot lock.
      const quad = track.raw ?? track.quad
      // rectifyToJpeg widens the quad by rectify.CAPTURE_MARGIN before warping:
      // the server trims background and cannot restore card. The quad REPORTED
      // back is the CANONICAL detection — the UI draws in canonical coordinates
      // and telemetry records what the engine claimed — while the WARP runs in
      // full-resolution crop coordinates.
      const out = cardRectSize(cardAspect)
      const blob = await rectifyToJpeg(
        frame,
        canonicalQuadToCrop(quad, toCrop),
        CAPTURE_QUALITY,
        out.width,
        out.height,
      )
      if (!blob) throw new Error('scan engine: quad could not be rectified')
      return { blob, quad, trackId }
    },
  }
}

export default createScanEngine
export * from './contract'
