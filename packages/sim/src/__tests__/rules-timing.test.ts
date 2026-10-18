/**
 * Rule tests for WHEN lasting effects apply. "During your next turn" and "During your opponent's next turn" cover that turn,
 * not the rest of the turn the effect was made in; "until the end of your next turn" starts at once. "Your" is the player whose
 * card made the effect, so an effect made during the opponent's turn (a reaction to their attack) lands on the right turn. PTCG
 * Live's match engine keeps the same split (an effect activates immediately, on its maker's next turn, or on the opponent's).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { CardScript } from '../dsl.js';
import { describeOptions } from '../describe.js';
import { Game } from '../game.js';
import { durationTurns } from '../interp.js';
import { scenario } from '../scenario.js';
import type { Decision, GameState, Player } from '../types.js';
import { FIGHTING, PUP, deck, pokemon } from './fixtures.js';

const ANCHOR = pokemon('t-t01', 'Anchor', { hp: 90, retreat: 1 });
ANCHOR.abilities = [{ kind: 'Ability', name: 'Drop Anchor', effect: "Once during your turn, you may use this Ability. During your next turn, this Pokémon can't retreat." }];
const WARD = pokemon('t-t02', 'Ward', { hp: 90, retreat: 1 });
WARD.abilities = [{ kind: 'Ability', name: 'Ward Off', effect: "Once during your turn, you may use this Ability. During your opponent's next turn, this Pokémon can't retreat." }];
const SCRIPTS: CardScript[] = [
  { id: 't-t01', name: 'Anchor', abilities: [{ name: 'Drop Anchor', activated: { program: [{ op: 'effect', static: { k: 'cantRetreat' }, on: 'self', duration: 'myNextTurn' }] } }] },
  { id: 't-t02', name: 'Ward', abilities: [{ name: 'Ward Off', activated: { program: [{ op: 'effect', static: { k: 'cantRetreat' }, on: 'self', duration: 'oppNextTurn' }] } }] },
];
const A = deck('A', [
  [ANCHOR, 10],
  [WARD, 10],
  [PUP, 10],
  [FIGHTING, 30],
]);

function labels(g: Game): string[] {
  return describeOptions(g.ctx, g.state, g.decision as Decision);
}
function choose(g: Game, text: string): void {
  const i = labels(g).findIndex((l) => l.includes(text));
  assert.ok(i >= 0, `no option containing "${text}" in: ${labels(g).join(' | ')}`);
  g.submit([i]);
}
const canRetreat = (g: Game): boolean => labels(g).includes('Retreat');

test('"During your next turn" waits for that turn: the rest of this turn and the opponent\'s turn are not covered', () => {
  const g = scenario(A, A, [{ active: 'Anchor', bench: ['Pup'], energy: { active: ['Fighting Energy', 'Fighting Energy', 'Fighting Energy'] } }, { active: 'Ward', bench: ['Pup'] }], { scripts: SCRIPTS });
  choose(g, 'Use Drop Anchor');
  assert.ok(canRetreat(g), 'the effect is for your NEXT turn: Anchor can still retreat this turn');
  choose(g, 'End turn');
  assert.equal(g.state.current, 1);
  choose(g, 'End turn');
  assert.equal(g.state.current, 0);
  assert.ok(!canRetreat(g), 'your next turn: Anchor cannot retreat');
  choose(g, 'End turn');
  choose(g, 'End turn');
  assert.ok(canRetreat(g), 'the turn after that: the effect is over');
});

test('"During your opponent\'s next turn" covers that turn only, not the rest of this one', () => {
  const g = scenario(A, A, [{ active: 'Ward', bench: ['Pup'], energy: { active: ['Fighting Energy', 'Fighting Energy', 'Fighting Energy'] } }, { active: 'Anchor', bench: ['Pup'] }], { scripts: SCRIPTS });
  choose(g, 'Use Ward Off');
  assert.ok(canRetreat(g), 'the rest of the turn the effect was made in is not covered: Ward can still retreat');
  const ward = g.state.p[0].active!.id;
  const live = (): boolean => g.state.effects.some((e) => e.slot === ward && e.start === g.state.turn && e.until === g.state.turn);
  choose(g, 'End turn');
  assert.equal(g.state.current, 1);
  assert.ok(live(), "the opponent's turn is the one the effect covers");
  choose(g, 'End turn');
  assert.equal(g.state.current, 0);
  assert.ok(canRetreat(g), 'and it is over by your next turn');
});

test('the effect window belongs to the player whose card made it, whoever\'s turn it is', () => {
  const at = (turn: number, current: Player) => ({ turn, current }) as GameState;
  // Made during your own turn 5: your next turn is 7, your opponent's next turn is 6.
  assert.deepEqual(durationTurns(at(5, 0), 0, 'myNextTurn'), { start: 7, until: 7 });
  assert.deepEqual(durationTurns(at(5, 0), 0, 'oppNextTurn'), { start: 6, until: 6 });
  // Made during the opponent's turn 5 (a reaction to their attack): your next turn is 6, your opponent's next turn is 7.
  assert.deepEqual(durationTurns(at(5, 1), 0, 'myNextTurn'), { start: 6, until: 6 });
  assert.deepEqual(durationTurns(at(5, 1), 0, 'oppNextTurn'), { start: 7, until: 7 });
  // "Until the end of your next turn" starts now; "during this turn" is this turn only.
  assert.deepEqual(durationTurns(at(5, 0), 0, 'throughMyNextTurn'), { start: 5, until: 7 });
  assert.deepEqual(durationTurns(at(5, 0), 0, 'thisTurn'), { start: 5, until: 5 });
});
