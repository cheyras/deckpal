// The collection-write idempotency key (commitKey.ts): one key per ATTEMPT.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { commitIdempotencyKey, isDefiniteRefusal, newCommitAttempt } from '../commitKey'

const one = [{ variantId: 34730, delta: 1 }]

test('the same list committed in two separate attempts is two writes, not a replay (2026-11-26)', () => {
  // The old key was the content alone, and the server honours a caller key
  // forever: one copy of a printing scan-added once could never be added again.
  const a = commitIdempotencyKey('scan', newCommitAttempt(), one)
  const b = commitIdempotencyKey('scan', newCommitAttempt(), one)
  assert.notEqual(a, b)
})

test('a retry of the same attempt with the same list is the same key, whatever the row order', () => {
  const attempt = newCommitAttempt()
  const x = [
    { variantId: 2, delta: 1 },
    { variantId: 10, delta: 3 },
  ]
  assert.equal(commitIdempotencyKey('scan', attempt, x), commitIdempotencyKey('scan', attempt, [...x].reverse()))
})

test('a list edited between a failed attempt and its retry is a different write', () => {
  const attempt = newCommitAttempt()
  assert.notEqual(
    commitIdempotencyKey('scan', attempt, one),
    commitIdempotencyKey('scan', attempt, [{ variantId: 34731, delta: 1 }]),
  )
  assert.notEqual(commitIdempotencyKey('scan', attempt, one), commitIdempotencyKey('scan', attempt, [{ variantId: 34730, delta: 2 }]))
})

test('a long batch stays under the server limit and is not cut (lines past 200 characters still count)', () => {
  const attempt = newCommitAttempt()
  const long = Array.from({ length: 120 }, (_, i) => ({ variantId: 100_000 + i, delta: 1 }))
  const k1 = commitIdempotencyKey('scan', attempt, long)
  const k2 = commitIdempotencyKey('scan', attempt, [...long.slice(0, -1), { variantId: 999_999, delta: 1 }])
  assert.ok(k1.length <= 200, `${k1.length} chars`)
  assert.notEqual(k1, k2, 'a difference in the last line changes the key')
})

test('only a definite 4xx refusal lets a write be dropped; an unknown outcome is re-sent as it was', () => {
  const api = (status: number) => Object.assign(new Error('x'), { name: 'ApiError', status })
  assert.equal(isDefiniteRefusal(api(400)), true)
  assert.equal(isDefiniteRefusal(api(403)), true)
  for (const s of [408, 409, 429, 500, 502, 504]) assert.equal(isDefiniteRefusal(api(s)), false, String(s))
  assert.equal(isDefiniteRefusal(new TypeError('Load failed')), false, 'a network failure says nothing about the write')
  assert.equal(isDefiniteRefusal(null), false)
})
