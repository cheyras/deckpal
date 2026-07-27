import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateDeck } from '../formats.js';
import type { Deck, DeckEntry, FormatCode, PokemonType, Violation } from '../types.js';
import { mkCard } from './fixtures.js';

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

test('all rules evaluate (no short-circuit): tiny deck reports DECK_SIZE among others', () => {
  const r = validateDeck(deck('standard', [e(mkCard({ name: 'Pikachu', category: 'Pokemon', stage: 'Basic', hp: 60, types: ['Lightning'], regulationMark: 'I' }), 1)]));
  assert.ok(codes(r).includes('DECK_SIZE'));
});
