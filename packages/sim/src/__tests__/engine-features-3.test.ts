/**
 * Engine features added with the std-engine3 batch, each tested on its own (the cards that use them are in
 * cards-std-engine3.test.ts):
 *  1. Ancient / Future tags (Filter `tag`, per printing)   2. Special Condition immunity (`conditionImmunity`)
 *  3. Special Condition counter amounts (`condition` with `counters`)
 *  4. timed effects that react to events on the affected Pokémon (`react`), with the `endTurn` step
 *  5. attack coin flips with several coins (`attackCoinFlip` with `coins`)
 *  and, on the way, the `look` step and Ability precedence over a "no Abilities" effect (TPCi 2026-03-26, ruling 2309).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { FRAMES } from '../cards/frames-all.js';
import { CARD_TAGS } from '../cards/tags.js';
import { def } from '../context.js';
import { describeOptions } from '../describe.js';
import type { CardScript, Cond, Filter, Program, StaticEffect } from '../dsl.js';
import { cardMatches, evalCond, evalExpr, slotMatches } from '../eval.js';
import type { Game } from '../game.js';
import { hasNoAbilities, statics } from '../query.js';
import { scenario } from '../scenario.js';
import { cloneState, findSlot } from '../state.js';
import { CONFUSED, POISONED, type Decision } from '../types.js';
import { fromIds } from './decks.js';

function labels(g: Game): string[] {
  return describeOptions(g.ctx, g.state, g.decision as Decision);
}
function choose(g: Game, text: string): void {
  const i = labels(g).findIndex((l) => l.includes(text));
  assert.ok(i >= 0, `no option containing "${text}" in: ${labels(g).join(' | ')} [${g.decision?.prompt}]`);
  g.submit([i]);
}
const ENERGY: [string, number][] = ['mee-001', 'mee-002', 'mee-003', 'mee-004', 'mee-005', 'mee-006', 'mee-007', 'mee-008'].map((id) => [id, 10]);
const IDS: Record<string, string> = {
  'Dragapult ex': 'sv06-130',
  'Hydrapple ex': 'sv07-014',
  Rellor: 'sv08-013',
  'Great Tusk': 'sv05-097',
  'Roaring Moon': 'sv05-109',
  Miraidon: 'sv05-121',
  'Awakening Drum': 'sv05-141',
  "Explorer's Guidance": 'sv05-147',
  "Boss's Orders": 'me01-114',
  Switch: 'me01-130',
  'Mega Clefable ex': 'me03-031',
  'Iron Thorns ex': 'sv06-077',
};
function deck(...names: string[]) {
  return fromIds('engine3', [...[...new Set(names)].map((n): [string, number] => [IDS[n] ?? n, 4]), ...ENERGY]);
}
const DRA = 'Dragapult ex'; // 320 HP, no Weakness or Resistance: Jet Headbutt {C} 70
const HYD = 'Hydrapple ex'; // 330 HP; Syrup Storm {C}{C} 30+
const REL = 'Rellor'; // Basic 40 HP; retreat 1
const P = 'Psychic Energy';
const F = 'Fire Energy';

/** The instance id of the first card of this printing in a player's deck. */
function iidOf(g: Game, printing: string, p: 0 | 1 = 0): number {
  const iid = g.ctx.iids[p].find((c) => def(g.ctx, c).id === printing);
  assert.ok(iid !== undefined, `no ${printing}`);
  return iid;
}
const ec = (p: 0 | 1 = 0, slot = 0) => ({ player: p, slot, vars: {} });
/** A timed effect on a Pokémon (a stand-in for the Ability or attack that would have set it). */
function inject(g: Game, slotId: number, st: StaticEffect, fromAttack = false): void {
  const loc = findSlot(g.state, slotId)!;
  g.state.effects.push({ static: st, slot: slotId, player: loc.owner, until: g.state.turn + 1, fromAttack, src: 0 });
}
const dmg = (g: Game, p: 0 | 1): number => g.state.p[p].active!.damage;
const reactions = (g: Game): number => g.state.effects.filter((e) => e.static.k === 'react').length;

// ------------------------------------------------------------------ 1. Ancient / Future tags

