/**
 * Engine features added with the std-engine4 batch, each tested on its own (the cards that use them are in
 * cards-std-engine4.test.ts):
 *  1. Bench size from a static (`benchSize`) and the discard when it ends   2. no Weakness (`noWeakness`)
 *  3. an attack cost reduced by Energy of any type (`attackCostLess`)      4. attacks printed on an attached Tool (`grantsAttacks`)
 *  5. attacking twice (`attackTwice`)   6. play locks (`playLock`) and Item / Supporter effect prevention (`preventTrainerEffects`)
 *  7. the Berry trigger (`damageReduced`) and "damaged by an attack" anywhere (`damagedByAttack`)
 *  and, on the way, the `usable` attack gate, `heal` on a whole zone, the `of` owner on the `stadium` condition and the `benchRoom` expression.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { def } from '../context.js';
import { describeOptions } from '../describe.js';
import type { CardScript, Cond, Program, StaticEffect } from '../dsl.js';
import { advance, legalActions } from '../flow.js';
import { evalCond, evalExpr } from '../eval.js';
import type { Game } from '../game.js';
import { attackCost, benchLimit, canPay, canPayAttack, energyUnits, statics, weaknessOf } from '../query.js';
import { scenario, type SideLayout } from '../scenario.js';
import { cloneState, findSlot } from '../state.js';
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
/** The legal actions were listed when the position was built: list them again after changing it by hand. */
function refresh(g: Game): void {
  g.state.pending = null;
  advance(g.env, g.state);
}
const ENERGY: [string, number][] = ['mee-001', 'mee-002', 'mee-003', 'mee-004', 'mee-005', 'mee-006', 'mee-007', 'mee-008'].map((id) => [id, 10]);
const IDS: Record<string, string> = {
  'Pikachu ex': 'sv08.5-028', // Tera, 190 HP, Fighting-weak; Tail Whap {C} 30
  'Eevee ex': 'sv08.5-075', // Tera, 200 HP
  'Tatsugiri ex': 'sv08-142', // Tera, 160 HP; Surprise Pump {R}{W} 100
  Dreepy: 'sv06-128', // 70 HP, no Weakness; Petty Grudge {P} 10
  Chikorita: 'me01-008', // 70 HP, Fire-weak; Razor Leaf {G} 20
  "N's Darumaka": 'me02.5-032', // Fire, 80 HP, Water-weak; Rolling Tackle {C}{C} 20
  "N's Zorua": 'sv09-097', // Darkness, 70 HP; Scratch {D} 20
  Lotad: 'sv09-035', // Water, 60 HP; Water Gun {W} 20
  'Area Zero Underdepths': 'sv07-131',
  'Gravity Mountain': 'sv08-177',
  'Boss\'s Orders': 'me01-114',
  Switch: 'me01-130',
  'Rare Candy': 'me01-125',
  'Hero\'s Cape': 'sv05-152',
  'Maximum Belt': 'sv05-154',
  'Mega Zygarde ex': 'me03-047',
  'Technical Machine: Fluorite': 'sv08-188',
  'Core Memory': 'me03-070',
  'Festival Grounds': 'sv06-149',
  Dipplin: 'sv06-018',
  Swirlix: 'sv06-089',
  'Occa Berry': 'sv07-140',
  'Orthworm ex': 'sv07-110',
  Beldum: 'me04-059',
  Togepi: 'me02.5-080',
  Drakloak: 'sv06-129',
  'Dragapult ex': 'sv06-130',
  Kieran: 'sv06-154',
  'Jamming Tower': 'sv06-153',
};
function deck(...names: string[]) {
  return fromIds('engine4', [...[...new Set(names)].map((n): [string, number] => [IDS[n] ?? n, 10]), ...ENERGY]);
}
const rep = (name: string, n: number): string[] => Array.from({ length: n }, () => name);
/** Put the Stadium card from this player's deck into play, as if that player had played it. */
function stadium(g: Game, name: string, owner: 0 | 1 = 0): number {
  const dk = g.state.p[owner].deck;
  const i = dk.findIndex((c) => def(g.ctx, c).name === name);
  assert.ok(i >= 0, `no ${name} in P${owner + 1}'s deck`);
  const card = dk.splice(i, 1)[0] as number;
  g.state.stadium = { card, owner };
  return card;
}
const ec = (p: 0 | 1 = 0, slot = 0) => ({ player: p, slot, vars: {} });
/** A timed effect on a Pokémon (a stand-in for the Ability or attack that would have set it). */
function inject(g: Game, slotId: number, st: StaticEffect, fromAttack = false): void {
  const loc = findSlot(g.state, slotId)!;
  g.state.effects.push({ static: st, slot: slotId, player: loc.owner, until: g.state.turn + 1, fromAttack, src: 0 });
}
/** A timed player-level effect (a stand-in for a Stadium or Ability that locks a player). */
function injectPlayer(g: Game, player: 0 | 1, st: StaticEffect): void {
  g.state.effects.push({ static: st, slot: -1, player, until: g.state.turn + 1, fromAttack: false, src: 0 });
}
const dmg = (g: Game, p: 0 | 1): number => g.state.p[p].active!.damage;
const names = (g: Game, p: 0 | 1): string[] => g.state.p[p].bench.map((b) => def(g.ctx, b.cards[b.cards.length - 1]!).name);
void ({} as SideLayout);

