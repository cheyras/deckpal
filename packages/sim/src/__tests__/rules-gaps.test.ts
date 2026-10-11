/**
 * Rule tests for gaps the card lanes reported: paying a Retreat Cost and counting attached Energy
 * in Energy UNITS (a card providing {C}{C}{C} pays and counts 3), with synthetic multi-unit Energy;
 * the Tera rule against damage counters; the order of both players' between-turns effects.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { CardScript, Expr } from '../dsl.js';
import { describeOptions } from '../describe.js';
import { evalExpr } from '../eval.js';
import { Game } from '../game.js';
import { scenario, type SideLayout } from '../scenario.js';
import type { CardFrame, Decision } from '../types.js';
import { POISONED } from '../types.js';
import { DOG, FIGHTING, PSYCHIC, PUP, deck, pokemon } from './fixtures.js';

function special(id: string, name: string): CardFrame {
  return {
    cardId: id,
    name,
    category: 'Energy',
    hp: null,
    stage: null,
    suffix: null,
    evolvesFrom: null,
    trainerType: null,
    energyType: 'Special',
    retreat: null,
    types: [],
    effect: 'Synthetic multi-unit Energy.',
    regulationMark: 'I',
    attacks: [],
    abilities: [],
    weaknesses: [],
    resistances: [],
  };
}

// Ignition-like: {C} on a Basic, {C}{C}{C} on an Evolution. Legacy-like: every type, 1 at a time.
// Neo-Upper-like: {C}, or every type 2 at a time on an Evolution.
const TRIPLE = special('t-e01', 'Triple Energy');
const RAINBOW = special('t-e02', 'Rainbow Energy');
const UPPER = special('t-e03', 'Upper Energy');
const SCRIPTS: CardScript[] = [
  { id: 't-e01', name: 'Triple Energy', provides: ['Colorless'], providesIf: { filter: { stage: 'evolution' }, provides: ['Colorless', 'Colorless', 'Colorless'] } },
  { id: 't-e02', name: 'Rainbow Energy', providesAny: { n: 1 } },
  { id: 't-e03', name: 'Upper Energy', provides: ['Colorless'], providesAny: { n: 2, when: { stage: 'evolution' } } },
];

const A = deck('A', [
  [PUP, 12],
  [DOG, 8],
  [TRIPLE, 4],
  [RAINBOW, 4],
  [UPPER, 4],
  [FIGHTING, 14],
  [PSYCHIC, 14],
]);
const B = deck('B', [
  [PUP, 20],
  [FIGHTING, 40],
]);

function at(sides: [SideLayout, SideLayout]): Game {
  return scenario(A, B, sides, { scripts: SCRIPTS });
}
function labels(g: Game): string[] {
  return describeOptions(g.ctx, g.state, g.decision as Decision);
}
function choose(g: Game, text: string): void {
  const i = labels(g).findIndex((l) => l.includes(text));
  assert.ok(i >= 0, `no option containing "${text}" in: ${labels(g).join(' | ')}`);
  g.submit([i]);
}
function name(g: Game, c: number): string {
  return g.ctx.defs[g.ctx.cardDef[c]!]!.name;
}
/** Dog (Stage 1, Retreat Cost 2) Active over a Benched Pup, with this Energy attached. */
function dog(energy: string[]): Game {
  return at([{ active: 'Pup', evolve: { active: ['Dog'] }, bench: ['Pup'], energy: { active: energy } }, { active: 'Pup' }]);
}

test('p.12 retreat is paid in Energy units: one card providing {C}{C}{C} pays a Retreat Cost of 2 on its own', () => {
  const g = dog(['Triple Energy']);
  choose(g, 'Retreat');
  assert.equal(g.decision?.kind, 'main', 'one way to pay: no decision');
  assert.deepEqual(g.state.p[0].discard.map((c) => name(g, c)), ['Triple Energy']);
  assert.equal(name(g, g.state.p[0].active!.cards[0]!), 'Pup');
  assert.equal(g.state.p[0].bench[0]!.cards.length, 2, 'Dog went to the Bench');

  // Upper Energy on an Evolution provides 2 (of every type): it pays 2 too.
  const u = dog(['Upper Energy']);
  choose(u, 'Retreat');
  assert.deepEqual(u.state.p[0].discard.map((c) => name(u, c)), ['Upper Energy']);
});

