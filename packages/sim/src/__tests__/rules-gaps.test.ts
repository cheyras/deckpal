/**
 * Rule tests for gaps the card lanes reported: paying a Retreat Cost and counting attached Energy
 * in Energy UNITS (a card providing {C}{C}{C} pays and counts 3), with synthetic multi-unit Energy.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { CardScript, Expr } from '../dsl.js';
import { describeOptions } from '../describe.js';
import { evalExpr } from '../eval.js';
import { Game } from '../game.js';
import { scenario, type SideLayout } from '../scenario.js';
import type { CardFrame, Decision } from '../types.js';
import { DOG, FIGHTING, PSYCHIC, PUP, deck } from './fixtures.js';

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
