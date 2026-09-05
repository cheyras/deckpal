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
// So a captured region is remembered, FOLLOWS the card while it is still there,
// and is retired only once the card has been gone for `departureMs` — a genuine
// departure, not an elapsed duration.
//
// ── WHAT "STILL THERE" IS ALLOWED TO MEAN (owner session 1, 2026-09-04) ──────
//
// It used to mean OVERLAP: a region followed and refreshed against any track
// overlapping it at >= REGION_SAME_IOU. That is unsound, and the owner's first
// real session measured exactly how unsound. Over its 176 recorded quads, with
// each consecutive pair labelled by re-rectifying both frames and correlating
// the card images (>= 0.75 correlation = provably the same card, < 0.5 =
// provably a different one):
//
//   follow at IoU >=   adopts a REAL CARD CHANGE   keeps a same-card follow
//        0.3                    88 %                        100 %
//        0.5  (shipped)         63 %                         93 %
//        0.7                    15 %                         74 %
//        0.8                     3 %                         46 %
//
// There is no threshold that separates them, because overlap is not identity: a
// reader working a stack puts the next card almost exactly where the last one
// was. The consequence in the session was total — the previous card's region
// ADOPTED its replacement, refreshed, adopted the one after that, and never
// expired. 115 of 134 locks were suppressed, regions ran 11 deep, and the
// "at most 12 s" cost this module priced below became UNBOUNDED for as long as
// the reader kept feeding the same spot. Nine seconds into the session the very
// first swap (a Shaymin captured, a different card put down in its place) was
// suppressed for its entire 11-second presentation and never captured at all.
//
// So the follow is gated on IDENTITY instead: a region remembers the TRACK it
// was captured from and follows THAT track, by id, wherever it goes. Any other
// track — however much it overlaps — neither moves the region nor refreshes it.
//
// ── BUT TRACK IDS ARE EXACTLY WHAT DEFEATED THE ORIGINAL REFRACTORY ──────────
//
// They are, and that is why the id gates the FOLLOW and not the SUPPRESSION.
// Round 3 measured the churn: one physical card, continuously in frame, ran
// through 15 distinct track ids in 41 locks. A refractory keyed on the id alone
// fires again on every rebirth, which is the 2026-09-04 drive's nine captures of
// one card. Here the id only decides whether the region's clock is refreshed;
// while it is alive the region suppresses by OVERLAP, so a rebirth inside
// `departureMs` is still refused. The id buys the fix; the timer absorbs the
// churn. Measured on the same two fixtures (`__tests__/e2e-round3-
// regressions.test.ts` and `__tests__/owner-session-regressions.test.ts`):
//
//                                   owner session          round-3 card run
//                            fires  dup  manual presses    captures of ONE card
//                                        it would have     (shipped build at
//                                        saved (of 21)      900 ms took 9)
//   follow on overlap          16    1        4                   4
//   follow on track identity   31    5        8                   6
//   no region at all           52   11       10                   9
//
// Four more of the owner's manual presses become automatic — of the ten any
// region policy could ever reach, because the rest fail the saturation or
// shape/straddle gates and never lock at all — for four more duplicate captures
// there and two more on round 3's synthetic one-card loop. That is the trade,
// taken deliberately: a duplicate costs a row in a review feed the reader is
// already reading, and a suppression costs a card the product silently refused
// to scan.

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
 *
 * ── THAT ROUND HAPPENED (owner session 1) AND THE COST WAS NOT BEING PAID ────
 *
 * Everything above is about how long a DEPARTED card stays remembered, and it
 * still holds. What it assumed — that the region would eventually be left alone
 * long enough to depart — is what the header's follow rule made untrue. Under
 * the identity-gated follow the price quoted above is finally the price paid, so
 * this constant means what it says.
 *
 * A SWEEP OF THIS CONSTANT under the new follow rule, against the owner session
 * (manual presses the policy would have made automatic, of 21; duplicate
 * captures) and round 3's card run (captures of ONE card; the shipped 900 ms
 * build took 9):
 *
 *    10 s  ->  8 rescued,  7 dup,  round-3 6
 *    12 s  ->  8 rescued,  4 dup,  round-3 6      <- shipped
 *    14 s  ->  9 rescued,  3 dup,  round-3 6
 *    15 s  ->  8 rescued,  2 dup,  round-3 6
 *    20 s  ->  7 rescued,  4 dup,  round-3 5
 *
 * 12-15 s is a plateau, and 12 s is already what round 3's dropout measurement
 * demands, so it is deliberately left alone: the FOLLOW RULE is the finding, and
 * re-tuning a constant on top of a changed mechanism would confound the two.
 */
