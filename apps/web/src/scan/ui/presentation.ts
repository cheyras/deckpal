// THE PRESENTATION EPISODE — when the scanner takes a card again, as one pure
// state machine (design: .cache/tack-2026-11-27/scan/DESIGN.md §2; decision
// 2026-11-27 "a flip is always captured").
//
// ── WHAT IT REPLACES, AND WHY ───────────────────────────────────────────────
//
// Until 2026-11-27 three geometric memories decided whether a lock was a card
// already taken: the per-track refractory (Scan.tsx), the captured regions
// (regions.ts) and the look re-arm (rearm.ts). Each asked the camera "is this
// the card I already scanned?", which it cannot answer, and a "can't tell" was
// shown as "Already scanned". On the owner's 2026-11-27 session that refused
// Cheren after Herdier, Lillipup and Gothorita: a card swapped in place keeps
// the track id or overlaps the region, and the look of two White Flare cards of
// one type sits inside the re-arm's 1.0 about one time in five (19 % of 6,156
// unrelated pairs on his own crops).
//
// This machine asks a question the camera CAN answer: has the card been
// continuously in view since it was taken?
//
//   IDLE      nothing taken (or the spot went empty). A lock fires.
//   WATCHING  a capture opened an episode and the card has stayed put. Nothing
//             fires: this is the one place "already scanned" is true, by
//             construction, and the pill says so positively ("Scanned ✓").
//   BROKEN    something broke the continuity — a hand over the card, the card
//             leaving, the look moving off the reference. The next steady card
//             fires, ALWAYS. Same card or a different one is not decided here:
//             it is decided afterwards, by identity (repeat.ts).
//
// So nothing is refused on a guess. A wrong break costs a flagged row with an
// Undo, never a lost card.
//
// ── THE SIGNALS ─────────────────────────────────────────────────────────────
//
// `d`   the episode lock's tick look against the episode REFERENCE — the median
//       of the first REF_TICKS steady lock looks after the capture (tick vs
//       tick, so the same-card band is tight). When no lock overlaps the
//       episode's spot, the SPOT LOOK stands in: the engine's look of whatever
//       sits on the reference quad now (EngineState.spotLook, engine.watch), so
//       a detector dropout over an untouched card reads quiet, not empty.
// `sd`  the lock's look against the same track's previous lock look: steadiness.
//
// Tick classes: quiet d ≤ QUIET_MAX · soft QUIET_MAX < d ≤ HARD_MIN or
// sd > STEADY_MAX · hard d > HARD_MIN, a null look, or no lock and no spot look.
//
// TWO ADDITIONS TO THE DESIGN, both about the TRACK, which is supporting
// evidence and never proof on its own (ids survive swaps: #397, video 46OLXH5):
//   - the tracker RE-IDENTIFYING the lock on the episode's spot is one hard
//     tick (`reidIsHard`). Cards of one set and type can sit 0.44-0.99 apart
//     by look (the owner's White Flare cards, PR #416), so a swap may read as
//     quiet; a re-id plus the hand's own hard tick is a break, a re-id alone
//     is not.
//   - after a break, a track the episode never saw fires on its lock, as a
//     fresh lock does in IDLE (`freshTrackFires`); the two-tick settle is for
//     the tracker FOLLOWING one object mid-slide. Without it the 7-video bench
//     took 53 of 192 card appearances (the old regions: 63); with it, 66.
//
// The thresholds are the design's STARTING VALUES, sized from capture-look
// statistics (a card held still stays within 0.71 of its capture look for 39 s;
// different cards are > 0.71 in 95 % of pairs). The owner's 2026-11-27 tick
// traces, which would calibrate them, are on the server behind a sign-in and
// have not been replayed: the decision file records that, and trace v2
// (flags.ts) records `d` directly so the next session measures them.
//
// PURE: no clock, no DOM. The caller passes `now`. The offline video replay
// (scripts/scan-bench/video/session.ts) and the unit tests drive this object,
// not a copy of it.

import type { Quad } from '../engine/contract'
import { polyIoU } from '../engine/geometry'
import { LOOK_BYTES, lookDistance, type CardLook } from '../engine/look'

