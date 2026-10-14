/**
 * Card tests, batch "std-c27": every card scripted in cards/scripts/std-c27.ts does what its printed text says in a
 * constructed position, and every TPCi ruling cited in the script is pinned here. Quotes are the printed text from frames.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { def } from '../context.js';
import { describeOptions } from '../describe.js';
import type { Game } from '../game.js';
import { advance } from '../flow.js';
import { scenario, type SideLayout } from '../scenario.js';
import { CONFUSED, POISONED, type Decision } from '../types.js';
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
function yes(g: Game): void {
  assert.equal(g.decision?.kind, 'yesno');
  g.submit([0]);
}
const nameOf = (g: Game, card: number): string => def(g.ctx, card).name;
const namesOf = (g: Game, cards: number[]): string[] => cards.map((c) => nameOf(g, c)).sort();
const dmg = (g: Game, p: 0 | 1): number => g.state.p[p].active!.damage;
/** Take the named card out of a player's deck and put it into the stadium slot. */
function setStadium(g: Game, owner: 0 | 1, name: string): void {
  const deckCards = g.state.p[owner].deck;
  const i = deckCards.findIndex((c) => nameOf(g, c) === name);
  assert.ok(i >= 0, `no ${name} in the deck`);
  g.state.stadium = { card: deckCards.splice(i, 1)[0]!, owner };
  g.state.pending = null; // re-offer the main decision with the Stadium in play
  advance(g.envForInternals, g.state);
}
/** Put the named cards (from the deck) at the bottom of a player's deck: names[0] is the very bottom card. */
function setBottom(g: Game, p: 0 | 1, names: string[]): number[] {
  const d = g.state.p[p].deck;
  const cards = names.map((n) => {
    const i = d.findIndex((c) => nameOf(g, c) === n);
    assert.ok(i >= 0, `no ${n} in the deck`);
    return d.splice(i, 1)[0]!;
  });
  d.unshift(...cards);
  return cards;
}

const ENERGY: [string, number][] = ['mee-001', 'mee-002', 'mee-003', 'mee-004', 'mee-005', 'mee-006', 'mee-007', 'mee-008'].map((id) => [id, 10]);
const IDS: Record<string, string> = {
  Oranguru: 'sv08-156',
  Tandemaus: 'sv08-157',
  Maushold: 'sv08-158',
  'Cyclizar ex': 'sv08-159',
  'Flamigo ex': 'sv08-160',
  'Amulet of Hope': 'sv08-162',
  'Brilliant Blender': 'sv08-164',
  'Call Bell': 'sv08-165',
  'Chill Teaser Toy': 'sv08-166',
  "Clemont's Quick Wit": 'sv08-167',
  'Deduction Kit': 'sv08-171',
  'Dragon Elixir': 'sv08-172',
  Drasna: 'sv08-173',
  Drayton: 'sv08-174',
  'Dusk Ball': 'sv08-175',
  'Energy Search Pro': 'sv08-176',
  "Jasmine's Gaze": 'sv08-178',
  "Lisia's Appeal": 'sv08-179',
  'Meddling Memo': 'sv08-181',
  'Megaton Blower': 'sv08-182',
  'Miracle Headset': 'sv08-183',
  'Scramble Switch': 'sv08-186',
  'Dragapult ex': 'sv06-130',
  Slowpoke: 'me05-029',
  Rellor: 'sv08-013',
  'Tapu Koko': 'me02.5-067',
  Pikachu: 'sv05-051',
  'Tapu Koko ex': 'sv09-051',
  Switch: 'me01-130',
  'Air Balloon': 'sv10.5b-079',
  'Legacy Energy': 'sv06-167',
  'Battle Cage': 'me02-085',
  "Boss's Orders": 'me01-114',
  "Lillie's Determination": 'me01-119',
};
/** A test deck of the named cards (4 of each) plus plenty of every basic Energy. */
function deck(...cards: string[]) {
  return fromIds('c27', [...[...new Set(cards)].map((n): [string, number] => [IDS[n] ?? n, 4]), ...ENERGY]);
}
const DRA = 'Dragapult ex'; // 320 HP, no Weakness or Resistance: a neutral target; Jet Headbutt {C} 70
const SLO = 'Slowpoke'; // Basic 70 HP; retreat 2
const REL = 'Rellor'; // Basic 40 HP
const G = 'Grass Energy';
const R = 'Fire Energy';
const W = 'Water Energy';
const L = 'Lightning Energy';
const P = 'Psychic Energy';
const FI = 'Fighting Energy';
const D = 'Darkness Energy';
const M = 'Metal Energy';
type Sides = [SideLayout, SideLayout];
const OPP_TURN = { current: 1 as const, turn: 4 };
const ALL = [
  'Oranguru', 'Tandemaus', 'Maushold', 'Cyclizar ex', 'Flamigo ex', 'Amulet of Hope', 'Brilliant Blender', 'Call Bell', 'Chill Teaser Toy',
  "Clemont's Quick Wit", 'Deduction Kit', 'Dragon Elixir', 'Drasna', 'Drayton', 'Dusk Ball', 'Energy Search Pro', "Jasmine's Gaze",
  "Lisia's Appeal", 'Meddling Memo', 'Megaton Blower', 'Miracle Headset', 'Scramble Switch', DRA, SLO, REL, 'Tapu Koko', 'Pikachu',
  'Tapu Koko ex', 'Switch', 'Air Balloon', 'Legacy Energy', 'Battle Cage', "Boss's Orders",
];
const DK = deck(...ALL);
const mk = (sides: Sides, o = {}): Game => scenario(DK, DK, sides, o);

