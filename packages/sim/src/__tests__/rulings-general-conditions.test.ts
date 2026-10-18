/**
 * Rulings audit, general-rule lane: Pokémon Rulings Compendium rulings filed under Special Conditions, Retreating, and Weakness and
 * Resistance that still hold in Standard (regulation marks H, I, J). One scenario test per ruling, named by its Compendium id, with a
 * one-line summary in our own words (the ruling text stays on compendium.pokegym.net/ruling/<id>/). The cards are synthetic, with
 * one-line scripts where a ruling needs an attack, an Ability or a Trainer. Rulings about mechanics that are gone (GX attacks,
 * Poké-Bodies, tournament time) are left out on purpose.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { CardScript, StaticEffect } from '../dsl.js';
import { describeOptions } from '../describe.js';
import type { Game } from '../game.js';
import { scenario, type SideLayout } from '../scenario.js';
import type { CardFrame, Decision, Player } from '../types.js';
import { ASLEEP, BURNED, CONFUSED, PARALYZED, POISONED } from '../types.js';
import { BIGEX, DOG, FIGHTING, PSYCHIC, PUP, deck, pokemon } from './fixtures.js';

function trainer(id: string, name: string, ttype: string, effect: string): CardFrame {
  return { ...pokemon(id, name, { hp: 10 }), category: 'Trainer', hp: null, stage: null, retreat: null, types: [], trainerType: ttype, effect, attacks: [] };
}
function withAbility(f: CardFrame, name: string, effect: string): CardFrame {
  return { ...f, abilities: [{ kind: 'Ability', name, effect }] } as CardFrame;
}
function described(f: CardFrame, effects: Record<string, string>): CardFrame {
  for (const a of f.attacks ?? []) a.effect = effects[a.name] ?? null;
  return f;
}

// Condition attacks with no damage of their own, so the damage seen is the Checkup's.
const WITCH = described(
  pokemon('t-c01', 'Witch', {
    hp: 120,
    type: 'Psychic',
    attacks: [
      ['Lullaby', 'Colorless', null],
      ['Toxic', 'Colorless', null],
      ['Venom', 'Colorless', null],
      ['Toxic Bite', 'Colorless', '20'],
      ['Scorch', 'Colorless', '10'],
      ['Stun', 'Colorless', null],
      ['Sting', 'Colorless', null],
      ['Bewilder', 'Colorless', null],
    ],
  }),
  {
    Lullaby: "Your opponent's Active Pokémon is now Asleep.",
    Toxic: "Your opponent's Active Pokémon is now Poisoned.",
    Venom: "Your opponent's Active Pokémon is now Poisoned. During Pokémon Checkup, put 2 damage counters on that Pokémon instead of 1.",
    'Toxic Bite': "Your opponent's Active Pokémon is now Poisoned.",
    Scorch: "Your opponent's Active Pokémon is now Burned.",
    Stun: "Your opponent's Active Pokémon is now Paralyzed.",
    Sting: "Flip a coin. If heads, your opponent's Active Pokémon is now Poisoned.",
    Bewilder: "Flip a coin. If heads, your opponent's Active Pokémon is now Confused.",
  },
);
// Attacks with a choice, a cost and a coin flip of their own, for the order of the Confusion check.
const TRICKSTER = described(
  pokemon('t-c02', 'Trickster', {
    hp: 120,
    attacks: [
      ['Pick Off', 'Colorless', null],
      ['Burnout', 'Colorless', '30'],
      ['Gamble', 'Colorless', null],
      ['Snare', 'Colorless', '10'],
    ],
  }),
  {
    'Pick Off': "This attack does 50 damage to 1 of your opponent's Pokémon.",
    Burnout: 'Discard an Energy from this Pokémon.',
    Gamble: 'Flip a coin. If heads, this attack does 60 damage.',
    Snare: "During your opponent's next turn, the Defending Pokémon can't retreat.",
  },
);
const HOPPER = pokemon('t-c03', 'Hopper', { hp: 60, retreat: 0 });
const GLIDER = withAbility(pokemon('t-c04', 'Glider', { hp: 90, retreat: 2 }), 'Updraft', 'This Pokémon has no Retreat Cost.');
const WEIGHER = withAbility(pokemon('t-c05', 'Weigher', { hp: 90 }), 'Heavy Air', "Your opponent's Active Pokémon's Retreat Cost is {C} more.");
const DUO = withAbility(pokemon('t-c06', 'Duo', { hp: 100, type: 'Fighting', attacks: [['Duo Beam', 'Colorless', '50']] }), 'Double Type', 'As long as this Pokémon is in play, it is {F} and {P} type.');
const PIERCER = described(pokemon('t-c07', 'Piercer', { hp: 100, type: 'Psychic', attacks: [['Pierce', 'Colorless', '60'], ['Poke', 'Colorless', '60']] }), {
  Pierce: "This attack's damage isn't affected by any effects on your opponent's Active Pokémon.",
});
const SWITCH = trainer('t-c08', 'Switch', 'Item', 'Switch your Active Pokémon with 1 of your Benched Pokémon.');
const DOUBLE: CardFrame = { ...FIGHTING, cardId: 't-c09', name: 'Double Energy', energyType: 'Special', regulationMark: 'I', effect: 'This card provides {C}{C} Energy.' };

const SCRIPTS: CardScript[] = [
  {
    id: 't-c01',
    name: 'Witch',
    attacks: {
      Lullaby: { post: [{ op: 'condition', cond: 'asleep', to: 'defender' }] },
      Toxic: { post: [{ op: 'condition', cond: 'poisoned', to: 'defender' }] },
      Venom: { post: [{ op: 'condition', cond: 'poisoned', to: 'defender', counters: 2 }] },
      'Toxic Bite': { post: [{ op: 'condition', cond: 'poisoned', to: 'defender' }] },
      Scorch: { post: [{ op: 'condition', cond: 'burned', to: 'defender' }] },
      Stun: { post: [{ op: 'condition', cond: 'paralyzed', to: 'defender' }] },
      Sting: {
        post: [
          { op: 'flip', n: 1, as: 'h' },
          { op: 'if', cond: { gt: [{ v: 'h' }, 0] }, then: [{ op: 'condition', cond: 'poisoned', to: 'defender' }] },
        ],
      },
      Bewilder: {
        post: [
          { op: 'flip', n: 1, as: 'h' },
          { op: 'if', cond: { gt: [{ v: 'h' }, 0] }, then: [{ op: 'condition', cond: 'confused', to: 'defender' }] },
        ],
      },
    },
  },
  {
    id: 't-c02',
    name: 'Trickster',
    attacks: {
      'Pick Off': {
        program: [
          { op: 'chooseSlots', from: 'oppPokemon', min: 1, max: 1, as: 't' },
          { op: 'damage', amount: 50, to: { v: 't' } },
        ],
      },
      Burnout: { pre: [{ op: 'discardEnergy', from: 'self', count: 1 }] },
      Gamble: {
        program: [
          { op: 'flip', n: 1, as: 'h' },
          { op: 'if', cond: { gt: [{ v: 'h' }, 0] }, then: [{ op: 'damage', amount: 60, to: 'defender' }] },
        ],
      },
      Snare: { post: [{ op: 'effect', static: { k: 'cantRetreat' }, on: 'defender', duration: 'oppNextTurn' }] },
    },
  },
  { id: 't-c04', name: 'Glider', abilities: [{ name: 'Updraft', statics: [{ effect: { k: 'retreatCost', set: 0 }, scope: 'self' }] }] },
  { id: 't-c05', name: 'Weigher', abilities: [{ name: 'Heavy Air', statics: [{ effect: { k: 'retreatCost', delta: 1 }, scope: 'oppActive' }] }] },
  { id: 't-c06', name: 'Duo', abilities: [{ name: 'Double Type', statics: [{ effect: { k: 'types', types: ['Fighting', 'Psychic'] }, scope: 'self' }] }] },
  { id: 't-c07', name: 'Piercer', attacks: { Pierce: { ignore: { defenderEffects: true } } } },
  { id: 't-c08', name: 'Switch', play: [{ op: 'switch', who: 'self' }] },
  { id: 't-c09', name: 'Double Energy', provides: ['Colorless', 'Colorless'] },
];

const D = deck('Conditions', [
  [PUP, 8],
  [DOG, 4],
  [BIGEX, 4],
  [WITCH, 4],
  [TRICKSTER, 4],
  [HOPPER, 4],
  [GLIDER, 4],
  [WEIGHER, 4],
  [DUO, 4],
  [PIERCER, 4],
  [SWITCH, 4],
  [DOUBLE, 4],
  [FIGHTING, 12],
  [PSYCHIC, 12],
]);

function at(sides: [SideLayout, SideLayout]): Game {
  return scenario(D, D, sides, { scripts: SCRIPTS, events: true });
}
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
function nameOf(g: Game, c: number): string {
  return g.ctx.defs[g.ctx.cardDef[c]!]!.name;
}
/** Who flipped each coin so far, in order. */
function flips(g: Game): Player[] {
  return g.events.flatMap((e) => (e.type === 'coin_flip' ? [e.player] : []));
}
/** Retreat a Pokémon whose Retreat Cost is 0: no Energy is discarded, and nothing is asked (offering any card would be overpaying). */
function freeRetreat(g: Game): void {
  choose(g, 'Retreat');
  assert.equal(g.decision?.kind, 'main', 'a Retreat Cost of 0 asks for no Energy');
}
/** A lasting effect on a Pokémon, as an attack (or with `fromAttack` false, a Trainer or Ability) would leave it. */
function inject(g: Game, p: Player, st: StaticEffect, fromAttack: boolean): number {
  const id = g.state.p[p].active!.id;
  g.state.effects.push({ static: st, slot: id, player: p, until: g.state.turn + 2, fromAttack, src: 0 });
  return id;
}
const P = 'Psychic Energy';
const F = 'Fighting Energy';

