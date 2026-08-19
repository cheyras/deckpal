import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { BUCKET_MS, bucketedKey, candidateKeys, fingerprintOps } from '../mutations.js';

/**
 * Idempotency key derivation.
 *
 * This is the mechanism that makes "the connector timed out, should I retry?"
 * safe. It has to hold two properties that pull against each other:
 *
 *   • A RETRY of the same request must produce the same key, even when the
 *     agent regenerates its item list in a different order, phrases a card as
 *     `card_id` on one attempt and `name`+`number` on the next, or rewrites its
 *     note ("batch 1" → "batch 1 retry").
 *   • A GENUINE second acquisition of the same cards, next week, must NOT be
 *     swallowed as a replay.
 *
 * Hence: hash the resolved, folded operations (never the raw input, never the
 * note), and bucket the stored key by time so recognition expires.
 */

test('order does not change the fingerprint — a regenerated list is still the same request', () => {
  const a = fingerprintOps('u1', [
    { key: 10, op: 'delta', value: 1 },
    { key: 20, op: 'delta', value: 2 },
  ]);
  const b = fingerprintOps('u1', [
    { key: 20, op: 'delta', value: 2 },
    { key: 10, op: 'delta', value: 1 },
  ]);
  assert.equal(a, b);
});

test('a different user never collides with another user', () => {
  const ops = [{ key: 10, op: 'delta', value: 1 }];
  assert.notEqual(fingerprintOps('u1', ops), fingerprintOps('u2', ops));
});

test('a different quantity is a different request', () => {
  assert.notEqual(
    fingerprintOps('u1', [{ key: 10, op: 'delta', value: 1 }]),
    fingerprintOps('u1', [{ key: 10, op: 'delta', value: 2 }]),
  );
});

test('delta and absolute-set of the same number are different requests', () => {
  // +2 and "set to 2" mean different things and must never dedupe together.
  assert.notEqual(
    fingerprintOps('u1', [{ key: 10, op: 'delta', value: 2 }]),
    fingerprintOps('u1', [{ key: 10, op: 'set', value: 2 }]),
  );
});

test('the stored key buckets by time, so recognition expires', () => {
  const fp = fingerprintOps('u1', [{ key: 10, op: 'delta', value: 1 }]);
  const t0 = 1_800_000_000_000;
  assert.equal(bucketedKey(fp, t0), bucketedKey(fp, t0 + 60_000), 'a minute later is the same bucket');
  assert.notEqual(bucketedKey(fp, t0), bucketedKey(fp, t0 + 7 * 24 * 3600_000), 'a week later is not');
});

test('lookup checks the current AND previous bucket, so a retry across a boundary still matches', () => {
  const fp = fingerprintOps('u1', [{ key: 10, op: 'delta', value: 1 }]);
  // A request that started just before a bucket boundary and is retried just
  // after it must still be recognised — otherwise the window has a seam that
  // silently double-applies.
  const justBefore = 2 * BUCKET_MS - 1_000;
  const justAfter = 2 * BUCKET_MS + 1_000;
  assert.ok(candidateKeys(fp, justAfter).includes(bucketedKey(fp, justBefore)));
});

test('candidate keys are newest-first', () => {
  const fp = fingerprintOps('u1', [{ key: 1, op: 'delta', value: 1 }]);
  const now = 5 * BUCKET_MS;
  assert.deepEqual(candidateKeys(fp, now), [bucketedKey(fp, now), bucketedKey(fp, now - BUCKET_MS)]);
});

test('an empty operation list still hashes (it is a valid, if pointless, request)', () => {
  assert.match(fingerprintOps('u1', []), /^[0-9a-f]{64}$/);
});
