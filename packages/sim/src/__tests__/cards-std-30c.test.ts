/**
 * Card tests, batch "std-30c": every card scripted in cards/scripts/std-30c.ts does what its printed text says in a constructed
 * position, and every TPCi ruling cited in the script is pinned here. Quotes are the printed text from the frames.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { def } from '../context.js';
import { describeOptions } from '../describe.js';
import type { Game } from '../game.js';
import { retreatCost } from '../query.js';
import { scenario, type SideLayout } from '../scenario.js';
import type { Decision } from '../types.js';
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
/** Answer a pending choice of target (Dragapult ex's Jet Headbutt hits 1 of your Pokémon). */
const target = (g: Game, n: string): void => {
  if (g.decision && g.decision.kind !== 'main') choose(g, n);
};
const nameOf = (g: Game, card: number): string => def(g.ctx, card).name;
const namesOf = (g: Game, cards: number[]): string[] => cards.map((c) => nameOf(g, c)).sort();
const dmg = (g: Game, p: 0 | 1): number => g.state.p[p].active!.damage;
const countIn = (g: Game, cards: number[], n: string): number => cards.filter((c) => nameOf(g, c) === n).length;

const ENERGY: [string, number][] = ['mee-001', 'mee-002', 'mee-003', 'mee-004', 'mee-005', 'mee-006', 'mee-007', 'mee-008'].map((id) => [id, 10]);
const IDS: Record<string, string> = {
  Groudon: '30th-082',
  Lucario: '30th-083',
  Lycanroc: '30th-085',
  Koraidon: '30th-086',
  'Nidoran♀': '30th-087',
  Nidorina: '30th-088',
  'Alolan Meowth': '30th-089',
  'Gengar ex': '30th-090',
  Umbreon: '30th-091',
  'Umbreon ex': '30th-092',
  Murkrow: '30th-093',
  Scraggy: '30th-094',
  Zoroark: '30th-096',
  Hydreigon: '30th-099',
  'Galarian Meowth': '30th-101',
  'Jirachi ex': '30th-102',
  Dialga: '30th-103',
  Ferrothorn: '30th-104',
  Solgaleo: '30th-105',
  Zacian: '30th-106',
  Zamazenta: '30th-107',
  // supporting cast
  'Dragapult ex': 'sv06-130', // 320 HP Tera, no Weakness or Resistance: a neutral target; Jet Headbutt {C} 70
  'Fezandipiti ex': 'sv06.5-038', // 210 HP Basic ex, Weakness Fighting x2
  Dhelmise: 'me05-039', // 140 HP Basic, Resistance Fighting -30
  Purrloin: 'sv10.5w-055',
  Zorua: 'sv10.5w-061',
  "Lillie's Clefairy ex": 'sv09-056', // 190 HP, Weakness Metal x2
  'Air Balloon': 'me01-166',
  'Legacy Energy': 'sv06-167',
  'Ultra Ball': 'me01-131',
};
const deck = fromIds('30c', [...Object.values(IDS).map((id): [string, number] => [id, 4]), ...ENERGY]);
const DRA = 'Dragapult ex';
const CLEF = "Lillie's Clefairy ex";
const G = 'Grass Energy';
const W = 'Water Energy';
const P = 'Psychic Energy';
const F = 'Fighting Energy';
const D = 'Darkness Energy';
const M = 'Metal Energy';
const FEZ = 'Fezandipiti ex';
type Sides = [SideLayout, SideLayout];
const game = (sides: Sides, opts: Parameters<typeof scenario>[3] = {}) => scenario(deck, deck, sides, opts);
const gameE = (sides: Sides) => game(sides, { events: true });
const OPP_TURN = { current: 1 as const, turn: 4 };
void [G, W];

// ------------------------------------------------------------------ Groudon

test("Groudon, Break Ground: 250, and 20 damage to each of your Benched Pokémon with no Weakness or Resistance (Dhelmise resists {F})", () => {
  const g = game([{ active: 'Groudon', bench: ['Dhelmise', 'Zorua'], energy: { active: [F, F, F, F, F] } }, { active: DRA }]);
  choose(g, 'Attack: Break Ground');
  assert.equal(dmg(g, 1), 250);
  assert.equal(g.state.p[0].bench[0]!.damage, 20, 'not reduced by Resistance');
  assert.equal(g.state.p[0].bench[1]!.damage, 20);
  assert.equal(dmg(g, 0), 0, 'not the Active Pokémon itself');
  assert.equal(g.state.p[1].bench.length, 0);
});

