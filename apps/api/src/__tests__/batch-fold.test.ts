import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { foldItems, type BatchItemInput } from '../routes/collection.js';

/**
 * Folding repeated variants inside one batch.
 *
 * The batch endpoint applies each variant once, which is what makes the whole
 * thing a handful of statements instead of one per item. That is only sound if
 * folding is an OPTIMISATION and never a semantic change: the result must be
 * identical to applying the items one at a time, in the order they were given.
 *
 * Which means order is part of the contract, not an implementation detail —
 * "+1, then set to 5, then +1" is 6, and no amount of rearranging makes it
 * anything else.
 */

const d = (variantId: number, delta: number): BatchItemInput => ({ variantId, delta });
const q = (variantId: number, quantity: number): BatchItemInput => ({ variantId, quantity });

test('deltas on one variant accumulate', () => {
  const { ops } = foldItems([d(1, 1), d(1, 2), d(1, -1)]);
  assert.equal(ops.length, 1);
  assert.deepEqual({ mode: ops[0]!.mode, delta: ops[0]!.delta }, { mode: 'delta', delta: 2 });
});

test('an absolute quantity discards the deltas before it', () => {
  const { ops } = foldItems([d(1, 5), q(1, 2)]);
  assert.equal(ops[0]!.mode, 'set');
  assert.equal(ops[0]!.target, 2);
  assert.equal(ops[0]!.delta, 0);
});

test('a delta after an absolute quantity adjusts that value', () => {
  const { ops } = foldItems([d(1, 1), q(1, 5), d(1, 1)]);
  assert.equal(ops[0]!.mode, 'set');
  assert.equal(ops[0]!.target, 5);
  assert.equal(ops[0]!.delta, 1); // final quantity 6, exactly as sequential application gives
});

test('the last absolute quantity wins', () => {
  const { ops } = foldItems([q(1, 3), d(1, 4), q(1, 9)]);
  assert.equal(ops[0]!.target, 9);
  assert.equal(ops[0]!.delta, 0);
});

test('distinct variants stay distinct and keep first-appearance order', () => {
  const { ops } = foldItems([d(7, 1), d(3, 1), d(7, 1), d(5, 1)]);
  assert.deepEqual(
    ops.map((o) => o.variantId),
    [7, 3, 5],
  );
  assert.equal(ops[0]!.delta, 2);
});

test('folding is reported, with the input indices that merged', () => {
  const { folded } = foldItems([d(7, 1), d(3, 1), d(7, 1)]);
  assert.deepEqual(folded, [{ variantId: 7, from: [0, 2] }]);
});

test('nothing merged means nothing reported — no noise on the common path', () => {
  const { folded } = foldItems([d(1, 1), d(2, 1), d(3, 1)]);
  assert.deepEqual(folded, []);
});

test('deltas that cancel out still produce an op, so the item is accounted for', () => {
  // The endpoint reports it as `unchanged` rather than dropping it silently —
  // an item the caller sent must appear in the answer.
  const { ops } = foldItems([d(1, 2), d(1, -2)]);
  assert.equal(ops.length, 1);
  assert.equal(ops[0]!.delta, 0);
});