// ------------------------------------------------------------------ 1. Bench size

test('benchSize: with a Tera Pokémon in play a player can have 8 Pokémon on the Bench; the other player still has 5', () => {
  const dk = deck('Pikachu ex', 'Dreepy', 'Area Zero Underdepths');
  const g = scenario(dk, dk, [
    { active: 'Pikachu ex', bench: rep('Dreepy', 5), hand: rep('Dreepy', 4) },
    { active: 'Dreepy', bench: rep('Dreepy', 5), hand: ['Dreepy'] },
  ]);
  assert.equal(benchLimit(g.env, g.state, 0), 5);
  assert.ok(!has(g, 'Bench Dreepy'), 'a full Bench of 5');
  assert.ok(evalCond(g.env, g.state, ec(), { benchFull: 'self' }));
  stadium(g, 'Area Zero Underdepths', 1); // played by the opponent: it covers each player who has a Tera Pokémon
  assert.equal(benchLimit(g.env, g.state, 0), 8, 'P1 has a Tera Pokémon in play');
  assert.equal(benchLimit(g.env, g.state, 1), 5, 'P2 has none');
  assert.ok(!evalCond(g.env, g.state, ec(), { benchFull: 'self' }));
  assert.ok(evalCond(g.env, g.state, ec(1), { benchFull: 'self' }));
  assert.equal(evalExpr(g.env, g.state, ec(), { benchRoom: 'self' }), 3);
  assert.equal(evalExpr(g.env, g.state, ec(), { benchRoom: 'opp' }), 0);
  refresh(g);
  for (let i = 0; i < 3; i++) choose(g, 'Bench Dreepy');
  assert.equal(g.state.p[0].bench.length, 8);
  assert.ok(!has(g, 'Bench Dreepy'), 'the 9th is not offered');
});

test('benchSize: the limit follows the Tera Pokémon: without one in play it is 5 again', () => {
  const dk = deck('Pikachu ex', 'Dreepy', 'Area Zero Underdepths');
  const g = scenario(dk, dk, [{ active: 'Dreepy', bench: rep('Dreepy', 5) }, { active: 'Dreepy' }]);
  stadium(g, 'Area Zero Underdepths', 0);
  assert.equal(benchLimit(g.env, g.state, 0), 5, 'no Tera Pokémon: the Stadium does nothing');
  assert.equal(benchLimit(g.env, g.state, 1), 5);
});

test('benchSize: a Bench left too big when the only Tera Pokémon is Knocked Out is cut to 5 after the Prize cards and before the new Active Pokémon', () => {
  const dk = deck('Pikachu ex', 'Dreepy', "N's Zorua", 'Area Zero Underdepths');
  const g = scenario(
    dk,
    dk,
    [
      { active: 'Pikachu ex', bench: rep('Dreepy', 8), damage: { active: 180 } },
      { active: "N's Zorua", energy: { active: ['Darkness Energy'] } },
    ],
    { current: 1, turn: 4 },
  );
  stadium(g, 'Area Zero Underdepths', 0);
  refresh(g);
  choose(g, 'Attack: Scratch'); // 20 damage: 200 on a 190-HP Pokémon
  assert.equal(g.state.p[1].prizes.length, 4, 'the Knock Out (an ex: 2 Prize cards) is taken first');
  const d = g.decision!;
  assert.equal(d.kind, 'slots', 'then the owner of the Bench chooses what to discard');
  assert.equal(d.player, 0);
  assert.equal(d.min, 3);
  assert.equal(d.max, 3);
  assert.equal(g.state.pending!.resume.k, 'benchDiscard');
  assert.equal(g.state.p[0].active, null, 'before choosing a new Active Pokémon');
  g.submit([0, 1, 2]);
  assert.equal(g.state.p[0].bench.length, 5);
  assert.equal(g.state.p[0].discard.length, 1 + 3, 'the Knocked Out Tera Pokémon and the three discarded');
  assert.equal(g.decision!.kind, 'promote');
  assert.equal(g.state.p[1].prizes.length, 4, 'discarding from the Bench is not a Knock Out');
});

test('benchSize: when the Stadium leaves play both players discard down to 5, the player who played it first', () => {
  const dk = deck('Pikachu ex', 'Eevee ex', 'Dreepy', 'Area Zero Underdepths', 'Gravity Mountain');
  const g = scenario(dk, dk, [
    { active: 'Pikachu ex', bench: rep('Dreepy', 7), hand: ['Area Zero Underdepths'] },
    { active: 'Eevee ex', bench: rep('Dreepy', 6), hand: ['Gravity Mountain'] },
  ]);
  choose(g, 'Play Area Zero Underdepths');
  assert.equal(g.state.p[0].bench.length, 7, 'Tera in play: all 7 stay');
  choose(g, 'End turn');
  assert.equal(g.state.current, 1);
  choose(g, 'Play Gravity Mountain'); // replaces it: neither Bench may stay over 5
  assert.equal(g.decision!.kind, 'slots');
  assert.equal(g.decision!.player, 0, 'the player who played Area Zero Underdepths discards first');
  assert.equal(g.decision!.min, 2);
  g.submit([0, 1]);
  assert.equal(g.decision!.player, 1, 'then the other player');
  assert.equal(g.decision!.min, 1);
  g.submit([0]);
  assert.equal(g.decision!.kind, 'main');
  assert.equal(g.state.p[0].bench.length, 5);
  assert.equal(g.state.p[1].bench.length, 5);
});