test("Groudon, Break Ground: the opponent's Benched Pokémon are not damaged", () => {
  const g = game([{ active: 'Groudon', energy: { active: [F, F, F, F, F] } }, { active: DRA, bench: [FEZ] }]);
  choose(g, 'Attack: Break Ground');
  assert.equal(g.state.p[1].bench[0]!.damage, 0);
});

// ------------------------------------------------------------------ Lucario

test("Lucario, Aura Sphere: 100, and 60 to 1 of the opponent's Benched Pokémon with no Weakness (Fezandipiti ex is weak to {F})", () => {
  const g = game([{ active: 'Lucario', energy: { active: [F, F, F] } }, { active: DRA, bench: [FEZ, 'Zorua'] }]);
  choose(g, 'Attack: Aura Sphere');
  if (g.decision?.kind !== 'main') choose(g, FEZ);
  assert.equal(dmg(g, 1), 100);
  assert.equal(g.state.p[1].bench[0]!.damage, 60, 'not doubled');
  assert.equal(g.state.p[1].bench[1]!.damage, 0, 'only the chosen Pokémon');
});

// ------------------------------------------------------------------ Lycanroc

test("Lycanroc, Counter: 10 more for each damage it took from an attack during the opponent's last turn (70 -> 80)", () => {
  const g = game([{ active: 'Lycanroc', energy: { active: [F] } }, { active: DRA, energy: { active: [P] } }], OPP_TURN);
  choose(g, 'Attack: Jet Headbutt');
  assert.equal(dmg(g, 0), 70);
  choose(g, 'Attack: Counter');
  assert.equal(dmg(g, 1), 10 + 70, '70 that much more');
});

test('Lycanroc, Counter: 10 when it was not damaged by an attack during the opponent\'s last turn', () => {
  const g = game([{ active: 'Lycanroc', damage: { active: 40 }, energy: { active: [F] } }, { active: DRA }]);
  choose(g, 'Attack: Counter');
  assert.equal(dmg(g, 1), 10, 'damage it already had is not damage from last turn');
});

// ------------------------------------------------------------------ Koraidon

test('Koraidon, Collision Course: 140, then discard 2 {F} Energy from it (a Water Energy stays)', () => {
  const g = game([{ active: 'Koraidon', energy: { active: [F, W, F] } }, { active: DRA }]);
  choose(g, 'Attack: Collision Course');
  assert.equal(dmg(g, 1), 140);
  assert.deepEqual(namesOf(g, g.state.p[0].active!.energy), ['Water Energy']);
  assert.equal(countIn(g, g.state.p[0].discard, 'Fighting Energy'), 2);
});

// ------------------------------------------------------------------ Nidoran♀

test("Nidoran♀, Growl: during the opponent's next turn the Defending Pokémon's attacks do 30 less damage (70 -> 40)", () => {
  const g = game([{ active: 'Nidoran♀', energy: { active: [F] } }, { active: DRA, energy: { active: [P] } }]);
  choose(g, 'Attack: Growl');
  assert.equal(dmg(g, 1), 0);
  choose(g, 'Attack: Jet Headbutt');
  assert.equal(dmg(g, 0), 40);
});

test('Nidoran♀, Growl: without it Jet Headbutt does its full 70 (Nidoran♀ has 60 HP and is Knocked Out)', () => {
  const g = game([{ active: 'Nidoran♀', bench: ['Zorua'] }, { active: DRA, energy: { active: [P] } }], OPP_TURN);
  choose(g, 'Attack: Jet Headbutt');
  target(g, 'Nidoran');
  assert.equal(countIn(g, g.state.p[0].discard, 'Nidoran♀'), 1);
});

// ------------------------------------------------------------------ Nidorina

test('Nidorina, Share Happiness: heal 30 damage from 1 of your Pokémon, once during your turn', () => {
  const g = game([{ active: 'Nidorina', bench: ['Zorua', 'Purrloin'], damage: { 0: 50, 1: 40 } }, { active: DRA }]);
  choose(g, 'Use Share Happiness');
  choose(g, 'Zorua');
  assert.equal(g.state.p[0].bench[0]!.damage, 20, '30 healed from the chosen Pokémon');
  assert.equal(g.state.p[0].bench[1]!.damage, 40, 'the other is untouched');
  assert.ok(!has(g, 'Use Share Happiness'), 'once during your turn');
});

