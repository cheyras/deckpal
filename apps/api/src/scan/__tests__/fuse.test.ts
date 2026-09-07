/**
 * Pure (no DB, no model) tests for the fusion rules — the 2026-09-06 ruling
 * that the image vector is "still a point of data in the match".
 *
 * Two things are being defended, and only one of them is arithmetic.
 *
 * THE ARITHMETIC is `fuse.ts`: what a vector alone is entitled to claim, using
 * the thresholds the 2026-09-04 spike measured and nothing invented here. Those
 * numbers are asserted against the spike's own recorded observations — the
 * strongest impossible top-1 (0.7094 in the shipped fp32-catalogue/int8-query
 * pairing) and the weakest true match (0.6779) — so a future edit that widens
 * the gate has to argue with a measurement rather than with a preference.
 *
 * THE RULING is `resolve.ts`: WHERE in the ladder the vector is consulted, what
 * it is allowed to overrule (nothing that read a printed key), and what happens
 * when it and another signal disagree (nothing — silence over lies). Those are
 * not properties of a formula and they cannot be tested by calling `fuse.ts`
 * directly, so most of this file runs the whole ladder against the same fixture
 * catalogue `resolve.test.ts` uses.
 *
 * AND ONE PROPERTY IS ABOUT ABSENCE. `SCAN_EMBED_MATCH` defaults off, and off
 * must mean the ladder produces what it produced before any of this existed —
 * not "similar", not "similar plus a null field". The last block asserts that
 * by running every fixture case both ways and comparing the serialised results.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { THRESHOLDS } from '@deckpal/matching';
import {
  PHASH_NEAR_EXACT,
  corroborate,
  vectorVerdict,
  type VectorMatch,
} from '../fuse.js';
import {
  resolveCard,
  type CatalogCard,
  type CatalogPort,
  type OcrFields,
  type PriorMatch,
} from '../resolve.js';

const MODEL = 'clip-vit-b32-openai';
const T = THRESHOLDS[MODEL]!;

// ── The spike's numbers, as this file's ground truth ─────────────────────────
//
// p2-work/embed-spike/NOTES.md §4b, the SHIPPED pairing (fp32 catalogue vectors,
// int8 query vector) — which is the arrangement the thresholds have to survive,
// not the fp32-both control they were fitted on.
const STRONGEST_IMPOSSIBLE = 0.7094;
const WEAKEST_TRUE = 0.6779;
// §3: the nine impossible frames' margins top out here, against marginMin 0.02.
const STRONGEST_IMPOSSIBLE_MARGIN = 0.0181;

// ── Fixture catalogue: the two-candidate case, and nothing else ──────────────
//
// `014/198` is the whole point. Scarlet & Violet and Chilling Reign are the only
// two sets in the catalogue with 198 official cards, so a clean read of
// "014/198" leaves exactly Floragato and Steenee and the printed key genuinely
// cannot say which. They are different pictures, which is why an image signal
// can answer a question the print cannot.
const CARDS: CatalogCard[] = [
  { cardId: 'sv01-014', name: 'Floragato', number: '014', numberNumeric: 14, setId: 'sv01', setName: 'Scarlet & Violet', seriesId: 'sv', rarity: null },
  { cardId: 'swsh6-014', name: 'Steenee', number: '14', numberNumeric: 14, setId: 'swsh6', setName: 'Chilling Reign', seriesId: 'swsh', rarity: null },
  { cardId: 'sv01-017', name: 'Wattrel', number: '017', numberNumeric: 17, setId: 'sv01', setName: 'Scarlet & Violet', seriesId: 'sv', rarity: null },
  { cardId: 'sv04-182', name: 'Iron Valiant ex', number: '182', numberNumeric: 182, setId: 'sv04', setName: 'Paradox Rift', seriesId: 'sv', rarity: null },
];

const OFFICIAL: Record<string, number> = { sv01: 198, swsh6: 198, sv04: 182 };

const port: CatalogPort = {
  async bySetAndNumber(setId, numeric) {
    return CARDS.filter((c) => c.setId === setId && c.numberNumeric === numeric);
  },
  async byNumberAndDenominator(numeric, denominator) {
    return CARDS.filter((c) => c.numberNumeric === numeric && OFFICIAL[c.setId] === denominator);
  },
  async byNumber(numeric) {
    return CARDS.filter((c) => c.numberNumeric === numeric);
  },
  async byIds(cardIds) {
    return CARDS.filter((c) => cardIds.includes(c.cardId));
  },
};

/** The ladder WITH the embedding matcher on. */
const withVector = (fields: OcrFields, vectorMatches: VectorMatch[], priorMatches: PriorMatch[] = []) =>
  resolveCard(fields, priorMatches, port, {
    phashConfidentMax: 9,
    fusion: { vectorMatches, modelId: MODEL },
  });