// ------------------------------------------------------------------ Oranguru

test("Oranguru, Now You're in My Power: until the end of your next turn the Defending Pokémon's Weakness is {C} (a Pokémon with none gets x2, ruling 2057)", () => {
  // Baseline: Smack {C}{C}{C} 80 on a Pokémon with a {F} Weakness is not doubled.
  const base = mk([{ active: 'Oranguru', energy: { active: [W, W, W] } }, { active: 'Tapu Koko ex' }]);
  choose(base, 'Attack: Smack');
  assert.equal(dmg(base, 1), 80);

  const g = mk([{ active: 'Oranguru', energy: { active: [W, W, W] } }, { active: 'Tapu Koko ex' }]);
  choose(g, "Attack: Now You're in My Power");
  assert.equal(dmg(g, 1), 0, 'no damage of its own');
  choose(g, 'End turn');
  choose(g, 'Attack: Smack');
  assert.equal(dmg(g, 1), 160, 'the Weakness is now {C}: x2');

  // Ruling (TPCi Rules Team 2024-11-07, https://compendium.pokegym.net/ruling/2057/): a Pokémon without printed Weakness gains x2 Colorless Weakness.
  const none = mk([{ active: 'Oranguru', energy: { active: [W, W, W] } }, { active: DRA }]);
  choose(none, "Attack: Now You're in My Power");
  choose(none, 'End turn');
  choose(none, 'Attack: Smack');
  assert.equal(dmg(none, 1), 160, 'Dragapult ex has no Weakness: now x2 {C}');
  // "Until the end of your next turn": the turn after that, the Weakness is back.
  choose(none, 'End turn');
  choose(none, 'Attack: Smack');
  assert.equal(dmg(none, 1), 160 + 80);
});

test("Oranguru, Now You're in My Power: ruling 2056 — the Defending Pokémon becomes Weak only to {C} attackers, not to every type", () => {
  // Ruling (TPCi Rules Team 2024-11-07, https://compendium.pokegym.net/ruling/2056/): only Colorless-type Pokémon trigger the Weakness increase.
  const g = mk([{ active: 'Oranguru', bench: ['Tapu Koko'], hand: ['Switch'], energy: { active: [W, W, W], 0: [L, L, W] } }, { active: DRA }]);
  choose(g, "Attack: Now You're in My Power");
  choose(g, 'End turn');
  choose(g, 'Play Switch'); // still "your next turn"
  choose(g, 'Tapu Koko');
  choose(g, 'Attack: Thunder Blast');
  assert.equal(dmg(g, 1), 130, 'a {L} attacker is not doubled');
});

// ------------------------------------------------------------------ Maushold

test('Maushold, Familial March: search for up to 2 Maushold and put them onto your Bench, then shuffle', () => {
  const g = mk([{ active: 'Maushold', energy: { active: [W] } }, { active: DRA }], { events: true });
  choose(g, 'Attack: Familial March');
  assert.equal(g.decision?.kind, 'cards');
  assert.equal(g.decision?.min, 0, '"up to" on an attack is 0 to 2');
  assert.equal(g.decision?.max, 2);
  pick(g, ['Maushold', 'Maushold']);
  assert.deepEqual(namesOf(g, g.state.p[0].bench.map((b) => b.cards[0]!)), ['Maushold', 'Maushold']);
  assert.equal(g.state.p[0].deck.filter((c) => nameOf(g, c) === 'Maushold').length, 1, 'the third copy is still in the deck');
  const search = g.events.findIndex((e) => e.type === 'search');
  assert.ok(g.events.findIndex((e, i) => e.type === 'shuffle' && i > search && (e as { player: number }).player === 0) > search, 'then the deck is shuffled');
});

test('Maushold, Familial March: finds fewer (0 or 1) and is limited by Bench space', () => {
  const none = mk([{ active: 'Maushold', energy: { active: [W] } }, { active: DRA }]);
  choose(none, 'Attack: Familial March');
  none.submit([]);
  assert.equal(none.state.p[0].bench.length, 0);

  const one = mk([{ active: 'Maushold', energy: { active: [W] } }, { active: DRA }]);
  choose(one, 'Attack: Familial March');
  pick(one, ['Maushold']);
  assert.equal(one.state.p[0].bench.length, 1);

  const room = mk([{ active: 'Maushold', bench: ['Tandemaus', 'Tandemaus', 'Tandemaus', REL], energy: { active: [W] } }, { active: DRA }]);
  choose(room, 'Attack: Familial March');
  assert.equal(room.decision?.max, 1, 'one free Bench space');
  pick(room, ['Maushold']);
  assert.equal(room.state.p[0].bench.length, 5);

  const full = mk([{ active: 'Maushold', bench: ['Tandemaus', 'Tandemaus', 'Tandemaus', REL, SLO], energy: { active: [W] } }, { active: DRA }]);
  choose(full, 'Attack: Familial March');
  assert.notEqual(full.decision?.kind, 'cards', 'a full Bench: nothing to search for');
  assert.equal(full.state.p[0].bench.length, 5);
});

test('Maushold, Incessant Incisors: flip 4 coins, 30 damage for each heads', () => {
  for (const [coins, expected] of [
    [[true, true, false, true], 90],
    [[false, false, false, false], 0],
    [[true, true, true, true], 120],
  ] as [boolean[], number][]) {
    const g = mk([{ active: 'Maushold', energy: { active: [W] } }, { active: DRA }]);
    g.state.forcedCoins = coins;
    choose(g, 'Attack: Incessant Incisors');
    assert.equal(dmg(g, 1), expected);
  }
});

// ------------------------------------------------------------------ Cyclizar ex

