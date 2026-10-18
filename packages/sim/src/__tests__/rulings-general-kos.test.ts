/**
 * Rulings audit, general rules: Knock Outs and Prize cards, ways to win, and Mega Evolution Pokémon ex. Each Pokémon Rulings
 * Compendium ruling filed under those general categories that still applies to Standard is pinned by a scenario with synthetic
 * cards. The ruling text stays on compendium.pokegym.net (ruling/<id>/); each test name is our own one-line summary.
 * Not pinned here: rulings about cards or mechanics that left Standard (GX attacks, LEGEND, Prism Star), tournament Prize
 * penalties, a forgotten Prize card, and the tiebreaker game itself, which the simulator records as a draw instead of playing.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { CardScript } from '../dsl.js';
import { describeOptions } from '../describe.js';
import { evalExpr } from '../eval.js';
import type { Game } from '../game.js';
import { scenario, type SideLayout } from '../scenario.js';
import { topCard } from '../state.js';
import type { CardFrame, Decision, GameEvent } from '../types.js';
import { PARALYZED, POISONED } from '../types.js';
import { BIGEX, DOG, FIGHTING, MEGA, PSYCHIC, PUP, deck, pokemon } from './fixtures.js';

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
function special(id: string, name: string, effect: string): CardFrame {
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
    effect,
    regulationMark: 'I',
    attacks: [],
    abilities: [],
    weaknesses: [],
    resistances: [],
  };
}
function withAbility(f: CardFrame, name: string, effect: string): CardFrame {
  return { ...f, abilities: [{ kind: 'Ability', name, effect }] } as CardFrame;
}
function effects(f: CardFrame, texts: (string | null)[]): CardFrame {
  f.attacks!.forEach((a, i) => (a.effect = texts[i] ?? null));
  return f;
}

// Every attacker is Colorless, so no Weakness or Resistance gets in the way of the numbers.
const BOMBER = effects(
  pokemon('t-k01', 'Bomber', {
    hp: 60,
    attacks: [
      ['Selfdestruct', 'Colorless', '100'],
      ['Burst', 'Colorless', null],
      ['Crash', 'Colorless', null],
    ],
  }),
  ['This Pokémon also does 60 damage to itself.', "This attack does 50 damage to each of your opponent's Pokémon. This Pokémon also does 60 damage to itself.", 'Both Active Pokémon are Knocked Out.'],
);
const HEXER = effects(
  pokemon('t-k02', 'Hexer', {
    hp: 100,
    attacks: [
      ['Stun Bolt', 'Colorless', '30'],
      ['Mill', 'Colorless', null],
      ['Strike', 'Colorless', '60'],
    ],
  }),
  ["Your opponent's Active Pokémon is now Paralyzed.", "Discard the top 3 cards of your opponent's deck.", null],
);
const GRAVE = withAbility(pokemon('t-k03', 'Grave', { hp: 80 }), 'Last Curse', "Once during your turn, you may Knock Out this Pokémon. If you do, put 3 damage counters on 1 of your opponent's Pokémon.");
const CURSER = withAbility(pokemon('t-k04', 'Curser', { hp: 60 }), 'Hex Mark', "Once during your turn, you may put 3 damage counters on 1 of your opponent's Pokémon.");
const NOTES = trainer('t-k05', 'Study Notes', 'Supporter', 'Discard your hand and draw 7 cards.');
const BATON = trainer('t-k06', 'Relay Baton', 'Pokémon Tool', "If the Pokémon this card is attached to is Knocked Out by damage from an attack from your opponent's Pokémon, move all Energy from it to 1 of your Benched Pokémon.");
const HEIRLOOM = special('t-k07', 'Heirloom Energy', "As long as this card is attached to a Pokémon, it provides {C} Energy. If the Pokémon this card is attached to is Knocked Out by damage from an attack from your opponent's Pokémon, that player takes 1 fewer Prize card.");
// A Stage 1 Mega Evolution Pokémon ex of the Mega Evolution series (MEGA, the Basic one, is in fixtures.ts).
const MEGA_HOUND = pokemon('t-k08', 'Mega Hound ex', { hp: 280, stage: 'Stage1', from: 'Pup', suffix: 'ex', retreat: 2, attacks: [['Mega Fang', 'Colorless,Colorless', '150']] });

const SCRIPTS: CardScript[] = [
  {
    id: 't-k01',
    name: 'Bomber',
    attacks: {
      Selfdestruct: { post: [{ op: 'damage', amount: 60, to: 'self' }] },
      Burst: {
        program: [
          { op: 'damage', amount: 50, to: { each: 'oppPokemon' } },
          { op: 'damage', amount: 60, to: 'self' },
        ],
      },
      Crash: { program: [{ op: 'knockOut', target: 'myActive' }, { op: 'knockOut', target: 'oppActive' }] },
    },
  },
  {
    id: 't-k02',
    name: 'Hexer',
    attacks: {
      'Stun Bolt': { post: [{ op: 'condition', cond: 'paralyzed', to: 'defender' }] },
      Mill: { program: [{ op: 'move', cards: { top: 3, who: 'opp' }, to: 'discard', who: 'opp' }] },
    },
  },
  {
    id: 't-k03',
    name: 'Grave',
    abilities: [
      {
        name: 'Last Curse',
        activated: {
          program: [
            { op: 'knockOut', target: 'self' },
            { op: 'chooseSlots', from: 'oppPokemon', min: 1, max: 1, as: 't' },
            { op: 'counters', n: 3, to: { v: 't' } },
          ],
        },
      },
    ],
  },
  {
    id: 't-k04',
    name: 'Curser',
    abilities: [
      {
        name: 'Hex Mark',
        activated: {
          program: [
            { op: 'chooseSlots', from: 'oppPokemon', min: 1, max: 1, as: 't' },
            { op: 'counters', n: 3, to: { v: 't' } },
          ],
        },
      },
    ],
  },
  {
    id: 't-k05',
    name: 'Study Notes',
    play: [
      { op: 'move', cards: { all: 'hand' }, to: 'discard' },
      { op: 'draw', n: 7 },
    ],
  },
  {
    id: 't-k06',
    name: 'Relay Baton',
    triggers: [
      {
        on: 'knockedOutByAttack',
        program: [
          { op: 'discardEnergy', from: 'self', count: 'all', as: 'e' },
          { op: 'chooseSlots', from: 'myBench', min: 1, max: 1, as: 'b' },
          { op: 'attach', cards: 'e', to: { v: 'b' } },
        ],
      },
    ],
  },
  { id: 't-k07', name: 'Heirloom Energy', provides: ['Colorless'], koPrizeDelta: { delta: -1 } },
];

const A = deck('General A', [
  [BOMBER, 4],
  [HEXER, 4],
  [GRAVE, 4],
  [CURSER, 4],
  [PUP, 8],
  [DOG, 4],
  [MEGA, 4],
  [MEGA_HOUND, 4],
  [NOTES, 4],
  [FIGHTING, 10],
  [PSYCHIC, 10],
]);
const B = deck('General B', [
  [PUP, 12],
  [DOG, 4],
  [BIGEX, 4],
  [BATON, 4],
  [HEIRLOOM, 4],
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
  assert.ok(i >= 0, `no option containing "${text}" in: ${labels(g).join(' | ')} [${g.decision?.prompt}]`);
  g.submit([i]);
}
function nameOf(g: Game, card: number): string {
  return g.ctx.defs[g.ctx.cardDef[card]!]!.name;
}
/** Leave only `n` cards in that player's deck (the rest go to the discard pile). */
function thinDeck(g: Game, p: 0 | 1, n: number): void {
  const ps = g.state.p[p];
  ps.discard.push(...ps.deck.splice(0, ps.deck.length - n));
}
const E = 'Fighting Energy';

