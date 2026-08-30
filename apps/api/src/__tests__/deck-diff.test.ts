import test from 'node:test';
import assert from 'node:assert/strict';
import { diffSnapshots } from '../routes/decks.js';
import type { SnapshotEntry } from '../deck/versions.js';

/**
 * The version diff across the variant-scoping boundary (migration 051).
 *
 * The regression this file exists to prevent: snapshots are per PRINTING now,
 * and a diff keyed naively by cardId would collapse two printings of one card
 * (Map last-wins) — and, worse, a pre-051 snapshot (no variantIds) diffed
 * against a post-051 one of the SAME deck would report every card as changed.
 * The documented reading is "a variant-less snapshot means primary, never a
 * change": the diff aggregates to card level first, and printing mixes get
 * their own quiet lane.
 */

const e = (cardId: number, quantity: number, variantId?: number, variantName?: string): SnapshotEntry => ({
  cardId,
  tcgdexId: `sv01-${cardId}`,
  name: `Card ${cardId}`,
  quantity,
  ...(variantId !== undefined ? { variantId, variantName: variantName ?? `V${variantId}` } : {}),
});

test('identical card totals across the 051 boundary are NO change', () => {
  // old: card-keyed, 3 copies. new: the same 3 copies as 2 Normal + 1 RH.
  const prev = [e(7, 3)];
  const cur = [e(7, 2, 71, 'Normal'), e(7, 1, 72, 'Reverse Holofoil')];
  const d = diffSnapshots(prev, cur);
  assert.deepEqual(d.added, []);
  assert.deepEqual(d.removed, []);
  assert.deepEqual(d.changed, []);
  // The mix is unknowable on the pre-051 side, so the printings lane is quiet too.
  assert.deepEqual(d.printings, []);
});

test('two printings of one card are summed, not last-wins', () => {
  const prev = [e(7, 2, 71, 'Normal'), e(7, 1, 72, 'Reverse Holofoil')];
  const cur = [e(7, 2, 71, 'Normal'), e(7, 2, 72, 'Reverse Holofoil')];
  const d = diffSnapshots(prev, cur);
  assert.deepEqual(d.changed, [{ name: 'Card 7', tcgdexId: 'sv01-7', from: 3, to: 4 }]);
  assert.deepEqual(d.printings, [], 'a total change is a change, not a printings note');
});

test('a printing swap at the same total gets the printings lane, and only that', () => {
  const prev = [e(7, 2, 71, 'Normal')];
  const cur = [e(7, 1, 71, 'Normal'), e(7, 1, 72, 'Reverse Holofoil')];
  const d = diffSnapshots(prev, cur);
  assert.deepEqual(d.added, []);
  assert.deepEqual(d.removed, []);
  assert.deepEqual(d.changed, []);
  assert.equal(d.printings.length, 1);
  assert.equal(d.printings[0]!.from, '2× Normal');
  assert.equal(d.printings[0]!.to, '1× Normal + 1× Reverse Holofoil');
});

test('added and removed still work, with per-printing entries aggregated', () => {
  const prev = [e(1, 4, 11, 'Normal')];
  const cur = [e(2, 2, 21, 'Normal'), e(2, 2, 22, 'Holofoil')];
  const d = diffSnapshots(prev, cur);
  assert.deepEqual(d.removed, [{ name: 'Card 1', tcgdexId: 'sv01-1', quantity: 4 }]);
  assert.deepEqual(d.added, [{ name: 'Card 2', tcgdexId: 'sv01-2', quantity: 4 }]);
});

test('both sides pre-051 behaves exactly as before', () => {
  const d = diffSnapshots([e(1, 2), e(2, 1)], [e(1, 3), e(3, 1)]);
  assert.deepEqual(d.changed, [{ name: 'Card 1', tcgdexId: 'sv01-1', from: 2, to: 3 }]);
  assert.deepEqual(d.removed, [{ name: 'Card 2', tcgdexId: 'sv01-2', quantity: 1 }]);
  assert.deepEqual(d.added, [{ name: 'Card 3', tcgdexId: 'sv01-3', quantity: 1 }]);
  assert.deepEqual(d.printings, []);
});
