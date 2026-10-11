/**
 * One-ply lookahead. At each main decision (and each small targeting /
 * promote / copied-attack choice) it tries every option in ONE determinised
 * world — so it never sees real hidden cards or future coins — runs the policy
 * to its next main decision or the end of the turn, evaluates, and takes the
 * best. Every other decision goes to the policy.
 */
import type { Env } from '../context.js';
import { determinize } from '../determinize.js';
import type { Game } from '../game.js';
import { Rng } from '../rng.js';
import { cloneState, opp } from '../state.js';
import { submit } from '../flow.js';
import type { Decision } from '../types.js';
import { branchable, optionCount, settle } from './lookahead.js';
import { DEFAULT_WEIGHTS, evaluate, type EvalWeights } from './eval.js';
import { DEFAULT_PROFILE, policyChoose, type PolicyProfile } from './policy.js';
import type { Pilot } from './types.js';

export interface GreedyOptions {
  weights?: EvalWeights;
  profile?: PolicyProfile;
}

export class GreedyPilot implements Pilot {
  readonly name = 'greedy';
  private rng: Rng;
  private weights: EvalWeights;
  private profile: PolicyProfile;
  constructor(seed = 1, opts: GreedyOptions = {}) {
    this.rng = new Rng(seed);
    this.weights = opts.weights ?? DEFAULT_WEIGHTS;
    this.profile = opts.profile ?? DEFAULT_PROFILE;
  }

  choose(game: Game, d: Decision): number[] {
    // Silent: the lookahead submits imagined moves, which must never reach the real game's event log.
    const env: Env = { ctx: game.ctx, emit: null };
    const me = d.player;
    const n = optionCount(d);
    if (n <= 1 || !branchable(d, me, true) || game.state.phase !== 'main') return policyChoose(env, game.state, d, this.profile);
    const world = determinize(game.state, game.ctx, me, this.rng);
    const rootTurn = world.turn;
    let best = 0;
    let bestV = -Infinity;
    for (let i = 0; i < n; i++) {
      const s = cloneState(world);
      submit(env, s, [i]);
      // Stop at my next main decision (sub-decisions go to the policy) or the end of the turn.
      settle(env, s, me, rootTurn, false, this.profile);
      const midTurn = s.phase !== 'over' && s.turn === rootTurn && s.current === me;
      const v = evaluate(env, s, me, this.weights, midTurn ? opp(me) : s.current);
      if (v > bestV) {
        bestV = v;
        best = i;
      }
    }
    return [best];
  }
}
