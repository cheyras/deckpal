import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { foldItems, type BatchItemInput } from '../routes/collection.js';
import { fingerprintOps } from '../mutations.js';

/**
 * The fold and the idempotency key have to agree, or the key lies.
 *
 * A folded op is `{mode, target?, delta}` and BOTH numbers can matter: "set to
 * 5, then +1" folds to `{mode:'set', target:5, delta:1}` and means 6. An early
 * version of the fingerprint hashed only `target` for set-mode ops, which made
 * `[{quantity:5},{delta:1}]` and `[{quantity:5}]` — 6 and 5 — collide on one
 * key. The second request would then have been swallowed as a replay and
 * silently not applied: precisely the class of dishonesty this work exists to
 * remove, pointing the other way.
 *
 * This mirrors the mapping in routes/collection.ts, so the two cannot drift
 * apart without a failing test.
 */

const d = (variantId: number, delta: number): BatchItemInput => ({ variantId, delta });
const q = (variantId: number, quantity: number): BatchItemInput => ({ variantId, quantity });

/** Exactly what the batch endpoint feeds fingerprintOps. */
function fingerprintOf(items: BatchItemInput[]): string {
  const { ops } = foldItems(items);
  return fingerprintOps(
    'user-1',
    ops.map((o) => ({ key: o.variantId, op: o.mode === 'set' ? `set:${o.target!}` : 'delta', value: o.delta })),
  );
}

test('an absolute followed by a delta does not collide with the absolute alone', () => {
  // final 6 vs final 5 — genuinely different requests
  assert.notEqual(fingerprintOf([q(1, 5), d(1, 1)]), fingerprintOf([q(1, 5)]));
});

test('two absolutes with the same target but different trailing deltas differ', () => {
  assert.notEqual(fingerprintOf([q(1, 5), d(1, 1)]), fingerprintOf([q(1, 5), d(1, 2)]));
});

test('the same request expressed differently still collides (that is the point)', () => {
  // "+1 twice" and "+2" fold to the same op, so a retry that regenerated its
  // item list differently is still recognised as a retry.
  assert.equal(fingerprintOf([d(1, 1), d(1, 1)]), fingerprintOf([d(1, 2)]));
});

test('item order does not change the key', () => {
  assert.equal(fingerprintOf([d(1, 1), d(2, 2)]), fingerprintOf([d(2, 2), d(1, 1)]));
});

test('a delta and an absolute that land on the same final value are different requests', () => {
  // Both end at 5 from a quantity of 4, but "+1" and "set to 5" mean different
  // things the moment anything else has touched the row.
  assert.notEqual(fingerprintOf([d(1, 1)]), fingerprintOf([q(1, 5)]));
});
