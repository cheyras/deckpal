// Seeds the annotation editor's quad by running the REAL detector — once —
// against a frozen working frame.
//
// ── WHY THIS IS NOT `createScanEngine()` ANY MORE ───────────────────────────
//
// It used to be. `createScanEngine()` only runs against a live `<video>` in a
// continuous rAF loop, so the first build bridged the gap with
// `HTMLCanvasElement.captureStream()`: turn the frozen canonical canvas into a
// synthetic MediaStream, feed a hidden `<video>`, and let the engine `start()`
// against it as if it were a camera. It read well and it never once worked.
//
//   round 9   the engine never loaded in either harness environment; every row
//             saved `seededFrom: 'default'`.
//   round 9b  on the shipped bundle `await video.play()` on a canvas-backed
//             stream NEVER SETTLES — the editor hung on "Seeding from the
//             current detector…" forever, because every ceiling in this
//             function sat downstream of that await. Forcing `play()` to
//             resolve got as far as the detection race and STILL produced
//             nothing: `seededFrom: 'default'` on all three rows.
//   round 9c  the `play()` await was fenced with a 1.5 s race. The editor opens
//             (9.07 s) and the fallback is reachable — and the seed is still
//             `default`. The synthetic frame does not reach the engine inside
//             its 4 s window.
//
// THE DIAGNOSIS, PLAINLY: `captureStream()` on a canvas is a transport for a
// canvas that is being ANIMATED. Its frame-request model is driven by drawing —
// a canvas nobody paints to after the stream is created has, from the track's
// point of view, nothing to send, and `requestFrame()` only exists on the
// 0-fps variant. Feeding a STILL through it means asking a video pipeline to
// deliver a video that has one frame and then stops, and then asking a detector
// built around "a fresh frame every 120 ms" to notice. Two of the three engine
// stages downstream (the presence gate's hysteresis, the tracker's age) are
// explicitly about CHANGE OVER TIME, and a still frame has no time axis at all.
// The transport was wrong, and so was the destination.
//
// ── WHAT RUNS INSTEAD ───────────────────────────────────────────────────────
//
// The engine's own inference path, called directly, with nothing between the
// canvas and the model:
//
//     canonical canvas (CANONICAL_SIZE square, workingFrame.ts)
//       -> plain resize to MODEL_SIZE          engine/index.ts drawModelInput
//       -> rgbaToBGRPlanar                     engine/preprocess.ts, verbatim
//       -> session.run()                       engine/model.ts, the same cached
//                                              session /scan uses
//       -> hasObj >= DEFAULT_ACQUIRE           engine/gate.ts's own constant
//       -> modelPointsToCanonicalQuad          engine/frame.ts, verbatim
//       -> refineQuadChecked(gradientField())  engine/refine.ts, verbatim
//
// Line for line that is `createScanEngine`'s `tick()` with three things left
// out, and each omission is a statement about a still frame rather than a
// shortcut:
//
//   THE rAF LOOP AND ITS CADENCE — a scheduler for a stream of frames. One
//   frame needs no schedule.
//   THE PRESENCE GATE'S HYSTERESIS — a two-threshold LATCH whose whole value is
//   "what did the previous frame think" (gate.ts). There is no previous frame.
//   A cold gate is CLOSED, and a closed gate opens at exactly `acquire`, so
//   `hasObj >= DEFAULT_ACQUIRE` IS what the shipping gate does on frame one.
//   THE TRACKER AND THE LOCK POLICY — smoothing, coasting, and an
//   auto-capture dwell counted in consecutive ticks. All of them are about
//   persistence across ticks, and none of them changes the quad the detector
//   proposed. The labeler wants that raw proposal, which is also exactly what
//   `capture()` uses (`track.raw ?? track.quad`).
//
// The centre-square crop step is absent for a different reason: it already
// happened. `workingFrame.ts` built `canonical` with the SAME `squareCrop` +
// `CANONICAL_SIZE` the engine's own `cropFor`/`grabWork` use, so the frame
// handed in here is byte-for-byte the frame the engine would have produced from
// a stream of this photo. Model fractions are therefore canonical fractions
// with no letterbox to undo, exactly as `modelPointsToCanonicalQuad` documents.
//
// NOTHING ASYNC HERE HAS AN UNBOUNDED WORST CASE — the rule `scan/ui/
// deadline.ts` opens with, and the rule round 9b's hang broke. `loadModel()`
// and `run()` are both raced against SEED_BUDGET_MS.
import { loadModel } from '../engine/model'
import { CANONICAL_SIZE, PIPELINE_VERSION, modelPointsToCanonicalQuad, reticleForAspect } from '../engine/frame'
import { DEFAULT_ACQUIRE } from '../engine/gate'
import { rectPoly } from '../engine/geometry'
import { MODEL_SIZE, rgbaToBGRPlanar } from '../engine/preprocess'
import { gradientField, refineQuadChecked } from '../engine/refine'
import type { Quad } from '../engine/contract'
import { seedTopLeftIndex, type TopLeftIndex } from './orientation'
import type { QuadLabel, SeedFallback, SeededFrom } from './types'