test('tags: the table gives each PRINTING its tag; a reprint of the same name that is not listed is not tagged', () => {
  assert.equal(CARD_TAGS['sv05-119'], 'Ancient'); // Koraidon
  assert.equal(CARD_TAGS['me05-047'], undefined); // another Koraidon, not tagged
  assert.equal(CARD_TAGS['sv05-121'], 'Future'); // Miraidon
  assert.equal(CARD_TAGS['me05-028'], undefined);
  assert.equal(FRAMES['sv05-119']!.name, FRAMES['me05-047']!.name);
  const dk = fromIds('tags', [['sv05-119', 2], ['me05-047', 2], ['sv05-121', 2], ['me05-028', 2], ['sv05-141', 2], ['sv05-147', 2], ['me01-114', 2], ...ENERGY]);
  const g = scenario(dk, dk, [{}, {}]);
  const m = (printing: string, f: Filter): boolean => cardMatches(g.env, iidOf(g, printing), f);
  assert.equal(def(g.ctx, iidOf(g, 'sv05-119')).tag, 'Ancient');
  assert.equal(def(g.ctx, iidOf(g, 'me05-047')).tag, null);
  assert.ok(m('sv05-119', { tag: 'Ancient' }));
  assert.ok(!m('me05-047', { tag: 'Ancient' }), 'the untagged Koraidon is not Ancient');
  assert.ok(!m('sv05-119', { tag: 'Future' }));
  assert.ok(m('sv05-121', { tag: 'Future' }) && !m('me05-028', { tag: 'Future' }));
  // Trainers carry tags too (an Ancient Item, an Ancient Supporter); an untagged Supporter has none.
  assert.ok(m('sv05-141', { tag: 'Ancient', ttype: 'item' }));
  assert.ok(m('sv05-147', { tag: 'Ancient', ttype: 'supporter' }) && !m('sv05-147', { tag: 'Ancient', ttype: 'item' }));
  assert.ok(!m('me01-114', { tag: 'Ancient' }) && !m('me01-114', { tag: 'Future' }));
  assert.ok(m('sv05-147', { cat: 'trainer', tag: 'Ancient' }));
  // not / any compose with it.
  assert.ok(m('me05-047', { not: { tag: 'Ancient' } }) && !m('sv05-119', { not: { tag: 'Ancient' } }));
  assert.ok(m('sv05-121', { any: [{ tag: 'Ancient' }, { tag: 'Future' }] }));
});

test('tags: a card with the same text but another printing id is a different definition, without the tag', () => {
  const copy = { ...FRAMES['sv05-119']!, cardId: 'zz-119' }; // the same game text, printed elsewhere, not in the table
  const dk = { name: 'copies', cards: [{ frame: FRAMES['sv05-119']!, count: 2 }, { frame: copy, count: 2 }, ...ENERGY.map(([id, count]) => ({ frame: FRAMES[id]!, count }))] };
  const g = scenario(dk, dk, [{}, {}]);
  const tagged = def(g.ctx, g.ctx.iids[0][0]!);
  const plain = def(g.ctx, g.ctx.iids[0][2]!);
  assert.equal(tagged.name, plain.name);
  assert.equal(tagged.tag, 'Ancient');
  assert.equal(plain.tag, null);
  assert.notEqual(tagged.idx, plain.idx);
  assert.equal(tagged.script, plain.script, 'the script serves both printings');
  assert.ok(tagged.script, 'and the card is scripted');
  assert.ok(cardMatches(g.env, g.ctx.iids[0][0]!, { tag: 'Ancient' }) && !cardMatches(g.env, g.ctx.iids[0][2]!, { tag: 'Ancient' }));
});

test('tags: filters work in every zone and on Pokémon in play (count, pokemon, slotIs)', () => {
  const dk = deck('Great Tusk', 'Roaring Moon', 'Miraidon', 'Awakening Drum', "Explorer's Guidance", REL);
  const g = scenario(dk, dk, [
    { active: 'Great Tusk', bench: ['Miraidon', REL], hand: ['Awakening Drum', REL], discard: ['Roaring Moon', "Explorer's Guidance", REL], prizes: 0 },
    { active: 'Miraidon', bench: ['Roaring Moon'] },
  ]);
  const n = (zone: 'hand' | 'discard' | 'deck', tag: 'Ancient' | 'Future'): number => evalExpr(g.env, g.state, ec(), { count: { zone, filter: { tag } } });
  assert.equal(n('hand', 'Ancient'), 1, 'Awakening Drum is an Ancient Item');
  assert.equal(n('discard', 'Ancient'), 2, "Roaring Moon and Explorer's Guidance");
  assert.equal(n('discard', 'Future'), 0);
  assert.equal(n('deck', 'Ancient'), 4 * 4 - 4, 'the deck: Great Tusk, Roaring Moon, Awakening Drum and Explorer Guidance, 4 each, less the 4 placed');
  assert.equal(n('deck', 'Future'), 4 - 1, 'Miraidon: 4 less the one in play');
  const inPlay = (zone: 'myPokemon' | 'myBench' | 'oppPokemon', tag: 'Ancient' | 'Future'): number =>
    evalExpr(g.env, g.state, ec(), { pokemon: { zone, filter: { tag } } });
  assert.equal(inPlay('myPokemon', 'Ancient'), 1, 'Great Tusk');
  assert.equal(inPlay('myPokemon', 'Future'), 1, 'Miraidon');
  assert.equal(inPlay('myBench', 'Ancient'), 0);
  assert.equal(inPlay('oppPokemon', 'Ancient'), 1, "the opponent's Roaring Moon, Benched");
  assert.equal(inPlay('oppPokemon', 'Future'), 1);
  assert.ok(slotMatches(g.env, g.state.p[0].active!, { tag: 'Ancient' }));
  assert.ok(!slotMatches(g.env, g.state.p[0].bench[1]!, { tag: 'Ancient' }), 'Rellor has no tag');
  assert.ok(evalCond(g.env, g.state, ec(), { slotIs: { ref: 'myActive', filter: { tag: 'Ancient', stage: 'basic' } } }));
  assert.ok(!evalCond(g.env, g.state, ec(), { slotIs: { ref: 'myActive', filter: { tag: 'Future' } } }));
});

