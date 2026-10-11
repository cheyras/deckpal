/**
 * Switches for individual pilot behaviours, so a change can be measured against the pilot without it
 * (scripts/pilot-h2h.ts, scripts/pilot-agreement.ts). Production runs the default (every kept change on); a
 * spec such as `search:-reuse` turns one off, and `search:legacy` is the pilot as it was before the measured
 * changes (see LEGACY_WEIGHTS, and nodes 100 in scripts/lib/pilotSpec.ts).
 */
export interface Tuning {
  readonly [flag: string]: boolean;
}

/**
 * Every switch and whether the default pilot has it on.
 *  - engine: a Pokémon with an Ability that draws or searches is worth more when choosing what to fetch or bench.
 *  - reuse:  a search continues from what the earlier searches of the same turn found out (see search.ts, Memo).
 */
export const DEFAULT_TUNING: Tuning = { engine: true, reuse: true };

/**
 * The evaluation weights the pilots shipped with before the measured changes (git: d9325157), for the `legacy`
 * spec: the baseline every kept change is compared with. Changes to the weights live in eval.ts's DEFAULT_WEIGHTS.
 */
export const LEGACY_WEIGHTS = {
  win: 1_000_000,
  prize: 1000,
  threatNow: 420,
  threatLater: 220,
  lethalThreat: 2500,
  wipeout: 0,
  koNoEnergy: 1,
  benchThreat: 0.55,
  power: 0.9,
  energyShort: 35,
  pokemonInPlay: 70,
  stage: 70,
  hp: 40,
  hand: 14,
  handCap: 10,
  deckOut: 250,
  deckSafe: 4,
  liability: 110,
  stuck: 60,
  poison: 25,
  fuel: 8,
  handEvo: 35,
  handEnergy: 12,
  energy: 48,
  energyBench: 0.8,
} as const;

/** `flag` turns a switch on, `-flag` off; `legacy` turns every switch off. */
export function tuningFor(flags: string[]): Tuning {
  const t: Record<string, boolean> = { ...DEFAULT_TUNING };
  for (const f of flags) {
    if (f === 'legacy') for (const k of Object.keys(t)) t[k] = false;
    else if (f.startsWith('-')) t[f.slice(1)] = false;
    else t[f] = true;
  }
  return t;
}
