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
  CARD_ASPECT_W_OVER_H,
  centroid,
  pointInRect,
  quadAspectRatio,
  reticleWithin,
  visibleRect,
  type ImageDataLike,
  type Rect,
} from './geometry'
import { loadModel, type ModelSession } from './model'
import {
  computeLetterbox,
  drawLetterbox,
  modelPointsToQuad,
  rgbaToBGRPlanar,
  MODEL_SIZE,
  type LetterboxTransform,
} from './preprocess'
import { gradientField, refineQuadChecked } from './refine'
import { rectifyToJpeg } from './rectify'
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
 * SIZED BY THE SWEEP, mid-session gate (`clutter-lock.ts --gate open`), which is
 * the state the owner's failure happens in — a card was just scanned, so the
 * presence latch is open and stays open on anything over `hold`:
 *
 *   tol     admits          clutter locks   card locks
 *   0 (was)  everything        15/26           56/61
 *   0.10     0.644..0.787       2/26           48/61
 *   0.15     0.609..0.823       4/26           53/61   <- shipped
 *   0.20     0.573..0.859       6/26           53/61
 *   0.25     0.537..0.895       7/26           54/61
 *   0.28     0.515..0.916       9/26           55/61
 *
 * 0.15 DOMINATES 0.20 outright — same 53 card locks, two fewer clutter locks —
 * so anything looser than 0.15 is paying for nothing until 0.25. 0.10 buys two
 * more clutter rejections for five card locks, which is the wrong trade: the
 * quad is still drawn and the manual Capture button still fires, so a refused
 * auto-capture costs the user one tap, while a false one costs them a junk row
 * to hunt down in a feed of fourteen.
 */
export const DEFAULT_LOCK_ASPECT_TOL = 0.15
/** Long side of the working image the refiner reads. The reticle crop is drawn
 *  into this, so on a 1280x960 stream one working pixel is ~1.5 frame px and
 *  the refiner's sub-pixel output is worth ~0.5 frame px — a real improvement
 *  on the model's measured 3-8 px. Refining on the 256 letterbox instead would
 *  quantise at ~3.8 frame px, i.e. the size of the error being fixed. */
export const REFINE_LONG_SIDE = 512

