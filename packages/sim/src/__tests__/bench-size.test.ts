/**
 * Cards that put Pokémon onto a Bench, or count the room on it, use the real Bench limit (5, or 8 for a player with a Tera Pokémon in
 * play under Area Zero Underdepths) and not a hard-coded 5. Each case runs twice: with the Stadium the cards go past 5, without it they stop at 5.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { def } from '../context.js';
import { describeOptions } from '../describe.js';
import { advance } from '../flow.js';
import type { Game } from '../game.js';
import { scenario } from '../scenario.js';
import type { Decision } from '../types.js';
import { fromIds } from './decks.js';

const labels = (g: Game): string[] => describeOptions(g.ctx, g.state, g.decision as Decision);
function choose(g: Game, text: string): void {
  const i = labels(g).findIndex((l) => l.includes(text));
  assert.ok(i >= 0, `no option containing "${text}" in: ${labels(g).join(' | ')} [${g.decision?.prompt}]`);
  g.submit([i]);
}
const nameOf = (g: Game, card: number): string => def(g.ctx, card).name;
const rep = (name: string, n: number): string[] => Array.from({ length: n }, () => name);

const IDS: Record<string, string> = {
  'Area Zero Underdepths': 'sv07-131',
  'Pikachu ex': 'sv08.5-028', // Tera
  Dreepy: 'sv06-128',
  Maushold: 'sv08-158',
  Lickitung: 'sv05-124',
  'Precious Trolley': 'sv08-185',
};
const ENERGY: [string, number][] = ['mee-001', 'mee-002', 'mee-003', 'mee-004', 'mee-005', 'mee-006', 'mee-007', 'mee-008'].map((id) => [id, 10]);
const deck = (...cards: string[]) => fromIds('bench-size', [...cards.map((n): [string, number] => [IDS[n] ?? n, 10]), ...ENERGY]);

/** Put the Stadium from this player's deck into play (owner 0 unless said). */
function stadium(g: Game, owner: 0 | 1 = 0): void {
  const dk = g.state.p[owner].deck;
  const i = dk.findIndex((c) => nameOf(g, c) === 'Area Zero Underdepths');
  assert.ok(i >= 0);
  g.state.stadium = { card: dk.splice(i, 1)[0] as number, owner };
  g.state.pending = null;
  advance(g.env, g.state);
}

test('Familial March (c27.searchToBench): with a Tera Pokémon under Area Zero Underdepths both Mausholds fit past 5; without it only one', () => {
  const dk = deck('Area Zero Underdepths', 'Pikachu ex', 'Dreepy', 'Maushold');
  const mk = (withStadium: boolean): Game => {
    const g = scenario(dk, dk, [{ active: 'Maushold', bench: ['Pikachu ex', ...rep('Dreepy', 3)], energy: { active: ['Fire Energy'] } }, { active: 'Dreepy' }]);
    if (withStadium) stadium(g);
    return g;
  };
  const g = mk(true);
  choose(g, 'Attack: Familial March');
  assert.equal(g.decision!.max, 2, 'room for 2 on a Bench of 4 with a limit of 8');
  g.submit([0, 1]);
  assert.equal(g.state.p[0].bench.length, 6, 'past 5');

  const n = mk(false);
  choose(n, 'Attack: Familial March');
  assert.equal(n.decision!.max, 1, 'one space on a Bench of 4 without the Stadium');
  n.submit([0]);
  assert.equal(n.state.p[0].bench.length, 5);
});

test("Tongue Pull (opponent's Bench room): the opponent's Tera Pokémon under the Stadium lets more than 5 onto their Bench; without it, 5", () => {
  const dk = deck('Area Zero Underdepths', 'Pikachu ex', 'Dreepy', 'Lickitung');
  const mk = (withStadium: boolean): Game => {
    const g = scenario(dk, dk, [
      { active: 'Lickitung', energy: { active: ['Fire Energy'] } },
      { active: 'Pikachu ex', bench: rep('Dreepy', 4), hand: ['Dreepy', 'Dreepy', 'Dreepy'] },
    ]);
    if (withStadium) stadium(g);
    return g;
  };
  const g = mk(true);
  choose(g, 'Attack: Tongue Pull');
  assert.equal(g.decision!.max, 2, 'up to 2, and the room (4) is more than that');
  g.submit([0, 1]);
  assert.equal(g.state.p[1].bench.length, 6, "past 5 on the opponent's Bench");

  const n = mk(false);
  choose(n, 'Attack: Tongue Pull');
  assert.equal(n.decision!.max, 1, 'only one space without the Stadium');
  n.submit([0]);
  assert.equal(n.state.p[1].bench.length, 5);
});

test('Precious Trolley: "any number" goes up to the real room, past 5 under the Stadium and not otherwise', () => {
  const dk = deck('Area Zero Underdepths', 'Pikachu ex', 'Dreepy', 'Precious Trolley');
  const mk = (withStadium: boolean): Game => {
    const g = scenario(dk, dk, [{ active: 'Pikachu ex', bench: rep('Dreepy', 2), hand: ['Precious Trolley'] }, { active: 'Dreepy' }]);
    if (withStadium) stadium(g);
    return g;
  };
  const g = mk(true);
  choose(g, 'Play Precious Trolley');
  assert.equal(g.decision!.kind, 'cards');
  assert.equal(g.decision!.max, 6, 'a Bench of 2 with a limit of 8');
  g.submit([0, 1, 2, 3, 4, 5]);
  assert.equal(g.state.p[0].bench.length, 8);

  const n = mk(false);
  choose(n, 'Play Precious Trolley');
  assert.equal(n.decision!.max, 3, 'a Bench of 2 with a limit of 5');
  n.submit([0, 1, 2]);
  assert.equal(n.state.p[0].bench.length, 5);
});
