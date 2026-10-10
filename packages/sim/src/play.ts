/** Play one game to completion between two pilots. */
import { Game } from './game.js';
import type { Pilot } from './pilot/types.js';

export interface PlayOptions {
  /** Abort (as a draw) after this many decisions — a stuck pilot must not hang a batch. */
  maxDecisions?: number;
}

export function playOut(game: Game, pilots: [Pilot, Pilot], opts: PlayOptions = {}): Game {
  const max = opts.maxDecisions ?? 20000;
  if (game.state.phase === 'setup' && !game.decision) game.start();
  let n = 0;
  while (!game.over) {
    const d = game.decision;
    if (!d) throw new Error('engine stopped without a decision or a result');
    if (++n > max) {
      game.state.phase = 'over';
      game.state.draw = true;
      game.state.winner = null;
      game.state.winReason = 'decision limit';
      break;
    }
    const choice = pilots[d.player].choose(game, d);
    game.submit(choice);
  }
  return game;
}
