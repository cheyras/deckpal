import test from 'node:test';
import assert from 'node:assert/strict';
import { MCDONALDS_2026, SUPPLEMENT_SETS } from '../supplements.js';
import { slugify } from '../transform.js';

/**
 * The vendored card lists, without a database. The writes are proven against PostgreSQL by
 * apps/api/src/__integration__/supplementSets.mjs.
 */

test('the 2026 McDonald\'s set is its 15 cards, numbered as TCGdex numbers the McDonald\'s sets', () => {
  const s = MCDONALDS_2026;
  assert.equal(s.cards.length, s.official);
  assert.deepEqual(s.cards.map((c) => c.localId), Array.from({ length: 15 }, (_, i) => String(i + 1)));
  assert.equal(new Set(s.cards.map((c) => c.productId)).size, 15, 'one TCGplayer product per card');
  assert.equal(new Set(s.cards.map((c) => c.reprints)).size, 15);
});

test('the holo split is the seven TCGplayer prices as Holofoil', () => {
  const holo = MCDONALDS_2026.cards.filter((c) => c.finish === 'holo').map((c) => c.localId);
  assert.deepEqual(holo, ['2', '3', '4', '5', '6', '8', '12']);
});

test('the set takes TCGdex\'s McDonald\'s naming, so its import can take the rows over', () => {
  assert.equal(MCDONALDS_2026.series, 'mc');
  assert.match(MCDONALDS_2026.name, /^McDonald's Collection \d{4}$/);
  assert.equal(slugify(MCDONALDS_2026.name), 'mcdonald-s-collection-2026');
});

test('no two supplement sets share an id, a name or a TCGplayer group', () => {
  for (const key of ['tcgdexId', 'name', 'tcgplayerGroupId'] as const) {
    assert.equal(new Set(SUPPLEMENT_SETS.map((s) => s[key])).size, SUPPLEMENT_SETS.length, key);
  }
});