// ---------------------------------------------------------------- Special Conditions

test('Compendium #851: the Confusion flip comes first, before the attack asks for a target, pays a cost or flips its own coins', () => {
  // Tails: no target is chosen, no Energy is discarded, no second coin is flipped -- only the 3 counters on the attacker.
  const pick = at([{ active: 'Trickster', energy: { active: [F] }, cond: CONFUSED }, { active: 'Pup', bench: ['Pup'] }]);
  pick.state.forcedCoins = [false];
  choose(pick, 'Attack: Pick Off');
  assert.equal(pick.decision?.player, 1, 'no target was asked for: the turn is over');
  assert.equal(pick.state.p[0].active!.damage, 30);
  assert.equal(pick.state.p[1].active!.damage + pick.state.p[1].bench[0]!.damage, 0);
  const cost = at([{ active: 'Trickster', energy: { active: [F, F] }, cond: CONFUSED }, { active: 'Pup' }]);
  cost.state.forcedCoins = [false];
  choose(cost, 'Attack: Burnout');
  assert.equal(cost.state.p[0].active!.energy.length, 2, 'the cost was not paid');
  const coin = at([{ active: 'Trickster', energy: { active: [F] }, cond: CONFUSED }, { active: 'Dog' }]);
  coin.state.forcedCoins = [false, true];
  choose(coin, 'Attack: Gamble');
  assert.deepEqual(flips(coin), [0], "only the Confusion coin: the attack's own flip never came");
  assert.equal(coin.state.p[1].active!.damage, 0);
  // Control: heads on the Confusion flip, and the attack goes on to ask for its target.
  const ok = at([{ active: 'Trickster', energy: { active: [F] }, cond: CONFUSED }, { active: 'Pup', bench: ['Pup'] }]);
  ok.state.forcedCoins = [true];
  choose(ok, 'Attack: Pick Off');
  assert.equal(ok.decision?.kind, 'slots');
  assert.equal(ok.decision?.player, 0);
});

