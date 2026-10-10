// The engine's detect tick and Scan.tsx's auto-capture policy, driven by a clock
// we control instead of rAF and React.
//
// WHAT IS SHIPPING CODE AND WHAT IS A MIRROR. Every DECISION below is made by an
// imported production object, never a copy of its rules:
//
//   presence gate        engine/gate.ts        createPresenceGate
//   refinement           engine/refine.ts      gradientField + refineQuadChecked
//   card signature       engine/refine.ts      quadMeanSaturation
//   tracker              engine/tracker.ts     createTracker
//   lock                 engine/index.ts       createLockPolicy
//   reticle              engine/frame.ts       reticleForAspect
//   duplicate regions    scan/ui/regions.ts    createCapturedRegions
//   rectification        engine/rectify.ts     expandQuad + rectifyImageData
//
// What IS mirrored is only the GLUE that wires them, because that glue lives
// inside a closure over canvases (index.ts createScanEngine) and inside a React
// effect (Scan.tsx) that node cannot run. Each mirrored block cites the lines it
// reproduces, so a change there is a diff someone can check here.

import type { Quad, TrackedQuad } from '../../../apps/web/src/scan/engine/contract'
import { createPresenceGate, DEFAULT_ACQUIRE, DEFAULT_HOLD } from '../../../apps/web/src/scan/engine/gate'
import {
  centroid,
  insideFraction,
  isConvexQuad,
  isFiniteQuad,
  meanCornerDelta,
  oppositeSideRatio,
  pointInRect,
  polyArea,
  polyIoU,
  quadAspectRatio,
  type ImageDataLike,
  type Rect,
} from '../../../apps/web/src/scan/engine/geometry'
import {
  CANONICAL_SIZE,
  canonicalQuadToCrop,
  DEFAULT_CARD_ASPECT,
  modelPointsToCanonicalQuad,
  reticleForAspect,
} from '../../../apps/web/src/scan/engine/frame'
import {
  createLockPolicy,
  DEFAULT_LOCK_MIN_SATURATION,
  isCardShaped,
  isSingleCardShaped,
} from '../../../apps/web/src/scan/engine/index'
import { gradientField, quadMeanSaturation, refineQuadChecked } from '../../../apps/web/src/scan/engine/refine'
import {
  CAPTURE_MARGIN,
  cardRectSize,
  expandQuad,
  rectifyImageData,
  type RectifiedImage,
} from '../../../apps/web/src/scan/engine/rectify'
import { createTracker, TRACKER_DEFAULTS } from '../../../apps/web/src/scan/engine/tracker'
import { createCapturedRegions } from '../../../apps/web/src/scan/ui/regions'
import { captureLook, cardLook, type CardLook } from '../../../apps/web/src/scan/engine/look'
import { createLookRearm } from '../../../apps/web/src/scan/ui/rearm'

// ---------------------------------------------------------------------------
// the detect tick (index.ts createScanEngine -> tick, lines 619-736)
// ---------------------------------------------------------------------------

export interface TickState {
  hasObj: number
  gateOpen: boolean
  /** The presence-gated, refined quad the tracker was offered (EngineState.observed[0]). */
  observed: Quad | null
  /** The model's own quad regardless of the gate (EngineState.ungated). */
  ungated: Quad | null
  /** This tick's signature for `observed`, if it was measured. */
  tickSaturation: number | null
  stable: TrackedQuad[]
  pending: TrackedQuad[]
  locked: TrackedQuad | null
  /** EngineState.saturation: the signature of the lock, else the oldest stable track. */
  saturation: number | null
  saturationOf: (id: number) => number | undefined
  /** EngineState.look: index.ts's cardLook of the lock on the working image. */
  look: CardLook | null
}

export interface ReplayEngine {
  /** One detect tick: the model's raw output for this frame plus the refiner's
   *  working image (the canonical square at CANONICAL_SIZE). */
  tick(points: readonly number[], hasObj: number, work: ImageDataLike): TickState
  readonly reticle: Rect
}

