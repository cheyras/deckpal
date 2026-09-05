/**
 * Pure (no DB) guard for the vendored printed set-code table and the badge
 * lookup built on it.
 *
 * CROSSWALK §8.2 item 5 wants a CI check that diffs the file against the live
 * `card_set` and turns red when upstream ships a set the file has not been
 * taught about. That needs a database, which this CI does not have — so the
 * DB-shaped half runs as a dev-startup warning (`warnOnPrintedSetCodeDivergence`)
 * and THIS is the enforceable half: the file's internal consistency, the
 * migration seed agreeing with it, and every rule in bakeoff/REPORT.md §4.2.
 *
 * The §4.2 rules are here because one of them was got wrong once, in a way that
 * produced a false accept — a card confidently identified as the wrong card,
 * which is the worst outcome this feature has — and the fix is a one-line
 * condition that would be easy to "simplify" back out.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  boundedLevenshtein,
  diffPrintedSetCodes,
  normalizeBadge,
  printedSetCodeByCode,
  printedSetCodeFor,
  printedSetCodes,
  resolveBadge,
  PRINTED_FROM,
  type CardSetAbbrevRow,
} from '../printedSetCode.js';

const HERE = dirname(fileURLToPath(import.meta.url));

// ── The file itself ─────────────────────────────────────────────────────────

test('the table holds exactly the 29 printed-era sets', () => {
  // CROSSWALK §2.5. Not a magic number: English cards began printing a text set
  // code with Scarlet & Violet on 2023-03-31, and 29 sets have shipped since.
  // It grows by roughly four rows a year, so a change here should be a
  // deliberate, reviewed line and never a merge artefact.
  assert.equal(printedSetCodes().length, 29);
});

test('no duplicate code and no duplicate set id', () => {
  // The whole premise is that the printed code is a KEY: TCGdex's abbreviations
  // have zero collisions across all 218 sets, against pokemontcg.io's eight.
  // A duplicate here would quietly make one of the two rows unreachable, since
  // the lookup takes the first best match.
  const codes = printedSetCodes().map((c) => c.code);
  const setIds = printedSetCodes().map((c) => c.setId);
  assert.equal(new Set(codes).size, codes.length, 'duplicate printed code');
  assert.equal(new Set(setIds).size, setIds.length, 'duplicate set id');
});

test('every row is well formed', () => {
  for (const c of printedSetCodes()) {
    assert.match(c.code, /^[A-Z]{3}(?:[0-9]{2})?$/, `${c.code}: codes are three uppercase letters, or MCD + two digits`);
    assert.ok(c.setId.length > 0, `${c.code}: empty set id`);
    assert.ok(['main', 'promo', 'energy', 'product'].includes(c.kind), `${c.code}: unknown kind ${c.kind}`);
    assert.equal(typeof c.verified, 'boolean', `${c.code}: verified must be an explicit boolean`);
    assert.ok(c.max > 0, `${c.code}: max must be positive`);
    if (c.denominator !== null) assert.ok(c.denominator > 0, `${c.code}: a printed denominator cannot be zero`);
  }
});

test('exactly SVE, SVP, MEE and MEP print no denominator', () => {
  // The single most load-bearing fact in the file. A null here is not "unknown"
  // — it is "this card prints no /nnn at all", which is what separates SVE 017
  // from SVI 017, and what REPORT §4.2 rule 4 keys on. Adding a fifth null by
  // accident would let that set match arbitrary flavour text.
  const noDenominator = printedSetCodes().filter((c) => c.denominator === null).map((c) => c.code).sort();
  assert.deepEqual(noDenominator, ['MEE', 'MEP', 'SVE', 'SVP']);
});

test('the three unverified rows are the McDonald\'s pair and My First Battle, and each says why', () => {
  // No art exists upstream and our CDN serves placeholders, so nobody has seen
  // what these cards print — they may carry a set SYMBOL like the pre-SV sets
  // (CROSSWALK §3.6, §9 item 1). MCD23/MCD24 are also the era's ONLY 1-edit
  // pair the denominator does not separate: both /15.
  const unverified = printedSetCodes().filter((c) => !c.verified);
  assert.deepEqual(unverified.map((c) => c.code).sort(), ['MCD23', 'MCD24', 'MFB']);
  for (const c of unverified) {
    assert.match(c.note ?? '', /UNVERIFIED/, `${c.code}: an unverified row must carry the caveat`);
  }
  assert.equal(printedSetCodeByCode('MCD23')?.denominator, printedSetCodeByCode('MCD24')?.denominator);
});

test('the known denominator collisions inside the printed era are the three CROSSWALK §4 measured', () => {
  // The denominator is a REJECTION gate, never a selector, so collisions are
  // survivable — but a fourth appearing without anyone noticing would quietly
  // widen rung 3's candidate sets, so pin the list.
  const byDenominator = new Map<number, string[]>();
  for (const c of printedSetCodes()) {
    if (c.denominator === null) continue;
    byDenominator.set(c.denominator, [...(byDenominator.get(c.denominator) ?? []), c.code]);
  }
  const collisions = [...byDenominator.entries()]
    .filter(([, codes]) => codes.length > 1)
    .map(([d, codes]) => `${d}:${codes.sort().join('+')}`)
    .sort();
  assert.deepEqual(collisions, ['15:MCD23+MCD24', '182:DRI+PAR', '86:BLK+CRI+WHT']);
});

test('migration 048 seeds prints_set_code for exactly the sets in the file', () => {
  // Two lists of the same 29 ids in two languages WILL drift. The file is the
  // authority (048's own comment says so); this test is what stops the column
  // from disagreeing with it in silence, which is the failure the Trainer
  // Gallery incident already taught this repo once.
  const sql = readFileSync(
    join(HERE, '..', '..', '..', '..', '..', 'packages', 'db', 'src', 'migrations', '048_set_abbreviation.sql'),
    'utf8',
  );
  const block = /cs\.tcgdex_id IN \(([\s\S]*?)\);/.exec(sql);
  assert.ok(block, '048 no longer has a prints_set_code seed list in the shape this test reads');
  const seeded = [...block[1]!.matchAll(/'([^']+)'/g)].map((m) => m[1]!).sort();
  const fromFile = printedSetCodes().map((c) => c.setId).sort();
  assert.deepEqual(seeded, fromFile);
});

test('the printed era begins at Scarlet & Violet, not earlier', () => {
  // 2023-03-31, verified against real scans: swsh9-018 (2022), xy1-001 (2014)
  // and base1-004 (1999) carry a set SYMBOL graphic and no text at all. This
  // constant is what tells the startup check "a 1999 set with no row here is
  // correct" apart from "a 2027 set with no row here is a gap".
  assert.equal(PRINTED_FROM, '2023-03-31');
});

test('lookups resolve both ways', () => {
  assert.equal(printedSetCodeByCode('SVI')?.setId, 'sv01');
  assert.equal(printedSetCodeByCode('svi')?.setId, 'sv01');
  assert.equal(printedSetCodeFor('me05')?.code, 'PBL');
  assert.equal(printedSetCodeFor('swsh6'), undefined, 'a pre-SV set must have no printed code');
});

// ── Normalisation — REPORT §4.2 rule 1 ──────────────────────────────────────

test('the badge normaliser strips the language subscript baked into the box', () => {
  // The badge contains a second, smaller token: `SVI` with a subscript `EN`,
  // inside the same rounded rectangle. Naive OCR returns SVIEN (CROSSWALK §1.1).
  assert.equal(normalizeBadge('SVI EN'), 'SVI');
  assert.equal(normalizeBadge('SVIEN'), 'SVI');
  assert.equal(normalizeBadge('[ SVI ᴱᴺ ]'), 'SVI');
  assert.equal(normalizeBadge('pbl en'), 'PBL');
});

test('the badge normaliser repairs the four digit-for-letter confusions and no others', () => {
  // Every English SV+ code is letters only, so a digit in the output of an
  // English badge is an error with exactly these shapes (CROSSWALK §1.1 item 3).
  assert.equal(normalizeBadge('5V1'), 'SVI');
  assert.equal(normalizeBadge('08F'), 'OBF');
  assert.equal(normalizeBadge('88L'), 'BBL');
  // 2, 3 and 4 are left alone: MCD23 and MCD24 are real codes with real digits,
  // and a residual digit is the signal for "McDonald's, or not English".
  assert.equal(normalizeBadge('MCD23'), 'MCD23');
  assert.equal(normalizeBadge('MCD24'), 'MCD24');
});

test('bounded Levenshtein abandons rather than reporting a distance it did not compute', () => {
  assert.equal(boundedLevenshtein('SVI', 'SVI', 1), 0);
  assert.equal(boundedLevenshtein('SVI', 'SVE', 1), 1);
  assert.equal(boundedLevenshtein('SVI', 'PAL', 1), 2, 'beyond the cap reports cap + 1, never the real distance');
  assert.equal(boundedLevenshtein('SVI', 'SVIEN', 1), 2);
});

// ── The closed-vocabulary lookup — REPORT §4.2 rules 2 to 5 ────────────────

test('rule 2: the code is found as a window inside pooled badge ink', () => {
  // The crop pools the EN subscript, the regulation-mark box to its left, and
  // on a bad crop the number strip too. The code is in there; it is rarely the
  // whole string.
  assert.equal(resolveBadge('G SVI EN 005/198', 198).code?.setId, 'sv01');
  assert.equal(resolveBadge('J PBL EN', 84).code?.setId, 'me05');
});

test('rule 5: exact beats near, and near is accepted at distance 1', () => {
  const exact = resolveBadge('SVI', 198);
  assert.equal(exact.code?.setId, 'sv01');
  assert.equal(exact.reason, 'exact');
  assert.equal(exact.distance, 0);

  const near = resolveBadge('SVX', 198);
  assert.equal(near.code?.setId, 'sv01');
  assert.equal(near.reason, 'near');
  assert.equal(near.distance, 1);

  // Two edits is not a read, it is a guess.
  assert.equal(resolveBadge('XYZ', 198).code, null);
});

test('rule 3: a code whose printed denominator disagrees with the read one is struck out', () => {
  // This is rung 1b. PAL prints /193; the strip said /198. A code/denominator
  // conflict is the exact signature of a 1-edit badge misread, so the CODE is
  // what gets dropped — the number and denominator are kept and the ladder
  // falls to rung 3.
  const r = resolveBadge('PAL', 198);
  assert.equal(r.code, null);
  assert.equal(r.reason, 'denominator-conflict');
  assert.ok(r.rejectedByDenominator.includes('PAL'));
});

test('rule 4: a set that prints NO denominator is eliminated when one WAS read', () => {
  // ── THE BAKEOFF BUG, PINNED ─────────────────────────────────────────────
  // The first matcher EXEMPTED SVE/SVP/MEE/MEP from the cross-check, reasoning
  // there was nothing to compare against. Backwards: for those sets the ABSENCE
  // of a denominator is the discriminator. Exempting them let SVE match
  // arbitrary flavour text and produced the run's single false accept — an
  // sv10-116 crop whose pooled badge text was "116/182 neversecretepo".
  const r = resolveBadge('116/182 neversecretepo', 182);
  assert.equal(r.code, null, 'the bakeoff false accept must stay rejected');
  assert.ok(r.rejectedByDenominator.includes('SVE'), 'and rule 4 must be what rejects it');
});

test('rule 4 redirects rather than merely rejecting: SVE read with a /198 becomes SVI', () => {
  // CROSSWALK §4.1: SVE/SVI is one of the 19 confusable 1-edit pairs, and the
  // denominator is what separates them — SVE 017 prints no /nnn where SVI 017
  // prints /198. Striking the impossible candidate BEFORE the distance test is
  // what lets its surviving neighbour win, instead of both being lost.
  const r = resolveBadge('SVE', 198);
  assert.equal(r.code?.setId, 'sv01');
  assert.equal(r.reason, 'near');
  assert.ok(r.rejectedByDenominator.includes('SVE'));
});

test('with no denominator read, the no-denominator sets are reachable again', () => {
  // An energy card prints no /nnn, so a missing denominator is the normal case
  // here and must not be punished.
  const r = resolveBadge('SVE', null);
  assert.equal(r.code?.setId, 'sve');
  assert.equal(r.reason, 'exact');
  assert.deepEqual(r.rejectedByDenominator, []);
});

test('a tie at the winning distance is refused, not coin-flipped', () => {
  // MCD23/MCD24 is the designed instance: the one confusable pair in the era
  // the denominator cannot separate (both /15), and both unverified. Falling to
  // rung 3 costs a phash confirmation; guessing costs a wrong card.
  const tie = resolveBadge('MCD2', 15);
  assert.equal(tie.code, null);
  assert.equal(tie.reason, 'ambiguous');
  // An exact read still wins outright.
  assert.equal(resolveBadge('MCD23', 15).code?.setId, '2023sv');
});

test('an absent badge is not a failure', () => {
  // 77% of the catalogue prints no code at all. `absent` is the ordinary case
  // for a swsh/xy/base card, not an error to report to anyone.
  assert.equal(resolveBadge(undefined, null).reason, 'absent');
  assert.equal(resolveBadge('', 198).reason, 'absent');
  assert.equal(resolveBadge('   ', 198).reason, 'absent');
  assert.equal(resolveBadge('///', 198).reason, 'empty');
});

test('nothing in the badge path compares the numerator to the denominator', () => {
  // Secret rares: a numerator ABOVE the denominator is normal and frequent — 60
  // in sv01, 154 in sv04.5, 87 in sv10.5w. The denominator is the SET's size
  // and was never a bound on the number (CROSSWALK §3.7).
  assert.equal(resolveBadge('SVI', 198).code?.setId, 'sv01');
  assert.equal(printedSetCodeByCode('SVI')?.max, 258, 'sv01 prints numbers up to 258 against a /198');
});

// ── The DB divergence diff ─────────────────────────────────────────────────

const row = (o: Partial<CardSetAbbrevRow> & { tcgdex_id: string }): CardSetAbbrevRow => ({
  abbreviation: null,
  prints_set_code: false,
  released_on: null,
  ...o,
});

/** A `card_set` that agrees with the vendored file on every one of its 29 rows. */
function agreeingRows(): CardSetAbbrevRow[] {
  return printedSetCodes().map((c) =>
    row({ tcgdex_id: c.setId, abbreviation: c.code, prints_set_code: true, released_on: '2023-03-31' }),
  );
}