test('Compendium #852: a Burned Pokémon takes its 2 damage counters first, then flips: heads it recovers, tails it stays Burned', () => {
  for (const heads of [true, false]) {
    const g = at([{ active: 'Witch', energy: { active: [P] } }, { active: 'Big ex' }]);
    g.state.forcedCoins = [heads];
    choose(g, 'Attack: Scorch');
    assert.equal(g.state.p[1].active!.damage, 30, '10 from the attack and 20 for the Burn, whatever the flip');
    assert.deepEqual(flips(g), [1], 'one flip, by the Burned Pokémon\'s owner');
    assert.equal(Boolean(g.state.p[1].active!.cond & BURNED), !heads, heads ? 'heads: no longer Burned' : 'tails: still Burned');
  }
});

test('Compendium #853: a Pokémon Paralyzed on the opponent\'s turn sits out its own next turn and is free at the Checkup after it', () => {
  const g = at([{ active: 'Witch', energy: { active: [P] } }, { active: 'Big ex', bench: ['Pup'], energy: { active: [P, P, P] } }]);
  choose(g, 'Attack: Stun');
  assert.equal(g.decision?.player, 1);
  assert.ok(g.state.p[1].active!.cond & PARALYZED, 'still Paralyzed on its own turn');
  assert.ok(!has(g, 'Attack') && !has(g, 'Retreat'), 'a Paralyzed Pokémon can neither attack nor retreat');
  choose(g, 'End turn');
  assert.equal(g.state.p[1].active!.cond & PARALYZED, 0, 'Paralysis ends at the Checkup after its owner\'s turn');
  choose(g, 'End turn');
  assert.equal(g.decision?.player, 1);
  assert.ok(has(g, 'Attack: Mind Blast'), 'back to normal on its next turn');
});