test('tags: playedThisTurn with a tag ("if you played an Ancient Supporter card from your hand during this turn")', () => {
  const dk = deck(DRA, "Explorer's Guidance", "Boss's Orders", 'Awakening Drum');
  const g = scenario(dk, dk, [{ active: DRA, hand: ["Explorer's Guidance", "Boss's Orders", 'Awakening Drum'] }, { active: DRA }]);
  const ancientSupporter: Cond = { playedThisTurn: { filter: { ttype: 'supporter', tag: 'Ancient' } } };
  const futureSupporter: Cond = { playedThisTurn: { filter: { ttype: 'supporter', tag: 'Future' } } };
  const find = (name: string): number => g.state.p[0].hand.find((c) => def(g.ctx, c).name === name)!;
  assert.ok(!evalCond(g.env, g.state, ec(), ancientSupporter), 'nothing played yet');
  g.state.p[0].playedThisTurn = [find("Boss's Orders")];
  assert.ok(!evalCond(g.env, g.state, ec(), ancientSupporter), 'a Supporter without the tag does not count');
  g.state.p[0].playedThisTurn = [find('Awakening Drum')];
  assert.ok(!evalCond(g.env, g.state, ec(), ancientSupporter), 'an Ancient Item is not a Supporter');
  g.state.p[0].playedThisTurn = [find("Explorer's Guidance")];
  assert.ok(evalCond(g.env, g.state, ec(), ancientSupporter));
  assert.ok(!evalCond(g.env, g.state, ec(), futureSupporter), 'an Ancient Supporter is not a Future one');
  assert.ok(!evalCond(g.env, g.state, ec(1), ancientSupporter), "the opponent's own record is theirs");
  assert.ok(evalCond(g.env, g.state, ec(1), { playedThisTurn: { filter: { ttype: 'supporter', tag: 'Ancient' }, who: 'opp' } }));
});

// ------------------------------------------------------------------ 2. Special Condition immunity

type Cond5 = 'asleep' | 'confused' | 'paralyzed' | 'poisoned' | 'burned';
/** Jet Headbutt also puts the given conditions on the Defending Pokémon. */
const givesConditions = (...conds: Cond5[]): CardScript => ({
  id: 'sv06-130',
  name: 'Dragapult ex',
  attacks: { 'Jet Headbutt': { post: conds.map((cond) => ({ op: 'condition' as const, cond, to: 'oppActive' as const })) } },
});

test('conditionImmunity: a Special Condition it can\'t be affected by is not applied; the others are', () => {
  const dk = deck(DRA);
  const mk = (): Game => scenario(dk, dk, [{ active: DRA, energy: { active: [P] } }, { active: DRA }], { scripts: [givesConditions('confused', 'poisoned')] });
  const g = mk();
  inject(g, g.state.p[1].active!.id, { k: 'conditionImmunity', conditions: ['confused'] });
  choose(g, 'Attack: Jet Headbutt');
  const target = g.state.p[1].active!;
  assert.equal(target.cond & CONFUSED, 0, 'not Confused');
  assert.ok(target.cond & POISONED, 'Poisoned: the immunity is to Confusion only');
  assert.equal(dmg(g, 1), 70 + 10, '70 from the attack, 1 counter of Poison at Checkup');
  // With no list: every condition.
  const all = mk();
  inject(all, all.state.p[1].active!.id, { k: 'conditionImmunity' });
  choose(all, 'Attack: Jet Headbutt');
  assert.equal(all.state.p[1].active!.cond, 0);
  assert.equal(dmg(all, 1), 70);
  // Without it, both land.
  const plain = mk();
  choose(plain, 'Attack: Jet Headbutt');
  assert.ok(plain.state.p[1].active!.cond & CONFUSED && plain.state.p[1].active!.cond & POISONED);
});

