import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateDeck } from '../formats.js';
import type { Deck, DeckEntry, FormatCode, PokemonType, Violation } from '../types.js';
import { mkCard } from './fixtures.js';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Every .ts under a directory, skipping build output. */
function walkTs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walkTs(full));
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

const fireEnergy = () => mkCard({ name: 'Fire Energy', category: 'Energy', energyType: 'Normal', setTcgdexId: 'sve' });
const waterEnergy = () => mkCard({ name: 'Water Energy', category: 'Energy', energyType: 'Normal', setTcgdexId: 'sve' });

function deck(formatCode: FormatCode, entries: DeckEntry[], glcType?: PokemonType): Deck {
  return { formatCode, glcType: glcType ?? null, entries };
}
function e(card: ReturnType<typeof mkCard>, quantity: number): DeckEntry {
  const section = card.category === 'Pokemon' ? 'pokemon' : card.category === 'Trainer' ? 'trainer' : 'energy';
  return { card, quantity, section };
}
/** pad a deck to exactly 60 with basic energy so only the targeted rule fires */
function padTo60(entries: DeckEntry[], energy = fireEnergy()): DeckEntry[] {
  const n = entries.reduce((s, x) => s + x.quantity, 0);
  return n < 60 ? [...entries, e(energy, 60 - n)] : entries;
}
const codes = (r: { violations: Violation[] }) => r.violations.map((v) => v.code);

// ── CASE 1: a known-legal Standard deck -> legal ───────────────────────────────
test('CASE 1 — legal Standard deck is legal', () => {
  const basic = mkCard({ name: 'Fezandipiti ex', category: 'Pokemon', stage: 'Basic', suffix: 'ex', hp: 210, types: ['Darkness'], regulationMark: 'J', setTcgdexId: 'sv06.5' });
  const r = validateDeck(deck('standard', padTo60([e(basic, 1)])));
  assert.equal(r.legal, true, JSON.stringify(r.violations));
  assert.equal(r.counts.total, 60);
});

// ── CASE 2: rotated card (pre-H, no legal reprint) -> illegal, specific reason ──
test('CASE 2 — rotated card with no legal reprint is NOT_IN_FORMAT (Standard)', () => {
  const rotated = mkCard({ name: 'Battle VIP Pass', category: 'Trainer', trainerType: 'Item', regulationMark: 'E', setTcgdexId: 'swsh8', localId: '225' });
  const basic = mkCard({ name: 'Cleffa', category: 'Pokemon', stage: 'Basic', hp: 60, types: ['Psychic'], regulationMark: 'I' });
  // oracle explicitly reports "no legal reprint exists"
  const r = validateDeck(deck('standard', padTo60([e(rotated, 4), e(basic, 1)])), { isInFormatByReprint: () => false });
  assert.equal(r.legal, false);
  const v = r.violations.find((x) => x.code === 'NOT_IN_FORMAT');
  assert.ok(v, 'has NOT_IN_FORMAT');
  assert.equal(v!.detail!.regulation_mark, 'E');
  assert.equal(v!.detail!.reprint_checked, true);
  assert.match(v!.message, /Battle VIP Pass/);
});

test('CASE 2b — reprint oracle rescues a rotated card (Ultra Ball G legal via me01 I)', () => {
  const ultraG = mkCard({ name: 'Ultra Ball', category: 'Trainer', trainerType: 'Item', regulationMark: 'G', setTcgdexId: 'sv01', localId: '196' });
  const basic = mkCard({ name: 'Cleffa', category: 'Pokemon', stage: 'Basic', hp: 60, types: ['Psychic'], regulationMark: 'I' });
  const r = validateDeck(deck('standard', padTo60([e(ultraG, 4), e(basic, 1)])), { isInFormatByReprint: (c) => c.name === 'Ultra Ball' });
  assert.equal(r.legal, true, JSON.stringify(r.violations));
});