/**
 * The rect INFERENCE runs on, as fractions of the frame. It is the whole frame,
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
export function isCardShaped(quad: Quad, tol: number = DEFAULT_LOCK_ASPECT_TOL): boolean {
  if (!(tol > 0)) return true
  const r = quadAspectRatio(quad)
  if (!(r > 0)) return false
  return r >= CARD_ASPECT_W_OVER_H * (1 - tol) && r <= CARD_ASPECT_W_OVER_H * (1 + tol)
}

export interface LockPolicy {
  /** Feed ONE detect tick's stable tracks plus the reticle in FRAME FRACTIONS.
   *  Returns the capture candidate, or null. */
  update(stable: readonly TrackedQuad[], reticle: Rect, frameW: number, frameH: number): TrackedQuad | null
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
export function createLockPolicy(opts: { lockTicks?: number; lockAspectTol?: number } = {}): LockPolicy {
  const lockTicks = opts.lockTicks ?? DEFAULT_LOCK_TICKS
  const tol = opts.lockAspectTol ?? DEFAULT_LOCK_ASPECT_TOL
  const lockCounts = new Map<number, number>()
  return {
    update(stable, rect, frameW, frameH) {
      const px: Rect = { x: rect.x * frameW, y: rect.y * frameH, w: rect.w * frameW, h: rect.h * frameH }
      const alive = new Set<number>()
      let locked: TrackedQuad | null = null
      for (const t of stable) {
        alive.add(t.id)
        const centred = !t.coasting && pointInRect(centroid(t.quad), px) && isCardShaped(t.quad, tol)
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
  const lockPolicy = createLockPolicy({ lockTicks, lockAspectTol })

  // Canvases are created once and resized in place — allocating a canvas per
  // tick is how you get a GC pause in the middle of a camera preview.
  let prep: HTMLCanvasElement | null = null
  let prepCtx: CanvasRenderingContext2D | null = null
  let work: HTMLCanvasElement | null = null
  let workCtx: CanvasRenderingContext2D | null = null
  let full: HTMLCanvasElement | null = null
  let fullCtx: CanvasRenderingContext2D | null = null

  let reticle: Rect = { x: 0.14, y: 0.04, w: 0.72, h: 0.92 }
  let reticleW = 0
  let reticleH = 0
  let reticleBoxW = 0
  let reticleBoxH = 0
  /** The camera box's CSS size, or null when the caller has not said. */
  let viewport: { width: number; height: number } | null = null

  /** The reticle, fitted inside the part of the frame `object-fit: cover`
   *  actually shows — see geometry.visibleRect for what this fixes. Memoised on
   *  (frame, box) because it is recomputed every detect tick. */
  function reticleFor(frameW: number, frameH: number): Rect {
    const bw = viewport?.width ?? 0
    const bh = viewport?.height ?? 0
    if (frameW !== reticleW || frameH !== reticleH || bw !== reticleBoxW || bh !== reticleBoxH) {
      reticle = reticleWithin(frameW, frameH, visibleRect(frameW, frameH, bw, bh))
      reticleW = frameW
      reticleH = frameH
      reticleBoxW = bw
      reticleBoxH = bh
    }
    return reticle
  }

  function prepContext(): CanvasRenderingContext2D | null {
    if (!prepCtx) {
      prep = makeCanvas(MODEL_SIZE, MODEL_SIZE)
      prepCtx = prep.getContext('2d', { willReadFrequently: true })
    }
    return prepCtx
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
  function grabWork(src: CanvasImageSource, t: LetterboxTransform): ImageDataLike | null {
    const { crop } = t
    const s = Math.min(1, REFINE_LONG_SIDE / Math.max(crop.w, crop.h))
    const rw = Math.max(16, Math.round(crop.w * s))
    const rh = Math.max(16, Math.round(crop.h * s))
    if (!workCtx || !work) {
      work = makeCanvas(rw, rh)
      workCtx = work.getContext('2d', { willReadFrequently: true })
    }
    if (!workCtx || !work) return null
    if (work.width !== rw || work.height !== rh) {
      work.width = rw
      work.height = rh
    }
    workCtx.drawImage(src, crop.x, crop.y, crop.w, crop.h, 0, 0, rw, rh)
    return workCtx.getImageData(0, 0, rw, rh)
  }

  /** Refine the model's quad against those pixels. Returns null when
   *  refinement produced a malformed quad — the caller then keeps the model's
   *  own output, which is the tracker's whole law. */
  function refine(img: ImageDataLike, quad: Quad, t: LetterboxTransform): Quad | null {
    const { crop } = t
    const sx = img.width / crop.w
    const sy = img.height / crop.h
    const F = gradientField(img)
    const local: Quad = [
      [(quad[0][0] - crop.x) * sx, (quad[0][1] - crop.y) * sy],
      [(quad[1][0] - crop.x) * sx, (quad[1][1] - crop.y) * sy],
      [(quad[2][0] - crop.x) * sx, (quad[2][1] - crop.y) * sy],
      [(quad[3][0] - crop.x) * sx, (quad[3][1] - crop.y) * sy],
    ]
    const r = refineQuadChecked(local, F)
    if (!r) return null
    return [
      [r[0][0] / sx + crop.x, r[0][1] / sy + crop.y],
      [r[1][0] / sx + crop.x, r[1][1] / sy + crop.y],
      [r[2][0] / sx + crop.x, r[2][1] / sy + crop.y],
      [r[3][0] / sx + crop.x, r[3][1] / sy + crop.y],
    ]
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
    const frameW = v.videoWidth
    const frameH = v.videoHeight
    const ctx = prepContext()
    if (!ctx || !session) return

    // The reticle is the aiming guide and the tracker's post-filter; the model
    // sees the whole frame. See INFERENCE_RECT for why those are two rects.
    const rect = reticleFor(frameW, frameH)
    const t = inferenceTransform(frameW, frameH)
    drawLetterbox(ctx, v, t)
    const input = rgbaToBGRPlanar(ctx.getImageData(0, 0, t.size, t.size))
    // Same frame, read now — see grabWork's comment.
    const workImg = grabWork(v, t)

    const { points, hasObj } = await session.run(input)

    const quads: Quad[] = []
    if (gate.update(hasObj)) {
      const raw = modelPointsToQuad(t, points)
      if (raw) quads.push((workImg && refine(workImg, raw, t)) ?? raw)
    }

    // The reticle gate works in frame pixels; EngineState reports fractions.
    tracker.setReticle({
      x: rect.x * frameW,
      y: rect.y * frameH,
      w: rect.w * frameW,
      h: rect.h * frameH,
    })
    const { stable, pending, jitter } = tracker.update(quads)

    const detectMs = performance.now() - now
    if (lastTickStart) {
      const dt = now - lastTickStart
      // EMA so a single slow tick does not make the readout jump.
      if (dt > 0) hz = hz ? hz * 0.8 + (1000 / dt) * 0.2 : 1000 / dt
    }
    lastTickStart = now

    emit({
      frame: { width: frameW, height: frameH },
      reticle: { ...rect },
      hasObj,
      stable,
      pending,
      locked: lockPolicy.update(stable, rect, frameW, frameH),
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
    },

    setViewport(box: { width: number; height: number } | null): void {
      viewport = box && box.width > 0 && box.height > 0 ? { width: box.width, height: box.height } : null
    },

    onState(cb: (s: EngineState) => void): () => void {
      listeners.add(cb)
      return () => {
        listeners.delete(cb)
      }
    },

    async capture(trackId: number): Promise<CaptureResult> {
      const v = video
      if (!v || !v.videoWidth || !v.videoHeight) throw new Error('scan engine: no live frame to capture')
      const track =
        lastState?.stable.find((t) => t.id === trackId) ?? lastState?.pending.find((t) => t.id === trackId)
      if (!track) throw new Error(`scan engine: no track ${trackId}`)
      // The CURRENT frame, at full sensor resolution — not the 512 working
      // image the detector saw. The quad is already in frame pixels.
      if (!fullCtx || !full) {
        full = makeCanvas(v.videoWidth, v.videoHeight)
        fullCtx = full.getContext('2d', { willReadFrequently: true })
      }
      if (!fullCtx || !full) throw new Error('scan engine: no 2d context')
      if (full.width !== v.videoWidth || full.height !== v.videoHeight) {
        full.width = v.videoWidth
        full.height = v.videoHeight
      }
      fullCtx.drawImage(v, 0, 0)
      const frame: ImageDataLike = fullCtx.getImageData(0, 0, full.width, full.height)
      // rectifyToJpeg widens the quad by rectify.CAPTURE_MARGIN before warping:
      // the server trims background and cannot restore card. The quad REPORTED
      // back is still the detection, not the widened capture rect — the UI draws
      // what the engine found, and telemetry records what it claimed.
      const blob = await rectifyToJpeg(frame, track.quad)
      if (!blob) throw new Error('scan engine: quad could not be rectified')
      return { blob, quad: track.quad, trackId }
    },
  }
}

export default createScanEngine
export * from './contract'
