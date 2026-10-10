/**
 * THE PRINTING GUARD (artFamilies.ts, resolve.ts `openThePrinting`): an image
 * signal names a card with same-art reprints only as far as the family; a
 * printed key names the printing. Pinned to the owner's verified photos of
 * 2026-10-10, where Base Set Gust of Wind (base1-93) was named confidently as
 * its Base Set 2 reprint (base4-120) by the vector, and Base Set Electabuzz
 * (base1-20) as base4-24 with the printed name "corroborating" it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { artSiblings } from '../artFamilies.js';
import { resolveCard, type CatalogCard, type CatalogPort, type OcrFields } from '../resolve.js';

const MODEL = 'clip-vit-b32-openai'; // simMin 0.74 / marginMin 0.02

const card = (cardId: string, name: string, number: string, setId: string): CatalogCard => ({
  cardId,
  name,
  number,
  numberNumeric: /^\d+$/.test(number) ? Number.parseInt(number, 10) : null,
  setId,
  setName: setId,
  seriesId: 'base',
  rarity: null,
});

const CARDS: CatalogCard[] = [
  card('base1-93', 'Gust of Wind', '93', 'base1'),
  card('base4-120', 'Gust of Wind', '120', 'base4'),
  card('base1-20', 'Electabuzz', '20', 'base1'),
  card('base4-24', 'Electabuzz', '24', 'base4'),
  card('sv02-050', 'Marill', '050', 'sv02'),
];
const OFFICIAL: Record<string, number> = { base1: 102, base4: 130, sv02: 193 };
const FAMILIES: Record<string, string[]> = {
  'base1-93': ['base4-120'],
  'base4-120': ['base1-93'],
  'base1-20': ['base4-24'],
  'base4-24': ['base1-20'],
};
const siblings = (id: string) => FAMILIES[id] ?? [];

const port: CatalogPort = {
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
    return CARDS.filter((c) => c.name.toLowerCase().startsWith(probe.prefix));
  },
  async officialCounts(setIds) {
    return new Map(setIds.map((s) => [s, OFFICIAL[s] ?? null]));
  },
};

const run = (fields: OcrFields, vector: { cardId: string; similarity: number }[], guard = true) =>
  resolveCard(fields, [], port, {
    phashConfidentMax: 9,
    fusion: { vectorMatches: vector, modelId: MODEL },
    ...(guard ? { artSiblings: siblings } : {}),
  });

test('a decisive vector names the FAMILY, not the printing: the reader picks, siblings first', async () => {
  // The owner's photo: a Base Set Gust of Wind, the vector sure it is Base Set 2.
  const vector = [
    { cardId: 'base4-120', similarity: 0.83 },
    { cardId: 'sv02-050', similarity: 0.6 },
  ];
  const before = await run({}, vector, false);
  assert.equal(before.confident, true, 'without the guard the picture alone named a printing');
  assert.equal(before.matches[0]!.cardId, 'base4-120');

  const after = await run({}, vector);
  assert.equal(after.confident, false, 'a picture shared by two printings does not name one');
  assert.equal(after.matched, true, 'the card is still identified — only the printing is open');
  assert.deepEqual(
    after.matches.slice(0, 2).map((m) => m.cardId),
    ['base4-120', 'base1-93'],
    'the sibling the reader chooses between is hydrated and listed next',
  );
});

test('a printed name every printing shares does not decide the printing either', async () => {
  const out = await run({ name: 'Electabuzz' }, [
    { cardId: 'base4-24', similarity: 0.85 },
    { cardId: 'sv02-050', similarity: 0.5 },
  ]);
  assert.equal(out.confident, false);
  assert.deepEqual(out.matches.slice(0, 2).map((m) => m.cardId).sort(), ['base1-20', 'base4-24']);
});

test('a printed number with its denominator names the printing, and the guard leaves it alone', async () => {
  // "93/102" exists on exactly one printing — the Base Set one.
  const out = await run({ number: '93', denominator: '102' }, [
    { cardId: 'base4-120', similarity: 0.83 },
    { cardId: 'sv02-050', similarity: 0.6 },
  ]);
  assert.equal(out.resolvedBy, 'number+denominator');
  assert.equal(out.confident, true);
  assert.equal(out.matches[0]!.cardId, 'base1-93');
});

test('a card with no same-art sibling is untouched', async () => {
  const out = await run({}, [
    { cardId: 'sv02-050', similarity: 0.86 },
    { cardId: 'base1-20', similarity: 0.6 },
  ]);
  assert.equal(out.confident, true);
  assert.equal(out.matches[0]!.cardId, 'sv02-050');
});

test('the shipped table knows the Base Set reprints the owner photographed', () => {
  // The pairs from the 2026-10-10 verification, each confidently mis-named.
  const pairs: Array<[string, string]> = [
    ['base1-93', 'base4-120'], // Gust of Wind
    ['base1-20', 'base4-24'], // Electabuzz
    ['base1-47', 'base4-71'], // Diglett
    ['base1-38', 'base4-57'], // Poliwhirl
    ['base1-12', 'lc-17'], // Ninetales
    ['base1-78', 'lc-104'], // Scoop Up
  ];
  for (const [a, b] of pairs) assert.ok(artSiblings(a).includes(b), `${a} and ${b} share a picture`);
  assert.deepEqual(artSiblings('no-such-card'), []);
});