test('benchSize: the effect puts Pokémon onto the Bench with the room it had when it started (a Tera Pokémon put there first makes none)', () => {
  const dk = deck('Pikachu ex', 'Dreepy', 'Area Zero Underdepths', 'Switch');
  const stand: CardScript = { id: 'me01-130', name: 'Switch', play: [{ op: 'move', cards: { all: 'hand' }, to: 'bench' }] };
  const g = scenario(dk, dk, [{ active: 'Dreepy', bench: rep('Dreepy', 4), hand: ['Switch', 'Pikachu ex', 'Dreepy'] }, { active: 'Dreepy' }], { scripts: [stand] });
  stadium(g, 'Area Zero Underdepths', 0);
  refresh(g);
  assert.equal(benchLimit(g.env, g.state, 0), 5);
  choose(g, 'Play Switch');
  assert.deepEqual(names(g, 0), [...rep('Dreepy', 4), 'Pikachu ex'], 'only one space: the Dreepy stays in the hand');
});

// ------------------------------------------------------------------ 2. No Weakness

test('noWeakness: the Pokémon takes no extra damage from its Weakness while the effect applies', () => {
  const dk = deck("N's Darumaka", 'Chikorita');
  const mk = (): Game => scenario(dk, dk, [{ active: "N's Darumaka", energy: { active: ['Fire Energy', 'Fire Energy'] } }, { active: 'Chikorita' }]);
  const plain = mk();
  assert.equal(weaknessOf(plain.env, plain.state, plain.state.p[1].active!), 'Fire');
  choose(plain, 'Attack: Rolling Tackle');
  assert.equal(dmg(plain, 1), 40, 'Fire against a Fire-weak Pokémon: x2');
  const g = mk();
  inject(g, g.state.p[1].active!.id, { k: 'noWeakness' });
  assert.equal(weaknessOf(g.env, g.state, g.state.p[1].active!), null);
  choose(g, 'Attack: Rolling Tackle');
  assert.equal(dmg(g, 1), 20, 'no Weakness: the printed 20');
});

// ------------------------------------------------------------------ 3. Attack cost reduced by Energy of any type

test('canPay: leaving out requirements of any type', () => {
  assert.ok(!canPay(['Fire', 'Water'], ['Water']));
  assert.ok(canPay(['Fire', 'Water'], ['Water'], 1), 'the {R} is the requirement left out');
  assert.ok(canPay(['Fire', 'Water'], ['Fire'], 1), 'the {W} is');
  assert.ok(!canPay(['Fire', 'Water'], ['Grass'], 1), 'one unit of a type neither needs pays nothing');
  assert.ok(canPay(['Fire', 'Water', 'Colorless'], ['Grass', 'Fire'], 1), '{W} left out; {R} from the Fire, {C} from the Grass');
  assert.ok(!canPay(['Fire', 'Water', 'Colorless'], ['Grass', 'Lightning'], 1));
  assert.ok(canPay(['Fire'], [], 1), 'nothing is left to pay');
  assert.ok(canPay(['Fire', 'Water'], [], 2));
  assert.ok(canPay(['Fire', 'Fire'], ['Any'], 1), 'a unit that provides every type pays the one that is left');
  assert.ok(canPay(['Colorless', 'Colorless'], ['Fire'], 1));
  assert.ok(!canPay(['Colorless', 'Colorless', 'Colorless'], ['Fire'], 1));
});

test('attackCostLess: an attack costs 1 Energy less, of any type, in the payment check and in the cost shown', () => {
  const dk = deck('Tatsugiri ex', 'Lotad');
  const mk = (energy: string[], who = 'Tatsugiri ex', less?: { n: number; attack?: string }): Game => {
    const g = scenario(dk, dk, [{ active: who, energy: energy.length ? { active: energy } : {} }, { active: 'Lotad' }]);
    if (less) inject(g, g.state.p[0].active!.id, { k: 'attackCostLess', ...less });
    refresh(g);
    return g;
  };
  // Surprise Pump costs {R}{W}; Cinnabar Lure {R}{W}{D}.
  assert.ok(!has(mk(['Water Energy']), 'Attack: Surprise Pump'), 'one {W} alone does not pay {R}{W}');
  const w = mk(['Water Energy'], undefined, { n: 1 });
  assert.ok(has(w, 'Attack: Surprise Pump'), 'with 1 less, the {W} is enough: the {R} is left out');
  assert.ok(!has(w, 'Attack: Cinnabar Lure'), 'its three-Energy cost still needs two');
  assert.ok(has(mk(['Fire Energy'], undefined, { n: 1 }), 'Attack: Surprise Pump'), 'the other one may be left out instead');
  assert.ok(!has(mk(['Grass Energy'], undefined, { n: 1 }), 'Attack: Surprise Pump'), 'a type the attack does not use pays for nothing');
  const act = w.state.p[0].active!;
  assert.equal(attackCost(w.env, w.state, act, 0).length, 1, 'the cost shown is one Energy shorter');
  assert.ok(canPayAttack(w.env, w.state, act, 0, energyUnits(w.env, act)));
  assert.ok(!canPayAttack(w.env, w.state, act, 1, energyUnits(w.env, act)));
  // For one named attack only.
  const only = mk(['Water Energy'], undefined, { n: 1, attack: 'Cinnabar Lure' });
  assert.ok(!has(only, 'Attack: Surprise Pump'));
  // A single-Energy attack becomes free.
  assert.ok(has(mk([], 'Lotad', { n: 1 }), 'Attack: Water Gun'));
  assert.ok(!has(mk([], 'Lotad'), 'Attack: Water Gun'));
});

