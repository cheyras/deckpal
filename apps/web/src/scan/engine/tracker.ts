// The tracker, rebuilt as a DISPLAY-SAFETY layer.
//
// Ported from p2-work/tracker.mjs, but under a new law. DECISIONS.md
// 2026-09-02: "a tracker rebuilt as a display-safety layer that can never draw
// worse than the model's output." The old tracker was written against a
// classical detector that emitted junk, so its job was to suppress; this one
// sits behind a model measured at 85.5% on-perimeter, so its job is to not
// make that worse. Three rules follow, and they are the whole difference:
//
//   1. IT ONLY UPDATES ON DETECT TICKS. update() is called once per inference,
//      never per rendered frame. A tracker that advanced on rAF would age,
//      coast and expire its tracks against a clock the detector is not running
//      on — at 60 rAF/s and ~8 detect/s, a 2-tick grace would expire in 33 ms.
//
//   2. SMOOTHING MAY NEVER GO STALE. The EMA is capped: if the smoothed pose
//      it would display differs from the LATEST raw observation by more than
//      `snapPx` on any corner, the track snaps to the observation instead.
//      RECOMMENDATION §5's lesson, restated by PHASE0-CLOSEOUT §2.8, is that a
//      "67.9% offline engine delivered a 32.1% experience" — the displayed
//      pose is the product. Unbounded EMA lag is exactly how a good detection
//      becomes a bad display: at smooth=0.45 a sustained 30 px/tick hand
//      movement settles at ~36 px of lag, and the box visibly trails the card.
//      With the cap, lag is bounded by construction at `snapPx`.
//
//   3. COASTING IS BOUNDED AND ALWAYS FLAGGED. A stable track survives at most
//      `graceFrames` consecutive misses, and every tick it does so it is
//      returned with coasting: true so the UI can render it as the prediction
//      it is (contract.ts TrackedQuad.coasting). It absorbs the measured
//      failure mode — 9 misses in 116 card frames, has_obj 0.001-0.365, where
//      a genuine well-presented card drops for a tick or two without leaving
//      the scene (PHASE0-CLOSEOUT §2.5) — and nothing longer.
//
// PLUS the instrumentation PHASE0-CLOSEOUT §3.4 item 4 asks for and §2.8 says
// nothing in phase 0 could measure: per-tick corner displacement at FRAME
// RATE. The probe sampled at 0.18 Hz and could only see scene motion. `jitter`
// below is that number for the top stable track, reported every tick, both as
// displayed (what the user sees) and raw (what the model did) — the pair is
// what makes "displayed-on-card >= raw-on-card" checkable at all.

import type { Quad, TrackedQuad } from './contract'
import {
  alignToReference,
  centroid,
  cloneQuad,
  insideFraction,
  isConvexQuad,
  isFiniteQuad,
  maxCornerDelta,
  meanCornerDelta,
  pointInRect,
  polyArea,
  polyIoU,
  type Rect,
} from './geometry'

export interface TrackerOptions {
  /** Gate rect in FRAME PIXELS (not fractions), or null to disable the gate.
   *  THE reticle filter, not a second one: the model is shown the whole frame
   *  (index.ts INFERENCE_RECT), so this is where a quad that has wandered off
   *  the card the user is presenting — or unioned in a neighbouring one — is
   *  stopped. Rejecting costs a tick; drawing it costs the user's trust. */
  reticle?: Rect | null
  /** How much of a quad's own area must lie inside the reticle. 0.65 keeps the
   *  gate loose — "mostly aligning it, but not so dang exact" — rather than a
   *  hard crop. */
  minInsideFrac?: number
  /** "Same object, next tick" bar under handheld motion. */
  assocIou?: number
  /** Consecutive matched ticks before a track may be displayed as stable. */
  stableFrames?: number
  /** Consecutive missed ticks a stable track may coast through. */
  graceFrames?: number
  /** EMA weight on the new observation. */
  smooth?: number
  /** Rule 2's cap, in pixels of the tracked (frame) space. Acts as a FLOOR under
   *  `snapFrac` so a very small quad still gets a usable cap. */
  snapPx?: number
  /**
   * Rule 2's cap as a fraction of the tracked quad's own size (sqrt of its
   * area) — the SCALE-INVARIANT half of the cap, and the one that governs on any
   * modern stream.
   *
   * WHY THIS EXISTS. `snapPx` alone is an ABSOLUTE frame-pixel number, but rule
   * 2 is a statement about DISPLAY LAG, and how much lag the eye forgives
   * depends on the card's size on screen, not on the sensor's pixel count. It
   * was tuned at 480x640, where a card is ~300 px across and 12 px is 4% of it.
   * Hand the same tracker a 1080x1440 stream and the same PHYSICAL hand motion
   * now measures 20 frame px per tick against an unchanged 12 px cap, so the
   * cap is breached constantly and the EMA is bypassed on roughly half of all
   * ticks — measured 29/58 at 1080x1440 versus 0/58 at 480x640 and 720x960 for
   * identical motion. Smoothing silently switches itself off as resolution
   * rises, and the quad shows the model's raw per-tick corner noise: the
   * owner's "quads all over the place" on the live build.
   *
   * 0.04 is 12/sqrt(area) for the 480x640 corpus card the original number was
   * tuned against, so this reproduces the tuned behaviour at the tuning
   * resolution exactly and scales it correctly everywhere else.
   */
  snapFrac?: number
}