export const REGION_DEPARTURE_MS = 12_000

/**
 * THE RE-ANCHOR BRIDGE: how recently a region's card must have been seen for a
 * track standing on the region to be treated as that card REBORN rather than a
 * replacement.
 *
 * ── WHY THE IDENTITY FOLLOW NEEDED THIS (e2e round 5, 2026-09-04) ───────────
 *
 * The identity gate above fixed adoption and round 5 measured what it broke:
 * the tracker re-ids a continuously-present card every few seconds (round 3:
 * fifteen ids on one card), so a region whose own track dies FREEZES — nothing
 * refreshes it, it expires at `departureMs` with the card still sitting on it,
 * and the next lock is a duplicate capture. Same clip, same 124 s: round 4
 * (overlap follow) took 5 captures, round 5 (identity follow) took 10, with
 * `regionsExpired` 3 -> 9. Two of the duplicates fired 4.3 s and 4.5 s after
 * the previous capture at quad IoU 0.64 and 0.84 — only a region expiring
 * under a present card can do that.
 *
 * ── WHAT SEPARATES A REBIRTH FROM A SWAP IS TIME, NOT OVERLAP ────────────────
 *
 * Overlap cannot tell them apart (the header: 63 % adoption at 0.5, no
 * threshold separates). But the GAP can: a re-id rebirth is the tracker
 * dropping and re-acquiring a card that never left — the old track dies after
 * `graceFrames` (240 ms) of misses and the replacement appears within a tick
 * or two, so the region has been sighted within well under a second. A
 * physical swap needs a hand to lift one card and place another: the owner
 * session's first swap shows a >= 3.6 s sighting gap even at the lock
 * recorder's coarse granularity. So: a track at >= `sameIoU` on a region whose
 * card was seen within `bridgeMs` re-anchors the region (new id, refreshed
 * clock); after `bridgeMs` the region is frozen exactly as before and retires
 * on the departure clock. Long detector dropouts (4.7-11.4 s on round 3's own
 * fixture) exceed any defensible bridge on purpose — during them there is no
 * track to adopt anyway, and a rebirth AFTER one arrives past the bridge and
 * stays unadopted, which is the conservative side.
 *
 * 1 500 ms is ~12 detect ticks: 6x the tracker's own grace, comfortably under
 * the fastest measured swap. The cost that remains is a swap completed inside
 * 1.5 s of the old card's last sighting AND placed at >= 0.5 IoU — that card
 * inherits the region and is suppressed until departure, bounded by
 * `departureMs`, manual Capture never gated. The owner-session replay
 * (`__tests__/owner-session-regressions.test.ts`) fences both sides: the
 * first swap must still capture, and the rescued manual presses must hold.
 */
export const REGION_BRIDGE_MS = 1_500

/**
 * THE SUPPRESSION THRESHOLD: "this lock is close enough to a live region to be
 * the card that region holds, so do not capture it".
 *
 * It used to answer a second question as well — "this track is the card the
 * region holds, so follow it" — and the header explains at length why it cannot.
 * Overlap adopts 63 % of real card changes at 0.5 and there is no value that
 * separates, so the FOLLOW is gated on track identity now and this number has
 * one job again.
 *
 * 0.5 is right for the job it kept. Consecutive quads of one card 120 ms apart
 * overlap almost completely, so a re-lock on the card just captured is refused
 * comfortably, while a card placed somewhere genuinely else is not: over the
 * owner session's 176 quads, consecutive pairs that are provably the same card
 * sit at IoU 0.79 median (p05 0.48) and provably-different pairs at 0.56 median
 * — which is exactly why this is a fine SUPPRESSION bar (paired with a 12 s
 * clock that bounds it) and was a hopeless IDENTITY test.
 */
