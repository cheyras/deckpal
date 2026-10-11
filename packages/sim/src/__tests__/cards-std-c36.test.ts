/**
 * Card tests, batch "std-c36": every card scripted in cards/scripts/std-c36.ts does what its printed text says in a
 * constructed position, and every TPCi ruling cited in the script is pinned here. Quotes are the printed text from frames.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { def } from '../context.js';
import { describeOptions } from '../describe.js';
import type { Game } from '../game.js';
import { maxHp } from '../query.js';
import { scenario, type SideLayout } from '../scenario.js';
import { POISONED, type Decision } from '../types.js';
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

const ENERGY: [string, number][] = ['mee-001', 'mee-002', 'mee-003', 'mee-004', 'mee-005', 'mee-006', 'mee-007', 'mee-008'].map((id) => [id, 10]);
const IDS: Record<string, string> = {
  'Excadrill ex': 'sv10.5b-046',
  Gurdurr: 'sv10.5b-048',
  Conkeldurr: 'sv10.5b-049',
  Throh: 'sv10.5b-050',
  Crustle: 'sv10.5b-052',
  Landorus: 'sv10.5b-053',
  Whirlipede: 'sv10.5b-055',
  Scolipede: 'sv10.5b-056',
  Sandile: 'sv10.5b-057',
  Krokorok: 'sv10.5b-058',
  Krookodile: 'sv10.5b-059',
  Klink: 'sv10.5b-061',
  Klang: 'sv10.5b-062',
  Klinklang: 'sv10.5b-063',
  Bisharp: 'sv10.5b-065',
  Cobalion: 'sv10.5b-066',
  Haxorus: 'sv10.5b-070',
  Pidove: 'sv10.5b-071',
  Tranquill: 'sv10.5b-072',
  Cinccino: 'sv10.5b-076',
  'Energy Coin': 'sv10.5b-081',
  Fennel: 'sv10.5b-082',
  "N's Plan": 'sv10.5b-083',
  Swadloon: 'sv10.5w-002',
  Leavanny: 'sv10.5w-003',
  'Dragapult ex': 'sv06-130', // Stage 2, 320 HP, no Weakness or Resistance
  'Yveltal ex': 'me03-053', // Basic, Resistance {F} -30
  'Mega Sharpedo ex': 'me02-113', // Retreat Cost 0, no Resistance
  'Teal Mask Ogerpon ex': 'sv06-025', // a Tera Pokémon (so is Dragapult ex: it takes no attack damage on the Bench)
  'Air Balloon': 'sv10.5b-079',
  'Legacy Energy': 'sv06-167',
  'Prism Energy': 'me02.5-216',
  'Ignition Energy': 'sv10.5w-086',
};
/** A test deck of the named cards (4 of each) plus plenty of every basic Energy. */
function deck(...cards: string[]) {
  return fromIds('c36', [...[...new Set(cards)].map((n): [string, number] => [IDS[n] ?? n, 4]), ...ENERGY]);
}
const DRA = 'Dragapult ex';
const EXC = 'Excadrill ex';
const G = 'Grass Energy';
const R = 'Fire Energy';
const W = 'Water Energy';
const P = 'Psychic Energy';
const D = 'Darkness Energy';
const M = 'Metal Energy';
const F = 'Fighting Energy';
type Sides = [SideLayout, SideLayout];
const OPP_TURN = { current: 1 as const, turn: 4 };
const DK = deck(...Object.keys(IDS));
const mk = (sides: Sides, o = {}): Game => scenario(DK, DK, sides, o);

// ------------------------------------------------------------------ Excadrill ex

test('Excadrill ex, Piercing Drill: 60 damage, and 60 more to 1 of the opponent\'s Benched Pokémon that has damage counters on it', () => {
  const g = mk([
    { active: EXC, energy: { active: [F, F] } },
    { active: DRA, bench: ['Gurdurr', 'Landorus', 'Pidove'], damage: { 0: 10, 1: 10 } },
  ]);
  choose(g, 'Attack: Piercing Drill');
  assert.equal(g.decision?.min, 1);
  assert.ok(labels(g).length === 2, `only the damaged Benched Pokémon are offered: ${labels(g).join(' | ')}`);
  choose(g, 'Gurdurr');
  assert.equal(dmg(g, 1), 60);
  assert.equal(g.state.p[1].bench[0]!.damage, 70, '10 + 60 (no Weakness or Resistance on the Bench)');
  assert.equal(g.state.p[1].bench[1]!.damage, 10, 'the other damaged Benched Pokémon is untouched');
  assert.equal(g.state.p[1].bench[2]!.damage, 0, 'an undamaged Benched Pokémon is not a target');
});