export interface TrackerJitter {
  /** Mean per-corner movement of the top stable track's DISPLAYED quad since
   *  the previous tick. This is EngineState.perf.jitterPx. */
  displayedPx: number
  /** The same measurement on the model's RAW observations, so displayed can be
   *  compared against raw instead of merely asserted to be better. */
  rawPx: number
  /** Which track the two numbers above describe, or null when none is stable. */
  trackId: number | null
  /** True when the top stable track hit rule 2's cap this tick. */
  snapped: boolean
}

export interface TrackerResult {
  stable: TrackedQuad[]
  pending: TrackedQuad[]
  jitter: TrackerJitter
}

export interface Tracker {
  /** Feed ONE detect tick's gated quads. Call exactly once per inference. */
  update(quads: readonly Quad[]): TrackerResult
  reset(): void
  getReticle(): Rect | null
  setReticle(r: Rect | null): void
}

export const TRACKER_DEFAULTS = {
  minInsideFrac: 0.65,
  assocIou: 0.4,
  stableFrames: 3,
  graceFrames: 2,
  smooth: 0.45,
  snapPx: 12,
  snapFrac: 0.04,
} as const

interface Track {
  id: number
  status: 'pending' | 'stable'
  /** Consecutive detect ticks MATCHED. Frozen while coasting — a coasting tick
   *  is not a sighting. This is TrackedQuad.age. */
  age: number
  missed: number
  coasting: boolean
  smoothed: Quad
  lastRaw: Quad | null
  prevRaw: Quad | null
  prevDisplayed: Quad | null
  snapped: boolean
}