export type PresentationState = 'idle' | 'watching' | 'broken'
/** Why a capture fired: a fresh card, a card after a break, a drift probe, or the reader's own press. */
export type FireKind = 'first' | 'disturbed' | 'drift' | 'manual'
/** How continuity broke: something was seen to disturb the card, or its look drifted with nothing seen. */
export type BreakKind = 'disturbed' | 'drift'
export type TickClass = 'quiet' | 'soft' | 'hard'

/** At or under this the tick's look is the episode's card, untouched. */
export const QUIET_MAX = 0.6
/** Over this the tick's look is not the episode's card as it was. */
export const HARD_MIN = 0.9
/** A lock look within this of the same track's previous one is steady (was rearm.ts REARM_STEADY_MAX). */
export const STEADY_MAX = 0.3
/** The classification window: 12 ticks, 1.5 s at the device's ~8 Hz. */
export const WINDOW_TICKS = 12
/** A break is this many hard ticks in the window... */
export const BREAK_HARD_TICKS = 2
/** ...or one hard tick with this many soft ones. */
export const BREAK_SOFT_WITH_ONE_HARD = 2
/** A drift is this many consecutive soft-by-look (and steady) ticks with no hard tick in the window. */
export const DRIFT_TICKS = 8
/** After a break, this many consecutive steady lock ticks settle the next card. */
export const SETTLE_TICKS = 2
/** This many ticks with nothing to see (no lock, and in WATCHING no spot look) return the machine to IDLE. */
export const VACANT_TICKS = 8
/** The reference is the median of this many steady lock looks after the capture. */
export const REF_TICKS = 3
/** How hard the reference quad follows the episode's lock while it stays (EMA weight of the new quad). */
export const REF_FOLLOW_ALPHA = 0.3
/** A lock overlapping the reference quad at least this much is the episode's lock. */
export const EPISODE_IOU = 0.5
/**
 * Two automatic captures are never closer than this. The busy window and the
 * settle already keep them further apart; this is the photosensitivity
 * guarantee for the capture flash (under 3 flashes a second), held here so it
 * does not depend on either of those staying as long as they are today.
 */
export const MIN_FIRE_GAP_MS = 400

export interface PresentationTick {
  /** Caller's clock, ms. */
  now: number
  /** EngineState.locked: the capture candidate, or null. */
  lock: { id: number; quad: Quad } | null
  /** EngineState.look: the lock's look this tick. */
  look: CardLook | null
  /** EngineState.spotLook: the look on the quad this machine watches (watchQuad), when it watches one. */
  spotLook: CardLook | null
}

export interface PresentationReport {
  /** The state after this tick. */
  state: PresentationState
  /** The episode being watched or broken from (a counter), or null in IDLE with no episode. */
  episode: number | null
  /** The classification distance this tick (WATCHING only; null where the look was null). */
  d: number | null
  cls: TickClass | null
  /** `d` came from the spot look, not a lock. */
  fromSpot: boolean
  /** The lock's steadiness distance this tick (any state). */
  sd: number | null
  /** A break declared on THIS tick. */
  breakKind: BreakKind | null
  /** The machine would fire this kind on this tick's lock, gates aside (busy, back, size, focus). */
  candidate: FireKind | null
}

export interface FireInput {
  kind: FireKind
  now: number
  /** The capture's id (Scan.tsx mints it before capture()). */
  captureId: string
  trackId: number
  /** The lock's quad: the reference spot. */
  quad: Quad
  /** The lock's tick look at the fire, the reference's first sample. */
  look: CardLook | null
}

/** What a fire says about the episode it broke from — the `episode-fire` trace record. */
export interface FireRecord {
  ep: number
  kind: FireKind
  captureId: string
  /** The capture this one broke from (and is compared with by identity, repeat.ts). */
  prevCaptureId: string | null
  hardTicks: number
  softTicks: number
  /** How long the previous episode was BROKEN before this fire, ms (null if it never broke). */
  brokenMs: number | null
  /** Consecutive ticks with nothing in view just before this fire. */
  vacantTicks: number
}

export interface CurrentEpisode {
  ep: number
  state: PresentationState
  kind: FireKind
  captureId: string
  prevCaptureId: string | null
  firedAt: number
}

