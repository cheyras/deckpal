/**
 * Engine features added with the std-engine batch, each tested on its own (the cards that use them are in
 * cards-std-engine.test.ts):
 *  1. attacker-filtered damage prevention / damageIn   2. coin-gated attacks   3. Filter.hasAttack
 *  4. "moved to the Active Spot this turn"             5. "healed this turn"    6. statics printed on a Pokémon card
 *  7. no Energy attachment from hand                   8. delayed end-of-turn effects
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { describeOptions } from '../describe.js';
import type { CardScript, StaticEffect } from '../dsl.js';
import { evalCond, evalExpr, slotMatches } from '../eval.js';
import type { Game } from '../game.js';
import { scenario, type ScenarioOptions, type SideLayout } from '../scenario.js';
import { findSlot } from '../state.js';
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

const ENERGY: [string, number][] = ['mee-001', 'mee-002', 'mee-003', 'mee-004', 'mee-005', 'mee-006', 'mee-007', 'mee-008'].map((id) => [id, 10]);
const IDS: Record<string, string> = { "Dragapult ex": "sv06-130", "Slowpoke": "me05-029", "Palpitoad": "sv10.5b-020", "Tympole": "sv10.5b-019", "Slowking": "sv07-058", "Buneary": "me02-083", "Mega Lopunny ex": "me02-084", "Rellor": "sv08-013", Crawdaunt: 'me01-085' };
function deck(...names: string[]) {
  const ids = names.map((n) => IDS[n] ?? n);
  return fromIds('engine', [...[...new Set(ids)].map((id): [string, number] => [id, 4]), ...ENERGY]);
}
const DRA = 'Dragapult ex'; // Dragapult ex: 320 HP, no Weakness or Resistance -- a neutral target; Jet Headbutt {C} 70
const SLO = 'Slowpoke'; // Slowpoke: Basic, 70 HP, Headbutt {C}{C} 20
const PAL = 'Palpitoad'; // Palpitoad: Stage 1, Round {C}{C} 40x (counts Pokémon with Round)
const TYM = 'Tympole'; // Tympole: Basic with Round
const KING = 'Slowking'; // Slowking: Stage 1 that evolves from Slowpoke
const BUN = 'Buneary'; // Buneary
const LOP = 'Mega Lopunny ex'; // Mega Lopunny ex
const REL = 'Rellor'; // Rellor

const G = 'Grass Energy';
const W = 'Water Energy';
const P = 'Psychic Energy';
const D = 'Darkness Energy';
type Sides = [SideLayout, SideLayout];

/** Put a timed effect on a Pokémon directly (a stand-in for the attack that would have set it). */
function inject(g: Game, slotId: number, st: StaticEffect, fromAttack = true): void {
  const loc = findSlot(g.state, slotId)!;
  g.state.effects.push({ static: st, slot: slotId, player: loc.owner, until: g.state.turn + 1, fromAttack, src: 0 });
}
function damageOf(g: Game, p: 0 | 1): number {
  return g.state.p[p].active!.damage;
}

// ------------------------------------------------------------------ 1. attacker filter on prevention and damageIn

test('preventDamage with an attacker filter stops damage only from attacks of a matching attacking Pokémon', () => {
  const dk = deck(DRA, SLO, PAL);
  const attackFrom = (attacker: string, atk: string, energy: string[], st?: StaticEffect): number => {
    const g = scenario(dk, dk, [{ active: DRA }, { active: attacker, energy: { active: energy } }], { current: 1 });
    if (st) inject(g, g.state.p[0].active!.id, st);
    choose(g, `Attack: ${atk}`);
    return damageOf(g, 0);
  };
  const basicOnly: StaticEffect = { k: 'preventDamage', attacker: { stage: 'basic' } };
  assert.equal(attackFrom('Slowpoke', 'Headbutt', [P, P]), 20, 'control: no effect');
  assert.equal(attackFrom('Slowpoke', 'Headbutt', [P, P], basicOnly), 0, 'a Basic attacker is stopped');
  assert.equal(attackFrom('Palpitoad', 'Round', [W, W]), 40, 'control');
  assert.equal(attackFrom('Palpitoad', 'Round', [W, W], basicOnly), 40, 'a Stage 1 attacker is not');
  assert.equal(attackFrom('Palpitoad', 'Round', [W, W], { k: 'preventDamage' }), 0, 'control: with no filter every attacker is stopped');
});

test('damageIn with an attacker filter changes only damage from matching attackers', () => {
  const dk = deck(DRA, SLO, PAL);
  const attackFrom = (attacker: string, atk: string, energy: string[]): number => {
    const g = scenario(dk, dk, [{ active: DRA }, { active: attacker, energy: { active: energy } }], { current: 1 });
    inject(g, g.state.p[0].active!.id, { k: 'damageIn', amount: -10, attacker: { stage: 'basic' } });
    choose(g, `Attack: ${atk}`);
    return damageOf(g, 0);
  };
  assert.equal(attackFrom('Slowpoke', 'Headbutt', [P, P]), 10);
  assert.equal(attackFrom('Palpitoad', 'Round', [W, W]), 40);
});

