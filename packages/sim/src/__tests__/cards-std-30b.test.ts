/**
 * Card tests, batch "std-30b": every card scripted in cards/scripts/std-30b.ts does what its printed text says in a constructed
 * position. Quotes are the printed text from the frames. No TPCi ruling in the Compendium names these cards' own texts (the rulings
 * attached to their names concern older cards of the same name), so none is cited.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { def } from '../context.js';
import { describeOptions } from '../describe.js';
import type { Game } from '../game.js';
import { scenario, type SideLayout } from '../scenario.js';
import { BURNED, CONFUSED, PARALYZED, POISONED, type Decision } from '../types.js';
import { fromIds } from './decks.js';

function labels(g: Game): string[] {
  return describeOptions(g.ctx, g.state, g.decision as Decision);
}
function has(g: Game, text: string): boolean {
  return labels(g).some((l) => l.includes(text));
}
function choose(g: Game, text: string): void {
  const i = labels(g).findIndex((l) => l.includes(text));
  assert.ok(i >= 0, `no option containing "${text}" in: ${labels(g).join(' | ')} [${g.decision?.prompt}]`);
  g.submit([i]);
}
function pick(g: Game, names: string[]): void {
  const ls = labels(g);
  const used = new Set<number>();
  const idx = names.map((n) => {
    const i = ls.findIndex((l, j) => !used.has(j) && l.includes(n));
    assert.ok(i >= 0, `no option "${n}" in: ${ls.join(' | ')}`);
    used.add(i);
    return i;
  });
  g.submit(idx);
}
const nameOf = (g: Game, card: number): string => def(g.ctx, card).name;
const namesOf = (g: Game, cards: number[]): string[] => cards.map((c) => nameOf(g, c)).sort();
const dmg = (g: Game, p: 0 | 1): number => g.state.p[p].active!.damage;

const ENERGY: [string, number][] = ['mee-001', 'mee-002', 'mee-003', 'mee-004', 'mee-005', 'mee-006', 'mee-007', 'mee-008'].map((id) => [id, 10]);
/** Cards by name -> id. The four Pikachu are chosen per test (they share a name). */
const IDS: Record<string, string> = {
  'Pikachu ex': '30th-053',
  Zapdos: '30th-055',
  Zekrom: '30th-056',
  Zeraora: '30th-057',
  Morpeko: '30th-061',
  Miraidon: '30th-062',
  Mewtwo: '30th-063',
  'Mewtwo ex': '30th-064',
  Azumarill: '30th-068',
  Espeon: '30th-069',
  'Sylveon ex': '30th-071',
  Unown: '30th-072',
  Chandelure: '30th-075',
  Xerneas: '30th-076',
  Comfey: '30th-077',
  Cosmoem: '30th-079',
  Lunala: '30th-080',
  Gimmighoul: '30th-081',
  // supporting cast
  'Dragapult ex': 'sv06-130', // 320 HP, no Weakness or Resistance: a neutral target; Jet Headbutt {C} 70
  Dreepy: 'sv06-128',
  Drakloak: 'sv06-129', // 90 HP
  'Fezandipiti ex': 'sv06.5-038', // 210 HP Basic ex, Weakness Fighting x2
  'Latias ex': 'sv08-076', // 210 HP Basic ex, Weakness Darkness
  'Koraidon ex': 'svp-197', // 230 HP Basic ex, Weakness Psychic x2
  Snorlax: 'me03-063', // 160 HP Basic, not an ex, Weakness Fighting x2
  Marill: '30th-067', // 70 HP {P}
  Eevee: 'sv06-135',
  Litwick: 'me05-036',
  Lampent: 'me05-037',
  Cosmog: '30th-078',
  Moltres: 'me02-014', // 120 HP Basic {R}
  Articuno: 'sv09-032', // 110 HP Basic {W}, Weakness Lightning x2
  Shuppet: 'me05-033',
  Banette: 'me05-034', // Hide 'n' Sneak
  'Ultra Ball': 'me01-131',
  'Rare Candy': 'me01-125',
  'Lively Stadium': 'sv08-180',
  'Neutralization Zone': 'sv06.5-060',
  'Telepathic Psychic Energy': 'me03-088',
};
/** A test deck of the named cards (4 of each; a name not in IDS is an id) plus plenty of every basic Energy. */
function deck(...cards: string[]) {
  return fromIds('30b', [...[...new Set(cards)].map((n): [string, number] => [IDS[n] ?? n, 4]), ...ENERGY]);
}
const G = 'Grass Energy';
const R = 'Fire Energy';
const W = 'Water Energy';
const L = 'Lightning Energy';
const P = 'Psychic Energy';
const TPE = 'Telepathic Psychic Energy';
type Sides = [SideLayout, SideLayout];
const BASE = Object.keys(IDS);
/** A game: P0 to move (turn 3). P0's deck is the base cast plus `extra` (the Pikachu under test). */
const game = (sides: Sides, opts: Parameters<typeof scenario>[3] = {}, extra: string[] = []) => scenario(deck(...BASE, ...extra), deck(...BASE), sides, opts);
const DRA = 'Dragapult ex';
/** The opponent's side with a Dragapult ex ready to answer with Jet Headbutt ({C}, 70). */
const FOE = (): SideLayout => ({ active: DRA, energy: { active: [W] } });