export function createReplayEngine(opts: { lockTicks?: number } = {}): ReplayEngine {
  // index.ts:433-461 — every option at its default, as Scan.tsx constructs it
  // (useScanEngine passes no overrides). `lockTicks` is an EXPERIMENT knob;
  // unset, it is the shipping DEFAULT_LOCK_TICKS.
  const gate = createPresenceGate(DEFAULT_ACQUIRE, DEFAULT_HOLD)
  const tracker = createTracker()
  const lockPolicy = createLockPolicy({ lockTicks: opts.lockTicks })
  const saturations = new Map<number, number>()
  // index.ts:509 — a constant of the canonical square.
  const reticle: Rect = reticleForAspect(DEFAULT_CARD_ASPECT)

  return {
    reticle,
    tick(points, hasObj, work) {
      const quads: Quad[] = []
      let tickSaturation: number | null = null
      // index.ts:649-660 — decode once, gate, refine against the working image
      // (which IS the canonical frame), measure the signature on the refined quad.
      const decoded = modelPointsToCanonicalQuad(points)
      const gateOpen = gate.update(hasObj)
      if (gateOpen) {
        const raw = decoded
        if (raw) {
          const q = refineQuadChecked(raw, gradientField(work)) ?? raw
          quads.push(q)
          tickSaturation = quadMeanSaturation(work, q)
        }
      }
      // index.ts:663-669 — the reticle gate in canonical pixels.
      tracker.setReticle({
        x: reticle.x * CANONICAL_SIZE,
        y: reticle.y * CANONICAL_SIZE,
        w: reticle.w * CANONICAL_SIZE,
        h: reticle.h * CANONICAL_SIZE,
      })
      const { stable, pending } = tracker.update(quads)
      // index.ts:675-688 — attach the signature to the track the detection
      // associated with, by overlap; drop signatures of dead tracks.
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
      // index.ts:698-700
      const saturationOf = (id: number) => saturations.get(id)
      const locked = lockPolicy.update(stable, reticle, CANONICAL_SIZE, CANONICAL_SIZE, saturationOf)
      // index.ts:706-712 — focusTrack()
      let focus: TrackedQuad | null = locked
      if (!focus) for (const t of stable) if (!focus || t.age > focus.age) focus = t
      return {
        hasObj,
        gateOpen,
        observed: quads[0] ?? null,
        ungated: decoded,
        tickSaturation,
        stable,
        pending,
        locked,
        saturation: focus ? (saturations.get(focus.id) ?? null) : null,
        saturationOf,
        // index.ts — the lock's look, on the observation, off the working image.
        look: locked ? cardLook(work, locked.raw ?? locked.quad) : null,
      }
    },
  }
}

/**
 * Why the tick's observed quad did NOT reach the tracker — tracker.ts's own
 * input filter (lines 188-193: finite, positive area, convex, centroid inside
 * the reticle, >= minInsideFrac of its area inside it), decomposed the same way.
 * A card that fills more than the reticle shows up here as `inside 0.5x`.
 */
export function reticleBlockers(q: Quad, reticle: Rect): string[] {
  const N = CANONICAL_SIZE
  const px: Rect = { x: reticle.x * N, y: reticle.y * N, w: reticle.w * N, h: reticle.h * N }
  if (!isFiniteQuad(q) || !(polyArea(q) > 0)) return ['malformed']
  if (!isConvexQuad(q)) return ['non-convex']
  const why: string[] = []
  if (!pointInRect(centroid(q), px)) why.push('off-centre')
  const inside = insideFraction(q, px)
  if (inside < TRACKER_DEFAULTS.minInsideFrac) why.push(`inside ${inside.toFixed(2)}`)
  return why
}

/**
 * Why a stable track is NOT lock-eligible this tick — the lock policy's own
 * predicate (index.ts:395-401), decomposed so a card that never captured can be
 * attributed to a rule. Diagnostic only; the decision itself is made above by
 * createLockPolicy.
 */
export function lockBlockers(t: TrackedQuad, reticle: Rect, sat: number | undefined): string[] {
  const N = CANONICAL_SIZE
  const px: Rect = { x: reticle.x * N, y: reticle.y * N, w: reticle.w * N, h: reticle.h * N }
  const why: string[] = []
  if (t.coasting) why.push('coasting')
  if (!pointInRect(centroid(t.quad), px)) why.push('off-centre')
  if (!isCardShaped(t.quad)) why.push(`aspect ${quadAspectRatio(t.quad).toFixed(2)}`)
  if (!isSingleCardShaped(t.quad)) why.push(`straddle ${oppositeSideRatio(t.quad).toFixed(2)}`)
  if (DEFAULT_LOCK_MIN_SATURATION > 0 && sat !== undefined && sat < DEFAULT_LOCK_MIN_SATURATION) {
    why.push(`sat ${sat.toFixed(3)}`)
  }
  return why
}

// ---------------------------------------------------------------------------
// the auto-capture policy (Scan.tsx useEffect, lines 1237-1306; runCapture, 1197-1232)
// ---------------------------------------------------------------------------

