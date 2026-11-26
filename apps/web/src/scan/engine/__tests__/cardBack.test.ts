// The card-back gate (engine/cardBack.ts): real backs are backs, and the real
// cards that came closest to the template stay cards. The looks are measured,
// not synthetic (cardBackLooks.ts names their sources).
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  CARD_BACK_LOOK,
  CARD_BACK_LOOK_TURNED,
  CARD_BACK_MAX_DISTANCE,
  CARD_BACK_RELEASE_DISTANCE,
  cardBackDistance,
  isCardBackLook,
  rotateLook180,
} from '../cardBack'
import { LOOK_BYTES, LOOK_TURNS, lookDistance } from '../look'
import { BACKS, CARDS, look } from './cardBackLooks'

test('the template is a back either way up', () => {
  assert.equal(cardBackDistance(CARD_BACK_LOOK), 0)
  assert.equal(cardBackDistance(rotateLook180(CARD_BACK_LOOK)), 0)
  assert.deepEqual(rotateLook180(rotateLook180(CARD_BACK_LOOK)), CARD_BACK_LOOK)
  assert.equal(isCardBackLook(CARD_BACK_LOOK), true)
})

test('real backs are backs, upright or upside down', () => {
  for (const [name, b64] of Object.entries(BACKS)) {
    const l = look(b64)
    assert.ok(isCardBackLook(l), `${name}: ${cardBackDistance(l).toFixed(3)}`)
    assert.ok(isCardBackLook(rotateLook180(l)), `${name}, turned`)
  }
})

test('the real cards nearest the template stay cards, with margin', () => {
  for (const [name, b64] of Object.entries(CARDS)) {
    const d = cardBackDistance(look(b64))
    assert.ok(d > CARD_BACK_MAX_DISTANCE + 0.1, `${name}: ${d.toFixed(3)} is within 0.1 of the gate`)
  }
})

test('no look is not a back — the gate fails open', () => {
  assert.equal(isCardBackLook(null), false)
})

test('the threshold is a distance in lookDistance units, as the re-arm uses', () => {
  const l = look(BACKS['video lock, thumb on it'])
  assert.equal(cardBackDistance(l), Math.min(lookDistance(CARD_BACK_LOOK, l), lookDistance(rotateLook180(CARD_BACK_LOOK), l)))
  assert.equal(isCardBackLook(l, 0.1), false, 'a tighter gate refuses it')
})

test('the turned template is the template upside down, and a look is only ever half-turned whole', () => {
  assert.deepEqual(CARD_BACK_LOOK_TURNED, rotateLook180(CARD_BACK_LOOK))
  assert.equal(cardBackDistance(CARD_BACK_LOOK_TURNED), 0)
  // A capture's look carries four quarter turns (look.ts captureLook): turning
  // only its first block would leave three that disagree, so it is refused.
  assert.throws(() => rotateLook180(new Uint8Array(LOOK_TURNS * LOOK_BYTES)), /one-turn look/)
})

test('the release threshold sits above every back and below every card measured', () => {
  assert.ok(CARD_BACK_RELEASE_DISTANCE > CARD_BACK_MAX_DISTANCE)
  for (const [name, b64] of Object.entries(BACKS)) {
    const d = cardBackDistance(look(b64))
    assert.ok(d < CARD_BACK_RELEASE_DISTANCE, `${name}: ${d.toFixed(3)} would release`)
  }
  for (const [name, b64] of Object.entries(CARDS)) {
    const d = cardBackDistance(look(b64))
    assert.ok(d > CARD_BACK_RELEASE_DISTANCE, `${name}: ${d.toFixed(3)} would never release`)
  }
})