// ------------------------------------------------------------------ Pikachu 30th-046

test('Pikachu (30th-046), Get Some Air: this Pokémon recovers from all Special Conditions', () => {
  const g = game([{ active: 'Pikachu', energy: { active: [W] }, cond: POISONED | BURNED | CONFUSED }, { active: DRA }], {}, ['30th-046']);
  g.state.forcedCoins = [true]; // the Confusion flip to attack
  choose(g, 'Attack: Get Some Air');
  const me = g.state.p[0].active!;
  assert.equal(me.cond, 0);
  assert.equal(me.damage, 0, 'no Poison or Burn counters at Checkup either');
});

test('Pikachu (30th-046), Smash Kick: 20 damage', () => {
  const g = game([{ active: 'Pikachu', energy: { active: [W, W] } }, { active: DRA }], {}, ['30th-046']);
  choose(g, 'Attack: Smash Kick');
  assert.equal(dmg(g, 1), 20);
});

// ------------------------------------------------------------------ Pikachu 30th-048

test('Pikachu (30th-048), Store Up: put up to 2 Basic Energy cards from your discard pile into your hand', () => {
  const g = game([{ active: 'Pikachu', energy: { active: [W] }, discard: [R, W, L, TPE, 'Ultra Ball'] }, { active: DRA }], {}, ['30th-048']);
  choose(g, 'Attack: Store Up');
  assert.ok(!has(g, TPE) && !has(g, 'Ultra Ball'), `only Basic Energy is offered: ${labels(g).join(' | ')}`);
  pick(g, [R, W]);
  assert.deepEqual(namesOf(g, g.state.p[0].hand), [R, W].sort());
  assert.deepEqual(namesOf(g, g.state.p[0].discard), [L, TPE, 'Ultra Ball'].sort());
});

test('Pikachu (30th-048), Store Up: "up to" on an attack allows 1 or none', () => {
  const one = game([{ active: 'Pikachu', energy: { active: [W] }, discard: [R, W, L] }, { active: DRA }], {}, ['30th-048']);
  choose(one, 'Attack: Store Up');
  pick(one, [L]);
  assert.deepEqual(namesOf(one, one.state.p[0].hand), [L]);
  const none = game([{ active: 'Pikachu', energy: { active: [W] }, discard: [R, W, L] }, { active: DRA }], {}, ['30th-048']);
  choose(none, 'Attack: Store Up');
  pick(none, []);
  assert.equal(none.state.p[0].hand.length, 0);
  assert.equal(none.state.p[0].discard.length, 3);
  const empty = game([{ active: 'Pikachu', energy: { active: [W] }, discard: ['Ultra Ball'] }, { active: DRA }], {}, ['30th-048']);
  assert.ok(has(empty, 'Attack: Store Up'), 'the attack can be used with no Basic Energy in the discard pile');
});

// ------------------------------------------------------------------ Pikachu 30th-049

test('Pikachu (30th-049), Fighting Lightning: 80 more damage if the opponent\'s Active Pokémon is a Pokémon ex', () => {
  const ex = game([{ active: 'Pikachu', energy: { active: [L, W, W] } }, { active: 'Fezandipiti ex' }], {}, ['30th-049']);
  choose(ex, 'Attack: Fighting Lightning');
  assert.equal(dmg(ex, 1), 100);
  const plain = game([{ active: 'Pikachu', energy: { active: [L, W, W] } }, { active: 'Snorlax' }], {}, ['30th-049']);
  choose(plain, 'Attack: Fighting Lightning');
  assert.equal(dmg(plain, 1), 20);
  const benched = game([{ active: 'Pikachu', energy: { active: [L, W, W] } }, { active: 'Snorlax', bench: ['Fezandipiti ex'] }], {}, ['30th-049']);
  choose(benched, 'Attack: Fighting Lightning');
  assert.equal(dmg(benched, 1), 20, 'only the Active Pokémon counts');
});

// ------------------------------------------------------------------ Pikachu 30th-051

test("Pikachu (30th-051), Lightning Crash: discard all {L} Energy from this Pokémon; 90 damage to 1 of your opponent's Pokémon (Benched: no Weakness)", () => {
  const g = game([{ active: 'Pikachu', energy: { active: [L, L, L, W] } }, { active: 'Snorlax', bench: ['Articuno', 'Fezandipiti ex'] }], {}, ['30th-051']);
  choose(g, 'Attack: Lightning Crash');
  pick(g, ['Articuno']);
  assert.deepEqual(namesOf(g, g.state.p[0].active!.energy), [W], 'only the {L} Energy is discarded');
  assert.equal(g.state.p[1].bench[0]!.damage, 90, 'Articuno is weak to {L}, but not on the Bench');
  assert.equal(g.state.p[1].bench[1]!.damage, 0);
  assert.equal(dmg(g, 1), 0);
  assert.equal(g.state.p[0].discard.filter((c) => nameOf(g, c) === L).length, 3);
});

