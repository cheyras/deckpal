/**
 * Effects that happen at the same time: the right player orders them (Advanced Player's Rulebook v3.4; Compendium rulings 146, 2146, 2135).
 * One scenario per moment, with synthetic cards whose effects do not commute (a heal that stops at zero damage, and counters), so the order
 * shows in the damage left:
 *   - a Pokémon is damaged (E-03): the damaged Pokémon's player
 *   - Knock Out step 2 of several Pokémon (E-04): the player whose turn it is
 *   - an Energy is attached: the player whose turn it is
 *   - Pokémon Checkup: the player whose turn is next, each effect before or after the Special Condition checks
 *   - the end of the turn: the player whose turn is ending
 * The rulebook text itself stays in the rulebook; this repository is public.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { describeOptions } from '../describe.js';
import type { CardScript, Program, TriggerOn } from '../dsl.js';
import type { Game } from '../game.js';
import { scenario, type SideLayout } from '../scenario.js';
import type { CardFrame, Decision } from '../types.js';
import { POISONED } from '../types.js';
import { FIGHTING, PUP, deck, pokemon } from './fixtures.js';

const labels = (g: Game): string[] => describeOptions(g.ctx, g.state, g.decision as Decision);
function choose(g: Game, text: string): void {
  const i = labels(g).findIndex((l) => l === text || l.includes(text));
  assert.ok(i >= 0, `no option containing "${text}" in: ${labels(g).join(' | ')} [${g.decision?.prompt}]`);
  g.submit([i]);
}

const CARDS: CardFrame[] = [];
const SCRIPTS: CardScript[] = [];
let serial = 0;
type Ability = [on: TriggerOn, program: Program];
/** A Pokémon whose Abilities each run a program on a trigger. */
function mon(name: string, abilities: Ability[], hp = 200): string {
  const id = `t-o${++serial}`;
  const f = pokemon(id, name, { hp });
  f.abilities = abilities.map((_, i) => ({ kind: 'Ability', name: `${name} ${i + 1}`, effect: 'Synthetic.' }));
  CARDS.push(f);
  SCRIPTS.push({ id, name, abilities: abilities.map(([on, program], i) => ({ name: `${name} ${i + 1}`, triggers: [{ on, program }] })) });
  return name;
}

// The heal stops at zero damage; the counters add. Healing first and then adding is not the same as the reverse.
type Ref = 'myActive' | 'oppActive' | { v: string };
const heal30 = (to: Ref): Program => [{ op: 'heal', amount: 30, to }];
const counters3 = (to: Ref): Program => [{ op: 'counters', n: 3, to }];

mon('Duo', [['damagedByAttackActive', heal30('myActive')], ['damagedByAttackActive', counters3('myActive')]]);
mon('Solo', [['damagedByAttackActive', heal30('myActive')]]);
mon('Twins', [['damagedByAttackActive', heal30('myActive')], ['damagedByAttackActive', heal30('myActive')]]);
mon('Martyr A', [['knockedOutByAttack', heal30('oppActive')]], 50);
mon('Martyr B', [['knockedOutByAttack', counters3('oppActive')]], 50);
mon('Attach Mender', [['allyAttachFromHand', heal30({ v: '__target' })]]);
mon('Attach Hexer', [['oppAttachFromHand', counters3({ v: '__target' })]]);
mon('Checkup Mender', [['checkup', heal30('myActive')]]);
mon('Checkup Hexer', [['checkup', counters3('oppActive')]]);
mon('End Mender', [['endOfTurn', heal30('myActive')]]);
mon('End Hexer', [['endOfTurn', counters3('myActive')]]);
mon('End Twin', [['endOfTurn', heal30('myActive')]]);

const BLASTER = pokemon('t-ob', 'Blaster', { hp: 100, attacks: [['Burst', 'Colorless', null]] });
BLASTER.attacks![0]!.effect = "This attack does 100 damage to your opponent's Active Pokémon and 100 damage to 1 of their Benched Pokémon.";
CARDS.push(BLASTER);
SCRIPTS.push({
  id: 't-ob',
  name: 'Blaster',
  attacks: {
    Burst: {
      program: [
        { op: 'damage', amount: 100, to: 'oppActive' },
        { op: 'chooseSlots', from: 'oppBench', min: 1, max: 1, as: 't' },
        { op: 'damage', amount: 100, to: { v: 't' } },
      ],
    },
  },
});