export interface Presentation {
  /** Once per detect tick, lock or not. */
  observe(t: PresentationTick): PresentationReport
  /** A capture was started on this lock (capture() called). Opens a new episode. */
  fire(f: FireInput): FireRecord
  /** That capture failed: put the machine back as it was before it fired, so the card retries. */
  failed(captureId: string): void
  /**
   * A drift probe identity named the SAME card it broke from, at a close look:
   * it is discarded, and the episode carries on as the earlier capture's, with
   * the reference re-taken on the current look.
   */
  discardProbe(captureId: string): void
  /** The quad whose look the engine should report as `spotLook` next tick (engine.watch). */
  watchQuad(): Quad | null
  /** The episode as it stands, for the status line. */
  current(): CurrentEpisode | null
  /** Leaving Step 1 (`forget: true`) or suspending (the bin expanded): back to IDLE. */
  reset(opts?: { forget?: boolean }): void
}

interface Episode {
  ep: number
  kind: FireKind
  captureId: string
  prevCaptureId: string | null
  firedAt: number
  trackId: number
  refQuad: Quad
  samples: CardLook[]
  ref: CardLook | null
  window: TickClass[]
  softRun: number
  /** Consecutive steady ticks of a lock that is NOT on the episode's spot. */
  elsewhereRun: number
  /** Track ids locked on the episode's spot, and anywhere, while it was watched. */
  ownIds: Set<number>
  seenIds: Set<number>
  hardTicks: number
  softTicks: number
  brokenAt: number | null
  breakKind: BreakKind | null
  /** The machine as it was before this fire, for `failed`. */
  prior: Snapshot
}

interface Snapshot {
  state: PresentationState
  episode: Episode | null
  lastCaptureId: string | null
}

/** Element-wise median of looks (one orientation each). */
function medianLook(looks: readonly CardLook[]): CardLook {
  if (looks.length === 1) return looks[0]!
  const out = new Uint8Array(LOOK_BYTES)
  const v: number[] = new Array(looks.length)
  for (let i = 0; i < LOOK_BYTES; i++) {
    for (let k = 0; k < looks.length; k++) v[k] = looks[k]![i]!
    v.sort((a, b) => a - b)
    out[i] = v[Math.floor(v.length / 2)]!
  }
  return out
}

function follow(ref: Quad, to: Quad, a: number): Quad {
  return ref.map(([x, y], i) => [x + a * (to[i]![0] - x), y + a * (to[i]![1] - y)]) as Quad
}

/**
 * The thresholds, injectable so the offline replays can sweep them
 * (scripts/scan-bench/video --tuning). Defaults are the shipping values.
 */
export interface PresentationTuning {
  quietMax: number
  hardMin: number
  steadyMax: number
  breakHard: number
  breakSoftWithOneHard: number
  driftTicks: number
  settleTicks: number
  /**
   * A track the episode never saw is a new object: after a break it fires on
   * its lock (the IDLE rule), without the settle. The settle exists for the
   * card mid-slide, which is the tracker FOLLOWING one object.
   */
  freshTrackFires: boolean
  /**
   * The tracker re-identifying the lock ON the episode's spot counts as a hard
   * tick. Supporting only: one is never a break by itself (BREAK_HARD_TICKS).
   */
  reidIsHard: boolean
}
export const PRESENTATION_DEFAULTS: Readonly<PresentationTuning> = {
  quietMax: QUIET_MAX,
  hardMin: HARD_MIN,
  steadyMax: STEADY_MAX,
  breakHard: BREAK_HARD_TICKS,
  breakSoftWithOneHard: BREAK_SOFT_WITH_ONE_HARD,
  driftTicks: DRIFT_TICKS,
  settleTicks: SETTLE_TICKS,
  freshTrackFires: true,
  reidIsHard: true,
}

