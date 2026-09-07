/**
 * Pure (no DB) tests for the OCR resolution ladder — CROSSWALK.md §7.3.
 *
 * The catalogue is a fixture of eighteen cards across nine sets, chosen so that
 * every rung has something real to resolve and every documented collision is
 * reproducible: the `014/198` two-candidate case from §4, the three `SVE` print
 * cycles that reuse one name, the `Boss's Orders` parenthetical that TCGdex
 * adds and no card prints, and a secret rare numbered above its denominator.
 *
 * What is being defended here is not "the query works" — it is the ORDER of the
 * rungs and the meaning of `confident`. A ladder that answers correctly but
 * from the wrong rung will start answering incorrectly the moment the catalogue
 * grows, and a `confident` that is generous is how a wrong card gets into
 * somebody's collection without them being asked.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_MATCHES,
  MAX_NAME_FAMILIES,
  MAX_NAME_PRINTINGS,
  MIN_NAME_PROBE,
  nameTier,
  narrowByName,
  normalizeCardName,
  parseNumber,
  planNameProbe,
  resolveCard,
  type CatalogCard,
  type CatalogPort,
  type OcrFields,
  type PriorMatch,
} from '../resolve.js';
import { THRESHOLDS } from '@deckpal/matching';
import type { VectorMatch } from '../fuse.js';

// ── Fixture catalogue ───────────────────────────────────────────────────────

interface FixtureSet {
  setId: string;
  seriesId: string;
  setName: string;
  /** `card_set.card_count_official` — the printed set size, the number OCR reads. */
  official: number | null;
}

const SETS: FixtureSet[] = [
  { setId: 'sv01', seriesId: 'sv', setName: 'Scarlet & Violet', official: 198 },
  // The other set in the whole catalogue with 198 official cards. This one pair
  // is why `014/198` is two candidates and not one (CROSSWALK §4).
  { setId: 'swsh6', seriesId: 'swsh', setName: 'Chilling Reign', official: 198 },
  { setId: 'me05', seriesId: 'me', setName: 'Pitch Black', official: 84 },
  { setId: 'sve', seriesId: 'sv', setName: 'Scarlet & Violet Energy', official: 24 },
  { setId: 'svp', seriesId: 'sv', setName: 'SVP Black Star Promos', official: 225 },
  { setId: 'sv04', seriesId: 'sv', setName: 'Paradox Rift', official: 182 },
  { setId: 'sv10', seriesId: 'sv', setName: 'Destined Rivals', official: 182 },
  { setId: 'sv03.5', seriesId: 'sv', setName: '151', official: 165 },
  { setId: 'mep', seriesId: 'me', setName: 'MEP Black Star Promos', official: 0 },
];

const CARD_SEED: [setId: string, localId: string, name: string][] = [
  ['sv01', '014', 'Floragato'],
  ['swsh6', '14', 'Steenee'],
  ['sv01', '017', 'Wattrel'],
  // Three print cycles, eight names, twenty-four cards: sve-001, sve-009 and
  // sve-017 are all "Grass Energy". The name line carries ZERO information here
  // and the number is the entire signal (CROSSWALK §3.3).
  ['sve', '001', 'Grass Energy'],
  ['sve', '009', 'Grass Energy'],
  ['sve', '017', 'Grass Energy'],
  // Numerator above the denominator: a special illustration rare in a /198 set.
  ['sv01', '245', 'Miriam'],
  ['me05', '039', 'Dhelmise'],
  ['sv01', '039', 'Klawf'],
  // The parenthetical divergence: TCGdex disambiguates, the card does not.
  ['sv01', '172', "Boss's Orders (Giovanni)"],
  ['swsh6', '172', "Boss's Orders (Lysandre)"],
  ['sv01', '197', 'Pokémon Center Lady'],
  ['sv04', '182', 'Iron Valiant ex'],
  ['sv10', '116', "Ethan's Ho-Oh ex"],
  ['sv03.5', '025', 'Pikachu'],
  ['svp', '001', 'Pikachu'],
  // Prints no collector number at all; TCGdex's localId "500" is synthetic.
  ['svp', '500', 'Sprigatito'],
  // The single non-numeric local id in the whole printed era.
  ['mep', 'Museum', 'Museum'],
  // THE 2026-09-07 CASE. One name, four printings, four sets — the shape of
  // every staple Trainer in the real catalogue (Ultra Ball has ~40) and the one
  // a toploadered card produces: the title reads, the bottom strip does not.
  ['sv01', '196', 'Ultra Ball'],
  ['sv03.5', '182', 'Ultra Ball'],
  ['sv04', '196', 'Ultra Ball'],
  ['swsh6', '150', 'Ultra Ball'],
];

const CARDS: CatalogCard[] = CARD_SEED.map(([setId, localId, name]) => {
  const set = SETS.find((s) => s.setId === setId)!;
  return {
    cardId: `${setId}-${localId}`,
    name,
    number: localId,
    // Mirrors `localIdNumeric` in the importer: NULL when not purely numeric.
    numberNumeric: /^\d+$/.test(localId) ? Number.parseInt(localId, 10) : null,
    setId,
    setName: set.setName,
    seriesId: set.seriesId,
    rarity: null,
  };
});