test('Cyclizar ex, Break Through: 130, and also 30 to 1 of the opponent\'s Benched Pokémon (no Weakness or Resistance)', () => {
  const g = mk([{ active: 'Cyclizar ex', energy: { active: [W, W, W] } }, { active: DRA, bench: [SLO, REL] }]);
  choose(g, 'Attack: Break Through');
  choose(g, 'Rellor');
  assert.equal(dmg(g, 1), 130);
  assert.equal(g.state.p[1].bench.find((b) => nameOf(g, b.cards[0]!) === REL)!.damage, 30);
  assert.equal(g.state.p[1].bench.find((b) => nameOf(g, b.cards[0]!) === SLO)!.damage, 0);
});

test('Cyclizar ex, Zircon Road: 180, and you may draw 5 cards', () => {
  const yesG = mk([{ active: 'Cyclizar ex', energy: { active: [G, R, P] } }, { active: DRA }]);
  const before = yesG.state.p[0].hand.length;
  choose(yesG, 'Attack: Zircon Road');
  assert.equal(yesG.decision?.kind, 'yesno', '"you may draw 5 cards"');
  yes(yesG);
  assert.equal(dmg(yesG, 1), 180);
  assert.equal(yesG.state.p[0].hand.length, before + 5);

  const noG = mk([{ active: 'Cyclizar ex', energy: { active: [G, R, P] } }, { active: DRA }]);
  choose(noG, 'Attack: Zircon Road');
  noG.submit([1]);
  assert.equal(dmg(noG, 1), 180);
  assert.equal(noG.state.p[0].hand.length, before);
});

// ------------------------------------------------------------------ Flamigo ex

test('Flamigo ex, Precise Beak: 30, and 100 more when this Pokémon and the Defending Pokémon have the same amount of Energy', () => {
  const same = mk([{ active: 'Flamigo ex', energy: { active: [W, W] } }, { active: DRA, energy: { active: [P, P] } }]);
  choose(same, 'Attack: Precise Beak');
  assert.equal(dmg(same, 1), 130);
  const less = mk([{ active: 'Flamigo ex', energy: { active: [W, W] } }, { active: DRA, energy: { active: [P] } }]);
  choose(less, 'Attack: Precise Beak');
  assert.equal(dmg(less, 1), 30);
  const more = mk([{ active: 'Flamigo ex', energy: { active: [W, W] } }, { active: DRA, energy: { active: [P, P, P] } }]);
  choose(more, 'Attack: Precise Beak');
  assert.equal(dmg(more, 1), 30);
  const none = mk([{ active: 'Flamigo ex', energy: { active: [W, W] } }, { active: DRA }]);
  choose(none, 'Attack: Precise Beak');
  assert.equal(dmg(none, 1), 30);
});

test('Flamigo ex, Brave Bird: 200, and this Pokémon also does 30 damage to itself', () => {
  const g = mk([{ active: 'Flamigo ex', energy: { active: [W, W, W, W] } }, { active: DRA }]);
  choose(g, 'Attack: Brave Bird');
  assert.equal(dmg(g, 1), 200);
  assert.equal(dmg(g, 0), 30);
});

// ------------------------------------------------------------------ Amulet of Hope

test('Amulet of Hope: Knocked Out by damage from an opponent\'s attack, search your deck for 1 to 3 cards into your hand (ruling 2061), then shuffle', () => {
  const g = mk([{ active: DRA, energy: { active: [P] } }, { active: SLO, bench: [REL], tools: { active: ['Amulet of Hope'] } }], { events: true });
  choose(g, 'Attack: Jet Headbutt'); // 70 on Slowpoke's 70 HP
  assert.equal(g.decision?.player, 1);
  assert.equal(g.decision?.kind, 'cards');
  // Ruling (TPCi Rules Team 2024-11-07, https://compendium.pokegym.net/ruling/2061/): even with just 1 card left in the deck, Amulet of Hope makes you take at least one card.
  assert.equal(g.decision?.min, 1);
  assert.equal(g.decision?.max, 3);
  pick(g, ['Drasna', 'Dusk Ball', 'Call Bell']);
  assert.deepEqual(namesOf(g, g.state.p[1].hand.filter((c) => def(g.ctx, c).kind === 'trainer')), ['Call Bell', 'Drasna', 'Dusk Ball']);
  const search = g.events.findIndex((e) => e.type === 'search');
  assert.ok(g.events.findIndex((e, i) => e.type === 'shuffle' && i > search && (e as { player: number }).player === 1) > search, 'then shuffle');
});

test('Amulet of Hope: with a single card left in the deck you must take it; a Knock Out that is not by an attack does nothing', () => {
  const g = mk([{ active: DRA, energy: { active: [P] } }, { active: SLO, bench: [REL], tools: { active: ['Amulet of Hope'] }, emptyDeck: true }]);
  g.state.p[1].deck.push(g.state.p[1].discard.pop()!);
  const hand = g.state.p[1].hand.length;
  choose(g, 'Attack: Jet Headbutt');
  assert.equal(g.state.p[1].hand.length, hand + 1, 'the only card in the deck went to the hand (at least 1)');
  assert.equal(g.state.p[1].deck.length, 0);

  // Not by damage from an attack: the holder is Knocked Out by Poison at Pokémon Checkup.
  const p = mk([{ active: SLO, bench: [REL] }, { active: SLO, bench: [REL], tools: { active: ['Amulet of Hope'] }, cond: POISONED, damage: { active: 60 } }], OPP_TURN);
  const before = p.state.p[1].hand.length;
  choose(p, 'End turn');
  assert.equal(p.state.p[1].discard.filter((c) => nameOf(p, c) === 'Amulet of Hope').length, 1, 'the holder was Knocked Out');
  assert.ok(p.state.p[1].hand.length <= before + 1, 'no search (only the turn draw)');
});

