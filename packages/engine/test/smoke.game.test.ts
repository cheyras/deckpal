/**
 * B1 smoke test (BATTLE-INTEL-SPEC §3, engine-fork done gate):
 * a legal 60-card game of vanilla basic Pokemon plays to completion with
 * SimpleBot driving BOTH sides. Pure: no DB, no network, no timers.
 *
 * Determinism: NO_SHUFFLE + ALL_HEADS arbiter, so the whole game is a pure
 * function of the deck layout. (Seeded-random shuffling is gap G6 in
 * roadmap/engine-gap-analysis.md — the arbiter has no injectable PRNG yet.)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  AddPlayerAction,
  BotAi,
  BotFlipMode,
  BotShuffleMode,
  CardManager,
  GamePhase,
  GameWinner,
  Simulator,
  State,
} from '../src/common';
import { SimpleBot } from '../src/bot';
import { Machop } from '../src/cards/base-sets/set-base/machop';
import { Hitmonchan } from '../src/cards/base-sets/set-base/hitmonchan';
import { FightingEnergy } from '../src/cards/base-sets/set-base/fighting-energy';

/** 60 cards: 8 vanilla basics spread so any 7-card slice holds one, rest energy. */
function buildDeck(): string[] {
  const deck: string[] = [];
  for (let i = 0; i < 60; i++) {
    if (i % 7 === 0 && deck.filter(n => n !== 'Fighting Energy BS').length < 8) {
      deck.push(i % 14 === 0 ? 'Machop BS' : 'Hitmonchan BS');
    } else {
      deck.push('Fighting Energy BS');
    }
  }
  return deck;
}

test('a legal game of vanilla basics plays to completion under SimpleBot', () => {
  // Register the card pool (CardManager is a process-wide singleton).
  const cm = CardManager.getInstance();
  if (!cm.isCardDefined('Machop BS')) {
    cm.defineSet([new Machop(), new Hitmonchan(), new FightingEnergy()]);
  }

  const deck = buildDeck();
  assert.equal(deck.length, 60);
  assert.equal(deck.filter(n => n === 'Machop BS').length, 4);
  assert.equal(deck.filter(n => n === 'Hitmonchan BS').length, 4);

  const sim = new Simulator(new State(), {
    flipMode: BotFlipMode.ALL_HEADS,
    shuffleMode: BotShuffleMode.NO_SHUFFLE,
  });

  const factory = new SimpleBot('smoke-bot');
  const bots: Array<{ id: number; ai: BotAi }> = [
    { id: 1, ai: factory.createBotAi(1, null) },
    { id: 2, ai: factory.createBotAi(2, null) },
  ];

  sim.dispatch(new AddPlayerAction(1, 'Ruby', deck));
  sim.dispatch(new AddPlayerAction(2, 'Sapphire', deck));

  // Drive the game: each iteration, let whichever bot has something to do act.
  // The arbiter inside Simulator absorbs shuffle/coin-flip prompts.
  let guard = 10_000;
  let actions = 0;
  while (sim.store.state.phase !== GamePhase.FINISHED && guard-- > 0) {
    let acted = false;
    for (const bot of bots) {
      const action = bot.ai.decodeNextAction(sim.store.state);
      if (action !== undefined) {
        sim.dispatch(action);
        actions++;
        acted = true;
        break;
      }
    }
    if (!acted) {
      assert.fail(
        `game stalled: no bot has a move (phase=${GamePhase[sim.store.state.phase]}, ` +
        `turn=${sim.store.state.turn}, actions=${actions})`
      );
    }
  }

  const state = sim.store.state;
  assert.equal(
    state.phase,
    GamePhase.FINISHED,
    `game did not finish within the action guard (turn=${state.turn}, actions=${actions})`
  );
  assert.notEqual(state.winner, GameWinner.NONE, 'finished game must declare a result');
  assert.ok(state.turn >= 2, `expected a real game, got ${state.turn} turn(s)`);

  // A real game, not a mutual pass-off: someone took at least one prize.
  const prizesTaken = state.players
    .map(p => 6 - p.getPrizeLeft())
    .reduce((a, b) => a + b, 0);
  assert.ok(prizesTaken > 0, 'expected at least one knockout/prize in the smoke game');
});