test('Pikachu (30th-051), Lightning Crash: the Active Pokémon can be the target', () => {
  const g = game([{ active: 'Pikachu', energy: { active: [L, L, L] } }, { active: 'Snorlax', bench: ['Marill'] }], {}, ['30th-051']);
  choose(g, 'Attack: Lightning Crash');
  pick(g, ['Snorlax']);
  assert.equal(dmg(g, 1), 90);
  assert.equal(g.state.p[0].active!.energy.length, 0);
});

// ------------------------------------------------------------------ Pikachu ex

test('Pikachu ex, Pika-Pika Parade: search your deck for any number of Basic Pokémon and put them onto your Bench', () => {
  const g = game([{ active: 'Pikachu ex', energy: { active: [W] }, bench: ['Marill', 'Eevee', 'Litwick'] }, { active: DRA }], { events: true });
  choose(g, 'Attack: Pika-Pika Parade');
  assert.ok(!has(g, 'Lampent') && !has(g, 'Drakloak') && !has(g, 'Ultra Ball'), `only Basic Pokémon: ${labels(g).join(' | ')}`);
  pick(g, ['Dreepy', 'Moltres']);
  assert.deepEqual(namesOf(g, g.state.p[0].bench.map((s) => s.cards[0] as number)), ['Dreepy', 'Eevee', 'Litwick', 'Marill', 'Moltres']);
  assert.ok(g.events.some((e) => e.type === 'shuffle'));
});

test('Pikachu ex, Pika-Pika Parade: "any number" includes none, and is limited by the open Bench spaces', () => {
  const none = game([{ active: 'Pikachu ex', energy: { active: [W] } }, { active: DRA }], { events: true });
  choose(none, 'Attack: Pika-Pika Parade');
  pick(none, []);
  assert.equal(none.state.p[0].bench.length, 0);
  assert.ok(none.events.some((e) => e.type === 'shuffle'), 'the deck is shuffled anyway');
  const full = game([{ active: 'Pikachu ex', energy: { active: [W] } }, { active: DRA }]);
  choose(full, 'Attack: Pika-Pika Parade');
  pick(full, ['Dreepy', 'Moltres', 'Articuno', 'Koraidon', 'Eevee']);
  assert.equal(full.state.p[0].bench.length, 5);
  const crowded = game([{ active: 'Pikachu ex', energy: { active: [W] }, bench: ['Marill', 'Eevee', 'Litwick', 'Cosmog', 'Shuppet'] }, { active: DRA }]);
  choose(crowded, 'Attack: Pika-Pika Parade');
  assert.equal(crowded.state.p[0].bench.length, 5, 'a full Bench: nothing can be put onto it');
  assert.ok(crowded.state.p[0].deck.length > 0);
});

test('Pikachu ex, Thunderbolt: 200 damage, then discard all Energy from this Pokémon (Special Energy too)', () => {
  const g = game([{ active: 'Pikachu ex', energy: { active: [L, L, W, TPE] } }, { active: DRA }]);
  choose(g, 'Attack: Thunderbolt');
  assert.equal(dmg(g, 1), 200);
  assert.equal(g.state.p[0].active!.energy.length, 0);
  assert.deepEqual(namesOf(g, g.state.p[0].discard), [L, L, TPE, W].sort());
});

// ------------------------------------------------------------------ Zapdos

const ZAPDOS_SIDE = (hand: string[], bench: string[]): SideLayout => ({ active: 'Zapdos', energy: { active: [W] }, bench, hand });

test('Zapdos, Flash-Pop Flapping: with Moltres and Articuno in play, attach a Basic Lightning Energy card from your hand to this Pokémon', () => {
  const g = game([ZAPDOS_SIDE([L, R], ['Moltres', 'Articuno']), { active: DRA }]);
  choose(g, 'Use Flash-Pop Flapping');
  assert.deepEqual(namesOf(g, g.state.p[0].active!.energy), [L, W].sort());
  assert.deepEqual(namesOf(g, g.state.p[0].hand), [R]);
  assert.ok(!has(g, 'Use Flash-Pop Flapping'), 'once during your turn');
});

test('Zapdos, Flash-Pop Flapping: needs both Moltres and Articuno in play, and a Basic Lightning Energy in hand', () => {
  assert.ok(!has(game([ZAPDOS_SIDE([L], ['Moltres']), { active: DRA }]), 'Use Flash-Pop Flapping'), 'no Articuno');
  assert.ok(!has(game([ZAPDOS_SIDE([L], ['Articuno']), { active: DRA }]), 'Use Flash-Pop Flapping'), 'no Moltres');
  assert.ok(!has(game([ZAPDOS_SIDE([L], ['Marill']), { active: DRA, bench: ['Moltres', 'Articuno'] }]), 'Use Flash-Pop Flapping'), "the opponent's Pokémon don't count");
  assert.ok(!has(game([ZAPDOS_SIDE([R, TPE], ['Moltres', 'Articuno']), { active: DRA }]), 'Use Flash-Pop Flapping'), 'no Basic Lightning Energy card in hand');
  assert.ok(has(game([ZAPDOS_SIDE([L], ['Moltres', 'Articuno']), { active: DRA }]), 'Use Flash-Pop Flapping'));
});

