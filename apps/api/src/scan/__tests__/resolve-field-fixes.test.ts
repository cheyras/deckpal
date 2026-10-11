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
 *   5. (2026-10-10, the owner's verified photos) A dropped digit that lands on
 *      a REAL single card (`23/197` for `223/197`) is no longer confident when
 *      the printed name agrees with another card that a second signal also
 *      names — and a name that merely disagrees still changes nothing.
 *   6. (PR #297 review, verified on the real catalogue) What that review must
 *      NOT do: let a badge+number key fall to a card from another set, treat a
 *      piece of the keyed card's own name as a different card, or demote a key
 *      the vector's own top-1 agrees with. Plus the list cut and the name memo.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_MATCHES,
  cleanNameRead,
  nameAgrees,
  readIsFragmentOf,
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

const ids = (matches: { cardId: string }[]): string[] => matches.map((m) => m.cardId);

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

// ── 5. A confident printed number that the printed name argues with ────────
//
// The owner's verified photos, 2026-10-10: a Charizard ex secret rare, sv03-223,
// printed `223/197`. OCR read the title `Charizare` and the strip `23/197`, the
// leading digit dropped. Obsidian Flames is the only 197-card set, so `23/197`
// is exactly one real card, sv03-023 Capsakid, and rung 3 returned it CONFIDENT,
// while the picture was decisive for sv03-223 and the title agreed with Charizard
// ex and not with Capsakid.
//
// The guarantee that must survive the fix: a title that merely DISAGREES with
// the key changes nothing, because OCR garbles titles all the time.

const OBF_CARDS: CatalogCard[] = [
  card('sv03-023', 'Capsakid', '023', 'sv03'),
  card('sv03-024', 'Capsakid', '024', 'sv03'),
  card('sv03-125', 'Charizard ex', '125', 'sv03'),
  card('sv03-223', 'Charizard ex', '223', 'sv03'),
  // The same name in other sets: not 197 cards, so the denominator excludes them.
  card('sv04.5-054', 'Charizard ex', '054', 'sv04.5'),
  card('base1-4', 'Charizard', '4', 'base1'),
  card('sv03.5-025', 'Pikachu', '025', 'sv03.5'),
  card('sv02-050', 'Marill', '050', 'sv02'),
  card('sv02-051', 'Azumarill', '051', 'sv02'),
];
const OBF_OFFICIAL: Record<string, number> = { sv03: 197, 'sv04.5': 91, base1: 102, 'sv03.5': 165, sv02: 193 };
const obfPort: CatalogPort = {
  async bySetAndNumber(setId, n) {
    return OBF_CARDS.filter((c) => c.setId === setId && c.numberNumeric === n);
  },
  async byNumberAndDenominator(n, d) {
    return OBF_CARDS.filter((c) => c.numberNumeric === n && OBF_OFFICIAL[c.setId] === d);
  },
  async byNumber(n) {
    return OBF_CARDS.filter((c) => c.numberNumeric === n);
  },
  async byIds(ids) {
    return OBF_CARDS.filter((c) => ids.includes(c.cardId));
  },
  async byName(probe) {
    return OBF_CARDS.filter((c) => fold(c.name).startsWith(probe.prefix) || fold(c.name).includes(probe.normalized));
  },
  async officialCounts(setIds) {
    return new Map(setIds.map((s) => [s, OBF_OFFICIAL[s] ?? null]));
  },
};

/** The vector exactly as it scored the owner's photo: decisive for sv03-223. */
const CHARIZARD_VECTOR = [
  { cardId: 'sv03-223', similarity: 0.873 },
  { cardId: 'sv03-024', similarity: 0.568 },
];
const DROPPED_DIGIT: OcrFields = { name: 'Charizare', number: '23', denominator: '197' };

const runObf = (
  fields: OcrFields,
  vector?: { cardId: string; similarity: number }[],
  priors: { cardId: string; distance: number }[] = [],
) =>
  resolveCard(fields, priors, obfPort, {
    phashConfidentMax: 9,
    ...(vector ? { fusion: { vectorMatches: vector, modelId: MODEL } } : {}),
  });

test('the premise: `Charizare` agrees with Charizard ex and not with Capsakid', () => {
  assert.equal(nameAgrees('Charizare', 'Charizard ex'), true);
  assert.equal(nameAgrees('Charizare', 'Capsakid'), false);
});

test('the owner`s Charizard: a dropped digit keyed a real card, and the title and the picture overrule it', async () => {
  const r = await runObf(DROPPED_DIGIT, CHARIZARD_VECTOR);
  assert.equal(r.resolvedBy, 'corroborated');
  assert.equal(r.confident, true);
  assert.equal(r.matched, true);
  assert.equal(r.matches[0]!.cardId, 'sv03-223');
  // The keyed card stays on the list: a reader who disagrees needs it.
  assert.ok(r.matches.some((m) => m.cardId === 'sv03-023'));
});

test('…and through the badge too: `OBF 23/197` keyed the same wrong card on rung 1', async () => {
  const r = await runObf({ ...DROPPED_DIGIT, setCode: 'OBF' }, CHARIZARD_VECTOR);
  assert.equal(r.resolvedBy, 'corroborated');
  assert.equal(r.confident, true);
  assert.equal(r.matches[0]!.cardId, 'sv03-223');
});

test('a title read without its `ex`, which is itself a real card name, still gets there via the denominator', async () => {
  // `Charizard` is base1-4, so the read is not forgiven as a damaged Charizard
  // ex the way `Charizare` is; but the Charizard ex printings in a 197-card set
  // are a key-narrowed family, and the decisive picture is one of them.
  const r = await runObf({ name: 'Charizard', number: '23', denominator: '197' }, CHARIZARD_VECTOR);
  assert.equal(r.resolvedBy, 'corroborated');
  assert.equal(r.confident, true);
  assert.equal(r.matches[0]!.cardId, 'sv03-223');
});

test('with no picture, an exact title naming a card of that set size makes the number a question, not an answer', async () => {
  const r = await runObf({ name: 'Charizard ex', number: '23', denominator: '197' });
  assert.equal(r.resolvedBy, 'number+denominator');
  assert.equal(r.confident, false);
  assert.equal(r.matched, true);
  // Both readings are on the list, and nothing outside a 197-card set is.
  assert.deepEqual(ids(r.matches).sort(), ['sv03-023', 'sv03-125', 'sv03-223']);
});

test('an exact title naming a card that is NOT in a set of that size changes nothing', async () => {
  // Pikachu is real but has no printing in a 197-card set, so the title and the
  // denominator do not name a rival card together.
  const r = await runObf({ name: 'Pikachu', number: '23', denominator: '197' });
  assert.equal(r.resolvedBy, 'number+denominator');
  assert.equal(r.confident, true);
  assert.deepEqual(ids(r.matches), ['sv03-023']);
});

for (const garbled of ['Polcemon', 'sic Pokemot', 'Erobvtfrom Yudg rNilena']) {
  test(`a garbled title (\`${garbled}\`) keeps the confident number, with no vector`, async () => {
    const r = await runObf({ name: garbled, number: '23', denominator: '197' });
    assert.equal(r.resolvedBy, 'number+denominator');
    assert.equal(r.confident, true);
    assert.deepEqual(ids(r.matches), ['sv03-023']);
  });

  test(`a garbled title (\`${garbled}\`) keeps the confident number against a decisive vector elsewhere`, async () => {
    // The picture alone never reviews a key (fuse.ts rule 1). It takes the title
    // AGREEING with the picture, and a garbled title agrees with nothing.
    const r = await runObf({ name: garbled, number: '23', denominator: '197' }, CHARIZARD_VECTOR);
    assert.equal(r.resolvedBy, 'number+denominator');
    assert.equal(r.confident, true);
    assert.deepEqual(ids(r.matches), ['sv03-023']);
  });
}

test('a title that agrees with the keyed card keeps it, whatever the picture says', async () => {
  const r = await runObf({ name: 'Capsakid', number: '23', denominator: '197' }, CHARIZARD_VECTOR);
  assert.equal(r.resolvedBy, 'number+denominator');
  assert.equal(r.confident, true);
  assert.deepEqual(ids(r.matches), ['sv03-023']);
});

test('a picture that agrees with the keyed card keeps it, whatever the title says', async () => {
  const r = await runObf({ name: 'Charizard ex', number: '23', denominator: '197' }, [
    { cardId: 'sv03-023', similarity: 0.87 },
    { cardId: 'sv03-223', similarity: 0.6 },
  ]);
  assert.equal(r.confident, true);
  assert.equal(r.matches[0]!.cardId, 'sv03-023');
});

test('a near-exact hash on the keyed card keeps it: the hash is agreeing with the number', async () => {
  const r = await runObf(DROPPED_DIGIT, CHARIZARD_VECTOR, [{ cardId: 'sv03-023', distance: 1 }]);
  assert.equal(r.resolvedBy, 'number+denominator');
  assert.equal(r.confident, true);
  assert.equal(r.matches[0]!.cardId, 'sv03-023');
});

test('title and picture on a card that fits NO printed field of the key: the reader is asked', async () => {
  // sv04.5-054 is neither number 23 nor in a 197-card set, so overruling the key
  // would mean believing BOTH printed fields misread. Two against two: a question.
  const r = await runObf(DROPPED_DIGIT, [
    { cardId: 'sv04.5-054', similarity: 0.873 },
    { cardId: 'sv03-024', similarity: 0.568 },
  ]);
  assert.equal(r.confident, false);
  assert.equal(r.matched, true);
  assert.deepEqual(ids(r.matches).sort(), ['sv03-023', 'sv04.5-054']);
});

test('a title that is itself a real card name is not stretched to fit a longer picture', async () => {
  // `Marill` is a card. A decisive picture of Azumarill does not make the read a
  // clipped `Azumarill` (the same guard `letDecisiveVectorSpeak` keeps), and
  // there is no Marill in a 197-card set, so the key stands.
  const r = await runObf({ name: 'Marill', number: '23', denominator: '197' }, [
    { cardId: 'sv02-051', similarity: 0.9 },
    { cardId: 'sv03-024', similarity: 0.6 },
  ]);
  assert.equal(r.resolvedBy, 'number+denominator');
  assert.equal(r.confident, true);
  assert.deepEqual(ids(r.matches), ['sv03-023']);
});

// ── 6. What the review of a confident number must not do (PR #297 review) ───

/** A self-contained port over `cards`, with `official` as card_count_official. */
const portOver = (cards: CatalogCard[], official: Record<string, number>): CatalogPort & { nameCalls: () => number } => {
  let calls = 0;
  return {
    nameCalls: () => calls,
    async bySetAndNumber(setId, n) {
      return cards.filter((c) => c.setId === setId && c.numberNumeric === n);
    },
    async byNumberAndDenominator(n, d) {
      return cards.filter((c) => c.numberNumeric === n && official[c.setId] === d);
    },
    async byNumber(n) {
      return cards.filter((c) => c.numberNumeric === n);
    },
    async byIds(want) {
      return cards.filter((c) => want.includes(c.cardId));
    },
    async byName(probe) {
      calls++;
      return cards.filter((c) => fold(c.name).startsWith(probe.prefix) || fold(c.name).includes(probe.normalized));
    },
    async officialCounts(setIds) {
      return new Map(setIds.map((s) => [s, official[s] ?? null]));
    },
  };
};

const runOn = (p: CatalogPort, fields: OcrFields, vector?: { cardId: string; similarity: number }[]) =>
  resolveCard(fields, [], p, {
    phashConfidentMax: 9,
    ...(vector ? { fusion: { vectorMatches: vector, modelId: MODEL } } : {}),
  });

// 6a. A badge names one set. Paradox Rift (PAR, sv04) and Destined Rivals (sv10)
// both print `/182`, and Team Rocket's Giovanni is only in sv10.
const PAR_CARDS: CatalogCard[] = [
  card('sv04-161', 'Cursed Duster', '161', 'sv04'),
  card('sv10-174', "Team Rocket's Giovanni", '174', 'sv10'),
  card('sv10-225', "Team Rocket's Giovanni", '225', 'sv10'),
  card('sv10-238', "Team Rocket's Giovanni", '238', 'sv10'),
];
const parPort = portOver(PAR_CARDS, { sv04: 182, sv10: 182 });
const PAR_READ: OcrFields = { setCode: 'PAR', number: '161', denominator: '182', name: "Team Rocket's Giovanni" };

test('a badge+number key is not demoted by a name that only another set of the same size prints', async () => {
  const r = await runOn(parPort, PAR_READ);
  assert.equal(r.resolvedBy, 'badge+number');
  assert.equal(r.confident, true);
  assert.deepEqual(ids(r.matches), ['sv04-161']);
});

test('a decisive picture from another set of the same size does not overrule the badge AND the number', async () => {
  // sv10-174 shares only the denominator with the key, and the badge already
  // pinned the set. Title and picture against badge and number: the reader asks.
  const r = await runOn(parPort, PAR_READ, [
    { cardId: 'sv10-174', similarity: 0.85 },
    { cardId: 'sv04-161', similarity: 0.6 },
  ]);
  assert.notEqual(r.resolvedBy, 'corroborated');
  assert.equal(r.confident, false);
  assert.deepEqual(ids(r.matches).sort(), ['sv04-161', 'sv10-174']);
});

test('a badge+number key IS still questioned by a name its own set prints', async () => {
  // `OBF 23/197` with the title `Charizard ex`: the rivals are in sv03, the
  // badge's own set, so the number stops being confident as before.
  const r = await runObf({ name: 'Charizard ex', number: '23', denominator: '197', setCode: 'OBF' });
  assert.equal(r.resolvedBy, 'badge+number');
  assert.equal(r.confident, false);
  assert.deepEqual(ids(r.matches).sort(), ['sv03-023', 'sv03-125', 'sv03-223']);
});

// 6b. A piece of the keyed card's own name. Flashfire (xy2, 106 cards) prints
// M Charizard EX as the secret rare `108/106`, and Charizard EX three times.
test('readIsFragmentOf: the keyed card`s title with a word lost, and nothing else', () => {
  assert.equal(readIsFragmentOf('Charizard EX', 'M Charizard EX'), true);
  assert.equal(readIsFragmentOf('Kyogre EX', 'Primal Kyogre EX'), true);
  assert.equal(readIsFragmentOf('Charizard', 'Radiant Charizard'), true);
  assert.equal(readIsFragmentOf('Vulpix', 'Alolan Vulpix'), true);
  assert.equal(readIsFragmentOf('Zigzagoon', 'Galarian Zigzagoon'), true);
  assert.equal(readIsFragmentOf('Rotom', 'Heat Rotom'), true);
  assert.equal(readIsFragmentOf('Switch', 'Energy Switch'), true);
  assert.equal(readIsFragmentOf('Potion', 'Hyper Potion'), true);
  assert.equal(readIsFragmentOf('Dialga', 'Dialga G'), true);
  // Whole words only, and one direction only.
  assert.equal(readIsFragmentOf('Charizare', 'Capsakid'), false);
  assert.equal(readIsFragmentOf('Mew', 'Mewtwo'), false);
  assert.equal(readIsFragmentOf('Kabuto', 'Kabutops'), false);
  assert.equal(readIsFragmentOf('Porygon', 'Porygon-Z'), false);
  assert.equal(readIsFragmentOf('Rotom Dex', 'Rotom'), false);
  assert.equal(readIsFragmentOf('Heat Rotom', 'Rotom'), false);
});

const XY2_CARDS: CatalogCard[] = [
  card('xy2-11', 'Charizard EX', '11', 'xy2'),
  card('xy2-12', 'Charizard EX', '12', 'xy2'),
  card('xy2-13', 'M Charizard EX', '13', 'xy2'),
  card('xy2-100', 'Charizard EX', '100', 'xy2'),
  card('xy2-108', 'M Charizard EX', '108', 'xy2'),
];
const xy2Port = portOver(XY2_CARDS, { xy2: 106 });
const M_CHARIZARD_READ: OcrFields = { name: 'Charizard EX', number: '108', denominator: '106' };

test('`Charizard EX` read off M Charizard EX `108/106` keeps the key, with no picture', async () => {
  const r = await runOn(xy2Port, M_CHARIZARD_READ);
  assert.equal(r.resolvedBy, 'number+denominator');
  assert.equal(r.confident, true);
  assert.deepEqual(ids(r.matches), ['xy2-108']);
});

test('…and a showable, separated (not decisive) picture of a Charizard EX does not corroborate a wrong one', async () => {
  const r = await runOn(xy2Port, M_CHARIZARD_READ, [
    { cardId: 'xy2-11', similarity: 0.65 },
    { cardId: 'xy2-108', similarity: 0.6 },
  ]);
  assert.equal(r.resolvedBy, 'number+denominator');
  assert.equal(r.confident, true);
  assert.deepEqual(ids(r.matches), ['xy2-108']);
});

test('…nor does a decisive one: a fragment of the key`s own name is not a second signal against it', async () => {
  const r = await runOn(xy2Port, M_CHARIZARD_READ, [
    { cardId: 'xy2-11', similarity: 0.85 },
    { cardId: 'xy2-108', similarity: 0.6 },
  ]);
  assert.equal(r.resolvedBy, 'number+denominator');
  assert.equal(r.confident, true);
  assert.deepEqual(ids(r.matches), ['xy2-108']);
});

const FRAGMENT_CASES: { label: string; cards: CatalogCard[]; official: Record<string, number>; keyed: string; read: string }[] = [
  {
    label: 'Switch off Energy Switch',
    cards: [card('ex6-90', 'Energy Switch', '90', 'ex6'), card('ex6-102', 'Switch', '102', 'ex6')],
    official: { ex6: 112 },
    keyed: 'ex6-90',
    read: 'Switch',
  },
  {
    label: 'Dialga off Dialga G',
    cards: [card('pl1-7', 'Dialga G', '7', 'pl1'), card('pl1-5', 'Dialga', '5', 'pl1')],
    official: { pl1: 127 },
    keyed: 'pl1-7',
    read: 'Dialga',
  },
  {
    label: 'Kyogre EX off Primal Kyogre EX',
    cards: [card('xy5-55', 'Primal Kyogre EX', '55', 'xy5'), card('xy5-54', 'Kyogre EX', '54', 'xy5')],
    official: { xy5: 160 },
    keyed: 'xy5-55',
    read: 'Kyogre EX',
  },
  {
    label: 'Potion off Hyper Potion',
    cards: [card('xy1-127', 'Hyper Potion', '127', 'xy1'), card('xy1-140', 'Potion', '140', 'xy1')],
    official: { xy1: 146 },
    keyed: 'xy1-127',
    read: 'Potion',
  },
];
for (const { label, cards, official, keyed, read } of FRAGMENT_CASES) {
  test(`a fragment read keeps a confident number: ${label}`, async () => {
    const keyedCard = cards.find((c) => c.cardId === keyed)!;
    const r = await runOn(portOver(cards, official), {
      name: read,
      number: keyedCard.number,
      denominator: String(official[keyedCard.setId]),
    });
    assert.equal(r.resolvedBy, 'number+denominator');
    assert.equal(r.confident, true);
    assert.deepEqual(ids(r.matches), [keyed]);
  });
}

// 6c. The vector's own top-1 on the keyed card is agreement at `showable`.
test('a showable (not decisive) picture of the keyed card keeps the key, and does not relabel it', async () => {
  // Separated but not decisive: before the fix this was relabelled 'corroborated'.
  const separated = await runObf({ name: 'Charizard ex', number: '23', denominator: '197' }, [
    { cardId: 'sv03-023', similarity: 0.65 },
    { cardId: 'sv03-223', similarity: 0.6 },
  ]);
  assert.equal(separated.resolvedBy, 'number+denominator');
  assert.equal(separated.confident, true);
  assert.deepEqual(ids(separated.matches), ['sv03-023']);
  // Not even separated: before the fix this demoted a correct key to a question.
  const close = await runObf({ name: 'Charizard ex', number: '23', denominator: '197' }, [
    { cardId: 'sv03-023', similarity: 0.65 },
    { cardId: 'sv03-223', similarity: 0.645 },
  ]);
  assert.equal(close.resolvedBy, 'number+denominator');
  assert.equal(close.confident, true);
  assert.deepEqual(ids(close.matches), ['sv03-023']);
});

// 6d. The keyed card survives the MAX_MATCHES cut.
test('a name family bigger than the list cut cannot crowd the keyed card out of the question', async () => {
  // 30 Pikachus in 128-card sets, and the keyed card sorting after all of them.
  const pikachus = Array.from({ length: 30 }, (_, i) => {
    const setId = `p${String(i).padStart(2, '0')}`;
    return card(`${setId}-050`, 'Pikachu', '050', setId);
  });
  const official: Record<string, number> = { zz1: 128, ...Object.fromEntries(pikachus.map((c) => [c.setId, 128])) };
  const p = portOver([...pikachus, card('zz1-005', 'Raichu', '005', 'zz1')], official);
  const r = await runOn(p, { name: 'Pikachu', number: '005', denominator: '128' });
  assert.equal(r.resolvedBy, 'number+denominator');
  assert.equal(r.confident, false);
  assert.equal(r.matches.length, MAX_MATCHES);
  assert.ok(ids(r.matches).includes('zz1-005'), 'the reading the number gave is still on the list');
});

// 6e. One name lookup per request.
test('rung 5b and the post-climb review share one catalogue name lookup', async () => {
  // `Quilava` reaches rung 5b (a lookup), then `letDecisiveVectorSpeak` asks
  // whether the read is another card's exact name: the same lookup, memoised.
  const p = portOver(CARDS, OFFICIAL);
  const r = await runOn(p, { name: 'Quilava' }, [
    { cardId: 'sv09-024', similarity: 0.86 },
    { cardId: 'sv08-143', similarity: 0.7 },
  ]);
  assert.equal(r.resolvedBy, 'corroborated');
  assert.equal(p.nameCalls(), 1);
});