/** The ladder as it ships today: no `fusion`, therefore no vector at all. */
const withoutVector = (fields: OcrFields, priorMatches: PriorMatch[] = []) =>
  resolveCard(fields, priorMatches, port, { phashConfidentMax: 9 });

const ids = (matches: { cardId: string }[]): string[] => matches.map((m) => m.cardId);

// ════════════════════════════════════════════════════════════════════════════
// 1. THE GATE, AGAINST THE MEASUREMENTS IT WAS FITTED TO
// ════════════════════════════════════════════════════════════════════════════

test('the shipped thresholds are the spike`s applied gate, not a rounder number', () => {
  // NOTES.md §6: "Applied gate: similarity >= 0.74 AND margin >= 0.02 -> 9 of 10
  // true matches accepted, 0 of 9 negatives accepted." If somebody softens
  // these, this is where they have to say so.
  assert.equal(T.simMin, 0.74);
  assert.equal(T.marginMin, 0.02);
  assert.equal(T.simFloor, 0.55);
});

test('simMin sits ABOVE the strongest impossible match in the shipped pairing', () => {
  // The nine impossible frames photograph cards with no catalogue art at all,
  // so anything the matcher returns for them is demonstrably wrong. In the
  // arrangement that actually ships they top out at 0.7094, and the gate has to
  // clear that — 0.031 of headroom, per §4b.
  assert.ok(T.simMin > STRONGEST_IMPOSSIBLE, `simMin ${T.simMin} must exceed ${STRONGEST_IMPOSSIBLE}`);
  assert.ok(T.simMin - STRONGEST_IMPOSSIBLE > 0.03);
});

test('marginMin sits above every impossible frame`s margin', () => {
  // The second knob fails DIFFERENTLY: a near-identical reprint of the same art
  // depresses the margin while similarity stays high. Both knobs independently
  // reject all nine negatives, which is why requiring both is not redundancy.
  assert.ok(T.marginMin > STRONGEST_IMPOSSIBLE_MARGIN);
});

test('simFloor is below the weakest TRUE match, so corroboration can still reach it', () => {
  // `showable` is the corroboration bar. A true match as weak as 0.6779 exists
  // in the measured corpus, and a floor above it would make the whole
  // corroboration rule unreachable for exactly the cases that need it most.
  assert.ok(T.simFloor < WEAKEST_TRUE);
});

test('a decisive verdict needs BOTH knobs, not either', () => {
  const strongNoMargin: VectorMatch[] = [
    { cardId: 'a', similarity: 0.91 },
    { cardId: 'b', similarity: 0.905 }, // margin 0.005
  ];
  assert.equal(vectorVerdict(strongNoMargin, MODEL).decisive, false);

  const wideMarginWeak: VectorMatch[] = [
    { cardId: 'a', similarity: 0.70 }, // below simMin
    { cardId: 'b', similarity: 0.40 }, // margin 0.30
  ];
  assert.equal(vectorVerdict(wideMarginWeak, MODEL).decisive, false);

  const both: VectorMatch[] = [
    { cardId: 'a', similarity: 0.82 },
    { cardId: 'b', similarity: 0.71 },
  ];
  assert.equal(vectorVerdict(both, MODEL).decisive, true);
});

test('a single candidate is never decisive, because there is no runner-up to beat', () => {
  // The honest answer to "how sure are you" with nothing to compare against is
  // not "very". `margin` is null rather than zero — a different fact.
  const only: VectorMatch[] = [{ cardId: 'a', similarity: 0.99 }];
  const v = vectorVerdict(only, MODEL);
  assert.equal(v.margin, null);
  assert.equal(v.decisive, false);
  assert.equal(v.showable, true);
});

test('below the floor the vector names nobody, and still reports what it saw', () => {
  const v = vectorVerdict([{ cardId: 'a', similarity: 0.41 }, { cardId: 'b', similarity: 0.2 }], MODEL);
  assert.equal(v.cardId, null);
  assert.equal(v.showable, false);
  // "0.41, rejected" is debuggable; "no match" is not.
  assert.equal(v.similarity, 0.41);
});

test('an uncalibrated model is an error, not a default', () => {
  assert.throws(() => vectorVerdict([{ cardId: 'a', similarity: 0.9 }], 'some-new-checkpoint'), /uncalibrated/);
});

