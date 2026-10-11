// THE LOOK RE-ARM — the one case the duplicate policy refuses that it should not.
//
// Auto-capture refuses a lock as a REPEAT two ways: the track was already
// captured (Scan.tsx's refractory) or its quad sits on a captured region
// (regions.ts). Both stand on geometry, and a stack defeats geometry: the next
// card lands where the last one was, the tracker keeps the track id across the
// swap because the quad barely moved, and the new card is refused for as long
// as it sits there. regions.ts measured the place half of this on owner session
// 1 ("overlap is not identity") and fixed the place half; the track half is
// this file.
//
// THE RULE. A lock refused ONLY as a repeat fires anyway when the card in it
// LOOKS different (engine/look.ts, distance > REARM_NEW_MIN) from EVERY capture
// behind the refusal — the capture taken on this track, if the refractory
// refused it; the capture of each live region it overlaps, if a region did —
// and its look has held still since the last time that track was locked
// (<= REARM_STEADY_MAX), so a card mid-slide, half covering the one beneath,
// is not a new card yet. Busy still waits; the clutter gates upstream are
// untouched; nothing that would have fired stops firing. A refusal whose
// capture has no look is kept: "cannot tell" refuses.
//
// WHY ONLY THE CAPTURES BEHIND THE REFUSAL. Two unrelated cards land within
// 1.0 of each other about one time in six, so comparing against every recent
// capture makes a chance look-alike likely the longer the session runs. The
// question a refusal raises is narrower, and it is the only one asked here:
// is THIS the card that was captured HERE? Steadiness is "since the track was
// last locked", not "since the last tick": a lock blinks off for a tick
// whenever its track coasts.
//
// A CAPTURE THAT CAME OUT TURNED. capture() warps from the corner nearest the
// frame's top-left (rectify.orderQuadForCard), so a card lying, or swinging,
// past 45° is captured sideways or upside down — 3 of owner session 1's 42
// captures — and its look is then far from the very card it is: a Marill
// re-captured twice behind its own sideways capture, at 1.45 and 1.51. So a
// capture's look carries its four quarter turns and is compared at the
// nearest (look.ts captureLook, lookDistance), a turn other than the capture
// as taken costing LOOK_TURN_COST. Without the cost the three extra turns are
// three more draws at a chance look-alike: on the owner's sessions they held 3
// of the 23 new cards the re-arm rescues (Cinccino matched a Skwovet at its
// half turn, 0.77), on two of the videos 3 of 30 captured cards. With it the
// Marill duplicates go and nothing else moves on either: the same card turned
// matched at 0.14-0.57 (scripts/scan-bench/owner-rearm.ts).
//
// THE NUMBERS (scripts/scan-bench/video, 2026-10-10): seven pack-opening and
// flip-through videos replayed through this module, regions.ts and the engine
// as the camera — 192 capturable card appearances with hand-made ground truth,
// auto-ID scored with the identity model's own gate.
//
//                                        captured  auto-ID  duplicates  strays
//   before (lock 3 ticks, no re-arm)        18%      10%         2         8
//   lock 2 ticks + this                     31%      19%         9        10
//   (lock 1 tick + this, not shipped)       39%      21%        14        13
//
// Every run named 0 cards confidently and wrong. REARM_NEW_MIN 1.0 is the
// conservative end of what an earlier sweep measured (0.6 / 0.8 / 1.0): 0.8
// bought three more cards in a hundred for ten more duplicates. A duplicate here costs what regions.ts
// already prices it at — a row in a list the reader reads anyway — and the
// owner ruled (2026-09-07) that two scans of one card are two rows, which is
// also why this does not merge a re-armed capture into the one before it when
// the identifier names the same card: a normal then a reverse holo of one card,
// swapped in place, is exactly that and must stay two scans.

import type { CardLook } from '../engine/look'
import { lookDistance } from '../engine/look'

/** A look further than this from the capture(s) behind a refusal is a different card. */
export const REARM_NEW_MIN = 1.0
/** ...and only once it has held: within this of the same track's look the last time it was locked. */
export const REARM_STEADY_MAX = 0.3
/** Tracks whose last lock look / capture look is kept (a handful are ever live). */
const TRACKS_KEPT = 32

export interface LookRearm {
  /**
   * Once per detect tick, with the lock's track id and look (nulls when there
   * is no lock) and the looks of the captures behind its refusal (empty when
   * it was not refused). True when the lock is a NEW card by look — steady,
   * and far from every one of those — which licenses firing through the
   * refusal. Empty `refusers`, or a null among them, is false.
   */
  judge(trackId: number | null, look: CardLook | null, refusers: ReadonlyArray<CardLook | null>): boolean
  /** A capture fired on this track with this look. */
  note(look: CardLook | null, trackId: number): void
  /** The look of the last capture taken on this track, or null. */
  lookOfTrack(trackId: number): CardLook | null
}

export function createLookRearm(opts: { newMin?: number; steadyMax?: number } = {}): LookRearm {
  const newMin = opts.newMin ?? REARM_NEW_MIN
  const steadyMax = opts.steadyMax ?? REARM_STEADY_MAX
  /** Each recent lock's last look, by track id, newest last. */
  const lastLook = new Map<number, CardLook>()
  /** Each captured track's capture look, newest last. */
  const captured = new Map<number, CardLook>()
  const put = (m: Map<number, CardLook>, k: number, v: CardLook) => {
    m.delete(k)
    m.set(k, v)
    if (m.size > TRACKS_KEPT) m.delete(m.keys().next().value!)
  }
  return {
    judge(trackId, look, refusers) {
      if (trackId === null || !look) return false
      const before = lastLook.get(trackId)
      put(lastLook, trackId, look)
      if (!before || lookDistance(look, before) > steadyMax) return false
      if (!refusers.length) return false
      for (const ref of refusers) if (!ref || lookDistance(look, ref) <= newMin) return false
      return true
    },
    note(look, trackId) {
      if (look) put(captured, trackId, look)
      else captured.delete(trackId)
    },
    lookOfTrack(trackId) {
      return captured.get(trackId) ?? null
    },
  }
}
