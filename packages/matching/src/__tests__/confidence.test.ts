import assert from 'node:assert/strict'
import { test } from 'node:test'

import { EMBED_MODEL_ID } from '../input-spec.js'
import { THRESHOLDS, identityConfidence, isConfidentScore, variantConfidence } from '../confidence.js'

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

test('a wide margin over a weak top-1 is not confident', () => {
  // Weak = below the similarity of EVERY tier: no margin buys that back. (A
  // checkpoint with a measured wide tier lowers its similarity bar for a
  // far-clear match — see the wide-tier test — but never below its own floor.)
  const weak = Math.min(T.simMin, T.wide?.simMin ?? T.simMin) - 0.05
  const r = identityConfidence([
    { cardId: 'x', similarity: weak },
    { cardId: 'y', similarity: weak - 0.5 },
  ])
  assert.notEqual(r.level, 'confident')
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

test('the measured corpus replays: 9 true accepts and 9 true rejects', () => {
  // The 19-frame ground truth against the 6,464-card gallery, as (top1, top2)
  // pairs taken verbatim from the spike's per-query output for the shipped
  // checkpoint. Nine of them are photographs of cards with no catalog art at
  // all, so a `confident` verdict on any of those nine is a false match by
  // construction — and they are not easy negatives: what they retrieve is
  // another printing of the SAME Pokémon. This is the precision claim in
  // DECISIONS.md, executed.
  const trueMatches: [number, number][] = [
    [0.6787, 0.668], // declined: the weakest true match, below simMin
    [0.7759, 0.7477],
    [0.7773, 0.6723],
    [0.783, 0.6555],
    [0.8018, 0.6544],
    [0.8117, 0.6644],
    [0.8346, 0.7074],
    [0.8353, 0.7564],
    [0.8516, 0.7901],
    [0.8545, 0.8252],
  ]
  const impossible: [number, number][] = [
    [0.6102, 0.6078],
    [0.6458, 0.6395],
    [0.6567, 0.6386],
    [0.6606, 0.6481],
    [0.6691, 0.6595],
    [0.6827, 0.679],
    [0.6917, 0.6751],
    [0.6938, 0.6772],
    [0.7028, 0.6952], // the strongest negative: another Fennekin printing
  ]
  // These are the SHIPPED zero-shot checkpoint's similarities, so they are judged
  // by its gate — explicitly, now that EMBED_MODEL_ID names the fine-tuned one.
  const verdict = ([a, b]: [number, number]) =>
    identityConfidence(
      [
        { cardId: 'top', similarity: a },
        { cardId: 'second', similarity: b },
      ],
      'clip-vit-b32-openai',
    ).level

  const accepted = trueMatches.filter((p) => verdict(p) === 'confident').length
  const falseAccepts = impossible.filter((p) => verdict(p) === 'confident').length
  // Precision first, and not by a little: a declined true match costs the reader
  // one tap, while a false accept puts the wrong card in their collection and
  // tells them it is right. The matcher this replaces said "confident" four
  // times on this corpus and was wrong four times.
  assert.equal(falseAccepts, 0, 'the gate named a card that is not in the catalog')
  assert.ok(accepted >= 9, `only ${accepted}/10 true matches cleared the gate`)
})

test('the fine-tuned gate sits in the gap of both of its measured error clusters', () => {
  // scripts/scan-bench, 256 real crops, fp32 gallery x int8 query (2026-10-09).
  // Its wrong top-1s are of exactly two kinds, and each knob must reject one:
  //   a card with no catalogue art     -> strongest top-1 similarity 0.562
  //   an identical-art reprint         -> strongest margin 0.004
  const t = THRESHOLDS['deckpal-card-b32-v1']!
  assert.ok(t.simMin - 0.562 >= 0.05, `simMin ${t.simMin} must clear the no-art cluster with headroom`)
  assert.ok(t.marginMin >= 0.004 * 5, `marginMin ${t.marginMin} must clear the same-art cluster with headroom`)
  const verdict = (a: number, b: number) =>
    identityConfidence(
      [
        { cardId: 'top', similarity: a },
        { cardId: 'second', similarity: b },
      ],
      'deckpal-card-b32-v1',
    ).level
  assert.equal(verdict(0.562, 0.491), 'uncertain', 'the strongest no-art photo must not be named')
  assert.equal(verdict(0.933, 0.933), 'uncertain', 'an identical-art reprint pair must go to the reader')
  assert.equal(verdict(0.909, 0.905), 'uncertain')
  assert.equal(verdict(0.86, 0.6), 'confident', 'an ordinary clear match is named')
})

test('the fine-tuned wide tier names a far-clear low-resolution match and nothing it was not measured on', () => {
  // gate_sweep.py, 2026-10-10: a soft video capture of the right card at 0.5
  // standing 0.15 clear is named; the strongest non-card under the tier stood
  // 0.118 clear; an identical-art pair (margin <= 0.004) never qualifies.
  const t = THRESHOLDS['deckpal-card-b32-v1']!
  assert.ok(t.wide, 'the fine-tuned checkpoint has a measured wide tier')
  assert.ok(t.wide!.marginMin > 0.118, 'wide marginMin must clear the strongest non-card it was measured against')
  assert.ok(t.wide!.simMin >= t.simFloor, 'the wide tier cannot reach below the showable floor')
  const verdict = (a: number, b: number, model = 'deckpal-card-b32-v1') =>
    identityConfidence(
      [
        { cardId: 'top', similarity: a },
        { cardId: 'second', similarity: b },
      ],
      model,
    ).level
  assert.equal(verdict(0.5, 0.35), 'confident', 'a far-clear soft capture is named')
  assert.equal(verdict(0.5, 0.39), 'uncertain', 'margin 0.11 is not far clear')
  assert.equal(verdict(0.44, 0.2), 'none', 'below the floor nothing is named, however clear')
  assert.equal(verdict(0.6, 0.6), 'uncertain', 'a reprint pair is never decided by the wide tier')
  // Checkpoints without a measured wide tier are untouched by it.
  assert.equal(THRESHOLDS['clip-vit-b32-openai']!.wide, undefined)
  assert.equal(verdict(0.7, 0.4, 'clip-vit-b32-openai'), 'uncertain')
  // One rule for both consumers.
  assert.equal(isConfidentScore(t, 0.5, 0.15), true)
  assert.equal(isConfidentScore(t, 0.5, null), false)
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