const officialOf = (setId: string): number | null => SETS.find((s) => s.setId === setId)?.official ?? null;

/**
 * pg_trgm's `%`, near enough for a fixture: 3-grams over a space-padded string,
 * Jaccard, default 0.3 floor.
 *
 * Present so `byName` below is the SUPERSET its contract describes rather than
 * "the catalogue, filtered by the thing under test". A fixture that returned
 * every card would pass this file while a port that returned only exact matches
 * would too, and the difference between those is the whole tier-2 rung.
 */
function trigramSimilarity(a: string, b: string): number {
  const grams = (s: string): Set<string> => {
    const padded = `  ${s} `;
    const out = new Set<string>();
    for (let i = 0; i + 3 <= padded.length; i++) out.add(padded.slice(i, i + 3));
    return out;
  };
  const A = grams(a);
  const B = grams(b);
  let shared = 0;
  for (const t of A) if (B.has(t)) shared++;
  return shared / (A.size + B.size - shared);
}
const TRGM_FLOOR = 0.3;

const fixturePort: CatalogPort = {
  async bySetAndNumber(setId, numeric) {
    return CARDS.filter((c) => c.setId === setId && c.numberNumeric === numeric);
  },
  async byNumberAndDenominator(numeric, denominator) {
    return CARDS.filter((c) => c.numberNumeric === numeric && officialOf(c.setId) === denominator);
  },
  async byNumber(numeric) {
    return CARDS.filter((c) => c.numberNumeric === numeric);
  },
  async byIds(cardIds) {
    return CARDS.filter((c) => cardIds.includes(c.cardId));
  },
  // Rung 5b, in the shape `catalogPort.ts` implements in SQL: a prefix of the
  // FOLDED name (tiers 0 and 1, both directions) OR a trigram neighbourhood
  // (tier 2, the misread). Nothing here decides what matches — `narrowByName`
  // does, on the way back.
  async byName(probe) {
    return CARDS.filter(
      (c) =>
        normalizeCardName(c.name).startsWith(probe.prefix) ||
        trigramSimilarity(normalizeCardName(c.name), probe.normalized) >= TRGM_FLOOR,
    );
  },
};

/** The same catalogue with no name lookup — a port that predates rung 5b. */
const noNamePort: CatalogPort = { ...fixturePort, byName: undefined };

// The scan endpoint's measured "phash is sure of itself" threshold.
const run = (fields: OcrFields, priorMatches: PriorMatch[] = []) =>
  resolveCard(fields, priorMatches, fixturePort, { phashConfidentMax: 9 });

/** …with the embedding matcher on, which is the only way `fuse.ts` is consulted. */
const MODEL = 'clip-vit-b32-openai';
const runWithVector = (fields: OcrFields, vectorMatches: VectorMatch[], priorMatches: PriorMatch[] = []) =>
  resolveCard(fields, priorMatches, fixturePort, {
    phashConfidentMax: 9,
    fusion: { vectorMatches, modelId: MODEL },
  });

const ids = (matches: { cardId: string }[]): string[] => matches.map((m) => m.cardId);

// ── Name normalisation (CROSSWALK §5) ───────────────────────────────────────

test('accents are folded, never stripped', () => {
  // 492 cards carry a non-ASCII glyph and the card PRINTS it. Stripping would
  // turn "Poké Ball" into "Pok Ball" and lose the match entirely.
  assert.equal(normalizeCardName('Pokémon Center Lady'), 'pokemon center lady');
  assert.equal(nameTier('Pokemon Center Lady', 'Pokémon Center Lady'), 0);
  assert.equal(nameTier('Pokémon Center Lady', 'Pokemon Center Lady'), 0);
});

test('both apostrophe glyphs fold together', () => {
  // 1,022 cards; print uses U+2019, keyboards use U+0027. Already folded by
  // `card.name_normalized` on the other side of the join.
  assert.equal(normalizeCardName('Farfetch’d'), "farfetch'd");
  assert.equal(nameTier('Farfetch’d', "Farfetch'd"), 0);
  // Owner prefixes are NOT a divergence — the card prints them exactly so.
  assert.equal(normalizeCardName("Brock's Sandslash"), "brock's sandslash");
});

test('a trailing parenthetical is stripped and a colon is never split on', () => {
  // The ONE real divergence, and it is 13 cards: TCGdex disambiguates same-named
  // cards with a suffix no card prints.
  assert.equal(normalizeCardName("Boss's Orders (Giovanni)"), "boss's orders");
  assert.equal(normalizeCardName('PokéDex (HANDY909)'), 'pokedex');
  assert.equal(normalizeCardName('Technical Machine: Devolution'), 'technical machine: devolution');
});

