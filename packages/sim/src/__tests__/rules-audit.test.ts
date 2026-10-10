/**
 * Adversarial rules audit: positions where an engine is most likely to drift
 * from the Pokémon TCG Rulebook (last updated September 2026). Each test is a
 * probe; a probe that once failed names the engine fix it pinned. Calls the
 * documents don't settle are `test.todo` with the open question.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { CardScript } from '../dsl.js';
import { describeOptions } from '../describe.js';
import type { Game } from '../game.js';
import { scenario, type SideLayout } from '../scenario.js';
import type { CardFrame, Decision } from '../types.js';
import { CONFUSED, POISONED } from '../types.js';
import { BIGEX, DOG, FIGHTING, PSYCHIC, PUP, deck, pokemon } from './fixtures.js';

function trainer(id: string, name: string, ttype: string, effect: string): CardFrame {
  return {
    ...pokemon(id, name, { hp: 10 }),
    category: 'Trainer',
    hp: null,
    stage: null,
    retreat: null,
    types: [],
    trainerType: ttype,
    effect,
    attacks: [],
  };
}

function withAbility(f: CardFrame, name: string, effect: string): CardFrame {
  return { ...f, abilities: [{ kind: 'Ability', name, effect }] } as CardFrame;
}

const COACH = trainer('t-201', 'Coach', 'Supporter', 'Draw 2 cards.');
const BAND = trainer('t-202', 'Band', 'Pokémon Tool', 'Nothing happens.');
const ARENA = trainer('t-203', 'Arena', 'Stadium', 'Nothing happens.');
const SEER = withAbility(pokemon('t-210', 'Seer', { hp: 60 }), 'Peek', 'Once during your turn, you may draw a card.');
const SAGE = withAbility(pokemon('t-211', 'Sage', { hp: 100, stage: 'Stage1', from: 'Seer' }), 'Ponder', 'Once during your turn, you may draw a card.');
const SPORE = pokemon('t-212', 'Spore', {
  hp: 100,
  attacks: [
    ['Spray', 'Colorless', null],
    ['Burnout', 'Colorless', '30'],
  ],
});
SPORE.attacks![0]!.effect = "Choose 1 of your opponent's Pokémon. That Pokémon is now Poisoned.";
SPORE.attacks![1]!.effect = 'Discard an Energy from this Pokémon.';
const FATED = pokemon('t-213', 'Fated', { hp: 100, attacks: [['Destined Fight', 'Colorless', null]] });
FATED.attacks![0]!.effect = 'Both Active Pokémon are Knocked Out.';

const SCRIPTS: CardScript[] = [
  { id: 't-201', name: 'Coach', play: [{ op: 'draw', n: 2 }] },
  { id: 't-202', name: 'Band' },
  { id: 't-203', name: 'Arena' },
  { id: 't-210', name: 'Seer', abilities: [{ name: 'Peek', activated: { program: [{ op: 'draw', n: 1 }] } }] },
  { id: 't-211', name: 'Sage', abilities: [{ name: 'Ponder', activated: { program: [{ op: 'draw', n: 1 }] } }] },
  {
    id: 't-212',
    name: 'Spore',
    attacks: {
      Spray: {
        program: [
          { op: 'chooseSlots', from: 'oppPokemon', min: 1, max: 1, as: 't' },
          { op: 'condition', cond: 'poisoned', to: { v: 't' } },
        ],
      },
      Burnout: { pre: [{ op: 'discardEnergy', from: 'self', count: 1 }] },
    },
  },
  { id: 't-213', name: 'Fated', attacks: { 'Destined Fight': { program: [{ op: 'knockOut', target: 'myActive' }, { op: 'knockOut', target: 'oppActive' }] } } },
];

const A = deck('Audit A', [
  [PUP, 8],
  [DOG, 4],
  [SEER, 4],
  [SAGE, 4],
  [SPORE, 4],
  [FATED, 4],
  [COACH, 4],
  [BAND, 4],
  [ARENA, 4],
  [FIGHTING, 10],
  [PSYCHIC, 10],
]);
const B = deck('Audit B', [
  [PUP, 12],
  [DOG, 8],
  [BIGEX, 4],
  [ARENA, 4],
  [BAND, 4],
  [COACH, 4],
  [FIGHTING, 12],
  [PSYCHIC, 12],
]);

function at(sides: [SideLayout, SideLayout], o: Parameters<typeof scenario>[3] = {}): Game {
  return scenario(A, B, sides, { scripts: SCRIPTS, ...o });
}
function labels(g: Game): string[] {
  return describeOptions(g.ctx, g.state, g.decision as Decision);
}
function has(g: Game, text: string): boolean {
  return labels(g).some((l) => l.includes(text));
}
function choose(g: Game, text: string): void {
  const i = labels(g).findIndex((l) => l.includes(text));
  assert.ok(i >= 0, `no option containing "${text}" in: ${labels(g).join(' | ')}`);
  g.submit([i]);
}
function nameOf(g: Game, card: number): string {
  return g.ctx.defs[g.ctx.cardDef[card]!]!.name;
}

test('evolving gives a new Pokémon: its own Ability is usable even after the Basic used one this turn', () => {
  const g = at([{ active: 'Seer', hand: ['Sage'] }, { active: 'Pup' }]);
  choose(g, 'Use Peek');
  assert.ok(!has(g, 'Use Peek'), 'Peek used twice in a turn');
  choose(g, 'Evolve Seer (Active) into Sage');
  assert.ok(has(g, 'Use Ponder'), 'the evolved Pokémon could not use its own, different Ability');
});

test('Special Conditions affect only the Active Pokémon: Poisoning a Benched Pokémon does nothing', () => {
  const g = at([{ active: 'Spore', energy: { active: ['Psychic Energy'] } }, { active: 'Dog', bench: ['Pup'] }]);
  choose(g, 'Attack: Spray');
  choose(g, 'Pup');
  // Spray ends P1's turn; P2 is now to act. The Benched Pup must carry no condition, and took no Checkup damage.
  const pup = g.state.p[1].bench[0]!;
  assert.equal(pup.cond & POISONED, 0, 'a Benched Pokémon was Poisoned');
  assert.equal(pup.damage, 0);
});

test('Checkup applies to both players\' Active Pokémon, not to the Bench', () => {
  const g = at([
    { active: 'Pup', bench: ['Pup'], cond: POISONED },
    { active: 'Dog', bench: ['Pup'], cond: POISONED },
  ]);
  choose(g, 'End turn');
  assert.equal(g.state.p[0].active!.damage, 10);
  assert.equal(g.state.p[1].active!.damage, 10);
  assert.equal(g.state.p[0].bench[0]!.damage + g.state.p[1].bench[0]!.damage, 0);
});

test('Confusion: tails ends the attack before any of its effects, including discarding Energy', () => {
  const g = at([{ active: 'Spore', energy: { active: ['Psychic Energy', 'Psychic Energy'] }, cond: CONFUSED }, { active: 'Big ex' }]);
  g.state.forcedCoins = [false];
  choose(g, 'Attack: Burnout');
  assert.equal(g.state.p[0].active!.energy.length, 2, 'a tails Confusion flip still discarded Energy');
  assert.equal(g.state.p[0].active!.damage, 30);
  assert.equal(g.state.p[1].active!.damage, 0);
});

test('retreat is allowed while Confused (only Asleep and Paralyzed stop it)', () => {
  const g = at([{ active: 'Pup', bench: ['Pup'], energy: { active: ['Fighting Energy'] }, cond: CONFUSED }, { active: 'Pup' }]);
  assert.ok(has(g, 'Retreat'));
});

test('evolving keeps damage, Energy and Tools; clears Special Conditions', () => {
  const g = at([
    { active: 'Pup', hand: ['Dog'], damage: { active: 30 }, energy: { active: ['Fighting Energy'] }, tools: { active: ['Band'] }, cond: POISONED },
    { active: 'Pup' },
  ]);
  choose(g, 'Evolve Pup (Active) into Dog');
  const sl = g.state.p[0].active!;
  assert.equal(sl.damage, 30);
  assert.equal(sl.energy.length, 1);
  assert.equal(sl.tools.length, 1);
  assert.equal(sl.cond, 0);
});

test('a Knocked Out Pokémon goes to the discard pile with every Energy and Tool attached', () => {
  const g = at([
    { active: 'Spore', energy: { active: ['Psychic Energy'] } },
    { active: 'Dog', bench: ['Pup'], damage: { active: 100 }, energy: { active: ['Fighting Energy', 'Psychic Energy'] }, tools: { active: ['Band'] } },
  ]);
  choose(g, 'Attack: Burnout');
  const names = g.state.p[1].discard.map((c) => nameOf(g, c)).sort();
  assert.deepEqual(names, ['Band', 'Dog', 'Fighting Energy', 'Psychic Energy']);
});

test('fewer Prize cards left than a Knock Out is worth: take what is left, and win', () => {
  const g = at([{ active: 'Spore', energy: { active: ['Psychic Energy'] }, prizes: 1 }, { active: 'Big ex', bench: ['Pup'], damage: { active: 200 } }]);
  choose(g, 'Attack: Burnout');
  assert.equal(g.state.p[0].prizes.length, 0);
  assert.equal(g.state.winner, 0);
  assert.equal(g.state.winReason, 'prizes');
});

test('Destined Fight with the last Prize: both players win one way each → tiebreaker (recorded as a draw)', () => {
  const g = at([{ active: 'Fated', energy: { active: ['Psychic Energy'] }, prizes: 1 }, { active: 'Pup', bench: ['Pup'] }]);
  choose(g, 'Attack: Destined Fight');
  assert.equal(g.state.phase, 'over');
  assert.equal(g.state.winner, null);
  assert.equal(g.state.winReason, 'simultaneous win');

  // Same, but the opponent had no Bench: the attacker wins two ways (Prizes + no Pokémon) against one.
  const h = at([{ active: 'Fated', energy: { active: ['Psychic Energy'] }, prizes: 1 }, { active: 'Pup' }]);
  choose(h, 'Attack: Destined Fight');
  assert.equal(h.state.winner, 0);
});

test('an effect that draws from an empty deck does not lose the game; only the start-of-turn draw does', () => {
  const g = at([{ active: 'Pup', hand: ['Coach'], emptyDeck: true }, { active: 'Pup' }]);
  choose(g, 'Play Coach');
  assert.notEqual(g.state.phase, 'over', 'drawing from an empty deck mid-turn ended the game');
  choose(g, 'End turn');
  choose(g, 'End turn'); // P2's turn ends; P1 can't draw at the start of turn 5
  assert.equal(g.state.winner, 1);
  assert.equal(g.state.winReason, 'deck out');
});

test('the second player draws on their first turn and may play a Supporter; the first player may not on turn 1', () => {
  const g = at([{ active: 'Pup' }, { active: 'Pup', hand: ['Coach'] }], { turn: 2, current: 1, first: 0, drawForTurn: true });
  assert.equal(g.state.p[1].hand.length, 2, 'the second player did not draw on their first turn');
  assert.ok(has(g, 'Play Coach'));
  const f = at([{ active: 'Pup', hand: ['Coach'] }, { active: 'Pup' }], { turn: 1, current: 0, first: 0, drawForTurn: true });
  assert.equal(f.state.p[0].hand.length, 2, 'the first player draws on turn 1 too');
  assert.ok(!has(f, 'Play Coach'));
});

test('a Stadium cannot be played onto a same-name Stadium, whoever played it', () => {
  const g = at([{ active: 'Pup', hand: ['Arena'] }, { active: 'Pup' }]);
  g.state.stadium = { card: g.state.p[1].deck.find((c) => nameOf(g, c) === 'Arena')!, owner: 1 };
  g.state.p[1].deck = g.state.p[1].deck.filter((c) => c !== g.state.stadium!.card);
  // Re-ask for the main decision with the Stadium in play.
  choose(g, 'End turn');
  choose(g, 'End turn');
  assert.ok(!has(g, 'Play Arena'), 'a same-name Stadium was offered');
});

test.todo(
  'mulligan extra draws: the engine draws them BEFORE placing the Active and Bench (setup steps extra0/extra1). ' +
    'Does the Sept 2026 Rulebook / Tournament Handbook put them after both players place Active, Bench and Prizes ' +
    '(so a Basic drawn this way can still be Benched, or cannot)? The order changes what the drawn cards can do.',
);
test.todo(
  'Paralyzed inflicted during its OWNER\'s turn (a self-Paralyzing attack, or an opponent\'s effect resolving on your turn): ' +
    'the engine removes it at that same turn\'s Checkup (p === current). The Rulebook says it recovers at the Checkup ' +
    '"after your next turn" / "if Paralyzed since the start of your last turn" — which wording governs?',
);
test.todo(
  'playing an Item or Supporter whose effect can do nothing (draw with an empty deck, search an empty deck): the engine ' +
    'offers it unless the card script has a `playable` guard. Is a no-effect Trainer legal to play (thinning, triggering ' +
    '"when you play" effects), or is "you can\'t play a card that would do nothing" a general rule?',
);
test.todo(
  'an Ability with the SAME name on the Basic and its Evolution (both "once during your turn"): after the Basic uses it ' +
    'and evolves, may the Evolution use it again? The fix for the evolution probe carries the used flag by Ability name.',
);
test.todo(
  'evolving clears effects of attacks; does it also clear effects from Trainers/Abilities applied to that Pokémon ' +
    '(e.g. "this Pokémon takes 30 less damage during your opponent\'s next turn" from an Item)? Engine: only fromAttack.',
);
