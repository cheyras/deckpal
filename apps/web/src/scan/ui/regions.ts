// THE CAPTURED-REGION REFRACTORY — the duplicate-capture policy, as a module.
//
// ── WHY THIS IS NOT INLINE IN Scan.tsx ANY MORE ─────────────────────────────
//
// It was, and the round-2 regression test had to re-implement it to measure it
// ("Scan.tsx's captured-region policy, reproduced exactly"). A re-implementation
// is not evidence: it can agree with a test and disagree with the product, which
// is the exact failure mode `index.ts` calls out where it exports
// `inferenceTransform` and `createLockPolicy` so "the offline harness measures
// the SHIPPING decision rather than a re-implementation of it". The round-3
// drive turned this suppression into the headline number, so the replay that
// sizes it must drive the real thing.
//
// ── WHY IT IS NOT A TIMER ───────────────────────────────────────────────────
//
// The first attempt was a 2.5 s window, and it suppressed NOTHING: the e2e
// drive's round 2 put one Basic Fighting Energy in front of the camera for 58
// seconds and got 15 auto-captures out of it, every consecutive pair 2.72 s or
// further apart. The window had always expired before the next lock arrived.
//
// The 2.5 s came from round 1's reported "0.2 s and 0.3 s apart", which were
// measured on the flag `id` — the SERVER's upload timestamp, lagging the capture
// clock by ~1.8 s behind a PNG encode and an ~850 KB POST. On the capture clock
// (`meta.epochMs`) round 1's tightest real gap was 1.89 s. The number was sized
// against an artefact of the recorder's own latency.
//
// A LONGER timer is still the wrong shape. The drive's re-lock cadence on ONE
// continuously-presented card runs 2.7 s to 17 s. A window wide enough to cover
// 17 s would also refuse a genuinely new card for 17 s, which breaks scanning a
// stack. There is no width that separates them, because TIME is not what
// distinguishes the two cases.
//
// PRESENCE is. A card that never left the reticle is the same card, however long
// it sits there; a card that left and was replaced is a new one, however quickly.
// So a captured region is remembered, FOLLOWS the card while anything keeps
// overlapping it, and is retired only once nothing has overlapped it for
// `departureMs` — a genuine departure, not an elapsed duration. Track ids are
// never consulted, so the tracker churn that defeated the original refractory is
// irrelevant.

import type { Quad } from '../engine/contract'
import { polyIoU } from '../engine/geometry'

/**
 * How long nothing may overlap a remembered region before it is retired.
 *
 * ── 900 ms WAS SIZED AGAINST THE WRONG FAILURE, AND ROUND 3 MEASURED IT ─────
 *
 * 900 ms was chosen as "about seven detect ticks, enough to ride out the
 * tracker's two-tick coasting grace plus a few missed detections". That
 * description is accurate and the number was still far too small, because the
 * dropout it actually has to survive is not a few missed detections — it is the
 * detector losing a continuously-present card for SECONDS.
 *
 * The 2026-09-04 e2e drive's round 3 shipped 900 ms and instrumented it, and the
 * telemetry is unambiguous. The mechanism was perfect: 32 of 41 lock-events
 * `suppressedByRegion`, `regionCount` 1 for every suppressed lock and 0 for
 * every free one, no exceptions in 41 events. And one physical card, in frame in
 * essentially every second of the clip, still produced NINE captures — because
 * every one of the nine free locks was preceded by a stretch in which the engine
 * held no lock at all:
 *
 *   dropout before each free lock   4.67  4.85  5.20  5.39  8.63  8.86  11.21  11.37  s
 *
 * Three to twelve times the 900 ms window. The region was retired long before
 * the card came back, so each re-acquisition read as a fresh presentation.
 *
 * ── 12 s, AND WHY EXACTLY ───────────────────────────────────────────────────
 *
 * The constant has to exceed the longest measured lock dropout, which is
 * 11.37 s. 12 s is the smallest round number that does. Replaying round 3's own
 * event timeline at the engine's tick cadence (`__tests__/e2e-round3-
 * regressions.test.ts`, and the replay reproduces the shipped build's 9 captures
 * exactly at 900 ms, which is what makes it a model rather than a guess):
 *
 *   departure     900 ms -> 9 captures   (the shipped build, reproduced)
 *   departure   3 000 ms -> 7
 *   departure   5 000 ms -> 6
 *   departure  10 000 ms -> 4
 *   departure  12 000 ms -> 4   <- and flat from here to 30 s
 *
 * Four, of which THREE are the fixture looping — the clip is 58 s and the run is
 * 2.15 passes of it, so the card genuinely leaves the frame and re-enters at
 * t≈0, 58 and 116 s, and those are three of the four survivors. One residual
 * duplicate remains, at t≈98.7 s. Six spurious captures become one.
 *
 * The clutter run is untouched at every value from 0.9 s to 30 s: its two
 * captures are 51 s apart with the object genuinely gone in between, so both are
 * still taken. Widening this constant costs that run nothing.
 *
 * ── THE COST, STATED PLAINLY ────────────────────────────────────────────────
 *
 * THE FAST-SWAP COST: a DIFFERENT card placed on the same spot within 12 s, at
 * more than REGION_SAME_IOU overlap with where the last one was captured, is
 * SUPPRESSED until the region expires. It will not auto-capture. That is a real
 * regression against a reader who deals cards onto one fixed spot quickly, and
 * it is the price of covering an 11 s detector dropout — the two are the same
 * measurement viewed from opposite ends, and no value of this constant can be
 * generous to both.
 *
 * THE ESCAPE HATCH IS MANUAL CAPTURE, and it is not a consolation. The region
 * gates the AUTOMATIC fire only: the swapped card is still detected, still
 * tracked, still drawn under the reticle, and the Capture button takes it
 * immediately with `trigger: 'manual'`. Nothing is unreachable; what is lost is
 * "it fires by itself", for at most 12 s, in the one spot a card was just taken
 * from.
 *
 * Note also that the three genuine re-entries above are taken because the card
 * comes back in a MATERIALLY DIFFERENT POSE (IoU 0.39-0.41 against the stored
 * region), not because 12 s elapsed. Overlap is doing the work; the timer is
 * only the backstop for a card that returns to the same pose. A future round
 * with real-camera footage should re-measure both halves before moving either.
 */