test('Compendium #854: the Asleep flip and the Poison counter both come at the Checkup of the very turn the condition was given', () => {
  const sleep = at([{ active: 'Witch', energy: { active: [P] } }, { active: 'Big ex', energy: { active: [P, P, P] } }]);
  sleep.state.forcedCoins = [true];
  choose(sleep, 'Attack: Lullaby');
  assert.deepEqual(flips(sleep), [1], 'the sleeper flipped at the end of the turn it fell Asleep');
  assert.equal(sleep.state.p[1].active!.cond, 0, 'heads: it woke up before its own turn');
  assert.ok(has(sleep, 'Attack: Mind Blast'));
  const poison = at([{ active: 'Witch', energy: { active: [P] } }, { active: 'Big ex' }]);
  choose(poison, 'Attack: Toxic');
  assert.equal(poison.state.p[1].active!.damage, 10, 'one Poison counter at the end of the turn it was Poisoned');
});

test('Compendium #855: going to the Bench ends the effects of attacks on a Pokémon, so it can retreat once it is back in the Active Spot', () => {
  const g = at([
    { active: 'Trickster', energy: { active: [F] } },
    { active: 'Pup', bench: ['Hopper'], energy: { active: [F] }, hand: ['Switch', 'Switch'] },
  ]);
  choose(g, 'Attack: Snare');
  assert.equal(g.decision?.player, 1);
  assert.ok(!has(g, 'Retreat'), "control: Snare's effect stops the retreat");
  const pup = g.state.p[1].active!.id;
  choose(g, 'Play Switch');
  assert.equal(g.state.p[1].bench[0]!.id, pup, 'Pup went to the Bench');
  choose(g, 'Play Switch');
  assert.equal(g.state.p[1].active!.id, pup, 'Pup is back in the Active Spot');
  assert.ok(has(g, 'Retreat'), 'the attack effect ended when it went to the Bench');
});