const DECK = deck('order', [[PUP, 8], ...CARDS.map((c): [CardFrame, number] => [c, 4]), [FIGHTING, 24]]);
function at(sides: [SideLayout, SideLayout], current: 0 | 1 = 0): Game {
  return scenario(DECK, DECK, sides, { scripts: SCRIPTS, current, turn: 4, first: 0 });
}
const attacker: SideLayout = { active: 'Pup', energy: { active: ['Fighting Energy'] } };
const dmg = (g: Game, p: 0 | 1): number => g.state.p[p].active!.damage;

// ------------------------------------------------------------------ a Pokémon is damaged

test('a damaged Pokémon: its player (not the turn player) orders the effects that activate, and both orders are possible', () => {
  // Bite does 20: heal first leaves max(0, 20 - 30) + 30 = 30, counters first leaves 20 + 30 - 30 = 20.
  const run = (first: string): Game => {
    const g = at([attacker, { active: 'Duo', bench: ['Pup'] }]);
    choose(g, 'Attack: Bite');
    assert.equal(g.decision!.kind, 'option', 'two effects at once: an order is asked');
    assert.equal(g.decision!.player, 1, "the damaged Pokémon's player orders, not the player whose turn it is");
    assert.deepEqual(labels(g), ['Duo', 'Duo']);
    g.submit([first === 'heal' ? 0 : 1]); // the order the engine used before this choice existed is heal first
    return g;
  };
  assert.equal(dmg(run('heal'), 1), 30, 'heal first');
  assert.equal(dmg(run('counters'), 1), 20, 'counters first');
});

test('a damaged Pokémon: a single effect, or the same effect twice, asks nothing', () => {
  const one = at([attacker, { active: 'Solo', bench: ['Pup'] }]);
  choose(one, 'Attack: Bite');
  assert.equal(dmg(one, 1), 0, 'Solo healed the 20 with no question');
  assert.notEqual(one.decision?.prompt, 'Which effect happens first?');
  const twin = at([attacker, { active: 'Twins', bench: ['Pup'] }]);
  choose(twin, 'Attack: Bite');
  assert.notEqual(twin.decision?.prompt, 'Which effect happens first?', 'two copies of one effect: every order is the same');
});

// ------------------------------------------------------------------ several Pokémon are Knocked Out

test('Knock Out step 2 of two Pokémon: the player whose turn it is orders the effects, not the Knocked Out Pokémon\'s player', () => {
  // The attacker has 20 damage on it. Martyr A heals 30 from it, Martyr B puts 3 counters on it.
  const run = (first: string): Game => {
    const g = at([{ ...attacker, active: 'Blaster', damage: { active: 20 } }, { active: 'Martyr A', bench: ['Martyr B'] }]);
    choose(g, 'Attack: Burst');
    assert.equal(g.decision!.kind, 'option', 'two Knock Out effects at once: an order is asked');
    assert.equal(g.decision!.player, 0, 'the player whose turn it is (the attacker) orders');
    assert.deepEqual(labels(g).sort(), ['Martyr A', 'Martyr B']);
    choose(g, first);
    return g;
  };
  assert.equal(dmg(run('Martyr A'), 0), 30, 'heal first: 20 -> 0, then 30');
  assert.equal(dmg(run('Martyr B'), 0), 20, 'counters first: 20 + 30, then the heal of 30');
});

// ------------------------------------------------------------------ an Energy is attached

test('an Energy attached: the player whose turn it is orders the effects, whoever they belong to', () => {
  const run = (first: string): Game => {
    const g = at([
      { active: 'Pup', damage: { active: 20 }, bench: ['Attach Mender'], hand: ['Fighting Energy'] },
      { active: 'Attach Hexer', bench: ['Pup'] },
    ]);
    choose(g, 'Attach Fighting Energy');
    // The Energy goes on the Active Pokémon (the only target offered is picked below when asked).
    if (g.decision!.kind !== 'option') choose(g, 'Pup');
    assert.equal(g.decision!.kind, 'option', 'two attach effects at once: an order is asked');
    assert.equal(g.decision!.player, 0, 'the turn player orders, although one effect is the opponent\'s');
    assert.deepEqual(labels(g).sort(), ['Attach Hexer', 'Attach Mender']);
    choose(g, first);
    return g;
  };
  assert.equal(dmg(run('Attach Mender'), 0), 30, 'heal first (20 -> 0), then 30');
  assert.equal(dmg(run('Attach Hexer'), 0), 20, 'counters first (50), then the heal');
});