// ------------------------------------------------------------------ 4. Attacks printed on an attached Tool

test('grantsAttacks: a Pokémon can use the attack on its Tool; it needs that attack\'s Energy and runs as if printed on the Pokémon', () => {
  const dk = deck('Pikachu ex', 'Eevee ex', 'Technical Machine: Fluorite', 'Dreepy');
  const mk = (energy: string[]): Game =>
    scenario(dk, dk, [
      { active: 'Pikachu ex', bench: ['Eevee ex', 'Dreepy'], tools: { active: ['Technical Machine: Fluorite'] }, energy: { active: energy }, damage: { active: 60, 0: 120, 1: 30 } },
      { active: 'Dreepy' },
    ]);
  const poor = mk(['Grass Energy', 'Water Energy']);
  assert.ok(has(poor, 'Attack: Tail Whap'));
  assert.ok(!has(poor, 'Attack: Fluorite'), 'it costs {G}{W}{P}');
  const g = mk(['Grass Energy', 'Water Energy', 'Psychic Energy']);
  assert.ok(has(g, 'Attack: Tail Whap') && has(g, 'Attack: Fluorite'));
  const a = (g.decision!.actions ?? []).find((x) => x.t === 'attack' && x.card !== undefined);
  assert.ok(a && a.t === 'attack' && def(g.ctx, a.card!).name === 'Technical Machine: Fluorite' && a.idx === 0);
  const energyBefore = g.state.p[0].active!.energy.length;
  assert.equal(energyBefore, 3);
  choose(g, 'Attack: Fluorite');
  assert.equal(g.state.p[0].active!.energy.length, 0, 'all Energy discarded from the attacker');
  assert.equal(g.state.p[0].active!.damage, 0, 'the Tera Pokémon are healed...');
  assert.equal(g.state.p[0].bench[0]!.damage, 0);
  assert.equal(g.state.p[0].bench[1]!.damage, 30, '...and nothing else');
  assert.equal(g.state.p[1].active!.damage, 0, 'it does no damage');
  assert.equal(g.state.current, 1, 'an attack ends the turn');
  assert.ok(g.state.p[0].discard.some((c) => def(g.ctx, c).name === 'Technical Machine: Fluorite'), 'discarded at the end of the turn');
  assert.equal(g.state.p[0].active!.tools.length, 0);
});

test('grantsAttacks: the granting card can limit it to a Pokémon (Core Memory: Mega Zygarde ex); Jamming Tower switches it off with the Tool', () => {
  const dk = deck('Mega Zygarde ex', 'Core Memory', 'Dreepy');
  const four = ['Fighting Energy', 'Fighting Energy', 'Fighting Energy', 'Fighting Energy'];
  const z = scenario(dk, dk, [{ active: 'Mega Zygarde ex', tools: { active: ['Core Memory'] }, energy: { active: four } }, { active: 'Dreepy' }]);
  assert.ok(has(z, 'Attack: Geobuster') && has(z, 'Attack: Gaia Wave'));
  choose(z, 'Attack: Geobuster');
  assert.equal(z.state.p[1].active, null, '350 damage Knocks Out the Dreepy');
  assert.equal(z.state.p[0].active!.energy.length, 0, '"Discard all Energy from this Pokémon"');
  const other = scenario(dk, dk, [{ active: 'Dreepy', tools: { active: ['Core Memory'] }, energy: { active: four } }, { active: 'Dreepy' }]);
  assert.ok(!has(other, 'Attack: Geobuster'), 'another Pokémon can not use it');
  const dk2 = deck('Mega Zygarde ex', 'Core Memory', 'Dreepy', 'Jamming Tower');
  const jt = scenario(dk2, dk2, [{ active: 'Mega Zygarde ex', tools: { active: ['Core Memory'] }, energy: { active: four } }, { active: 'Dreepy' }]);
  assert.ok(has(jt, 'Attack: Geobuster'));
  stadium(jt, 'Jamming Tower', 1);
  refresh(jt);
  assert.ok(!has(jt, 'Attack: Geobuster'), 'Pokémon Tools have no effect');
  assert.ok(has(jt, 'Attack: Gaia Wave'), 'its own attack is unaffected');
});

// ------------------------------------------------------------------ 5. Attacking twice

const TWICE = (g: Game): void => {
  inject(g, g.state.p[0].active!.id, { k: 'attackTwice' });
  refresh(g);
};