test('Compendium #856: Poison stays through every Checkup until the Pokémon goes to the Bench, evolves or is Knocked Out', () => {
  const g = at([{ active: 'Pup', bench: ['Hopper'], hand: ['Dog'], cond: POISONED }, { active: 'Big ex' }]);
  choose(g, 'End turn');
  choose(g, 'End turn');
  assert.equal(g.state.p[0].active!.damage, 20, 'a counter at the Checkup after each player\'s turn');
  assert.ok(g.state.p[0].active!.cond & POISONED, 'still Poisoned two turns later');
  choose(g, 'Evolve Pup (Active) into Dog');
  assert.equal(g.state.p[0].active!.cond, 0, 'evolving ends it');
  const r = at([{ active: 'Pup', bench: ['Hopper'], energy: { active: [F] }, cond: POISONED }, { active: 'Big ex' }]);
  choose(r, 'Retreat');
  assert.equal(r.state.p[0].bench[0]!.cond, 0, 'going to the Bench ends it');
});

test('Compendium #858: a Pokémon that wakes up at the Checkup after the opponent\'s turn acts normally on its own turn', () => {
  for (const heads of [true, false]) {
    const g = at([{ active: 'Pup' }, { active: 'Big ex', bench: ['Pup'], energy: { active: [P, P, P] }, cond: ASLEEP }]);
    g.state.forcedCoins = [heads];
    choose(g, 'End turn');
    assert.equal(g.decision?.player, 1);
    assert.equal(has(g, 'Attack: Mind Blast'), heads, heads ? 'awake: it can attack' : 'still Asleep: no attack');
    assert.equal(has(g, 'Retreat'), heads, heads ? 'awake: it can retreat' : 'still Asleep: no retreat');
  }
});

test('Compendium #859: an attack that flips to Poison still flips when the Defending Pokémon is already Poisoned', () => {
  const g = at([{ active: 'Witch', energy: { active: [P] } }, { active: 'Big ex', cond: POISONED }]);
  g.state.forcedCoins = [true];
  choose(g, 'Attack: Sting');
  assert.deepEqual(flips(g), [0], "the attacker flipped the attack's coin");
  assert.ok(g.state.p[1].active!.cond & POISONED);
  assert.equal(g.state.p[1].active!.damage, 10, 'still one Poison counter, not two');
});

test('Compendium #860: putting an already Asleep Pokémon to Sleep again changes nothing: it still flips at every Checkup', () => {
  const g = at([{ active: 'Witch', energy: { active: [P] } }, { active: 'Big ex', cond: ASLEEP }]);
  g.state.forcedCoins = [false, true];
  choose(g, 'Attack: Lullaby');
  assert.deepEqual(flips(g), [1], 'it flipped at the Checkup after the attacker\'s turn');
  assert.ok(g.state.p[1].active!.cond & ASLEEP);
  choose(g, 'End turn');
  assert.deepEqual(flips(g), [1, 1], 'and again after its own turn');
  assert.equal(g.state.p[1].active!.cond, 0, 'heads: awake');
});

test('Compendium #861: the Asleep flip is not optional; its owner cannot choose to stay Asleep', () => {
  const g = at([{ active: 'Pup', bench: ['Hopper'], cond: ASLEEP }, { active: 'Big ex' }]);
  g.state.forcedCoins = [true];
  choose(g, 'End turn');
  assert.equal(g.decision?.kind, 'main', 'no question about the flip');
  assert.equal(g.decision?.player, 1);
  assert.deepEqual(flips(g), [0]);
  assert.equal(g.state.p[0].active!.cond, 0);
});

