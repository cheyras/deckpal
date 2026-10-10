/**
 * Rule tests: each row of the battle-sim plan's rules table, checked in a
 * constructed position. Page numbers refer to the Pokémon TCG Rulebook (last
 * updated September 2026). Card behaviour is NOT under test here — the cards
 * are synthetic, with one-line scripts where a rule needs a Trainer or an effect.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { CardScript } from '../dsl.js';
import { describeOptions } from '../describe.js';
import { Game } from '../game.js';
import { applyCondition } from '../interp.js';
import { scenario, type SideLayout } from '../scenario.js';
import type { CardFrame, Decision } from '../types.js';
import { ASLEEP, BURNED, CONFUSED, PARALYZED, POISONED } from '../types.js';
import { BIGEX, DOG, FIGHTING, MEGA, PSYCHIC, PUP, deck, energy, pokemon } from './fixtures.js';

function trainer(id: string, name: string, ttype: string, effect: string): CardFrame {
  return {
    cardId: id,
    name,
    category: 'Trainer',
    hp: null,
    stage: null,
    suffix: null,
    evolvesFrom: null,
    trainerType: ttype,
    energyType: null,
    retreat: null,
    types: [],
    effect,
    regulationMark: 'I',
    attacks: [],
    abilities: [],
    weaknesses: [],
    resistances: [],
  };
}

const PAD = trainer('t-100', 'Pal Pad', 'Item', 'Draw a card.');
const COACH = trainer('t-101', 'Coach', 'Supporter', 'Draw 2 cards.');
const ARENA_A = trainer('t-102', 'Arena A', 'Stadium', 'Nothing happens.');
const ARENA_B = trainer('t-103', 'Arena B', 'Stadium', 'Nothing happens.');
const HEXER = pokemon('t-010', 'Hexer', {
  hp: 100,
  type: 'Psychic',
  retreat: 1,
  attacks: [
    ['Lullaby', 'Colorless', '10'],
    ['Toxic', 'Colorless', '10'],
    ['Scorch', 'Colorless', '10'],
    ['Stun', 'Colorless', '10'],
    ['Daze', 'Colorless', '10'],
    ['Snipe', 'Colorless', null],
  ],
});
for (const a of HEXER.attacks!) a.effect = a.name === 'Snipe' ? 'This attack does 50 damage to 1 of your opponent\'s Pokémon.' : 'Inflict a Special Condition.';

const SCRIPTS: CardScript[] = [
  { id: 't-100', name: 'Pal Pad', play: [{ op: 'draw', n: 1 }] },
  { id: 't-101', name: 'Coach', play: [{ op: 'draw', n: 2 }] },
  { id: 't-102', name: 'Arena A' },
  { id: 't-103', name: 'Arena B' },
  {
    id: 't-010',
    name: 'Hexer',
    attacks: {
      Lullaby: { post: [{ op: 'condition', cond: 'asleep', to: 'defender' }] },
      Toxic: { post: [{ op: 'condition', cond: 'poisoned', to: 'defender' }] },
      Scorch: { post: [{ op: 'condition', cond: 'burned', to: 'defender' }] },
      Stun: { post: [{ op: 'condition', cond: 'paralyzed', to: 'defender' }] },
      Daze: { post: [{ op: 'condition', cond: 'confused', to: 'defender' }] },
      Snipe: {
        program: [
          { op: 'chooseSlots', from: 'oppPokemon', min: 1, max: 1, as: 't' },
          { op: 'damage', amount: 50, to: { v: 't' } },
        ],
      },
    },
  },
];

const A = deck('A', [
  [PUP, 12],
  [DOG, 8],
  [HEXER, 4],
  [PAD, 4],
  [COACH, 4],
  [ARENA_A, 2],
  [ARENA_B, 2],
  [FIGHTING, 12],
  [PSYCHIC, 12],
]);
const B = deck('B', [
  [PUP, 12],
  [DOG, 8],
  [BIGEX, 4],
  [MEGA, 4],
  [FIGHTING, 16],
  [PSYCHIC, 16],
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

/** End the current turn and pass the next player's turn too, landing back on the original player. */
function passBoth(g: Game): void {
  choose(g, 'End turn');
  if (g.decision?.kind === 'main') choose(g, 'End turn');
}

test('p.11-13 first turns: the player going first cannot attack or play a Supporter on turn 1', () => {
  const g = at([{ active: 'Pup', energy: { active: ['Fighting Energy'] }, hand: ['Coach'] }, { active: 'Pup' }], { turn: 1, current: 0, first: 0 });
  assert.ok(!has(g, 'Attack'), 'turn-1 attack offered');
  assert.ok(!has(g, 'Play Coach'), 'turn-1 Supporter offered');
  const g2 = scenario(B, A, [{ active: 'Pup' }, { active: 'Pup', energy: { active: ['Fighting Energy'] }, hand: ['Coach'] }], { scripts: SCRIPTS, turn: 2, current: 1, first: 0 });
  assert.ok(has(g2, 'Attack: Bite'), 'second player cannot attack on turn 2');
  assert.ok(has(g2, 'Play Coach'), 'second player cannot play a Supporter on turn 2');
});