test('Nidorina, Share Happiness: not offered when none of your Pokémon is damaged', () => {
  const g = game([{ active: 'Nidorina', bench: ['Zorua'] }, { active: DRA }]);
  assert.ok(!has(g, 'Use Share Happiness'));
});

test('Nidorina, Share Happiness: heals the Pokémon itself, and 30 of 20 damage removes it all', () => {
  const g = game([{ active: 'Nidorina', damage: { active: 20 } }, { active: DRA }]);
  choose(g, 'Use Share Happiness');
  assert.equal(dmg(g, 0), 0);
});

// ------------------------------------------------------------------ Alolan Meowth

test('Alolan Meowth, Pay Day: 10 damage, then draw a card', () => {
  const g = game([{ active: 'Alolan Meowth', hand: [] }, { active: DRA }]);
  const hand = g.state.p[0].hand.length;
  choose(g, 'Attack: Pay Day');
  assert.equal(dmg(g, 1), 10);
  assert.equal(g.state.p[0].hand.length, hand + 1);
});

// ------------------------------------------------------------------ Gengar ex

test("Gengar ex, Chaotic Pain: place 13 damage counters on 1 of the opponent's Pokémon (a Benched one weak to {D}-less: counters ignore Weakness)", () => {
  const g = game([{ active: 'Gengar ex', energy: { active: [D, D] } }, { active: DRA, bench: [FEZ, 'Zorua'] }]);
  choose(g, 'Attack: Chaotic Pain');
  choose(g, FEZ);
  assert.equal(g.state.p[1].bench[0]!.damage, 130);
  assert.equal(g.state.p[1].bench[1]!.damage, 0);
  assert.equal(dmg(g, 1), 0);
});

test("Gengar ex, Fainting Spell: Knocked Out by damage from an attack, heads: the Attacking Pokémon is Knocked Out", () => {
  const g = game(
    [{ active: 'Gengar ex', bench: ['Zorua'], damage: { active: 250 } }, { active: DRA, bench: ['Purrloin'], energy: { active: [P] } }],
    OPP_TURN,
  );
  g.state.forcedCoins = [true];
  choose(g, 'Attack: Jet Headbutt');
  target(g, 'Gengar');
  assert.equal(countIn(g, g.state.p[0].discard, 'Gengar ex'), 1, 'Gengar ex was Knocked Out');
  assert.equal(countIn(g, g.state.p[1].discard, DRA), 1, 'so was the Attacking Pokémon');
});

test('Gengar ex, Fainting Spell: tails, nothing happens to the Attacking Pokémon', () => {
  const g = game(
    [{ active: 'Gengar ex', bench: ['Zorua'], damage: { active: 250 } }, { active: DRA, bench: ['Purrloin'], energy: { active: [P] } }],
    OPP_TURN,
  );
  g.state.forcedCoins = [false];
  choose(g, 'Attack: Jet Headbutt');
  target(g, 'Gengar');
  assert.equal(countIn(g, g.state.p[0].discard, 'Gengar ex'), 1);
  assert.equal(countIn(g, g.state.p[1].discard, DRA), 0);
  assert.equal(g.state.p[1].active ? nameOf(g, g.state.p[1].active.cards[0]!) : '', DRA);
});

test('Gengar ex, Fainting Spell: not Knocked Out (damage short of its HP), no coin is flipped', () => {
  const g = game([{ active: 'Gengar ex', bench: ['Zorua'] }, { active: DRA, energy: { active: [P] } }], OPP_TURN);
  g.state.forcedCoins = [true];
  choose(g, 'Attack: Jet Headbutt');
  target(g, 'Gengar');
  assert.equal(dmg(g, 0), 70);
  assert.equal(countIn(g, g.state.p[1].discard, DRA), 0);
  assert.deepEqual(g.state.forcedCoins, [true], 'the coin was not used');
});