test('Excadrill ex, Piercing Drill: with no damaged Benched Pokémon only the Defending Pokémon is hit', () => {
  const g = mk([
    { active: EXC, energy: { active: [F, F] } },
    { active: DRA, bench: ['Gurdurr', 'Pidove'] },
  ]);
  choose(g, 'Attack: Piercing Drill');
  assert.equal(g.state.turn, 4, 'no choice was asked');
  assert.equal(dmg(g, 1), 60);
  assert.deepEqual(g.state.p[1].bench.map((b) => b.damage), [0, 0]);
});

test("Excadrill ex, Rock Tumble: 200 damage that isn't affected by Resistance", () => {
  const g = mk([{ active: EXC, energy: { active: [F, F, F] } }, { active: 'Yveltal ex' }]);
  choose(g, 'Attack: Rock Tumble');
  assert.equal(dmg(g, 1), 200, 'Yveltal ex has Resistance {F} -30');
  const resisted = mk([{ active: EXC, energy: { active: [F, F] } }, { active: 'Yveltal ex' }]);
  choose(resisted, 'Attack: Piercing Drill');
  assert.equal(dmg(resisted, 1), 30, 'Piercing Drill is resisted');
});

// ------------------------------------------------------------------ Gurdurr

test("Gurdurr, Hammer Arm: 60 damage and the top card of the opponent's deck is discarded", () => {
  const g = mk([{ active: 'Gurdurr', energy: { active: [F, W, W] } }, { active: DRA, deckTop: [R, G] }]);
  choose(g, 'Attack: Hammer Arm');
  assert.equal(dmg(g, 1), 60);
  assert.deepEqual(g.state.p[1].discard.map((c) => nameOf(g, c)), [R]);
});

// ------------------------------------------------------------------ Conkeldurr

const hpOf = (g: Game): number => maxHp(g.envForInternals, g.state, g.state.p[0].active!);

test('Conkeldurr, Craftsmanship: +40 HP for each {F} Energy attached to it (other types do not count)', () => {
  const at = (energy: string[]): number => hpOf(mk([{ active: 'Conkeldurr', energy: { active: energy } }, { active: DRA }]));
  assert.equal(at([]), 140);
  assert.equal(at([F]), 180);
  assert.equal(at([F, F]), 220);
  assert.equal(at([F, F, F, W, W]), 260);
  assert.equal(at([W, R]), 140);
});

test('Conkeldurr, Craftsmanship: an Energy card that provides every type counts once (Compendium #2179, Luminous Energy)', () => {
  // Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/2179/): "Yes, it does." Legacy Energy provides every type, like Luminous Energy.
  assert.equal(hpOf(mk([{ active: 'Conkeldurr', energy: { active: ['Legacy Energy'] } }, { active: DRA }])), 180);
});

test('Conkeldurr, Craftsmanship: Prism Energy gives no HP, as Conkeldurr is not a Basic Pokémon (Compendium #2180)', () => {
  // Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/2180/): "No it does not, because Conkeldurr is not a Basic Pokemon."
  assert.equal(hpOf(mk([{ active: 'Conkeldurr', energy: { active: ['Prism Energy'] } }, { active: DRA }])), 140);
});

test('Conkeldurr, Swing Around: 100 damage, and 50 more for each heads of 2 coins', () => {
  const run = (coins: boolean[]): number => {
    const g = mk([{ active: 'Conkeldurr', energy: { active: [F, W, W, W] } }, { active: DRA }]);
    g.state.forcedCoins = coins;
    choose(g, 'Attack: Swing Around');
    return dmg(g, 1);
  };
  assert.equal(run([false, false]), 100);
  assert.equal(run([true, false]), 150);
  assert.equal(run([true, true]), 200);
});

// ------------------------------------------------------------------ Throh

test('Throh, Shoulder Throw: 30 less damage for each {C} in the Defending Pokémon\'s Retreat Cost', () => {
  const run = (foe: string, tools: string[] = []): number => {
    const g = mk([{ active: 'Throh', energy: { active: [F, W] } }, { active: foe, tools: { active: tools } }]);
    choose(g, 'Attack: Shoulder Throw');
    return dmg(g, 1);
  };
  assert.equal(run('Mega Sharpedo ex'), 120, 'Retreat Cost 0');
  assert.equal(run(DRA), 90, 'Retreat Cost 1');
  assert.equal(run(EXC), 30, 'Retreat Cost 3');
});