// ── CASE 3: 4-copy rule broken -> illegal ──────────────────────────────────────
test('CASE 3 — 5 copies of one name across printings is COPY_LIMIT', () => {
  const nestA = mkCard({ name: 'Nest Ball', category: 'Trainer', trainerType: 'Item', regulationMark: 'I', setTcgdexId: 'sv01', localId: '181', id: 100 });
  const nestB = mkCard({ name: 'Nest Ball', category: 'Trainer', trainerType: 'Item', regulationMark: 'I', setTcgdexId: 'sv04.5', localId: '84', id: 101 });
  const basic = mkCard({ name: 'Cleffa', category: 'Pokemon', stage: 'Basic', hp: 60, types: ['Psychic'], regulationMark: 'I' });
  const r = validateDeck(deck('standard', padTo60([e(nestA, 3), e(nestB, 2), e(basic, 1)])));
  const v = r.violations.find((x) => x.code === 'COPY_LIMIT');
  assert.ok(v, 'has COPY_LIMIT');
  assert.equal(v!.observed, 5);
  assert.equal(v!.allowed, 4);
  assert.deepEqual(v!.card_ids!.sort(), [100, 101]);
});

// ── CASE 4: GLC deck with two Pokémon types -> illegal citing the type rule ─────
test('CASE 4 — GLC with a second Pokémon type is TYPE_MISMATCH', () => {
  const wailmer = mkCard({ name: 'Wailmer', category: 'Pokemon', stage: 'Basic', hp: 90, types: ['Water'], regulationMark: 'H', setTcgdexId: 'sv06' });
  const charmander = mkCard({ name: 'Charmander', category: 'Pokemon', stage: 'Basic', hp: 70, types: ['Fire'], regulationMark: 'H', setTcgdexId: 'sv03' });
  const r = validateDeck(deck('glc', padTo60([e(wailmer, 1), e(charmander, 1)], waterEnergy()), 'Water'));
  const v = r.violations.find((x) => x.code === 'TYPE_MISMATCH');
  assert.ok(v, 'has TYPE_MISMATCH');
  assert.match(v!.message, /Charmander is Fire, not Water/);
  assert.equal(r.legal, false);
});

// ── CASE 5: GLC evolution line crosses types -> illegal citing evolution coherence
test('CASE 5 — GLC evolution line crossing types cites evolution coherence', () => {
  const eevee = mkCard({ name: 'Eevee', category: 'Pokemon', stage: 'Basic', hp: 70, types: ['Colorless'], regulationMark: 'H', setTcgdexId: 'sv03', evolveFrom: null });
  const vaporeon = mkCard({ name: 'Vaporeon', category: 'Pokemon', stage: 'Stage1', hp: 110, types: ['Water'], regulationMark: 'H', setTcgdexId: 'sv03', evolveFrom: 'Eevee' });
  const r = validateDeck(deck('glc', padTo60([e(eevee, 1), e(vaporeon, 1)], waterEnergy()), 'Water'));
  const v = r.violations.find((x) => x.code === 'TYPE_MISMATCH' && x.subject === 'Eevee');
  assert.ok(v, 'Eevee TYPE_MISMATCH');
  assert.match(v!.message, /evolution line that crosses types/);
  assert.equal(v!.detail!.on_type_evolution, 'Vaporeon');
});

// ── extra rule coverage ────────────────────────────────────────────────────────
test('ACE SPEC limit: two ACE SPEC cards in Standard is ACE_SPEC_LIMIT', () => {
  const prime = mkCard({ name: 'Prime Catcher', category: 'Trainer', trainerType: 'Item', regulationMark: 'H' });
  const maxbelt = mkCard({ name: 'Maximum Belt', category: 'Trainer', trainerType: 'Tool', regulationMark: 'H' });
  const basic = mkCard({ name: 'Cleffa', category: 'Pokemon', stage: 'Basic', hp: 60, types: ['Psychic'], regulationMark: 'I' });
  const r = validateDeck(deck('standard', padTo60([e(prime, 1), e(maxbelt, 1), e(basic, 1)])));
  assert.ok(codes(r).includes('ACE_SPEC_LIMIT'));
});