// ------------------------------------------------------------------ 2. coin-gated attack

test('attackCoinFlip: the attack happens on heads and not on tails; the flip comes before Confusion; none after the effect ends', () => {
  const dk = deck(DRA, SLO);
  const mk = (coins: boolean[], cond = 0): Game => {
    const g = scenario(dk, dk, [{ active: DRA }, { active: 'Slowpoke', energy: { active: [P, P] }, cond }], { current: 1, events: true });
    inject(g, g.state.p[1].active!.id, { k: 'attackCoinFlip' });
    g.state.forcedCoins = coins;
    return g;
  };
  const heads = mk([true]);
  choose(heads, 'Attack: Headbutt');
  assert.equal(damageOf(heads, 0), 20, 'heads: the attack happens');
  const tails = mk([false]);
  choose(tails, 'Attack: Headbutt');
  assert.equal(damageOf(tails, 0), 0, 'tails: that attack does not happen');
  assert.equal(tails.decision?.player, 0, 'but it was still the attacker\'s attack: the turn ends');
  // Confused as well: the effect's flip first, then Confusion's (TPCi 2026-03-26 ruling 2317, 2026-04-02 ruling 2326).
  const first = mk([false, true], CONFUSED);
  choose(first, 'Attack: Headbutt');
  assert.deepEqual(first.state.forcedCoins, [true], 'tails on the first flip: the attack does not happen, so Confusion never flips');
  assert.equal(damageOf(first, 1), 0, 'and there is no Confusion self-damage');
  const second = mk([true, false], CONFUSED);
  choose(second, 'Attack: Headbutt');
  assert.equal(damageOf(second, 1), 30, 'heads, then Confusion\'s flip is tails: 3 damage counters on the attacker');
  assert.equal(damageOf(second, 0), 0);
  const both = mk([true, true], CONFUSED);
  choose(both, 'Attack: Headbutt');
  assert.equal(damageOf(both, 0), 20);
  assert.equal(both.events.filter((e) => e.type === 'coin_flip').length, 2);
  // No effect, no flip.
  const none = scenario(dk, dk, [{ active: DRA }, { active: 'Slowpoke', energy: { active: [P, P] } }], { current: 1, events: true });
  choose(none, 'Attack: Headbutt');
  assert.equal(none.events.filter((e) => e.type === 'coin_flip').length, 0);
});

// ------------------------------------------------------------------ 3. Filter.hasAttack

test('Filter.hasAttack matches Pokémon by the printed name of one of their attacks, and counts in expressions', () => {
  const dk = deck(PAL, TYM, SLO, DRA);
  const g = scenario(dk, dk, [{ active: PAL, bench: [TYM, SLO], hand: [PAL, SLO] }, { active: TYM }]);
  const ec = { player: 0 as const, slot: 0, vars: {} };
  const n = (filter: object, zone: 'myPokemon' | 'oppPokemon' = 'myPokemon'): number => evalExpr(g.env, g.state, ec, { pokemon: { zone, filter } });
  assert.equal(n({ hasAttack: 'Round' }), 2, 'Palpitoad and Tympole, not Slowpoke');
  assert.equal(n({ hasAttack: 'Headbutt' }), 1);
  assert.equal(n({ hasAttack: ['Headbutt', 'Wave Splash'] }), 2, 'any of the listed names');
  assert.equal(n({ hasAttack: 'Round' }, 'oppPokemon'), 1);
  assert.equal(n({ hasAttack: 'Nothing' }), 0);
  assert.equal(n({ hasAttack: 'Round', stage: 'basic' }), 1, 'combines with other keys');
  assert.equal(evalExpr(g.env, g.state, ec, { count: { zone: 'hand', filter: { hasAttack: 'Round' } } }), 1, 'works on cards in a zone too');
  assert.ok(slotMatches(g.env, g.state.p[0].active!, { hasAttack: 'Wave Splash' }), 'only the printed attack names, not their text');
});

// ------------------------------------------------------------------ 4. moved to the Active Spot this turn

const moved = (g: Game, ref: 'myActive' | 'self'): boolean => evalCond(g.env, g.state, { player: 0, slot: g.state.p[0].active?.id ?? 0, vars: {} }, { movedToActiveThisTurn: ref });

