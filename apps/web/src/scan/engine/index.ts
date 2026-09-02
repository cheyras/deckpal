// createScanEngine — the whole pipeline, wired.
//
//   video frame
//     -> reticle crop + letterbox to 256 BGR/255      (preprocess.ts)
//     -> LC050, WASM, in ORT's proxy worker           (model.ts)
//     -> hysteresis on the presence head              (gate.ts)
//     -> sub-pixel refinement at working resolution   (refine.ts)
//     -> tracking, capped smoothing, bounded coasting (tracker.ts)
//     -> EngineState to the UI                        (contract.ts)
//     -> on capture: homography from the FULL-RES frame to a 63:88 JPEG
//                                                     (rectify.ts)
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
import { centroid, defaultReticle, pointInRect, type ImageDataLike, type Rect } from './geometry'
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
/** Long side of the working image the refiner reads. The reticle crop is drawn
 *  into this, so on a 1280x960 stream one working pixel is ~1.5 frame px and
 *  the refiner's sub-pixel output is worth ~0.5 frame px — a real improvement
 *  on the model's measured 3-8 px. Refining on the 256 letterbox instead would
 *  quantise at ~3.8 frame px, i.e. the size of the error being fixed. */
export const REFINE_LONG_SIDE = 512

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

export const createScanEngine: CreateScanEngine = (opts: EngineOptions = {}): ScanEngine => {
  const cadenceMs = opts.cadenceMs ?? DEFAULT_CADENCE_MS
  const lockTicks = opts.lockTicks ?? DEFAULT_LOCK_TICKS

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
  const lockCounts = new Map<number, number>()

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

  function reticleFor(frameW: number, frameH: number): Rect {
    if (frameW !== reticleW || frameH !== reticleH) {
      reticle = defaultReticle(frameW, frameH)
      reticleW = frameW
      reticleH = frameH
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

  /** Grab the pixels the refiner will read: the reticle crop at up to
   *  REFINE_LONG_SIDE.
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

    const rect = reticleFor(frameW, frameH)
    const t = computeLetterbox(frameW, frameH, rect)
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
      locked: lockedOf(stable, rect, frameW, frameH),
      perf: { detectMs, hz, jitterPx: jitter.displayedPx },
    })
  }

  /** A stable, non-coasting track whose centroid has sat inside the reticle for
   *  lockTicks consecutive ticks. The centroid test is what stops a card the
   *  user has set down at the edge of the frame — still tracked, still
   *  stable — from being treated as an offer to scan. */
  function lockedOf(stable: TrackedQuad[], rect: Rect, frameW: number, frameH: number): TrackedQuad | null {
    const px: Rect = { x: rect.x * frameW, y: rect.y * frameH, w: rect.w * frameW, h: rect.h * frameH }
    const alive = new Set<number>()
    let locked: TrackedQuad | null = null
    for (const t of stable) {
      alive.add(t.id)
      const centred = !t.coasting && pointInRect(centroid(t.quad), px)
      const n = centred ? (lockCounts.get(t.id) ?? 0) + 1 : 0
      lockCounts.set(t.id, n)
      // Oldest qualifying track wins, so two cards in the reticle resolve to
      // the one the user has been holding there — not to list order.
      if (n >= lockTicks && (!locked || t.age > locked.age)) locked = t
    }
    for (const id of [...lockCounts.keys()]) if (!alive.has(id)) lockCounts.delete(id)
    return locked
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
      lockCounts.clear()
      hz = 0
      lastState = null
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
      const blob = await rectifyToJpeg(frame, track.quad)
      if (!blob) throw new Error('scan engine: quad could not be rectified')
      return { blob, quad: track.quad, trackId }
    },
  }
}

export default createScanEngine
export * from './contract'