// ------------------------------------------------------------------ Brilliant Blender

test('Brilliant Blender: search your deck for 1 to 5 cards (ruling 2062), discard them, then shuffle', () => {
  const g = mk([{ active: SLO, hand: ['Brilliant Blender'] }, { active: DRA }], { events: true });
  const deck0 = g.state.p[0].deck.length;
  choose(g, 'Play Brilliant Blender');
  // Ruling (TPCi Rules Team 2024-11-07, https://compendium.pokegym.net/ruling/2062/): you must discard at least one card to play this.
  assert.equal(g.decision?.min, 1);
  assert.equal(g.decision?.max, 5);
  pick(g, ['Drasna', 'Dusk Ball', 'Call Bell', 'Switch', 'Pikachu']);
  assert.equal(g.state.p[0].deck.length, deck0 - 5);
  assert.deepEqual(namesOf(g, g.state.p[0].discard.filter((c) => nameOf(g, c) !== 'Brilliant Blender')), ['Call Bell', 'Drasna', 'Dusk Ball', 'Pikachu', 'Switch']);
  assert.ok(g.events.some((e) => e.type === 'shuffle' && (e as { player: number }).player === 0));
});

test('Brilliant Blender: can\'t be played with an empty deck', () => {
  const g = mk([{ active: SLO, hand: ['Brilliant Blender'], emptyDeck: true }, { active: DRA }]);
  assert.ok(!has(g, 'Play Brilliant Blender'));
});

// ------------------------------------------------------------------ Call Bell

test('Call Bell: only if you go second, only during your first turn; search for a Supporter, reveal it, put it in your hand', () => {
  const g = mk([{ active: DRA }, { active: SLO, hand: ['Call Bell'] }], { turn: 2, current: 1, first: 0 });
  const before = g.state.p[1].hand.length;
  choose(g, 'Play Call Bell');
  assert.equal(g.decision?.kind, 'cards');
  choose(g, 'Drasna');
  assert.equal(g.state.p[1].hand.length, before, 'Call Bell left the hand and Drasna entered it');
  assert.ok(g.state.p[1].hand.some((c) => nameOf(g, c) === 'Drasna'));
  assert.ok(g.state.p[1].revealed.some((c) => nameOf(g, c) === 'Drasna'), 'revealed');
});

test('Call Bell: not playable when you go first, or on a later turn', () => {
  const first = mk([{ active: SLO, hand: ['Call Bell'] }, { active: DRA }], { turn: 1, current: 0, first: 0 });
  assert.ok(!has(first, 'Play Call Bell'), 'going first');
  const secondPlayerLater = mk([{ active: DRA }, { active: SLO, hand: ['Call Bell'] }], { turn: 4, current: 1, first: 0 });
  assert.ok(!has(secondPlayerLater, 'Play Call Bell'), 'the second player\'s second turn');
  const firstPlayerSecondTurn = mk([{ active: SLO, hand: ['Call Bell'] }, { active: DRA }], { turn: 3, current: 0, first: 0 });
  assert.ok(!has(firstPlayerSecondTurn, 'Play Call Bell'), 'the first player\'s own second turn');
  // Going second but during your first turn: playable.
  const ok = mk([{ active: DRA }, { active: SLO, hand: ['Call Bell'] }], { turn: 2, current: 1, first: 0 });
  assert.ok(has(ok, 'Play Call Bell'));
});

// ------------------------------------------------------------------ Chill Teaser Toy

test('Chill Teaser Toy: put an Energy attached to 1 of your opponent\'s Pokémon into their hand', () => {
  const g = mk([{ active: DRA, energy: { active: [P, W] } }, { active: SLO, hand: ['Chill Teaser Toy'] }], { turn: 2, current: 1, first: 0 });
  choose(g, 'Play Chill Teaser Toy');
  assert.equal(g.decision?.kind, 'cards', 'two different Energy: asked which');
  choose(g, 'Water Energy');
  assert.deepEqual(g.state.p[0].active!.energy.map((c) => nameOf(g, c)), [P]);
  assert.ok(g.state.p[0].hand.some((c) => nameOf(g, c) === W), 'it went to their hand, not the discard pile');
  assert.ok(!g.state.p[0].discard.some((c) => nameOf(g, c) === W));
});

test('Chill Teaser Toy: choose among the opponent\'s Pokémon (Benched too); identical Energy need no question', () => {
  const g = mk([{ active: DRA, bench: [REL], energy: { active: [P], 0: [G, G] } }, { active: SLO, hand: ['Chill Teaser Toy'] }], { turn: 2, current: 1, first: 0 });
  choose(g, 'Play Chill Teaser Toy');
  assert.equal(g.decision?.kind, 'slots');
  choose(g, 'Rellor');
  assert.equal(g.state.p[0].bench[0]!.energy.length, 1, 'one Grass Energy left on Rellor');
  assert.equal(g.state.p[0].active!.energy.length, 1);
  assert.ok(g.state.p[0].hand.some((c) => nameOf(g, c) === G));
});