test('attackTwice: after an attack the Pokémon may attack once more, then the turn ends; without it one attack ends the turn', () => {
  const dk = deck("N's Darumaka", 'Dreepy');
  const mk = (): Game => scenario(dk, dk, [{ active: "N's Darumaka", energy: { active: ['Fire Energy', 'Fire Energy'] } }, { active: 'Dreepy', bench: ['Dreepy', 'Dreepy'] }]);
  const one = mk();
  choose(one, 'Attack: Rolling Tackle');
  assert.equal(one.state.current, 1, 'one attack ends the turn');
  assert.equal(dmg(one, 1), 20);
});

test('attackTwice: the second attack is offered right after the first (with ending the turn), and then the turn ends', () => {
  const dk = deck("N's Darumaka", 'Dreepy');
  const g = scenario(dk, dk, [{ active: "N's Darumaka", energy: { active: ['Fire Energy', 'Fire Energy'] } }, { active: 'Dreepy', bench: ['Dreepy'] }]);
  TWICE(g);
  choose(g, 'Attack: Rolling Tackle');
  assert.equal(g.state.current, 0, 'still P1\'s turn');
  assert.equal(g.decision!.kind, 'main');
  assert.deepEqual(labels(g), ['Attack: Rolling Tackle', 'End turn'], 'only a second attack, or the end of the turn');
  assert.equal(g.state.attackUses, 1);
  assert.equal(cloneState(g.state).attackUses, 1, 'a clone keeps it');
  choose(g, 'Attack: Rolling Tackle');
  assert.equal(g.state.p[1].active!.damage, 40, 'two attacks of 20');
  assert.equal(g.state.current, 1, 'two attacks end the turn');
  assert.equal(g.state.attackUses, undefined, 'the count starts again with the next turn');
});

test('attackTwice: ending the turn after the first attack is allowed', () => {
  const dk = deck("N's Darumaka", 'Dreepy');
  const g = scenario(dk, dk, [{ active: "N's Darumaka", energy: { active: ['Fire Energy', 'Fire Energy'] } }, { active: 'Dreepy' }]);
  TWICE(g);
  choose(g, 'Attack: Rolling Tackle');
  choose(g, 'End turn');
  assert.equal(g.state.current, 1);
  assert.equal(dmg(g, 1), 20);
});

test('attackTwice: after the first attack Knocks Out the Active Pokémon and the opponent chooses a new one, it may attack again', () => {
  const dk = deck("N's Darumaka", 'Dreepy');
  const g = scenario(dk, dk, [
    { active: "N's Darumaka", energy: { active: ['Fire Energy', 'Fire Energy'] } },
    { active: 'Dreepy', bench: ['Dreepy', 'Dreepy'], damage: { active: 60 } },
  ]);
  TWICE(g);
  choose(g, 'Attack: Rolling Tackle');
  assert.equal(g.state.p[0].prizes.length, 5);
  assert.equal(g.decision!.kind, 'promote', 'P2 chooses a new Active Pokémon first');
  assert.equal(g.decision!.player, 1);
  g.submit([0]);
  assert.equal(g.decision!.kind, 'main');
  assert.equal(g.decision!.player, 0);
  assert.deepEqual(labels(g), ['Attack: Rolling Tackle', 'End turn']);
  choose(g, 'Attack: Rolling Tackle');
  assert.equal(dmg(g, 1), 20, 'the new Active Pokémon took the second attack');
  assert.equal(g.state.current, 1);
});

test('attackTwice: the effect is checked when the second attack is chosen (an Ability switched off in between loses it)', () => {
  const dk = deck("N's Darumaka", 'Dreepy');
  const g = scenario(dk, dk, [{ active: "N's Darumaka", energy: { active: ['Fire Energy', 'Fire Energy'] } }, { active: 'Dreepy' }]);
  TWICE(g);
  choose(g, 'Attack: Rolling Tackle');
  assert.deepEqual(legalActions(g.env, g.state, 0).map((a) => a.t), ['attack', 'end']);
  g.state.effects = [];
  assert.deepEqual(legalActions(g.env, g.state, 0).map((a) => a.t), ['end'], 'no attackTwice effect any more');
});

test('attackTwice: only printed attacks repeat (an attack printed on a Technical Machine is not one)', () => {
  const dk = deck('Pikachu ex', 'Technical Machine: Fluorite', 'Dreepy');
  const mk = (): Game =>
    scenario(dk, dk, [
      { active: 'Pikachu ex', tools: { active: ['Technical Machine: Fluorite'] }, energy: { active: ['Grass Energy', 'Water Energy', 'Psychic Energy'] } },
      { active: 'Dreepy' },
    ]);
  const first = mk();
  TWICE(first);
  choose(first, 'Attack: Tail Whap');
  assert.deepEqual(labels(first), ['Attack: Tail Whap', 'End turn'], 'the Technical Machine\'s attack is not on offer the second time');
  const tm = mk();
  TWICE(tm);
  choose(tm, 'Attack: Fluorite');
  assert.equal(tm.state.current, 1, 'after a Technical Machine attack the turn ends');
});

test('attackTwice: an effect that ends the turn leaves no second attack', () => {
  const dk = deck("N's Darumaka", 'Dreepy');
  const ends: CardScript = { id: 'me02.5-032', name: "N's Darumaka", attacks: { 'Rolling Tackle': { post: [{ op: 'endTurn' }] } } };
  const g = scenario(dk, dk, [{ active: "N's Darumaka", energy: { active: ['Fire Energy', 'Fire Energy'] } }, { active: 'Dreepy' }], { scripts: [ends] });
  TWICE(g);
  choose(g, 'Attack: Rolling Tackle');
  assert.equal(g.state.current, 1);
});