test('p.11-13 evolution: not on your own first turn, not a Pokémon put into play this turn', () => {
  const t1 = at([{ active: 'Pup', hand: ['Dog'] }, { active: 'Pup' }], { turn: 1, current: 0, first: 0 });
  assert.ok(!has(t1, 'Evolve'), 'evolved on the first player\'s first turn');
  const t2 = at([{ active: 'Pup' }, { active: 'Pup', hand: ['Dog'] }], { turn: 2, current: 1, first: 0 });
  assert.ok(!has(t2, 'Evolve'), 'evolved on the second player\'s first turn');
  const t3 = at([{ active: 'Pup', hand: ['Dog', 'Pup', 'Dog'] }, { active: 'Pup' }], { turn: 3, current: 0, first: 0 });
  assert.ok(has(t3, 'Evolve Pup (Active) into Dog'));
  choose(t3, 'Bench Pup');
  const evolveTargets = labels(t3).filter((l) => l.startsWith('Evolve'));
  assert.deepEqual(evolveTargets, ['Evolve Pup (Active) into Dog'], 'a Pokémon benched this turn was offered for evolution');
});

test('p.9-12 one Energy attachment per turn; Items unlimited; one Supporter; one Stadium; no same-name Stadium', () => {
  const g = at([
    { active: 'Pup', bench: ['Pup'], hand: ['Fighting Energy', 'Fighting Energy', 'Pal Pad', 'Pal Pad', 'Coach', 'Coach', 'Arena A', 'Arena A', 'Arena B'] },
    { active: 'Pup' },
  ]);
  choose(g, 'Attach Fighting Energy to Pup (Active)');
  assert.ok(!has(g, 'Attach Fighting Energy'), 'second Energy attachment offered');
  choose(g, 'Play Pal Pad');
  assert.ok(has(g, 'Play Pal Pad'), 'second Item not offered');
  choose(g, 'Play Coach');
  assert.ok(!has(g, 'Play Coach'), 'second Supporter offered');
  choose(g, 'Play Arena A');
  assert.ok(!has(g, 'Play Arena'), 'second Stadium offered in the same turn');
  passBoth(g);
  assert.ok(!has(g, 'Play Arena A'), 'same-name Stadium offered');
  assert.ok(has(g, 'Play Arena B'));
});

test('p.12 retreat: pay the cost in Energy, once per turn, never while Asleep or Paralyzed', () => {
  const g = at([{ active: 'Dog', bench: ['Pup'], energy: { active: ['Fighting Energy', 'Fighting Energy', 'Psychic Energy'] } }, { active: 'Pup' }]);
  choose(g, 'Retreat');
  // Retreat Cost 2 of 3 Energy: a choice of which 2 to discard.
  const d = g.decision as Decision;
  assert.equal(d.kind, 'cards');
  assert.equal(d.min, 2);
  g.submit([0, 1]);
  const ps = g.state.p[0];
  assert.equal(ps.discard.length, 2);
  assert.equal(g.ctx.defs[g.ctx.cardDef[ps.active!.cards[0]!]!]!.name, 'Pup');
  assert.ok(!has(g, 'Retreat'), 'retreated twice in a turn');

  for (const cond of [ASLEEP, PARALYZED]) {
    const k = at([{ active: 'Pup', bench: ['Pup'], energy: { active: ['Fighting Energy'] }, cond }, { active: 'Pup' }]);
    const what = cond === ASLEEP ? 'Asleep' : 'Paralyzed';
    assert.ok(!has(k, 'Retreat'), `retreat offered while ${what}`);
    assert.ok(!has(k, 'Attack'), `attack offered while ${what}`);
  }
});

