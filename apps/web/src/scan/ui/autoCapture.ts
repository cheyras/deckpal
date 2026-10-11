// THE AUTO-CAPTURE DECISION for one detect tick, as a function — so the offline
// replay (scripts/scan-bench/video) runs THIS and not a copy of Scan.tsx's
// rules, for the reason regions.ts gives at length: a re-implementation can
// agree with a test and disagree with the product.
//
// Scan.tsx owns the memories (the refractory set, the captured regions, the
// look re-arm, the card-back holds) and the busy flag; this only reads them and
// says whether the tick's lock fires.

import type { Quad } from '../engine/contract'
import { CARD_BACK_LOOK, isCardBackLook } from '../engine/cardBack'
import type { CardLook } from '../engine/look'
import type { CapturedRegions } from './regions'
import type { LookRearm } from './rearm'

export interface AutoCaptureVerdict {
  /** Fire a capture on the lock now. */
  fire: boolean
  /** The lock is a REPEAT: its track was already captured, or its place is. */
  repeat: boolean
  /** ...and the look re-arm judged the card in it a different one (rearm.ts). */
  newByLook: boolean
  /**
   * The lock is a CARD BACK (engine/cardBack.ts): its look is the back's this
   * tick, or its track showed a back and has not since held a different look.
   * Never fires. The caller adds the track to `cardBacks` while this is true.
   */
  cardBack: boolean
}

/**
 * Call once per detect tick, lock or not — the re-arm's steadiness is measured
 * tick to tick — after the refractory set and the card-back holds have dropped
 * departed tracks and the regions have been ticked. Fires when there is a lock,
 * nothing is busy, it is not a card back, and it is either not a repeat or a
 * different card by look.
 *
 * WHY A BACK IS HELD PER TRACK, not judged tick by tick: a thumb sliding over a
 * back, or a corner of it leaving the quad, moves its look away from the
 * template for a tick or two (one replayed back measured 0.39-0.70 across its
 * hold, with a single tick at 0.99), and a per-tick rule would capture the back
 * on that tick. So a track that showed a back stays refused until the look
 * re-arm says the card in it has changed — steady, and further than
 * REARM_NEW_MIN from the back — which is what turning it face up in place
 * looks like. A track that departs takes its hold with it.
 */
export function decideAutoCapture(
  lock: { id: number; quad: Quad } | null,
  look: CardLook | null,
  memory: {
    refractory: ReadonlySet<number>
    busy: boolean
    regions: CapturedRegions
    rearm: LookRearm
    /** Tracks whose lock showed a card back (AutoCaptureVerdict.cardBack). */
    cardBacks?: ReadonlySet<number>
  },
): AutoCaptureVerdict {
  const refractory = !!lock && memory.refractory.has(lock.id)
  const regionLooks = lock ? memory.regions.suppressingLooks(lock.quad) : []
  const repeat = refractory || regionLooks.length > 0
  const backNow = !!lock && isCardBackLook(look)
  const backHeld = !!lock && !!memory.cardBacks?.has(lock.id)
  const refusers = [
    ...(refractory ? [memory.rearm.lookOfTrack(lock!.id)] : []),
    ...regionLooks,
    ...(backHeld ? [CARD_BACK_LOOK] : []),
  ]
  const newByLook = memory.rearm.judge(lock?.id ?? null, look, refusers)
  const cardBack = backNow || (backHeld && !newByLook)
  return { fire: !!lock && !memory.busy && !cardBack && (!repeat || newByLook), repeat, newByLook, cardBack }
}