test('conditionImmunity: conditions it already has are removed as soon as the immunity applies', () => {
  const dk = deck(DRA);
  // Poisoned and Confused; Poison is not covered, Confusion is.
  const g = scenario(dk, dk, [{ active: DRA, cond: POISONED | CONFUSED, hand: [F] }, { active: DRA }]);
  const slot = g.state.p[0].active!;
  inject(g, slot.id, { k: 'conditionImmunity', conditions: ['confused'] });
  assert.ok(slot.cond & CONFUSED, 'still there until something is resolved');
  choose(g, 'Attach Fire Energy'); // any action: Knock Outs and the like are checked afterwards
  assert.equal(slot.cond & CONFUSED, 0, 'recovered from Confusion');
  assert.ok(slot.cond & POISONED, 'Poison stays');
  // Every condition.
  const h = scenario(dk, dk, [{ active: DRA, cond: POISONED | CONFUSED, hand: [F] }, { active: DRA }]);
  inject(h, h.state.p[0].active!.id, { k: 'conditionImmunity' });
  choose(h, 'Attach Fire Energy');
  assert.equal(h.state.p[0].active!.cond, 0);
});

test('conditionImmunity: ends with its source (a timed effect that ran out no longer protects)', () => {
  const dk = deck(DRA);
  const g = scenario(dk, dk, [{ active: DRA, energy: { active: [P] } }, { active: DRA }], { scripts: [givesConditions('poisoned')] });
  choose(g, 'Attack: Jet Headbutt');
  assert.ok(g.state.p[1].active!.cond & POISONED);
  inject(g, g.state.p[1].active!.id, { k: 'conditionImmunity' });
  g.state.effects[g.state.effects.length - 1]!.until = g.state.turn - 1; // already over
  choose(g, 'End turn');
  assert.ok(g.state.p[1].active!.cond & POISONED, 'the expired effect did not cure it');
});

// ------------------------------------------------------------------ 3. Special Condition counter amounts

const poisonWith = (counters?: number): CardScript => ({
  id: 'sv06-130',
  name: 'Dragapult ex',
  attacks: { 'Jet Headbutt': { post: [{ op: 'condition', cond: 'poisoned', to: 'oppActive', ...(counters !== undefined ? { counters } : {}) }] } },
});

test('condition counters: Poison places that many damage counters at EVERY Checkup (ruling 2373)', () => {
  const dk = deck(DRA);
  const g = scenario(dk, dk, [{ active: DRA, energy: { active: [P] } }, { active: DRA, energy: { active: [P] } }], { scripts: [poisonWith(4)], events: true });
  choose(g, 'Attack: Jet Headbutt');
  assert.equal(dmg(g, 1), 70 + 40, '4 counters at the first Checkup');
  assert.ok(g.events.some((e) => e.type === 'counters' && e.checkup && e.n === 4));
  choose(g, 'End turn'); // P2's turn: Checkup after it
  assert.equal(dmg(g, 1), 70 + 80, 'and again at the next');
  assert.equal(g.state.p[1].active!.poisonCounters, 4);
});

test('condition counters: a later plain Poison replaces the amount (ruling 1044); a larger one replaces a smaller', () => {
  const dk = deck(DRA);
  // P1's Defending Pokémon already carries 4-counter Poison; P0's Jet Headbutt poisons plainly.
  const g = scenario(dk, dk, [{ active: DRA, energy: { active: [P] } }, { active: DRA, cond: POISONED }], { scripts: [poisonWith()] });
  g.state.p[1].active!.poisonCounters = 4;
  choose(g, 'Attack: Jet Headbutt');
  assert.equal(g.state.p[1].active!.poisonCounters, undefined, 'the single-counter Poison replaced it');
  assert.equal(dmg(g, 1), 70 + 10);
  const h = scenario(dk, dk, [{ active: DRA, energy: { active: [P] } }, { active: DRA, cond: POISONED }], { scripts: [poisonWith(3)] });
  h.state.p[1].active!.poisonCounters = 2;
  choose(h, 'Attack: Jet Headbutt');
  assert.equal(dmg(h, 1), 70 + 30);
});

test('condition counters: Poison without an amount is 1 counter, as it always was', () => {
  const dk = deck(DRA);
  const g = scenario(dk, dk, [{ active: DRA, energy: { active: [P] } }, { active: DRA }], { scripts: [poisonWith()] });
  choose(g, 'Attack: Jet Headbutt');
  assert.equal(dmg(g, 1), 80);
});