test('Compendium #862: an attack\'s "flip a coin, if heads Confused" is flipped every time, and heads replaces Paralysis with Confusion', () => {
  for (const heads of [true, false]) {
    const g = at([{ active: 'Witch', energy: { active: [P] } }, { active: 'Big ex', cond: PARALYZED }]);
    g.state.forcedCoins = [heads];
    choose(g, 'Attack: Bewilder');
    assert.deepEqual(flips(g), [0], 'the flip is part of the attack, never skipped or offered');
    assert.equal(g.state.p[1].active!.cond, heads ? CONFUSED : PARALYZED);
  }
});

test('Compendium #864: evolving takes away Special Conditions but not damage', () => {
  const g = at([{ active: 'Pup', hand: ['Dog'], damage: { active: 30 }, cond: POISONED | CONFUSED }, { active: 'Big ex' }]);
  choose(g, 'Evolve Pup (Active) into Dog');
  assert.equal(g.state.p[0].active!.damage, 30);
  assert.equal(g.state.p[0].active!.cond, 0);
});

test('Compendium #865: a Pokémon Poisoned by an attack takes a Poison counter at the Checkup right after that attack, on top of its damage', () => {
  const g = at([{ active: 'Witch', energy: { active: [P] } }, { active: 'Big ex' }]);
  choose(g, 'Attack: Toxic Bite');
  assert.equal(g.state.p[1].active!.damage, 30, '20 from the attack, 10 for Poison');
});

test('Compendium #866: the owner of the Asleep Pokémon flips for it', () => {
  const g = at([{ active: 'Pup' }, { active: 'Big ex', cond: ASLEEP }]);
  choose(g, 'End turn');
  assert.deepEqual(flips(g), [1], "P2's Pokémon: P2 flips, on P1's turn");
  const own = at([{ active: 'Pup', cond: ASLEEP }, { active: 'Big ex' }]);
  choose(own, 'End turn');
  assert.deepEqual(flips(own), [0]);
});

test('Compendium #850: a plain Poison given to a Pokémon with a stronger Poison replaces it: back to 1 counter per Checkup', () => {
  const g = at([{ active: 'Witch', energy: { active: [P] } }, { active: 'Big ex' }]);
  choose(g, 'Attack: Venom');
  assert.equal(g.state.p[1].active!.damage, 20, '2 counters a Checkup');
  choose(g, 'End turn');
  assert.equal(g.state.p[1].active!.damage, 40);
  choose(g, 'Attack: Toxic');
  assert.equal(g.state.p[1].active!.damage, 50, 'the new plain Poison: 1 counter');
  choose(g, 'End turn');
  assert.equal(g.state.p[1].active!.damage, 60);
});

// ---------------------------------------------------------------- Retreating

test('Compendium #834: retreating leaves damage on the Pokémon but takes away its Special Conditions and the effects of attacks', () => {
  const g = at([{ active: 'Pup', bench: ['Hopper'], energy: { active: [F] }, damage: { active: 30 }, cond: POISONED | CONFUSED }, { active: 'Big ex' }]);
  const id = inject(g, 0, { k: 'damageIn', amount: 30 }, true);
  choose(g, 'Retreat');
  const pup = g.state.p[0].bench.find((b) => b.id === id)!;
  assert.equal(pup.damage, 30, 'damage stays');
  assert.equal(pup.cond, 0, 'Special Conditions go');
  assert.equal(g.state.effects.filter((x) => x.slot === id).length, 0, 'attack effects go');
});

test('Compendium #835: the retreating Pokémon cannot be chosen as the new Active Pokémon', () => {
  const g = at([{ active: 'Pup', bench: ['Hopper', 'Glider'], energy: { active: [F] } }, { active: 'Big ex' }]);
  const pup = g.state.p[0].active!.id;
  choose(g, 'Retreat');
  assert.equal(g.decision?.kind, 'slots');
  assert.ok(!(g.decision!.values as number[]).includes(pup), 'the retreating Pokémon was offered');
  assert.deepEqual(labels(g).sort(), ['Glider', 'Hopper']);
  choose(g, 'Hopper');
  assert.equal(nameOf(g, g.state.p[0].active!.cards[0]!), 'Hopper');
  assert.ok(g.state.p[0].bench.some((b) => b.id === pup));
});