// ---------------------------------------------------------------- Knock Outs and Prize cards

test('Compendium #819: every opposing Pokémon an attack Knocks Out gives a Prize card, and an attacker that Knocks Out itself gives its opponent one too', () => {
  // Burst: 50 to each of P2's Pokémon (two of them have 40 HP left), 60 to Bomber itself (60 HP).
  const g = at([
    { active: 'Bomber', bench: ['Pup'], energy: { active: [E] } },
    { active: 'Pup', bench: ['Pup', 'Pup'], damage: { active: 30, 0: 30 } },
  ]);
  choose(g, 'Attack: Burst');
  assert.equal(g.state.p[0].prizesTaken, 2, 'one Prize card for each of the two Pups Knocked Out');
  assert.equal(g.state.p[1].prizesTaken, 1, 'Bomber Knocked Out by its own attack: its opponent takes a Prize card');
  assert.equal(g.state.p[1].bench.length + (g.state.p[1].active ? 1 : 0), 1, 'the undamaged Pup survived');
});

test('Compendium #818: when both Active Pokémon are Knocked Out at once, the player whose turn is next picks a new Active Pokémon first', () => {
  const g = at([
    { active: 'Bomber', bench: ['Pup', 'Dog'], energy: { active: [E] } },
    { active: 'Pup', bench: ['Pup', 'Dog'] },
  ]);
  choose(g, 'Attack: Crash');
  assert.equal(g.decision?.kind, 'promote');
  assert.equal(g.decision?.player, 1, 'P2 (next to play) promotes first');
  choose(g, 'Dog');
  assert.equal(g.decision?.kind, 'promote');
  assert.equal(g.decision?.player, 0, 'then the attacking player');
  choose(g, 'Pup');
  assert.equal(nameOf(g, topCard(g.state.p[1].active!)), 'Dog');
  assert.equal(nameOf(g, topCard(g.state.p[0].active!)), 'Pup');
  assert.equal(g.state.current, 1, "then P2's turn begins");
});