test('a name ending in the letters "ex" is not mistaken for an ex card', () => {
  // The suffix separator is one-or-more, never zero, precisely so `pokedex`
  // does not become `poked`.
  assert.equal(nameTier('PokéDex', 'Poké'), null);
  assert.equal(nameTier('PokéDex', 'PokéDex'), 0);
});

test('an OCR-dropped rule-box suffix still matches, one tier down', () => {
  // The name sits at the TOP of the card, over artwork, in a stylised face —
  // a different and harder OCR region than the bottom strip, which routinely
  // loses the suffix (CROSSWALK §5).
  assert.equal(nameTier('Iron Valiant ex', 'Iron Valiant ex'), 0);
  assert.equal(nameTier('Iron Valiant', 'Iron Valiant ex'), 1);
  assert.equal(nameTier('Charizard', 'Charizard VMAX'), 1);
  assert.equal(nameTier('Charizard', 'Charizard-GX'), 1);
  // δ delta species is printed as a separate glyph after the name; §5 says to
  // treat it as optional.
  assert.equal(nameTier('Shiftry', 'Shiftry δ'), 1);
});

test('the fuzzy tier forgives a slip on a long name and nothing on a short one', () => {
  // CROSSWALK does not specify an edit budget. This one is sized so a glyph
  // confusion on a long name survives, while at three or four characters an
  // edit budget would reach half the Pokédex.
  assert.equal(nameTier('Fioragato', 'Floragato'), 2);
  assert.equal(nameTier('Mow', 'Mew'), null);
  assert.equal(nameTier('Bili', 'Bill'), null);
  assert.equal(nameTier('', 'Floragato'), null);
});

test('name narrowing keeps only the best tier any candidate reaches', () => {
  // An exact hit must never be diluted by a fuzzy one in the same set.
  const cands = CARDS.filter((c) => c.name === 'Floragato' || c.name === 'Klawf');
  assert.deepEqual(ids(narrowByName(cands, 'Floragato')), ['sv01-014']);
  assert.deepEqual(narrowByName(cands, 'Gardevoir'), []);
});

test('a non-numeric collector number is not an error, it is simply not a key', () => {
  // `mep-Museum` is a real card and `local_id_numeric` is NULL for it by design.
  assert.equal(parseNumber('014'), 14);
  assert.equal(parseNumber('14'), 14);
  assert.equal(parseNumber(' 245 '), 245);
  assert.equal(parseNumber('Museum'), null);
  assert.equal(parseNumber('TG03'), null);
  assert.equal(parseNumber(undefined), null);
});

// ── Rung 1 — badge + number ────────────────────────────────────────────────

test('rung 1: the printed code plus the number is accepted on its own evidence', () =>
  run({ setCode: 'SVI', number: '014', denominator: '198' }).then((r) => {
    assert.equal(r.resolvedBy, 'badge+number');
    assert.equal(r.confident, true);
    assert.deepEqual(ids(r.matches), ['sv01-014']);
    // No phash opinion attached, and null says exactly that — 0 would read as
    // an identical hash and 64 as maximally dissimilar.
    assert.equal(r.matches[0]!.distance, null);
  }));

test('rung 1: the badge is read with its language subscript still attached', async () => {
  // Naive OCR of the badge box returns SVIEN, not SVI.
  const r = await run({ setCode: 'SVIEN', number: '014', denominator: '198' });
  assert.equal(r.resolvedBy, 'badge+number');
  assert.deepEqual(ids(r.matches), ['sv01-014']);
});

test('rung 1 is not vetoed by phash confidently disagreeing', async () => {
  // §7.4: a rung-1 hit is a DIFFERENT KIND of evidence from a Hamming distance,
  // not a better one. This is the whole point of the feature — the wrong top-1s
  // the scan endpoint documents are "near-identical same-art reprints at
  // distance 1-6", and a losing distance must not overrule an exact printed key.
  const r = await run({ setCode: 'SVI', number: '014', denominator: '198' }, [{ cardId: 'swsh6-14', distance: 1 }]);
  assert.equal(r.resolvedBy, 'badge+number');
  assert.equal(r.confident, true);
  assert.deepEqual(ids(r.matches), ['sv01-014']);
});

test('rung 1b: a badge whose denominator disagrees is dropped and the ladder falls through', async () => {
  // PAL prints /193; the strip said /198. A code/denominator conflict is the
  // signature of a 1-edit badge misread, so the CODE is discarded and the
  // number+denominator pair — which is not in doubt — carries on to rung 3.
  const r = await run({ setCode: 'PAL', number: '014', denominator: '198' });
  assert.equal(r.badge.code, null);
  assert.equal(r.badge.reason, 'denominator-conflict');
  assert.equal(r.resolvedBy, 'number+denominator');
  assert.equal(r.confident, false);
  assert.deepEqual(ids(r.matches), ['sv01-014', 'swsh6-14']);
});