test('Compendium #836: retreating with a full Bench is a swap, so it is allowed', () => {
  const g = at([{ active: 'Pup', bench: ['Hopper', 'Hopper', 'Hopper', 'Hopper', 'Glider'], energy: { active: [F] } }, { active: 'Big ex' }]);
  assert.ok(has(g, 'Retreat'));
  choose(g, 'Retreat');
  choose(g, 'Glider');
  assert.equal(nameOf(g, g.state.p[0].active!.cards[0]!), 'Glider');
  assert.equal(g.state.p[0].bench.length, 5);
});

test('Compendium #837: no Energy may be discarded to retreat a Pokémon with no Retreat Cost', () => {
  const g = at([{ active: 'Hopper', bench: ['Pup'], energy: { active: [F] } }, { active: 'Big ex' }]);
  freeRetreat(g);
  assert.equal(nameOf(g, g.state.p[0].active!.cards[0]!), 'Pup', 'the retreat happened');
  assert.equal(g.state.p[0].discard.length, 0, 'nothing discarded');
  assert.equal(g.state.p[0].bench[0]!.energy.length, 1, 'the Energy stays on Hopper');
});

test('Compendium #838: a Retreat Cost increase gives a Pokémon with no printed cost a cost of 1, but not one an effect leaves with no cost', () => {
  const up = at([{ active: 'Hopper', bench: ['Pup'], energy: { active: [F] } }, { active: 'Big ex', bench: ['Weigher'] }]);
  choose(up, 'Retreat');
  assert.deepEqual(up.state.p[0].discard.map((c) => nameOf(up, c)), [F], 'Hopper now costs 1');
  const none = at([{ active: 'Hopper', bench: ['Pup'] }, { active: 'Big ex', bench: ['Weigher'] }]);
  assert.ok(!has(none, 'Retreat'), 'with no Energy it can no longer retreat');
  // An effect that says the Pokémon has no Retreat Cost wins over the increase (the same holds in rulings 1971 and 2082).
  const set = at([{ active: 'Glider', bench: ['Pup'], energy: { active: [F] } }, { active: 'Big ex', bench: ['Weigher'] }]);
  freeRetreat(set);
  assert.equal(nameOf(set, set.state.p[0].active!.cards[0]!), 'Pup', 'the retreat happened');
  assert.equal(set.state.p[0].discard.length, 0, 'still no Retreat Cost');
});

test('Compendium #839: the Retreat Cost is paid with Energy attached to the retreating Pokémon, never from the hand', () => {
  const g = at([{ active: 'Pup', bench: ['Hopper'], energy: { active: [F] }, hand: [F] }, { active: 'Big ex' }]);
  choose(g, 'Retreat');
  assert.deepEqual(g.state.p[0].hand.map((c) => nameOf(g, c)), [F], 'the Energy in hand stays there');
  assert.deepEqual(g.state.p[0].discard.map((c) => nameOf(g, c)), [F]);
  assert.equal(g.state.p[0].bench.find((b) => nameOf(g, b.cards[0]!) === 'Pup')!.energy.length, 0);
  const bare = at([{ active: 'Pup', bench: ['Hopper'], hand: [F] }, { active: 'Big ex' }]);
  assert.ok(!has(bare, 'Retreat'), 'Energy in hand does not pay a Retreat Cost');
});

// ---------------------------------------------------------------- Weakness and Resistance

test('Compendium #875: an attack whose damage ignores effects on the Defending Pokémon is still doubled by its Weakness', () => {
  const run = (attack: string): number => {
    const g = at([{ active: 'Piercer', energy: { active: [P] } }, { active: 'Dog' }]);
    inject(g, 1, { k: 'damageIn', amount: -30 }, false);
    choose(g, `Attack: ${attack}`);
    return g.state.p[1].active!.damage;
  };
  assert.equal(run('Poke'), 90, 'control: 60 x2 for Weakness, then 30 less');
  assert.equal(run('Pierce'), 120, 'the reduction is ignored, Weakness is not');
});