test('Gengar ex, Fainting Spell: a Benched Gengar ex Knocked Out by an attack counts too (the text names no Active Spot)', () => {
  // Lucario's Aura Sphere does 60 damage to 1 of the opponent's Benched Pokémon: the Benched Gengar ex (240 + 60 = 300 of 280 HP).
  const g = game(
    [{ active: 'Zorua', bench: ['Gengar ex'], damage: { 0: 240 } }, { active: 'Lucario', bench: ['Zorua'], energy: { active: [F, F, F] } }],
    OPP_TURN,
  );
  g.state.forcedCoins = [true];
  choose(g, 'Attack: Aura Sphere');
  target(g, 'Gengar');
  assert.equal(countIn(g, g.state.p[0].discard, 'Gengar ex'), 1, 'the Benched Gengar ex was Knocked Out');
  assert.equal(countIn(g, g.state.p[1].discard, 'Lucario'), 1, 'and heads Knocked Out the Attacking Pokémon');
});

// ------------------------------------------------------------------ Umbreon

test("Umbreon, Retaliate: 100 more if one of your Pokémon was Knocked Out by damage from an attack during your opponent's last turn", () => {
  const g = game(
    [{ active: 'Purrloin', damage: { active: 50 }, bench: ['Umbreon'], energy: { 0: [D] } }, { active: DRA, energy: { active: [P] } }],
    OPP_TURN,
  );
  choose(g, 'Attack: Jet Headbutt'); // 70 on 20 HP remaining
  assert.equal(g.state.p[1].prizesTaken, 1);
  choose(g, 'Attack: Retaliate');
  assert.equal(dmg(g, 1), 30 + 100);
});

test('Umbreon, Retaliate: 30 when none of your Pokémon was Knocked Out last turn', () => {
  const g = game([{ active: 'Umbreon', energy: { active: [D] } }, { active: DRA, energy: { active: [P] } }], OPP_TURN);
  choose(g, 'Attack: Jet Headbutt');
  choose(g, 'Attack: Retaliate');
  assert.equal(dmg(g, 1), 30);
});

test('Umbreon, Retaliate (ruling 2200): a Knock Out that gives up no Prize card (Legacy Energy) still counts', () => {
  // Ruling (Black Bolt/White Flare FAQ, TPCi Rules Team 2025-07-17, https://compendium.pokegym.net/ruling/2200/): a Knock Out giving up no Prize card still counts as a KO'd Pokemon for Retaliate.
  const g = game(
    [
      { active: 'Purrloin', damage: { active: 50 }, energy: { active: ['Legacy Energy'] }, bench: ['Umbreon'] },
      { active: DRA, energy: { active: [P] } },
    ],
    OPP_TURN,
  );
  g.state.p[0].bench[0]!.energy.push(g.state.p[0].deck.splice(g.state.p[0].deck.findIndex((c) => nameOf(g, c) === D), 1)[0]!);
  choose(g, 'Attack: Jet Headbutt');
  assert.equal(g.state.p[1].prizesTaken, 0, 'Legacy Energy: no Prize card for this Knock Out');
  choose(g, 'Attack: Retaliate');
  assert.equal(dmg(g, 1), 130);
});

// ------------------------------------------------------------------ Umbreon ex

test("Umbreon ex, Lunatic Claw: 140 more if the opponent's Active Pokémon already has damage counters (100 -> 240)", () => {
  const g = game([{ active: 'Umbreon ex', energy: { active: [D, P] } }, { active: DRA, damage: { active: 10 } }]);
  choose(g, 'Attack: Lunatic Claw');
  assert.equal(dmg(g, 1), 10 + 240);
});

test('Umbreon ex, Lunatic Claw: 100 when the Defending Pokémon has no damage counters, however much is on the Bench', () => {
  const g = game([{ active: 'Umbreon ex', energy: { active: [D, P] }, damage: { active: 100 } }, { active: DRA, bench: [FEZ], damage: { 0: 100 } }]);
  choose(g, 'Attack: Lunatic Claw');
  assert.equal(dmg(g, 1), 100);
});

// ------------------------------------------------------------------ Murkrow

test("Murkrow, Clumsily Clutch: heads, the Defending Pokémon can't retreat during the opponent's next turn", () => {
  const g = game([{ active: 'Murkrow', energy: { active: [D] } }, { active: DRA, bench: ['Zorua'], energy: { active: [P] } }]);
  g.state.forcedCoins = [true];
  choose(g, 'Attack: Clumsily Clutch');
  assert.equal(dmg(g, 1), 20);
  assert.ok(!has(g, 'Retreat'), "can't retreat");
});

