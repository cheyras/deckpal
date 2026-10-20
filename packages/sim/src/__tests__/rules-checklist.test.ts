/**
 * Rule tests for behaviour that was right but unpinned: items on the PTCG Live engine's checklist of mechanics (its evolve, Stadium
 * and turn-end handling) with no rule test in this package. Mega Evolution in the Mega Evolution series does not end the turn
 * (unlike the XY-era rule), and a Stadium that replaces another sends the old one to ITS OWNER's discard pile.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { def } from '../context.js';
import { describeOptions } from '../describe.js';
import type { Game } from '../game.js';
import { scenario } from '../scenario.js';
import type { Decision } from '../types.js';
import { fromIds } from './decks.js';
import { FIGHTING, PUP, deck, pokemon } from './fixtures.js';

const labels = (g: Game): string[] => describeOptions(g.ctx, g.state, g.decision as Decision);
function choose(g: Game, text: string): void {
  const i = labels(g).findIndex((l) => l.includes(text));
  assert.ok(i >= 0, `no option containing "${text}" in: ${labels(g).join(' | ')} [${g.decision?.prompt}]`);
  g.submit([i]);
}
const nameOf = (g: Game, card: number): string => def(g.ctx, card).name;

const MEGA_HOUND = pokemon('t-c01', 'Mega Hound ex', { hp: 300, stage: 'Stage1', from: 'Pup', suffix: 'ex', attacks: [['Howl', 'Colorless', '100']] });
const M = deck('M', [
  [PUP, 16],
  [MEGA_HOUND, 4],
  [FIGHTING, 40],
]);

test('Mega Evolution does not end the turn: the Mega Evolution Pokémon ex can attack the turn it evolved', () => {
  const g = scenario(M, M, [{ active: 'Pup', energy: { active: ['Fighting Energy'] }, hand: ['Mega Hound ex'] }, { active: 'Pup', bench: ['Pup'] }]);
  choose(g, 'Evolve Pup (Active) into Mega Hound ex');
  assert.equal(g.state.current, 0, 'still your turn');
  assert.equal(g.decision?.kind, 'main');
  assert.equal(def(g.ctx, g.state.p[0].active!.cards.at(-1)!).prizeValue, 3, 'a Mega Evolution Pokémon ex is worth 3 Prize cards');
  choose(g, 'Attack: Howl');
  assert.equal(g.state.p[0].prizesTaken, 1, 'Howl Knocked Out the 70 HP Pup');
});

const STADIUMS = fromIds('stadiums', [
  ['me02-085', 4], // Battle Cage
  ['sv06-153', 4], // Jamming Tower
  ['sv06-128', 20], // Dreepy
  ['mee-001', 32],
]);

test("a Stadium that replaces another sends the old one to its owner's discard pile, not the new Stadium's player's", () => {
  const g = scenario(STADIUMS, STADIUMS, [{ active: 'Dreepy', hand: ['Battle Cage'] }, { active: 'Dreepy', hand: ['Jamming Tower'] }]);
  choose(g, 'Play Battle Cage');
  assert.equal(g.state.stadium?.owner, 0);
  choose(g, 'End turn');
  assert.equal(g.state.current, 1);
  choose(g, 'Play Jamming Tower');
  assert.equal(nameOf(g, g.state.stadium!.card), 'Jamming Tower');
  assert.equal(g.state.stadium?.owner, 1);
  assert.ok(g.state.p[0].discard.some((c) => nameOf(g, c) === 'Battle Cage'), "Battle Cage is in P1's discard pile");
  assert.ok(!g.state.p[1].discard.some((c) => nameOf(g, c) === 'Battle Cage'));
});

// A search of your own hidden deck for a kind of card may find nothing; a search for any card, or a pick from the public discard pile,
// takes at least what the card says.
const SEEKER = { ...PUP, cardId: 't-c02', name: 'Seeker', category: 'Trainer', hp: null, stage: null, suffix: null, trainerType: 'Item', types: [], attacks: [], weaknesses: [], effect: 'Search your deck for a Pokémon, reveal it, and put it into your hand. Then, shuffle your deck.' };
const ANYSEEK = { ...SEEKER, cardId: 't-c03', name: 'Any Seeker', effect: 'Search your deck for a card and put it into your hand. Then, shuffle your deck.' };
const PICKUP = { ...SEEKER, cardId: 't-c04', name: 'Pick Up', effect: 'Put a Pokémon from your discard pile into your hand.' };
const SEEK_SCRIPTS = [
  { id: 't-c02', name: 'Seeker', play: [{ op: 'chooseCards', from: 'deck', filter: { cat: 'pokemon' }, min: 1, max: 1, as: 'x' }, { op: 'move', cards: 'x', to: 'hand' }, { op: 'shuffle' }] },
  { id: 't-c03', name: 'Any Seeker', play: [{ op: 'chooseCards', from: 'deck', min: 1, max: 1, as: 'x' }, { op: 'move', cards: 'x', to: 'hand' }, { op: 'shuffle' }] },
  { id: 't-c04', name: 'Pick Up', play: [{ op: 'chooseCards', from: 'discard', filter: { cat: 'pokemon' }, min: 1, max: 1, as: 'x' }, { op: 'move', cards: 'x', to: 'hand' }] },
] as unknown as import('../dsl.js').CardScript[];
const S = deck('S', [
  [PUP, 20],
  [SEEKER as never, 4],
  [ANYSEEK as never, 4],
  [PICKUP as never, 4],
  [FIGHTING, 28],
]);

test('Compendium #903: a search of your deck for a kind of card may find none; a search for any card, or a pick from the discard pile, may not', () => {
  const at = (hand: string) => scenario(S, S, [{ active: 'Pup', hand: [hand], discard: ['Pup', 'Pup'] }, { active: 'Pup' }], { scripts: SEEK_SCRIPTS });
  const kind = at('Seeker');
  choose(kind, 'Play Seeker');
  assert.equal(kind.decision?.min, 0, 'a Pokémon from the deck: none is allowed');
  const any = at('Any Seeker');
  choose(any, 'Play Any Seeker');
  assert.equal(any.decision?.min, 1, 'any card from the deck: one must be taken');
  const up = at('Pick Up');
  choose(up, 'Play Pick Up');
  assert.equal(up.decision?.min, 1, 'the discard pile is public: one must be taken');
});

// A gust ("switch in 1 of your opponent's Benched Pokémon") acts on the Benched Pokémon, so an Active Pokémon protected from the
// effects of Abilities is still pulled away; a "switch out" (the opponent chooses) is an effect on the Active and is stopped (ruling 2155;
// found replaying a real game: Hariyama's Heave-Ho Catcher against Banette's Hide 'n' Sneak).
const HOOKER = pokemon('t-c05', 'Hooker', { hp: 90 });
HOOKER.abilities = [{ kind: 'Ability', name: 'Hook', effect: "Once during your turn, you may switch in 1 of your opponent's Benched Pokémon to the Active Spot." }];
const PUSHER = pokemon('t-c06', 'Pusher', { hp: 90 });
PUSHER.abilities = [{ kind: 'Ability', name: 'Push', effect: "Once during your turn, you may switch out your opponent's Active Pokémon to the Bench. (Your opponent chooses the new Active Pokémon.)" }];
const VEILED = pokemon('t-c07', 'Veiled', { hp: 90 });
VEILED.abilities = [{ kind: 'Ability', name: 'Veil', effect: "Prevent all effects of your opponent's Pokémon's Abilities done to this Pokémon." }];
const GUST_SCRIPTS = [
  { id: 't-c05', name: 'Hooker', abilities: [{ name: 'Hook', activated: { program: [{ op: 'switch', who: 'opp' }] } }] },
  { id: 't-c06', name: 'Pusher', abilities: [{ name: 'Push', activated: { program: [{ op: 'switch', who: 'opp', chooser: 'opp' }] } }] },
  { id: 't-c07', name: 'Veiled', abilities: [{ name: 'Veil', statics: [{ effect: { k: 'preventEffects', from: ['ability'] }, scope: 'self' }] }] },
] as unknown as import('../dsl.js').CardScript[];
const GUST = deck('G', [
  [HOOKER, 8],
  [PUSHER, 8],
  [VEILED, 8],
  [PUP, 8],
  [FIGHTING, 28],
]);

test('a gust pulls up a Benched Pokémon even when the Active Pokémon is protected from Abilities; a switch out of that Active is stopped', () => {
  const at = (who: string) => scenario(GUST, GUST, [{ active: who }, { active: 'Veiled', bench: ['Pup'] }], { scripts: GUST_SCRIPTS });
  const hook = at('Hooker');
  choose(hook, 'Use Hook');
  assert.equal(nameOf(hook, hook.state.p[1].active!.cards[0]!), 'Pup', 'the gust acts on the Benched Pup');
  const push = at('Pusher');
  choose(push, 'Use Push');
  assert.equal(nameOf(push, push.state.p[1].active!.cards[0]!), 'Veiled', 'switching out the protected Active does nothing');
});

test('time called: the turn is finished, +3 turns are played, then the player with fewer Prize cards left wins; level, play goes on (Tournament Rules 5.8.3)', () => {
  const run = (myPrizes: number) => {
    const g = scenario(M, M, [{ active: 'Pup', bench: ['Pup'], prizes: myPrizes }, { active: 'Pup', bench: ['Pup'] }], { maxTurns: 2, turn: 2 });
    const turns: number[] = [];
    while (!g.over && g.state.turn <= 8) {
      turns.push(g.state.turn);
      choose(g, 'End turn');
    }
    return { g, turns };
  };
  const ahead = run(5);
  assert.ok(ahead.g.over);
  assert.equal(ahead.g.state.winner, 0, 'P1 has fewer Prize cards left');
  assert.equal(ahead.g.state.winReason, 'time');
  assert.deepEqual(ahead.turns, [2, 3, 4, 5], 'time is called in turn 2 (turn 0), then 3 more turns');
  const level = run(6);
  assert.ok(!level.g.over, 'level on Prize cards: the game goes on until one player is ahead');
});
