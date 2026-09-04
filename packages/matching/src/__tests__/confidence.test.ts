import assert from 'node:assert/strict'
import { test } from 'node:test'

import { EMBED_MODEL_ID } from '../input-spec.js'
import { THRESHOLDS, identityConfidence, variantConfidence } from '../confidence.js'

const T = THRESHOLDS[EMBED_MODEL_ID]!

test('the active checkpoint has measured thresholds', () => {
  // The guard against shipping a gate calibrated for a different vector space:
  // change EMBED_MODEL_ID without re-measuring and this fails here rather than
  // in production, where it would look like a slow accuracy regression.
  assert.ok(T, `no THRESHOLDS entry for ${EMBED_MODEL_ID}`)
  assert.ok(T.simMin > T.simFloor)
  assert.ok(T.marginMin > 0)
})

test('an unknown checkpoint is an error, never a default', () => {
  assert.throws(
    () => identityConfidence([{ cardId: 'a', similarity: 0.9 }], 'some-model-nobody-measured'),
    /no measured confidence thresholds/,
  )
})

test('a clear winner is confident', () => {
  const r = identityConfidence([
    { cardId: 'me04-024', similarity: T.simMin + 0.05 },
    { cardId: 'me04-025', similarity: T.simMin + 0.05 - T.marginMin - 0.01 },
  ])
  assert.equal(r.level, 'confident')
  assert.equal(r.cardId, 'me04-024')
})

test('a high score with a crowded runner-up is uncertain, not confident', () => {
  // The reprint case: two printings of one illustration both score high and the
  // question that is actually open is WHICH printing. The ruling says that goes
  // to the reader, so the gate must not answer it.
  const r = identityConfidence([
    { cardId: 'base1-102', similarity: 0.95 },
    { cardId: 'base4-130', similarity: 0.95 - T.marginMin / 2 },
  ])
  assert.equal(r.level, 'uncertain')
  assert.equal(r.cardId, 'base1-102')
})

test('a wide margin over a weak top-1 is uncertain, not confident', () => {
  const r = identityConfidence([
    { cardId: 'x', similarity: T.simMin - 0.05 },
    { cardId: 'y', similarity: T.simMin - 0.05 - 0.5 },
  ])
  assert.equal(r.level, 'uncertain')
})

test('a lone candidate can never be confident', () => {
  // There is no runner-up to be better than, so "how much better" has no
  // answer, and `null` says so rather than standing in for a large margin.
  const r = identityConfidence([{ cardId: 'x', similarity: 0.99 }])
  assert.equal(r.margin, null)
  assert.equal(r.level, 'uncertain')
})

test('nothing above the floor is `none`, and still reports the score', () => {
  const r = identityConfidence([{ cardId: 'x', similarity: T.simFloor - 0.01 }])
  assert.equal(r.level, 'none')
  assert.equal(r.cardId, null)
  assert.equal(r.similarity, T.simFloor - 0.01)
})

test('an empty candidate list is `none`, not a crash', () => {
  const r = identityConfidence([])
  assert.equal(r.level, 'none')
  assert.equal(r.cardId, null)
  assert.equal(r.margin, null)
})

test('the measured corpus replays: 10 true accepts and 9 true rejects', () => {
  // The 19-frame ground truth, as (top1, top2) pairs taken from the spike's
  // per-query output for the shipped checkpoint. Nine of them are photographs
  // of cards with no catalog art at all, so a `confident` verdict on any of
  // those nine is a false match by construction. This is the whole precision
  // claim in DECISIONS.md, executed.
  const trueMatches: [number, number][] = [
    [0.7659, 0.626],
    [0.8511, 0.7627],
    [0.8728, 0.6804],
    [0.8808, 0.6474],
    [0.8845, 0.7214],
    [0.8979, 0.8863], // the one the margin rule declines: two near-identical arts
    [0.9013, 0.7659],
    [0.9114, 0.6964],
    [0.9165, 0.767],
    [0.9238, 0.6917],
  ]
  const impossible: [number, number][] = [
    [0.6379, 0.6294],
    [0.6499, 0.6448],
    [0.6976, 0.6782],
    [0.7045, 0.6833],
    [0.7071, 0.6861],
    [0.7284, 0.722],
    [0.7288, 0.7066],
    [0.7481, 0.7259],
    [0.7533, 0.7473],
  ]
  const verdict = ([a, b]: [number, number]) =>
    identityConfidence([
      { cardId: 'top', similarity: a },
      { cardId: 'second', similarity: b },
    ]).level

  const accepted = trueMatches.filter((p) => verdict(p) === 'confident').length
  const falseAccepts = impossible.filter((p) => verdict(p) === 'confident').length
  assert.equal(falseAccepts, 0, 'the gate named a card that is not in the catalog')
  assert.ok(accepted >= 9, `only ${accepted}/10 true matches cleared the gate`)
})

test('variant confidence is unknown, and says whether that blocks the commit', () => {
  // The ruling's immediate consequence: nothing in this build measures a
  // printing, so a multi-variant card must ask.
  const single = variantConfidence(1)
  assert.equal(single.level, 'unknown')
  assert.equal(single.requiresUserChoice, false)

  const multi = variantConfidence(3)
  assert.equal(multi.level, 'unknown')
  assert.equal(multi.requiresUserChoice, true)
  assert.equal(multi.reason, 'no-variant-model')
})