test('Chill Teaser Toy: not playable when you go first, on a later turn, or when no opposing Pokémon has Energy', () => {
  const first = mk([{ active: SLO, hand: ['Chill Teaser Toy'] }, { active: DRA, energy: { active: [P] } }], { turn: 1, current: 0, first: 0 });
  assert.ok(!has(first, 'Play Chill Teaser Toy'));
  const later = mk([{ active: DRA, energy: { active: [P] } }, { active: SLO, hand: ['Chill Teaser Toy'] }], { turn: 4, current: 1, first: 0 });
  assert.ok(!has(later, 'Play Chill Teaser Toy'));
  const noEnergy = mk([{ active: DRA }, { active: SLO, hand: ['Chill Teaser Toy'] }], { turn: 2, current: 1, first: 0 });
  assert.ok(!has(noEnergy, 'Play Chill Teaser Toy'));
});

// ------------------------------------------------------------------ Clemont's Quick Wit

test("Clemont's Quick Wit: heal 60 damage from each of your {L} Pokémon", () => {
  const g = mk([
    { active: 'Tapu Koko', bench: ['Pikachu', SLO, 'Tapu Koko'], hand: ["Clemont's Quick Wit"], damage: { active: 100, 0: 30, 1: 40, 2: 70 } },
    { active: DRA },
  ]);
  choose(g, "Play Clemont's Quick Wit");
  const b = g.state.p[0].bench;
  assert.equal(g.state.p[0].active!.damage, 40, '100 - 60');
  assert.equal(b[0]!.damage, 0, '30 healed to 0, not below');
  assert.equal(b[1]!.damage, 40, 'a {P} Pokémon is not healed');
  assert.equal(b[2]!.damage, 10, '70 - 60');
});

test("Clemont's Quick Wit: not playable without a damaged {L} Pokémon", () => {
  const g = mk([{ active: 'Tapu Koko', bench: [SLO], hand: ["Clemont's Quick Wit"], damage: { 0: 40 } }, { active: DRA }]);
  assert.ok(!has(g, "Play Clemont's Quick Wit"));
});

// ------------------------------------------------------------------ Deduction Kit

test('Deduction Kit: look at the top 3 cards and put them back in any order', () => {
  const g = mk([{ active: SLO, hand: ['Deduction Kit'], deckTop: ['Drasna', 'Dusk Ball', 'Call Bell'] }, { active: DRA }]);
  const deck0 = g.state.p[0].deck.length;
  choose(g, 'Play Deduction Kit');
  choose(g, 'Put them back in any order');
  assert.equal(g.decision?.kind, 'order');
  g.submit([2, 0, 1]); // first = top
  const d = g.state.p[0].deck;
  assert.equal(d.length, deck0);
  assert.deepEqual([d[d.length - 1], d[d.length - 2], d[d.length - 3]].map((c) => nameOf(g, c!)), ['Call Bell', 'Drasna', 'Dusk Ball']);
});

test('Deduction Kit: or shuffle them and put them on the bottom of your deck', () => {
  const g = mk([{ active: SLO, hand: ['Deduction Kit'], deckTop: ['Drasna', 'Dusk Ball', 'Call Bell'] }, { active: DRA }], { events: true });
  const before = g.state.p[0].deck.slice();
  const top3 = before.slice(-3);
  choose(g, 'Play Deduction Kit');
  choose(g, 'Shuffle them and put them on the bottom');
  const d = g.state.p[0].deck;
  assert.equal(d.length, before.length);
  assert.deepEqual(d.slice(0, 3).slice().sort(), top3.slice().sort(), 'the same 3 cards are now the bottom 3');
  assert.ok(!d.slice(-3).some((c) => top3.includes(c)), 'and are no longer on top');
  assert.deepEqual(d.slice(3), before.slice(0, before.length - 3), 'the rest of the deck is untouched');
  assert.ok(g.events.some((e) => e.type === 'shuffle'));
});

// ------------------------------------------------------------------ Dragon Elixir

test('Dragon Elixir: heal 60 damage from your Active {N} Pokémon', () => {
  const g = mk([{ active: DRA, hand: ['Dragon Elixir'], damage: { active: 100 } }, { active: SLO }]);
  choose(g, 'Play Dragon Elixir');
  assert.equal(dmg(g, 0), 40);
  const low = mk([{ active: DRA, hand: ['Dragon Elixir'], damage: { active: 30 } }, { active: SLO }]);
  choose(low, 'Play Dragon Elixir');
  assert.equal(dmg(low, 0), 0);
});

test('Dragon Elixir: not playable unless your Active is a damaged {N} Pokémon', () => {
  const notDragon = mk([{ active: SLO, hand: ['Dragon Elixir'], damage: { active: 30 } }, { active: SLO }]);
  assert.ok(!has(notDragon, 'Play Dragon Elixir'));
  const undamaged = mk([{ active: DRA, hand: ['Dragon Elixir'] }, { active: SLO }]);
  assert.ok(!has(undamaged, 'Play Dragon Elixir'));
  const benched = mk([{ active: SLO, bench: [DRA], hand: ['Dragon Elixir'], damage: { 0: 80 } }, { active: SLO }]);
  assert.ok(!has(benched, 'Play Dragon Elixir'), 'only the Active Pokémon counts');
});

// ------------------------------------------------------------------ Drasna

test('Drasna: shuffle your hand into your deck, flip a coin; heads draw 8, tails draw 3', () => {
  for (const [coin, n] of [[true, 8], [false, 3]] as [boolean, number][]) {
    const g = mk([{ active: SLO, hand: ['Drasna', REL, 'Switch', 'Dusk Ball'] }, { active: DRA }], { events: true });
    const deckCards = g.state.p[0].deck.length + 3; // the three other cards in hand go to the deck
    g.state.forcedCoins = [coin];
    choose(g, 'Play Drasna');
    assert.equal(g.state.p[0].hand.length, n);
    assert.equal(g.state.p[0].deck.length, deckCards - n);
    assert.ok(g.events.some((e) => e.type === 'shuffle'));
  }
});

