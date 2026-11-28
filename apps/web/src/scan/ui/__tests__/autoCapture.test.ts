// The auto-capture decision (autoCapture.ts): the presentation machine says
// whether a lock MAY fire; the gates (busy, card back, size, focus) say whether
// it does now. Card-back holds as before, judged by the machine's steadiness.
// (The card-back cases moved here from rearm.test.ts, 2026-11-27.)
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { lookDistance, type CardLook } from '../../engine/look'
import { createCardBackHolds, decideAutoCapture } from '../autoCapture'
import { createPresentation, HARD_MIN, type Presentation } from '../presentation'
import { CARD_QUAD, lookOf } from './lookScenes'

/** Scan.tsx's wiring of decideAutoCapture for one lock, as the replay mirrors it. */
function rig(id = 4) {
  const presentation = createPresentation()
  const cardBacks = createCardBackHolds()
  let now = 0
  let seq = 0
  const lock = { id, quad: CARD_QUAD }
  const tick = (l: CardLook | null, o: { busy?: boolean; noLock?: boolean; spot?: CardLook | null } = {}) => {
    now += 125
    const v = decideAutoCapture(o.noLock ? null : lock, o.noLock ? null : l, {
      presentation,
      spotLook: presentation.watchQuad() ? (o.spot ?? null) : null,
      now,
      busy: !!o.busy,
      cardBacks,
    })
    if (v.fire) presentation.fire({ kind: v.kind!, now, captureId: `cap-${++seq}`, trackId: lock.id, quad: lock.quad, look: l })
    return v
  }
  return { tick, cardBacks, lock, presentation: presentation as Presentation }
}

const pick = (v: ReturnType<typeof decideAutoCapture>) => ({
  fire: v.fire,
  kind: v.kind,
  cardBack: v.cardBack,
  backReleased: v.backReleased,
  focusWait: v.focusWait,
  tooFar: v.tooFar,
})

/** The measured back with a thumb on it, with a 3x3-cell thumb (skin tone)
 *  over one more corner: a back the hand covers a little more than any
 *  replayed tick did, so it is no longer within CARD_BACK_MAX_DISTANCE. */
function thumbOverCorner(l: Uint8Array): Uint8Array {
  const o = Uint8Array.from(l)
  const cells = 88
  for (let r = 8; r < 11; r++)
    for (let c = 5; c < 8; c++) {
      const k = r * 8 + c
      o[k] = 175
      o[cells + k] = 108
      o[2 * cells + k] = 155
    }
  return o
}

test('decideAutoCapture: the shipping rule, clause by clause', () => {
  const r = rig(7)
  const one = lookOf(1)
  const two = lookOf(2)
  assert.equal(r.tick(null, { noLock: true }).fire, false, 'no lock')
  assert.equal(r.tick(one, { busy: true }).fire, false, 'busy')
  assert.deepEqual(pick(r.tick(one)), { fire: true, kind: 'first', cardBack: false, backReleased: false, focusWait: false, tooFar: false }, 'a fresh lock fires')
  for (let i = 0; i < 40; i++) {
    const v = r.tick(one, { spot: one })
    assert.equal(v.fire, false, 'the same card, still there, never again')
    assert.equal(v.presentation.state, 'watching')
  }
  // A hand takes it away and puts a different card down on the same spot.
  r.tick(null, { noLock: true, spot: lookOf(50) })
  r.tick(null, { noLock: true, spot: lookOf(50) })
  assert.equal(r.tick(two).fire, false, 'a new card, not yet steady')
  assert.equal(r.tick(two).fire, false, 'steady once: settling')
  assert.equal(r.tick(two, { busy: true }).fire, false, 'busy still waits')
  assert.deepEqual(pick(r.tick(two)), { fire: true, kind: 'disturbed', cardBack: false, backReleased: false, focusWait: false, tooFar: false }, 'a new card, settled')
})

test('decideAutoCapture: a card back never fires, and its track is held until it turns into a card', async () => {
  const { CARD_BACK_LOOK, cardBackDistance, rotateLook180 } = await import('../../engine/cardBack')
  const { tick, cardBacks, lock } = rig()
  const face = lookOf(2)
  assert.ok(cardBackDistance(face) > HARD_MIN, 'precondition: the face is nothing like a back')
  assert.deepEqual(pick(tick(CARD_BACK_LOOK)), { fire: false, kind: 'first', cardBack: true, backReleased: false, focusWait: false, tooFar: false }, 'a back locks but does not fire')
  assert.equal(cardBacks.has(lock.id), false, 'one tick of a back refuses that tick but does not hold the track')
  assert.equal(tick(rotateLook180(CARD_BACK_LOOK)).fire, false, 'nor upside down')
  assert.equal(cardBacks.has(lock.id), true, 'two in a row hold it')
  // A thumb slides over it for a tick: the look leaves the template, but the track is held.
  assert.equal(tick(lookOf(5)).cardBack, true, 'a one-tick change is not a card')
  assert.equal(tick(CARD_BACK_LOOK).cardBack, true)
  // Turned face up in place: the first tick of the face is not steady yet, the second is.
  assert.equal(tick(face).fire, false, 'the face has only just appeared')
  assert.deepEqual(pick(tick(face)), { fire: true, kind: 'first', cardBack: false, backReleased: true, focusWait: false, tooFar: false }, 'the face has held: the hold lets go and the lock fires')
  assert.equal(cardBacks.has(lock.id), false, 'and the hold is gone')
  // Fails open: a lock with no look is judged as before.
  const other = rig(9)
  assert.equal(other.tick(null).fire, true)
})