/**
 * Ceiling on the WHOLE seed, model load included.
 *
 * Generous on purpose: the first seed of a session pays a cold ORT boot plus a
 * 4.9 MB model fetch (round 9b measured `InferenceSession.create` at 1.7 s on a
 * warm cache and ~3.5 s cold), and abandoning that would guarantee the fallback
 * on frame one of every session — the exact failure this file exists to end.
 * Every seed after it is a single ~20 ms inference against the cached session.
 * `QuadLabeler` also calls `warmSeed()` while the reader is still framing, so
 * in practice this budget is spent before the first shutter, not after it.
 */
export const SEED_BUDGET_MS = 15_000

/** A centred, card-aspect quad in canonical PIXEL space — the fallback when
 *  the detector finds nothing (or errors), so the editor never opens with an
 *  empty quad. Reuses the same `reticleForAspect` the visible reticle draws
 *  from, so an undetected card at least starts where the aiming guide says
 *  one belongs. */
export function fallbackQuad(): Quad {
  const r = reticleForAspect()
  return rectPoly({
    x: r.x * CANONICAL_SIZE,
    y: r.y * CANONICAL_SIZE,
    w: r.w * CANONICAL_SIZE,
    h: r.h * CANONICAL_SIZE,
  })
}

function normalize(quad: Quad): Quad {
  return quad.map(([x, y]) => [x / CANONICAL_SIZE, y / CANONICAL_SIZE]) as Quad
}

/** Resolves to `null` if `p` has not settled within `ms`. The losing promise is
 *  not cancelled — it cannot be — but nothing downstream reads it, and the
 *  cached `loadModel()` promise it usually is will simply be there next time. */
function within<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>((r) => window.setTimeout(() => r(null), ms))])
}

export interface SeedResult {
  /** Normalized [0,1] fractions of the canonical square. */
  corners: Quad
  /**
   * PRE-ASSIGNED ORIENTATION — which of `corners` the geometric rule thinks is
   * the card's top-left, so the reader usually only confirms. Deliberately the
   * SAME rule production runs (`orderQuadForCard` rule 3, reproduced in
   * orientation.ts): the reader is then contradicting production when they
   * move it, which is exactly the signal worth recording.
   */
  topLeftIndex: TopLeftIndex
  seededFrom: SeededFrom
  pipeline: QuadLabel['pipeline']
}

function seeded(corners: Quad, seededFrom: SeededFrom, pipeline: QuadLabel['pipeline']): SeedResult {
  return { corners, topLeftIndex: seedTopLeftIndex(corners), seededFrom, pipeline }
}

/**
 * Start the model loading WITHOUT needing a frame. `loadModel()` is cached and
 * idempotent, so calling this while the reader is still framing the shot moves
 * the one genuinely slow part of the first seed off the critical path — round
 * 9c's 9.07 s first frame was mostly this, paid after the shutter instead of
 * before it. Fire and forget: a failure here changes nothing, because
 * `seedQuad` calls `loadModel()` again and handles the rejection itself.
 */
export function warmSeed(): void {
  void loadModel().catch(() => {})
}

/** Draw the canonical square into the model's own square input and read it back
 *  as the planar BGR tensor LC050 wants. This is `drawModelInput` +
 *  `rgbaToBGRPlanar` from `engine/index.ts`'s tick, with the crop step already
 *  done: `canonical` IS the centre square. */