export const REGION_SAME_IOU = 0.5

/** A live track, as `tick` needs it: the tracker's own id plus its quad. The id
 *  is what makes "the card this region holds is still here" a question with an
 *  answer — see the header on why overlap could not be that answer. */
export interface RegionTrack {
  id: number
  quad: Quad
}

export interface CapturedRegions {
  /**
   * Refresh every remembered region against this tick's tracks, then retire the
   * ones whose OWN TRACK has been gone for `departureMs`. Call once per ENGINE
   * TICK — that is what makes the presence signal dense enough to be the clock.
   *
   * A region is refreshed by the track it was captured from, found by id —
   * plus one exception: within REGION_BRIDGE_MS of last sighting, a track
   * standing on the region may re-anchor it (the tracker re-iding a card that
   * never left). Any other newcomer landing on the same spot is still
   * SUPPRESSED (that is `suppressed`'s job, and the region is still alive) but
   * cannot keep the region alive, which is what let one region swallow a whole
   * session.
   *
   * Returns how many regions retired on this tick, so the caller can record
   * expiries as telemetry without reaching inside.
   */
  tick(now: number, tracks: readonly RegionTrack[]): number
  /** Is this quad the card one of the live regions already holds? */
  suppressed(quad: Quad): boolean
  /**
   * Remember a capture's place AND the track it came from. The track id is what
   * the region will answer "is my card still here?" with for the rest of its
   * life; a capture whose track is already gone simply never gets refreshed and
   * retires on the clock, which is the correct behaviour for it.
   */
  note(quad: Quad, trackId: number, now: number): void
  /** Live regions. */
  readonly count: number
  /** Cumulative retirements since `reset()` — the telemetry counter. */
  readonly expired: number
  /** ms since the most recent retirement, or null if none has happened. */
  msSinceExpiry(now: number): number | null
  reset(): void
}

export function createCapturedRegions(
  opts: { departureMs?: number; sameIoU?: number; bridgeMs?: number } = {},
): CapturedRegions {
  const departureMs = opts.departureMs ?? REGION_DEPARTURE_MS
  const sameIoU = opts.sameIoU ?? REGION_SAME_IOU
  const bridgeMs = opts.bridgeMs ?? REGION_BRIDGE_MS
  let regions: Array<{ quad: Quad; trackId: number; lastSeen: number }> = []
  let expired = 0
  let lastExpiryAt: number | null = null

  return {
    tick(now, tracks) {
      for (const r of regions) {
        // BY ID, NOT BY OVERLAP. The region follows the card it was captured
        // from — wherever the tracker says that card now is, including right
        // across the frame, because a card that travelled is still that card and
        // suppression must travel with it. No IoU gate here on purpose: gating
        // the follow on overlap is what let a region hand itself to the next
        // card in the stack (header), and gating it on overlap AND id would
        // additionally lose the card that moves fast under a hand.
        const mine = tracks.find((t) => t.id === r.trackId)
        if (mine) {
          r.quad = mine.quad
          r.lastSeen = now
        } else if (now - r.lastSeen <= bridgeMs) {
          // THE RE-ANCHOR BRIDGE (see REGION_BRIDGE_MS): the region's own track
          // just died. A track standing on the region this soon after the card
          // was last seen is the tracker re-iding a card that never left — the
          // region re-anchors to it. Past the bridge it is a departure or a
          // swap, and the region freezes as before.
          let best: RegionTrack | null = null
          let bestIoU = sameIoU
          for (const t of tracks) {
            const iou = polyIoU(t.quad, r.quad)
            if (iou >= bestIoU) {
              bestIoU = iou
              best = t
            }
          }
          if (best) {
            r.trackId = best.id
            r.quad = best.quad
            r.lastSeen = now
          }
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
    note(quad, trackId, now) {
      regions.push({ quad, trackId, lastSeen: now })
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
