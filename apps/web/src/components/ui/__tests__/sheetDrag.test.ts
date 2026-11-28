import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  createVelocityTracker,
  dragOffset,
  project,
  releaseDecision,
  rubberband,
  springEasing,
  throwDuration,
  velocityCubic,
} from '../sheetDrag'

test('the rubber band gives less the further it is pulled, and never more than its limit', () => {
  assert.equal(rubberband(0, 64), 0)
  assert.equal(rubberband(-10, 64), 0)
  let previous = 0
  for (const pull of [5, 20, 60, 200, 2000]) {
    const give = rubberband(pull, 64)
    assert.ok(give > previous, `pulling ${pull}px gives more than a shorter pull`)
    assert.ok(give < pull, `pulling ${pull}px gives less than the pull itself`)
    assert.ok(give < 64, 'never past its dimension')
    previous = give
  }
})

test('dragging down follows the finger exactly; dragging up resists', () => {
  assert.equal(dragOffset(0, 120), 120, 'down is 1:1')
  assert.equal(dragOffset(40, 10), 50, 'a sheet caught mid-entrance carries on from where it was')
  const up = dragOffset(0, -100)
  assert.ok(up < 0 && up > -64, `up is rubber-banded (${up})`)
})

test('release velocity uses only the recent samples, and a held finger is not moving', () => {
  const v = createVelocityTracker(80)
  // A slow start, then a fast flick in the last 50ms.
  v.add(0, 0)
  v.add(200, 10)
  v.add(400, 20)
  v.add(420, 40)
  v.add(440, 60)
  v.add(450, 70)
  assert.equal(v.velocity(450), 1, 'the flick, not the average of the whole gesture')
  assert.equal(v.velocity(600), 0, 'a finger that stopped before lifting reports zero')
  v.reset()
  assert.equal(v.velocity(0), 0)
})

test('projection matches UIScrollView: a 1000px/s throw carries about 500px', () => {
  assert.ok(Math.abs(project(1) - 499) < 1)
  assert.equal(project(0), 0)
})

test('a let-go sheet leaves when its throw would land past the line, or on a flick', () => {
  const height = 700
  assert.equal(releaseDecision({ offset: 0, velocity: 2, height }), 'restore', 'nothing moved')
  assert.equal(releaseDecision({ offset: -30, velocity: 0, height }), 'restore', 'pulled up')
  assert.equal(releaseDecision({ offset: 40, velocity: 0.6, height }), 'dismiss', 'a short fast flick')
  assert.equal(releaseDecision({ offset: 120, velocity: 0.02, height }), 'restore', 'a short slow drag')
  assert.equal(releaseDecision({ offset: 300, velocity: 0, height }), 'dismiss', 'dragged well past the line')
  assert.equal(releaseDecision({ offset: 400, velocity: -0.3, height }), 'restore', 'thrown back up')
  assert.equal(releaseDecision({ offset: 180, velocity: 0.2, height }), 'dismiss', 'past the line once projected')
})

test('the spring starts where the finger let go and ends exactly at rest', () => {
  const { easing, duration } = springEasing({ from: 200, to: 0, velocity: 0 })
  assert.match(easing, /^linear\(0, /)
  assert.match(easing, /, 1\)$/)
  assert.ok(duration > 150 && duration < 900, `settles in a believable time (${duration}ms)`)
  const stops = easing.slice(7, -1).split(', ').map(Number)
  assert.ok(stops.every((n) => Number.isFinite(n)))
  assert.ok(stops.length <= 64, 'short enough to keep in a style')
})

test('a spring released moving away from rest keeps going before it turns', () => {
  // Released at 1px/ms further DOWN while being sent back UP to rest.
  const stops = springEasing({ from: 150, to: 0, velocity: 1 }).easing.slice(7, -1).split(', ').map(Number)
  assert.ok(stops[1] < 0, 'progress goes negative first: the sheet carries on down a moment')
})

test('a clamped spring never passes rest', () => {
  const stops = springEasing({ from: 150, to: 0, velocity: -3, clampOvershoot: true }).easing.slice(7, -1).split(', ').map(Number)
  assert.ok(stops.every((n) => n <= 1), 'no overshoot opening a gap under a bottom sheet')
  const free = springEasing({ from: 150, to: 0, velocity: -3 }).easing.slice(7, -1).split(', ').map(Number)
  assert.ok(free.some((n) => n > 1), 'the same throw unclamped would have overshot')
})

test('a throw is never slower than an ordinary exit, and a fast one leaves fast', () => {
  assert.equal(throwDuration(500, 0.05), 280)
  assert.ok(throwDuration(500, 4) < 200)
  assert.ok(throwDuration(10, 4) >= 160)
})

test('the fallback cubic starts at the speed the sheet was let go', () => {
  assert.equal(velocityCubic({ distance: 0, velocity: 1, duration: 200 }), 'linear')
  const fast = velocityCubic({ distance: 400, velocity: 2, duration: 200 })
  const slow = velocityCubic({ distance: 400, velocity: 0.2, duration: 200 })
  const y1 = (s: string) => Number(s.split(',')[1])
  assert.ok(y1(fast) > y1(slow))
})