test('Murkrow, Clumsily Clutch: tails, the Defending Pokémon can retreat (the 20 damage is done either way)', () => {
  const g = game([{ active: 'Murkrow', energy: { active: [D] } }, { active: DRA, bench: ['Zorua'], energy: { active: [P] } }]);
  g.state.forcedCoins = [false];
  choose(g, 'Attack: Clumsily Clutch');
  assert.equal(dmg(g, 1), 20);
  assert.ok(has(g, 'Retreat'));
});

// ------------------------------------------------------------------ Scraggy

test('Scraggy, Nitpick: the opponent shuffles their hand into their deck and draws 4 cards (yours is untouched)', () => {
  const g = gameE([{ active: 'Scraggy', energy: { active: [D] }, hand: ['Zorua', 'Purrloin'] }, { active: DRA, hand: ['Zorua', 'Zorua', 'Zorua', 'Purrloin', 'Purrloin', 'Purrloin', 'Dhelmise'] }]);
  const total = g.state.p[1].hand.length + g.state.p[1].deck.length;
  choose(g, 'Attack: Nitpick');
  assert.equal(g.state.p[1].hand.length, 5, '4 drawn, and the draw for their turn');
  assert.equal(g.state.p[1].hand.length + g.state.p[1].deck.length, total, 'no card was lost');
  assert.deepEqual(namesOf(g, g.state.p[0].hand), ['Purrloin', 'Zorua'], 'your hand is untouched');
  assert.ok(g.events.some((e) => e.type === 'shuffle'));
});

test('Scraggy, Nitpick: with a hand of 1 the opponent still draws 4', () => {
  const g = game([{ active: 'Scraggy', energy: { active: [D] } }, { active: DRA, hand: ['Zorua'] }]);
  choose(g, 'Attack: Nitpick');
  assert.equal(g.state.p[1].hand.length, 5, '4 drawn, and the draw for their turn');
});

// ------------------------------------------------------------------ Zoroark

test("Zoroark, Nighttime Byway: while it is on your Bench, your Active Pokémon's Retreat Cost is {C}{C} less (never below 0)", () => {
  const g = game([{ active: 'Ferrothorn', bench: ['Zoroark'] }, { active: DRA, bench: ['Zoroark'] }]);
  const env = g.envForInternals;
  const rc = (p: 0 | 1) => retreatCost(env, g.state, g.state.p[p].active!);
  assert.equal(rc(0), 1, '3 - 2');
  assert.equal(rc(1), 0, '1 - 2, but not below 0');
  const two = game([{ active: 'Ferrothorn', bench: ['Zoroark', 'Zoroark'] }, { active: DRA }]);
  assert.equal(retreatCost(two.envForInternals, two.state, two.state.p[0].active!), 0, 'two of them: 3 - 4, not below 0');
});

test("Zoroark, Nighttime Byway: not while Active, nor while on the opponent's side, nor for a Benched Pokémon", () => {
  const act = game([{ active: 'Zoroark', bench: ['Ferrothorn'] }, { active: 'Ferrothorn' }]);
  const env = act.envForInternals;
  assert.equal(retreatCost(env, act.state, act.state.p[0].active!), 1, 'Zoroark Active: its own printed Retreat Cost');
  assert.equal(retreatCost(env, act.state, act.state.p[0].bench[0]!), 3, 'a Benched Pokémon is unchanged');
  const opp = game([{ active: 'Ferrothorn' }, { active: DRA, bench: ['Zoroark'] }]);
  assert.equal(retreatCost(opp.envForInternals, opp.state, opp.state.p[0].active!), 3, "the opponent's Zoroark does not help me");
});

// ------------------------------------------------------------------ Hydreigon