// ------------------------------------------------------------------ Drayton

test('Drayton: look at the top 7 cards, you may reveal a Pokémon and a Trainer card and put them into your hand, then shuffle', () => {
  const g = mk([{ active: SLO, hand: ['Drayton'], deckTop: [REL, 'Switch', 'Pikachu', 'Dusk Ball', G, W, R, 'Drasna'] }, { active: DRA }], { events: true });
  choose(g, 'Play Drayton');
  assert.equal(g.decision?.min, 0, 'a Pokémon, if you like');
  assert.deepEqual(labels(g).map((l) => l.replace(/\s+/g, ' ')).filter((l) => /Rellor|Pikachu/.test(l)).length, 2, 'both Pokémon among the top 7 are offered');
  assert.ok(!labels(g).some((l) => /Drasna|Switch|Dusk/.test(l)), 'no Trainer in the Pokémon choice');
  choose(g, 'Pikachu');
  assert.ok(labels(g).some((l) => l.includes('Switch')) && labels(g).some((l) => l.includes('Dusk Ball')), 'then a Trainer card');
  assert.ok(!labels(g).some((l) => l.includes('Drasna')), 'the 8th card from the top is not looked at');
  choose(g, 'Switch');
  assert.deepEqual(namesOf(g, g.state.p[0].hand), ['Pikachu', 'Switch']);
  assert.ok(g.state.p[0].revealed.length === 2, 'revealed');
  assert.ok(g.events.some((e) => e.type === 'shuffle' && (e as { player: number }).player === 0));
});

test('Drayton: you may take neither; with no Pokémon among the top 7 only the Trainer is asked about', () => {
  const g = mk([{ active: SLO, hand: ['Drayton'], deckTop: ['Switch', 'Dusk Ball', G, W, R, L, P, REL] }, { active: DRA }]);
  choose(g, 'Play Drayton');
  assert.ok(labels(g).some((l) => l.includes('Switch')), 'straight to the Trainer choice (no Pokémon in the top 7)');
  g.submit([]);
  assert.equal(g.state.p[0].hand.length, 0);
  const t = mk([{ active: SLO, hand: ['Drayton'], deckTop: [REL, G, W, R, L, P, FI] }, { active: DRA }]);
  choose(t, 'Play Drayton');
  choose(t, 'Rellor');
  assert.deepEqual(namesOf(t, t.state.p[0].hand), [REL], 'no Trainer card among the top 7: only the Pokémon');
});

// ------------------------------------------------------------------ Dusk Ball

test('Dusk Ball: look at the bottom 7 cards, you may reveal a Pokémon you find there and put it into your hand, then shuffle', () => {
  const g = mk([{ active: SLO, hand: ['Dusk Ball'] }, { active: DRA }], { events: true });
  // bottom 7 (index 0 = the very bottom): two Pokémon in, and a Pikachu 8th from the bottom (not looked at).
  setBottom(g, 0, ['Rellor', 'Switch', 'Drasna', 'Tandemaus', G, W, R, 'Pikachu']);
  choose(g, 'Play Dusk Ball');
  assert.equal(g.decision?.min, 0);
  assert.equal(g.decision?.max, 1);
  const ls = labels(g);
  assert.ok(ls.some((l) => l.includes('Rellor')) && ls.some((l) => l.includes('Tandemaus')));
  assert.ok(!ls.some((l) => l.includes('Pikachu')), 'the 8th card from the bottom is not looked at');
  assert.ok(!ls.some((l) => l.includes('Drasna') || l.includes('Switch')), 'only Pokémon');
  choose(g, 'Tandemaus');
  assert.deepEqual(namesOf(g, g.state.p[0].hand), ['Tandemaus']);
  assert.ok(g.state.p[0].revealed.some((c) => nameOf(g, c) === 'Tandemaus'));
  assert.ok(g.events.some((e) => e.type === 'shuffle' && (e as { player: number }).player === 0));
});

test('Dusk Ball: you may take nothing; none among the bottom 7 finds nothing', () => {
  const g = mk([{ active: SLO, hand: ['Dusk Ball'] }, { active: DRA }]);
  setBottom(g, 0, ['Rellor', 'Switch', 'Drasna', 'Tandemaus', G, W, R, 'Pikachu']);
  choose(g, 'Play Dusk Ball');
  g.submit([]);
  assert.equal(g.state.p[0].hand.length, 0);
  const n = mk([{ active: SLO, hand: ['Dusk Ball'] }, { active: DRA }]);
  setBottom(n, 0, ['Switch', 'Drasna', G, W, R, L, P, 'Rellor']);
  choose(n, 'Play Dusk Ball');
  assert.equal(n.state.p[0].hand.length, 0, 'no Pokémon in the bottom 7: nothing to take');
  assert.equal(n.decision?.kind, 'main');
});

// ------------------------------------------------------------------ Energy Search Pro

test('Energy Search Pro: any number of Basic Energy of different types into your hand — one card of each type at most (ruling 2063)', () => {
  const g = mk([{ active: SLO, hand: ['Energy Search Pro'] }, { active: DRA }]);
  const deck0 = g.state.p[0].deck.length;
  choose(g, 'Play Energy Search Pro');
  // Ruling (TPCi Rules Team 2024-11-07, https://compendium.pokegym.net/ruling/2063/): search for at most one card per Energy type.
  const want = new Set([G, W, M]);
  let asked = 0;
  while (g.decision?.kind === 'cards') {
    asked++;
    assert.equal(g.decision.max, 1, 'one card per type');
    const types = new Set(g.decision.values!.map((c) => nameOf(g, c)));
    assert.equal(types.size, 1, 'each question is about a single type');
    const t = [...types][0]!;
    g.submit(want.has(t) ? [0] : []);
  }
  assert.equal(asked, 8, 'one question for each of the 8 Basic Energy types');
  assert.deepEqual(namesOf(g, g.state.p[0].hand), [G, M, W].sort());
  assert.equal(g.state.p[0].deck.length, deck0 - 3);
});