test('Zapdos, Thundering Lightning: 210 damage, and this Pokémon also does 60 damage to itself', () => {
  const g = game([{ active: 'Zapdos', energy: { active: [L, L, L, W] } }, { active: DRA }]);
  choose(g, 'Attack: Thundering Lightning');
  assert.equal(dmg(g, 1), 210);
  assert.equal(dmg(g, 0), 60);
});

// ------------------------------------------------------------------ Zekrom

test('Zekrom, Nitro Thunder: 80 more damage if this Pokémon has any {R} Energy attached', () => {
  const fire = game([{ active: 'Zekrom', energy: { active: [L, R, W] } }, { active: DRA }]);
  choose(fire, 'Attack: Nitro Thunder');
  assert.equal(dmg(fire, 1), 160);
  const two = game([{ active: 'Zekrom', energy: { active: [L, R, R] } }, { active: DRA }]);
  choose(two, 'Attack: Nitro Thunder');
  assert.equal(dmg(two, 1), 160, 'a flat +80');
  const none = game([{ active: 'Zekrom', energy: { active: [L, L, L] } }, { active: DRA }]);
  choose(none, 'Attack: Nitro Thunder');
  assert.equal(dmg(none, 1), 80);
});

// ------------------------------------------------------------------ Zeraora

test('Zeraora, Rapid Draw: 20 damage and draw a card', () => {
  const g = game([{ active: 'Zeraora', energy: { active: [W] }, hand: [R] }, { active: DRA }]);
  choose(g, 'Attack: Rapid Draw');
  assert.equal(dmg(g, 1), 20);
  assert.equal(g.state.p[0].hand.length, 2);
});

test("Zeraora, Electrobullet: 50 damage, and 20 damage to 1 of your opponent's Benched Pokémon (no Weakness on the Bench)", () => {
  const g = game([{ active: 'Zeraora', energy: { active: [L, W] } }, { active: DRA, bench: ['Marill', 'Articuno'] }]);
  choose(g, 'Attack: Electrobullet');
  pick(g, ['Articuno']);
  assert.equal(dmg(g, 1), 50);
  assert.equal(g.state.p[1].bench[1]!.damage, 20, 'Articuno is weak to {L} x2, but Weakness is not applied on the Bench');
  assert.equal(g.state.p[1].bench[0]!.damage, 0);
});

test('Zeraora, Electrobullet: with no Benched Pokémon only the 50 damage is done', () => {
  const g = game([{ active: 'Zeraora', energy: { active: [L, W] } }, { active: DRA }]);
  choose(g, 'Attack: Electrobullet');
  assert.equal(dmg(g, 1), 50);
});

// ------------------------------------------------------------------ Morpeko

test('Morpeko, Select a Snack: discard the top 3 cards of your deck and put 1 of them into your hand', () => {
  const g = game([{ active: 'Morpeko', energy: { active: [W] }, discard: [G], deckTop: ['Ultra Ball', 'Marill', R] }, { active: DRA }]);
  const before = g.state.p[0].deck.length;
  choose(g, 'Attack: Select a Snack');
  assert.equal(labels(g).length, 3, `only the 3 discarded cards are offered: ${labels(g).join(' | ')}`);
  assert.ok(!has(g, G));
  pick(g, ['Marill']);
  assert.equal(g.state.p[0].deck.length, before - 3);
  assert.deepEqual(namesOf(g, g.state.p[0].hand), ['Marill']);
  assert.deepEqual(namesOf(g, g.state.p[0].discard), [G, R, 'Ultra Ball'].sort());
});

test('Morpeko, Select a Snack: a deck of fewer cards discards what is there; an empty deck does nothing', () => {
  const one = game([{ active: 'Morpeko', energy: { active: [W] }, deckTop: ['Ultra Ball'] }, { active: DRA }]);
  const d = one.state.p[0].deck;
  d.splice(0, d.length - 1);
  one.state.p[0].knownTop = 1;
  choose(one, 'Attack: Select a Snack');
  assert.deepEqual(namesOf(one, one.state.p[0].hand), ['Ultra Ball'], 'one card: no choice to make');
  assert.equal(one.state.p[0].deck.length, 0);
  assert.equal(one.state.p[0].discard.length, 0);
  const none = game([{ active: 'Morpeko', energy: { active: [W] }, emptyDeck: true, discard: [G] }, { active: DRA }]);
  none.state.p[0].discard.splice(0); // nothing anywhere but the Prize cards
  choose(none, 'Attack: Select a Snack');
  assert.equal(none.state.p[0].hand.length, 0);
});

test('Morpeko, Slap: 30 damage', () => {
  const g = game([{ active: 'Morpeko', energy: { active: [L] } }, { active: DRA }]);
  choose(g, 'Attack: Slap');
  assert.equal(dmg(g, 1), 30);
});

// ------------------------------------------------------------------ Miraidon