test('Throh, Shoulder Throw: the Retreat Cost the Defending Pokémon has now counts (Compendium #2203, Air Balloon)', () => {
  // Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/2203/): "The opponent's Retreat Cost is {C} thanks to Air Balloon, so Shoulder Throw only does 30 less damage."
  const g = mk([{ active: 'Throh', energy: { active: [F, W] } }, { active: EXC, tools: { active: ['Air Balloon'] } }]);
  choose(g, 'Attack: Shoulder Throw');
  assert.equal(dmg(g, 1), 90);
});

// ------------------------------------------------------------------ Crustle

test('Crustle, Sturdy: at full HP it survives a Knock Out with 10 HP left; with any damage on it, it is Knocked Out', () => {
  const full = mk([{ active: 'Crustle', bench: [DRA] }, { active: EXC, energy: { active: [F, F, F] } }], OPP_TURN);
  choose(full, 'Attack: Rock Tumble');
  assert.equal(dmg(full, 0), 140, 'Crustle (150 HP) is left with 10 HP');
  assert.equal(full.state.p[1].prizesTaken, 0);
  const hurt = mk([{ active: 'Crustle', bench: [DRA], damage: { active: 10 } }, { active: EXC, energy: { active: [F, F, F] } }], OPP_TURN);
  choose(hurt, 'Attack: Rock Tumble');
  assert.equal(hurt.state.p[1].prizesTaken, 1);
  assert.ok(namesOf(hurt, hurt.state.p[0].discard).includes('Crustle'));
});

test('Crustle, Stone Edge: 80 damage, and 60 more with heads', () => {
  const run = (heads: boolean): number => {
    const g = mk([{ active: 'Crustle', energy: { active: [F, W, W] } }, { active: DRA }]);
    g.state.forcedCoins = [heads];
    choose(g, 'Attack: Stone Edge');
    return dmg(g, 1);
  };
  assert.equal(run(false), 80);
  assert.equal(run(true), 140);
});

// ------------------------------------------------------------------ Landorus

test('Landorus, Abundant Harvest: attach a Basic {F} Energy card from your discard pile to this Pokémon', () => {
  const g = mk([{ active: 'Landorus', energy: { active: [W] }, discard: [F, W, R] }, { active: DRA }]);
  choose(g, 'Attack: Abundant Harvest');
  assert.deepEqual(g.state.p[0].active!.energy.map((c) => nameOf(g, c)), [W, F]);
  assert.deepEqual(namesOf(g, g.state.p[0].discard), [R, W]);
});

test('Landorus, Earthquake: 110 damage, and 10 to each of your Benched Pokémon', () => {
  const g = mk([{ active: 'Landorus', energy: { active: [F, W, W] }, bench: ['Pidove', 'Gurdurr'] }, { active: DRA, bench: ['Pidove'] }]);
  choose(g, 'Attack: Earthquake');
  assert.equal(dmg(g, 1), 110);
  assert.deepEqual(g.state.p[0].bench.map((b) => b.damage), [10, 10]);
  assert.equal(g.state.p[1].bench[0]!.damage, 0, "the opponent's Bench is untouched");
  assert.equal(dmg(g, 0), 0, 'the attacker is untouched');
});

test('Landorus, Earthquake: a Tera Pokémon on your Bench takes no damage from it (Compendium #2190)', () => {
  // Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/2190/): "No, the Tera Trait protects them from damage by your own attacks as well."
  const g = mk([{ active: 'Landorus', energy: { active: [F, W, W] }, bench: ['Teal Mask Ogerpon ex', 'Pidove'] }, { active: DRA }]);
  choose(g, 'Attack: Earthquake');
  assert.deepEqual(g.state.p[0].bench.map((b) => b.damage), [0, 10]);
});

// ------------------------------------------------------------------ Whirlipede / Scolipede