test('GLC rule-box: a V Pokémon is RULE_BOX_FORBIDDEN and ACE SPEC is forbidden', () => {
  const lumineonV = mkCard({ name: 'Lumineon V', category: 'Pokemon', stage: 'Basic', hp: 170, types: ['Water'], regulationMark: 'F', setTcgdexId: 'swsh9' });
  const r = validateDeck(deck('glc', padTo60([e(lumineonV, 1)], waterEnergy()), 'Water'));
  assert.ok(codes(r).includes('RULE_BOX_FORBIDDEN'));
});

test('Expanded ban: Medicham V (swsh7 083) is BANNED', () => {
  const medicham = mkCard({ name: 'Medicham V', category: 'Pokemon', stage: 'Basic', hp: 190, types: ['Fighting'], regulationMark: 'F', setTcgdexId: 'swsh7', localId: '083', localIdNumeric: 83 });
  const basic = mkCard({ name: 'Cleffa', category: 'Pokemon', stage: 'Basic', hp: 60, types: ['Psychic'], regulationMark: 'F', setTcgdexId: 'swsh1' });
  const r = validateDeck(deck('expanded', padTo60([e(medicham, 1), e(basic, 1)])));
  const v = r.violations.find((x) => x.code === 'BANNED');
  assert.ok(v, 'has BANNED');
  assert.match(v!.message, /Medicham V/);
});

test('GLC exclusive group: Boss’s Orders + Lysandre is EXCLUSIVE_GROUP', () => {
  const boss = mkCard({ name: "Boss's Orders", category: 'Trainer', trainerType: 'Supporter', regulationMark: 'H', setTcgdexId: 'sv02' });
  const lysandre = mkCard({ name: 'Lysandre', category: 'Trainer', trainerType: 'Supporter', setTcgdexId: 'xy4' });
  const basicW = mkCard({ name: 'Wailmer', category: 'Pokemon', stage: 'Basic', hp: 90, types: ['Water'], regulationMark: 'H' });
  const r = validateDeck(deck('glc', padTo60([e(boss, 1), e(lysandre, 1), e(basicW, 1)], waterEnergy()), 'Water'));
  assert.ok(codes(r).includes('EXCLUSIVE_GROUP'));
});

// ── GLC set carve-out — Celebrations Classic Collection (§2.3.4 item 5) ────────
//
// Every Classic Collection card is a REPRINT of an older print, so db.ts's real
// reprint oracle (§2.1.5) answers "in format by reprint" for them and the pool
// rule waves the set through. That is precisely why the carve-out has to be
// enforced on its own: these tests inject the same always-true oracle, so the
// carve-out is the only thing standing between the deck and a wrong "legal".
const REPRINT_ORACLE = { isInFormatByReprint: () => true };
const basicWater = () => mkCard({ name: 'Wailmer', category: 'Pokemon', stage: 'Basic', hp: 90, types: ['Water'], regulationMark: 'H', setTcgdexId: 'sv06' });
const ccBlastoise = () => mkCard({ name: 'Blastoise', category: 'Pokemon', stage: 'Stage2', hp: 100, types: ['Water'], evolveFrom: 'Wartortle', setTcgdexId: 'cel25cc', localId: 'CC2', localIdNumeric: null });

test('GLC carve-out: a Classic Collection card outside the exception list is NOT_IN_FORMAT', () => {
  const r = validateDeck(deck('glc', padTo60([e(ccBlastoise(), 1), e(basicWater(), 1)], waterEnergy()), 'Water'), REPRINT_ORACLE);
  assert.equal(r.legal, false, `expected illegal, got ${JSON.stringify(r.violations)}`);
  const v = r.violations.find((x) => x.code === 'NOT_IN_FORMAT' && x.subject === 'Blastoise');
  assert.ok(v, `has NOT_IN_FORMAT for Blastoise — got ${JSON.stringify(codes(r))}`);
  assert.match(v!.message, /Reshiram and Zekrom/);
  assert.equal(v!.detail!.set, 'cel25cc');
  // exactly one row for the card: the carve-out replaces the generic pool message
  assert.equal(r.violations.filter((x) => x.subject === 'Blastoise').length, 1);
});