test('condition counters: a failed Confusion flip places that many counters on the attacker (3 without an amount)', () => {
  const dk = deck(DRA);
  const confuse = (counters?: number): CardScript => ({
    id: 'sv06-130',
    name: 'Dragapult ex',
    attacks: { 'Jet Headbutt': { post: [{ op: 'condition', cond: 'confused', to: 'oppActive', ...(counters !== undefined ? { counters } : {}) }] } },
  });
  const run = (counters: number | undefined, heads: boolean): [number, number] => {
    const g = scenario(dk, dk, [{ active: DRA, energy: { active: [P] } }, { active: DRA, energy: { active: [P] } }], { scripts: [confuse(counters)] });
    choose(g, 'Attack: Jet Headbutt');
    assert.ok(g.state.p[1].active!.cond & CONFUSED);
    g.state.forcedCoins = [heads];
    choose(g, 'Attack: Jet Headbutt');
    return [dmg(g, 1), dmg(g, 0)];
  };
  assert.deepEqual(run(8, false), [70 + 80, 0], '8 counters on the Confused attacker, which does no damage');
  assert.deepEqual(run(undefined, false), [70 + 30, 0], '3 counters without an amount');
  assert.deepEqual(run(8, true), [70, 70], 'heads: the attack goes ahead');
});

test('condition counters: the amount survives a copy of the state', () => {
  const dk = deck(DRA);
  const g = scenario(dk, dk, [{ active: DRA, energy: { active: [P] } }, { active: DRA }], { scripts: [poisonWith(5)] });
  choose(g, 'Attack: Jet Headbutt');
  const c = cloneState(g.state);
  assert.equal(c.p[1].active!.poisonCounters, 5);
  assert.notEqual(c.p[1].active, g.state.p[1].active);
});

// ------------------------------------------------------------------ 4. timed effects that react to events

const REACT_DAMAGED: StaticEffect = { k: 'react', event: 'damagedByAttack', program: [{ op: 'counters', n: 3, to: { v: '__attacker' } }] };
/** Jet Headbutt leaves a timed effect on this Pokémon (an attack's lasting effect). */
const leavesReaction = (st: StaticEffect, on: 'self' | 'defender' = 'self'): CardScript => ({
  id: 'sv06-130',
  name: 'Dragapult ex',
  attacks: { 'Jet Headbutt': { post: [{ op: 'effect', static: st, on, duration: 'oppNextTurn' }] } },
});
/** A Hydrapple ex (330 HP) whose Syrup Storm is this program instead. */
const hydrappleDoes = (program: Program): CardScript => ({ id: 'sv07-014', name: 'Hydrapple ex', attacks: { 'Syrup Storm': { program } } });

test('react (damagedByAttack): the Attacking Pokémon gets the counters after the attack, also when the damaged Pokémon is Knocked Out', () => {
  const dk = deck(DRA, REL);
  const g = scenario(dk, dk, [{ active: DRA, energy: { active: [P] } }, { active: DRA, energy: { active: [P] } }], { scripts: [leavesReaction(REACT_DAMAGED)] });
  choose(g, 'Attack: Jet Headbutt');
  assert.equal(dmg(g, 1), 70);
  assert.equal(reactions(g), 1);
  choose(g, 'Attack: Jet Headbutt'); // P2 hits the Pokémon with the effect
  assert.equal(dmg(g, 0), 70);
  assert.equal(dmg(g, 1), 70 + 30, 'the Attacking Pokémon got 3 damage counters');
  // Even if the damaged Pokémon is Knocked Out by that attack.
  const ko = scenario(dk, dk, [{ active: DRA, energy: { active: [P] }, damage: { active: 260 }, bench: [REL] }, { active: DRA, energy: { active: [P] } }], { scripts: [leavesReaction(REACT_DAMAGED)] });
  choose(ko, 'Attack: Jet Headbutt');
  choose(ko, 'Attack: Jet Headbutt');
  assert.ok(ko.state.p[0].discard.some((c) => def(ko.ctx, c).name === DRA), 'the damaged Dragapult ex was Knocked Out');
  assert.equal(ko.state.p[1].active!.damage, 70 + 30, 'the counters were placed although the damaged Pokémon was Knocked Out');
});

test('react (damagedByAttack): once per attack however many times it is hit; damage counters are not damage', () => {
  const dk = deck(DRA, HYD);
  const run = (program: Program): Game => {
    const g = scenario(dk, dk, [{ active: DRA, energy: { active: [P] } }, { active: HYD, energy: { active: [P, P] } }], { scripts: [leavesReaction(REACT_DAMAGED), hydrappleDoes(program)] });
    choose(g, 'Attack: Jet Headbutt');
    choose(g, 'Attack: Syrup Storm');
    return g;
  };
  const twice = run([{ op: 'damage', amount: 10 }, { op: 'damage', amount: 10 }]);
  assert.equal(dmg(twice, 0), 20, 'two hits of 10');
  assert.equal(dmg(twice, 1), 70 + 30, 'one reaction, not two');
  const counters = run([{ op: 'counters', n: 2, to: 'defender' }]);
  assert.equal(dmg(counters, 0), 20);
  assert.equal(dmg(counters, 1), 70, 'damage counters placed by an attack are not damage: no reaction');
});