export const REGION_DEPARTURE_MS = 12_000

/**
 * The single overlap threshold, used for BOTH "this track is the card the region
 * holds, so follow it" and "this lock is that card again, so do not capture it".
 * One number, because they are the same question, and a looser follow threshold
 * is actively dangerous: replaying the drive's clutter run with follow at 0.3
 * let a region JUMP onto the next object that wandered near it and then suppress
 * that object's own first capture. A region must only ever follow something it
 * would also recognise as itself.
 *
 * 0.5 is comfortable at the tick rate this runs at: consecutive quads of one
 * card 120 ms apart overlap almost completely, so following is easy, while two
 * adjacent cards in a stack overlap far less.
 */
export const REGION_SAME_IOU = 0.5

export interface CapturedRegions {
  /**
   * Refresh every remembered region against this tick's tracks, then retire the
   * ones nothing has overlapped for `departureMs`. Call once per ENGINE TICK —
   * that is what makes the presence signal dense enough to be the clock.
   *
   * Returns how many regions retired on this tick, so the caller can record
   * expiries as telemetry without reaching inside.
   */
  tick(now: number, tracks: readonly { quad: Quad }[]): number
  /** Is this quad the card one of the live regions already holds? */
  suppressed(quad: Quad): boolean
  /** Remember a capture's place. */
  note(quad: Quad, now: number): void
  /** Live regions. */
  readonly count: number
  /** Cumulative retirements since `reset()` — the telemetry counter. */
  readonly expired: number
  /** ms since the most recent retirement, or null if none has happened. */
  msSinceExpiry(now: number): number | null
  reset(): void
}

export function createCapturedRegions(
  opts: { departureMs?: number; sameIoU?: number } = {},
): CapturedRegions {
  const departureMs = opts.departureMs ?? REGION_DEPARTURE_MS
  const sameIoU = opts.sameIoU ?? REGION_SAME_IOU
  let regions: Array<{ quad: Quad; lastSeen: number }> = []
  let expired = 0
  let lastExpiryAt: number | null = null

  return {
    tick(now, tracks) {
      for (const r of regions) {
        let best: Quad | null = null
        let bestIoU = sameIoU
        for (const t of tracks) {
          const iou = polyIoU(r.quad, t.quad)
          if (iou >= bestIoU) {
            bestIoU = iou
            best = t.quad
          }
        }
        if (best) {
          // Follow the drift: the card is allowed to wander under the hand
          // without ever escaping its own region.
          r.quad = best
          r.lastSeen = now
        }
      }
      const before = regions.length
      regions = regions.filter((r) => now - r.lastSeen < departureMs)
      const gone = before - regions.length
      if (gone > 0) {
        expired += gone
        lastExpiryAt = now
      }
      return gone
    },
    suppressed(quad) {
      return regions.some((r) => polyIoU(r.quad, quad) >= sameIoU)
    },
    note(quad, now) {
      regions.push({ quad, lastSeen: now })
    },
    get count() {
      return regions.length
    },
    get expired() {
      return expired
    },
    msSinceExpiry(now) {
      return lastExpiryAt === null ? null : now - lastExpiryAt
    },
    reset() {
      regions = []
      expired = 0
      lastExpiryAt = null
    },
  }
}