test('Compendium #817: Prize cards for a Knock Out are taken before the player whose Active Pokémon it was promotes a new one', () => {
  const g = at([{ active: 'Hexer', energy: { active: [E] } }, { active: 'Pup', bench: ['Pup', 'Dog'], damage: { active: 20 } }], { events: true });
  const hand = g.state.p[0].hand.length;
  choose(g, 'Attack: Strike');
  assert.equal(g.decision?.kind, 'promote');
  assert.equal(g.decision?.player, 1);
  assert.equal(g.state.p[0].prizesTaken, 1, 'the Prize card is already taken while P2 is still choosing');
  assert.equal(g.state.p[0].hand.length, hand + 1);
  choose(g, 'Dog');
  const order = g.events.filter((e) => e.type === 'prize_take' || e.type === 'promote').map((e) => e.type);
  assert.deepEqual(order, ['prize_take', 'promote']);
});

test('Compendium #815: with Knock Outs on both sides at once, the player whose turn is next takes Prize cards first, then the other; promotion follows in the same order', () => {
  // Crash Knocks Out both Active Pokémon on P1's turn: P2 is next to play.
  const g = at([
    { active: 'Bomber', bench: ['Pup', 'Dog'], energy: { active: [E] } },
    { active: 'Big ex', bench: ['Pup', 'Dog'] },
  ], { events: true });
  choose(g, 'Attack: Crash');
  choose(g, 'Dog'); // P2 promotes
  choose(g, 'Dog'); // P1 promotes
  const seq = g.events
    .filter((e): e is Extract<GameEvent, { type: 'prize_take' | 'promote' }> => e.type === 'prize_take' || e.type === 'promote')
    .map((e) => `${e.type}:P${e.player + 1}`);
  assert.deepEqual(seq, ['prize_take:P2', 'prize_take:P1', 'promote:P2', 'promote:P1']);
  assert.equal(g.state.p[0].prizesTaken, 2, 'Big ex is worth 2');
  assert.equal(g.state.p[1].prizesTaken, 1);
});

test('Compendium #814: a Pokémon Knocked Out by Poison at Pokémon Checkup still gives its opponent a Prize card', () => {
  const g = at([{ active: 'Pup', bench: ['Pup'], damage: { active: 60 }, cond: POISONED }, { active: 'Dog' }]);
  choose(g, 'End turn');
  assert.equal(g.state.p[1].prizesTaken, 1, 'P2 takes a Prize card for the Pup the Poison Knocked Out');
  assert.equal(g.state.p[0].prizesTaken, 0);
  assert.equal(g.state.p[0].active!.damage, 0, "P1's Benched Pup was promoted");
  assert.equal(g.state.current, 1);
});

