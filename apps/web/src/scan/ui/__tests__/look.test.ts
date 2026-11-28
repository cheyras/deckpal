// The look (engine/look.ts): the same card reads as the same look across a
// passing shadow and tracker jitter; a different card does not; a capture's
// look carries its quarter turns. The presentation machine (presentation.ts)
// classes ticks by these distances: quiet ≤ QUIET_MAX, hard > HARD_MIN.
// (Moved here from rearm.test.ts when the look re-arm was retired, 2026-11-27.)
import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { Quad } from '../../engine/contract'
import * as rect from '../../engine/rectify'
import { captureLook, cardLook, lookDistance } from '../../engine/look'
import { HARD_MIN, QUIET_MAX, STEADY_MAX } from '../presentation'
import { capturedTurned, lookOf, scene } from './lookScenes'

test('the same card reads as the same look, across exposure and a small slip of the quad', () => {
  const a = lookOf(1)
  assert.equal(lookDistance(a, a), 0)
  assert.ok(lookDistance(a, lookOf(1, { exposure: 0.8 })) < STEADY_MAX, 'a passing shadow is the same card')
  assert.ok(lookDistance(a, lookOf(1, { shift: 3 })) < STEADY_MAX, 'tracker jitter is the same card')
  assert.ok(STEADY_MAX < QUIET_MAX, 'steady sits inside quiet')
})

test('a different card reads as a different look', () => {
  const a = lookOf(1)
  for (const seed of [2, 3, 4, 5]) {
    assert.ok(lookDistance(a, lookOf(seed)) > HARD_MIN, `card ${seed} vs card 1: ${lookDistance(a, lookOf(seed)).toFixed(2)}`)
  }
})

test('the look of the captured pixels matches a later tick of the same card', () => {
  // captureLook reads the rectified capture (card + CAPTURE_MARGIN, full res);
  // cardLook reads the working image. Same card, same look.
  const s = scene(1)
  const { rectifyImageData, expandQuad, CAPTURE_MARGIN } = rect
  const raw = rectifyImageData(s.img, expandQuad(s.quad, CAPTURE_MARGIN), 480, 670)!
  const fromCapture = captureLook(raw)!
  assert.ok(lookDistance(fromCapture, lookOf(1)) < STEADY_MAX)
  assert.ok(lookDistance(fromCapture, lookOf(2)) > HARD_MIN)
})

test('a capture carries its four quarter turns; turn 0 is byte for byte the look of the capture as taken', async () => {
  const { LOOK_BYTES, LOOK_TURNS, lookTurns } = await import('../../engine/look')
  const raw = capturedTurned(1, 0)
  const look = captureLook(raw)!
  assert.equal(lookTurns(look), LOOK_TURNS)
  assert.equal(lookTurns(lookOf(1)), 1, "a tick's look is just itself")
  // What captureLook was before it carried turns: cardLook of the card's rectangle inside the margin.
  const m = rect.CAPTURE_MARGIN
  const mx = (raw.width * m) / (1 + 2 * m)
  const my = (raw.height * m) / (1 + 2 * m)
  const inner: Quad = [
    [mx, my],
    [raw.width - mx, my],
    [raw.width - mx, raw.height - my],
    [mx, raw.height - my],
  ]
  assert.deepEqual(look.subarray(0, LOOK_BYTES), cardLook(raw, inner))
})

test('a capture that came out sideways or upside down still matches its card — and no other', async () => {
  const { LOOK_BYTES, LOOK_TURN_COST } = await import('../../engine/look')
  for (const turn of [1, 2, 3]) {
    const look = captureLook(capturedTurned(1, turn))!
    // Read as taken, the turned capture is "a different card".
    assert.ok(lookDistance(look.subarray(0, LOOK_BYTES), lookOf(1)) > HARD_MIN, `turn ${turn}, as taken`)
    const d = lookDistance(lookOf(1), look)
    assert.ok(d <= LOOK_TURN_COST + STEADY_MAX, `turn ${turn}: ${d.toFixed(2)}`)
    assert.ok(d >= LOOK_TURN_COST, 'a turn other than the capture as taken costs LOOK_TURN_COST')
    assert.equal(lookDistance(look, lookOf(1)), d, 'either way round')
    for (const seed of [2, 3, 4, 5]) {
      const other = lookDistance(lookOf(seed), look)
      assert.ok(other > HARD_MIN, `card ${seed} vs card 1 captured at turn ${turn}: ${other.toFixed(2)}`)
    }
  }
  // ...and an upright capture of card 1 is no nearer to another card at any of its turns.
  for (const seed of [2, 3, 4, 5]) assert.ok(lookDistance(lookOf(seed), captureLook(capturedTurned(1, 0))!) > HARD_MIN)
})

test('a card lying near 45 degrees has no look — its corner order is a coin toss', async () => {
  const { orderUndecided } = await import('../../engine/look')
  const rot = (deg: number): Quad => {
    const a = (deg * Math.PI) / 180
    const c = [208, 208]
    const corners: Array<[number, number]> = [
      [-100, -140],
      [100, -140],
      [100, 140],
      [-100, 140],
    ]
    return corners.map(([x, y]) => [c[0]! + x * Math.cos(a) - y * Math.sin(a), c[1]! + x * Math.sin(a) + y * Math.cos(a)]) as Quad
  }
  assert.equal(orderUndecided(rot(0)), false)
  assert.equal(orderUndecided(rot(20)), false)
  assert.equal(orderUndecided(rot(45)), true)
  assert.equal(orderUndecided(rot(44)), true)
  assert.equal(orderUndecided(rot(-45)), true)
  assert.equal(orderUndecided(rot(70)), false)
  const s = scene(1)
  assert.equal(cardLook(s.img, rot(45)), null, 'no look: the presentation machine counts it as "cannot tell"')
})
