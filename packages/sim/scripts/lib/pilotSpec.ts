/**
 * Pilot specs for the measurement scripts: `search`, `greedy`, `policy`, or `search:nodes=200,worlds=2`.
 *   key=value   a pilot option (nodes, worlds, subs, verify) — numbers are numbers, true/false booleans
 *   w.key=value an evaluation weight override (see EvalWeights), e.g. `search:w.deckSafe=8,w.deckOut=60`
 *   flag        a behaviour switch on, `-flag` off (see src/pilot/tuning.ts)
 *   legacy      the pilot as it was before the measured changes: every switch off, the old weights, 100 nodes
 */
import { DEFAULT_WEIGHTS, type EvalWeights } from '../../src/pilot/eval.js';
import { makePilot, type PilotName, type PilotOptions } from '../../src/pilot/index.js';
import type { Pilot } from '../../src/pilot/types.js';
import { LEGACY_WEIGHTS, tuningFor } from '../../src/pilot/tuning.js';

/** The search budget before the measured changes. */
const LEGACY_NODES = 100;

export function parsePilotSpec(spec: string, seed: number): Pilot {
  const [name, rest = ''] = spec.split(':');
  const opts: Record<string, unknown> = {};
  const weights: Record<string, number> = {};
  const flags: string[] = [];
  for (const kv of rest.split(',').filter(Boolean)) {
    const [k, v] = kv.split('=');
    if (v === undefined) flags.push(k as string);
    else if ((k as string).startsWith('w.')) {
      const key = (k as string).slice(2);
      if (!(key in DEFAULT_WEIGHTS)) throw new Error(`unknown weight ${key}`);
      weights[key] = Number(v);
    } else opts[k as string] = v === 'true' ? true : v === 'false' ? false : Number(v);
  }
  const o: PilotOptions = { ...(opts as PilotOptions) };
  const legacy = flags.includes('legacy');
  if (flags.length) o.tuning = tuningFor(flags);
  if (legacy && o.nodes === undefined) o.nodes = LEGACY_NODES;
  if (legacy || Object.keys(weights).length) o.weights = { ...(legacy ? LEGACY_WEIGHTS : DEFAULT_WEIGHTS), ...weights } as EvalWeights;
  return makePilot(name as PilotName, seed, o);
}
