/**
 * battle_turn_review (tools/battleTurnReview.ts): the simulator's options on one of the reader's turns, rendered for a
 * model — ranked, the reader's own first action marked, a plain verdict, and the caveats that keep it from being read
 * as an oracle.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allTools } from '../index.js';
import { renderTurnReview, TURN_REVIEW_TEXT_MAX, type TurnReviewPayload } from '../tools/battleTurnReview.js';
import type { Api } from '../api.js';
import type { Ctx } from '../ctx.js';

function payload(over: Partial<NonNullable<TurnReviewPayload['review']>> = {}): TurnReviewPayload {
  return {
    logId: 7,
    turn: 6,
    players: { me: 'cheyras', opponent: 'Rastass' },
    review: {
      turn: 6,
      found: true,
      reason: null,
      readerDid: ['P0 played Stadium Prism Tower', "P0's Dhelmise attacked with Vengeful Anchor (340 to Mega Lucario ex)"],
      options: [
        { rank: 1, first: 'Bench Dhelmise', line: ['Bench Dhelmise', 'Attack: Vengeful Anchor'], prizes: 3, knockOuts: ['Mega Lucario ex'], behindBest: 0, winsIn: 0, reader: false },
        { rank: 2, first: 'Play Prism Tower', line: ['Play Prism Tower', 'Attack: Vengeful Anchor'], prizes: 3, knockOuts: ['Mega Lucario ex'], behindBest: 0.1, winsIn: 0, reader: true },
        { rank: 3, first: 'Attack: Vengeful Anchor', line: ['Attack: Vengeful Anchor'], prizes: 0, knockOuts: [], behindBest: 1.4, winsIn: 0, reader: false },
      ],
      offered: 17,
      worlds: 3,
      nodes: 7200,
      hiddenInHand: 0,
      ms: 316,
      ...over,
    },
  };
}

test('ranked options, the reader marked, a verdict and the caveats', () => {
  const text = renderTurnReview(payload(), 'Toolbox Banette');
  for (const fact of [
    "turn review: battle #7 · 'Toolbox Banette' · turn 6",
    "the simulator's strongest pilot searched 17 first actions over 3 sampled worlds",
    'you did: P0 played Stadium Prism Tower → ',
    '1. Bench Dhelmise — behind 0.0 · takes 3 Prizes (KO Mega Lucario ex)',
    '2. [YOUR first action] Play Prism Tower — behind 0.1 · takes 3 Prizes',
    '3. Attack: Vengeful Anchor — behind 1.4 · takes no Prizes',
    "verdict: your first action is as good as the best by the engine's evaluation (within 0.3 Prize).",
    'not an oracle',
  ]) {
    assert.ok(text.includes(fact), `missing: ${fact}\n---\n${text}`);
  }
  assert.ok(text.length <= TURN_REVIEW_TEXT_MAX);
});

test('a reader well behind the best is told so, in Prize cards; hidden hand cards are named in the caveats', () => {
  const text = renderTurnReview(payload({
    hiddenInHand: 2,
    options: [
      { rank: 1, first: 'Attack: Phantom Dive', line: ['Attack: Phantom Dive'], prizes: 2, knockOuts: ['Pidgeot ex'], behindBest: 0, winsIn: 1, reader: false },
      { rank: 4, first: 'Retreat', line: ['Retreat'], prizes: 0, knockOuts: [], behindBest: 2.3, winsIn: 0, reader: true },
    ],
  }), 'Dragapult');
  assert.match(text, /verdict: your first action trails the best by 2\.3 Prize cards/);
  assert.match(text, /wins the game in 1\/3 worlds/);
  assert.match(text, /2 card\(s\) in your hand the log never showed were guessed/);
});

test("the caveats say how the reader's deck was rebuilt for the search (Astra, #343)", () => {
  assert.match(renderTurnReview(payload({ deck: 'list' }), 'X'), /your deck was rebuilt from the deck version you logged the game against/);
  assert.match(renderTurnReview(payload({ deck: 'estimate' }), 'X'), /your deck was estimated from the cards the log showed \(no decklist\)/);
  assert.doesNotMatch(renderTurnReview(payload(), 'X'), /your deck was/, 'an older API says nothing');
});

test('no review is said with its reason; an unknown reader asks for player_name', () => {
  assert.match(renderTurnReview(payload({ found: false, reason: "turn 5 is the opponent's; pick one of your own turns", options: [] }), 'X'), /no review: turn 5 is the opponent's/);
  const unknown: TurnReviewPayload = { logId: 7, turn: 6, players: { me: null, opponent: null }, review: null, reason: 'could not tell which player owns this deck — pass playerName' };
  assert.match(renderTurnReview(unknown, 'X'), /could not tell which player owns this deck/);
});

test('a huge line list stays under the ceiling', () => {
  const long = Array.from({ length: 60 }, (_, i) => `Play Card Number ${i} with a long name`);
  const text = renderTurnReview(payload({
    options: Array.from({ length: 5 }, (_, i) => ({ rank: i + 1, first: long[0]!, line: long, prizes: 0, knockOuts: [], behindBest: i, winsIn: 0, reader: i === 4 })),
  }), 'Deck');
  assert.ok(text.length <= TURN_REVIEW_TEXT_MAX, `${text.length}`);
  assert.match(text, /\+\d+ more/);
});

test('the tool is read-only, takes a turn, and reads the review route for that deck, log and turn', async () => {
  const tool = allTools().find((d) => d.name === 'battle_turn_review')!;
  assert.ok(tool, 'registered');
  assert.equal(tool.annotations.readOnlyHint, true);
  assert.equal(tool.inputSchema!.safeParse({ deck_id: 'x', log_id: 7, turn: 6 }).success, true);
  assert.equal(tool.inputSchema!.safeParse({ deck_id: 'x', log_id: 7, turn: 0 }).success, false);
  const gets: string[] = [];
  const api = {
    base: 'https://test/api',
    get: async (path: string) => {
      gets.push(path);
      if (path === '/decks') return { decks: [{ id: 'deck-1', name: 'Toolbox Banette', formatCode: 'standard', version: 2 }] };
      return payload();
    },
    send: async () => {
      throw new Error('a read tool sent a write');
    },
  } as unknown as Api;
  const ctx = { db: { query: async () => ({ rows: [] }) }, userId: 'u1', api } as unknown as Ctx;
  const res = await tool.handler({ deck_id: 'Toolbox Banette', log_id: 7, turn: 6 }, ctx);
  assert.equal(res.isError, undefined, res.text);
  assert.ok(gets.includes('/decks/deck-1/logs/7/turns/6/review'), gets.join(', '));
  assert.match(res.text, /\[YOUR first action\]/);
});