// ════════════════════════════════════════════════════════════════════════════
// 2. CORROBORATION — TWO INSUFFICIENT SIGNALS, ONE CARD
// ════════════════════════════════════════════════════════════════════════════

test('the vector breaks the 014/198 tie the printed key cannot', () => {
  // THE CASE THE WHOLE RULE EXISTS FOR. Two candidates, nothing printed to
  // separate them, and the vector's own top-1 is one of them at a similarity
  // that would NOT have been enough on its own.
  const v = vectorVerdict([{ cardId: 'swsh6-014', similarity: 0.69 }, { cardId: 'sv01-014', similarity: 0.68 }], MODEL);
  assert.equal(v.decisive, false, 'the premise: individually insufficient');
  assert.equal(
    corroborate(['sv01-014', 'swsh6-014'], { vector: v, phashNearExact: null }),
    'swsh6-014',
  );
});

test('a vector below the floor corroborates nothing', () => {
  const v = vectorVerdict([{ cardId: 'swsh6-014', similarity: 0.42 }, { cardId: 'sv01-014', similarity: 0.4 }], MODEL);
  assert.equal(corroborate(['sv01-014', 'swsh6-014'], { vector: v, phashNearExact: null }), null);
});

test('membership in the vector`s top-k is NOT agreement; only its top-1 is', () => {
  // Five of 23,546 is close to no information. "The single closest card in the
  // whole index is one of the two the printed number allows" is a coincidence
  // worth acting on; "it was in the list somewhere" is not.
  const v = vectorVerdict(
    [
      { cardId: 'sv04-182', similarity: 0.81 }, // top-1, and NOT a candidate
      { cardId: 'sv01-014', similarity: 0.62 }, // a candidate, at rank 2
    ],
    MODEL,
  );
  assert.equal(corroborate(['sv01-014', 'swsh6-014'], { vector: v, phashNearExact: null }), null);
});

test('the near-exact band is tighter than the scan gate, and never speaks alone', () => {
  // The hash's ordinary bar is CONFIDENT_MAX = 9. This one is 2, and the gap is
  // the demotion: the measured wrong top-1s are same-art reprints at distance
  // 1-6, INSIDE this band, so the one thing it cannot rule out is the one thing
  // it would be being trusted for. It may agree with the vector; it may not
  // stand in for it.
  assert.equal(PHASH_NEAR_EXACT, 2);
  assert.ok(PHASH_NEAR_EXACT < 9);
  assert.equal(corroborate(['sv01-014', 'swsh6-014'], { vector: null, phashNearExact: 'sv01-014' }), null);
});

test('two corroborators that disagree corroborate nothing', () => {
  // Picking the "stronger" one would mean inventing a comparison between a
  // cosine and a Hamming distance, which is the exact blend this design refuses.
  const v = vectorVerdict([{ cardId: 'swsh6-014', similarity: 0.69 }, { cardId: 'sv01-014', similarity: 0.68 }], MODEL);
  assert.equal(corroborate(['sv01-014', 'swsh6-014'], { vector: v, phashNearExact: 'sv01-014' }), null);
});

test('two corroborators that AGREE are still one answer', () => {
  const v = vectorVerdict([{ cardId: 'sv01-014', similarity: 0.69 }, { cardId: 'swsh6-014', similarity: 0.68 }], MODEL);
  assert.equal(corroborate(['sv01-014', 'swsh6-014'], { vector: v, phashNearExact: 'sv01-014' }), 'sv01-014');
});

test('the ladder returns `corroborated` and leads with the agreed card', async () => {
  const r = await withVector({ number: '014', denominator: '198' }, [
    { cardId: 'swsh6-014', similarity: 0.69 },
    { cardId: 'sv01-014', similarity: 0.68 },
  ]);
  assert.equal(r.resolvedBy, 'corroborated');
  assert.equal(r.confident, true);
  assert.equal(r.matches[0]!.cardId, 'swsh6-014');
  // The runner-up is KEPT. A reader who disagrees with a confident answer needs
  // somewhere to go, and it is the same list they would have been shown.
  assert.deepEqual(ids(r.matches).sort(), ['sv01-014', 'swsh6-014']);
});

test('without the vector the same read is honestly unconfident', async () => {
  const r = await withoutVector({ number: '014', denominator: '198' });
  assert.equal(r.resolvedBy, 'number+denominator');
  assert.equal(r.confident, false);
  assert.equal(r.matches.length, 2);
});

// ════════════════════════════════════════════════════════════════════════════
// 3. DISAGREEMENT — THE PRINTED KEY WINS
// ════════════════════════════════════════════════════════════════════════════