test('p.14, 20 damage: Weakness ×2, Resistance −30, none on the Bench', () => {
  // Hexer (Psychic) Lullaby 10 into Pup (Psychic weakness) → 20.
  const g = at([{ active: 'Hexer', energy: { active: ['Psychic Energy'] } }, { active: 'Pup' }]);
  choose(g, 'Attack: Lullaby');
  assert.equal(g.state.p[1].active!.damage, 20, 'Weakness not applied');

  // Pup (Fighting) Headbutt 50 into Big ex (Fighting resistance −30) → 20.
  const r2 = scenario(A, B, [{ active: 'Pup', energy: { active: ['Fighting Energy', 'Fighting Energy'] } }, { active: 'Big ex' }], { scripts: SCRIPTS });
  choose(r2, 'Attack: Headbutt');
  assert.equal(r2.state.p[1].active!.damage, 20, 'Resistance not applied (50 − 30)');

  // Snipe 50 onto a Benched Pup (Psychic weakness): no Weakness on the Bench → 50, not 100.
  const b = at([{ active: 'Hexer', energy: { active: ['Psychic Energy'] } }, { active: 'Dog', bench: ['Pup'] }]);
  choose(b, 'Attack: Snipe');
  choose(b, 'Pup');
  assert.equal(b.state.p[1].bench[0]!.damage, 50, 'Weakness applied to a Benched Pokémon');
});

test('p.14, 23, 26 Knock Outs give 1 Prize, 2 for Pokémon ex, 3 for Mega Evolution Pokémon ex', () => {
  const cases: [string, number][] = [
    ['Pup', 1],
    ['Big ex', 2],
    ['Mega Bird ex', 3],
  ];
  for (const [target, prizes] of cases) {
    const g = at([{ active: 'Hexer', energy: { active: ['Psychic Energy'] } }, { active: target, bench: ['Pup'], damage: { active: 290 } }]);
    choose(g, 'Attack: Lullaby');
    assert.equal(g.state.p[0].prizes.length, 6 - prizes, `${target} gave the wrong number of Prize cards`);
    assert.equal(g.state.p[0].prizesTaken, prizes);
  }
});

test('p.8, 21 winning: last Prize card; no Pokémon in play; can\'t draw at the start of the turn', () => {
  const g = at([{ active: 'Hexer', energy: { active: ['Psychic Energy'] }, prizes: 1 }, { active: 'Pup', bench: ['Pup'], damage: { active: 60 } }]);
  choose(g, 'Attack: Lullaby');
  assert.equal(g.state.winner, 0);
  assert.equal(g.state.winReason, 'prizes');

  const n = at([{ active: 'Hexer', energy: { active: ['Psychic Energy'] } }, { active: 'Pup', damage: { active: 60 } }]);
  choose(n, 'Attack: Lullaby');
  assert.equal(n.state.winner, 0);
  assert.equal(n.state.winReason, 'no Pokémon in play');

  const d = at([{ active: 'Pup' }, { active: 'Pup', emptyDeck: true }]);
  choose(d, 'End turn'); // P2 can't draw at the start of their turn
  assert.equal(d.state.winner, 0);
  assert.equal(d.state.winReason, 'deck out');
});

test('p.15 Checkup: Poisoned 10, Burned 20 then flip, Asleep flip, Paralyzed wears off after its owner\'s turn', () => {
  const p = at([{ active: 'Hexer', energy: { active: ['Psychic Energy'] } }, { active: 'Big ex' }]);
  choose(p, 'Attack: Toxic');
  // 10 attack damage + 10 poison at Checkup.
  assert.equal(p.state.p[1].active!.damage, 20);
  assert.ok(p.state.p[1].active!.cond & POISONED);

  const b = at([{ active: 'Hexer', energy: { active: ['Psychic Energy'] } }, { active: 'Big ex' }]);
  b.state.forcedCoins = [true]; // heads: recovers after the 20
  choose(b, 'Attack: Scorch');
  assert.equal(b.state.p[1].active!.damage, 30);
  assert.ok(!(b.state.p[1].active!.cond & BURNED));

  const s = at([{ active: 'Hexer', energy: { active: ['Psychic Energy'] } }, { active: 'Big ex' }]);
  s.state.forcedCoins = [false]; // tails: stays Asleep
  choose(s, 'Attack: Lullaby');
  assert.ok(s.state.p[1].active!.cond & ASLEEP);
  assert.ok(!has(s, 'Attack'), 'an Asleep Pokémon was offered an attack');

  const z = at([{ active: 'Hexer', energy: { active: ['Psychic Energy'] } }, { active: 'Big ex', energy: { active: ['Psychic Energy', 'Psychic Energy', 'Psychic Energy'] } }]);
  choose(z, 'Attack: Stun');
  // P2's turn: Paralyzed — no attack, no retreat.
  assert.ok(z.state.p[1].active!.cond & PARALYZED);
  assert.ok(!has(z, 'Attack') && !has(z, 'Retreat'));
  choose(z, 'End turn'); // Checkup after P2's turn removes it
  assert.ok(!(z.state.p[1].active!.cond & PARALYZED));
});