/**
 * How long `captureBusyRef` stays true after a capture fires — the one piece of
 * the policy that is browser TIMING rather than logic, so it is a parameter.
 *
 * runCapture (Scan.tsx:1197) holds the flag across `capture()` (one full-res
 * getImageData + the 480x670 warp + a JPEG encode) and `handleCaptured` up to
 * `markArrived()` (Scan.tsx:1192): `nextFrame()`, the fly-to-stack courier
 * (motion.ts DURATION.flyStack = 300 ms) and the bump (DURATION.settle = 90 ms).
 * Identify, OCR and the embed are detached from it (Scan.tsx:991-1006), so they
 * do not count. ~80 ms of capture work + one frame + 300 + 90 ≈ 500 ms.
 */
export const DEFAULT_CAPTURE_BUSY_MS = 500

export type LockOutcome =
  | { kind: 'none' }
  /** A lock on a track this session already captured — Scan.tsx's per-track
   *  refractory. The same presentation continuing, not a duplicate. */
  | { kind: 'refractory' }
  /** A lock that arrived while a previous capture's pipeline held the busy flag. */
  | { kind: 'busy' }
  /** A lock on a fresh track that overlaps a live captured region — the
   *  duplicate suppression (regions.ts), or its fast-swap cost. */
  | { kind: 'region' }
  /** `why: 'look'`: a repeat the look re-arm let through (ui/rearm.ts). */
  | { kind: 'fire'; why?: 'look' }

/** What the policy reads beyond the tick's state: EngineState.look. */
export interface TickExtras {
  look?: CardLook | null
}

export interface PolicyKnobs {
  busyMs?: number
  /** The look re-arm (ui/rearm.ts) ships; `false` replays the policy without
   *  it, which is the shipping policy before 2026-10-10. */
  rearm?: boolean
}

export interface CapturePolicy {
  /** One detect tick's decision, made against the tick's EngineState. */
  decide(tMs: number, s: TickState, extras?: TickExtras): LockOutcome
  /** runCapture's success path: remember the region, the capture's look, start the busy window. */
  captured(tMs: number, quad: Quad, trackId: number, pixels: RectifiedImage): void
  /** runCapture's catch: release the refractory hold so the presence can retry. */
  failed(trackId: number): void
  readonly regionCount: number
  readonly regionsExpired: number
}

export function createCapturePolicy(opts: PolicyKnobs = {}): CapturePolicy {
  const busyMs = opts.busyMs ?? DEFAULT_CAPTURE_BUSY_MS
  // Scan.tsx: refractoryRef, regionsRef, rearmRef.
  const refractory = new Set<number>()
  const regions = createCapturedRegions()
  const rearm = opts.rearm === false ? null : createLookRearm()
  let busyUntil = -Infinity
  return {
    decide(tMs, s, extras = {}) {
      // Scan.tsx — a track that left `stable` loses its refractory hold.
      const presentIds = new Set(s.stable.map((q) => q.id))
      for (const id of refractory) if (!presentIds.has(id)) refractory.delete(id)
      // Scan.tsx — ONCE PER DETECT TICK, stable and pending both. The app
      // passes Date.now(); the replay passes video time (README "Clock").
      regions.tick(tMs, [...s.stable, ...s.pending])
      const locked = s.locked
      // Scan.tsx — the repeat, the looks of the captures behind it, and the
      // re-arm's verdict, judged every tick so the lock's steadiness is current.
      const isRefractory = !!locked && refractory.has(locked.id)
      const regionLooks = locked ? regions.suppressingLooks(locked.quad) : []
      const repeat = isRefractory || regionLooks.length > 0
      const refusers = repeat ? [...(isRefractory ? [rearm?.lookOfTrack(locked!.id) ?? null] : []), ...regionLooks] : []
      const newByLook = rearm ? rearm.judge(locked?.id ?? null, extras.look ?? null, refusers) : false
      if (!locked) return { kind: 'none' }
      // Scan.tsx fires when `!busy && (!repeat || newByLook)`; the reported
      // reason is the first clause that refused, in the order it used to be.
      if (repeat && !newByLook) {
        if (isRefractory) return { kind: 'refractory' }
        if (tMs < busyUntil) return { kind: 'busy' }
        return { kind: 'region' }
      }
      if (tMs < busyUntil) return { kind: 'busy' }
      refractory.add(locked.id)
      busyUntil = tMs + busyMs
      return repeat ? { kind: 'fire', why: 'look' } : { kind: 'fire' }
    },
    captured(tMs, quad, trackId, pixels) {
      // Scan.tsx noteCapture(result): the region, and the look of the frame
      // actually taken (captureLook on the captured pixels), kept with the
      // region and with the track. The app does this once capture() resolves
      // (tens of ms after the tick); no tick can land in between, so the
      // replay notes it at the tick.
      const look = captureLook(pixels)
      regions.note(quad, trackId, tMs, look)
      rearm?.note(look, trackId)
    },
    failed(trackId) {
      // Scan.tsx — and the busy flag clears in the `finally`.
      refractory.delete(trackId)
      busyUntil = -Infinity
    },
    get regionCount() {
      return regions.count
    },
    get regionsExpired() {
      return regions.expired
    },
  }
}