test('rung 1: a badge with a wrong number falls through rather than answering emptily', async () => {
  // Zero hits means the NUMBER is wrong, not the badge — the code survived a
  // denominator cross-check to get here.
  const r = await run({ setCode: 'SVI', number: '039', denominator: '84', name: 'Dhelmise' });
  assert.equal(r.resolvedBy, 'number+denominator');
  assert.deepEqual(ids(r.matches), ['me05-039']);
});

// ── The energy sets, where the number is the entire signal ─────────────────

test('an energy card resolves on badge + number with no denominator anywhere', async () => {
  // SVE prints code + number, no denominator, no regulation mark and no name.
  // All three print cycles are called "Grass Energy", so if the number is wrong
  // nothing else can catch it — and if it is right, this is exact.
  const r = await run({ setCode: 'SVE', number: '017' });
  assert.equal(r.resolvedBy, 'badge+number');
  assert.equal(r.confident, true);
  assert.deepEqual(ids(r.matches), ['sve-017']);
});

test('a denominator read alongside an SVE badge redirects to SVI, not to nothing', async () => {
  // The SVE/SVI confusion is one of the 19 one-edit pairs, and the denominator
  // is what separates them: SVE 017 prints no /nnn where SVI 017 prints /198.
  // Striking the impossible candidate lets its surviving neighbour win.
  const r = await run({ setCode: 'SVE', number: '017', denominator: '198' });
  assert.equal(r.badge.code?.setId, 'sv01');
  assert.equal(r.resolvedBy, 'badge+number');
  assert.equal(r.confident, true);
  assert.deepEqual(ids(r.matches), ['sv01-017']);
});

// ── Rung 2 — a badge with no number ────────────────────────────────────────

test('rung 2: a badge and no number narrows the phash candidates to that set', async () => {
  // svp-500 prints no collector number whatsoever. SVP alone is 226 candidates,
  // so §7.3's action is to restrict the phash query — not to fetch 226 cards
  // nobody can choose between. The priors still answer; they answer over a
  // smaller world, and `confident` stays false.
  const r = await run({ setCode: 'SVP' }, [
    { cardId: 'sv01-014', distance: 4 },
    { cardId: 'svp-500', distance: 7 },
    { cardId: 'svp-001', distance: 9 },
  ]);
  assert.equal(r.resolvedBy, 'prior-only');
  assert.equal(r.confident, false);
  assert.deepEqual(ids(r.matches), ['svp-500', 'svp-001']);
});

// ── Rung 3 — number + denominator, which carries the pre-2023 77% ──────────

test('rung 3: 039/084 resolves to exactly one card with no badge at all', async () => {
  // PBL is the only set in the catalogue with 84 official cards, so the
  // denominator alone pins the set (CROSSWALK §4).
  const r = await run({ number: '039', denominator: '084' });
  assert.equal(r.resolvedBy, 'number+denominator');
  assert.equal(r.confident, true);
  assert.deepEqual(ids(r.matches), ['me05-039']);
});

test('rung 3: the worked 014/198 case is two candidates, and says so', async () => {
  // Only two sets in 202 have an official count of 198. With no badge and no
  // name there is nothing more OCR can contribute — phash separates a Steenee
  // from a Floragato trivially, and this endpoint must not pretend otherwise.
  const r = await run({ number: '014', denominator: '198' });
  assert.equal(r.resolvedBy, 'number+denominator');
  assert.equal(r.confident, false);
  assert.deepEqual(ids(r.matches), ['sv01-014', 'swsh6-14']);
});

test('a numerator above the denominator is resolved, not rejected', async () => {
  // 245/198 is a secret rare and there are 60 of them in sv01 alone. The
  // denominator is the SET's official size and never a bound on the number.
  const r = await run({ number: '245', denominator: '198' });
  assert.equal(r.confident, true);
  assert.deepEqual(ids(r.matches), ['sv01-245']);
});

test('rung 3 re-ranks its candidates by what phash already thought', async () => {
  const r = await run({ number: '014', denominator: '198' }, [{ cardId: 'swsh6-14', distance: 2 }]);
  assert.deepEqual(ids(r.matches), ['swsh6-14', 'sv01-014']);
  assert.equal(r.matches[0]!.distance, 2);
  assert.equal(r.matches[1]!.distance, null);
});

// ── Rung 4 — the name as the cross-check that catches a misread number ─────

test('rung 4: the name separates the 014/198 pair', async () => {
  const r = await run({ number: '014', denominator: '198', name: 'Floragato' });
  assert.equal(r.resolvedBy, 'name+number');
  assert.equal(r.confident, true);
  assert.deepEqual(ids(r.matches), ['sv01-014']);
});

test('rung 4: a one-glyph slip in the name still separates them', async () => {
  const r = await run({ number: '014', denominator: '198', name: 'Fioragato' });
  assert.equal(r.resolvedBy, 'name+number');
  assert.equal(r.confident, true);
  assert.deepEqual(ids(r.matches), ['sv01-014']);
});

