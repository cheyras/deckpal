/**
 * THE PRINT PICKS THE PRINTING, THE PICTURE PICKS THE CARD (fuse.ts
 * `corroborateByPicture`, 2026-11-27).
 *
 * The owner's White Flare session: Energy Retrieval sv10.5w-082 is Scarlet &
 * Violet's sv01-171 picture for picture (the shipped art-families table joins
 * them), so the vector's top-1 between the two is a coin toss. A printed key
 * that ruled sv01-171 out (`/086` is not `/198`) still left the reader with a
 * question, because the vector "agreed" with the twin outside the list, or,
 * when it did pick sv10.5w-082, was "not separated" from that twin.
 *
 * Uses the REAL art families, so the pair under test is the shipped one.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { artSiblings } from '../artFamilies.js';
import { corroborateByPicture, vectorVerdict } from '../fuse.js';
import { resolveCard, type CatalogCard, type CatalogPort, type OcrFields } from '../resolve.js';

const MODEL = 'deckpal-card-b32-v2'; // simMin 0.65 / marginMin 0.03 / simFloor 0.45

const card = (cardId: string, name: string, number: string, setId: string): CatalogCard => ({
  cardId,
  name,
  number,
  numberNumeric: /^\d+$/.test(number) ? Number.parseInt(number, 10) : null,
  setId,
  setName: setId,
  seriesId: setId.startsWith('me') ? 'me' : 'sv',
  rarity: null,
});

const CARDS: CatalogCard[] = [
  card('sv01-171', 'Energy Retrieval', '171', 'sv01'),
  card('sv10.5w-082', 'Energy Retrieval', '082', 'sv10.5w'),
  card('me04-108', 'Energy Retrieval', '108', 'me04'),
  card('sv10.5b-082', 'Fennel', '082', 'sv10.5b'),
  card('me04-082', 'Special Red Card', '082', 'me04'),
  card('sv10.5w-008', 'Lilligant', '008', 'sv10.5w'),
];
const OFFICIAL: Record<string, number> = { sv01: 198, 'sv10.5w': 86, 'sv10.5b': 86, me04: 86 };

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

/** The two printings 0.002 apart, in the order given, then everything else far below. */
const twins = (first: string, second: string) => [
  { cardId: first, similarity: 0.93 },
  { cardId: second, similarity: 0.928 },
  { cardId: 'me04-108', similarity: 0.61 },
  { cardId: 'sv10.5b-082', similarity: 0.42 },
];

const run = (fields: OcrFields, vector: { cardId: string; similarity: number }[], guard = true) =>
  resolveCard(fields, [], port, {
    phashConfidentMax: 9,
    fusion: { vectorMatches: vector, modelId: MODEL },
    ...(guard ? { artSiblings } : {}),
  });

test('the shipped art families hold the White Flare / Scarlet & Violet Energy Retrieval pair', () => {
  assert.ok(artSiblings('sv10.5w-082').includes('sv01-171'));
  assert.ok(!artSiblings('sv10.5w-082').includes('me04-108'), 'the Chaos Rising one is a different picture');
});

for (const [top, second] of [
  ['sv01-171', 'sv10.5w-082'],
  ['sv10.5w-082', 'sv01-171'],
] as const) {
  test(`082/086 with no name: the number picks White Flare, whichever twin the vector put first (${top})`, async () => {
    const o = await run({ number: '082', denominator: '086' }, twins(top, second));
    assert.equal(o.confident, true);
    assert.equal(o.resolvedBy, 'corroborated');
    assert.equal(o.matches[0]!.cardId, 'sv10.5w-082');
    assert.equal(o.printingOpen, undefined, 'the key already ruled the twin out, so the guard leaves it');
  });

  test(`08/086 + "Energy Retrieval" (a dropped digit): name + denominator + picture name it (${top})`, async () => {
    const o = await run({ name: 'Energy Retrieval', number: '08', denominator: '086' }, twins(top, second));
    assert.equal(o.confident, true);
    assert.equal(o.matches[0]!.cardId, 'sv10.5w-082');
  });

  test(`the name alone still asks: every printing carries it (${top})`, async () => {
    const o = await run({ name: 'Energy Retrieval' }, twins(top, second));
    assert.equal(o.confident, false);
    assert.deepEqual(new Set(o.matches.slice(0, 2).map((m) => m.cardId)), new Set(['sv01-171', 'sv10.5w-082']));
  });
}

test('a picture that does not stand clear of the other cards in the list is no agreement', async () => {
  const o = await run({ number: '082', denominator: '086' }, [
    { cardId: 'sv01-171', similarity: 0.7 },
    { cardId: 'sv10.5w-082', similarity: 0.699 },
    { cardId: 'sv10.5b-082', similarity: 0.69 }, // a different card, within marginMin
  ]);
  assert.equal(o.confident, false);
});

test('without the art families (guard off) nothing changes: the twin outside the list is still no agreement', async () => {
  const o = await run({ number: '082', denominator: '086' }, twins('sv01-171', 'sv10.5w-082'), false);
  assert.equal(o.confident, false);
});

test('corroborateByPicture: exactly one printing of the picture in the list, or nothing', () => {
  const vec = twins('sv01-171', 'sv10.5w-082');
  const signals = { vector: vectorVerdict(vec, MODEL), phashNearExact: null };
  const pick = (ids: string[]) => corroborateByPicture(ids, signals, vec, artSiblings, MODEL);
  assert.equal(pick(['sv10.5w-082', 'sv10.5b-082', 'me04-082']), 'sv10.5w-082');
  assert.equal(pick(['sv10.5w-082', 'sv01-171']), null, 'both printings in the list: the print did not decide');
  assert.equal(pick(['sv10.5b-082', 'me04-082']), null, 'no printing of the picture in the list');
  // A near-exact hash on a card outside the picture vetoes; one inside it does not.
  const veto = { vector: signals.vector, phashNearExact: 'sv10.5b-082' };
  assert.equal(corroborateByPicture(['sv10.5w-082', 'sv10.5b-082'], veto, vec, artSiblings, MODEL), null);
  const ally = { vector: signals.vector, phashNearExact: 'sv10.5w-082' };
  assert.equal(corroborateByPicture(['sv10.5w-082', 'sv10.5b-082'], ally, vec, artSiblings, MODEL), 'sv10.5w-082');
  // A picture with no siblings is plain `corroborate`'s question, not this one's.
  const lone = [
    { cardId: 'sv10.5b-082', similarity: 0.9 },
    { cardId: 'me04-082', similarity: 0.5 },
  ];
  const loneSignals = { vector: vectorVerdict(lone, MODEL), phashNearExact: null };
  assert.equal(corroborateByPicture(['sv10.5b-082', 'me04-082'], loneSignals, lone, artSiblings, MODEL), null);
});