test('movedToActiveThisTurn: a retreat or switch this turn counts; the old Active does not; a later turn does not; evolving resets it', () => {
  const dk = deck(SLO, BUN, LOP, DRA);
  const mk = (): Game => scenario(dk, dk, [{ active: SLO, bench: [BUN], energy: { active: [P, P] }, hand: [LOP] }, { active: DRA }]);
  const g = mk();
  assert.equal(moved(g, 'myActive'), false, 'nothing has moved yet');
  choose(g, 'Retreat');
  assert.equal(g.state.p[0].active!.cards.length, 1);
  assert.equal(moved(g, 'myActive'), true, 'Buneary moved from the Bench to the Active Spot this turn');
  assert.equal(evalCond(g.env, g.state, { player: 0, slot: g.state.p[0].bench[0]!.id, vars: {} }, { movedToActiveThisTurn: 'self' }), false, 'the old Active went the other way');
  g.state.turn += 2; // the same Pokémon, a later turn of this player
  assert.equal(moved(g, 'myActive'), false, 'earlier moves do not count');
  // Evolving after the move: it was Buneary when it moved (TPCi 2025-12-04, ruling 2265).
  const e = mk();
  choose(e, 'Retreat');
  choose(e, 'Evolve');
  assert.equal(moved(e, 'myActive'), false, 'Buneary moved, then evolved into Mega Lopunny ex: does not count');
});

test('movedToActiveThisTurn: promotion after a Knock Out on the OPPONENT\'s turn is during their turn, not yours', () => {
  const dk = deck(SLO, REL, DRA);
  const g = scenario(dk, dk, [{ active: SLO, bench: [REL] }, { active: DRA, energy: { active: [P] } }], { current: 1, turn: 4 });
  choose(g, 'Attack: Jet Headbutt'); // 70 damage Knocks Out Slowpoke (70 HP)
  assert.equal(g.state.p[0].active!.cards.length, 1);
  assert.equal(g.state.turn, 5, 'now the promoted Pokémon\'s owner is on their own turn');
  assert.equal(moved(g, 'myActive'), false, 'it was promoted during turn 4, the opponent\'s');
});

// ------------------------------------------------------------------ 5. healed this turn

const healer: CardScript = { id: 'me05-029', name: 'Slowpoke', attacks: { Headbutt: { post: [{ op: 'heal', amount: 30, to: 'self' }] } } };
const mover: CardScript = {
  id: 'me05-029',
  name: 'Slowpoke',
  attacks: {
    Headbutt: {
      post: [
        { op: 'chooseSlots', from: 'myActive', min: 1, max: 1, as: 'from' },
        { op: 'chooseSlots', from: 'myBench', min: 1, max: 1, as: 'to' },
        { op: 'custom', fn: 'moveCounters', args: { from: 'from', to: 'to', max: 1 } },
      ],
    },
  },
};
/** Was P0's Active healed during turn `turn`? (The attack ends the turn, so ask as of the turn it was used.) */
const healed = (g: Game, turn = 3, p: 0 | 1 = 0): boolean => {
  g.state.turn = turn;
  return healedNow(g, p);
};
const healedNow = (g: Game, p: 0 | 1 = 0): boolean => evalCond(g.env, g.state, { player: p, slot: g.state.p[p].active!.id, vars: {} }, { healedThisTurn: 'self' });

test('healedThisTurn: set when a heal actually removes damage, not by a heal of nothing, not by moving counters, and not carried to another turn', () => {
  const dk = deck(SLO, REL, DRA);
  const opts: ScenarioOptions = { scripts: [healer] };
  const hurt = scenario(dk, dk, [{ active: SLO, energy: { active: [P, P] }, damage: { active: 40 } }, { active: DRA }], opts);
  assert.equal(healed(hurt), false);
  choose(hurt, 'Attack: Headbutt');
  assert.equal(hurt.state.p[0].active!.damage, 10);
  assert.equal(healed(hurt), true, 'damage was removed');
  assert.equal(healed(hurt, 5), false, 'a different turn');
  const clean = scenario(dk, dk, [{ active: SLO, energy: { active: [P, P] } }, { active: DRA }], opts);
  choose(clean, 'Attack: Headbutt');
  assert.equal(healed(clean), false, 'healing a Pokémon with no damage heals nothing');
  // Ruling (TPCi 2026-07-16, ruling 2405): moving damage counters is not healing.
  const move = scenario(dk, dk, [{ active: SLO, bench: [REL], energy: { active: [P, P] }, damage: { active: 30 } }, { active: DRA }], { scripts: [mover] });
  choose(move, 'Attack: Headbutt');
  assert.equal(move.state.p[0].active!.damage, 20, 'one counter moved off the Active Pokémon');
  assert.equal(healed(move), false);
});

// ------------------------------------------------------------------ 6. statics printed on a Pokémon card