// ------------------------------------------------------------------ Pokémon Checkup

test('Pokémon Checkup: the player whose turn is next orders an effect before or after the Special Condition checks', () => {
  // P0 ends the turn; P1's turn is next. P0's Active is Poisoned (10 damage at the checks) and has 0 damage; Checkup Mender heals 30.
  const run = (first: string): Game => {
    const g = at([{ active: 'Pup', cond: POISONED, bench: ['Checkup Mender'] }, { active: 'Pup', bench: ['Pup'] }]);
    choose(g, 'End turn');
    assert.equal(g.decision!.kind, 'option', 'an effect and the checks: an order is asked while a Special Condition is in play');
    assert.equal(g.decision!.player, 1, 'the player whose turn is next orders');
    assert.deepEqual(labels(g).sort(), ['Check Special Conditions', 'Checkup Mender']);
    choose(g, first);
    return g;
  };
  assert.equal(dmg(run('Checkup Mender'), 0), 10, 'before the checks: the heal has nothing to remove, then Poison adds 10');
  assert.equal(dmg(run('Check Special Conditions'), 0), 0, 'after the checks: Poison adds 10, then the heal removes it');
});

test('Pokémon Checkup: two effects and the checks are ordered one after another; nothing is asked with no Special Condition and one kind of effect', () => {
  const g = at([{ active: 'Pup', cond: POISONED, damage: { active: 20 }, bench: ['Checkup Mender'] }, { active: 'Pup', bench: ['Checkup Hexer'] }]);
  choose(g, 'End turn');
  assert.deepEqual(labels(g).sort(), ['Check Special Conditions', 'Checkup Hexer', 'Checkup Mender'], 'three things happen at once');
  choose(g, 'Checkup Hexer'); // 3 counters on P0's Active: 50
  assert.deepEqual(labels(g).sort(), ['Check Special Conditions', 'Checkup Mender'], 'the rest is asked again');
  choose(g, 'Checkup Mender'); // heal 30: 20
  assert.equal(g.decision!.kind, 'main', 'one thing is left: nothing to ask');
  assert.equal(g.state.current, 1);
  assert.equal(dmg(g, 0), 30, '20 + 30 - 30, then Poison 10 = 30');
  // Without a Special Condition on either Active Pokémon the checks do nothing: a lone effect is not asked about.
  const calm = at([{ active: 'Pup', damage: { active: 20 }, bench: ['Checkup Mender'] }, { active: 'Pup', bench: ['Pup'] }]);
  choose(calm, 'End turn');
  assert.equal(calm.decision!.kind, 'main');
  assert.equal(dmg(calm, 0), 0);
});

// ------------------------------------------------------------------ the end of the turn

test('the end of the turn: the player whose turn is ending orders the effects, and effects that are the same program are not asked', () => {
  const run = (first: string): Game => {
    const g = at([{ active: 'Pup', damage: { active: 20 }, bench: ['End Mender', 'End Hexer'] }, { active: 'Pup', bench: ['Pup'] }]);
    choose(g, 'End turn');
    assert.equal(g.decision!.kind, 'option');
    assert.equal(g.decision!.player, 0, 'the player whose turn is ending orders');
    assert.deepEqual(labels(g).sort(), ['End Hexer', 'End Mender']);
    choose(g, first);
    return g;
  };
  assert.equal(dmg(run('End Mender'), 0), 30, 'heal first (20 -> 0), then 30');
  assert.equal(dmg(run('End Hexer'), 0), 20, 'counters first (50), then the heal');
  const twins = at([{ active: 'Pup', damage: { active: 20 }, bench: ['End Mender', 'End Twin'] }, { active: 'Pup', bench: ['Pup'] }]);
  choose(twins, 'End turn');
  assert.equal(twins.decision!.kind, 'main', 'two heals: every order is the same, no question');
  assert.equal(dmg(twins, 0), 0);
});