function modelInputFrom(canonical: HTMLCanvasElement): Float32Array | null {
  const prep = document.createElement('canvas')
  prep.width = MODEL_SIZE
  prep.height = MODEL_SIZE
  const ctx = prep.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(canonical, 0, 0, canonical.width, canonical.height, 0, 0, MODEL_SIZE, MODEL_SIZE)
  return rgbaToBGRPlanar(ctx.getImageData(0, 0, MODEL_SIZE, MODEL_SIZE))
}

/** The refiner's working image: the canonical frame's own pixels. The engine
 *  calls this `grabWork` and feeds the identical thing — its working image IS
 *  the canonical frame, so there is no coordinate change here either. */
function workingPixels(canonical: HTMLCanvasElement): ImageData | null {
  const ctx = canonical.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  try {
    return ctx.getImageData(0, 0, canonical.width, canonical.height)
  } catch {
    // A tainted canvas (a cross-origin source that never should have reached
    // here) throws rather than returning garbage. Refinement is optional; the
    // model's own quad is still good.
    return null
  }
}

/**
 * Run the shipping detector once against `canonical` and resolve a seed quad —
 * the detector's own proposal for this frame, or the centred fallback if it
 * finds nothing, cannot load, or runs out of budget.
 *
 * The fallback is never removed, only made rare: an unseeded editor is still a
 * usable editor, and a labeler that refuses to open because a model fetch
 * failed would cost the reader their whole session.
 */
export async function seedQuad(canonical: HTMLCanvasElement): Promise<SeedResult> {
  const t0 = performance.now()
  const base: QuadLabel['pipeline'] = {
    pipelineVersion: PIPELINE_VERSION,
    canonicalSize: CANONICAL_SIZE,
    model: 'lc050',
    seedAcquireThreshold: DEFAULT_ACQUIRE,
  }
  const fell = (why: SeedFallback, pipeline: QuadLabel['pipeline']): SeedResult =>
    seeded(normalize(fallbackQuad()), 'default', {
      ...pipeline,
      seedFallback: why,
      seedMs: Math.round(performance.now() - t0),
    })

  try {
    const session = await within(loadModel(), SEED_BUDGET_MS)
    // WHY THE FALLBACK REASON IS RECORDED AND NOT JUST THE FALLBACK. A
    // `seededFrom: 'default'` row means two completely different things: "the
    // model said there is no card here", which is real signal about a real
    // frame, and "the model never ran on this device", which is a note about
    // the rig. Round 9's corpus cannot tell those apart. Every row from this
    // build can.
    if (!session) return fell('unavailable', base)

    const pipeline: QuadLabel['pipeline'] = {
      ...base,
      modelLoadMs: session.info.loadMs,
      modelNumThreads: session.info.numThreads,
      modelProxy: session.info.proxy,
      modelCrossOriginIsolated: session.info.crossOriginIsolated,
    }

    const input = modelInputFrom(canonical)
    if (!input) return fell('unavailable', pipeline)

    const spent = performance.now() - t0
    const result = await within(session.run(input), Math.max(1_000, SEED_BUDGET_MS - spent))
    if (!result) return fell('unavailable', pipeline)

    const withObj: QuadLabel['pipeline'] = { ...pipeline, hasObj: result.hasObj }
    // The cold gate's own rule, not a re-tuned one. See the header.
    if (!(result.hasObj >= DEFAULT_ACQUIRE)) return fell('no_object', withObj)

    const raw = modelPointsToCanonicalQuad(result.points)
    if (!raw) return fell('no_quad', withObj)

    // Refinement FAILS OPEN, exactly as the engine's does: `refineQuadChecked`
    // returns null when it produced something that is not a simple convex quad,
    // and the caller must then use the model's own (already convex) output
    // rather than the wreckage.
    const work = workingPixels(canonical)
    const quad = (work && refineQuadChecked(raw, gradientField(work))) ?? raw

    return seeded(normalize(quad), 'detector', {
      ...withObj,
      seedMs: Math.round(performance.now() - t0),
    })
  } catch {
    return fell('unavailable', base)
  }
}