test('Whirlipede, Venoshock: 30 damage, and 60 more if the Defending Pokémon is Poisoned', () => {
  const plain = mk([{ active: 'Whirlipede', energy: { active: [D] } }, { active: DRA }]);
  choose(plain, 'Attack: Venoshock');
  assert.equal(dmg(plain, 1), 30);
  const sick = mk([{ active: 'Whirlipede', energy: { active: [D] } }, { active: DRA, cond: POISONED }]);
  choose(sick, 'Attack: Venoshock');
  assert.equal(dmg(sick, 1), 100, '30 + 60, and 10 more from Poison at Pokémon Checkup');
});

test('Scolipede, Venoshock: 90 damage, and 90 more if the Defending Pokémon is Poisoned', () => {
  const plain = mk([{ active: 'Scolipede', energy: { active: [D, D] } }, { active: DRA }]);
  choose(plain, 'Attack: Venoshock');
  assert.equal(dmg(plain, 1), 90);
  const sick = mk([{ active: 'Scolipede', energy: { active: [D, D] } }, { active: DRA, cond: POISONED }]);
  choose(sick, 'Attack: Venoshock');
  assert.equal(dmg(sick, 1), 190, '90 + 90, and 10 more from Poison at Pokémon Checkup');
});

test('Scolipede, Poison Point: the Pokémon that damages it while it is Active is Poisoned, even if it is Knocked Out', () => {
  const g = mk([{ active: 'Scolipede', bench: [DRA] }, { active: EXC, energy: { active: [F, F] } }], OPP_TURN);
  choose(g, 'Attack: Piercing Drill');
  assert.equal(dmg(g, 0), 60);
  assert.equal(g.state.p[1].active!.cond & POISONED, POISONED);
  const ko = mk([{ active: 'Scolipede', bench: [DRA], damage: { active: 120 } }, { active: EXC, energy: { active: [F, F] } }], OPP_TURN);
  choose(ko, 'Attack: Piercing Drill');
  assert.equal(ko.state.p[1].prizesTaken, 1, 'Scolipede was Knocked Out');
  assert.equal(ko.state.p[1].active!.cond & POISONED, POISONED, 'the Ability still worked');
});

test('Scolipede, Poison Point: does nothing when Scolipede is damaged on the Bench', () => {
  const g = mk([{ active: DRA, bench: ['Scolipede'], damage: { 0: 10 } }, { active: EXC, energy: { active: [F, F] } }], OPP_TURN);
  choose(g, 'Attack: Piercing Drill');
  assert.equal(g.state.p[0].bench[0]!.damage, 70);
  assert.equal(g.state.p[1].active!.cond & POISONED, 0);
});

// ------------------------------------------------------------------ Sandile / Krokorok / Krookodile

test('Sandile, Tighten Up: 10 damage, and the opponent discards a card from their hand (their choice)', () => {
  const g = mk([{ active: 'Sandile', energy: { active: [D] } }, { active: DRA, hand: ['Pidove', 'Gurdurr', R] }]);
  choose(g, 'Attack: Tighten Up');
  assert.equal(g.decision?.player, 1, 'the opponent chooses');
  choose(g, 'Gurdurr');
  assert.equal(dmg(g, 1), 10);
  assert.deepEqual(namesOf(g, g.state.p[1].discard), ['Gurdurr']);
  assert.deepEqual(g.state.p[1].hand.slice(0, 2).map((c) => nameOf(g, c)), ['Pidove', R], 'the other two stay (the third card is the opponent draws for their turn)');
});

test('Krokorok, Tighten Up: 40 damage, and the opponent discards 2 cards from their hand (their choice)', () => {
  const g = mk([{ active: 'Krokorok', energy: { active: [D, D] } }, { active: DRA, hand: ['Pidove', 'Gurdurr', R] }]);
  choose(g, 'Attack: Tighten Up');
  assert.equal(g.decision?.player, 1);
  assert.equal(g.decision?.min, 2);
  assert.equal(g.decision?.max, 2);
  pick(g, ['Pidove', R]);
  assert.equal(dmg(g, 1), 40);
  assert.deepEqual(namesOf(g, g.state.p[1].discard), [R, 'Pidove'].sort());
  assert.equal(nameOf(g, g.state.p[1].hand[0]!), 'Gurdurr', 'the other card stays (then the opponent draws for their turn)');
});

