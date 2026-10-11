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
import type { CardScript, Cond, Program, TriggerOn } from '../dsl.js';
import type { Game } from '../game.js';
import { scenario, type SideLayout } from '../scenario.js';
import type { CardFrame, Decision } from '../types.js';
import { ASLEEP, POISONED } from '../types.js';
import { PolicyPilot } from '../pilot/policy.js';
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
type Ability = [on: TriggerOn, program: Program, when?: Cond];
/** A Pokémon whose Abilities each run a program on a trigger. */
function mon(name: string, abilities: Ability[], hp = 200): string {
  const id = `t-o${++serial}`;
  const f = pokemon(id, name, { hp });
  f.abilities = abilities.map((_, i) => ({ kind: 'Ability', name: `${name} ${i + 1}`, effect: 'Synthetic.' }));
  CARDS.push(f);
  SCRIPTS.push({ id, name, abilities: abilities.map(([on, program, when], i) => ({ name: `${name} ${i + 1}`, triggers: [{ on, program, ...(when ? { when } : {}) }] })) });
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
mon('Attach Healer', [['allyAttachFromHand', heal30({ v: '__target' })]]);
mon('Sleeper', [['checkup', [{ op: 'heal', amount: 80, to: 'self' }], { slotIs: { ref: 'self', filter: { condition: 'asleep' } } }]]);
mon('Checkup Drawer', [['checkup', [{ op: 'draw', n: 1 }]]]);
mon('Mirror', [['checkup', [{ op: 'counters', n: { countersOn: 'self' }, to: 'oppActive' }]]]);
mon('Attach Chainer', [['allyAttachFromHand', [{ op: 'chooseCards', from: 'hand', filter: { cat: 'energy' }, min: 0, max: 1, as: 'x' }, { op: 'attach', cards: 'x', to: { v: '__target' } }]]]);

// An attack that leaves a timed effect on the Defending Pokémon, and another that does so before it damages it.
const ZAPPER = pokemon('t-oz', 'Zapper', { hp: 100, attacks: [['Zap', 'Colorless', null], ['Hexed', 'Colorless', null]] });
ZAPPER.attacks![0]!.effect = "During your opponent's next turn, whenever they attach an Energy card from their hand to the Defending Pokémon, put 3 damage counters on it.";
ZAPPER.attacks![1]!.effect = 'If the Defending Pokémon is damaged by an attack this turn, put 3 damage counters on it. This attack does 20 damage to it.';
CARDS.push(ZAPPER);
SCRIPTS.push({
  id: 't-oz',
  name: 'Zapper',
  attacks: {
    Zap: { post: [{ op: 'effect', static: { k: 'react', event: 'attachFromHand', program: counters3({ v: '__target' }) }, on: 'defender', duration: 'oppNextTurn' }] },
    Hexed: {
      program: [
        { op: 'effect', static: { k: 'react', event: 'damagedByAttack', program: counters3({ v: '__def' }) }, on: 'defender', duration: 'thisTurn' },
        { op: 'damage', amount: 20, to: 'oppActive' },
      ],
    },
  },
});

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
  const twins = at([{ active: 'Pup', damage: { active: 20 }, bench: ['End Mender', 'End Mender'] }, { active: 'Pup', bench: ['Pup'] }]);
  choose(twins, 'End turn');
  assert.equal(twins.decision!.kind, 'main', 'two heals: every order is the same, no question');
  assert.equal(dmg(twins, 0), 0);
});

// ------------------------------------------------------------------ the check made when an effect is applied

test('Checkup: an effect that needs a condition is checked when it is applied, also when the player picked it explicitly', () => {
  // P0's Sleeper (80 damage, Asleep) heals itself at Checkup only while still Asleep. The checks come first and the coin wakes it; picking
  // Sleeper next (another effect remains, so it is a real pick) must not heal it.
  const mk = (): Game => at([{ active: 'Sleeper', damage: { active: 80 }, cond: ASLEEP, bench: ['Pup'] }, { active: 'Pup', bench: ['Checkup Drawer'] }]);
  const g = mk();
  g.state.forcedCoins = [true]; // heads: wakes up
  choose(g, 'End turn');
  assert.deepEqual(labels(g).sort(), ['Check Special Conditions', 'Checkup Drawer', 'Sleeper']);
  choose(g, 'Check Special Conditions');
  assert.deepEqual(labels(g).sort(), ['Checkup Drawer', 'Sleeper'], 'the rest is asked again');
  choose(g, 'Sleeper');
  assert.equal(dmg(g, 0), 80, 'it woke up: not healed');
  // Tails: it stays Asleep, and the same pick heals it.
  const h = mk();
  h.state.forcedCoins = [false];
  choose(h, 'End turn');
  choose(h, 'Check Special Conditions');
  choose(h, 'Sleeper');
  assert.equal(dmg(h, 0), 0);
});

// ------------------------------------------------------------------ timed effects of attacks join the ordering