test('decideAutoCapture: an upside-down back with a thumb over a corner never fires', async () => {
  const { CARD_BACK_LOOK, CARD_BACK_MAX_DISTANCE, CARD_BACK_RELEASE_DISTANCE, cardBackDistance, rotateLook180 } = await import('../../engine/cardBack')
  const { BACKS, look } = await import('../../engine/__tests__/cardBackLooks')
  const { tick, cardBacks, lock } = rig()
  const thumbed = rotateLook180(look(BACKS['video lock, thumb on it']))
  const cornered = rotateLook180(thumbOverCorner(look(BACKS['video lock, thumb on it'])))
  const d = cardBackDistance(cornered)
  assert.ok(d > CARD_BACK_MAX_DISTANCE && d < CARD_BACK_RELEASE_DISTANCE, `precondition: not a back by itself, not clear of one (${d.toFixed(3)})`)
  assert.ok(lookDistance(CARD_BACK_LOOK, cornered) > HARD_MIN, 'precondition: an upright-only comparison calls it a different card')
  tick(thumbed)
  tick(thumbed)
  assert.equal(cardBacks.has(lock.id), true)
  for (let i = 0; i < 6; i++) {
    const v = tick(cornered)
    assert.equal(v.fire, false, `tick ${i}: held still with the thumb on it, it is still a back`)
    assert.equal(v.cardBack, true)
  }
})

test('decideAutoCapture: one tick of a back does not hold the track; a coasting tick does not break the streak', async () => {
  const { CARD_BACK_LOOK } = await import('../../engine/cardBack')
  {
    const { tick, cardBacks, lock } = rig()
    assert.equal(tick(CARD_BACK_LOOK).fire, false)
    assert.equal(cardBacks.has(lock.id), false)
    // A real card misread as a back for one tick (a light's colour moving its
    // chroma) costs that tick only: the next tick fires as any fresh lock does.
    assert.equal(tick(lookOf(2)).fire, true, 'not held: the face fires at once')
  }
  {
    const { tick, cardBacks, lock } = rig()
    tick(CARD_BACK_LOOK)
    tick(null, { noLock: true })
    tick(CARD_BACK_LOOK)
    assert.equal(cardBacks.has(lock.id), true, 'two lock ticks of the back, a coast between: held')
    assert.equal(tick(lookOf(2)).fire, false, 'held: a face that has not yet held still does not fire')
  }
  {
    const { tick, cardBacks, lock } = rig()
    tick(CARD_BACK_LOOK)
    tick(lookOf(2), { busy: true })
    tick(CARD_BACK_LOOK)
    assert.equal(cardBacks.has(lock.id), false, 'a face between two back ticks resets the streak')
  }
})

test('decideAutoCapture: a real card face near the back still releases the hold', async () => {
  const { CARD_BACK_LOOK, CARD_BACK_RELEASE_DISTANCE, cardBackDistance } = await import('../../engine/cardBack')
  const { CARDS, look } = await import('../../engine/__tests__/cardBackLooks')
  const { tick, cardBacks, lock } = rig()
  // The nearest of all 20,467 English catalog images to the back.
  const face = look(CARDS['catalog nearest'])
  const d = cardBackDistance(face)
  assert.ok(d < 1.0 && d > CARD_BACK_RELEASE_DISTANCE, `precondition: ${d.toFixed(3)}`)
  tick(CARD_BACK_LOOK)
  tick(CARD_BACK_LOOK)
  assert.equal(tick(face).fire, false, 'not steady yet')
  const v = tick(face)
  assert.equal(v.backReleased, true)
  assert.equal(v.fire, true, 'turned face up and held, it fires')
  assert.equal(cardBacks.has(lock.id), false)
})

test('decideAutoCapture: a captured card turned to its back and over again is a break, taken again once it holds', async () => {
  const { CARD_BACK_LOOK } = await import('../../engine/cardBack')
  const { CARDS, look } = await import('../../engine/__tests__/cardBackLooks')
  const { tick, cardBacks, lock } = rig()
  // The nearest of 776 real card crops to the back.
  const face = look(CARDS['real crop nearest'])
  assert.equal(tick(face).fire, true, 'a fresh lock fires')
  assert.equal(tick(face, { spot: face }).fire, false, 'the same card, still there')
  tick(CARD_BACK_LOOK)
  const broke = tick(CARD_BACK_LOOK)
  assert.equal(cardBacks.has(lock.id), true, 'turned over: held')
  assert.equal(broke.presentation.state, 'broken', 'its episode is broken')
  assert.equal(tick(face).cardBack, true, 'turned back: not steady yet')
  const released = tick(face)
  assert.equal(released.backReleased, true, 'steady: the hold lets go (no more "turn it over")')
  assert.equal(released.fire, false, 'one steady tick: still settling')
  const again = tick(face)
  assert.equal(again.fire, true, 'taken again: identity will flag it as the same card (repeat.ts)')
  assert.equal(again.kind, 'disturbed')
})