test('Compendium #813: a player who Knocks Out their own Pokémon still gives the opponent its Prize card', () => {
  // By an attack's damage to itself: Selfdestruct does 60 to Bomber (60 HP); Big ex survives the 100.
  const atk = at([{ active: 'Bomber', bench: ['Pup'], energy: { active: [E] } }, { active: 'Big ex' }]);
  choose(atk, 'Attack: Selfdestruct');
  assert.equal(atk.state.p[1].active!.damage, 100);
  assert.equal(atk.state.p[1].prizesTaken, 1);
  assert.equal(atk.state.p[0].prizesTaken, 0);
  // By an Ability that Knocks Out the Pokémon using it, outside any attack.
  const ab = at([{ active: 'Pup', bench: ['Grave'] }, { active: 'Big ex' }]);
  choose(ab, 'Use Last Curse'); // Big ex is the only target: chosen without a question
  assert.equal(ab.state.p[1].active!.damage, 30);
  assert.equal(ab.state.p[1].prizesTaken, 1);
  assert.equal(ab.state.p[0].bench.length, 0, 'Grave is gone');
});

test('Compendium #812: an attack finishes its effects on the Knocked Out Defending Pokémon; the replacement Active Pokémon is not affected', () => {
  const g = at([{ active: 'Hexer', energy: { active: [E] } }, { active: 'Pup', bench: ['Pup', 'Dog'], damage: { active: 50 } }]);
  choose(g, 'Attack: Stun Bolt');
  assert.equal(g.decision?.kind, 'promote', 'Pup was Knocked Out');
  choose(g, 'Dog');
  const dog = g.state.p[1].active!;
  assert.equal(nameOf(g, topCard(dog)), 'Dog');
  assert.equal(dog.cond & PARALYZED, 0, 'the new Active Pokémon was Paralyzed by an attack that hit the old one');
  assert.equal(g.state.current, 1);
});

test('Compendium #810: a Pokémon Knocked Out during the turn, before any attack, gives up its Prize card at once, and the turn goes on', () => {
  // Hex Mark (3 damage counters) on a Pup with 30 HP left, in P1's main phase.
  const g = at([{ active: 'Curser', energy: { active: [E] } }, { active: 'Pup', bench: ['Pup', 'Dog'], damage: { active: 40 } }]);
  choose(g, 'Use Hex Mark');
  choose(g, 'Pup (Active)');
  assert.equal(g.state.p[0].prizesTaken, 1, 'the Prize card is taken right away, not at the end of the turn');
  assert.equal(g.decision?.kind, 'promote');
  assert.equal(g.decision?.player, 1, 'P2 promotes now, during P1\'s turn');
  choose(g, 'Dog');
  assert.equal(g.decision?.player, 0);
  assert.equal(g.state.current, 0);
  assert.ok(has(g, 'Attack: Tackle'), 'P1 may still attack the new Active Pokémon');
  choose(g, 'Attack: Tackle');
  assert.equal(g.state.p[1].active!.damage, 30);
});

test('Compendium #808: Prize cards are the last step of a Knock Out: an Energy moved off by a Knock Out effect no longer cuts the Prize count', () => {
  // Heirloom Energy: 1 fewer Prize card. Relay Baton moves it to the Bench as Big ex is Knocked Out, before Prize cards are taken.
  const run = (tools: string[]): Game => {
    const g = at([{ active: 'Hexer', energy: { active: [E] } }, { active: 'Big ex', bench: ['Pup'], damage: { active: 200 }, energy: { active: ['Heirloom Energy'] }, tools: { active: tools } }]);
    choose(g, 'Attack: Strike');
    if (g.decision?.player === 1 && g.decision.kind === 'slots') choose(g, 'Pup');
    return g;
  };
  const control = run([]);
  assert.equal(control.state.p[0].prizesTaken, 1, 'control: Heirloom Energy still attached, 1 fewer');
  const moved = run(['Relay Baton']);
  assert.equal(moved.state.p[0].prizesTaken, 2, 'the Energy left before Prize cards were taken: the full 2');
  assert.deepEqual(moved.state.p[1].active!.energy.map((c) => nameOf(moved, c)), ['Heirloom Energy'], 'the Energy is on the promoted Pup');
});