test('react (damagedByAttack): an attack\'s lasting effect -- "no Abilities" does not stop it, prevention of attack effects on the Attacking Pokémon does (rulings 1958, 2408)', () => {
  const dk = deck(DRA);
  const base = (): Game => {
    const g = scenario(dk, dk, [{ active: DRA, energy: { active: [P] } }, { active: DRA, energy: { active: [P] } }], { scripts: [leavesReaction(REACT_DAMAGED)] });
    choose(g, 'Attack: Jet Headbutt');
    return g;
  };
  // No Abilities on every Pokémon: the effect still reacts.
  const noAb = base();
  noAb.state.effects.push({ static: { k: 'noAbilities' }, slot: -1, player: 0, scope: 'allPokemon', until: 4, fromAttack: false, src: 0 });
  assert.ok(hasNoAbilities(noAb.env, noAb.state, noAb.state.p[0].active!));
  choose(noAb, 'Attack: Jet Headbutt');
  assert.equal(dmg(noAb, 1), 100);
  // The Attacking Pokémon is protected from the effects of attacks (Mist Energy): damage still happens, the counters do not.
  const mist = base();
  inject(mist, mist.state.p[1].active!.id, { k: 'preventEffects', from: ['attack'] });
  choose(mist, 'Attack: Jet Headbutt');
  assert.equal(dmg(mist, 0), 70, 'the damage was done');
  assert.equal(dmg(mist, 1), 70, 'but the counters on the Attacking Pokémon were an effect of an attack: prevented');
});

test('react: it ends when the Pokémon leaves the Active Spot, and with the turn it was for', () => {
  const dk = deck(DRA, REL, "Boss's Orders");
  const g = scenario(dk, dk, [{ active: DRA, energy: { active: [P] }, bench: [REL] }, { active: DRA, energy: { active: [P] }, hand: ["Boss's Orders"] }], { scripts: [leavesReaction(REACT_DAMAGED)] });
  choose(g, 'Attack: Jet Headbutt');
  assert.equal(reactions(g), 1);
  choose(g, "Play Boss's Orders"); // P2 brings P1's Benched Rellor up: the Dragapult leaves the Active Spot
  assert.equal(reactions(g), 0, 'gone');
  choose(g, 'Attack: Jet Headbutt');
  assert.equal(dmg(g, 1), 70, 'no counters for the attack on Rellor');
  // The effect lasts through the opponent's next turn and no longer.
  const h = scenario(dk, dk, [{ active: DRA, energy: { active: [P] } }, { active: DRA }], { scripts: [leavesReaction(REACT_DAMAGED)] });
  choose(h, 'Attack: Jet Headbutt');
  assert.equal(reactions(h), 1);
  choose(h, 'End turn');
  assert.equal(reactions(h), 0, "expired at the end of the opponent's turn");
});

test('react: the compiled program lives in the shared context, so a copy of the state reacts too', () => {
  const dk = deck(DRA);
  const g = scenario(dk, dk, [{ active: DRA, energy: { active: [P] } }, { active: DRA, energy: { active: [P] } }], { scripts: [leavesReaction(REACT_DAMAGED)] });
  choose(g, 'Attack: Jet Headbutt');
  const c = g.clone();
  choose(c, 'Attack: Jet Headbutt');
  assert.equal(c.state.p[1].active!.damage, 100);
  assert.equal(dmg(g, 1), 70, 'the original was not touched');
});

const REACT_ATTACH_COUNTERS: StaticEffect = { k: 'react', event: 'attachFromHand', program: [{ op: 'counters', n: 2, to: { v: '__target' } }] };
const REACT_ATTACH_END: StaticEffect = { k: 'react', event: 'attachFromHand', program: [{ op: 'endTurn' }] };