test("Hydreigon, Three-Headed Bite: flip 3 coins; for each heads, discard an Energy from the opponent's Active Pokémon", () => {
  for (const [coins, left] of [
    [[true, true, true], 0],
    [[true, false, true], 1],
    [[false, true, false], 2],
    [[false, false, false], 3],
  ] as [boolean[], number][]) {
    const g = game([{ active: 'Hydreigon', energy: { active: [D] } }, { active: DRA, energy: { active: [P, P, F] } }]);
    g.state.forcedCoins = coins;
    choose(g, 'Attack: Three-Headed Bite');
    while (g.decision && g.decision.kind !== 'main') g.submit(Array.from({ length: g.decision.min }, (_, i) => i));
    assert.equal(g.state.p[1].active!.energy.length, left, `${coins.filter(Boolean).length} heads`);
    assert.equal(dmg(g, 1), 0, 'the attack does no damage');
  }
});

test('Hydreigon, Three-Headed Bite: with fewer Energy than heads, all of it is discarded; Energy on the Bench is safe', () => {
  const g = game([{ active: 'Hydreigon', energy: { active: [D] } }, { active: DRA, bench: [FEZ], energy: { active: [P], 0: [P] } }]);
  g.state.forcedCoins = [true, true, true];
  choose(g, 'Attack: Three-Headed Bite');
  assert.equal(g.state.p[1].active!.energy.length, 0);
  assert.equal(g.state.p[1].bench[0]!.energy.length, 1);
});

// ------------------------------------------------------------------ Galarian Meowth

test('Galarian Meowth, Pay Day: 10 damage, then draw a card', () => {
  const g = game([{ active: 'Galarian Meowth', energy: { active: [W] }, hand: [] }, { active: DRA }]);
  const hand = g.state.p[0].hand.length;
  choose(g, 'Attack: Pay Day');
  assert.equal(dmg(g, 1), 10);
  assert.equal(g.state.p[0].hand.length, hand + 1);
});

test('Galarian Meowth, Treasure Rush: 10 damage for each card in your hand (0, 3 and 6 cards)', () => {
  for (const [hand, expected] of [
    [[], 0],
    [['Zorua', 'Zorua', 'Purrloin'], 30],
    [['Zorua', 'Zorua', 'Purrloin', DRA, FEZ, 'Dhelmise'], 60],
  ] as [string[], number][]) {
    const g = game([{ active: 'Galarian Meowth', energy: { active: [M] }, hand }, { active: DRA }]);
    choose(g, 'Attack: Treasure Rush');
    assert.equal(dmg(g, 1), expected, `${hand.length} cards`);
  }
});

// ------------------------------------------------------------------ Jirachi ex

test('Jirachi ex, Wish Granter: draw cards until you have 7 cards in your hand (from 2; from 7 or more, none)', () => {
  const g = game([{ active: 'Jirachi ex', energy: { active: [W] }, hand: ['Zorua', 'Purrloin'] }, { active: DRA }]);
  choose(g, 'Attack: Wish Granter');
  assert.equal(g.state.p[0].hand.length, 7);
  const full = game([{ active: 'Jirachi ex', energy: { active: [W] }, hand: ['Zorua', 'Zorua', 'Zorua', 'Purrloin', 'Purrloin', 'Purrloin', 'Dhelmise', 'Dhelmise', 'Dhelmise'] }, { active: DRA }]);
  choose(full, 'Attack: Wish Granter');
  assert.equal(full.state.p[0].hand.length, 9, 'nothing is discarded or drawn');
});

test("Jirachi ex, Swift: 150, not affected by Weakness (Lillie's Clefairy ex is weak to {M})", () => {
  const g = game([{ active: 'Jirachi ex', energy: { active: [W, W, W] } }, { active: CLEF }]);
  choose(g, 'Attack: Swift');
  assert.equal(dmg(g, 1), 150, 'not 300');
});

test("Jirachi ex, Swift: not affected by effects on the opponent's Active Pokémon (Zamazenta's Shield Press, -50)", () => {
  const g = game([{ active: 'Jirachi ex', energy: { active: [W, W, W] } }, { active: 'Zamazenta', energy: { active: [M, M, M] } }], OPP_TURN);
  choose(g, 'Attack: Shield Press');
  choose(g, 'Attack: Swift');
  assert.equal(countIn(g, g.state.p[1].discard, 'Zamazenta'), 1, '150 Knocks Out its 130 HP; with the 50 less it would survive on 30');
});

// ------------------------------------------------------------------ Dialga