// ---------------------------------------------------------------- Ways to win

test('Compendium #883: three ways to win: take the last Prize card, leave the opponent with no Pokémon in play, or the opponent cannot draw at the start of their turn', () => {
  const prize = at([{ active: 'Hexer', energy: { active: [E] }, prizes: 1 }, { active: 'Pup', bench: ['Pup'], damage: { active: 20 } }]);
  choose(prize, 'Attack: Strike');
  assert.equal(prize.state.winner, 0);
  assert.equal(prize.state.winReason, 'prizes');
  const none = at([{ active: 'Hexer', energy: { active: [E] } }, { active: 'Pup', damage: { active: 20 } }]);
  choose(none, 'Attack: Strike');
  assert.equal(none.state.winner, 0);
  assert.equal(none.state.winReason, 'no Pokémon in play');
  const draw = at([{ active: 'Hexer' }, { active: 'Pup', emptyDeck: true }]);
  choose(draw, 'End turn');
  assert.equal(draw.state.winner, 0);
  assert.equal(draw.state.winReason, 'deck out');
});

test('Compendium #889: a draw effect bigger than the deck draws what is left; the player loses only when they cannot draw at the start of their next turn', () => {
  const g = at([{ active: 'Pup', hand: ['Study Notes', 'Dog'] }, { active: 'Pup' }]);
  thinDeck(g, 0, 3);
  choose(g, 'Play Study Notes');
  assert.equal(g.state.p[0].deck.length, 0);
  assert.equal(g.state.p[0].hand.length, 3, 'drew the 3 cards there were');
  assert.notEqual(g.state.phase, 'over', 'running out of cards mid-turn is not a loss');
  choose(g, 'End turn');
  assert.notEqual(g.state.phase, 'over', 'nor at the end of the turn, nor during the opponent\'s turn');
  choose(g, 'End turn');
  assert.equal(g.state.phase, 'over');
  assert.equal(g.state.winner, 1);
  assert.equal(g.state.winReason, 'deck out');
  assert.equal(g.state.turn, 5, 'at the start of P1\'s next turn');
});

test('Compendium #886: discarding the last cards of the opponent\'s deck wins when they cannot draw at the start of their next turn', () => {
  const run = (left: number): Game => {
    const g = at([{ active: 'Hexer', energy: { active: [E] } }, { active: 'Pup' }]);
    thinDeck(g, 1, left);
    choose(g, 'Attack: Mill');
    return g;
  };
  const out = run(3);
  assert.equal(out.state.p[1].deck.length, 0);
  assert.equal(out.state.winner, 0);
  assert.equal(out.state.winReason, 'deck out');
  assert.equal(out.state.turn, 4, "on P2's turn, at its draw");
  const one = run(4);
  assert.notEqual(one.state.phase, 'over', 'control: one card left, P2 draws it and plays on');
  assert.equal(one.decision?.player, 1);
  assert.equal(one.state.p[1].deck.length, 0);
});

test('Compendium #885: a player with no cards left in the deck still wins by Knocking Out the opponent\'s last Pokémon (or taking the last Prize card) that turn', () => {
  const none = at([{ active: 'Hexer', energy: { active: [E] }, emptyDeck: true }, { active: 'Pup', damage: { active: 20 } }]);
  assert.equal(none.state.p[0].deck.length, 0);
  choose(none, 'Attack: Strike');
  assert.equal(none.state.winner, 0);
  assert.equal(none.state.winReason, 'no Pokémon in play');
  const prize = at([{ active: 'Hexer', energy: { active: [E] }, emptyDeck: true, prizes: 1 }, { active: 'Pup', bench: ['Pup'], damage: { active: 20 } }]);
  choose(prize, 'Attack: Strike');
  assert.equal(prize.state.winner, 0);
  assert.equal(prize.state.winReason, 'prizes');
});