export function createTracker(opts: TrackerOptions = {}): Tracker {
  const C = {
    minInsideFrac: opts.minInsideFrac ?? TRACKER_DEFAULTS.minInsideFrac,
    assocIou: opts.assocIou ?? TRACKER_DEFAULTS.assocIou,
    stableFrames: opts.stableFrames ?? TRACKER_DEFAULTS.stableFrames,
    graceFrames: opts.graceFrames ?? TRACKER_DEFAULTS.graceFrames,
    smooth: opts.smooth ?? TRACKER_DEFAULTS.smooth,
    snapPx: opts.snapPx ?? TRACKER_DEFAULTS.snapPx,
    snapFrac: opts.snapFrac ?? TRACKER_DEFAULTS.snapFrac,
  }

  /** Rule 2's cap for one quad: the absolute floor, or a fixed share of the
   *  quad's own size, whichever is larger. See TrackerOptions.snapFrac. */
  function snapCapFor(q: Quad): number {
    if (!(C.snapFrac > 0)) return C.snapPx
    return Math.max(C.snapPx, C.snapFrac * Math.sqrt(Math.max(0, polyArea(q))))
  }
  let reticle: Rect | null = opts.reticle ?? null

  let tracks: Track[] = []
  let nextId = 1

  function passesReticle(quad: Quad): boolean {
    if (!reticle) return true
    if (!pointInRect(centroid(quad), reticle)) return false
    return insideFraction(quad, reticle) >= C.minInsideFrac
  }

  function update(quadsIn: readonly Quad[]): TrackerResult {
    // ---- 1+2: reject malformed quads, then gate on the reticle -------------
    // The model's own output has been convex in 74/74 measured live claims,
    // but the refiner moves corners afterwards and a bowtie is one crossed
    // pair away. Nothing malformed may reach a track.
    const gated: Quad[] = []
    for (const q of quadsIn ?? []) {
      if (!isFiniteQuad(q)) continue
      if (polyArea(q) <= 0) continue
      if (!isConvexQuad(q)) continue
      if (!passesReticle(q)) continue
      gated.push(q)
    }

    // ---- 3: greedy best-IoU association ------------------------------------
    const pairs: Array<[number, number, number]> = []
    for (let ti = 0; ti < tracks.length; ti++) {
      for (let qi = 0; qi < gated.length; qi++) {
        const iou = polyIoU(tracks[ti].smoothed, gated[qi])
        if (iou >= C.assocIou) pairs.push([iou, ti, qi])
      }
    }
    pairs.sort((a, b) => b[0] - a[0])
    const matchedTrack = new Array<number>(tracks.length).fill(-1)
    const matchedQuad = new Array<number>(gated.length).fill(-1)
    for (const [, ti, qi] of pairs) {
      if (matchedTrack[ti] !== -1 || matchedQuad[qi] !== -1) continue
      matchedTrack[ti] = qi
      matchedQuad[qi] = ti
    }

    // ---- 4+5: persistence, capped smoothing --------------------------------
    const survivors: Track[] = []
    for (let ti = 0; ti < tracks.length; ti++) {
      const t = tracks[ti]
      t.prevDisplayed = cloneQuad(t.smoothed)
      t.snapped = false
      const qi = matchedTrack[ti]
      if (qi !== -1) {
        const raw = alignToReference(t.smoothed, gated[qi])
        const sm = t.smoothed
        for (let i = 0; i < 4; i++) {
          sm[i][0] += (raw[i][0] - sm[i][0]) * C.smooth
          sm[i][1] += (raw[i][1] - sm[i][1]) * C.smooth
        }
        // RULE 2. The EMA is a comfort, not a claim: the moment it would show
        // a pose more than snapPx from what the model just measured, the
        // measurement wins outright.
        if (maxCornerDelta(sm, raw) > snapCapFor(raw)) {
          t.smoothed = cloneQuad(raw)
          t.snapped = true
        }
        t.prevRaw = t.lastRaw
        t.lastRaw = cloneQuad(raw)
        t.missed = 0
        t.coasting = false
        t.age += 1
        if (t.status === 'pending' && t.age >= C.stableFrames) t.status = 'stable'
        survivors.push(t)
      } else if (t.status === 'stable') {
        t.missed += 1
        if (t.missed <= C.graceFrames) {
          t.coasting = true
          t.prevRaw = null
          survivors.push(t)
        }
        // else: grace exhausted -> the track dies. RULE 3 is a hard bound.
      }
      // A pending track that misses dies immediately: no grace for anything
      // that has not yet proven itself. This is what keeps a single-tick
      // false quad — 21% of no-card frames produce one — off the screen.
    }

    for (let qi = 0; qi < gated.length; qi++) {
      if (matchedQuad[qi] !== -1) continue
      survivors.push({
        id: nextId++,
        // stableFrames === 1 means "trust the first sighting"; anything higher
        // means a first sighting is always pending, which is the flicker gate.
        status: C.stableFrames <= 1 ? 'stable' : 'pending',
        age: 1,
        missed: 0,
        coasting: false,
        smoothed: cloneQuad(gated[qi]),
        lastRaw: cloneQuad(gated[qi]),
        prevRaw: null,
        prevDisplayed: null,
        snapped: false,
      })
    }

    tracks = survivors

    const stable: TrackedQuad[] = []
    const pending: TrackedQuad[] = []
    for (const t of tracks) {
      const entry: TrackedQuad = {
        id: t.id,
        quad: cloneQuad(t.smoothed),
        age: t.age,
        coasting: t.coasting,
      }
      if (t.status === 'stable') stable.push(entry)
      else pending.push(entry)
    }

    return { stable, pending, jitter: jitterOf(stable) }
  }

  /** The "top" stable track: oldest first, largest on a tie. One number, about
   *  the track the user is actually looking at — averaging jitter across every
   *  track would hide the one that matters behind whatever else is on screen. */
  function jitterOf(stable: readonly TrackedQuad[]): TrackerJitter {
    let top: Track | null = null
    let topAge = -1
    let topArea = -1
    for (const s of stable) {
      const t = tracks.find((x) => x.id === s.id)
      if (!t) continue
      const area = polyArea(t.smoothed)
      if (t.age > topAge || (t.age === topAge && area > topArea)) {
        top = t
        topAge = t.age
        topArea = area
      }
    }
    if (!top) return { displayedPx: 0, rawPx: 0, trackId: null, snapped: false }
    return {
      displayedPx: top.prevDisplayed ? meanCornerDelta(top.smoothed, top.prevDisplayed) : 0,
      rawPx: top.prevRaw && top.lastRaw ? meanCornerDelta(top.lastRaw, top.prevRaw) : 0,
      trackId: top.id,
      snapped: top.snapped,
    }
  }

  return {
    update,
    reset() {
      tracks = []
      nextId = 1
    },
    getReticle() {
      return reticle ? { ...reticle } : null
    },
    setReticle(r: Rect | null) {
      reticle = r
    },
  }
}