test('Dialga, Reversed Clock: shuffle up to 3 Pokémon and Basic Energy cards from your discard pile into your deck, in any combination', () => {
  const g = gameE([
    { active: 'Dialga', energy: { active: [W] }, discard: ['Zorua', 'Purrloin', F, M, 'Legacy Energy', 'Ultra Ball'] },
    { active: DRA },
  ]);
  const deckBefore = g.state.p[0].deck.length;
  choose(g, 'Attack: Reversed Clock');
  assert.ok(!has(g, 'Legacy Energy') && !has(g, 'Ultra Ball'), 'only Pokémon and Basic Energy');
  pick(g, ['Zorua', 'Fighting Energy', 'Metal Energy']);
  assert.equal(g.state.p[0].deck.length, deckBefore + 3);
  assert.deepEqual(namesOf(g, g.state.p[0].discard), ['Legacy Energy', 'Purrloin', 'Ultra Ball']);
  assert.ok(g.events.some((e) => e.type === 'shuffle'));
});

test('Dialga, Reversed Clock: up to 3, so none is allowed (an attack)', () => {
  const g = game([{ active: 'Dialga', energy: { active: [W] }, discard: ['Zorua', F] }, { active: DRA }]);
  const deckBefore = g.state.p[0].deck.length;
  choose(g, 'Attack: Reversed Clock');
  g.submit([]);
  assert.equal(g.state.p[0].deck.length, deckBefore);
  assert.equal(g.state.p[0].discard.length, 2);
});

// ------------------------------------------------------------------ Ferrothorn

test("Ferrothorn, Kaboom Needles: 50 to each of the opponent's Pokémon (Weakness only on the Active one), and 130 to itself", () => {
  const g = game([{ active: 'Ferrothorn', bench: ['Zorua'], energy: { active: [M, M] } }, { active: CLEF, bench: [FEZ, 'Zorua'] }]);
  choose(g, 'Attack: Kaboom Needles');
  assert.equal(dmg(g, 1), 100, "the Active Pokémon is weak to {M}: 50 x 2");
  assert.equal(g.state.p[1].bench[0]!.damage, 50, 'Benched: no Weakness');
  assert.equal(g.state.p[1].bench[1]!.damage, 50);
  assert.equal(countIn(g, g.state.p[0].discard, 'Ferrothorn'), 1, '130 damage Knocks Out its 130 HP');
});

test("Ferrothorn, Kaboom Needles: the damage to itself is 130 with no Weakness applied, and the opponent's Pokémon on the Bench are all hit", () => {
  const g = game([{ active: 'Ferrothorn', bench: ['Zorua', 'Purrloin'], energy: { active: [M, M] }, tools: { active: ['Air Balloon'] } }, { active: DRA, bench: [FEZ] }]);
  choose(g, 'Attack: Kaboom Needles');
  assert.equal(dmg(g, 1), 50);
  assert.equal(g.state.p[1].bench[0]!.damage, 50);
  assert.equal(countIn(g, g.state.p[0].discard, 'Ferrothorn'), 1);
});

// ------------------------------------------------------------------ Solgaleo

test('Solgaleo, Sunrise: on the Bench, attach up to 2 Basic Metal Energy cards from the deck to it, then shuffle', () => {
  const g = gameE([{ active: 'Zorua', bench: ['Solgaleo'] }, { active: DRA }]);
  choose(g, 'Use Sunrise');
  pick(g, ['Metal Energy', 'Metal Energy']);
  assert.deepEqual(namesOf(g, g.state.p[0].bench[0]!.energy), ['Metal Energy', 'Metal Energy']);
  assert.ok(g.events.some((e) => e.type === 'shuffle'));
  assert.ok(!has(g, 'Use Sunrise'), 'once during your turn');
});

test('Solgaleo, Sunrise: only Basic Metal Energy can be chosen, and a single card is a legal choice (1 to 2)', () => {
  const g = game([{ active: 'Zorua', bench: ['Solgaleo'] }, { active: DRA }]);
  choose(g, 'Use Sunrise');
  assert.ok(labels(g).every((l) => l.includes('Metal Energy')), `only Metal: ${labels(g).join(' | ')}`);
  pick(g, ['Metal Energy']);
  assert.equal(g.state.p[0].bench[0]!.energy.length, 1);
});