test('Krookodile, Tighten Up: 60 damage, and the opponent discards 2 cards from their hand (their choice)', () => {
  const g = mk([{ active: 'Krookodile', energy: { active: [D, D] } }, { active: DRA, hand: ['Pidove', 'Gurdurr', R, W] }]);
  choose(g, 'Attack: Tighten Up');
  assert.equal(g.decision?.player, 1);
  pick(g, ['Gurdurr', W]);
  assert.equal(dmg(g, 1), 60);
  assert.deepEqual(namesOf(g, g.state.p[1].discard), [W, 'Gurdurr'].sort());
  assert.deepEqual(g.state.p[1].hand.slice(0, 2).map((c) => nameOf(g, c)), ['Pidove', R], 'the other two stay (then the opponent draws for their turn)');
});

test('Krookodile, Cursed Slug: 120 damage, and 120 more if the opponent has 3 or fewer cards in hand', () => {
  const run = (hand: string[]): number => {
    const g = mk([{ active: 'Krookodile', energy: { active: [D, D, W] } }, { active: DRA, hand }]);
    choose(g, 'Attack: Cursed Slug');
    return dmg(g, 1);
  };
  assert.equal(run([R, R, R, R]), 120);
  assert.equal(run([R, R, R]), 240);
  assert.equal(run([]), 240);
});

// ------------------------------------------------------------------ Klink / Klang / Klinklang

test("Klink, Hard Gears: 10 damage, and during the opponent's next turn this Pokémon takes 10 less damage from attacks", () => {
  const g = mk([{ active: 'Klink', energy: { active: [M] } }, { active: EXC, energy: { active: [F, F] } }]);
  choose(g, 'Attack: Hard Gears');
  assert.equal(dmg(g, 1), 10);
  choose(g, 'Attack: Piercing Drill');
  assert.equal(dmg(g, 0), 50, '60 - 10');
});

test("Klang, Hard Gears: 50 damage, and during the opponent's next turn this Pokémon takes 20 less damage from attacks", () => {
  const g = mk([{ active: 'Klang', energy: { active: [M, M] } }, { active: EXC, energy: { active: [F, F] } }]);
  choose(g, 'Attack: Hard Gears');
  assert.equal(dmg(g, 1), 50);
  choose(g, 'Attack: Piercing Drill');
  assert.equal(dmg(g, 0), 40, '60 - 20');
});

test("Klinklang, Gear Coating: your Pokémon with any {M} Energy attached take 20 less damage from the opponent's attacks", () => {
  const side: SideLayout = {
    active: 'Klinklang',
    energy: { active: [M], 0: ['Legacy Energy'], 1: [R] },
    bench: ['Landorus', 'Gurdurr', 'Pidove'],
    damage: { 0: 10, 1: 10 },
  };
  const hit = (target: string): Game => {
    const g = mk([side, { active: EXC, energy: { active: [F, F] } }], OPP_TURN);
    choose(g, 'Attack: Piercing Drill');
    choose(g, target);
    return g;
  };
  const a = hit('Landorus');
  assert.equal(dmg(a, 0), 40, 'Klinklang has {M} Energy: 60 - 20');
  assert.equal(a.state.p[0].bench[0]!.damage, 50, 'Legacy Energy provides {M}: 10 + 60 - 20');
  const b = hit('Gurdurr');
  assert.equal(b.state.p[0].bench[1]!.damage, 70, 'Fire Energy only: 10 + 60');
});

test('Klinklang, Gear Coating: a Pokémon with no {M} Energy attached takes full damage, Klinklang included', () => {
  const g = mk([{ active: 'Klinklang', energy: { active: [R] }, bench: [DRA] }, { active: EXC, energy: { active: [F, F] } }], OPP_TURN);
  choose(g, 'Attack: Piercing Drill');
  assert.equal(dmg(g, 0), 60);
});

// ------------------------------------------------------------------ Bisharp / Cobalion / Haxorus

test('Bisharp, Finishing Blow: 60 damage, and 60 more if the Defending Pokémon already has damage counters', () => {
  const plain = mk([{ active: 'Bisharp', energy: { active: [M, W] } }, { active: DRA }]);
  choose(plain, 'Attack: Finishing Blow');
  assert.equal(dmg(plain, 1), 60);
  const hurt = mk([{ active: 'Bisharp', energy: { active: [M, W] } }, { active: DRA, damage: { active: 10 } }]);
  choose(hurt, 'Attack: Finishing Blow');
  assert.equal(dmg(hurt, 1), 130, '10 + 60 + 60');
});