test('Energy Search Pro: may find none', () => {
  const g = mk([{ active: SLO, hand: ['Energy Search Pro'] }, { active: DRA }]);
  choose(g, 'Play Energy Search Pro');
  while (g.decision?.kind === 'cards') g.submit([]);
  assert.equal(g.state.p[0].hand.length, 0);
});

// ------------------------------------------------------------------ Jasmine's Gaze

test("Jasmine's Gaze: during your opponent's next turn all of your Pokémon take 30 less damage from attacks (new Pokémon too)", () => {
  const g = mk([{ active: REL, hand: ["Jasmine's Gaze", SLO, 'Switch'] }, { active: DRA, energy: { active: [P] } }]);
  choose(g, "Play Jasmine's Gaze");
  choose(g, 'Bench Slowpoke'); // a new Pokémon coming into play
  choose(g, 'Play Switch');
  choose(g, 'End turn');
  choose(g, 'Attack: Jet Headbutt');
  assert.equal(dmg(g, 0), 40, '70 - 30 on the Pokémon that came into play after the Supporter');
});

test("Jasmine's Gaze: only during your opponent's next turn", () => {
  const g = mk([{ active: 'Tapu Koko ex', hand: ["Jasmine's Gaze"] }, { active: DRA, energy: { active: [P] } }]);
  choose(g, "Play Jasmine's Gaze");
  choose(g, 'End turn');
  choose(g, 'Attack: Jet Headbutt');
  assert.equal(dmg(g, 0), 40);
  choose(g, 'End turn'); // my turn; then their next turn: the effect is over
  choose(g, 'Attack: Jet Headbutt');
  assert.equal(g.state.p[0].active!.damage, 40 + 70, 'full damage again');
});

// ------------------------------------------------------------------ Lisia's Appeal

test("Lisia's Appeal: switch in 1 of your opponent's Benched Basic Pokémon; the new Active Pokémon is now Confused", () => {
  const g = mk([{ active: SLO, hand: ["Lisia's Appeal"] }, { active: DRA, bench: ['Maushold', REL, SLO] }]);
  choose(g, "Play Lisia's Appeal");
  assert.equal(g.decision?.kind, 'slots');
  assert.equal(g.decision?.values?.length, 2, 'only the Benched Basic Pokémon (not Maushold, a Stage 1)');
  choose(g, 'Rellor');
  assert.equal(nameOf(g, g.state.p[1].active!.cards[0]!), REL);
  assert.ok(g.state.p[1].active!.cond & CONFUSED, 'Confused');
  assert.ok(g.state.p[1].bench.some((b) => nameOf(g, b.cards[0]!) === DRA), 'the old Active Pokémon went to the Bench');
});

test("Lisia's Appeal: not playable when no Basic Pokémon is on the opponent's Bench", () => {
  const g = mk([{ active: SLO, hand: ["Lisia's Appeal"] }, { active: DRA, bench: ['Maushold'] }]);
  assert.ok(!has(g, "Play Lisia's Appeal"));
  const e = mk([{ active: SLO, hand: ["Lisia's Appeal"] }, { active: DRA }]);
  assert.ok(!has(e, "Play Lisia's Appeal"));
});

// ------------------------------------------------------------------ Meddling Memo

test('Meddling Memo: your opponent shuffles their hand to the bottom of their deck, then draws that many cards', () => {
  const g = mk([{ active: SLO, hand: ['Meddling Memo'] }, { active: DRA, hand: [REL, 'Switch', 'Drasna', G] }]);
  const oldHand = g.state.p[1].hand.slice();
  const deck0 = g.state.p[1].deck.length;
  choose(g, 'Play Meddling Memo');
  assert.equal(g.state.p[1].hand.length, 4, 'they drew that many cards');
  assert.equal(g.state.p[1].deck.length, deck0);
  assert.ok(!g.state.p[1].hand.some((c) => oldHand.includes(c)), 'the old hand went to the bottom of the deck');
  assert.deepEqual(g.state.p[1].deck.slice(0, 4).slice().sort(), oldHand.slice().sort(), 'the bottom 4 cards are the old hand');
});

test('Meddling Memo: not playable when your opponent has no cards in hand', () => {
  const g = mk([{ active: SLO, hand: ['Meddling Memo'] }, { active: DRA }]);
  assert.equal(g.state.p[1].hand.length, 0);
  assert.ok(!has(g, 'Play Meddling Memo'));
});

// ------------------------------------------------------------------ Megaton Blower

