import type { Game } from '../game.js';
import type { Decision } from '../types.js';

/**
 * A player. It sees the game only through the decision it is asked (whose
 * options are the legal moves) and its own view of the state; it may never read
 * hidden information. Search pilots get that guarantee from `determinize`,
 * which rebuilds hidden zones from what the player could know.
 */
export interface Pilot {
  readonly name: string;
  choose(game: Game, d: Decision): number[];
}
