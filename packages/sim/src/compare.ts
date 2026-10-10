/**
 * PAIRED COMPARISON: is version B of a deck better than version A?
 *
 * COMMON RANDOM NUMBERS. Both versions play each opponent on the SAME seeds
 * and seats: game k of version A and game k of version B share the pair seed,
 * who goes first, the opponent's shuffle stream and the opponent pilot's seed.
 * Only the subject's own list differs. A lot of what decides a game (the
 * opponent's draws, who goes first, the pilot's tie-breaks on the other side)
 * is then the same in both games, so it cancels in the difference, and the
 * difference needs far fewer games to read than two independent runs would.
 *
 * THE NUMBER. Each game is scored for the subject: win 1, draw or time-out ½,
 * loss 0 (a game either version lost to an engine error drops out of the
 * pairing). d = score(B) − score(A) on the same seed and seat. The two
 * seat-swapped games of one seed form a CLUSTER (they share a seed, so they
 * are not treated as independent); the estimate is Σd / Σgames over the
 * clusters and its 95% interval is a t-interval with a cluster-robust standard
 * error, df = clusters − 1. Over several opponents the clusters of every
 * opponent are pooled the same way (each game weighs the same, as in the
 * overall win rate). One known looseness: with the same pair seed the subject
 * is dealt the same shuffle against every opponent, which correlates clusters
 * across opponents a little, so the overall interval is if anything slightly
 * narrow — the per-opponent intervals have no such issue.
 *
 * THE VERDICT says "B is better" (or "A is better") only when the interval
 * excludes 0 AND at least MIN_VERDICT_PAIRS clusters were played; otherwise it
 * says there is no clear difference at this n. Most real edits are a card or
 * two, and most of those are not detectable in a few dozen bot games: the
 * honest answer is usually "no clear difference", and the text says so.
 */
import type { DeckInput } from './context.js';
import { runSimulation, type PilotFactory, type SimulationResult, type GameSummary } from './runner.js';

/** Fewest seed pairs before any verdict other than "no clear difference". */
export const MIN_VERDICT_PAIRS = 6;

export interface PairedOptions {
  /** Version A (the "before"). */
  a: DeckInput;
  /** Version B (the "after"). */
  b: DeckInput;
  opponent: DeckInput;
  /** Games per version. Rounded UP to an even number (pairs). */
  games: number;
  seed?: number;
  pilotFactory?: PilotFactory;
  /** For BOTH versions together: stop starting new seed pairs once this much time is spent. */
  timeBudgetMs?: number;
  maxTurns?: number;
  maxDecisions?: number;
  now?: () => number;
}

export interface PairedSimulation {
  /** Play one seed pair for each version. False when finished. */
  step(): boolean;
  readonly done: boolean;
  /** [version A's result, version B's result] — always the same pairs. */
  result(): [SimulationResult, SimulationResult];
}

/**
 * Two batches in lockstep: each step plays seed pair i for version A, then for
 * version B, so a budget that runs out leaves both with the same seeds played.
 */
export function runPaired(opts: PairedOptions): PairedSimulation {
  const now = opts.now ?? Date.now;
  const started = now();
  const budget = opts.timeBudgetMs ?? Infinity;
  const base = {
    b: opts.opponent,
    games: opts.games,
    seed: opts.seed,
    pilotFactory: opts.pilotFactory,
    maxTurns: opts.maxTurns,
    maxDecisions: opts.maxDecisions,
    now,
  };
  const simA = runSimulation({ ...base, a: opts.a });
  const simB = runSimulation({ ...base, a: opts.b });
  const spent: [number, number] = [0, 0];
  let stoppedEarly = false;
  let done = false;
  let steps = 0;
  let slowest = 0;
  const sim: PairedSimulation = {
    get done() {
      return done;
    },
    step(): boolean {
      if (done) return false;
      if (steps > 0 && now() - started + slowest > budget) {
        stoppedEarly = !simA.done;
        done = true;
        return false;
      }
      const t0 = now();
      const moreA = simA.step();
      const t1 = now();
      const moreB = simB.step();
      const t2 = now();
      spent[0] += t1 - t0;
      spent[1] += t2 - t1;
      slowest = Math.max(slowest, t2 - t0);
      steps++;
      if (!moreA || !moreB) done = true;
      return !done;
    },
    result(): [SimulationResult, SimulationResult] {
      const fix = (r: SimulationResult, i: 0 | 1): SimulationResult => ({ ...r, stoppedEarly, elapsedMs: spent[i] });
      return [fix(simA.result(), 0), fix(simB.result(), 1)];
    },
  };
  return sim;
}

export function simulatePaired(opts: PairedOptions): [SimulationResult, SimulationResult] {
  const sim = runPaired(opts);
  while (sim.step()) {
    /* play on */
  }
  return sim.result();
}

export async function simulatePairedAsync(opts: PairedOptions): Promise<[SimulationResult, SimulationResult]> {
  const sim = runPaired(opts);
  while (sim.step()) await new Promise<void>((resolve) => setTimeout(resolve, 0));
  return sim.result();
}

// ---------------------------------------------------------------------------
// The paired difference
// ---------------------------------------------------------------------------

export type Verdict = 'b' | 'a' | 'none';