test('Miraidon, Electro Drift: 140 damage, then discard 2 {L} Energy from this Pokémon', () => {
  const two = game([{ active: 'Miraidon', energy: { active: [L, L, W] } }, { active: DRA }]);
  choose(two, 'Attack: Electro Drift');
  assert.equal(dmg(two, 1), 140);
  assert.deepEqual(namesOf(two, two.state.p[0].active!.energy), [W]);
  const three = game([{ active: 'Miraidon', energy: { active: [L, L, L, W] } }, { active: DRA }]);
  choose(three, 'Attack: Electro Drift');
  pick(three, [L, L]);
  assert.deepEqual(namesOf(three, three.state.p[0].active!.energy), [L, W].sort());
});

// ------------------------------------------------------------------ Mewtwo

test('Mewtwo, Empower: attach up to 2 Basic Energy cards from your discard pile to 1 of your Pokémon', () => {
  const g = game([{ active: 'Mewtwo', energy: { active: [P] }, bench: ['Marill'], discard: [R, W, L, TPE, 'Ultra Ball'] }, { active: DRA }]);
  choose(g, 'Attack: Empower');
  pick(g, ['Marill']);
  assert.ok(!has(g, TPE) && !has(g, 'Ultra Ball'), `only Basic Energy: ${labels(g).join(' | ')}`);
  pick(g, [R, W]);
  assert.deepEqual(namesOf(g, g.state.p[0].bench[0]!.energy), [R, W].sort());
  assert.deepEqual(namesOf(g, g.state.p[0].discard), [L, TPE, 'Ultra Ball'].sort());
  assert.deepEqual(namesOf(g, g.state.p[0].active!.energy), [P]);
});

test('Mewtwo, Empower: the Active Pokémon can be the one; "up to" allows 1 or none', () => {
  const one = game([{ active: 'Mewtwo', energy: { active: [P] }, bench: ['Marill'], discard: [R, W] }, { active: DRA }]);
  choose(one, 'Attack: Empower');
  pick(one, ['Mewtwo']);
  pick(one, [R]);
  assert.deepEqual(namesOf(one, one.state.p[0].active!.energy), [P, R].sort());
  const none = game([{ active: 'Mewtwo', energy: { active: [P] }, discard: [R, W] }, { active: DRA }]);
  choose(none, 'Attack: Empower');
  pick(none, []);
  assert.equal(none.state.p[0].active!.energy.length, 1);
  assert.equal(none.state.p[0].discard.length, 2);
});

test('Mewtwo, Psydrive: 120 damage, then discard an Energy from this Pokémon', () => {
  const g = game([{ active: 'Mewtwo', energy: { active: [P, P, R] } }, { active: DRA }]);
  choose(g, 'Attack: Psydrive');
  assert.equal(dmg(g, 1), 120);
  pick(g, [R]);
  assert.deepEqual(namesOf(g, g.state.p[0].active!.energy), [P, P]);
  assert.deepEqual(namesOf(g, g.state.p[0].discard), [R]);
});

// ------------------------------------------------------------------ Mewtwo ex

test("Mewtwo ex, Photon Bullets: 50 damage to each of your opponent's Pokémon ex (Weakness only on the Active Pokémon)", () => {
  const g = game([{ active: 'Mewtwo ex', energy: { active: [P, P] } }, { active: 'Koraidon ex', bench: ['Koraidon ex', 'Latias ex', 'Marill'] }]);
  choose(g, 'Attack: Photon Bullets');
  assert.equal(dmg(g, 1), 100, 'the Active Koraidon ex is weak to {P}: 50 x 2');
  assert.equal(g.state.p[1].bench[0]!.damage, 50, 'no Weakness on the Bench');
  assert.equal(g.state.p[1].bench[1]!.damage, 50);
  assert.equal(g.state.p[1].bench[2]!.damage, 0, 'a Pokémon that is not an ex is not hurt');
});

test('Mewtwo ex, Photon Bullets: a Pokémon that is not an ex in the Active Spot is not hurt either', () => {
  const g = game([{ active: 'Mewtwo ex', energy: { active: [P, P] } }, { active: 'Snorlax', bench: ['Latias ex'] }]);
  choose(g, 'Attack: Photon Bullets');
  assert.equal(dmg(g, 1), 0);
  assert.equal(g.state.p[1].bench[0]!.damage, 50);
});

test("Mewtwo ex, Psychic Powers: 230 damage; during your next turn, this Pokémon can't use attacks", () => {
  const g = game([{ active: 'Mewtwo ex', energy: { active: [P, P, P] } }, FOE()]);
  choose(g, 'Attack: Psychic Powers');
  assert.equal(dmg(g, 1), 230);
  choose(g, 'Attack: Jet Headbutt');
  assert.ok(!has(g, 'Attack:'), "Mewtwo ex can't attack during my next turn");
  choose(g, 'End turn');
  choose(g, 'Attack: Jet Headbutt');
  assert.ok(has(g, 'Attack: Psychic Powers'), 'it can attack again the turn after');
});

// ------------------------------------------------------------------ Azumarill