test('react (attachFromHand): attaching an Energy from the hand to the Defending Pokémon triggers it; another Pokémon does not', () => {
  const dk = deck(DRA, REL, 'Switch');
  const mk = (): Game => {
    const g = scenario(dk, dk, [{ active: DRA, energy: { active: [P] } }, { active: DRA, bench: [REL], hand: [F, F] }], { scripts: [leavesReaction(REACT_ATTACH_COUNTERS, 'defender')] });
    choose(g, 'Attack: Jet Headbutt');
    return g;
  };
  const a = mk();
  choose(a, 'Attach Fire Energy to Dragapult ex (Active)');
  assert.equal(dmg(a, 1), 70 + 20, '2 damage counters on the Defending Pokémon');
  assert.equal(a.decision?.kind, 'main', 'and the turn goes on');
  const b = mk();
  choose(b, 'Attach Fire Energy to Rellor');
  assert.equal(b.state.p[1].bench[0]!.damage, 0, 'a Benched Pokémon is not the Defending Pokémon');
  assert.equal(dmg(b, 1), 70);
  // An Energy attached by an effect from the hand counts too (not only the turn action).
  const attachFromHand: CardScript = {
    id: 'me01-130',
    name: 'Switch',
    play: [{ op: 'chooseCards', from: 'hand', filter: { basicEnergy: true }, min: 1, max: 1, as: 'e' }, { op: 'attach', cards: 'e', to: 'myActive' }],
  };
  const c = scenario(dk, dk, [{ active: DRA, energy: { active: [P] } }, { active: DRA, hand: [F, 'Switch'] }], { scripts: [leavesReaction(REACT_ATTACH_COUNTERS, 'defender'), attachFromHand] });
  choose(c, 'Attack: Jet Headbutt');
  choose(c, 'Play Switch');
  if (c.decision?.kind === 'cards') choose(c, 'Fire Energy'); // the Energy drawn for the turn may be another choice
  assert.equal(dmg(c, 1), 70 + 20);
});

test('react (attachFromHand) + endTurn: "their turn ends"; retreating first clears the effect (ruling 2223)', () => {
  const dk = deck(DRA, REL);
  const mk = (): Game => {
    const g = scenario(dk, dk, [{ active: DRA, energy: { active: [P] } }, { active: DRA, bench: [REL], energy: { active: [P] }, hand: [F, F] }], { scripts: [leavesReaction(REACT_ATTACH_END, 'defender')] });
    choose(g, 'Attack: Jet Headbutt');
    return g;
  };
  const a = mk();
  assert.equal(a.state.turn, 4);
  choose(a, 'Attach Fire Energy to Dragapult ex (Active)');
  assert.equal(a.state.turn, 5, 'their turn ended');
  assert.equal(a.decision?.player, 0, "it is the other player's turn");
  assert.equal(dmg(a, 0), 0, 'with no attack made');
  // Attaching to a Benched Pokémon does not end it.
  const b = mk();
  choose(b, 'Attach Fire Energy to Rellor');
  assert.equal(b.state.turn, 4, 'attaching to a Benched Pokémon is no trigger');
  // Retreat: the new Active Pokémon is not the Defending Pokémon that was affected.
  const c = mk();
  choose(c, 'Retreat');
  assert.equal(c.state.turn, 4);
  choose(c, 'Attach Fire Energy to Rellor (Active)');
  assert.equal(c.state.turn, 4, 'no effect: Retreating cleared it');
  assert.equal(c.decision?.kind, 'main');
});

// ------------------------------------------------------------------ 5. attack coin flips with several coins

test('attackCoinFlip with coins: all the coins are flipped; if any is tails the attack doesn\'t happen', () => {
  const dk = deck(DRA);
  const mk = (coins: number, flips: boolean[]): Game => {
    const g = scenario(dk, dk, [{ active: DRA, energy: { active: [P] } }, { active: DRA, energy: { active: [P] } }], { scripts: [leavesReaction({ k: 'attackCoinFlip', coins }, 'defender')], events: true });
    choose(g, 'Attack: Jet Headbutt');
    g.state.forcedCoins = flips;
    choose(g, 'Attack: Jet Headbutt');
    return g;
  };
  const both = mk(2, [true, true]);
  assert.equal(dmg(both, 0), 70, 'two heads: the attack happens');
  assert.equal(both.events.filter((e) => e.type === 'coin_flip').length, 2, 'two coins were flipped for the effect');
  for (const flips of [[true, false], [false, true], [false, false]]) {
    const g = mk(2, flips);
    assert.equal(dmg(g, 0), 0, `${flips}: the attack doesn't happen`);
    assert.equal(g.state.forcedCoins.length, 0, 'both coins were flipped');
    assert.equal(g.state.turn, 5, 'and the turn is over');
  }
  assert.equal(dmg(mk(3, [true, true, false]), 0), 0, 'three coins, the last one tails');
  assert.equal(dmg(mk(3, [true, true, true]), 0), 70);
  assert.equal(dmg(mk(1, [false]), 0), 0, 'one coin, as `coins` was always 1');
});