// ------------------------------------------------------------------ 6. Play locks and Trainer-effect prevention

test('playLock: stops a player playing Stadium, Supporter, ACE SPEC cards or evolving from the hand, and nothing else', () => {
  const dk = deck('Dreepy', 'Drakloak', 'Dragapult ex', 'Rare Candy', 'Gravity Mountain', "Boss's Orders", "Hero's Cape", 'Switch');
  const mk = (): Game =>
    scenario(dk, dk, [
      { active: 'Dreepy', bench: ['Dreepy'], hand: ['Gravity Mountain', "Boss's Orders", "Hero's Cape", 'Drakloak', 'Rare Candy', 'Dragapult ex', 'Switch'] },
      { active: 'Dreepy', bench: ['Dreepy'] },
    ]);
  const base = labels(mk());
  for (const l of ['Play Gravity Mountain', "Play Boss's Orders", "Attach Hero's Cape", 'into Drakloak', 'Play Rare Candy', 'Play Switch']) {
    assert.ok(base.some((x) => x.includes(l)), `${l} is on offer: ${base.join(' | ')}`);
  }
  const cases: ['stadium' | 'supporter' | 'aceSpec' | 'evolve', string[]][] = [
    ['stadium', ['Play Gravity Mountain']],
    ['supporter', ["Play Boss's Orders"]],
    ['aceSpec', ["Attach Hero's Cape"]],
    ['evolve', ['into Drakloak', 'Play Rare Candy']],
  ];
  for (const [what, gone] of cases) {
    const g = mk();
    injectPlayer(g, 0, { k: 'playLock', what });
    refresh(g);
    const now = labels(g);
    for (const l of base) {
      const stopped = gone.some((x) => l.includes(x));
      assert.equal(now.includes(l), !stopped, `${what}: "${l}" ${stopped ? 'is stopped' : 'stays'}`);
    }
  }
  // It binds the affected player only.
  const g = mk();
  injectPlayer(g, 1, { k: 'playLock', what: 'stadium' });
  refresh(g);
  assert.equal(labels(g).length, base.length);
});

test('preventTrainerEffects: the effects of an Item (or Supporter) the opponent plays are not done to the Pokémon; its owner\'s are', () => {
  const dk = deck('Dreepy', 'Switch', 'Kieran', "Boss's Orders");
  const harass: Program = [
    { op: 'counters', n: 3, to: 'oppActive' },
    { op: 'condition', cond: 'poisoned', to: 'oppActive' },
    { op: 'discardEnergy', from: 'oppActive', count: 1 },
    { op: 'damage', amount: 30, to: 'oppActive' },
  ];
  const stand: CardScript[] = [
    { id: 'me01-130', name: 'Switch', play: harass },
    { id: 'sv06-154', name: 'Kieran', play: harass },
  ];
  const mk = (from: ('item' | 'supporter')[] | null): Game => {
    const g = scenario(dk, dk, [{ active: 'Dreepy', hand: ['Switch', 'Kieran'] }, { active: 'Dreepy', energy: { active: ['Fire Energy'] } }], { scripts: stand });
    if (from) inject(g, g.state.p[1].active!.id, { k: 'preventTrainerEffects', from });
    refresh(g);
    return g;
  };
  const hit = (g: Game): [number, boolean, number] => [dmg(g, 1), !!g.state.p[1].active!.cond, g.state.p[1].active!.energy.length];
  const plain = mk(null);
  choose(plain, 'Play Switch');
  assert.deepEqual(hit(plain), [60, true, 0], '3 counters + 30 damage, Poisoned, the Energy discarded');
  const items = mk(['item']);
  choose(items, 'Play Switch');
  assert.deepEqual(hit(items), [0, false, 1], 'an Item does nothing to a Pokémon protected from Items');
  choose(items, 'Play Kieran');
  assert.deepEqual(hit(items), [60, true, 0], 'a Supporter still does');
  const sup = mk(['supporter']);
  choose(sup, 'Play Kieran');
  assert.deepEqual(hit(sup), [0, false, 1]);
  choose(sup, 'Play Switch');
  assert.deepEqual(hit(sup), [60, true, 0]);
  const both = mk(['item', 'supporter']);
  choose(both, 'Play Switch');
  choose(both, 'Play Kieran');
  assert.deepEqual(hit(both), [0, false, 1]);
});

