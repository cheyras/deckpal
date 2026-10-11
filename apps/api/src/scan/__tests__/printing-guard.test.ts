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

import { artSiblings, printingOpenFor } from '../artFamilies.js';
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
  // The review's regression (2026-10-10): Black & White Audino and its
  // McDonald's 2011 reprint share a picture; Steam Siege ALSO prints /114.
  card('bw1-87', 'Audino', '87', 'bw1'),
  card('2011bw-12', 'Audino', '12', '2011bw'),
  card('xy11-87', 'Hydreigon BREAK', '87', 'xy11'),
  card('xy11-20', 'Audino', '20', 'xy11'), // synthetic: a second Audino in a /114 set
  // Synthetic: a reprint set that kept the numbering AND the set size, so the
  // printed key cannot tell the two printings apart; plus a third printing.
  card('rs1-10', 'Pikachu', '10', 'rs1'),
  card('rs2-10', 'Pikachu', '10', 'rs2'),
  card('rsp-9', 'Pikachu', '9', 'rsp'),
];
const OFFICIAL: Record<string, number> = {
  base1: 102,
  base4: 130,
  sv02: 193,
  bw1: 114,
  xy11: 114,
  '2011bw': 12,
  rs1: 100,
  rs2: 100,
  rsp: 30,
};
const FAMILIES: Record<string, string[]> = {
  'base1-93': ['base4-120'],
  'base4-120': ['base1-93'],
  'base1-20': ['base4-24'],
  'base4-24': ['base1-20'],
  'bw1-87': ['2011bw-12'],
  '2011bw-12': ['bw1-87'],
  'rs1-10': ['rs2-10', 'rsp-9'],
  'rs2-10': ['rs1-10', 'rsp-9'],
  'rsp-9': ['rs1-10', 'rs2-10'],
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

  assert.equal(before.printingOpen, undefined);

  const after = await run({}, vector);
  assert.equal(after.confident, false, 'a picture shared by two printings does not name one');
  assert.equal(after.matched, true, 'the card is still identified — only the printing is open');
  assert.equal(after.printingOpen, true, 'and the outcome says the guard is why');
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
  assert.equal(out.printingOpen, undefined, 'untouched, so nothing new goes on the wire');
});

test('a card with no same-art sibling is untouched', async () => {
  const out = await run({}, [
    { cardId: 'sv02-050', similarity: 0.86 },
    { cardId: 'base1-20', similarity: 0.6 },
  ]);
  assert.equal(out.confident, true);
  assert.equal(out.matches[0]!.cardId, 'sv02-050');
  assert.equal(out.printingOpen, undefined);
});

// ── A PRINTED KEY THAT ALREADY RULED THE SIBLINGS OUT (review, 2026-10-10) ──

test('a vector tie-break inside a printed key that EXCLUDED every sibling stays confident', async () => {
  // `87/114` is Black & White Audino or Steam Siege Hydreigon BREAK — two
  // different pictures — and the vector picks Audino. Audino's same-art
  // McDonald's reprint prints 12/12: the key already ruled it out.
  const vector = [
    { cardId: 'bw1-87', similarity: 0.7 },
    { cardId: 'xy11-87', similarity: 0.6 },
  ];
  const before = await run({ number: '87', denominator: '114' }, vector, false);
  assert.equal(before.resolvedBy, 'corroborated');
  assert.equal(before.confident, true);
  assert.deepEqual(before.matches.map((m) => m.cardId), ['bw1-87', 'xy11-87']);

  const after = await run({ number: '87', denominator: '114' }, vector);
  assert.equal(after.resolvedBy, 'corroborated');
  assert.equal(after.keyedBy, 'number+denominator', 'the keyed rung is remembered (server-side only)');
  assert.equal(after.confident, true, 'the guard leaves a key-settled printing alone');
  assert.equal(after.printingOpen, undefined);
  assert.deepEqual(
    after.matches.map((m) => m.cardId),
    ['bw1-87', 'xy11-87'],
    'and does not put the excluded reprint into the picker',
  );
});

test('the same, through the name+denominator family', async () => {
  // Two Audinos in /114 sets; the McDonald's one is in a /12 set.
  const out = await run({ name: 'Audino', denominator: '114' }, [
    { cardId: 'bw1-87', similarity: 0.7 },
    { cardId: 'xy11-87', similarity: 0.6 },
  ]);
  assert.equal(out.resolvedBy, 'corroborated');
  assert.equal(out.keyedBy, 'name+denominator');
  assert.equal(out.confident, true);
  assert.equal(out.printingOpen, undefined);
  assert.deepEqual(out.matches.map((m) => m.cardId), ['bw1-87', 'xy11-20']);
});