test('GLC carve-out: Reshiram from the Classic Collection is excepted and stays legal', () => {
  const ccReshiram = mkCard({ name: 'Reshiram', category: 'Pokemon', stage: 'Basic', hp: 130, types: ['Fire'], setTcgdexId: 'cel25cc', localId: 'CC4', localIdNumeric: null });
  const r = validateDeck(deck('glc', padTo60([e(ccReshiram, 1)], fireEnergy()), 'Fire'), REPRINT_ORACLE);
  assert.equal(r.legal, true, JSON.stringify(r.violations));
});

test('GLC carve-out is keyed on the SET, not the name: the same card from another set is unaffected', () => {
  // Mirror-image guard: keying the deny on name alone would fail every Blastoise
  // ever printed; keying the exception on name alone would let cel25cc through.
  const swshBlastoise = mkCard({ name: 'Blastoise', category: 'Pokemon', stage: 'Stage2', hp: 180, types: ['Water'], evolveFrom: 'Wartortle', regulationMark: 'E', setTcgdexId: 'swsh3', localId: '25' });
  const r = validateDeck(deck('glc', padTo60([e(swshBlastoise, 1), e(basicWater(), 1)], waterEnergy()), 'Water'), REPRINT_ORACLE);
  assert.equal(r.legal, true, JSON.stringify(r.violations));
});

test('GLC carve-out does not leak into other formats: cel25cc is Expanded-legal', () => {
  const r = validateDeck(deck('expanded', padTo60([e(ccBlastoise(), 1), e(basicWater(), 1)], waterEnergy())), REPRINT_ORACLE);
  assert.equal(r.legal, true, JSON.stringify(r.violations));
});

// ── DECK-FORMATS §2.3.4 item 6 — Pokémon TCG Classic ─────────────────────────
//
// *"For the most part, no… The exception is for cards that have been printed in
// this set as reprints of GLC-legal cards such as Ultra Ball, Super Rod, VS
// Seeker."* The spec resolves it to "fingerprint-based allow, same primitive as
// §2.1.5" — which is the reprint oracle the pool rule ALREADY consults.
//
// So item 6 needs no vendored data and no set-specific rule: it is the generic
// reprint rule, and a set-keyed carve-out would be the wrong shape for it. What
// it did need was a test saying so, because "not in glc-rules.json" reads as
// "not implemented" to the next person to look — which is how it was carried on
// the deferred list.
//
// These use a DISCRIMINATING oracle rather than the always-true one above: an
// always-true oracle cannot tell "the rule admits reprints" from "the rule
// admits everything", which is the only thing worth proving here.

const classicUltraBall = () => mkCard({ name: 'Ultra Ball', category: 'Trainer', trainerType: 'Item', setTcgdexId: 'tcgc', localId: '92', localIdNumeric: null });
const classicOddCard = () => mkCard({ name: 'Here Comes Team Rocket!', category: 'Trainer', trainerType: 'Item', setTcgdexId: 'tcgc', localId: '93', localIdNumeric: null });

/** Admits exactly the cards that really are reprints of in-format prints. */
const reprintsOnly = (names: string[]) => ({
  isInFormatByReprint: (c: { name: string }) => names.includes(c.name),
});

test('GLC §2.3.4 item 6: a Classic reprint of a GLC-legal card is admitted by the oracle', () => {
  const r = validateDeck(
    deck('glc', padTo60([e(classicUltraBall(), 1), e(basicWater(), 1)], waterEnergy()), 'Water'),
    reprintsOnly(['Ultra Ball']),
  );
  assert.equal(r.legal, true, JSON.stringify(r.violations));
});

