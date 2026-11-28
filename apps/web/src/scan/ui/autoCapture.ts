// THE AUTO-CAPTURE DECISION for one detect tick, as a function — so the offline
// replay (scripts/scan-bench/video) runs THIS and not a copy of Scan.tsx's
// rules: a re-implementation can agree with a test and disagree with the
// product.
//
// WHETHER a lock may fire is the presentation machine's (presentation.ts): a
// card still lying where it was taken never fires; any break in that
// continuity followed by a steady card always does. Until 2026-11-27 this
// asked three geometric memories instead (the per-track refractory, the
// captured regions, the look re-arm), and their "cannot tell" was shown as
// "Already scanned" on new cards. They are gone; see the decision file
// 2026-11-27 "a flip is always captured".
//
// What is left here is the gates a lock must also pass — not busy, not a card
// back, big enough to read (sizeGate.ts), sharp (focusGate.ts) — and the
// card-back holds. Called once per tick, lock or not: the machine and the
// holds are measured tick to tick.

import type { Quad } from '../engine/contract'
import { CARD_BACK_RELEASE_DISTANCE, cardBackDistance, isCardBackLook } from '../engine/cardBack'
import { lookDistance, type CardLook } from '../engine/look'
import type { FocusGate } from './focusGate'
import { STEADY_MAX, type FireKind, type Presentation, type PresentationReport } from './presentation'
import { isTooFar } from './sizeGate'

export interface AutoCaptureVerdict {
  /** Fire a capture on the lock now (and then call `presentation.fire` with `kind`). */
  fire: boolean
  /**
   * What the presentation machine would fire on this lock: `first` (nothing
   * taken yet), `disturbed` (a card after a break), `drift` (a silent probe:
   * the look moved off the reference with nothing seen to cover it). Null in
   * WATCHING — the card taken is still there — or with no lock.
   */
  kind: FireKind | null
  /** The machine's own report for this tick: its state, `d`, the tick class, a break declared. */
  presentation: PresentationReport
  /**
   * The lock is a CARD BACK (engine/cardBack.ts): its look is the back's this
   * tick, or its track is held as a back (CardBackHolds). Never fires.
   */
  cardBack: boolean
  /**
   * This tick let go of the track's card-back hold: its look held still and
   * left the back (CARD_BACK_RELEASE_DISTANCE). The lock is then judged like
   * any other.
   */
  backReleased: boolean
  /**
   * The lock is held for FOCUS (focusGate.ts): this tick is not sharp enough
   * yet. Never fires; the UI asks the reader to hold still. Only reported on a
   * lock that would otherwise fire.
   */
  focusWait: boolean
  /**
   * The lock is held for SIZE (sizeGate.ts): the card is too small in the
   * frame for its text to read. Never fires; the UI asks the reader to come a
   * little closer. Only reported on a lock that would otherwise fire, so a
   * card already taken or a card back is never told to come closer.
   */
  tooFar: boolean
}

/** How many of a track's lock ticks in a row must show the back before it is held. */
export const CARD_BACK_LATCH_TICKS = 2

/**
 * THE CARD-BACK HOLDS, per track. A lock whose look is the back's is refused on
 * that tick; CARD_BACK_LATCH_TICKS of them in a row HOLD the track, and a held
 * track stays refused until its look has held still (STEADY_MAX, the
 * presentation machine's steadiness rule, against the track's previous lock look) and
 * sits further than CARD_BACK_RELEASE_DISTANCE from the back, either way up —
 * which is what turning it face up in place looks like — or it departs.
 * "In a row" counts the track's lock ticks: a tick its lock blinks off
 * (coasting) neither adds to nor breaks the streak.
 *
 * WHY A HOLD, not a per-tick judgement: a thumb sliding over a back, or a
 * corner of it leaving the quad, moves its look away from the template for a
 * tick or two (one replayed back measured 0.39-0.70 across its hold, with a
 * single tick at 0.99), and a per-tick rule would capture the back on that
 * tick. The steadiness clause is what refuses that tick.
 *
 * WHY TWO TICKS TO LATCH: the margin between the back and the nearest card is
 * carried mostly by chroma, and chroma is what a light's colour moves. A single
 * tick of a real card misread as a back costs that tick only; a latched hold on
 * one costs it until it is steady and clear of the back, so it takes two.
 *
 * WHY ITS OWN RELEASE RULE, not "a different card by look": that needed the
 * old re-arm's 1.0 from the back, which about 1% of real cards never reach.
 * Released, the lock is judged like any other by the presentation machine: a
 * captured card turned over and back has broken its episode, so it is taken
 * again and identity flags it as the same card (repeat.ts).
 */
