import assert from 'node:assert/strict'
import { test } from 'node:test'

import { cosineSimilarity, fromPgVector, toPgVector } from '../vector.js'
import { l2Normalize } from '../input-spec.js'

test('a vector round-trips through the text encoding as the same float32', () => {
  // The claim in vector.ts's header is that 7 significant digits is lossless
  // for float32. This is that claim, executed over 2,000 random components
  // rather than asserted in prose.
  const v = new Float32Array(2000)
  let s = 12345 >>> 0
  for (let i = 0; i < v.length; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    v[i] = (s / 0x100000000) * 2 - 1
  }
  const back = fromPgVector(toPgVector(v))
  assert.equal(back.length, v.length)
  for (let i = 0; i < v.length; i++) assert.equal(back[i], v[i])
})

test('the encoding is pgvector literal syntax', () => {
  assert.equal(toPgVector([0, 1, -0.5]), '[0,1,-0.5]')
  assert.deepEqual(Array.from(fromPgVector('[0,1,-0.5]')), [0, 1, -0.5])
  assert.equal(fromPgVector('[]').length, 0)
})

test('a non-finite component is refused at the encoder, not by Postgres', () => {
  // The whole point: an embed that produced NaN must fail where the embedder
  // is on the stack, not three layers away as an unattributed insert error.
  assert.throws(() => toPgVector([1, NaN, 3]), /component 1 is NaN/)
  assert.throws(() => toPgVector([Infinity]), /component 0 is Infinity/)
})

test('a malformed literal is rejected rather than half-parsed', () => {
  assert.throws(() => fromPgVector('0,1,2'), /not a pgvector literal/)
  assert.throws(() => fromPgVector('[1,two]'), /not finite/)
})

test('cosineSimilarity is the dot product, and agrees with hand-computed cases', () => {
  assert.equal(cosineSimilarity([1, 0, 0], [1, 0, 0]), 1)
  assert.equal(cosineSimilarity([1, 0, 0], [0, 1, 0]), 0)
  assert.equal(cosineSimilarity([1, 0, 0], [-1, 0, 0]), -1)
  const a = l2Normalize(Float32Array.from([3, 4]))
  const b = l2Normalize(Float32Array.from([4, 3]))
  assert.ok(Math.abs(cosineSimilarity(a, b) - 24 / 25) < 1e-6)
})

test('comparing different-length embeddings is an error, not a silent truncation', () => {
  // Two different checkpoints produce different dimensionalities. Quietly
  // comparing the overlap would produce a plausible-looking score for vectors
  // that have nothing to do with each other.
  assert.throws(() => cosineSimilarity([1, 0], [1, 0, 0]), /length 2 and 3/)
})