test('Compendium #876: "any effects" on the Defending Pokémon does not cover effects that change its Weakness or Resistance', () => {
  const noWeak = at([{ active: 'Piercer', energy: { active: [P] } }, { active: 'Dog' }]);
  inject(noWeak, 1, { k: 'noWeakness' }, false);
  inject(noWeak, 1, { k: 'damageIn', amount: -30 }, false);
  choose(noWeak, 'Attack: Pierce');
  assert.equal(noWeak.state.p[1].active!.damage, 60, 'no Weakness still holds; only the reduction is ignored');
  const newWeak = at([{ active: 'Piercer', energy: { active: [P] } }, { active: 'Big ex' }]);
  inject(newWeak, 1, { k: 'weaknessType', type: 'Psychic' }, false);
  choose(newWeak, 'Attack: Pierce');
  assert.equal(newWeak.state.p[1].active!.damage, 120, 'a changed Weakness still counts');
});

test('Compendium #877: an attacker of two types meets the Defending Pokémon\'s Weakness and Resistance with each of its types', () => {
  const resist = at([{ active: 'Duo', energy: { active: [F] } }, { active: 'Big ex' }]);
  choose(resist, 'Attack: Duo Beam');
  assert.equal(resist.state.p[1].active!.damage, 20, 'Big ex resists {F}: 50 - 30');
  const weak = at([{ active: 'Duo', energy: { active: [F] } }, { active: 'Dog' }]);
  choose(weak, 'Attack: Duo Beam');
  assert.equal(weak.state.p[1].active!.damage, 100, 'Dog is weak to {P}, the second type: 50 x2');
});

test('Compendium #2127: a Retreat Cost can be paid with as many Energy cards as the cost, even when fewer of them would cover it', () => {
  // Dog: Retreat Cost 2, with two Double Energy ({C}{C} each): one card covers it, and two cards is still not more cards than the cost.
  const g = at([{ active: 'Dog', bench: ['Pup'], energy: { active: ['Double Energy', 'Double Energy'] } }, { active: 'Big ex' }]);
  choose(g, 'Retreat');
  assert.equal(g.decision?.kind, 'option', 'one or two Double Energy: a choice');
  assert.deepEqual(labels(g).sort(), ['Discard Double Energy', 'Discard Double Energy + Double Energy']);
  choose(g, 'Double Energy + Double Energy');
  assert.deepEqual(g.state.p[0].discard.map((c) => nameOf(g, c)), ['Double Energy', 'Double Energy']);
  assert.equal(nameOf(g, g.state.p[0].active!.cards[0]!), 'Pup');
  // Never more cards than the cost: Double + Fighting + Fighting offers 1 Double, Double + Fighting, or both Fighting, not all three.
  const mix = at([{ active: 'Dog', bench: ['Pup'], energy: { active: ['Double Energy', F, F] } }, { active: 'Big ex' }]);
  choose(mix, 'Retreat');
  assert.deepEqual(labels(mix).sort(), ['Discard Double Energy', 'Discard Double Energy + Fighting Energy', 'Discard Fighting Energy + Fighting Energy']);
});

test('Compendium #867: when both Active Pokémon are Asleep, the player whose turn is next flips first', () => {
  const g = at([{ active: 'Pup', cond: ASLEEP }, { active: 'Big ex', cond: ASLEEP }]);
  g.state.forcedCoins = [true, false];
  choose(g, 'End turn');
  assert.deepEqual(flips(g), [1, 0], 'P2 (next to play) flips before P1');
  assert.equal(g.state.p[1].active!.cond, 0, "the first coin (heads) was P2's");
  assert.ok(g.state.p[0].active!.cond & ASLEEP, "the second coin (tails) was P1's");
});