test('p.15-16 Special Conditions: Asleep/Confused/Paralyzed replace each other; Poisoned and Burned stack; all clear on evolving or moving to the Bench', () => {
  const sl = { cond: 0 } as Parameters<typeof applyCondition>[0];
  applyCondition(sl, 'poisoned');
  applyCondition(sl, 'burned');
  applyCondition(sl, 'asleep');
  applyCondition(sl, 'confused');
  assert.equal(sl.cond, POISONED | BURNED | CONFUSED, 'rotation conditions must replace each other; Poisoned/Burned stack');
  applyCondition(sl, 'paralyzed');
  assert.equal(sl.cond, POISONED | BURNED | PARALYZED);

  // Evolving clears every condition.
  const g = at([{ active: 'Hexer', energy: { active: ['Psychic Energy'] } }, { active: 'Pup', bench: ['Dog'], hand: ['Dog'] }]);
  g.state.forcedCoins = [false];
  choose(g, 'Attack: Toxic');
  assert.ok(g.state.p[1].active!.cond & POISONED);
  choose(g, 'Evolve Pup (Active) into Dog');
  assert.equal(g.state.p[1].active!.cond, 0, 'evolving did not clear Special Conditions');

  // Retreating to the Bench clears them too.
  const r = at([{ active: 'Pup', bench: ['Pup'], energy: { active: ['Fighting Energy'] }, cond: POISONED | CONFUSED }, { active: 'Pup' }]);
  choose(r, 'Retreat');
  assert.equal(r.state.p[0].bench.find((b) => b.cond !== 0), undefined, 'a Benched Pokémon kept a Special Condition');
});

test('p.21 both Active Pokémon Knocked Out together: both players take Prize cards, then promote', () => {
  const KO_BOTH: CardScript = { id: 't-011', name: 'Fated', attacks: { 'Destined Fight': { program: [{ op: 'knockOut', target: 'myActive' }, { op: 'knockOut', target: 'oppActive' }] } } };
  const FATED = pokemon('t-011', 'Fated', { hp: 100, type: 'Fighting', attacks: [['Destined Fight', 'Colorless', null]] });
  FATED.attacks![0]!.effect = 'Both Active Pokémon are Knocked Out.';
  const D1 = deck('F', [[FATED, 4], [PUP, 16], [FIGHTING, 40]]);
  const g = scenario(D1, B, [{ active: 'Fated', bench: ['Pup'], energy: { active: ['Fighting Energy'] } }, { active: 'Big ex', bench: ['Pup', 'Pup'] }], { scripts: [KO_BOTH] });
  choose(g, 'Attack: Destined Fight');
  assert.equal(g.state.p[0].prizesTaken, 2, 'attacker should take 2 for Big ex');
  assert.equal(g.state.p[1].prizesTaken, 1, 'defender should take 1 for Fated');
  // P2 (whose turn is next) promotes first: a choice between two Pups.
  assert.equal(g.decision?.kind, 'promote');
  assert.equal(g.decision?.player, 1);
});

test('p.20 Confusion: tails puts 3 damage counters on the attacker and the attack does nothing', () => {
  const g = at([{ active: 'Hexer', energy: { active: ['Psychic Energy'] } }, { active: 'Big ex' }]);
  g.state.p[0].active!.cond = CONFUSED;
  g.state.forcedCoins = [false];
  choose(g, 'Attack: Lullaby');
  assert.equal(g.state.p[0].active!.damage, 30);
  assert.equal(g.state.p[1].active!.damage, 0);

  const h = at([{ active: 'Hexer', energy: { active: ['Psychic Energy'] } }, { active: 'Big ex' }]);
  h.state.p[0].active!.cond = CONFUSED;
  h.state.forcedCoins = [true];
  choose(h, 'Attack: Lullaby');
  assert.equal(h.state.p[1].active!.damage, 10);
});

test('p.8, 18 setup: mulligans give the opponent extra draws; a deck with no Basic loses', () => {
  const NOBASIC = deck('No Basics', [[DOG, 4], [FIGHTING, 56]]);
  const g = new Game(NOBASIC, B, 1, { first: 0 }).start();
  assert.equal(g.state.phase, 'over');
  assert.equal(g.state.winner, 1);

  const ONE = deck('One Basic', [[PUP, 1], [FIGHTING, 59]]);
  let sawExtra = false;
  for (let seed = 1; seed < 40 && !sawExtra; seed++) {
    const m = new Game(ONE, B, seed, { first: 0 }).start();
    if (m.state.p[0].mulligans > m.state.p[1].mulligans) {
      const d = m.decision as Decision;
      assert.equal(d.kind, 'mulliganDraws');
      assert.equal(d.player, 1);
      assert.equal(d.labels!.length, m.state.p[0].mulligans - m.state.p[1].mulligans + 1);
      sawExtra = true;
    }
  }
  assert.ok(sawExtra, 'no seed produced a mulligan in 40 tries');
});

void energy;
void MEGA;