test('a timed effect of an attack that reacts to an Energy attach is ordered with the Abilities: the turn player chooses', () => {
  const run = (first: string): Game => {
    const g = at([
      { active: 'Zapper', energy: { active: ['Fighting Energy'] }, bench: ['Pup'] },
      { active: 'Attach Healer', damage: { active: 20 }, hand: ['Fighting Energy'], bench: ['Pup'] },
    ]);
    choose(g, 'Attack: Zap');
    choose(g, 'Attach Fighting Energy');
    assert.equal(g.decision!.kind, 'option');
    assert.equal(g.decision!.player, 1, "the turn's player (the one attaching) orders");
    assert.deepEqual(labels(g).sort(), ['Attach Healer', 'Zapper']);
    choose(g, first);
    return g;
  };
  assert.equal(dmg(run('Attach Healer'), 1), 30, "heal first (20 -> 0), then the 30 from the attack's effect");
  assert.equal(dmg(run('Zapper'), 1), 20, "the attack's effect first (50), then the heal");
});

test("a timed effect of an attack that reacts to damage is ordered with the damaged Pokémon's Abilities: its player chooses", () => {
  const run = (first: string): Game => {
    const g = at([{ active: 'Zapper', energy: { active: ['Fighting Energy'] }, bench: ['Pup'] }, { active: 'Solo', bench: ['Pup'] }]);
    choose(g, 'Attack: Hexed');
    assert.equal(g.decision!.kind, 'option');
    assert.equal(g.decision!.player, 1, "the damaged Pokémon's player orders");
    assert.deepEqual(labels(g).sort(), ['Solo', 'Zapper']);
    choose(g, first);
    return g;
  };
  // The attack does 20: the heal of 30 first leaves 0 + 30; the counters first leave 20 + 30 - 30.
  assert.equal(dmg(run('Solo'), 1), 30);
  assert.equal(dmg(run('Zapper'), 1), 20);
});

// ------------------------------------------------------------------ the same program does not always commute

test('the same program from different controllers is still asked (it can aim at different amounts)', () => {
  const run = (first: number): Game => {
    const g = at([{ active: 'Mirror', damage: { active: 20 }, bench: ['Pup'] }, { active: 'Mirror', damage: { active: 50 }, bench: ['Pup'] }]);
    choose(g, 'End turn');
    assert.equal(g.decision!.kind, 'option');
    assert.equal(g.decision!.player, 1);
    assert.deepEqual(labels(g), ['Mirror', 'Mirror']);
    g.submit([first]);
    return g;
  };
  // Each puts as many counters as it has on the other's Active: P0's first gives 20 + 50 = 70 to P1, which then puts 7 on P0 (90).
  const a = run(0);
  assert.deepEqual([dmg(a, 0), dmg(a, 1)], [90, 70]);
  const b = run(1);
  assert.deepEqual([dmg(b, 0), dmg(b, 1)], [70, 120]);
});

// ------------------------------------------------------------------ one moment is one batch

test('an effect caused by a chosen effect is its own batch: it cannot be picked as part of the earlier one, and it resolves next', () => {
  const g = at([
    { active: 'Pup', damage: { active: 20 }, bench: ['Attach Mender', 'Attach Chainer'], hand: ['Fighting Energy', 'Fighting Energy'] },
    { active: 'Pup', bench: ['Pup'] },
  ]);
  choose(g, 'Attach Fighting Energy');
  assert.deepEqual(labels(g).sort(), ['Attach Chainer', 'Attach Mender']);
  choose(g, 'Attach Chainer');
  // Chainer attaches the second Energy (asking which card): a new event.
  assert.equal(g.decision!.kind, 'cards');
  g.submit([0]);
  // The second attach's own effects are their own batch, ordered before the first batch's last effect: two names, not three.
  assert.equal(g.decision!.kind, 'option');
  assert.deepEqual(labels(g).sort(), ['Attach Chainer', 'Attach Mender'], "only the later event's effects are offered together");
  choose(g, 'Attach Mender');
  assert.equal(g.decision!.kind, 'main', "the later Chainer has no Energy left, and the earlier batch's Mender is the only one left");
  assert.equal(g.state.p[0].active!.energy.length, 2);
  assert.equal(dmg(g, 0), 0);
});

// ------------------------------------------------------------------ the policy pilot's stream

test('the policy pilot answers an order question without drawing from its sample stream', () => {
  const g = at([{ active: 'Pup', cond: POISONED, bench: ['Checkup Mender'] }, { active: 'Pup', bench: ['Checkup Hexer'] }]);
  const pilot = new PolicyPilot();
  const rng = (pilot as unknown as { rng: unknown }).rng;
  let asked = 0;
  for (let guard = 0; guard < 400 && !g.over; guard++) {
    const d = g.decision as Decision;
    const before = JSON.stringify(rng);
    const choice = pilot.choose(g, d);
    if (d.prompt === 'Which effect happens first?') {
      asked++;
      assert.deepEqual(choice, [0], "the engine's own order");
      assert.equal(JSON.stringify(rng), before, 'no sample was drawn');
    }
    g.submit(choice);
  }
  assert.ok(asked > 0, 'the game reached an order question');
});