test('Azumarill, Body Slam: 90 damage, and on heads the opponent\'s Active Pokémon is now Paralyzed', () => {
  const heads = game([{ active: 'Azumarill', energy: { active: [P, P, W] } }, { active: DRA }]);
  heads.state.forcedCoins = [true];
  choose(heads, 'Attack: Body Slam');
  assert.equal(dmg(heads, 1), 90);
  assert.ok(heads.state.p[1].active!.cond & PARALYZED, 'heads: Paralyzed');
  const tails = game([{ active: 'Azumarill', energy: { active: [P, P, W] } }, { active: DRA }]);
  tails.state.forcedCoins = [false];
  choose(tails, 'Attack: Body Slam');
  assert.equal(dmg(tails, 1), 90);
  assert.equal(tails.state.p[1].active!.cond & PARALYZED, 0, 'tails: nothing');
});

// ------------------------------------------------------------------ Espeon

test("Espeon, Miraculous Shine: devolve each of your opponent's evolved Pokémon, putting the highest Stage Evolution card on it into their hand", () => {
  const g = game([
    { active: 'Espeon', energy: { active: [P, W] } },
    { active: 'Dreepy', evolve: { active: ['Drakloak', DRA], 0: ['Lampent'], 2: ['Banette'] }, damage: { active: 30 }, cond: BURNED, bench: ['Litwick', 'Marill', 'Shuppet'] },
  ]);
  const opp = g.state.p[1];
  choose(g, 'Attack: Miraculous Shine');
  assert.equal(nameOf(g, opp.active!.cards.at(-1) as number), 'Drakloak', 'Dragapult ex devolved to Drakloak');
  assert.equal(opp.active!.cards.length, 2);
  assert.equal(opp.active!.damage, 30, 'the damage stays');
  assert.equal(opp.active!.cond, 0, 'it recovers from Special Conditions, as when it evolves');
  assert.equal(nameOf(g, opp.bench[0]!.cards.at(-1) as number), 'Litwick', 'Lampent devolved to Litwick');
  assert.equal(nameOf(g, opp.bench[1]!.cards.at(-1) as number), 'Marill', 'a Basic Pokémon is left alone');
  assert.equal(nameOf(g, opp.bench[2]!.cards.at(-1) as number), 'Banette', "Hide 'n' Sneak: an effect of an attack is prevented");
  const hand = namesOf(g, opp.hand);
  assert.equal(hand.filter((n) => n === DRA).length, 1);
  assert.equal(hand.filter((n) => n === 'Lampent').length, 1);
  assert.equal(hand.filter((n) => n === 'Banette').length, 0);
});

test('Espeon, Miraculous Shine: with no evolved Pokémon nothing happens', () => {
  const g = game([{ active: 'Espeon', energy: { active: [P, W] } }, { active: 'Snorlax', bench: ['Marill'] }]);
  const hand = g.state.p[1].hand.length;
  choose(g, 'Attack: Miraculous Shine');
  assert.equal(g.state.p[1].hand.length, hand + 1, "only the opponent's draw for the turn");
  assert.equal(g.state.p[1].active!.cards.length, 1);
  assert.equal(g.state.p[1].bench.length, 1);
});

test('Espeon, Miraculous Shine: a Pokémon whose damage reaches its lower HP once devolved is Knocked Out (Drakloak has 90 HP)', () => {
  const g = game([{ active: 'Espeon', energy: { active: [P, W] } }, { active: 'Dreepy', evolve: { active: ['Drakloak', DRA] }, damage: { active: 100 }, bench: ['Marill'] }]);
  choose(g, 'Attack: Miraculous Shine');
  assert.equal(g.state.p[0].prizesTaken, 1, 'the devolved Drakloak is Knocked Out and its Prize card is taken');
  assert.ok(namesOf(g, g.state.p[1].hand).includes(DRA));
});

// ------------------------------------------------------------------ Sylveon ex

test('Sylveon ex, Colorful Harmony: 50 damage for each type of Basic Energy attached to all of your Pokémon', () => {
  const four = game([{ active: 'Sylveon ex', energy: { active: [P, W, W], 0: [R, G] }, bench: ['Marill'] }, { active: DRA }]);
  choose(four, 'Attack: Colorful Harmony');
  assert.equal(dmg(four, 1), 200, 'Psychic, Water, Fire, Grass');
  const one = game([{ active: 'Sylveon ex', energy: { active: [P, P, P] } }, { active: DRA, energy: { active: [G, R] } }]);
  choose(one, 'Attack: Colorful Harmony');
  assert.equal(dmg(one, 1), 50, "one type; the opponent's Energy doesn't count");
});

test('Sylveon ex, Colorful Harmony: Special Energy has no Basic type to count', () => {
  const g = game([{ active: 'Sylveon ex', energy: { active: [TPE, W, W], 0: [TPE] }, bench: ['Marill'] }, { active: DRA }]);
  choose(g, 'Attack: Colorful Harmony');
  assert.equal(dmg(g, 1), 50, 'only Water is a type of Basic Energy here');
  const none = game([{ active: 'Sylveon ex', energy: { active: [TPE, TPE, TPE] } }, { active: DRA }]);
  choose(none, 'Attack: Colorful Harmony');
  assert.equal(dmg(none, 1), 0, 'no Basic Energy at all: 0 damage');
});

