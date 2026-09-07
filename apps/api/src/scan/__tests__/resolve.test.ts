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
  nameTier,
  narrowByName,
  normalizeCardName,
  parseNumber,
  resolveCard,
  type CatalogCard,
  type CatalogPort,
  type OcrFields,
  type PriorMatch,
} from '../resolve.js';

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
};

// The scan endpoint's measured "phash is sure of itself" threshold.
const run = (fields: OcrFields, priorMatches: PriorMatch[] = []) =>
  resolveCard(fields, priorMatches, fixturePort, { phashConfidentMax: 9 });

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

test('rung 7: a name alone filters the priors and never names a card', async () => {
  // A name alone leaves a mean of 4.7 prints and up to 114 (Pikachu).
  const r = await run({ name: 'Pikachu' }, [
    { cardId: 'sv01-014', distance: 2 },
    { cardId: 'svp-001', distance: 4 },
    { cardId: 'sv03.5-025', distance: 6 },
  ]);
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
  const r = await run({ number: 'Museum', name: 'Museum' }, [{ cardId: 'mep-Museum', distance: 5 }]);
  assert.equal(r.resolvedBy, 'prior-only');
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