test('Compendium #887: taking the last Prize card on your turn wins before Pokémon Checkup, even if Poison would then Knock Out your last Pokémon', () => {
  // Hexer (100 HP) has 10 HP left and is Poisoned; it is P1's only Pokémon.
  const run = (prizes: number): Game => {
    const g = at([{ active: 'Hexer', energy: { active: [E] }, damage: { active: 90 }, cond: POISONED, prizes }, { active: 'Pup', bench: ['Pup'], damage: { active: 20 } }]);
    choose(g, 'Attack: Strike');
    return g;
  };
  const win = run(1);
  assert.equal(win.state.winner, 0);
  assert.equal(win.state.winReason, 'prizes');
  assert.equal(win.state.p[0].active!.damage, 90, 'no Checkup happened');
  assert.equal(win.state.p[1].prizesTaken, 0);
  // Control: not the last Prize card. The Checkup Knocks Out Hexer and P1 has no Pokémon left.
  const lose = run(2);
  assert.equal(lose.state.winner, 1);
  assert.equal(lose.state.winReason, 'no Pokémon in play');
});

test('Compendium #882: when an attack makes both players take their last Prize card, the one who can still put a Pokémon in the Active Spot wins; otherwise sudden death', () => {
  // Selfdestruct: 100 to P2's Pup, 60 to Bomber itself; both Knocked Out, both players at 1 Prize card.
  const run = (myBench: string[], oppBench: string[]): Game => {
    const g = at([{ active: 'Bomber', bench: myBench, energy: { active: [E] }, prizes: 1 }, { active: 'Pup', bench: oppBench, prizes: 1 }]);
    choose(g, 'Attack: Selfdestruct');
    return g;
  };
  const p1 = run(['Pup'], []);
  assert.equal(p1.state.winner, 0, 'P1 still has a Pokémon, P2 has none');
  const p2 = run([], ['Pup']);
  assert.equal(p2.state.winner, 1, 'P2 still has a Pokémon, P1 has none');
  for (const [mine, theirs] of [[['Pup'], ['Pup']], [[], []]] as [string[], string[]][]) {
    const tie = run(mine, theirs);
    assert.equal(tie.state.phase, 'setup', `bench ${mine.length}/${theirs.length}: the same number of ways each, so a sudden-death game starts`);
    assert.equal(tie.state.suddenDeath, 1);
  }
});

test('Compendium #884: an attack that Knocks Out the attacker and the Defending Pokémon for the last Prize card is sudden death if the attacker is left with no Pokémon, a win if the opponent is too', () => {
  // P1 needs 1 Prize card, P2 needs 3: P2's only way to win is P1 having no Pokémon left.
  const run = (oppBench: string[]): Game => {
    const g = at([{ active: 'Bomber', energy: { active: [E] }, prizes: 1 }, { active: 'Pup', bench: oppBench, prizes: 3 }]);
    choose(g, 'Attack: Selfdestruct');
    return g;
  };
  const tie = run(['Pup']);
  assert.equal(tie.state.phase, 'setup', 'a tie: a sudden-death game starts');
  assert.equal(tie.state.suddenDeath, 1);
  const win = run([]);
  assert.equal(win.state.winner, 0, 'two ways (last Prize card, no Pokémon left) against one');
  assert.equal(win.state.winReason, 'prizes');
});

test('Compendium #245: win conditions reached at the same moment by an Ability are counted: more ways wins, the same number is sudden death', () => {
  // Last Curse Knocks Out Grave and puts 3 damage counters on P2's Pup (30 HP left), in P1's main phase.
  const run = (mine: SideLayout, theirs: SideLayout): Game => {
    const g = at([mine, { active: 'Pup', damage: { active: 40 }, ...theirs }]);
    choose(g, 'Use Last Curse'); // P2's Pup is the only target
    return g;
  };
  // Both on 1 Prize card, both left with no Pokémon: two ways each.
  const tie = run({ active: 'Grave', prizes: 1 }, { prizes: 1 });
  assert.equal(tie.state.phase, 'setup', 'a tie: a sudden-death game starts');
  assert.equal(tie.state.suddenDeath, 1);
  // P1 keeps a Benched Pokémon: two ways against one.
  const more = run({ active: 'Grave', bench: ['Pup'], prizes: 1 }, { prizes: 1 });
  assert.equal(more.state.winner, 0);
  // P2 needs 3 Prize cards: P1 wins two ways (last Prize card, no Pokémon) against P2's one (no Pokémon).
  const mine = run({ active: 'Grave', prizes: 1 }, { prizes: 3 });
  assert.equal(mine.state.winner, 0);
  assert.equal(mine.state.winReason, 'prizes');
});