// ------------------------------------------------------------------ Unown

test('Unown, Mysterious Signal: 40 damage; if the opponent\'s Pokémon is Knocked Out by it, take 1 more Prize card', () => {
  const ko = game([{ active: 'Unown', energy: { active: [P, P] } }, { active: 'Marill', damage: { active: 30 }, bench: ['Eevee'] }]);
  choose(ko, 'Attack: Mysterious Signal');
  assert.equal(ko.state.p[0].prizesTaken, 2, '1 Prize card and 1 more');
  assert.equal(ko.state.p[0].prizes.length, 4);
  const survive = game([{ active: 'Unown', energy: { active: [P, P] } }, { active: 'Marill', damage: { active: 20 }, bench: ['Eevee'] }]);
  choose(survive, 'Attack: Mysterious Signal');
  assert.equal(dmg(survive, 1), 60);
  assert.equal(survive.state.p[0].prizesTaken, 0);
});

test('Unown, Mysterious Signal: the extra Prize card is for this attack only (a Knock Out on a later turn takes just 1)', () => {
  const g = game([{ active: 'Unown', energy: { active: [P, P] } }, { active: 'Snorlax', damage: { active: 100 }, bench: ['Eevee'] }]);
  choose(g, 'Attack: Mysterious Signal');
  assert.equal(g.state.p[0].prizesTaken, 0, '140 of 160: not Knocked Out');
  assert.equal(dmg(g, 1), 140);
});

test("Unown, Mysterious Signal borrowed by Mew ex (Memory Helix): \"by damage from this attack\" is the attack, not the card: the extra Prize card still comes", () => {
  const mew = '30th-066';
  const ko = game([{ active: 'Mew ex', energy: { active: [P, P] }, bench: ['Unown'] }, { active: 'Marill', damage: { active: 30 }, bench: ['Eevee'] }], {}, [mew]);
  choose(ko, 'Attack: Mysterious Signal');
  assert.equal(ko.state.p[0].prizesTaken, 2, "Mew ex's borrowed attack Knocked Out the Pokémon: 1 Prize card and 1 more");
  const survive = game([{ active: 'Mew ex', energy: { active: [P, P] }, bench: ['Unown'] }, { active: 'Marill', damage: { active: 20 }, bench: ['Eevee'] }], {}, [mew]);
  choose(survive, 'Attack: Mysterious Signal');
  assert.equal(dmg(survive, 1), 60);
  assert.equal(survive.state.p[0].prizesTaken, 0, 'nothing was Knocked Out: no Prize cards');
  // Mew ex using one of its own attacks the same turn-state gets no extra Prize card (the effect belongs to the borrowed attack only).
  const other = game([{ active: 'Mew ex', energy: { active: [P] } }, { active: 'Marill', damage: { active: 50 }, bench: ['Eevee'] }], {}, [mew]);
  other.state.effects.push({ static: { k: 'extraPrize', amount: 1, thisAttack: true }, slot: -1, player: 0, until: other.state.turn, fromAttack: true, src: 0, atk: { by: other.state.p[0].active!.id, use: 7 } });
  choose(other, 'Attack: Teleportation Burst');
  assert.equal(other.state.p[0].prizesTaken, 1, 'a "this attack" effect from some other attack does not apply to this one');
  // Unown itself still gets it.
  const own = game([{ active: 'Unown', energy: { active: [P, P] } }, { active: 'Marill', damage: { active: 30 }, bench: ['Eevee'] }]);
  choose(own, 'Attack: Mysterious Signal');
  assert.equal(own.state.p[0].prizesTaken, 2);
});

// ------------------------------------------------------------------ Chandelure

test("Chandelure, Eerie Glow: 130 damage; your opponent's Active Pokémon is now Burned and Confused", () => {
  const g = game([{ active: 'Chandelure', energy: { active: [P, P] } }, { active: DRA }]);
  g.state.forcedCoins = [false]; // the Burn flip at Checkup: tails, it stays Burned
  choose(g, 'Attack: Eerie Glow');
  const foe = g.state.p[1].active!;
  assert.ok(foe.cond & BURNED, 'Burned');
  assert.ok(foe.cond & CONFUSED, 'Confused');
  assert.equal(foe.damage, 150, '130, and 2 damage counters from the Burn at Checkup');
});

// ------------------------------------------------------------------ Xerneas

test('Xerneas, Geonavigation: search your deck for up to 2 Stadium cards, reveal them, and put them into your hand', () => {
  const g = game([{ active: 'Xerneas', energy: { active: [W] } }, { active: DRA }], { events: true });
  choose(g, 'Attack: Geonavigation');
  assert.ok(!has(g, 'Ultra Ball') && !has(g, 'Marill'), `only Stadium cards: ${labels(g).join(' | ')}`);
  pick(g, ['Lively Stadium', 'Neutralization Zone']);
  assert.deepEqual(namesOf(g, g.state.p[0].hand), ['Lively Stadium', 'Neutralization Zone']);
  assert.ok(g.events.some((e) => e.type === 'shuffle'));
});