test('an agreeing catalogue produces no divergence lines', () => {
  assert.deepEqual(diffPrintedSetCodes(agreeingRows()), []);
});

test('a new printed-era set upstream with no vendored row is reported', () => {
  // The one this exists for. Upstream ships sv11; nobody adds a row; the
  // scanner silently stops reading that expansion's badge.
  const rows = [...agreeingRows(), row({ tcgdex_id: 'sv11', abbreviation: 'XYZ', released_on: '2027-02-05' })];
  const lines = diffPrintedSetCodes(rows);
  assert.equal(lines.length, 1);
  assert.match(lines[0]!, /sv11.*printed era/);
});

test('a pre-2023 set with an abbreviation is not reported — it prints no code and never will', () => {
  const rows = [...agreeingRows(), row({ tcgdex_id: 'swsh9', abbreviation: 'BRS', released_on: '2022-02-25' })];
  assert.deepEqual(diffPrintedSetCodes(rows), []);
});

test('upstream disagreeing with the vendored code is reported, and the file still wins', () => {
  const rows = agreeingRows();
  rows[0] = row({ tcgdex_id: rows[0]!.tcgdex_id, abbreviation: 'WRONG', prints_set_code: true });
  const lines = diffPrintedSetCodes(rows);
  assert.equal(lines.length, 1);
  assert.match(lines[0]!, /upstream disagrees/);
});

test('a NULL abbreviation is reported as a sync that has not run, not as a match', () => {
  const rows = agreeingRows();
  rows[0] = row({ tcgdex_id: rows[0]!.tcgdex_id, abbreviation: null, prints_set_code: true });
  assert.match(diffPrintedSetCodes(rows)[0]!, /is NULL/);
});

test('prints_set_code disagreeing in either direction is reported', () => {
  const missing = agreeingRows();
  missing[0] = row({ tcgdex_id: missing[0]!.tcgdex_id, abbreviation: missing[0]!.abbreviation, prints_set_code: false });
  assert.match(diffPrintedSetCodes(missing)[0]!, /prints_set_code is FALSE/);

  const extra = [...agreeingRows(), row({ tcgdex_id: 'base1', abbreviation: 'BS', prints_set_code: true })];
  assert.match(diffPrintedSetCodes(extra)[0]!, /no printed-set-code\.json row/);
});
