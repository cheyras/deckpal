import assert from 'node:assert/strict'
import fs from 'node:fs'
import { test } from 'node:test'
import { analyseScroll, MAX_SETTLING_PX } from '../deckeShowScroll.mjs'

const analyse = (positions) => analyseScroll(positions.map(y => ({ y })), 844)
const still = (y) => Array(5).fill(y)
const glide = (from, distance = 100) => Array.from({ length: 10 }, (_, i) => from + distance * (i + 1) / 10)
const passes = (m) => m.jumps <= 1 && m.glides <= 1 && m.reversals === 0 && m.settlingPx <= MAX_SETTLING_PX

test('captured WebKit settling remains one throw and one glide', () => {
  const fixtures = JSON.parse(fs.readFileSync(new URL('./fixtures/decke-scroll-settling.json', import.meta.url)))
  for (const fixture of fixtures) {
    const m = analyseScroll(fixture.y.map(y => ({ y })), fixture.viewportHeight)
    assert.equal(passes(m), true, fixture.name + ': ' + JSON.stringify(m))
    assert.equal(m.jumps, 1)
    assert.equal(m.glides, 1)
  }
})

test('a route nudge does not merge with the throw or become another jump', () => {
  for (const nudge of [[0, 1], [0, ...still(1)]]) {
    assert.deepEqual(analyse([...nudge, 10000, ...still(10000), ...glide(10000)]),
      { jumps: 1, glides: 1, reversals: 0, settlingPx: 1 })
  }
})

test('a second glide from another scroll owner still fails', () => {
  const m = analyse([0, 10000, ...still(10000), ...glide(10000), ...still(10100), ...glide(10100)])
  assert.equal(m.glides, 2)
  assert.equal(passes(m), false)
})

test('adjacent throws and separated jumps both fail', () => {
  for (const y of [[0, 10000, 20000], [0, 10000, ...still(10000), 10100]]) {
    const m = analyse(y)
    assert.equal(m.jumps, 2)
    assert.equal(passes(m), false)
  }
})

test('a slow reversal accumulates rather than hiding below per-frame tolerance', () => {
  const m = analyse([0, 10000, ...still(10000), ...glide(10000), ...Array.from({length: 10}, (_, i) => 10099 - i)])
  assert.equal(m.reversals, 1)
  assert.equal(passes(m), false)
})

test('repeated tiny moves exceed the total settling budget', () => {
  const m = analyse([0, 10000, ...still(10000), ...still(10003), ...still(10006)])
  assert.equal(m.settlingPx, 6)
  assert.equal(passes(m), false)
})

test('small oscillations cannot hide inside a narrow range', () => {
  const m = analyse([0, 10000, ...still(10000), 10003, 10000, 10003])
  assert.equal(m.settlingPx, 9)
  assert.equal(passes(m), false)
})

test('small oscillations attached to a glide still consume the budget', () => {
  const m = analyse([0, 10000, ...still(10000), ...glide(10000), ...Array(10).fill([10097, 10100]).flat()])
  assert.equal(m.glides, 1)
  assert.equal(m.settlingPx, 60)
  assert.equal(passes(m), false)
})

test('a five-pixel second glide is still a glide', () => {
  const m = analyse([0, 10000, ...still(10000), ...glide(10000), ...still(10100), 10101, 10102, 10103, 10104, 10105])
  assert.equal(m.glides, 2)
  assert.equal(passes(m), false)
})

test('reduced motion has jumps and no glide', () => {
  const m = analyse([0, 10000, ...still(10000), 11250, ...still(11250)])
  assert.equal(m.glides, 0)
})

test('rounding at the end of the same glide is bounded settling', () => {
  const m = analyse([0, 10000, ...still(10000), ...glide(10000), ...still(10100), 10101])
  assert.equal(passes(m), true)
  assert.equal(m.glides, 1)
  assert.equal(m.settlingPx, 1)
})