// ---------------------------------------------------------------- Mega Evolution Pokémon ex

test('Compendium #2235: a Mega Evolution Pokémon ex has its printed Stage (Basic, Stage 1 or Stage 2), not a separate Mega stage', () => {
  const g = at([{ active: 'Pup', bench: ['Pup'], hand: ['Mega Bird ex', 'Mega Hound ex'] }, { active: 'Pup' }]);
  assert.ok(has(g, 'Bench Mega Bird ex'), 'the Basic one is played to the Bench like any Basic Pokémon');
  assert.ok(!has(g, 'Bench Mega Hound ex'), 'the Stage 1 one is not a Basic');
  assert.ok(has(g, 'Evolve Pup into Mega Hound ex'), 'the Stage 1 one evolves from its Basic like any Stage 1');
  choose(g, 'Bench Mega Bird ex');
  choose(g, 'Evolve Pup into Mega Hound ex');
  const env = g.envForInternals;
  const count = (filter: object): number =>
    evalExpr(env, g.state, { player: 0, slot: g.state.p[0].active!.id, vars: {} }, { pokemon: { zone: 'myPokemon', filter } });
  assert.equal(count({ mega: true }), 2, 'both are Mega Evolution Pokémon ex');
  assert.equal(count({ mega: true, stage: 'basic' }), 1, 'Mega Bird ex counts as a Basic Pokémon');
  assert.equal(count({ mega: true, stage: 'stage1' }), 1, 'Mega Hound ex counts as a Stage 1 Pokémon');
  assert.equal(count({ mega: true, stage: 'evolution' }), 1);
  assert.equal(g.decision?.kind, 'main', 'evolving into a Mega Evolution Pokémon ex does not end the turn');
});

test('Compendium #809: Prize cards for a Knock Out worth several are taken one at a time, so a face-up one is taken (or left) by choice', () => {
  // Hexer Knocks Out Big ex (2 Prize cards) while 1 of P1's 3 Prize cards is face up (as after Cresselia's Crescent Purge). Face-down
  // Prize cards can't be told apart, so the choice is that card or "a face-down one", and the face-down one is whichever the pile gives.
  const g = at([{ active: 'Hexer', energy: { active: [E] }, prizes: 3 }, { active: 'Big ex', bench: ['Pup'], damage: { active: 200 } }]);
  const ps = g.state.p[0];
  const up = ps.prizes[0] as number;
  ps.prizesUp = [up];
  const before = ps.prizesTaken;
  choose(g, 'Attack: Strike');
  assert.equal(g.decision?.player, 0, 'the player taking Prize cards chooses');
  assert.equal(g.decision?.prompt, 'Take which Prize card?');
  assert.deepEqual(labels(g), ['A face-down Prize card', `${nameOf(g, up)} (face up)`]);
  choose(g, 'A face-down Prize card');
  // Second card: still a choice, and this time the face-up one is taken.
  assert.equal(g.decision?.prompt, 'Take which Prize card?');
  choose(g, '(face up)');
  assert.ok(ps.hand.includes(up), 'the face-up Prize card was taken');
  assert.equal(ps.prizes.length, 1);
  assert.equal(ps.prizesTaken, before + 2);
  assert.ok(!ps.prizes.includes(up));
  assert.ok(ps.revealed.includes(up), 'it was face up, so the opponent knows it is in that hand');

  // With every Prize card face down nothing is asked: taking from the top is the same as choosing one face down.
  const d = at([{ active: 'Hexer', energy: { active: [E] }, prizes: 3 }, { active: 'Big ex', bench: ['Pup'], damage: { active: 200 } }]);
  const dBefore = d.state.p[0].prizesTaken;
  choose(d, 'Attack: Strike');
  assert.notEqual(d.decision?.prompt, 'Take which Prize card?');
  assert.equal(d.state.p[0].prizesTaken, dBefore + 2);
});
