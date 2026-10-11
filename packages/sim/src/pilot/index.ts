/** Pilot registry: `makePilot('random' | 'greedy' | 'search', seed, opts)`. */
import type { EvalWeights } from './eval.js';
import { GreedyPilot } from './greedy.js';
import { DEFAULT_PROFILE, PolicyPilot, type PolicyProfile } from './policy.js';
import { RandomPilot } from './random.js';
import { SearchPilot, type SearchOptions } from './search.js';
import type { Pilot } from './types.js';

export type PilotName = 'random' | 'policy' | 'greedy' | 'search';

export interface PilotOptions extends SearchOptions {
  weights?: EvalWeights;
  profile?: PolicyProfile;
}

/**
 * A fresh pilot. `seed` drives only the pilot's own randomness (random play,
 * determinisation samples), never the game's. Pilots keep no game state between
 * calls except their RNG, so one pilot per seat per game is the simplest use.
 */
export function makePilot(name: PilotName, seed = 1, opts: PilotOptions = {}): Pilot {
  switch (name) {
    case 'random':
      return new RandomPilot(seed);
    case 'policy':
      return new PolicyPilot(opts.profile ?? DEFAULT_PROFILE);
    case 'greedy':
      return new GreedyPilot(seed, { weights: opts.weights, profile: opts.profile });
    case 'search':
      return new SearchPilot(seed, opts);
    default:
      throw new Error(`unknown pilot ${name as string}`);
  }
}

export { GreedyPilot, PolicyPilot, RandomPilot, SearchPilot };