export function createPresentation(tuning: Partial<PresentationTuning> = {}): Presentation {
  const T = { ...PRESENTATION_DEFAULTS, ...tuning }
  let state: PresentationState = 'idle'
  let episode: Episode | null = null
  /** The last capture taken, kept through a vacancy (IDLE) so the next card is still compared with it. */
  let lastCaptureId: string | null = null
  let seq = 0
  let lastFireAt = -Infinity
  /** The previous lock tick's track and look, for `sd`. */
  let prevLock: { id: number; look: CardLook | null } | null = null
  let steadyRun = 0
  /** Consecutive ticks with nothing in view, and the longest such run since the last fire (for its record). */
  let vacant = 0
  let vacantSinceFire = 0
  const countVacant = (empty: boolean) => {
    vacant = empty ? vacant + 1 : 0
    vacantSinceFire = Math.max(vacantSinceFire, vacant)
  }

  const classOf = (d: number | null, sd: number | null, seen: boolean): TickClass => {
    if (!seen || d === null) return 'hard'
    if (d > T.hardMin) return 'hard'
    if (d > T.quietMax || (sd !== null && sd > T.steadyMax)) return 'soft'
    return 'quiet'
  }

  return {
    observe(t) {
      const lock = t.lock
      let sd: number | null = null
      if (lock) {
        if (prevLock && prevLock.id === lock.id && prevLock.look && t.look) sd = lookDistance(t.look, prevLock.look)
        prevLock = { id: lock.id, look: t.look }
      }
      const steady = !!lock && sd !== null && sd <= T.steadyMax
      steadyRun = steady ? steadyRun + 1 : 0

      let d: number | null = null
      let cls: TickClass | null = null
      let fromSpot = false
      let breakKind: BreakKind | null = null

      if (state === 'watching' && episode) {
        const e = episode
        const own = !!lock && polyIoU(lock.quad, e.refQuad) >= EPISODE_IOU
        const L = own ? t.look : t.spotLook
        fromSpot = !own
        const seen = own || !!t.spotLook
        // The reference: the first REF_TICKS steady looks of the episode's own
        // lock. Until it is complete, the samples so far stand in (the fire
        // tick's look first), so classification never waits on it.
        if (own && t.look && !e.ref && (e.samples.length === 0 || (sd !== null && sd <= T.steadyMax))) {
          e.samples.push(t.look)
          if (e.samples.length >= REF_TICKS) e.ref = medianLook(e.samples)
        }
        const ref = e.ref ?? (e.samples.length ? medianLook(e.samples) : null)
        if (ref && L) d = lookDistance(L, ref)
        // A null look, or nothing to compare it with, is "cannot tell": hard.
        cls = classOf(d, own ? sd : null, seen)
        // The tracker re-identified the lock on the spot: supporting evidence
        // of a swap (White Flare cards of one type sit 0.44-0.99 apart by look,
        // PR #416, so the look alone can read a swap as quiet).
        if (own && T.reidIsHard && e.ownIds.size > 0 && !e.ownIds.has(lock!.id)) cls = 'hard'
        if (lock) e.seenIds.add(lock.id)
        if (own) e.ownIds.add(lock!.id)
        e.window.push(cls)
        if (e.window.length > WINDOW_TICKS) e.window.shift()
        if (cls === 'hard') e.hardTicks++
        else if (cls === 'soft') e.softTicks++
        const softByLook = d !== null && d > T.quietMax && d <= T.hardMin && (sd === null || sd <= T.steadyMax)
        e.softRun = softByLook ? e.softRun + 1 : 0
        // The reference SPOT follows the episode's own card while it is
        // continuous, so a slow phone drift reads as the card still there.
        if (own && cls !== 'hard') e.refQuad = follow(e.refQuad, lock!.quad, REF_FOLLOW_ALPHA)

        const hard = e.window.filter((c) => c === 'hard').length
        const soft = e.window.filter((c) => c === 'soft').length
        // A DIFFERENT card locked somewhere else, steady, while the episode's
        // card still lies on its spot: two cards in view, and the second is a
        // presentation of its own. Not in the design's machine (it would leave
        // the second card waiting until the first is moved, a silent refusal);
        // see the decision file. Its steadiness was measured on that lock, so
        // it may fire on this tick.
        e.elsewhereRun = lock && !own && steady ? e.elsewhereRun + 1 : 0
        const elsewhere = e.elsewhereRun >= T.settleTicks && !!t.spotLook
        if (hard >= T.breakHard || (hard >= 1 && soft >= T.breakSoftWithOneHard) || elsewhere) breakKind = 'disturbed'
        else if (e.softRun >= T.driftTicks && hard === 0) breakKind = 'drift'

        countVacant(!lock && !t.spotLook)
        if (breakKind) {
          state = 'broken'
          e.breakKind = breakKind
          e.brokenAt = t.now
          // The next fire needs fresh steadiness, measured after the break —
          // except a card elsewhere, whose steadiness is what declared it.
          if (!elsewhere) steadyRun = 0
        } else if (vacant >= VACANT_TICKS) {
          state = 'idle'
        }
      } else {
        countVacant(!lock)
        if (state === 'broken' && vacant >= VACANT_TICKS) state = 'idle'
      }

      let candidate: FireKind | null = null
      if (lock && t.now - lastFireAt >= MIN_FIRE_GAP_MS) {
        if (state === 'idle') candidate = lastCaptureId ? 'disturbed' : 'first'
        else if (state === 'broken' && (steadyRun >= T.settleTicks || (T.freshTrackFires && !!episode && !episode.seenIds.has(lock.id))))
          candidate = episode?.breakKind ?? 'disturbed'
      }
      return {
        state,
        episode: episode?.ep ?? null,
        d,
        cls,
        fromSpot,
        sd,
        breakKind,
        candidate,
      }
    },

    fire(f) {
      const prior: Snapshot = { state, episode, lastCaptureId }
      const prev = f.kind === 'first' ? null : (episode?.captureId ?? lastCaptureId)
      const record: FireRecord = {
        ep: seq + 1,
        kind: f.kind,
        captureId: f.captureId,
        prevCaptureId: prev,
        hardTicks: episode?.hardTicks ?? 0,
        softTicks: episode?.softTicks ?? 0,
        brokenMs: state !== 'watching' && episode?.brokenAt != null ? f.now - episode.brokenAt : null,
        vacantTicks: vacantSinceFire,
      }
      seq++
      episode = {
        ep: seq,
        kind: f.kind,
        captureId: f.captureId,
        prevCaptureId: prev,
        firedAt: f.now,
        trackId: f.trackId,
        refQuad: f.quad.map(([x, y]) => [x, y]) as Quad,
        samples: f.look ? [f.look] : [],
        ref: null,
        window: [],
        softRun: 0,
        elsewhereRun: 0,
        ownIds: new Set([f.trackId]),
        seenIds: new Set([f.trackId]),
        hardTicks: 0,
        softTicks: 0,
        brokenAt: null,
        breakKind: null,
        prior,
      }
      state = 'watching'
      lastCaptureId = f.captureId
      lastFireAt = f.now
      steadyRun = 0
      vacant = 0
      vacantSinceFire = 0
      return record
    },

    failed(captureId) {
      if (!episode || episode.captureId !== captureId) return
      const p = episode.prior
      state = p.state
      episode = p.episode
      lastCaptureId = p.lastCaptureId
      // A failed capture must not hold the next one back for the photosensitivity gap.
      lastFireAt = -Infinity
    },

    discardProbe(captureId) {
      if (!episode || episode.captureId !== captureId) {
        // The probe's episode has already moved on; the capture is still dropped,
        // and it must not be what the next card is compared with.
        if (lastCaptureId === captureId) lastCaptureId = episode?.captureId ?? null
        return
      }
      // The episode carries on as the capture it probed against. Its reference
      // was re-taken from the looks after the probe fired, which is the current
      // look: that is the re-reference.
      const before = episode.prior.episode
      episode.captureId = episode.prevCaptureId ?? captureId
      episode.prevCaptureId = before?.prevCaptureId ?? null
      episode.kind = before?.kind ?? episode.kind
      episode.firedAt = before?.firedAt ?? episode.firedAt
      lastCaptureId = episode.captureId
    },

    watchQuad() {
      return state === 'watching' && episode ? episode.refQuad : null
    },

    current() {
      return episode
        ? {
            ep: episode.ep,
            state,
            kind: episode.kind,
            captureId: episode.captureId,
            prevCaptureId: episode.prevCaptureId,
            firedAt: episode.firedAt,
          }
        : null
    },

    reset(opts = {}) {
      state = 'idle'
      episode = null
      if (opts.forget) lastCaptureId = null
      prevLock = null
      steadyRun = 0
      vacant = 0
    },
  }
}
