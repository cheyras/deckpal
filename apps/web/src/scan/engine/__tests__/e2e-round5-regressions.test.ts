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
//   never refreshed, expired with the card still on it, and the next lock
//   fired as a duplicate — two of them 4.3 s and 4.5 s after the previous
//   capture at quad IoU 0.64 and 0.84, which only an expiry under a present
//   card can produce.
//
// The fix then was REGION_BRIDGE_MS: a track standing on a region within the
// bridge of the card's last sighting re-anchored it (a rebirth); past the
// bridge nothing did (a departure or a swap).
//
// RE-BASELINED 2026-11-27 (decision "a flip is always captured"). The regions
// and their bridge are gone; the presentation episode (scan/ui/presentation.ts)
// replaced them, and it never asks the tracker who a card is. It reads the
// LOOK on the card's spot: a card re-id'd every few seconds is the same look,
// still there, and is never taken again; a different card on the spot is a
// different look, and is taken however quickly it arrived. The same shapes,
// driven against the replacement:
//
//   the round-5 defect (id churn under a present card)    duplicate -> none
//   a swap faster than the bridge (1.5 s)                  adopted   -> taken
//   a rebirth after a long detector dropout                duplicate after
//                                                          the window -> none
//                                                          (the spot look)

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { Quad } from '../contract'
import { polyIoU } from '../geometry'
import type { CardLook } from '../look'
import { createPresentation, EPISODE_IOU } from '../../ui/presentation'
import { lookOf } from '../../ui/__tests__/lookScenes'

const TICK_MS = 120

const card = (dx = 0, dy = 0): Quad => [
  [100 + dx, 100 + dy],
  [280 + dx, 100 + dy],
  [280 + dx, 351 + dy],
  [100 + dx, 351 + dy],
]
const A = lookOf(1)
const B = lookOf(2)
const HAND = lookOf(50)
const held = (i: number): CardLook => [A, lookOf(1, { exposure: 0.95 }), lookOf(1, { shift: 2 })][i % 3]!

/** A presentation machine with card A captured at t = 0, on track 1. */
function captured() {
  const p = createPresentation()
  let t = 0
  p.observe({ now: t, lock: { id: 1, quad: card() }, look: A, spotLook: null })
  p.fire({ kind: 'first', now: t, captureId: 'cap-a', trackId: 1, quad: card(), look: A })
  const tick = (lock: { id: number; quad: Quad } | null, look: CardLook | null, spot: CardLook | null) => {
    t += TICK_MS
    return p.observe({ now: t, lock, look: lock ? look : null, spotLook: p.watchQuad() ? spot : null })
  }
  return { p, tick, now: () => t }
}

describe('e2e round 5 — a card the tracker re-ids, never taken again; a card swapped in, always taken', () => {
  it('THE ROUND-5 DEFECT, DRIVEN: id churn every 3 s under a present card takes nothing', () => {
    const { tick } = captured()
    let id = 1
    for (let t = TICK_MS, i = 0; t <= 30_000; t += TICK_MS, i++) {
      if (t % 3_000 < TICK_MS) id++
      const r = tick({ id, quad: card(id % 3, id % 2) }, held(i), held(i))
      assert.equal(r.candidate, null, `t=${t}: track ${id} is the same card`)
      assert.equal(r.state, 'watching')
    }
    assert.ok(id >= 10, `the fixture churned through ${id} ids`)
  })

  it('the episode FOLLOWS its card across a rebirth and a slide, exactly as it does without one', () => {
    const { p, tick } = captured()
    tick({ id: 2, quad: card(4) }, A, A)
    for (let s = 2; s <= 40; s++) assert.equal(tick({ id: 2, quad: card(s * 10) }, held(s), held(s)).state, 'watching')
    assert.ok(polyIoU(p.watchQuad()!, card(400)) >= EPISODE_IOU, 'the spot travelled with the card')
    assert.ok(polyIoU(p.watchQuad()!, card()) < EPISODE_IOU, 'and left the spot it started from')
  })

  it('A SWAP FASTER THAN THE OLD BRIDGE IS TAKEN: a different card on the spot, half a second later', () => {
    // The bridge's fence was "past it, a newcomer on the spot is never adopted"
    // — and inside it (1.5 s) one was. Here the hand takes 250 ms.
    const { tick } = captured()
    for (let i = 0; i < 4; i++) tick({ id: 1, quad: card() }, held(i), held(i))
    tick(null, null, HAND)
    tick(null, null, HAND)
    const swapped = card(10)
    assert.ok(polyIoU(card(), swapped) >= EPISODE_IOU, 'the swap really is on the spot')
    let kind = null
    let n = 0
    while (!kind && n < 6) {
      kind = tick({ id: 2, quad: swapped }, B, B).candidate
      n++
    }
    assert.equal(kind, 'disturbed')
    assert.ok(n <= 3, `taken on its third steady tick at most (${n})`)
  })

  it('...and one swapped in with no hand seen at all, on the very next tick, still is', () => {
    // The tracker keeps the id (round 5's own churn says it may not, the stack
    // video 46OLXH5 says it can). The look changes from A to B between two
    // ticks: two hard ticks (B is far from A), a break, and B settles.
    const { tick } = captured()
    for (let i = 0; i < 4; i++) tick({ id: 1, quad: card() }, held(i), held(i))
    let kind = null
    for (let i = 0; i < 6 && !kind; i++) kind = tick({ id: 1, quad: card() }, B, B).candidate
    assert.equal(kind, 'disturbed')
  })

  it('a rebirth AFTER a long detector dropout over the untouched card is the same card', () => {
    // Round 3 measured 4.7-11.4 s dropouts with NO track at all on a present
    // card. The regions froze and let a late re-lock fire as a duplicate once
    // their window ran out. The spot look reads the card that is still there.
    const { tick } = captured()
    for (let t = 0; t < 11_400; t += TICK_MS) assert.equal(tick(null, null, held(t)).state, 'watching')
    const r = tick({ id: 2, quad: card() }, A, A)
    assert.equal(r.candidate, null, 'no duplicate after the dropout')
  })
})