test('Cobalion, Righteous Edge: 20 damage, and a Special Energy is discarded from the Defending Pokémon (a Basic one is not)', () => {
  const g = mk([{ active: 'Cobalion', energy: { active: [M] } }, { active: DRA, energy: { active: [W, 'Legacy Energy'] } }]);
  choose(g, 'Attack: Righteous Edge');
  assert.equal(dmg(g, 1), 20);
  assert.deepEqual(g.state.p[1].active!.energy.map((c) => nameOf(g, c)), [W]);
  assert.deepEqual(namesOf(g, g.state.p[1].discard), ['Legacy Energy']);
  const basic = mk([{ active: 'Cobalion', energy: { active: [M] } }, { active: DRA, energy: { active: [W, R] } }]);
  choose(basic, 'Attack: Righteous Edge');
  assert.equal(basic.state.p[1].active!.energy.length, 2, 'only Basic Energy: nothing is discarded');
});

test('Cobalion, Metal Arms: 80 damage, and 40 more if this Pokémon has a Pokémon Tool attached', () => {
  const plain = mk([{ active: 'Cobalion', energy: { active: [M, M, W] } }, { active: DRA }]);
  choose(plain, 'Attack: Metal Arms');
  assert.equal(dmg(plain, 1), 80);
  const tooled = mk([{ active: 'Cobalion', energy: { active: [M, M, W] }, tools: { active: ['Air Balloon'] } }, { active: DRA }]);
  choose(tooled, 'Attack: Metal Arms');
  assert.equal(dmg(tooled, 1), 120);
});

test('Haxorus, Cross-Cut: 80 damage, and 80 more if the Defending Pokémon is an Evolution Pokémon', () => {
  const basic = mk([{ active: 'Haxorus', energy: { active: [W, W] } }, { active: 'Landorus' }]);
  choose(basic, 'Attack: Cross-Cut');
  assert.equal(dmg(basic, 1), 80);
  const evo = mk([{ active: 'Haxorus', energy: { active: [W, W] } }, { active: DRA }]);
  choose(evo, 'Attack: Cross-Cut');
  assert.equal(dmg(evo, 1), 160);
});

test('Haxorus, Axe Blast: a Basic Defending Pokémon is Knocked Out; an Evolution Pokémon is not', () => {
  const basic = mk([{ active: 'Haxorus', energy: { active: [F, M, W] } }, { active: 'Landorus', bench: ['Pidove'] }]);
  choose(basic, 'Attack: Axe Blast');
  assert.equal(basic.state.p[0].prizesTaken, 1);
  assert.ok(namesOf(basic, basic.state.p[1].discard).includes('Landorus'));
  const evo = mk([{ active: 'Haxorus', energy: { active: [F, M, W] } }, { active: DRA, bench: ['Pidove'] }]);
  choose(evo, 'Attack: Axe Blast');
  assert.equal(evo.state.p[0].prizesTaken, 0);
  assert.equal(dmg(evo, 1), 0, 'no damage either');
});

// ------------------------------------------------------------------ Pidove / Tranquill / Cinccino

test('Pidove, Scout: your opponent reveals their hand', () => {
  const g = mk([{ active: 'Pidove', energy: { active: [W] } }, { active: DRA, hand: [R, 'Gurdurr', 'Fennel'] }]);
  assert.equal(g.state.p[1].revealed.length, 0);
  choose(g, 'Attack: Scout');
  assert.deepEqual(namesOf(g, g.state.p[1].revealed), ['Fennel', 'Gurdurr', R].sort());
});

test("Tranquill, Fly: heads is 40 damage and no damage or effects from attacks done to it during the opponent's next turn; tails does nothing", () => {
  const heads = mk([{ active: 'Tranquill', energy: { active: [W, W] }, bench: [DRA] }, { active: EXC, energy: { active: [F, F] }, bench: ['Pidove'] }]);
  heads.state.forcedCoins = [true];
  choose(heads, 'Attack: Fly');
  assert.equal(dmg(heads, 1), 40);
  choose(heads, 'Attack: Piercing Drill');
  assert.equal(dmg(heads, 0), 0, 'all damage prevented');

  const tails = mk([{ active: 'Tranquill', energy: { active: [W, W] }, bench: [DRA] }, { active: EXC, energy: { active: [F, F] }, bench: ['Pidove'] }]);
  tails.state.forcedCoins = [false];
  choose(tails, 'Attack: Fly');
  assert.equal(dmg(tails, 1), 0, 'tails: the attack does nothing');
  choose(tails, 'Attack: Piercing Drill');
  assert.equal(dmg(tails, 0), 60, 'and nothing protects Tranquill');
});