export interface PairedDiff {
  /** Seed pairs (clusters) with at least one paired game. */
  pairs: number;
  /** Paired games used (both versions finished without an engine error). */
  games: number;
  /** Mean score difference per game, B − A, in −1..1; null with no paired games. */
  diff: number | null;
  /** 95% interval on `diff`; null with fewer than 2 pairs. */
  lo: number | null;
  hi: number | null;
  /** Paired games where B scored more than A on the same seed and seat, and the reverse. */
  bAhead: number;
  aAhead: number;
  /** 'b' / 'a' only when the interval excludes 0 with at least MIN_VERDICT_PAIRS pairs. */
  verdict: Verdict;
}

/** The subject's score in one game, or null when the engine errored. */
export function gameScore(g: GameSummary): number | null {
  if (g.reason === 'engine error') return null;
  if (g.winner === 0) return 1;
  if (g.winner === 1) return 0;
  return 0.5;
}

/** Two-sided 95% t quantiles, df 1..30; beyond 30 the normal 1.96 is close enough. */
const T95 = [
  12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145, 2.131, 2.12, 2.11,
  2.101, 2.093, 2.086, 2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042,
];
export function t95(df: number): number {
  if (df < 1) return Infinity;
  return df <= T95.length ? (T95[df - 1] as number) : 1.959964;
}

interface Cluster {
  sum: number;
  n: number;
  bAhead: number;
  aAhead: number;
}

/** One cluster per seed pair: the paired games of version A and B against one opponent. */
export function pairClusters(a: SimulationResult, b: SimulationResult): Cluster[] {
  const byPair = new Map<number, Cluster>();
  const n = Math.min(a.games.length, b.games.length);
  for (let i = 0; i < n; i++) {
    const ga = a.games[i]!;
    const gb = b.games[i]!;
    if (ga.pair !== gb.pair || ga.seed !== gb.seed || ga.aFirst !== gb.aFirst) {
      throw new Error(`paired games out of step at game ${i}: the two versions did not play the same seeds and seats`);
    }
    const sa = gameScore(ga);
    const sb = gameScore(gb);
    if (sa === null || sb === null) continue;
    const c = byPair.get(ga.pair) ?? { sum: 0, n: 0, bAhead: 0, aAhead: 0 };
    c.sum += sb - sa;
    c.n++;
    if (sb > sa) c.bAhead++;
    else if (sa > sb) c.aAhead++;
    byPair.set(ga.pair, c);
  }
  return [...byPair.values()];
}

/** Ratio estimate Σd/Σn over clusters, with a cluster-robust t-interval. */
export function diffOf(clusters: Cluster[], minPairs = MIN_VERDICT_PAIRS): PairedDiff {
  const m = clusters.length;
  const games = clusters.reduce((s, c) => s + c.n, 0);
  const bAhead = clusters.reduce((s, c) => s + c.bAhead, 0);
  const aAhead = clusters.reduce((s, c) => s + c.aAhead, 0);
  if (!games) return { pairs: m, games, diff: null, lo: null, hi: null, bAhead, aAhead, verdict: 'none' };
  const r = clusters.reduce((s, c) => s + c.sum, 0) / games;
  if (m < 2) return { pairs: m, games, diff: r, lo: null, hi: null, bAhead, aAhead, verdict: 'none' };
  const ss = clusters.reduce((s, c) => s + (c.sum - r * c.n) ** 2, 0);
  const se = Math.sqrt((m / (m - 1)) * ss) / games;
  const half = t95(m - 1) * se;
  const lo = Math.max(-1, r - half);
  const hi = Math.min(1, r + half);
  const verdict: Verdict = m < minPairs ? 'none' : lo > 0 ? 'b' : hi < 0 ? 'a' : 'none';
  return { pairs: m, games, diff: r, lo, hi, bAhead, aAhead, verdict };
}

/** The paired difference for one opponent. */
export function pairedDiff(a: SimulationResult, b: SimulationResult, minPairs = MIN_VERDICT_PAIRS): PairedDiff {
  return diffOf(pairClusters(a, b), minPairs);
}

/** The paired difference over every opponent, each game weighing the same. */
export function pairedOverall(pairs: [SimulationResult, SimulationResult][], minPairs = MIN_VERDICT_PAIRS): PairedDiff {
  return diffOf(pairs.flatMap(([a, b]) => pairClusters(a, b)), minPairs);
}

// ---------------------------------------------------------------------------
// What changed between the versions
// ---------------------------------------------------------------------------

export interface CardChange {
  card: string;
  a: number;
  b: number;
}

/** Card counts that differ between the versions, by card name (printings of one name are summed). */
export function deckChanges(a: DeckInput, b: DeckInput): CardChange[] {
  const count = (d: DeckInput) => {
    const m = new Map<string, number>();
    for (const e of d.cards) {
      const name = e.frame.name.trim();
      m.set(name, (m.get(name) ?? 0) + e.count);
    }
    return m;
  };
  const ca = count(a);
  const cb = count(b);
  const out: CardChange[] = [];
  for (const card of new Set([...ca.keys(), ...cb.keys()])) {
    const x = ca.get(card) ?? 0;
    const y = cb.get(card) ?? 0;
    if (x !== y) out.push({ card, a: x, b: y });
  }
  return out.sort((x, y) => Math.abs(y.b - y.a) - Math.abs(x.b - x.a) || x.card.localeCompare(y.card));
}