test('p.12 retreat offers only the sets that cover the cost with no card to spare', () => {
  const g = dog(['Triple Energy', 'Fighting Energy', 'Fighting Energy']);
  choose(g, 'Retreat');
  const d = g.decision as Decision;
  assert.equal(d.kind, 'option');
  // Not Triple + Fighting (the Fighting is to spare); identical Fighting pairs offered once.
  assert.deepEqual(labels(g), ['Discard Fighting Energy + Fighting Energy', 'Discard Triple Energy']);
  choose(g, 'Discard Triple Energy');
  assert.deepEqual(g.state.p[0].discard.map((c) => name(g, c)), ['Triple Energy']);
  assert.equal(g.state.p[0].bench[0]!.energy.length, 2, 'both Fighting Energy stay on Dog');

  const mix = dog(['Triple Energy', 'Fighting Energy', 'Psychic Energy']);
  choose(mix, 'Retreat');
  assert.deepEqual(labels(mix), ['Discard Fighting Energy + Psychic Energy', 'Discard Triple Energy']);
  choose(mix, 'Fighting Energy + Psychic');
  assert.deepEqual(mix.state.p[0].discard.map((c) => name(mix, c)).sort(), ['Fighting Energy', 'Psychic Energy']);
});

test('p.12 retreat with only one-unit Energy is still a pick of exactly the cost in cards', () => {
  // On a Basic, Triple Energy provides {C}: Pup (Retreat Cost 1) picks 1 of 2 cards.
  const g = at([{ active: 'Pup', bench: ['Pup'], energy: { active: ['Triple Energy', 'Fighting Energy'] } }, { active: 'Pup' }]);
  choose(g, 'Retreat');
  const d = g.decision as Decision;
  assert.equal(d.kind, 'cards');
  assert.equal(d.min, 1);
  assert.equal(d.max, 1);
});

test('"for each Energy attached" counts units; type checks count every-type Energy; `cards` counts cards', () => {
  const g = dog(['Triple Energy', 'Rainbow Energy', 'Fighting Energy']);
  const env = g.envForInternals;
  const sl = g.state.p[0].active!;
  const ec = { player: 0 as const, slot: sl.id, vars: {} };
  const v = (e: Expr) => evalExpr(env, g.state, ec, e);
  assert.equal(v({ energyOn: 'self' }), 5, 'Triple 3 + Rainbow 1 + Fighting 1');
  assert.equal(v({ energyOn: 'self', cards: true }), 3, 'three Energy cards');
  assert.equal(v({ energyOn: 'self', type: 'Fighting' }), 2, 'Fighting Energy + Rainbow (every type)');
  assert.equal(v({ energyOn: 'self', type: 'Psychic' }), 1, 'Rainbow only');
  assert.equal(v({ energyOn: 'self', type: 'Psychic', cards: true }), 1);
  const up = dog(['Upper Energy']);
  const usl = up.state.p[0].active!;
  assert.equal(evalExpr(up.envForInternals, up.state, { player: 0, slot: usl.id, vars: {} }, { energyOn: 'self', type: 'Darkness' }), 2, 'Upper on an Evolution: 2 of every type');
  // The same card on a Basic: {C} only.
  const b = at([{ active: 'Pup', bench: ['Pup'], energy: { active: ['Upper Energy', 'Triple Energy'] } }, { active: 'Pup' }]);
  const bsl = b.state.p[0].active!;
  const bv = (e: Expr) => evalExpr(b.envForInternals, b.state, { player: 0, slot: bsl.id, vars: {} }, e);
  assert.equal(bv({ energyOn: 'self' }), 2);
  assert.equal(bv({ energyOn: 'self', type: 'Darkness' }), 0);
});

// ---------------------------------------------------------------- Tera on the Bench; Checkup order