test('attackCoinFlip with coins: flipped before Confusion\'s coin (ruling 2326)', () => {
  const dk = deck(DRA);
  const mk = (): Game => {
    const g = scenario(dk, dk, [{ active: DRA, energy: { active: [P] } }, { active: DRA, energy: { active: [P] }, cond: CONFUSED }], { scripts: [leavesReaction({ k: 'attackCoinFlip', coins: 2 }, 'defender')] });
    choose(g, 'Attack: Jet Headbutt');
    return g;
  };
  const g = mk();
  g.state.forcedCoins = [true, true, false]; // the effect's two coins, then Confusion's
  choose(g, 'Attack: Jet Headbutt');
  assert.equal(dmg(g, 1), 70 + 30, 'both coins heads, then Confusion tails: 3 counters on the attacker');
  assert.equal(dmg(g, 0), 0);
  const h = mk();
  h.state.forcedCoins = [true, false]; // one of the effect's coins is tails: the attack never gets to Confusion
  choose(h, 'Attack: Jet Headbutt');
  assert.equal(dmg(h, 1), 70, 'no Confusion damage');
  assert.equal(h.state.forcedCoins.length, 0);
});

// ------------------------------------------------------------------ the look step

test('look: sees the top cards and keeps those that match, without moving anything', () => {
  const dk = deck(DRA, 'Great Tusk', 'Roaring Moon', REL);
  const lookAttack: CardScript = {
    id: 'sv06-130',
    name: 'Dragapult ex',
    attacks: { 'Jet Headbutt': { pre: [{ op: 'look', n: 5, filter: { tag: 'Ancient' }, as: 'a', reveal: true }], damage: { mul: [10, { len: 'a' }] } } },
  };
  const g = scenario(dk, dk, [{ active: DRA, energy: { active: [P] }, deckTop: ['Great Tusk', REL, 'Roaring Moon', REL, REL, 'Great Tusk'] }, { active: DRA }], { scripts: [lookAttack] });
  const before = g.state.p[0].deck.slice();
  choose(g, 'Attack: Jet Headbutt');
  assert.equal(dmg(g, 1), 20, 'two Ancient cards among the top 5 (the 6th does not count)');
  assert.deepEqual(g.state.p[0].deck, before, 'the deck is as it was');
  // The owner now knows the top 5 cards of the deck.
  const h = scenario(dk, dk, [{ active: DRA, energy: { active: [P] } }, { active: DRA }], { scripts: [lookAttack] });
  assert.equal(h.state.p[0].knownTop, 0);
  const expected = h.state.p[0].deck.slice(-5).filter((c) => def(h.ctx, c).tag === 'Ancient').length;
  choose(h, 'Attack: Jet Headbutt');
  assert.equal(dmg(h, 1), 10 * expected);
  assert.equal(h.state.p[0].knownTop, 5);
  // The opponent's deck: seen, but their knowledge is not changed.
  const opp: CardScript = { id: 'sv06-130', name: 'Dragapult ex', attacks: { 'Jet Headbutt': { pre: [{ op: 'look', n: 3, who: 'opp', as: 'x' }], damage: { mul: [10, { len: 'x' }] } } } };
  const o = scenario(dk, dk, [{ active: DRA, energy: { active: [P] } }, { active: DRA }], { scripts: [opp] });
  choose(o, 'Attack: Jet Headbutt');
  assert.equal(dmg(o, 1), 30, 'the 3 cards of the opponent\'s deck, whatever they are');
  assert.equal(o.state.p[1].knownTop, 0);
});

// ------------------------------------------------------------------ Ability precedence (ruling 2309)

test('noAbilities from an Ability does not take the Abilities of a Pokémon that prevents the effects of Abilities done to it (TPCi 2026-03-26, ruling 2309)', () => {
  const dk = deck('Iron Thorns ex', 'Mega Clefable ex', DRA);
  const g = scenario(dk, dk, [{ active: 'Iron Thorns ex' }, { active: 'Mega Clefable ex' }]);
  const [thorns, mega] = [g.state.p[0].active!, g.state.p[1].active!];
  assert.ok(!hasNoAbilities(g.env, g.state, mega), 'Luminous Wing takes precedence over Initialization');
  assert.ok(!hasNoAbilities(g.env, g.state, thorns), 'a Future Pokémon keeps its Abilities anyway');
  assert.ok(statics(g.env, g.state).some((x) => x.effect.k === 'preventEffects' && x.slot === mega.id), 'its Ability is still in force');
  // Order of entering play does not matter: the same on the other side of the table.
  const h = scenario(dk, dk, [{ active: 'Mega Clefable ex' }, { active: 'Iron Thorns ex' }]);
  assert.ok(!hasNoAbilities(h.env, h.state, h.state.p[0].active!));
  // Without the protecting Ability the lock bites: a Pokémon with a Rule Box is switched off.
  const plain = scenario(dk, dk, [{ active: 'Iron Thorns ex' }, { active: DRA }]);
  assert.ok(hasNoAbilities(plain.env, plain.state, plain.state.p[1].active!), 'Dragapult ex has a Rule Box');
});
