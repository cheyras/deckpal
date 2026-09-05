// Regression for the one defect the 2026-09-04 e2e drive's FIFTH round found —
// the handover gate said NO on exactly this.
//
// Round 5 proved the display fix four ways (painted reticle centre within
// 0.2 px of the box centre at two viewports, painted quad = the engine's
// canonical quad to 0.01 px, the displayed box IS the canonical crop), held
// straddles at zero for a fourth round, put the matcher outcome on 14/14
// captures, and posted the best jitter tail of any round. What it broke:
//
//   THE IDENTITY FOLLOW FROZE REGIONS ON DEAD TRACK IDS. Same clip and
//   duration as round 4, 19 distinct track ids in both, and captures went
//   5 -> 10 with `regionsExpired` 3 -> 9. The tracker re-ids a continuously
//   present card every few seconds; a region anchored to the dead id was
//   never refreshed, expired at REGION_DEPARTURE_MS with the card still on
//   it, and the next lock fired as a duplicate — two of them 4.3 s and 4.5 s
//   after the previous capture at quad IoU 0.64 and 0.84, which only an
//   expiry under a present card can produce.
//
// The fix is REGION_BRIDGE_MS (regions.ts): a track standing on a region
// within the bridge of the card's last sighting re-anchors the region (a
// rebirth); past the bridge nothing does (a departure or a swap). These tests
// drive the failure shape directly, because the lock-stream replays in the
// round-2/3/owner files are throttled to 2 s and cannot see sub-second
// rebirths at all — the round-3 replay scores 6 captures under BOTH follow
// rules while the live build took 10. The live number is the re-drive's to
// verify; the mechanism is fenced here.

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { Quad } from '../contract'
import { polyIoU } from '../geometry'
import {
  createCapturedRegions,
  REGION_BRIDGE_MS,
  REGION_DEPARTURE_MS,
  REGION_SAME_IOU,
} from '../../ui/regions'

const TICK_MS = 120

const card = (dx = 0, dy = 0): Quad => [
  [100 + dx, 100 + dy],
  [280 + dx, 100 + dy],
  [280 + dx, 351 + dy],
  [100 + dx, 351 + dy],
]

/** One continuously present card whose track id is reborn every `churnMs`,
 *  with the rebirth arriving on the very next tick — the live shape: the
 *  detector never stops seeing the card, only the tracker's id changes. */
function churnTick(R: ReturnType<typeof createCapturedRegions>, untilMs: number, churnMs: number) {
  let id = 1
  for (let t = 0; t <= untilMs; t += TICK_MS) {
    if (t > 0 && t % churnMs < TICK_MS) id++
    R.tick(t, [{ id, quad: card(id % 3, id % 2) }])
  }
  return id
}

