// THE AUTO-CAPTURE DECISION for one detect tick, as a function — so the offline
// replay (scripts/scan-bench/video) runs THIS and not a copy of Scan.tsx's
// rules, for the reason regions.ts gives at length: a re-implementation can
// agree with a test and disagree with the product.
//
// Scan.tsx owns the three memories (the refractory set, the captured regions,
// the look re-arm) and the busy flag; this only reads them and says whether
// the tick's lock fires.

import type { Quad } from '../engine/contract'
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
}

/**
 * Call once per detect tick, lock or not — the re-arm's steadiness is measured
 * tick to tick — after the refractory set has dropped departed tracks and the
 * regions have been ticked. Fires when there is a lock, nothing is busy, and
 * the lock is either not a repeat or a different card by look.
 */
export function decideAutoCapture(
  lock: { id: number; quad: Quad } | null,
  look: CardLook | null,
  memory: { refractory: ReadonlySet<number>; busy: boolean; regions: CapturedRegions; rearm: LookRearm },
): AutoCaptureVerdict {
  const refractory = !!lock && memory.refractory.has(lock.id)
  const regionLooks = lock ? memory.regions.suppressingLooks(lock.quad) : []
  const repeat = refractory || regionLooks.length > 0
  const refusers = repeat ? [...(refractory ? [memory.rearm.lookOfTrack(lock!.id)] : []), ...regionLooks] : []
  const newByLook = memory.rearm.judge(lock?.id ?? null, look, refusers)
  return { fire: !!lock && !memory.busy && (!repeat || newByLook), repeat, newByLook }
}