test('rung 4: when the name cannot separate them, it does not pretend to', async () => {
  // Both cards print "Boss's Orders"; only TCGdex distinguishes them, with a
  // parenthetical the cards do not carry. The strip is lossy in both directions
  // and the honest answer is two candidates.
  const r = await run({ number: '172', denominator: '198', name: "Boss's Orders" });
  assert.equal(r.resolvedBy, 'name+number');
  assert.equal(r.confident, false);
  assert.deepEqual(ids(r.matches), ['sv01-172', 'swsh6-172']);
});

test('rung 4: a name matching nothing leaves the rung-3 candidates intact', async () => {
  // A misread name must not empty an answer the number and denominator already
  // narrowed. It contributes nothing here, and contributing nothing is allowed.
  const r = await run({ number: '014', denominator: '198', name: 'Gardevoir' });
  assert.equal(r.resolvedBy, 'number+denominator');
  assert.equal(r.confident, false);
  assert.deepEqual(ids(r.matches), ['sv01-014', 'swsh6-14']);
});

// ── Rung 5 — name + number, no usable denominator ─────────────────────────

test('rung 5: name + number resolves when the denominator was never read', async () => {
  const r = await run({ number: '039', name: 'Dhelmise' });
  assert.equal(r.resolvedBy, 'name+number');
  assert.equal(r.confident, true);
  assert.deepEqual(ids(r.matches), ['me05-039']);
});

test('rung 5 catches a misread denominator by dropping it', async () => {
  // /48 matches no set here, so rung 3 returns nothing. The name and number are
  // still good and still resolve.
  const r = await run({ number: '039', denominator: '48', name: 'Dhelmise' });
  assert.equal(r.resolvedBy, 'name+number');
  assert.deepEqual(ids(r.matches), ['me05-039']);
});

// ── Rung 5b — the name as a FAMILY, which is the 2026-09-07 defect ─────────
//
// Owner, with a screenshot: a toploadered Ultra Ball landed needs-input, the row
// said `read "Ultra Ball"`, and the five candidates under it were phash's
// near-random junk — Binding Mochi at 81 %. "As silly as it gets."
//
// The bug was not the hash. It was that a read name could only FILTER the hash's
// list, so a hash that had already failed took the name down with it. These
// tests are the fix stated as behaviour: the catalogue knows every Ultra Ball,
// so a name that resolves to a name family returns that family.

/** The failure exactly as reported: a good name, no number, and junk priors. */
const JUNK_PRIORS: PriorMatch[] = [
  { cardId: 'sv01-014', distance: 11 },
  { cardId: 'me05-039', distance: 12 },
  { cardId: 'svp-500', distance: 13 },
];

test('rung 5b: a name and junk priors produce the NAME’S cards, not the junk', async () => {
  const r = await run({ name: 'Ultra Ball' }, JUNK_PRIORS);
  assert.equal(r.resolvedBy, 'name-family');
  // A family is not a card: four printings, and the endpoint claims none of them.
  assert.equal(r.matched, false);
  assert.equal(r.confident, false);
  assert.deepEqual(
    ids(r.matches).sort(),
    ['sv01-196', 'sv03.5-182', 'sv04-196', 'swsh6-150'],
    'every Ultra Ball in the catalogue, whether or not phash had heard of it',
  );
  // And the junk is GONE rather than demoted — it was never evidence about a
  // card called Ultra Ball, and leaving it below the real candidates would still
  // be offering it.
  for (const junk of JUNK_PRIORS) {
    assert.equal(ids(r.matches).includes(junk.cardId), false, `${junk.cardId} must not be offered`);
  }
  // The candidates phash never nominated say so, which is how the client knows
  // this list is not ranked by distance.
  assert.deepEqual(r.matches.map((m) => m.distance), [null, null, null, null]);
});

test('rung 5b: a phash agreement inside the family sorts to the top and stays honest', async () => {
  // The hash is not silenced — it just no longer decides which cards are ON the
  // list. Where it did see one of them, it orders them.
  const r = await run({ name: 'Ultra Ball' }, [...JUNK_PRIORS, { cardId: 'sv04-196', distance: 4 }]);
  assert.equal(r.resolvedBy, 'name-family');
  assert.equal(r.confident, false, 'a hash agreeing with a family is not a printing');
  assert.equal(ids(r.matches)[0], 'sv04-196');
  assert.equal(r.matches[0]!.distance, 4);
});

test('rung 5b: a name with exactly one printing, read exactly, is a card', async () => {
  // The one shape a bare name may be sure about. "Miriam" is one card in this
  // catalogue, so the 4.7-candidate objection that keeps rung 7 from ever naming
  // anything simply does not apply.
  const r = await run({ name: 'Miriam' });
  assert.equal(r.resolvedBy, 'name-family');
  assert.equal(r.matched, true);
  assert.equal(r.confident, true);
  assert.deepEqual(ids(r.matches), ['sv01-245']);
});

