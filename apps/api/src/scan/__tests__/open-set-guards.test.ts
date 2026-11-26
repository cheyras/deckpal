/**
 * `holdForTheUnindexed`, the hold `resolveCard` puts on an answer the IMAGE
 * decided ('vector' or 'corroborated') while a namesake of its lead sits in a
 * set the image index has never seen. Added after the owner's 2026-11-25 field
 * test: a Delta Reign (me06) Masquerain was read `Masquerain`, the closest
 * Masquerain the index held was sv03-007, and name + picture called it
 * 'corroborated', confidently wrong.
 *
 * Pure: a fixture catalogue, no database, no model.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { VectorMatch } from '../fuse.js';
import { normalizeCardName, resolveCard, type CatalogCard, type CatalogPort, type OcrFields } from '../resolve.js';

const MODEL = 'deckpal-card-b32-v2';

const card = (cardId: string, name: string, number: string, setId: string): CatalogCard => ({
  cardId,
  name,
  number,
  numberNumeric: /^\d+$/.test(number) ? Number(number) : null,
  setId,
  setName: setId,
  seriesId: setId.replace(/\d.*$/, ''),
  rarity: null,
});

const CARDS: CatalogCard[] = [
  card('sv03-007', 'Masquerain', '007', 'sv03'),
  card('sv04-002', 'Masquerain', '002', 'sv04'),
  card('me06-003', 'Masquerain', '003', 'me06'),
  card('me06-104', 'Masquerain', '104', 'me06'),
];
const OFFICIAL: Record<string, number> = { sv03: 197, sv04: 182, me06: 103 };

function portWith(unindexed: readonly string[]): CatalogPort {
  return {
    async bySetAndNumber(setId, n) {
      return CARDS.filter((c) => c.setId === setId && c.numberNumeric === n);
    },
    async byNumberAndDenominator(n, d) {
      return CARDS.filter((c) => c.numberNumeric === n && OFFICIAL[c.setId] === d);
    },
    async byNumber(n) {
      return CARDS.filter((c) => c.numberNumeric === n);
    },
    async byIds(ids) {
      return CARDS.filter((c) => ids.includes(c.cardId));
    },
    async byName(probe) {
      return CARDS.filter((c) => normalizeCardName(c.name).startsWith(probe.prefix));
    },
    async officialCounts(setIds) {
      return new Map(setIds.map((s) => [s, OFFICIAL[s] ?? null]));
    },
    async unindexedNamesakes(c) {
      return CARDS.filter((x) => x.name === c.name && unindexed.includes(x.setId)).length;
    },
  };
}

const resolve = (fields: OcrFields, vectorMatches: VectorMatch[], unindexed: readonly string[] = []) =>
  resolveCard(fields, [], portWith(unindexed), { phashConfidentMax: 9, fusion: { vectorMatches, modelId: MODEL } });

// The index has no me06 vectors, so the nearest Masquerain it holds is sv03-007.
const STALE_MASQUERAIN: VectorMatch[] = [
  { cardId: 'sv03-007', similarity: 0.8 },
  { cardId: 'sv04-002', similarity: 0.6 },
];

test('the field case: name + picture of an older printing, while me06 is unindexed, is held', async () => {
  const r = await resolve({ name: 'Masquerain' }, STALE_MASQUERAIN, ['me06']);
  assert.equal(r.confident, false);
  assert.equal(r.matches[0]?.cardId, 'sv03-007', 'the list is kept, lead first');
});

test('the same read with every namesake indexed still corroborates', async () => {
  const r = await resolve({ name: 'Masquerain' }, STALE_MASQUERAIN);
  assert.equal(r.resolvedBy, 'corroborated');
  assert.equal(r.confident, true);
  assert.equal(r.matches[0]?.cardId, 'sv03-007');
});

test('a decisive vector alone is held when its namesakes are unindexed', async () => {
  const r = await resolve({}, STALE_MASQUERAIN, ['me06']);
  assert.equal(r.resolvedBy, 'vector');
  assert.equal(r.confident, false);
});
