/**
 * A convenience wrapper: one game = immutable context + mutable state + an
 * optional event sink. Everything a player (bot, model, log replayer) does goes
 * through three calls: `view()`/`state`, `decision`, `submit(optionIndexes)`.
 */
import { createContext, type DeckInput, type Env, type GameContext } from './context.js';
import { legalActions, startGame, submit } from './flow.js';
import { cloneState, newState } from './state.js';
import type { Decision, EngineOptions, GameEvent, GameState, Player } from './types.js';

export class Game {
  readonly ctx: GameContext;
  state: GameState;
  readonly events: GameEvent[] = [];
  env: Env;

  constructor(a: DeckInput | GameContext, b: DeckInput | null, seed: number, opts: EngineOptions = {}, state?: GameState) {
    this.ctx = b ? createContext(a as DeckInput, b, opts) : (a as GameContext);
    this.env = { ctx: this.ctx, emit: this.ctx.opts.events ? (e) => this.events.push(e) : null };
    this.state = state ?? newState(this.ctx, seed);
  }

  start(): this {
    startGame(this.env, this.state);
    return this;
  }

  get decision(): Decision | null {
    return this.state.pending?.decision ?? null;
  }

  get over(): boolean {
    return this.state.phase === 'over';
  }

  submit(choice: number[]): void {
    submit(this.env, this.state, choice);
  }

  /** An independent copy sharing the immutable context; events are not copied. */
  clone(): Game {
    const g = new Game(this.ctx, null, this.state.seed, {}, cloneState(this.state));
    g.env = { ctx: this.ctx, emit: null };
    return g;
  }

  legal(p: Player = this.state.current) {
    return legalActions(this.env, this.state, p);
  }

  get envForInternals(): Env {
    return this.env;
  }
}