test('rung 5b: a rule-box suffix the name line lost still finds the card', async () => {
  // Tier 1 — the `ex` sits in a stylised face over artwork and OCR routinely
  // drops it (CROSSWALK §5). One printing, and tier 1 is still an exact read of
  // the letters that were there.
  const r = await run({ name: 'Iron Valiant' });
  assert.equal(r.resolvedBy, 'name-family');
  assert.equal(r.confident, true);
  assert.deepEqual(ids(r.matches), ['sv04-182']);
});

test('rung 5b: a FUZZY name never names a card, however few printings it has', async () => {
  // Tier 2 is the edit budget — a guess about what the letters were. It may put
  // candidates in front of a person; it may not identify one, even when it lands
  // on a family of exactly one printing, because "the only card within two edits
  // of what I think I read" is a different claim from "the card I read".
  const r = await run({ name: 'Fioragato' });
  assert.equal(r.resolvedBy, 'name-family');
  assert.equal(r.confident, false);
  assert.deepEqual(ids(r.matches), ['sv01-014']);
  // And not `matched` either. `matched` is the claim that a CARD was identified,
  // and a read the ladder had to spend its edit budget on has not identified
  // one — it has produced the best candidate it can and handed it over.
  assert.equal(r.matched, false);
});

test('rung 5b: phash confidently naming something else refuses the certainty', async () => {
  // The same contradiction test rungs 3-5 use. Phash is sure of a card the name
  // family does not contain and never nominated ours, so the sole printing is
  // offered and not asserted.
  const r = await run({ name: 'Miriam' }, [{ cardId: 'sv01-014', distance: 2 }]);
  assert.equal(r.resolvedBy, 'name-family');
  assert.equal(r.confident, false);
  assert.deepEqual(ids(r.matches), ['sv01-245']);
});

test('rung 5b: one name that is TWO cards shows both and is sure of neither', async () => {
  // The ambiguity guard. Both cards PRINT "Boss's Orders"; only TCGdex tells
  // them apart, with a parenthetical neither card carries. Folding the
  // parenthetical away — which §5 requires, or the read would match nothing —
  // means the read is genuinely two cards, and the families are keyed on the RAW
  // catalogue name so the guard can see that.
  const r = await run({ name: "Boss's Orders" });
  assert.equal(r.resolvedBy, 'name-family');
  assert.equal(r.matched, false);
  assert.equal(r.confident, false);
  assert.deepEqual(ids(r.matches).sort(), ['sv01-172', 'swsh6-172']);
});

test('rung 5b: several families are capped, and every one of them is represented', async () => {
  // The real shape this produces: a bare species name reaching every rule-box
  // card built on it at TIER 1, because each of those strips to the same stem.
  // Five families of five printings is past both caps in both directions, which
  // the eighteen-card fixture cannot be without becoming a different fixture.
  const FAMILIES = ['Charizard ex', 'Charizard VMAX', 'Charizard V', 'Charizard-GX', 'Charizard VSTAR'];
  const many: CatalogCard[] = [];
  FAMILIES.forEach((name, f) => {
    for (let p = 0; p < 5; p++) {
      many.push({
        cardId: `set${f}-${p}`,
        name,
        number: String(p),
        numberNumeric: p,
        setId: `set${f}`,
        setName: `Set ${f}`,
        seriesId: 'sv',
        rarity: null,
      });
    }
  });
  const port: CatalogPort = { ...fixturePort, async byName() { return many; } };
  const r = await resolveCard({ name: 'Charizard' }, [], port, { phashConfidentMax: 9 });
  assert.equal(r.resolvedBy, 'name-family');
  assert.equal(r.confident, false);
  const names = new Set(r.matches.map((m) => m.name));
  assert.equal(names.size, MAX_NAME_FAMILIES, 'the best few families, and no more');
  for (const name of names) {
    assert.ok(
      r.matches.filter((m) => m.name === name).length <= MAX_NAME_PRINTINGS,
      'no family may fill the answer and crowd the others out',
    );
  }
});

test('rung 5b: a name too short to be a filter is not looked up at all', async () => {
  // `m%` is thousands of cards. Below the floor the rung declines and the ladder
  // falls through exactly as it did before the rung existed.
  assert.equal(planNameProbe('Ho'), null);
  assert.equal(planNameProbe(' '), null);
  assert.equal(planNameProbe('Mew')?.prefix, 'mew');
  assert.equal(MIN_NAME_PROBE, 3);
  const r = await run({ name: 'Ho' }, [{ cardId: 'sv01-014', distance: 3 }]);
  assert.equal(r.resolvedBy, 'prior-only');
  assert.deepEqual(ids(r.matches), ['sv01-014']);
});

test('rung 5b: a suffix-only read is a prefix of everything, and is refused', async () => {
  // "ex" strips to nothing, and an empty prefix is `LIKE '%'`. `planNameProbe`
  // falls back to the unstripped read, which is then too short.
  assert.equal(planNameProbe('ex'), null);
  assert.equal(planNameProbe('Charizard ex')?.prefix, 'charizard');
});