// ---------------------------------------------------------------------------
// capture() (index.ts:799-840)
// ---------------------------------------------------------------------------

export interface ReplayCapture {
  /** The quad capture() reports back: canonical, the observation not the EMA. */
  quad: Quad
  /** What was warped, in full-res crop pixels, BEFORE the margin. */
  cropQuad: Quad
  pixels: RectifiedImage
}

/**
 * index.ts capture(), minus the canvas: the frame is the full-res centre square
 * THIS tick read (index.ts:808-812 — the double-buffered capRead), the quad is
 * `track.raw ?? track.quad` (:824), one scale factor takes it to crop pixels
 * (:817, :833), and rectifyToCapture's body (rectify.ts:410) widens it by
 * CAPTURE_MARGIN and warps it to cardRectSize(). Only the JPEG encoder differs
 * (sharp's libjpeg at q85 instead of the browser's — done by the caller).
 */
export function captureFromSquare(track: TrackedQuad, square: ImageDataLike): ReplayCapture | null {
  const quad = track.raw ?? track.quad
  const cropQuad = canonicalQuadToCrop(quad, { x: 0, y: 0, size: square.width })
  const out = cardRectSize(DEFAULT_CARD_ASPECT)
  const pixels = rectifyImageData(square, expandQuad(cropQuad, CAPTURE_MARGIN), out.width, out.height)
  return pixels ? { quad, cropQuad, pixels } : null
}

// ---------------------------------------------------------------------------
// measurements that are the harness's own, not the product's
// ---------------------------------------------------------------------------

/**
 * Variance of the 3x3 Laplacian over the crop's CARD INTERIOR — a blur score.
 *
 * The capture is the card widened by CAPTURE_MARGIN per side, so the card spans
 * the middle 1/(1+2*0.05) = 91% of each axis; insetting 10% per side keeps the
 * measurement on card content, not on the table or hand around it. Luma is
 * Rec.601. Higher is sharper; it is comparable across captures from one video,
 * much less so across videos with different source resolution.
 */
export function laplacianVariance(img: ImageDataLike, inset = 0.1): number {
  const { width: W, height: H, data: d } = img
  const x0 = Math.max(1, Math.round(W * inset))
  const x1 = Math.min(W - 2, Math.round(W * (1 - inset)))
  const y0 = Math.max(1, Math.round(H * inset))
  const y1 = Math.min(H - 2, Math.round(H * (1 - inset)))
  const lum = (x: number, y: number) => {
    const o = (y * W + x) * 4
    return 0.299 * d[o] + 0.587 * d[o + 1] + 0.114 * d[o + 2]
  }
  let n = 0
  let sum = 0
  let sum2 = 0
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const v = lum(x - 1, y) + lum(x + 1, y) + lum(x, y - 1) + lum(x, y + 1) - 4 * lum(x, y)
      sum += v
      sum2 += v * v
      n++
    }
  }
  if (!n) return 0
  const mean = sum / n
  return sum2 / n - mean * mean
}

/** Per-track corner motion between consecutive OBSERVATIONS, canonical px — so
 *  a capture taken mid-swing is visible as a number, not only as blur. */
export function createMotionMeter() {
  const last = new Map<number, Quad>()
  return {
    update(tracks: readonly TrackedQuad[]): Map<number, number> {
      const out = new Map<number, number>()
      const live = new Set<number>()
      for (const t of tracks) {
        live.add(t.id)
        if (!t.raw) continue
        const prev = last.get(t.id)
        if (prev) out.set(t.id, meanCornerDelta(t.raw, prev))
        last.set(t.id, t.raw)
      }
      for (const id of [...last.keys()]) if (!live.has(id)) last.delete(id)
      return out
    },
  }
}