test('preventTrainerEffects: a Supporter that switches in a Benched Pokémon does nothing if the Active or the chosen Pokémon is protected', () => {
  const dk = deck('Dreepy', 'Chikorita', 'Lotad', "Boss's Orders");
  const mk = (protect: 'active' | 'bench' | 'other' | null): Game => {
    const g = scenario(dk, dk, [{ active: 'Dreepy', hand: ["Boss's Orders"] }, { active: 'Dreepy', bench: ['Chikorita', 'Lotad'] }]);
    const t = protect === 'active' ? g.state.p[1].active! : protect === 'bench' ? g.state.p[1].bench[0]! : g.state.p[1].bench[1]!;
    if (protect) inject(g, t.id, { k: 'preventTrainerEffects', from: ['supporter'] });
    refresh(g);
    return g;
  };
  const top = (g: Game): string => def(g.ctx, g.state.p[1].active!.cards[0]!).name;
  const free = mk(null);
  choose(free, "Play Boss's Orders");
  choose(free, 'Chikorita');
  assert.equal(top(free), 'Chikorita');
  const a = mk('active');
  choose(a, "Play Boss's Orders");
  assert.equal(top(a), 'Dreepy', 'the protected Active Pokémon stays (nothing was even asked)');
  const b = mk('bench');
  choose(b, "Play Boss's Orders");
  choose(b, 'Chikorita');
  assert.equal(top(b), 'Dreepy', 'the protected Chikorita does not come up');
  const c = mk('other');
  choose(c, "Play Boss's Orders");
  choose(c, 'Chikorita');
  assert.equal(top(c), 'Chikorita', 'a protected Pokémon that was not chosen changes nothing');
});

// ------------------------------------------------------------------ 7. Berries and "damaged by an attack" anywhere

const SPREAD: CardScript = { id: 'me02.5-032', name: "N's Darumaka", attacks: { 'Rolling Tackle': { target: { each: 'oppBench' } } } };

test('damageReduced: a Berry that reduced the damage is discarded, even when it took it to 0; one that did not apply stays', () => {
  const dk = deck("N's Darumaka", 'Togepi', 'Dreepy', 'Occa Berry');
  const fire = scenario(dk, dk, [{ active: 'Dreepy', tools: { active: ['Occa Berry'] } }, { active: "N's Darumaka", energy: { active: ['Fire Energy', 'Fire Energy'] } }], { current: 1, turn: 4 });
  choose(fire, 'Attack: Rolling Tackle');
  assert.equal(dmg(fire, 0), 0, '20 - 60: nothing');
  assert.equal(fire.state.p[0].active!.tools.length, 0, 'the Berry was discarded');
  assert.ok(fire.state.p[0].discard.some((c) => def(fire.ctx, c).name === 'Occa Berry'));
  // A {P} attacker: Occa Berry is for {R}.
  const psy = scenario(dk, dk, [{ active: 'Dreepy', tools: { active: ['Occa Berry'] } }, { active: 'Togepi', energy: { active: ['Fire Energy', 'Fire Energy'] } }], { current: 1, turn: 4 });
  choose(psy, 'Attack: Pound');
  assert.equal(dmg(psy, 0), 30);
  assert.equal(psy.state.p[0].active!.tools.length, 1, 'the Berry stays');
});

test('damageReduced: works on the Bench too (damage to Benched Pokémon)', () => {
  const dk = deck("N's Darumaka", 'Dreepy', 'Chikorita', 'Occa Berry');
  const g = scenario(
    dk,
    dk,
    [{ active: 'Dreepy', bench: ['Dreepy', 'Chikorita'], tools: { 0: ['Occa Berry'] } }, { active: "N's Darumaka", energy: { active: ['Fire Energy', 'Fire Energy'] } }],
    { current: 1, turn: 4, scripts: [SPREAD] },
  );
  choose(g, 'Attack: Rolling Tackle');
  const [berried, plain] = g.state.p[0].bench;
  assert.equal(berried!.damage, 0);
  assert.equal(berried!.tools.length, 0, 'the Benched Pokémon\'s Berry was discarded');
  assert.equal(plain!.damage, 20, 'the other Benched Pokémon took the damage');
});

test('damageReduced: damage that was prevented is not "damaged by an attack": the Berry stays', () => {
  const dk = deck("N's Darumaka", 'Dreepy', 'Pikachu ex', 'Occa Berry');
  const g = scenario(
    dk,
    dk,
    [{ active: 'Dreepy', bench: ['Pikachu ex'], tools: { 0: ['Occa Berry'] } }, { active: "N's Darumaka", energy: { active: ['Fire Energy', 'Fire Energy'] } }],
    { current: 1, turn: 4, scripts: [SPREAD] },
  );
  choose(g, 'Attack: Rolling Tackle');
  assert.equal(g.state.p[0].bench[0]!.tools.length, 1, 'a Benched Tera Pokémon takes no damage from attacks');
});

const PAYBACK: CardScript = { id: 'sv06-128', name: 'Dreepy', triggers: [{ on: 'damagedByAttack', program: [{ op: 'counters', n: 1, to: { v: '__attacker' } }] }] };

test('damagedByAttack: fires for the damaged Pokémon wherever it is, with the Attacking Pokémon known', () => {
  const dk = deck("N's Darumaka", 'Dreepy');
  const active = scenario(dk, dk, [{ active: 'Dreepy' }, { active: "N's Darumaka", energy: { active: ['Fire Energy', 'Fire Energy'] } }], { current: 1, turn: 4, scripts: [PAYBACK] });
  choose(active, 'Attack: Rolling Tackle');
  assert.equal(dmg(active, 0), 20);
  assert.equal(dmg(active, 1), 10, 'a counter on the Attacking Pokémon');
  // On the Bench: a spread attack.
  const bench = scenario(dk, dk, [{ active: 'Dreepy', bench: ['Dreepy'] }, { active: "N's Darumaka", energy: { active: ['Fire Energy', 'Fire Energy'] } }], {
    current: 1,
    turn: 4,
    scripts: [PAYBACK, SPREAD],
  });
  choose(bench, 'Attack: Rolling Tackle');
  assert.equal(dmg(bench, 0), 0, 'the Active Pokémon was not hit');
  assert.equal(bench.state.p[0].bench[0]!.damage, 20);
  assert.equal(dmg(bench, 1), 10, 'the Benched Pokémon that was hit paid back');
});