test('rung 5b never overrules a printed key', async () => {
  // The name is read on every one of these and the ladder answers from the key
  // anyway, because 5b sits BELOW every rung that has a number to join on.
  assert.equal((await run({ setCode: 'SVI', number: '196', name: 'Ultra Ball' })).resolvedBy, 'badge+number');
  assert.equal((await run({ number: '196', denominator: '198', name: 'Ultra Ball' })).resolvedBy, 'number+denominator');
  // Rung 5: 182 is Iron Valiant ex and an Ultra Ball, and the name separates
  // them — which a name-family lookup could not have done, since it never sees
  // the number at all.
  const five = await run({ number: '182', name: 'Ultra Ball' });
  assert.equal(five.resolvedBy, 'name+number');
  assert.deepEqual(ids(five.matches), ['sv03.5-182']);
});

test('rung 5b is skipped entirely by a port that has no name lookup', async () => {
  // The graceful-skip contract `byTextTokens` established: no `byName`, no rung,
  // and every other rung unchanged.
  const r = await resolveCard({ name: 'Ultra Ball' }, JUNK_PRIORS, noNamePort, { phashConfidentMax: 9 });
  assert.equal(r.resolvedBy, 'prior-only');
  assert.deepEqual(ids(r.matches), ids(await run({}, JUNK_PRIORS).then((x) => x.matches)));
});

// ── Rung 5b composed with the image vector ─────────────────────────────────

test('a vector top-1 INSIDE the name family is the corroboration that names the card', async () => {
  // The whole point of a family: "it is one of these four Ultra Balls" and "the
  // closest picture in the entire index is that one" are two signals covering
  // each other's exact blind spot. Neither is sufficient alone — the vector is
  // showable, not decisive — and together they answer.
  const showable = (THRESHOLDS[MODEL]!.simFloor + THRESHOLDS[MODEL]!.simMin) / 2;
  const r = await runWithVector({ name: 'Ultra Ball' }, [
    { cardId: 'sv04-196', similarity: showable },
    { cardId: 'sv01-196', similarity: showable - 0.01 },
  ]);
  assert.equal(r.resolvedBy, 'corroborated');
  assert.equal(r.matched, true);
  assert.equal(r.confident, true);
  assert.equal(ids(r.matches)[0], 'sv04-196');
  // The rest are kept: a reader who disagrees with a confident answer still
  // needs the list they would have been shown a moment ago.
  assert.equal(r.matches.length, 4);
});

test('a vector pointing OUTSIDE the family corroborates nothing and claims nothing', async () => {
  // Two independent signals disagreeing is not a tie to be broken by whichever
  // is louder — a cosine and a printed name are not comparable — so the
  // candidates go to the reader unclaimed. Silence over lies.
  const showable = (THRESHOLDS[MODEL]!.simFloor + THRESHOLDS[MODEL]!.simMin) / 2;
  const r = await runWithVector({ name: 'Ultra Ball' }, [{ cardId: 'sv01-014', similarity: showable }]);
  assert.equal(r.resolvedBy, 'name-family');
  assert.equal(r.confident, false);
  assert.equal(ids(r.matches).includes('sv01-014'), false);
});

// ── Composing with the priors ──────────────────────────────────────────────

test('a sole candidate the priors never saw, while phash was sure of another, is not confident', async () => {
  // §7.3 accepts rungs 3-5 "with phash confirmation". Phash naming a different
  // card at distance 2 while never nominating ours at all is the one shape that
  // counts as an argument against.
  const r = await run({ number: '039', denominator: '084' }, [{ cardId: 'sv01-039', distance: 2 }]);
  assert.equal(r.resolvedBy, 'number+denominator');
  assert.equal(r.confident, false);
  assert.deepEqual(ids(r.matches), ['me05-039']);
});

test('phash ranking our candidate lower is agreement, not contradiction', async () => {
  // The reprint case the whole feature exists for: a same-art reprint wins on
  // Hamming distance and loses to the key. If phash saw our card at all, it is
  // not disagreeing — it is being overruled, exactly as designed.
  const r = await run({ number: '039', denominator: '084' }, [
    { cardId: 'sv01-039', distance: 2 },
    { cardId: 'me05-039', distance: 6 },
  ]);
  assert.equal(r.confident, true);
  assert.deepEqual(ids(r.matches), ['me05-039']);
});

test('priors that are not confident of anything cannot argue', async () => {
  // At distance 20 phash has no opinion worth weighing — well past the measured
  // threshold where junk frames start getting through.
  const r = await run({ number: '039', denominator: '084' }, [{ cardId: 'sv01-039', distance: 20 }]);
  assert.equal(r.confident, true);
});

// ── Rungs 6, 7, 8 — never a key, only a filter ────────────────────────────