test('a Pokémon card\'s own statics apply while it is in play and are not switched off by "no Abilities" effects', () => {
  const dk = deck('me01-085', DRA);
  const mk = (damage: number): Game => scenario(dk, dk, [{ active: 'Crawdaunt', energy: { active: [D] }, damage: { active: damage } }, { active: DRA }]);
  assert.ok(!has(mk(0), 'Attack: Cutting Riposte'), 'undamaged: costs {D}{D}{C}, one Energy is not enough');
  assert.ok(has(mk(10), 'Attack: Cutting Riposte'), 'damaged: can be used for {D}');
  const locked = mk(10);
  locked.state.effects.push({ static: { k: 'noAbilities' }, slot: -1, player: 1, scope: 'oppPokemon', until: locked.state.turn + 1, fromAttack: false, src: 0 });
  assert.ok(has(locked, 'Attack: Cutting Riposte'), 'it is not an Ability, so Abilities being off does not touch it');
  const hand = scenario(dk, dk, [{ active: 'Crawdaunt', damage: { active: 10 } }, { active: DRA }]);
  assert.ok(!has(hand, 'Attack: Cutting Riposte'), 'no Energy at all: still not enough');
});

// ------------------------------------------------------------------ 7. no Energy from hand

test('cantAttachFromHand: legalActions offers no attachment from hand to the affected Pokémon, only to others', () => {
  const dk = deck(SLO, REL, DRA);
  const g = scenario(dk, dk, [{ active: DRA }, { active: SLO, bench: [REL], hand: [P] }], { current: 1 });
  const attaches = (): string[] => labels(g).filter((l) => l.startsWith('Attach'));
  assert.equal(attaches().length, 2, 'control: Active and Bench');
  inject(g, g.state.p[1].active!.id, { k: 'cantAttachFromHand' });
  // The decision was built before the effect; rebuild it.
  const acts = g.legal(1).filter((a) => a.t === 'attach');
  assert.deepEqual(acts.map((a) => (a as { slot: number }).slot), [g.state.p[1].bench[0]!.id], 'only the Benched Pokémon');
});

// ------------------------------------------------------------------ 8. delayed end-of-turn effect

const delayer: CardScript = {
  id: 'me05-029',
  name: 'Slowpoke',
  attacks: { Headbutt: { post: [{ op: 'delay', duration: 'oppNextTurn', program: [{ op: 'counters', n: 3, to: 'defender' }] }] } },
};

test('delay: runs at the end of the opponent\'s next turn, before Pokémon Checkup, not at the end of the attacker\'s own turn', () => {
  const dk = deck(SLO, DRA);
  const g = scenario(dk, dk, [{ active: SLO, energy: { active: [P, P] } }, { active: DRA, cond: POISONED }], { scripts: [delayer], events: true });
  choose(g, 'Attack: Headbutt');
  assert.equal(damageOf(g, 1), 30, 'my turn is over: the 20 damage and 10 from Poison at Checkup, nothing delayed yet');
  assert.equal(g.decision?.player, 1);
  assert.equal(g.state.delayed?.length, 1);
  choose(g, 'End turn');
  assert.equal(g.state.delayed?.length, 0);
  const after = g.events.findIndex((e) => e.type === 'end_turn' && e.player === 1);
  const rest = g.events.slice(after).filter((e) => e.type === 'counters');
  assert.deepEqual(
    rest.map((e) => (e.type === 'counters' ? [e.n, !!e.checkup] : null)),
    [[3, false], [1, true]],
    'the 3 counters come first, then Poison at Checkup',
  );
  assert.equal(g.state.p[1].active!.damage, 30 + 30 + 10);
});

test('A delayed attack effect is dropped when the Defending Pokémon leaves the Active Spot or evolves first (TPCi 2026-07-16, ruling 2404)', () => {
  const dk = deck(SLO, REL, KING, DRA);
  const retreat = scenario(dk, dk, [{ active: SLO, energy: { active: [P, P] } }, { active: SLO, bench: [REL], energy: { active: [P, P] } }], { scripts: [delayer] });
  choose(retreat, 'Attack: Headbutt');
  choose(retreat, 'Retreat');
  assert.equal(retreat.state.delayed?.length, 0, 'the effect is removed when the Pokémon moves to the Bench');
  choose(retreat, 'End turn');
  assert.equal(retreat.state.p[1].active!.damage, 0, 'the new Active Pokémon is untouched');
  assert.equal(retreat.state.p[1].bench[0]!.damage, 20, 'and so is the old one: only the attack\'s 20');
  const evolve = scenario(dk, dk, [{ active: SLO, energy: { active: [P, P] } }, { active: SLO, hand: [KING] }], { scripts: [delayer] });
  choose(evolve, 'Attack: Headbutt');
  choose(evolve, 'Evolve');
  choose(evolve, 'End turn');
  assert.equal(evolve.state.p[1].active!.damage, 20);
});