test('Cinccino, Do the Wave: 20 damage, and 20 more for each of your Benched Pokémon', () => {
  const run = (bench: string[], oppBench: string[] = []): number => {
    const g = mk([{ active: 'Cinccino', energy: { active: [W] }, bench }, { active: DRA, bench: oppBench }]);
    choose(g, 'Attack: Do the Wave');
    return dmg(g, 1);
  };
  assert.equal(run([]), 20);
  assert.equal(run(['Pidove', 'Gurdurr']), 60);
  assert.equal(run(['Pidove'], ['Pidove', 'Pidove', 'Pidove']), 40, "the opponent's Bench does not count");
});

// ------------------------------------------------------------------ Energy Coin

test('Energy Coin: 2 heads search the deck for a Basic Energy card and attach it to 1 of your Pokémon, then shuffle', () => {
  const g = mk([{ active: DRA, bench: ['Pidove'], hand: ['Energy Coin'] }, { active: DRA }]);
  g.state.forcedCoins = [true, true];
  const before = g.state.p[0].deck.length;
  choose(g, 'Play Energy Coin');
  assert.equal(g.decision?.min, 0, 'a search may find nothing');
  choose(g, 'Fire Energy');
  choose(g, 'Pidove');
  assert.deepEqual(g.state.p[0].bench[0]!.energy.map((c) => nameOf(g, c)), [R]);
  assert.equal(g.state.p[0].deck.length, before - 1);
  assert.deepEqual(namesOf(g, g.state.p[0].discard), ['Energy Coin']);
});

test('Energy Coin: any tails does nothing (the deck is not searched or shuffled)', () => {
  for (const coins of [[true, false], [false, true], [false, false]]) {
    const g = mk([{ active: DRA, bench: ['Pidove'], hand: ['Energy Coin'] }, { active: DRA }]);
    g.state.forcedCoins = coins;
    const deckBefore = g.state.p[0].deck.slice();
    choose(g, 'Play Energy Coin');
    assert.deepEqual(g.state.p[0].deck, deckBefore, `coins ${coins.join()}`);
    assert.equal(g.state.p[0].active!.energy.length + g.state.p[0].bench[0]!.energy.length, 0);
    assert.deepEqual(namesOf(g, g.state.p[0].discard), ['Energy Coin']);
  }
});

test('Energy Coin: it can be played even with an empty deck (the coin flips are an effect)', () => {
  const g = mk([{ active: DRA, hand: ['Energy Coin'], emptyDeck: true }, { active: DRA }]);
  assert.ok(has(g, 'Play Energy Coin'));
});

// ------------------------------------------------------------------ Fennel

test('Fennel: heal 40 damage from each of your Pokémon', () => {
  const g = mk([{ active: DRA, bench: ['Pidove', 'Gurdurr', 'Landorus'], hand: ['Fennel'], damage: { active: 70, 0: 30, 1: 50 } }, { active: DRA, damage: { active: 70 } }]);
  choose(g, 'Play Fennel');
  assert.equal(dmg(g, 0), 30);
  assert.deepEqual(g.state.p[0].bench.map((b) => b.damage), [0, 10, 0]);
  assert.equal(dmg(g, 1), 70, "the opponent's Pokémon are not healed");
});

test('Fennel: not playable when none of your Pokémon has damage on it', () => {
  const none = mk([{ active: DRA, bench: ['Pidove'], hand: ['Fennel'] }, { active: DRA, damage: { active: 70 } }]);
  assert.ok(!has(none, 'Play Fennel'));
  const some = mk([{ active: DRA, bench: ['Pidove'], hand: ['Fennel'], damage: { 0: 10 } }, { active: DRA }]);
  assert.ok(has(some, 'Play Fennel'));
});

// ------------------------------------------------------------------ N's Plan

test("N's Plan: move up to 2 Energy from your Benched Pokémon to your Active Pokémon (1 to 2 for a Trainer)", () => {
  // Pidove has Fire and Water on it, Gurdurr has Fighting; the Active Pokémon has Psychic.
  const g = mk([{ active: DRA, energy: { active: [P], 0: [R, W], 1: [F] }, bench: ['Pidove', 'Gurdurr'], hand: ["N's Plan"] }, { active: DRA }]);
  choose(g, "Play N's Plan");
  assert.equal(g.decision?.min, 1, '"up to 2" of a Trainer is 1 to 2');
  assert.equal(g.decision?.max, 2);
  pick(g, [W, F]);
  assert.deepEqual(g.state.p[0].active!.energy.map((c) => nameOf(g, c)).sort(), [F, P, W].sort());
  assert.deepEqual(g.state.p[0].bench[0]!.energy.map((c) => nameOf(g, c)), [R]);
  assert.deepEqual(g.state.p[0].bench[1]!.energy, []);
});