test('rung 6: a number alone filters the priors and never names a card', async () => {
  // A bare collector number leaves a mean of 66 candidates and a max of 183.
  const r = await run({ number: '039' }, [
    { cardId: 'sv01-014', distance: 3 },
    { cardId: 'me05-039', distance: 5 },
    { cardId: 'sv01-039', distance: 8 },
  ]);
  assert.equal(r.resolvedBy, 'prior-only');
  assert.equal(r.confident, false);
  assert.deepEqual(ids(r.matches), ['me05-039', 'sv01-039']);
});

test('rung 7 is what is left when the name is not a lookup key at all', async () => {
  // A name alone leaves a mean of 4.7 prints and up to 114 (Pikachu), so it can
  // still never NAME a card. What changed on 2026-09-07 is where the candidates
  // come from: with a `byName` port the name is a lookup (rung 5b, below), and
  // this rung is reached only by a port that has none — the graceful-skip path.
  const r = await resolveCard(
    { name: 'Pikachu' },
    [
      { cardId: 'sv01-014', distance: 2 },
      { cardId: 'svp-001', distance: 4 },
      { cardId: 'sv03.5-025', distance: 6 },
    ],
    noNamePort,
    { phashConfidentMax: 9 },
  );
  assert.equal(r.resolvedBy, 'prior-only');
  assert.equal(r.confident, false);
  assert.deepEqual(ids(r.matches), ['svp-001', 'sv03.5-025']);
});

test('rung 8: nothing legible leaves the existing scan path untouched', async () => {
  const priors: PriorMatch[] = [
    { cardId: 'sv01-014', distance: 1 },
    { cardId: 'swsh6-14', distance: 3 },
  ];
  const r = await run({}, priors);
  assert.equal(r.resolvedBy, 'prior-only');
  assert.equal(r.confident, false);
  assert.deepEqual(ids(r.matches), ['sv01-014', 'swsh6-14']);
});

test('nothing legible and no priors is an honest empty answer', async () => {
  const r = await run({});
  assert.equal(r.matched, false);
  assert.equal(r.confident, false);
  assert.equal(r.resolvedBy, 'prior-only');
  assert.deepEqual(r.matches, []);
});

test('a filter that would empty the answer hands the priors back unfiltered', async () => {
  // Better to return the phash answer the client already had than to turn a
  // misread number into "no such card".
  const r = await run({ number: '999' }, [{ cardId: 'sv01-014', distance: 3 }]);
  assert.equal(r.resolvedBy, 'prior-only');
  assert.deepEqual(ids(r.matches), ['sv01-014']);
});

test('a non-numeric number falls past every rung that needs a numeric key', async () => {
  // `mep-Museum` has no `local_id_numeric`, so rungs 1, 3, 5 and 6 are all
  // unreachable and only the name is left. Before rung 5b that meant the phash
  // list, filtered; it now means the name's own family — which here is a single
  // card, so the ladder can be sure of it.
  const r = await run({ number: 'Museum', name: 'Museum' }, [{ cardId: 'mep-Museum', distance: 5 }]);
  assert.equal(r.resolvedBy, 'name-family');
  assert.equal(r.confident, true);
  assert.deepEqual(ids(r.matches), ['mep-Museum']);
});

test('a prior naming a card the catalogue does not have is dropped, not faked', async () => {
  // A stale client or a re-keyed set. Inventing a row would put a card id in the
  // response that resolves to nothing.
  const r = await run({}, [
    { cardId: 'swsh9.5tg-TG03', distance: 2 },
    { cardId: 'sv01-014', distance: 4 },
  ]);
  assert.deepEqual(ids(r.matches), ['sv01-014']);
});

test('duplicate priors collapse to their best distance', async () => {
  const r = await run({}, [
    { cardId: 'sv01-014', distance: 9 },
    { cardId: 'sv01-014', distance: 2 },
  ]);
  assert.deepEqual(ids(r.matches), ['sv01-014']);
  assert.equal(r.matches[0]!.distance, 2);
});

// ── The house ruling ───────────────────────────────────────────────────────

test('a match carries an identity and never a printing', async () => {
  // Identity confidence only. Which VARIANT — reverse holo, first edition,
  // jumbo — is a separate unresolved dimension, and the two are never blended:
  // a certain identity must not launder a guess about the printing.
  //
  // `distance` and `similarity` are the two pieces of evidence a match carries,
  // and neither is a printing. Everything the vector added to this ladder is an
  // IDENTITY signal — the embedding is trained to be invariant to exactly the
  // surface effects (gloss, holo shimmer, sleeve reflection) that distinguish a
  // reverse holo from a normal, which is what makes it good here and useless
  // for variant. So the list grew by one and the ruling is intact.
  const r = await run({ setCode: 'SVI', number: '014', denominator: '198' });
  assert.deepEqual(
    Object.keys(r.matches[0]!).sort(),
    ['cardId', 'distance', 'name', 'number', 'numberNumeric', 'rarity', 'seriesId', 'setId', 'setName', 'similarity'],
  );
});

test('the answer is capped at the same ceiling POST /scan uses', () => {
  assert.equal(MAX_MATCHES, 25);
});