const SNIPER = pokemon('t-s01', 'Sniper', { hp: 100, attacks: [['Snipe', 'Colorless', null], ['Spray', 'Colorless', null]] });
for (const a of SNIPER.attacks!) {
  a.effect = a.name === 'Snipe' ? "This attack does 50 damage to 1 of your opponent's Pokémon." : "Put 3 damage counters on 1 of your opponent's Benched Pokémon.";
}
const TERA = pokemon('t-s02', 'Tera Pup ex', { hp: 200, suffix: 'ex' });
const MEDIC = pokemon('t-s03', 'Medic', { hp: 60 });
MEDIC.abilities = [{ kind: 'Ability', name: 'Field Care', effect: 'During Pokémon Checkup, heal 20 damage from your Active Pokémon.' }];
const SCRIPTS2: CardScript[] = [
  {
    id: 't-s01',
    name: 'Sniper',
    attacks: {
      Snipe: { program: [{ op: 'chooseSlots', from: 'oppPokemon', min: 1, max: 1, as: 't' }, { op: 'damage', amount: 50, to: { v: 't' } }] },
      Spray: { program: [{ op: 'chooseSlots', from: 'oppBench', min: 1, max: 1, as: 't' }, { op: 'counters', n: 3, to: { v: 't' } }] },
    },
  },
  { id: 't-s02', name: 'Tera Pup ex', fix: { tera: true } },
  { id: 't-s03', name: 'Medic', abilities: [{ name: 'Field Care', triggers: [{ on: 'checkup', program: [{ op: 'heal', amount: 20, to: 'myActive' }] }] }] },
];
const C = deck('C', [
  [SNIPER, 8],
  [TERA, 8],
  [MEDIC, 8],
  [PUP, 12],
  [FIGHTING, 24],
]);
function at2(sides: [SideLayout, SideLayout]): Game {
  return scenario(C, C, sides, { scripts: SCRIPTS2 });
}

test('Tera rule: a Benched Tera Pokémon takes no damage from attacks, but damage counters from attacks are placed', () => {
  const sides: [SideLayout, SideLayout] = [{ active: 'Sniper', energy: { active: ['Fighting Energy'] } }, { active: 'Pup', bench: ['Tera Pup ex'] }];
  const dmg = at2(sides);
  choose(dmg, 'Attack: Snipe');
  choose(dmg, 'Tera Pup ex');
  assert.equal(dmg.state.p[1].bench[0]!.damage, 0, 'attack damage to a Benched Tera Pokémon is prevented');
  const ctr = at2(sides);
  choose(ctr, 'Attack: Spray');
  assert.equal(ctr.state.p[1].bench[0]!.damage, 30, 'damage counters are not damage: placed on the Benched Tera Pokémon');
  // In the Active Spot the Tera rule gives no protection.
  const act = at2([{ active: 'Sniper', energy: { active: ['Fighting Energy'] } }, { active: 'Tera Pup ex', bench: ['Pup'] }]);
  choose(act, 'Attack: Snipe');
  choose(act, 'Tera Pup ex');
  assert.equal(act.state.p[1].active!.damage, 50);
});

test("p.15 between turns: both players' Special Conditions, then Checkup Abilities, then Knock Outs", () => {
  // Both Actives Poisoned at 10 HP left. Poison brings both to 0; Field Care then heals P1's Active 20 before
  // Knock Outs are checked, so only P2's Pup is Knocked Out.
  const g = at2([
    { active: 'Pup', bench: ['Medic'], damage: { active: 60 }, cond: POISONED },
    { active: 'Pup', bench: ['Pup'], damage: { active: 60 }, cond: POISONED },
  ]);
  choose(g, 'End turn');
  assert.equal(g.state.p[0].active!.damage, 50, 'Poison 10, then Field Care heals 20, before the Knock Out check');
  assert.equal(g.state.p[0].prizesTaken, 1, "P2's Poisoned Pup is Knocked Out in the same Checkup");
  assert.equal(g.state.p[1].prizesTaken, 0);
  assert.equal(g.state.current, 1, 'the next turn is P2');
});