test('a sibling INSIDE the keyed list keeps the printing open', async () => {
  // `10/100` names two printings of one picture; the key cannot tell them
  // apart and neither can the vector, however wide its margin looks.
  const out = await run({ number: '10', denominator: '100' }, [
    { cardId: 'rs1-10', similarity: 0.7 },
    { cardId: 'rsp-9', similarity: 0.6 },
  ]);
  assert.equal(out.keyedBy, 'number+denominator');
  assert.equal(out.confident, false);
  assert.equal(out.matched, true);
  assert.equal(out.printingOpen, true);
  assert.deepEqual(out.matches.map((m) => m.cardId).sort(), ['rs1-10', 'rs2-10', 'rsp-9']);
});

test('listed and hydrated siblings are ranked together, by evidence', async () => {
  // rs2-10 was in the keyed list but no signal nominated it; rsp-9 was not in
  // the list (hydrated) but is the vector's runner-up. Evidence goes first.
  const out = await run({ number: '10', denominator: '100' }, [
    { cardId: 'rs1-10', similarity: 0.7 },
    { cardId: 'rsp-9', similarity: 0.6 },
  ]);
  assert.deepEqual(out.matches.map((m) => m.cardId), ['rs1-10', 'rsp-9', 'rs2-10']);
});

test("the decisive-vector rescue's list is not keyed, so the guard still opens it", async () => {
  // `20/102` keys Base Set Electabuzz, the hash (distance 3) contradicts it, and
  // a decisive vector the printed name agrees with names Gust of Wind instead
  // — in the Base Set 2 printing. The key ruled out nothing about THAT card.
  const out = await resolveCard(
    { name: 'Gust of Wind', number: '20', denominator: '102' },
    [{ cardId: 'base4-120', distance: 3 }],
    port,
    {
      phashConfidentMax: 9,
      fusion: {
        vectorMatches: [
          { cardId: 'base4-120', similarity: 0.83 },
          { cardId: 'sv02-050', similarity: 0.6 },
        ],
        modelId: MODEL,
      },
      artSiblings: siblings,
    },
  );
  assert.equal(out.resolvedBy, 'corroborated');
  assert.equal(out.keyedBy, undefined, 'letDecisiveVectorSpeak carries no keyed rung');
  assert.equal(out.confident, false);
  assert.equal(out.printingOpen, true);
  assert.deepEqual(out.matches.slice(0, 2).map((m) => m.cardId), ['base4-120', 'base1-93']);
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

test("POST /scan's guard: a hash top-1 with a same-art reprint leaves the printing open", () => {
  assert.equal(printingOpenFor('base1-93'), true);
  assert.equal(printingOpenFor('2011bw-12'), true);
  assert.equal(printingOpenFor('no-such-card'), false);
  assert.equal(printingOpenFor(undefined), false, 'no top-1 is never open');
});

test('the foil pass joins a holo and a non-holo printing of one picture in the same set', () => {
  // The holo foil scrambles the art features (Fossil Dragonite: 447 inliers,
  // 47 in the art band), so the ORB rule missed these; the owner's photo of
  // base3-19 was named confidently as base3-4.
  const pairs: Array<[string, string]> = [
    ['base3-4', 'base3-19'], // Dragonite, Fossil holo / non-holo
    ['base2-5', 'base2-21'], // Kangaskhan, Jungle holo / non-holo
  ];
  for (const [a, b] of pairs) assert.ok(artSiblings(a).includes(b), `${a} and ${b} share a picture`);
});

test('a frame and rules text in common is not a picture in common', () => {
  // Same name, same layout, hundreds of whole-card inliers — and a different
  // picture: alt arts, shiny versions, full-art supporters, a rainbow recolour.
  const different: Array<[string, string]> = [
    ['smp-SM116', 'sma-SV14'], // Xurkitree, promo / Shiny Vault
    ['sv03.5-100', 'sv04.5-133'], // Voltorb / shiny Voltorb
    ['sm1-122', 'sm5-125'], // Lillie, two full-art supporters
    ['sm11-222', 'sm11-242'], // Mewtwo & Mew GX, full art / rainbow
    ['basep-3', 'basep-14'], // Mewtwo, two Black Star promos
    ['swsh8-165', 'swsh12-109'], // Croagunk
  ];
  for (const [a, b] of different) assert.ok(!artSiblings(a).includes(b), `${a} and ${b} are different pictures`);
});

test('the hash may not name a WotC-era card on its own, nor a card whose printing is open', async () => {
  const { hashMayNameAlone } = await import('../artFamilies.js');
  assert.equal(hashMayNameAlone('lc-79'), false, 'the Machop a Hitmonchan photo hashed to at distance 4');
  assert.equal(hashMayNameAlone('neo1-17'), false);
  assert.equal(hashMayNameAlone('ecard2-12'), false);
  assert.equal(hashMayNameAlone('base1-93'), false, 'vintage AND a same-art family');
  assert.equal(hashMayNameAlone('sv02-050'), true, 'a modern card with no reprint keeps the shortcut');
  assert.equal(hashMayNameAlone('swsh7-87'), true);
  assert.equal(hashMayNameAlone(undefined), false);
});