export interface CardBackHolds {
  /**
   * Advance the track's hold with this tick's lock look; the verdict's
   * `cardBack` and `backReleased`. Called by decideAutoCapture, once per lock.
   */
  judge(trackId: number, look: CardLook | null): { cardBack: boolean; backReleased: boolean }
  /** Whether the track is held (latched) as a back. */
  has(trackId: number): boolean
  /** Forget every track not in `present` — a track that departs takes its hold with it. */
  prune(present: ReadonlySet<number>): void
}

export function createCardBackHolds(): CardBackHolds {
  /** Only tracks with a back streak or a hold are kept, so prune bounds it. */
  const tracks = new Map<number, { streak: number; held: boolean; last: CardLook | null }>()
  return {
    judge(trackId, look) {
      const t = tracks.get(trackId) ?? { streak: 0, held: false, last: null }
      const before = t.last
      t.last = look
      if (isCardBackLook(look)) {
        t.streak++
        if (t.streak >= CARD_BACK_LATCH_TICKS) t.held = true
        tracks.set(trackId, t)
        return { cardBack: true, backReleased: false }
      }
      t.streak = 0
      let backReleased = false
      if (
        t.held &&
        look &&
        before &&
        lookDistance(look, before) <= STEADY_MAX &&
        cardBackDistance(look) > CARD_BACK_RELEASE_DISTANCE
      ) {
        t.held = false
        backReleased = true
      }
      if (t.held) tracks.set(trackId, t)
      else tracks.delete(trackId)
      return { cardBack: t.held, backReleased }
    },
    has(trackId) {
      return !!tracks.get(trackId)?.held
    },
    prune(present) {
      for (const id of [...tracks.keys()]) if (!present.has(id)) tracks.delete(id)
    },
  }
}

/**
 * Call once per detect tick, lock or not, after the card-back holds have
 * dropped departed tracks. Fires when the presentation machine has a candidate
 * (presentation.ts), nothing is busy, it is not a card back, and the card is
 * close enough and sharp. The caller then calls `presentation.fire` with
 * `verdict.kind` when it starts the capture.
 *
 * Without `cardBacks` (a caller that keeps no holds) a back is refused on the
 * ticks it shows and nothing more.
 */
export function decideAutoCapture(
  lock: { id: number; quad: Quad } | null,
  look: CardLook | null,
  memory: {
    /** The presentation machine (createPresentation). Observed once, here. */
    presentation: Presentation
    /** EngineState.spotLook: the look on the quad the machine watches. */
    spotLook?: CardLook | null
    /** The caller's clock, ms (the machine's photosensitivity gap and its records). */
    now: number
    busy: boolean
    /** The per-track card-back holds (createCardBackHolds). */
    cardBacks?: CardBackHolds
    /** The focus gate (focusGate.ts) with this tick's EngineState.sharpness. */
    focus?: { gate: FocusGate; sharpness: number | null; now: number }
    /** The size gate (sizeGate.ts): the side of the square frame the lock's
     *  quad is measured in (EngineState.frame, 416), and optionally the floor. */
    size?: { frameSide: number; minSide?: number }
  },
): AutoCaptureVerdict {
  const report = memory.presentation.observe({ now: memory.now, lock, look, spotLook: memory.spotLook ?? null })
  const back = !lock
    ? { cardBack: false, backReleased: false }
    : memory.cardBacks
      ? memory.cardBacks.judge(lock.id, look)
      : { cardBack: isCardBackLook(look), backReleased: false }
  const small = !!lock && !!memory.size && isTooFar(lock.quad, memory.size.frameSide, memory.size.minSide)
  // Judged on every lock tick the card is close enough on, so the track's
  // sharpest recent frame is known by the time a capture would otherwise fire.
  // NOT while it is too far: its focus wait should start when it arrives, not
  // be spent (focusGate's FOCUS_MAX_WAIT_MS settle) on frames that were never
  // going to be taken. A gap past the gate's LOCK_GAP_MS restarts the wait.
  const focus = lock && memory.focus && !small ? memory.focus.gate.judge(lock.id, memory.focus.sharpness, memory.focus.now) : null
  const wouldFire = !!lock && !memory.busy && !back.cardBack && report.candidate !== null
  const tooFar = wouldFire && small
  const focusWait = wouldFire && !tooFar && !!focus && !focus.ready
  return {
    fire: wouldFire && !tooFar && !focusWait,
    kind: report.candidate,
    presentation: report,
    cardBack: back.cardBack,
    backReleased: back.backReleased,
    focusWait,
    tooFar,
  }
}