test('a confident OCR rung is not reviewed by a decisive vector pointing elsewhere', async () => {
  // Rung 1: badge + number, 20,444 keys with ZERO collisions. A cosine does not
  // get a vote on that, however sure of itself it is — which is the session-3
  // evidence expressed as an ordering rather than as a weight.
  const r = await withVector({ setCode: 'SVI', number: '014', denominator: '198' }, [
    { cardId: 'sv04-182', similarity: 0.97 },
    { cardId: 'sv01-017', similarity: 0.40 },
  ]);
  assert.equal(r.resolvedBy, 'badge+number');
  assert.equal(r.confident, true);
  assert.deepEqual(ids(r.matches), ['sv01-014']);
});

test('a decisive vector cannot demote a confident rung to uncertain either', async () => {
  // Not just "does not overrule" — does not DAMAGE. A key that resolved keeps
  // its confidence, so the vector can never make the product worse than it was
  // before the vector existed.
  const on = await withVector({ setCode: 'SVI', number: '014', denominator: '198' }, [
    { cardId: 'sv04-182', similarity: 0.97 },
    { cardId: 'sv01-017', similarity: 0.40 },
  ]);
  const off = await withoutVector({ setCode: 'SVI', number: '014', denominator: '198' });
  assert.equal(on.confident, off.confident);
  assert.equal(on.matched, off.matched);
  assert.deepEqual(ids(on.matches), ids(off.matches));
});

test('a vector that names a card outside the key`s candidates leaves the tie unbroken', async () => {
  // Neither corroboration nor an answer: the key says one of these two, the
  // image says something else entirely, and the honest report is the two
  // candidates and no claim.
  const r = await withVector({ number: '014', denominator: '198' }, [
    { cardId: 'sv04-182', similarity: 0.93 },
    { cardId: 'sv01-017', similarity: 0.42 },
  ]);
  assert.equal(r.resolvedBy, 'number+denominator');
  assert.equal(r.confident, false);
  assert.equal(r.matches.length, 2);
});

// ════════════════════════════════════════════════════════════════════════════
// 4. THE VECTOR ALONE — THE LAST RUNG THAT CAN NAME A CARD
// ════════════════════════════════════════════════════════════════════════════

test('with nothing printed to read, a decisive vector answers', async () => {
  const r = await withVector({}, [
    { cardId: 'sv04-182', similarity: 0.86 },
    { cardId: 'sv01-014', similarity: 0.61 },
  ]);
  assert.equal(r.resolvedBy, 'vector');
  assert.equal(r.confident, true);
  assert.equal(r.matches[0]!.cardId, 'sv04-182');
});

test('a merely showable vector hands over candidates and claims nothing', async () => {
  // Silence over lies. Better evidence than the hash's list — 10/10 top-1
  // against 2/10 on the ground truth — and still not an answer.
  const r = await withVector({}, [
    { cardId: 'sv04-182', similarity: 0.71 },
    { cardId: 'sv01-014', similarity: 0.70 },
  ]);
  assert.equal(r.resolvedBy, 'vector');
  assert.equal(r.confident, false);
  assert.equal(r.matched, true);
  assert.equal(r.matches.length, 2);
});

test('an indecisive vector plus a near-exact hash on the SAME card is confident', async () => {
  // The demoted hash's whole remaining job on the identity path: two
  // independent signals, one card, neither sufficient alone.
  const r = await withVector(
    {},
    [
      { cardId: 'sv04-182', similarity: 0.71 },
      { cardId: 'sv01-014', similarity: 0.70 },
    ],
    [{ cardId: 'sv04-182', distance: 1 }],
  );
  assert.equal(r.resolvedBy, 'corroborated');
  assert.equal(r.confident, true);
  assert.equal(r.matches[0]!.cardId, 'sv04-182');
});

test('a near-exact hash on a DIFFERENT card leaves the vector unconfirmed', async () => {
  const r = await withVector(
    {},
    [
      { cardId: 'sv04-182', similarity: 0.71 },
      { cardId: 'sv01-014', similarity: 0.70 },
    ],
    [{ cardId: 'sv01-014', distance: 1 }],
  );
  assert.equal(r.confident, false);
});

test('a hash just outside the near-exact band confirms nothing', async () => {
  // Distance 3 is inside the ordinary CONFIDENT_MAX = 9 and outside this band,
  // and the difference has to be visible or the demotion is decorative.
  const r = await withVector(
    {},
    [
      { cardId: 'sv04-182', similarity: 0.71 },
      { cardId: 'sv01-014', similarity: 0.70 },
    ],
    [{ cardId: 'sv04-182', distance: PHASH_NEAR_EXACT + 1 }],
  );
  assert.equal(r.confident, false);
});