test('Solgaleo, Sunrise: not while it is the Active Pokémon', () => {
  const g = game([{ active: 'Solgaleo', bench: ['Zorua'] }, { active: DRA }]);
  assert.ok(!has(g, 'Use Sunrise'));
});

test('Solgaleo, Sunsteel Strike: 220, then discard all Energy from it', () => {
  const g = game([{ active: 'Solgaleo', energy: { active: [M, M, W, W] } }, { active: DRA }]);
  choose(g, 'Attack: Sunsteel Strike');
  assert.equal(dmg(g, 1), 220);
  assert.equal(g.state.p[0].active!.energy.length, 0);
  assert.equal(g.state.p[0].discard.length, 4);
});

// ------------------------------------------------------------------ Zacian

test('Zacian, Hardened Blade: 40 more damage with a Pokémon Tool attached (20 -> 60), 20 without', () => {
  const tool = game([{ active: 'Zacian', energy: { active: [M] }, tools: { active: ['Air Balloon'] } }, { active: DRA }]);
  choose(tool, 'Attack: Hardened Blade');
  assert.equal(dmg(tool, 1), 60);
  const bare = game([{ active: 'Zacian', energy: { active: [M] } }, { active: DRA }]);
  choose(bare, 'Attack: Hardened Blade');
  assert.equal(dmg(bare, 1), 20);
});

test("Zacian, Hardened Blade: a Tool on the Defending Pokémon doesn't count", () => {
  const g = game([{ active: 'Zacian', energy: { active: [M] } }, { active: DRA, tools: { active: ['Air Balloon'] } }]);
  choose(g, 'Attack: Hardened Blade');
  assert.equal(dmg(g, 1), 20);
});

test("Zacian, Slashing Strike: 120, and during your next turn it can't use Slashing Strike (it can the turn after)", () => {
  const g = game([{ active: 'Zacian', energy: { active: [M, M, M] } }, { active: DRA }]);
  choose(g, 'Attack: Slashing Strike');
  assert.equal(dmg(g, 1), 120);
  choose(g, 'End turn'); // the opponent's turn
  assert.ok(has(g, 'Attack: Hardened Blade'), 'the other attack is still there');
  assert.ok(!has(g, 'Attack: Slashing Strike'), "can't use Slashing Strike during your next turn");
  choose(g, 'Attack: Hardened Blade');
  choose(g, 'End turn');
  assert.ok(has(g, 'Attack: Slashing Strike'), 'the turn after, it can');
});

// ------------------------------------------------------------------ Zamazenta

test("Zamazenta, Fend Off: before doing damage, discard all Pokémon Tools from the opponent's Active Pokémon, then 20", () => {
  const g = game([{ active: 'Zamazenta', energy: { active: [M] } }, { active: DRA, bench: [FEZ], tools: { active: ['Air Balloon'], 0: ['Air Balloon'] } }]);
  choose(g, 'Attack: Fend Off');
  assert.equal(dmg(g, 1), 20);
  assert.equal(g.state.p[1].active!.tools.length, 0);
  assert.equal(countIn(g, g.state.p[1].discard, 'Air Balloon'), 1);
  assert.equal(g.state.p[1].bench[0]!.tools.length, 1, 'a Benched Pokémon keeps its Tool');
});

test('Zamazenta, Shield Press: 100, and during the opponent\'s next turn it takes 50 less damage from attacks (70 -> 20)', () => {
  const g = game([{ active: 'Zamazenta', energy: { active: [M, M, M] } }, { active: DRA, energy: { active: [P] } }]);
  choose(g, 'Attack: Shield Press');
  assert.equal(dmg(g, 1), 100);
  choose(g, 'Attack: Jet Headbutt');
  assert.equal(dmg(g, 0), 20);
});

test('Zamazenta, Shield Press: damage of 50 or less is cut to nothing, and the effect ends after that turn', () => {
  const g = game([{ active: 'Zamazenta', energy: { active: [M, M, M] } }, { active: 'Koraidon', energy: { active: [F, F] } }]);
  choose(g, 'Attack: Shield Press');
  choose(g, 'Attack: Low Kick'); // 50
  assert.equal(dmg(g, 0), 0, 'a weak attack is cut to 0');
  choose(g, 'End turn');
  choose(g, 'Attack: Low Kick');
  assert.equal(dmg(g, 0), 50, 'the turn after, the effect is gone');
});