test('Xerneas, Geonavigation: "up to 2" allows 1 or none', () => {
  const one = game([{ active: 'Xerneas', energy: { active: [W] } }, { active: DRA }]);
  choose(one, 'Attack: Geonavigation');
  pick(one, ['Neutralization Zone']);
  assert.deepEqual(namesOf(one, one.state.p[0].hand), ['Neutralization Zone']);
  const none = game([{ active: 'Xerneas', energy: { active: [W] } }, { active: DRA }]);
  choose(none, 'Attack: Geonavigation');
  pick(none, []);
  assert.equal(none.state.p[0].hand.length, 0);
});

// ------------------------------------------------------------------ Comfey

test('Comfey, Comforting Aroma: heal 80 damage from 1 of your Benched Pokémon', () => {
  const g = game([{ active: 'Comfey', energy: { active: [W] }, bench: ['Marill', 'Moltres'], damage: { active: 30, 0: 50, 1: 100 } }, { active: DRA }]);
  choose(g, 'Attack: Comforting Aroma');
  pick(g, ['Moltres']);
  assert.equal(g.state.p[0].bench[1]!.damage, 20);
  assert.equal(g.state.p[0].bench[0]!.damage, 50);
  assert.equal(dmg(g, 0), 30, 'the Active Pokémon is not healed');
});

test('Comfey, Comforting Aroma: it heals no more than the damage there is', () => {
  const g = game([{ active: 'Comfey', energy: { active: [W] }, bench: ['Marill'], damage: { 0: 50 } }, { active: DRA }]);
  choose(g, 'Attack: Comforting Aroma');
  assert.equal(g.state.p[0].bench[0]!.damage, 0);
});

// ------------------------------------------------------------------ Cosmoem

test('Cosmoem, Stiffen: during your opponent\'s next turn this Pokémon takes 60 less damage from attacks', () => {
  const g = game([{ active: 'Cosmoem', energy: { active: [W, W] } }, FOE()]);
  choose(g, 'Attack: Stiffen');
  choose(g, 'Attack: Jet Headbutt');
  assert.equal(dmg(g, 0), 10, '70 - 60');
  choose(g, 'End turn');
  choose(g, 'Attack: Jet Headbutt');
  assert.equal(dmg(g, 0), 80, 'the turn after, the full 70');
});

// ------------------------------------------------------------------ Lunala

test('Lunala, Midnight Ray: 20 more damage for each Energy card in your discard pile', () => {
  const three = game([{ active: 'Lunala', energy: { active: [P] }, discard: [R, W, TPE, 'Ultra Ball'] }, { active: DRA }]);
  choose(three, 'Attack: Midnight Ray');
  assert.equal(dmg(three, 1), 80, 'Basic and Special Energy count, an Item does not');
  const none = game([{ active: 'Lunala', energy: { active: [P] }, discard: ['Ultra Ball'] }, { active: DRA }]);
  choose(none, 'Attack: Midnight Ray');
  assert.equal(dmg(none, 1), 20);
});

// ------------------------------------------------------------------ Gimmighoul

test('Gimmighoul, Strolls So Much: on heads, search your deck for a card and put it into your hand, then shuffle', () => {
  const heads = game([{ active: 'Gimmighoul', energy: { active: [W] } }, { active: DRA }], { events: true });
  heads.state.forcedCoins = [true];
  choose(heads, 'Attack: Strolls So Much');
  pick(heads, ['Rare Candy']);
  assert.deepEqual(namesOf(heads, heads.state.p[0].hand), ['Rare Candy']);
  assert.ok(heads.events.some((e) => e.type === 'shuffle'));
  const tails = game([{ active: 'Gimmighoul', energy: { active: [W] } }, { active: DRA }], { events: true });
  tails.state.forcedCoins = [false];
  choose(tails, 'Attack: Strolls So Much');
  assert.equal(tails.state.p[0].hand.length, 0);
  assert.ok(!tails.events.some((e) => e.type === 'shuffle'));
});

// ------------------------------------------------------------------ evolution lines (the catalog lists no "evolves from")

test('The evolutions in this batch evolve from the Pokémon they name (Marill, Eevee, Lampent, Cosmog, Cosmoem)', () => {
  const lines: [string, string][] = [
    ['Marill', 'Azumarill'],
    ['Eevee', 'Espeon'],
    ['Lampent', 'Chandelure'],
    ['Cosmog', 'Cosmoem'],
    ['Cosmoem', 'Lunala'],
  ];
  for (const [from, to] of lines) {
    const g = game([{ active: from, hand: [to] }, { active: DRA }]);
    assert.ok(has(g, `into ${to}`), `${from} -> ${to}: ${labels(g).join(' | ')}`);
    const wrong = game([{ active: 'Snorlax', hand: [to] }, { active: DRA }]);
    assert.ok(!has(wrong, `into ${to}`), `${to} does not evolve from Snorlax`);
  }
});