test("N's Plan: Energy cards that provide more than one Energy can be moved, 2 of them (Compendium #2205)", () => {
  // Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/2205/): "Yes, you can. ... you could move either 1 or 2 Double Turbo Energy cards."
  // Ignition Energy provides {C}{C}{C} on an Evolution Pokémon.
  const g = mk([{ active: DRA, bench: ['Gurdurr'], energy: { 0: ['Ignition Energy', 'Ignition Energy', 'Ignition Energy'] }, hand: ["N's Plan"] }, { active: DRA }]);
  choose(g, "Play N's Plan");
  assert.equal(g.decision?.max, 2, 'the limit counts cards');
  pick(g, ['Ignition Energy', 'Ignition Energy']);
  assert.equal(g.state.p[0].active!.energy.length, 2);
  assert.equal(g.state.p[0].bench[0]!.energy.length, 1);
  const one = mk([{ active: DRA, bench: ['Gurdurr'], energy: { 0: ['Ignition Energy', R] }, hand: ["N's Plan"] }, { active: DRA }]);
  choose(one, "Play N's Plan");
  pick(one, ['Ignition Energy']);
  assert.equal(one.state.p[0].active!.energy.length, 1);
});

test("N's Plan: not playable when no Benched Pokémon has Energy (Energy on the Active Pokémon does not count)", () => {
  const g = mk([{ active: DRA, energy: { active: [P] }, bench: ['Pidove'], hand: ["N's Plan"] }, { active: DRA }]);
  assert.ok(!has(g, "Play N's Plan"));
  const e = mk([{ active: DRA, bench: ['Pidove'], energy: { 0: [R] }, hand: ["N's Plan"] }, { active: DRA }]);
  assert.ok(has(e, "Play N's Plan"));
});

// ------------------------------------------------------------------ Swadloon

test('Swadloon, Healing Leaves: once during your turn, heal 20 damage from your Active Pokémon (even from the Bench)', () => {
  const g = mk([{ active: DRA, bench: ['Swadloon'], damage: { active: 50 } }, { active: DRA }]);
  assert.ok(has(g, 'Healing Leaves'), labels(g).join(' | '));
  choose(g, 'Healing Leaves');
  assert.equal(dmg(g, 0), 30);
  assert.ok(!has(g, 'Healing Leaves'), 'once during your turn');
});

test('Swadloon, Healing Leaves: not offered when the Active Pokémon has no damage', () => {
  const g = mk([{ active: DRA, bench: ['Swadloon'], damage: { 0: 50 } }, { active: DRA }]);
  assert.ok(!has(g, 'Healing Leaves'));
});

// ------------------------------------------------------------------ Leavanny

test('Leavanny, Healing Wrapping: heal 100 damage from each of your Basic Pokémon', () => {
  const g = mk([
    { active: 'Leavanny', energy: { active: [W] }, bench: ['Pidove', 'Gurdurr', 'Landorus'], damage: { active: 50, 0: 40, 1: 50, 2: 120 } },
    { active: DRA, bench: ['Pidove'], damage: { 0: 30 } },
  ]);
  choose(g, 'Attack: Healing Wrapping');
  assert.equal(dmg(g, 0), 50, 'Leavanny is a Stage 2');
  assert.deepEqual(g.state.p[0].bench.map((b) => b.damage), [0, 50, 20], 'Pidove and Landorus are Basic, Gurdurr is a Stage 1');
  assert.equal(g.state.p[1].bench[0]!.damage, 30, "the opponent's Pokémon are not healed");
});

test('Leavanny, X-Scissor: 90 damage, and 40 more with heads', () => {
  const run = (heads: boolean): number => {
    const g = mk([{ active: 'Leavanny', energy: { active: [G, W] } }, { active: DRA }]);
    g.state.forcedCoins = [heads];
    choose(g, 'Attack: X-Scissor');
    return dmg(g, 1);
  };
  assert.equal(run(false), 90);
  assert.equal(run(true), 130);
});
