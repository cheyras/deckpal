/** Play one game to completion between two pilots. */
import { Game } from './game.js';
import type { Pilot } from './pilot/types.js';

export interface PlayOptions {
  /** Abort (as a draw) after this many decisions — a stuck pilot must not hang a batch. */
  maxDecisions?: number;
  /**
   * Abort (as a 'time limit' draw) once `now()` reaches this — a hard wall-clock
   * stop, checked before every decision, so one long game cannot overrun the
   * caller's budget. Default: none.
   */
  deadline?: number;
  /** Clock for `deadline`, injectable for tests. Default Date.now. */
  now?: () => number;
}

/** End the game where it stands as a draw, for `reason`. */
function abandon(game: Game, reason: string): void {
  game.state.phase = 'over';
  game.state.draw = true;
  game.state.winner = null;
  game.state.winReason = reason;
}

export function playOut(game: Game, pilots: [Pilot, Pilot], opts: PlayOptions = {}): Game {
  const max = opts.maxDecisions ?? 20000;
  const deadline = opts.deadline ?? Infinity;
  const now = opts.now ?? Date.now;
  if (game.state.phase === 'setup' && !game.decision) game.start();
  let n = 0;
  while (!game.over) {
    const d = game.decision;
    if (!d) throw new Error('engine stopped without a decision or a result');
    if (++n > max) {
      abandon(game, 'decision limit');
      break;
    }
    // The clock is only read when there is a deadline, so a batch without one reads it exactly as before.
    if (deadline !== Infinity && now() >= deadline) {
      abandon(game, 'time limit');
      break;
    }
    const choice = pilots[d.player].choose(game, d);
    game.submit(choice);
  }
  return game;
}