test('damagedByAttack: also when the damaged Pokémon is Knocked Out, and once per attack however often it was hit', () => {
  const dk = deck("N's Darumaka", 'Dreepy');
  const ko = scenario(dk, dk, [{ active: 'Dreepy', bench: ['Dreepy'], damage: { active: 60 } }, { active: "N's Darumaka", energy: { active: ['Fire Energy', 'Fire Energy'] } }], { current: 1, turn: 4, scripts: [PAYBACK] });
  choose(ko, 'Attack: Rolling Tackle');
  assert.equal(ko.state.p[1].prizes.length, 5, 'the Knock Out was settled: P2 took a Prize card');
  assert.equal(dmg(ko, 1), 10, 'the Knocked Out Pokémon still paid back');
  const twice: CardScript = {
    id: 'me02.5-032',
    name: "N's Darumaka",
    attacks: { 'Rolling Tackle': { program: [{ op: 'damage', amount: 10, to: 'defender' }, { op: 'damage', amount: 10, to: 'defender' }] } },
  };
  const two = scenario(dk, dk, [{ active: 'Dreepy' }, { active: "N's Darumaka", energy: { active: ['Fire Energy', 'Fire Energy'] } }], { current: 1, turn: 4, scripts: [PAYBACK, twice] });
  choose(two, 'Attack: Rolling Tackle');
  assert.equal(dmg(two, 0), 20);
  assert.equal(dmg(two, 1), 10, 'one reaction for one attack');
});

test('damagedByAttack: not when the damage was prevented', () => {
  const dk = deck("N's Darumaka", 'Dreepy');
  const g = scenario(dk, dk, [{ active: 'Dreepy' }, { active: "N's Darumaka", energy: { active: ['Fire Energy', 'Fire Energy'] } }], { current: 1, turn: 4, scripts: [PAYBACK] });
  inject(g, g.state.p[0].active!.id, { k: 'preventDamage' });
  choose(g, 'Attack: Rolling Tackle');
  assert.equal(dmg(g, 0), 0);
  assert.equal(dmg(g, 1), 0);
});

// ------------------------------------------------------------------ Small additions

test('usable: an attack gate hides the attack until it holds', () => {
  const dk = deck('Dreepy');
  const gated: CardScript = { id: 'sv06-128', name: 'Dreepy', attacks: { 'Petty Grudge': { usable: { gte: [{ handSize: 'self' }, 2] } } } };
  const few = scenario(dk, dk, [{ active: 'Dreepy', energy: { active: ['Psychic Energy'] } }, { active: 'Dreepy' }], { scripts: [gated] });
  assert.ok(!has(few, 'Attack: Petty Grudge'));
  const many = scenario(dk, dk, [{ active: 'Dreepy', hand: ['Dreepy', 'Dreepy'], energy: { active: ['Psychic Energy'] } }, { active: 'Dreepy' }], { scripts: [gated] });
  assert.ok(has(many, 'Attack: Petty Grudge'));
});

test('stadium condition: `of` says whose Stadium it is', () => {
  const dk = deck('Dreepy', 'Gravity Mountain');
  const g = scenario(dk, dk, [{ active: 'Dreepy' }, { active: 'Dreepy' }]);
  const none: Cond = { stadium: true, of: 'opp' };
  assert.ok(!evalCond(g.env, g.state, ec(0), none), 'no Stadium');
  stadium(g, 'Gravity Mountain', 1);
  assert.ok(evalCond(g.env, g.state, ec(0), none), "the opponent's");
  assert.ok(!evalCond(g.env, g.state, ec(0), { stadium: true, of: 'self' }));
  assert.ok(evalCond(g.env, g.state, ec(1), { stadium: true, of: 'self' }));
  assert.ok(evalCond(g.env, g.state, ec(0), { stadium: { name: 'Gravity Mountain' } }), 'without `of`: anyone\'s');
  assert.ok(!evalCond(g.env, g.state, ec(0), { stadium: { name: 'Gravity Mountain' }, of: 'self' }));
  void statics;
});

test('state: the new bookkeeping survives a clone (search copies the state)', () => {
  const dk = deck('Dreepy');
  const g = scenario(dk, dk, [{ active: 'Dreepy' }, { active: 'Dreepy' }]);
  g.state.attackUses = 1;
  g.state.attackedViaTool = true;
  g.state.noMoreAttacks = true;
  g.state.benchOwner = 1;
  const c = cloneState(g.state);
  assert.equal(c.attackUses, 1);
  assert.equal(c.attackedViaTool, true);
  assert.equal(c.noMoreAttacks, true);
  assert.equal(c.benchOwner, 1);
  c.attackUses = 2;
  assert.equal(g.state.attackUses, 1, 'and the copy is independent');
});
