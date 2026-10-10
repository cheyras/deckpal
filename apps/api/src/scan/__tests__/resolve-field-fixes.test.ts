/**
 * The 2026-10-09 ladder fixes, each pinned to the real-capture failure that
 * motivated it (scan benchmark, scripts/scan-bench, 256 real crops):
 *
 *   1. `cleanNameRead` — OCR reads the card's frame along with its name
 *      (`BAS社 Torchic`, `Team Rocket's Koffing H70o`, a bare `suppoter`).
 *   2. `name+denominator` — a dropped numerator digit (`03/182` for `063/182`)
 *      named two wrong cards; the name and the denominator still name one.
 *   3. A decisive vector that the PRINTED NAME agrees with is the answer even
 *      when an unconfident key rung came first (`Quilava` off `Ethan's Quilava`).
 *   4. …and nothing else about the vector's standing changes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  cleanNameRead,
  nameAgrees,
  resolveCard,
  type CatalogCard,
  type CatalogPort,
  type OcrFields,
} from '../resolve.js';

const MODEL = 'clip-vit-b32-openai';

const card = (cardId: string, name: string, number: string, setId: string): CatalogCard => ({
  cardId,
  name,
  number,
  numberNumeric: /^\d+$/.test(number) ? Number.parseInt(number, 10) : null,
  setId,
  setName: setId,
  seriesId: setId.replace(/\d.*$/, ''),
  rarity: null,
});

const CARDS: CatalogCard[] = [
  card('sv10-063', 'Barraskewda', '063', 'sv10'),
  card('sv10-003', 'Pinsir', '003', 'sv10'),
  card('sv04-003', 'Pineco', '003', 'sv04'),
  card('sv01-049', 'Barraskewda', '049', 'sv01'),
  card('sv08-143', 'Quilava', '143', 'sv08'),
  card('dp2-60', 'Quilava', '60', 'dp2'),
  card('sv09-024', "Ethan's Quilava", '024', 'sv09'),
  card('sve-003', 'Basic Water Energy', '003', 'sve'),
  card('sv02-050', 'Marill', '050', 'sv02'),
  card('sv02-051', 'Azumarill', '051', 'sv02'),
  card('sv07-050', 'Marill', '050', 'sv07'),
];
const OFFICIAL: Record<string, number> = { sv10: 182, sv04: 182, sv01: 198, sv08: 191, dp2: 123, sv09: 159, sve: 0, sv02: 193, sv07: 142 };

const fold = (s: string) => s.toLowerCase();
const basePort: CatalogPort = {
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
    return CARDS.filter((c) => fold(c.name).startsWith(probe.prefix) || fold(c.name).includes(probe.normalized));
  },
};
const port: CatalogPort = {
  ...basePort,
  async officialCounts(setIds) {
    return new Map(setIds.map((s) => [s, OFFICIAL[s] ?? null]));
  },
};

const run = (fields: OcrFields, vector?: { cardId: string; similarity: number }[], p: CatalogPort = port) =>
  resolveCard(fields, [], p, {
    phashConfidentMax: 9,
    ...(vector ? { fusion: { vectorMatches: vector, modelId: MODEL } } : {}),
  });

// ── 1. The name, without the frame ──────────────────────────────────────────

test('cleanNameRead strips what OCR reads off the frame, and nothing a card prints', () => {
  assert.equal(cleanNameRead('BAS社 Torchic'), 'Torchic');
  assert.equal(cleanNameRead("Team Rocket's Koffing H70o"), "Team Rocket's Koffing");
  assert.equal(cleanNameRead('Wash Rotom HP80C'), 'Wash Rotom');
  assert.equal(cleanNameRead('STAGE 1 Quilava'), 'Quilava');
  assert.equal(cleanNameRead('suppoter'), null);
  // Real names that begin with a word the stage badge also uses.
  assert.equal(cleanNameRead('Basic Water Energy'), 'Basic Water Energy');
  assert.equal(cleanNameRead('Item Finder'), 'Item Finder');
  assert.equal(cleanNameRead('Pokémon Breeder'), 'Pokémon Breeder');
  assert.equal(cleanNameRead('Tool Box'), 'Tool Box');
  assert.equal(cleanNameRead('Mr. Mime'), 'Mr. Mime');
  assert.equal(cleanNameRead('  '), null);
});

test('nameAgrees forgives a lost owner prefix or a clipped first word, and nothing more', () => {
  assert.equal(nameAgrees('Quilava', "Ethan's Quilava"), true);
  assert.equal(nameAgrees('Golbat', "Team Rocket's Golbat"), true);
  assert.equal(nameAgrees('oice Band', "Hop's Choice Band"), true);
  assert.equal(nameAgrees('Floragato', 'Floragato'), true);
  // A read that is a whole, DIFFERENT card name is a different card.
  assert.equal(nameAgrees('Kadabra', 'Abra'), false);
  assert.equal(nameAgrees('Abra', 'Kadabra'), false);
  assert.equal(nameAgrees('Kabuto', 'Kabutops'), false);
  assert.equal(nameAgrees('Kabutops', 'Kabuto'), false);
  assert.equal(nameAgrees('Porygon-Z', 'Porygon'), false);
  assert.equal(nameAgrees('Potion', 'Super Potion'), false);
  assert.equal(nameAgrees('Pikachu', 'Flying Pikachu'), false);
  assert.equal(nameAgrees('Pikachu', 'Raichu'), false);
  assert.equal(nameAgrees('Mew', 'Mewtwo'), false);
});

test('cleanNameRead keeps real one- and two-letter names', () => {
  assert.equal(cleanNameRead('N'), 'N');
  assert.equal(cleanNameRead('AZ'), 'AZ');
});

// ── 2. The dropped digit ────────────────────────────────────────────────────

test('a dropped numerator digit no longer names the wrong cards: name + denominator does', async () => {
  // `03/182` keys sv10-003 Pinsir and sv04-003 Pineco; the title says
  // Barraskewda, and the only Barraskewda in a 182-card set is sv10-063.
  const r = await run({ name: 'Barraskewda', number: '03', denominator: '182' });
  assert.equal(r.resolvedBy, 'name+denominator');
  assert.equal(r.confident, true);
  assert.equal(r.matches[0]!.cardId, 'sv10-063');
});

test('when the name names nothing either, the key`s own candidates come back as before', async () => {
  const r = await run({ name: 'Zzqxv Wbbt', number: '03', denominator: '182' });
  assert.equal(r.resolvedBy, 'number+denominator');
  assert.equal(r.confident, false);
  assert.deepEqual(r.matches.map((m) => m.cardId).sort(), ['sv04-003', 'sv10-003']);
});

test('with the vector ON, a garbage name and a keyed pair behave exactly as before', async () => {
  // The key's own candidates come back above the vector rung, so a showable
  // vector inside them still corroborates (as rung 4 always allowed)…
  const inside = await run({ name: 'Zzqxv Wbbt', number: '03', denominator: '182' }, [
    { cardId: 'sv10-003', similarity: 0.7 },
    { cardId: 'sv01-049', similarity: 0.6 },
  ]);
  assert.equal(inside.resolvedBy, 'corroborated');
  assert.equal(inside.matches[0]!.cardId, 'sv10-003');
  // …and a decisive vector OUTSIDE them is still a disagreement, silent.
  const outside = await run({ name: 'Zzqxv Wbbt', number: '03', denominator: '182' }, [
    { cardId: 'sv01-049', similarity: 0.9 },
    { cardId: 'sv10-063', similarity: 0.6 },
  ]);
  assert.equal(outside.confident, false);
  assert.equal(outside.resolvedBy, 'number+denominator');
});

test('a decisive vector does not overrule a name and a number that agree with each other', async () => {
  // `Barraskewda 049/198` keys sv01-049 by name+number; the hash, confidently
  // sure of something else, keeps it unconfident. A decisive picture of the OTHER
  // Barraskewda printing must not then win on the strength of the name alone.
  const r = await resolveCard(
    { name: 'Barraskewda', number: '049', denominator: '198' },
    [{ cardId: 'sv10-003', distance: 3 }],
    port,
    { phashConfidentMax: 9, fusion: { vectorMatches: [{ cardId: 'sv10-063', similarity: 0.9 }, { cardId: 'sv01-049', similarity: 0.6 }], modelId: MODEL } },
  );
  assert.notEqual(r.matches[0]?.cardId === 'sv10-063' && r.confident, true);
});

test('a cleanly read real name is not overruled by a picture of a longer name that ends in it', async () => {
  // `Marill` is a card. A decisive (wrong) vector on Azumarill must not turn
  // the read into a clipped `Azumarill`.
  const r = await run({ name: 'Marill' }, [
    { cardId: 'sv02-051', similarity: 0.9 },
    { cardId: 'sv02-050', similarity: 0.6 },
  ]);
  assert.equal(r.confident && r.matches[0]!.cardId === 'sv02-051', false);
});

test('the name+number early return: a vector does not overrule a name that narrowed a number', async () => {
  // `Marill 050` keys two printings by name+number (sv02-050, sv07-050); a
  // decisive picture of the sv07 one does not get to promote itself past the
  // name+number rung's own candidates.
  const r = await run({ name: 'Marill', number: '050' }, [
    { cardId: 'sv07-050', similarity: 0.9 },
    { cardId: 'sv02-050', similarity: 0.6 },
  ]);
  assert.equal(r.resolvedBy === 'name+number' || r.resolvedBy === 'corroborated', true);
  // Whatever the rung decided, it was the rung (with `corroborate`'s rules),
  // not the post-climb override: the override is skipped after name+number.
  assert.ok(r.matches.every((m) => m.name === 'Marill'));
});

test('a port without officialCounts simply never reaches the name+denominator rung', async () => {
  const r = await run({ name: 'Barraskewda', number: '03', denominator: '182' }, undefined, basePort);
  assert.notEqual(r.resolvedBy, 'name+denominator');
  assert.equal(r.confident, false);
});

// ── 3 and 4. The decisive vector and the printed name ───────────────────────

test('a decisive vector the printed name agrees with is the answer after an unsure rung', async () => {
  // OCR read `Quilava` (the owner prefix lost), so rung 5b named the plain
  // Quilava family; the picture is Ethan's Quilava, decisively.
  const r = await run({ name: 'Quilava' }, [
    { cardId: 'sv09-024', similarity: 0.86 },
    { cardId: 'sv08-143', similarity: 0.7 },
  ]);
  assert.equal(r.resolvedBy, 'corroborated');
  assert.equal(r.confident, true);
  assert.equal(r.matches[0]!.cardId, 'sv09-024');
});

test('a decisive vector the printed name DISAGREES with stays a question', async () => {
  const r = await run({ name: 'Quilava' }, [
    { cardId: 'sv10-063', similarity: 0.9 },
    { cardId: 'sv01-049', similarity: 0.6 },
  ]);
  assert.equal(r.confident, false);
  assert.ok(!r.matches.some((m) => m.cardId === 'sv10-063'), 'the vector`s card is not added to a list it did not come from');
});

test('an indecisive vector is not promoted by agreeing with the name', async () => {
  const r = await run({ name: 'Quilava' }, [
    { cardId: 'sv09-024', similarity: 0.86 },
    { cardId: 'sv08-143', similarity: 0.85 },
  ]);
  assert.equal(r.confident, false);
});
