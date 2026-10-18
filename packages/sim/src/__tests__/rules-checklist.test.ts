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
