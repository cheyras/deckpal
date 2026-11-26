/**
 * The vision read (`readCard.ts`) and the hold the ladder puts on keys it read
 * (`resolve.ts` `holdTheModelsKeys`). The resolve cases are the confident-wrong
 * answers Claude Sonnet 5.5's reads produced on the 2026-11-25 benchmark replay.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { VectorMatch } from '../fuse.js';
import { DEFAULT_SCAN_READ_MODEL, parseCardRead, scanReadModel } from '../readCard.js';
import { normalizeCardName, resolveCard, type CatalogCard, type CatalogPort, type OcrFields } from '../resolve.js';

// ── parsing the reply ────────────────────────────────────────────────────────

test('a reply in a fenced block reads into ladder fields', () => {
  const r = parseCardRead(
    '```json\n{"isCard":true,"isCardBack":false,"name":"Purrloin","hp":60,"number":"064","total":"103","setCode":"DRI","attacks":["Dig Claws"],"legibility":"clear"}\n```',
  );
  assert.deepEqual(r, {
    isCard: true,
    isCardBack: false,
    fields: { name: 'Purrloin', number: '064', denominator: '103', setCode: 'DRI' },
    legibility: 'clear',
  });
});

test('nulls, "null" strings and blanks are left out, numbers become strings', () => {
  const r = parseCardRead('{"isCard":true,"name":"Mantine","number":25,"total":null,"setCode":"null","legibility":"partial"}');
  assert.deepEqual(r?.fields, { name: 'Mantine', number: '25' });
});

test('with neither name nor number, attacks and abilities feed the family-text rung', () => {
  const r = parseCardRead('{"isCard":true,"name":null,"number":null,"attacks":["Ram"],"abilities":["Punk Out"]}');
  assert.deepEqual(r?.fields, { bodyLines: ['Ram', 'Punk Out'] });
});

test('a card back or a non-card has no fields', () => {
  assert.deepEqual(parseCardRead('{"isCard":false,"isCardBack":true,"name":"x"}')?.fields, {});
  assert.equal(parseCardRead('{"isCard":false,"isCardBack":true}')?.isCardBack, true);
  assert.equal(parseCardRead('{"isCard":false,"name":"x"}')?.isCard, false);
});

test('no JSON object is no read', () => {
  assert.equal(parseCardRead('I cannot see a card.'), null);
  assert.equal(parseCardRead('{not json}'), null);
});

test('the model is Sonnet 5.5 unless configured, and off means off', () => {
  assert.equal(scanReadModel({}), DEFAULT_SCAN_READ_MODEL);
  assert.equal(scanReadModel({ SCAN_READ_MODEL: 'google/gemini-3.6-flash' }), 'google/gemini-3.6-flash');
  assert.equal(scanReadModel({ SCAN_READ_MODEL: 'off' }), null);
});

// ── the hold on a model's keys ───────────────────────────────────────────────

const card = (cardId: string, name: string, number: string, setId: string): CatalogCard => ({
  cardId,
  name,
  number,
  numberNumeric: /^\d+$/.test(number) ? Number(number) : null,
  setId,
  setName: setId,
  seriesId: 'sv',
  rarity: null,
});
const CARDS: CatalogCard[] = [
  card('sv01-022', 'Dolliv', '022', 'sv01'),
  card('sv10-022', 'Dolliv', '022', 'sv10'),
  card('sv03-174', 'Bouffalant', '174', 'sv03'),
  card('sv07-139', 'Lacey', '139', 'sv07'),
  card('me06-080', 'Azurill', '080', 'me06'),
  card('sv08-002', 'Exeggutor', '002', 'sv08'),
];
const OFFICIAL: Record<string, number> = { sv01: 198, sv10: 182, sv03: 197, sv07: 142, me06: 103, sv08: 191 };
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
    return CARDS.filter((c) => normalizeCardName(c.name).startsWith(probe.prefix));
  },
  async officialCounts(setIds) {
    return new Map(setIds.map((s) => [s, OFFICIAL[s] ?? null]));
  },
};
const resolve = (fields: OcrFields, vectorMatches: VectorMatch[], readSource?: 'vlm') =>
  resolveCard(fields, [], port, {
    phashConfidentMax: 9,
    fusion: { vectorMatches, modelId: 'deckpal-card-b32-v2' },
    ...(readSource ? { readSource } : {}),
  });

test('a model-read key the picture decisively contradicts is held (Dolliv 022/198 for 022/182)', async () => {
  const vec = [
    { cardId: 'sv10-022', similarity: 0.82 },
    { cardId: 'sv01-022', similarity: 0.49 },
  ];
  const ocr = await resolve({ name: 'Dolliv', number: '022', denominator: '198' }, vec);
  assert.equal(ocr.confident, true, 'device OCR keeps rule 1: a resolved key is not reviewed by the vector');
  const vlm = await resolve({ name: 'Dolliv', number: '022', denominator: '198' }, vec, 'vlm');
  assert.equal(vlm.confident, false);
  assert.equal(vlm.matches[0]?.cardId, 'sv01-022', 'the list is kept');
});

test('a model-read key whose card the read name does not agree with is held (Lacey read 174/197)', async () => {
  const vlm = await resolve({ name: 'Lacey', number: '174', denominator: '197' }, [], 'vlm');
  assert.equal(vlm.confident, false);
});

test('an answer the picture decided is not held for a misread number (Azurill read 001/191)', async () => {
  const vlm = await resolve({ name: 'Azurill', number: '001', denominator: '191' }, [
    { cardId: 'me06-080', similarity: 0.75 },
    { cardId: 'sv08-002', similarity: 0.43 },
  ], 'vlm');
  assert.equal(vlm.confident, true);
  assert.equal(vlm.matches[0]?.cardId, 'me06-080');
});

test('a clean model read that agrees with itself stays confident', async () => {
  const vlm = await resolve({ name: 'Lacey', number: '139', denominator: '142' }, [], 'vlm');
  assert.equal(vlm.confident, true);
  assert.equal(vlm.matches[0]?.cardId, 'sv07-139');
});