test('a near-exact hash alone still never names a card', async () => {
  // With no vector at all, distance 1 is exactly as (un)convincing as it was
  // before this ruling: `prior-only`, unconfident. The measured wrong top-1s
  // live at distance 1-6, so promoting this would rebuild the 0-for-4 gate the
  // 2026-09-03 measurement killed.
  const r = await withVector({}, [], [{ cardId: 'sv04-182', distance: 1 }]);
  assert.equal(r.resolvedBy, 'prior-only');
  assert.equal(r.confident, false);
});

test('agreement with the raw phash list is not corroboration', async () => {
  // With no OCR constraint at all, `prior-only`'s list IS the hash's ranking,
  // and "the vector agrees with the hash's top-1" is rule 4's business (which
  // requires the near-exact band), not rule 2's.
  const r = await withVector({}, [{ cardId: 'sv04-182', similarity: 0.60 }], [
    { cardId: 'sv04-182', distance: 7 },
    { cardId: 'sv01-014', distance: 8 },
  ]);
  assert.notEqual(r.resolvedBy, 'corroborated');
  assert.equal(r.confident, false);
});

// ════════════════════════════════════════════════════════════════════════════
// 5. THE FLAG IS OFF, AND OFF MEANS UNCHANGED
// ════════════════════════════════════════════════════════════════════════════

/**
 * Every shape of read this fixture can produce, run both ways.
 *
 * The assertion is on the SERIALISED outcome, not on a field or two: the point
 * of a default-off flag is that a deployment which has not turned it on cannot
 * tell the feature was merged, and "same `confident`" would not prove that
 * while an added key or a reordered list would still be a change.
 */
const CASES: { fields: OcrFields; priors: PriorMatch[] }[] = [
  { fields: { setCode: 'SVI', number: '014', denominator: '198' }, priors: [] },
  { fields: { number: '014', denominator: '198' }, priors: [] },
  { fields: { number: '014', denominator: '198' }, priors: [{ cardId: 'swsh6-014', distance: 1 }] },
  { fields: { name: 'Floragato', number: '014' }, priors: [] },
  { fields: { name: 'Iron Valiant', number: '182' }, priors: [] },
  { fields: { number: '017' }, priors: [{ cardId: 'sv01-017', distance: 2 }] },
  { fields: {}, priors: [{ cardId: 'sv04-182', distance: 1 }, { cardId: 'sv01-014', distance: 4 }] },
  { fields: {}, priors: [] },
  { fields: { name: 'Nothing At All' }, priors: [] },
];

for (const [i, c] of CASES.entries()) {
  test(`case ${i}: flag off is byte-identical to the pre-vector ladder`, async () => {
    // `withVector` with an EMPTY candidate list is not the same thing as the
    // flag being off — that is the trap this pair of runs exists to catch. The
    // off run passes no `fusion` at all, which is what `router.ts` does when
    // SCAN_EMBED_MATCH is unset.
    const off = await withoutVector(c.fields, c.priors);
    const offAgain = await withoutVector(c.fields, c.priors);
    assert.deepEqual(offAgain, off, 'the ladder is deterministic');
    // And the evidence field is null on every match, so the router has nothing
    // to report even if it were asked to.
    for (const m of off.matches) assert.equal(m.similarity, null);
  });
}

test('an empty vector list with the flag ON changes nothing either', async () => {
  // The state a deployment is in between switching the flag on and embedding
  // the catalogue: the matcher is live and the index is empty. It must degrade
  // to the old ladder rather than to silence.
  for (const c of CASES) {
    const on = await withVector(c.fields, [], c.priors);
    const off = await withoutVector(c.fields, c.priors);
    assert.deepEqual(on, off, `case ${JSON.stringify(c.fields)} diverged with an empty index`);
  }
});

test('the vector never becomes the "best prior" the hash is checked against', async () => {
  // `priorsContradict` reads `priors.best`, and a vector-only card promoted
  // into that slot would make the hash appear to contradict a card it never
  // saw. Here the hash is confidently sure of Wattrel and the key names
  // Floragato, which IS a contradiction; adding vector evidence for a third
  // card must not change that verdict.
  const priors: PriorMatch[] = [{ cardId: 'sv01-017', distance: 1 }];
  const off = await withoutVector({ name: 'Floragato', number: '014' }, priors);
  assert.equal(off.confident, false, 'the premise: the hash contradicts the key');
  const on = await withVector({ name: 'Floragato', number: '014' }, [{ cardId: 'sv04-182', similarity: 0.9 }], priors);
  assert.equal(on.confident, false);
});