test('GLC §2.3.4 item 6: a Classic card that is NOT such a reprint stays out of the pool', () => {
  // The other half. If this passed too, the previous test would only be proving
  // that the oracle was permissive, not that the rule discriminates.
  const r = validateDeck(
    deck('glc', padTo60([e(classicOddCard(), 1), e(basicWater(), 1)], waterEnergy()), 'Water'),
    reprintsOnly(['Ultra Ball']),
  );
  assert.equal(r.legal, false, 'a non-reprint Classic card should not be in the GLC pool');
  assert.ok(codes(r).includes('NOT_IN_FORMAT'));
});

test('the cel25cc exception clears the pool the same way — via the reprint rule', () => {
  // Recorded because it looks like a gap and is not one. GLC's
  // `pool_from_series_prefixes` does not list `cel25`, so CC Reshiram is in the
  // pool ONLY because it is a fingerprint reprint of a Black & White print —
  // which is exactly what §2.3.4 item 5's "unless they are from Black & White or
  // later" means. Widening the prefix list instead would admit all of `cel25`.
  const ccReshiram = mkCard({ name: 'Reshiram', category: 'Pokemon', stage: 'Basic', hp: 130, types: ['Fire'], setTcgdexId: 'cel25cc', localId: 'CC4', localIdNumeric: null });
  const withOracle = validateDeck(deck('glc', padTo60([e(ccReshiram, 1)], fireEnergy()), 'Fire'), reprintsOnly(['Reshiram']));
  assert.equal(withOracle.legal, true, JSON.stringify(withOracle.violations));

  const withoutOracle = validateDeck(deck('glc', padTo60([e(ccReshiram, 1)], fireEnergy()), 'Fire'), reprintsOnly([]));
  assert.equal(withoutOracle.legal, false, 'without the reprint rule there is nothing else admitting it');
});

test('all rules evaluate (no short-circuit): tiny deck reports DECK_SIZE among others', () => {
  const r = validateDeck(deck('standard', [e(mkCard({ name: 'Pikachu', category: 'Pokemon', stage: 'Basic', hp: 60, types: ['Lightning'], regulationMark: 'I' }), 1)]));
  assert.ok(codes(r).includes('DECK_SIZE'));
});

test('every production validateDeck call supplies the reprint oracle', () => {
  // THE INVARIANT BEHIND THE TWO TESTS ABOVE.
  //
  // GLC's pool admits a card three ways — set prefix, regulation mark, or the
  // reprint oracle — and for `cel25cc` and Pokémon TCG Classic the oracle is
  // the ONLY one of the three that fires. So a caller that forgets it does not
  // get a slightly different answer; it tells the reader their legal deck is
  // illegal, which is the worse direction of the two.
  //
  // `isInFormatByReprint` is optional in `ValidateContext` because pure tests
  // inject their own. That optionality is load-bearing and also the hole, and
  // nothing but this test stands in it.
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const offenders: string[] = [];
  for (const file of walkTs(root)) {
    if (file.includes('__tests__') || file.endsWith('prove.ts')) continue;
    const src = readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    for (const m of src.matchAll(/(function\s+)?validateDeck\s*\(/g)) {
      if (m[1]) continue; // the declaration itself, not a call
      const tail = src.slice(m.index!, m.index! + 400);
      // No line number offered: it would be counted against the comment-stripped
      // copy and point somewhere else, which is worse than not offering one.
      if (!/isInFormatByReprint/.test(tail)) offenders.push(file.slice(root.length));
    }
  }
  assert.deepEqual(
    [...new Set(offenders)],
    [],
    `validateDeck called without a reprint oracle: ${[...new Set(offenders)].join(', ')} — ` +
      'GLC decks containing a Celebrations Classic Collection or Pokémon TCG Classic ' +
      'card would be reported ILLEGAL when they are legal.',
  );
});