test('Megaton Blower: discard all Pokémon Tools and Special Energy from all of your opponent\'s Pokémon, and discard a Stadium in play', () => {
  const g = mk([
    { active: SLO, hand: ['Megaton Blower'], tools: { active: ['Air Balloon'] } },
    { active: DRA, bench: [SLO, REL], energy: { active: ['Legacy Energy', P], 0: ['Legacy Energy', G] }, tools: { active: ['Air Balloon'], 1: ['Air Balloon'] } },
  ]);
  setStadium(g, 0, 'Battle Cage');
  choose(g, 'Play Megaton Blower');
  const o = g.state.p[1];
  assert.deepEqual(o.active!.energy.map((c) => nameOf(g, c)), [P], 'the Basic Energy stays on the Active Pokémon');
  assert.deepEqual(o.bench[0]!.energy.map((c) => nameOf(g, c)), [G]);
  assert.equal(o.active!.tools.length + o.bench[1]!.tools.length, 0);
  assert.equal(o.discard.filter((c) => nameOf(g, c) === 'Air Balloon').length, 2);
  assert.equal(o.discard.filter((c) => nameOf(g, c) === 'Legacy Energy').length, 2);
  assert.equal(g.state.stadium, null);
  assert.equal(g.state.p[0].discard.filter((c) => nameOf(g, c) === 'Battle Cage').length, 1, 'the Stadium goes to its owner\'s discard pile');
  assert.equal(g.state.p[0].active!.tools.length, 1, 'your own Tools stay');
});

test('Megaton Blower: rulings 2064/2065 — with only a Stadium in play it can be played; with none of the three it can\'t', () => {
  // Ruling (TPCi Rules Team 2024-11-07, https://compendium.pokegym.net/ruling/2065/): you can play this with only a Stadium to discard.
  const stadiumOnly = mk([{ active: SLO, hand: ['Megaton Blower'] }, { active: DRA }]);
  setStadium(stadiumOnly, 1, 'Battle Cage');
  choose(stadiumOnly, 'Play Megaton Blower');
  assert.equal(stadiumOnly.state.stadium, null);
  // Ruling (TPCi Rules Team 2024-11-07, https://compendium.pokegym.net/ruling/2064/): play this if at least one discardable card exists, doing what you can.
  const nothing = mk([{ active: SLO, hand: ['Megaton Blower'] }, { active: DRA, energy: { active: [P] } }]);
  assert.ok(!has(nothing, 'Play Megaton Blower'));
  const toolOnly = mk([{ active: SLO, hand: ['Megaton Blower'] }, { active: DRA, tools: { active: ['Air Balloon'] } }]);
  choose(toolOnly, 'Play Megaton Blower');
  assert.equal(toolOnly.state.p[1].active!.tools.length, 0);
  const specialOnly = mk([{ active: SLO, hand: ['Megaton Blower'] }, { active: DRA, energy: { active: ['Legacy Energy'] } }]);
  choose(specialOnly, 'Play Megaton Blower');
  assert.equal(specialOnly.state.p[1].active!.energy.length, 0);
});

// ------------------------------------------------------------------ Miracle Headset

test('Miracle Headset: put up to 2 Supporter cards from your discard pile into your hand (1 to 2 on a Trainer)', () => {
  const g = mk([{ active: SLO, hand: ['Miracle Headset'], discard: ['Drasna', "Boss's Orders", 'Drayton', 'Switch', P] }, { active: DRA }]);
  choose(g, 'Play Miracle Headset');
  assert.equal(g.decision?.min, 1);
  assert.equal(g.decision?.max, 2);
  assert.ok(!labels(g).some((l) => l.includes('Switch') || l.includes('Psychic')), 'only Supporters');
  pick(g, ['Drasna', 'Drayton']);
  assert.deepEqual(namesOf(g, g.state.p[0].hand), ['Drasna', 'Drayton']);
  assert.ok(g.state.p[0].discard.some((c) => nameOf(g, c) === "Boss's Orders"));
});

test('Miracle Headset: not playable without a Supporter in your discard pile', () => {
  const g = mk([{ active: SLO, hand: ['Miracle Headset'], discard: ['Switch', P] }, { active: DRA }]);
  assert.ok(!has(g, 'Play Miracle Headset'));
});

// ------------------------------------------------------------------ Scramble Switch

test('Scramble Switch: switch, then you may move any amount of Energy from the Pokémon you moved to your Bench to the new Active Pokémon', () => {
  const g = mk([{ active: DRA, bench: [SLO], hand: ['Scramble Switch'], energy: { active: [P, W, FI] } }, { active: SLO }]);
  choose(g, 'Play Scramble Switch');
  yes(g);
  pick(g, ['Psychic Energy', 'Water Energy']);
  assert.equal(nameOf(g, g.state.p[0].active!.cards[0]!), SLO);
  assert.deepEqual(g.state.p[0].active!.energy.map((c) => nameOf(g, c)).sort(), [P, W].sort());
  assert.deepEqual(g.state.p[0].bench[0]!.energy.map((c) => nameOf(g, c)), [FI], 'the rest stays on the Pokémon moved to the Bench');
  assert.equal(nameOf(g, g.state.p[0].bench[0]!.cards[0]!), DRA);
});

test('Scramble Switch: moving none is fine; a Pokémon with no Energy asks nothing; chooses among the Bench', () => {
  const none = mk([{ active: DRA, bench: [SLO], hand: ['Scramble Switch'], energy: { active: [P] } }, { active: SLO }]);
  choose(none, 'Play Scramble Switch');
  none.submit([1]);
  assert.equal(none.state.p[0].active!.energy.length, 0);
  assert.equal(none.state.p[0].bench[0]!.energy.length, 1);

  const bare = mk([{ active: DRA, bench: [SLO, REL], hand: ['Scramble Switch'] }, { active: SLO }]);
  choose(bare, 'Play Scramble Switch');
  choose(bare, 'Rellor');
  assert.equal(nameOf(bare, bare.state.p[0].active!.cards[0]!), REL);
  assert.equal(bare.decision?.kind, 'main', 'no Energy to move: no question');

  const bareBench = mk([{ active: SLO, hand: ['Scramble Switch'] }, { active: SLO }]);
  assert.ok(!has(bareBench, 'Play Scramble Switch'), 'no Benched Pokémon: can\'t be played');
});