describe('e2e round 5 — a region must survive the tracker re-iding a card that never left', () => {
  it('THE DEFECT, REPRODUCED: without the bridge, churn expires the region under a present card', () => {
    const R = createCapturedRegions({ bridgeMs: 0 })
    R.tick(0, [{ id: 1, quad: card() }])
    R.note(card(), 1, 0)
    // Id churns every 3 s; the card itself never leaves. The round-5 build
    // froze here: nothing refreshed the region past the first rebirth.
    churnTick(R, 20_000, 3_000)
    assert.equal(R.expired, 1, 'the frozen region expired with the card still on it')
    assert.ok(!R.suppressed(card()), 'and the next lock is a duplicate capture — the defect')
  })

  it('THE FIX: the bridge re-anchors across every rebirth and the card stays suppressed', () => {
    const R = createCapturedRegions()
    R.tick(0, [{ id: 1, quad: card() }])
    R.note(card(), 1, 0)
    const lastId = churnTick(R, 30_000, 3_000)
    assert.ok(lastId >= 10, `the fixture churned through ${lastId} ids`)
    assert.equal(R.expired, 0, 'a continuously present card never expires its region')
    assert.ok(R.suppressed(card()), 'no duplicate: the region followed the card through every rebirth')
  })

  it('the re-anchored region FOLLOWS its new track, exactly as an original one would', () => {
    const R = createCapturedRegions()
    R.tick(0, [{ id: 1, quad: card() }])
    R.note(card(), 1, 0)
    // Rebirth on the next tick, then the card slides across the frame.
    R.tick(TICK_MS, [{ id: 2, quad: card(4) }])
    for (let t = 2; t <= 40; t++) R.tick(t * TICK_MS, [{ id: 2, quad: card(t * 10) }])
    assert.ok(R.suppressed(card(400)), 'suppression travelled with the re-anchored track')
    assert.ok(!R.suppressed(card()), 'and left the spot it started from')
  })

  it('THE FENCE THE BRIDGE MUST NOT CROSS: past it, a newcomer on the spot is never adopted', () => {
    // A swap: the card leaves (track dies), a hand takes longer than the
    // bridge, a different card lands on the same spot. The region must freeze
    // — suppression continues while it lives, but its clock must run out at
    // departure, NOT be refreshed by the newcomer. Adoption here is the owner
    // session's disaster (regions.ts header: one region swallowed 115 locks).
    const R = createCapturedRegions()
    R.tick(0, [{ id: 1, quad: card() }])
    R.note(card(), 1, 0)
    const gone = REGION_BRIDGE_MS + 2 * TICK_MS
    R.tick(gone, []) // the bridge window passes with nothing on screen
    const swapped = card(10)
    assert.ok(polyIoU(card(), swapped) >= REGION_SAME_IOU, 'the swap really is on the spot')
    // The newcomer sits there well past the departure window. If it were
    // adopted, the region would refresh forever; frozen, it must retire
    // exactly one departure window after the ORIGINAL card was last seen.
    for (let t = gone; t <= REGION_DEPARTURE_MS + 4 * TICK_MS; t += TICK_MS) {
      R.tick(t, [{ id: 2, quad: swapped }])
    }
    assert.equal(R.expired, 1, 'the region retired on its own clock despite the newcomer')
    assert.ok(!R.suppressed(swapped), 'and the replacement card is capturable')
  })

  it('the bridge is sized between the tracker grace and a human swap, and stays put', () => {
    // 240 ms is the tracker's own coasting grace (graceFrames 2 x 120 ms) —
    // any rebirth takes at least one dead tick, so the bridge must exceed it
    // with room. 3.6 s is the owner session's fastest measured sighting gap
    // across a real swap; the bridge must sit well under it so no measured
    // swap re-anchors. Both bounds are measurements, not taste.
    assert.ok(REGION_BRIDGE_MS >= 3 * 240, `bridge ${REGION_BRIDGE_MS} must cover a rebirth with margin`)
    assert.ok(REGION_BRIDGE_MS <= 2_000, `bridge ${REGION_BRIDGE_MS} must stay under the fastest measured swap`)
  })

  it('a rebirth AFTER a long detector dropout is not re-anchored — conservative on purpose', () => {
    // Round 3 measured 4.7-11.4 s dropouts with NO track at all on a present
    // card. A rebirth after one of those arrives past the bridge: the region
    // is frozen, lives out its departure clock, and a late re-lock may fire.
    // That duplicate is the price of not adopting swaps; it existed under the
    // overlap follow too (round 4 kept 2 residuals) and only the departure
    // clock can absorb it.
    const R = createCapturedRegions()
    R.tick(0, [{ id: 1, quad: card() }])
    R.note(card(), 1, 0)
    const back = REGION_BRIDGE_MS + 5 * TICK_MS
    for (let t = TICK_MS; t < back; t += TICK_MS) R.tick(t, [])
    R.tick(back, [{ id: 2, quad: card() }])
    // Still suppressed (the region is alive) but NOT re-anchored: the clock
    // keeps running from t=0 and the region retires at departure.
    assert.ok(R.suppressed(card()), 'inside the departure window the spot is still suppressed')
    for (let t = back + TICK_MS; t <= REGION_DEPARTURE_MS + 2 * TICK_MS; t += TICK_MS) {
      R.tick(t, [{ id: 2, quad: card() }])
    }
    assert.equal(R.expired, 1, 'the frozen region retired on the departure clock')
  })
})
