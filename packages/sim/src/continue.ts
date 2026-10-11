/**
 * CONTINUATION: adding games to a run on a later call, and reporting the
 * cumulative result.
 *
 * A call can only afford a few dozen games, so a bigger sample is several
 * calls. The server keeps nothing between them; what carries over is a small
 * set of TOTALS per opponent (this file), which the API wraps in a signed token
 * (apps/api/src/deck/simulateContinue.ts). Everything the cumulative report
 * shows is derived from those totals, so each one is a SUM that adds across
 * calls:
 *
 *  - record (wins / losses / draws / time-outs / errors), the decided wins and
 *    losses behind the win rate, the going-first and going-second splits;
 *  - game length (summed turns over finished games), how games were won/lost;
 *  - the opening-speed rates (attack by T2, never attacked, mulligans) as counts;
 *  - the loss-pattern counts;
 *  - for a paired comparison, the sufficient statistics of the paired interval
 *    (clusters, Σ, Σ², ...: compare.ts PairedStats), so the verdict and its
 *    interval are exactly what one long run would give.
 *
 * What does NOT add up, and is dropped from a cumulative report (it stays in the
 * first call's report): the card-impact table, the Prize-taker and liability
 * rows, and the median first-attack turn. They are per-call detail; keeping
 * them would put a table per card in the token.
 *
 * SEEDS. Opponent i's `next` is the index of its next unplayed seed pair; a
 * continued call starts there (runner.ts `firstPair`), so N calls of g games are
 * the games one run of N·g would have been. `next` is per opponent because a
 * call that hit its time budget may have got further against some than others.
 */
import {
  addPairedStats, diffFromStats, emptyPairedStats, pairClusters, pairedStatsOf, type PairedStats,
} from './compare.js';
import { buildComparison, type ComparisonReport } from './compareReport.js';
import type { DeckInput } from './context.js';
import { deckCoverage, CAVEAT, type SimReport } from './report.js';
import { isTimeout, type GameSummary, type SimulationResult } from './runner.js';
import { rate, recordOf, type MatchupStats, type OverallStats, type Record4, type SideSetup } from './stats.js';

export interface SideSetupTotals {
  /** Games that did not end in an engine error. */
  games: number;
  /** ...in which the side attacked at all. */
  attacked: number;
  /** ...in which it attacked by its own turn 2. */
  byTurn2: number;
  /** Mulligans, summed. */
  mulligans: number;
}

export interface MatchupTotals {
  /** The next unplayed seed pair (pairs 0..next-1 have been played, at least in part). */
  next: number;
  played: number;
  record: Record4;
  /** Decided games (a winner, no engine error): the subject's wins and losses — the win-rate numerator and the rest. */
  decidedWins: number;
  decidedLosses: number;
  /** [subject's wins, decided games] when the subject went first / second. */
  first: [number, number];
  second: [number, number];
  /** Turns summed over games that finished (no time-out, no error), and how many. */
  turns: number;
  finished: number;
  winReasons: Record<string, number>;
  lossReasons: Record<string, number>;
  setup: [SideSetupTotals, SideSetupTotals];
  /** Of the decided losses: no attack by T3, decked out, no Pokémon left, mulliganed. */
  loss: { noAttackByTurn3: number; deckOut: number; benchedOut: number; mulliganed: number };
  /** Wall time over every call, ms. */
  elapsedMs: number;
  /** Whether the LATEST call's budget ended this matchup early (not cumulative). */
  stoppedEarly: boolean;
  firstError?: string;
}

const decided = (g: GameSummary): boolean => g.winner !== null && g.reason !== 'engine error';

export function emptyTotals(next = 0): MatchupTotals {
  const side = (): SideSetupTotals => ({ games: 0, attacked: 0, byTurn2: 0, mulligans: 0 });
  return {
    next, played: 0, record: { wins: 0, losses: 0, draws: 0, timeouts: 0, errors: 0 }, decidedWins: 0, decidedLosses: 0,
    first: [0, 0], second: [0, 0], turns: 0, finished: 0, winReasons: {}, lossReasons: {}, setup: [side(), side()],
    loss: { noAttackByTurn3: 0, deckOut: 0, benchedOut: 0, mulliganed: 0 }, elapsedMs: 0, stoppedEarly: false,
  };
}

function bumpAll(into: Record<string, number>, from: Record<string, number>): void {
  for (const [k, v] of Object.entries(from)) into[k] = (into[k] ?? 0) + v;
}

/** The deadline cut this game: it is a stop, not an outcome. */
const cut = (g: GameSummary): boolean => g.reason === 'time limit';

/**
 * The pair indexes whose games are ALL there: both seats played, none cut by the
 * deadline. Only the last pair of a call can be missing a seat or have one cut.
 */
function completePairs(games: GameSummary[]): Set<number> {
  const seats = new Map<number, { n: number; cut: boolean }>();
  for (const g of games) {
    const e = seats.get(g.pair) ?? { n: 0, cut: false };
    e.n++;
    e.cut ||= cut(g);
    seats.set(g.pair, e);
  }
  return new Set([...seats].filter(([, e]) => e.n === 2 && !e.cut).map(([p]) => p));
}

/**
 * INTERRUPTED PAIRS ARE REPLAYED, NOT RESUMED. A hard deadline can end a call
 * between the two seatings of a pair, or cut a game short. Such a pair is left
 * out of the totals (the call's own first-time report still shows it) and `next`
 * stays at it, so the next call plays that pair again from the top — the games
 * are deterministic, so it plays exactly what one uninterrupted run would have.
 * That keeps equality with a single long run unconditional and each deck going
 * first in exactly half of the counted games, with nothing extra in the token.
 * The price is at most one pair's compute per interrupted call.
 */
function keepComplete(r: SimulationResult, pairs: Set<number>): SimulationResult {
  const games = r.games.filter((g) => pairs.has(g.pair));
  return games.length === r.games.length ? r : { ...r, games, played: games.length };
}

/** The totals of one batch of games that started at pair `firstPair` (interrupted pairs left out, see above). */
export function totalsOf(r0: SimulationResult, firstPair = 0): MatchupTotals {
  const r = keepComplete(r0, completePairs(r0.games));
  const games = r.games;
  const t = emptyTotals(firstPair + new Set(games.map((g) => g.pair)).size);
  t.played = games.length;
  t.record = recordOf(games);
  t.elapsedMs = Math.round(r.elapsedMs);
  t.stoppedEarly = r.stoppedEarly;
  for (const g of games) {
    if (decided(g)) {
      const win = g.winner === 0;
      if (win) t.decidedWins++;
      else t.decidedLosses++;
      const split = g.aFirst ? t.first : t.second;
      split[1]++;
      if (win) split[0]++;
      const m = win ? t.winReasons : t.lossReasons;
      m[g.reason] = (m[g.reason] ?? 0) + 1;
      if (!win) {
        if (g.firstAttack[0] === null || g.firstAttack[0] > 3) t.loss.noAttackByTurn3++;
        if (g.reason === 'deck out') t.loss.deckOut++;
        if (g.reason === 'no Pokémon in play') t.loss.benchedOut++;
        if (g.mulligans[0] > 0) t.loss.mulliganed++;
      }
    }
    if (g.reason !== 'engine error' && !isTimeout(g.reason)) {
      t.finished++;
      t.turns += g.turns;
    }
    if (g.reason !== 'engine error') {
      for (const side of [0, 1] as const) {
        const s = t.setup[side];
        s.games++;
        const fa = g.firstAttack[side];
        if (fa !== null) s.attacked++;
        if (fa !== null && fa <= 2) s.byTurn2++;
        s.mulligans += g.mulligans[side];
      }
    }
    if (g.error && t.firstError === undefined) t.firstError = g.error.slice(0, 160);
  }
  return t;
}

/** Previous totals plus a new batch. The stop flag is the new batch's; the first error stays the first. */
export function addTotals(a: MatchupTotals, b: MatchupTotals): MatchupTotals {
  const reasons = (x: Record<string, number>, y: Record<string, number>) => {
    const out = { ...x };
    bumpAll(out, y);
    return out;
  };
  const side = (x: SideSetupTotals, y: SideSetupTotals): SideSetupTotals => ({
    games: x.games + y.games, attacked: x.attacked + y.attacked, byTurn2: x.byTurn2 + y.byTurn2, mulligans: x.mulligans + y.mulligans,
  });
  const out: MatchupTotals = {
    next: Math.max(a.next, b.next),
    played: a.played + b.played,
    record: {
      wins: a.record.wins + b.record.wins, losses: a.record.losses + b.record.losses, draws: a.record.draws + b.record.draws,
      timeouts: a.record.timeouts + b.record.timeouts, errors: a.record.errors + b.record.errors,
    },
    decidedWins: a.decidedWins + b.decidedWins,
    decidedLosses: a.decidedLosses + b.decidedLosses,
    first: [a.first[0] + b.first[0], a.first[1] + b.first[1]],
    second: [a.second[0] + b.second[0], a.second[1] + b.second[1]],
    turns: a.turns + b.turns,
    finished: a.finished + b.finished,
    winReasons: reasons(a.winReasons, b.winReasons),
    lossReasons: reasons(a.lossReasons, b.lossReasons),
    setup: [side(a.setup[0], b.setup[0]), side(a.setup[1], b.setup[1])],
    loss: {
      noAttackByTurn3: a.loss.noAttackByTurn3 + b.loss.noAttackByTurn3, deckOut: a.loss.deckOut + b.loss.deckOut,
      benchedOut: a.loss.benchedOut + b.loss.benchedOut, mulliganed: a.loss.mulliganed + b.loss.mulliganed,
    },
    elapsedMs: a.elapsedMs + b.elapsedMs,
    stoppedEarly: b.stoppedEarly,
  };
  const err = a.firstError ?? b.firstError;
  if (err !== undefined) out.firstError = err;
  return out;
}

const share = (n: number, of: number): number | null => (of ? n / of : null);

function setupFrom(s: SideSetupTotals): SideSetup {
  return {
    medianFirstAttack: null,
    attackByTurn2: share(s.byTurn2, s.games),
    neverAttacked: share(s.games - s.attacked, s.games),
    mulligans: s.games ? s.mulligans / s.games : null,
  };
}

/** The matchup numbers a report prints, from totals. Prize rows and the median first attack are empty/null here (see the file comment). */
export function statsFromTotals(t: MatchupTotals, a: string, b: string): MatchupStats {
  const decidedN = t.decidedWins + t.decidedLosses;
  return {
    a,
    b,
    requested: t.played,
    played: t.played,
    stoppedEarly: t.stoppedEarly,
    elapsedMs: t.elapsedMs,
    record: t.record,
    winRate: rate(t.decidedWins, decidedN),
    goingFirst: rate(t.first[0], t.first[1]),
    goingSecond: rate(t.second[0], t.second[1]),
    avgTurns: t.finished ? t.turns / t.finished : null,
    winReasons: t.winReasons,
    lossReasons: t.lossReasons,
    setup: [setupFrom(t.setup[0]), setupFrom(t.setup[1])],
    prizeTakers: [[], []],
    liabilities: [[], []],
    lossPatterns: { losses: t.decidedLosses, ...t.loss },
    ...(t.firstError ? { firstError: t.firstError } : {}),
  };
}

export function overallFromTotals(ts: MatchupTotals[]): OverallStats {
  const sum = ts.reduce((acc, t) => addTotals(acc, t), emptyTotals());
  return {
    record: sum.record,
    winRate: rate(sum.decidedWins, sum.decidedWins + sum.decidedLosses),
    goingFirst: rate(sum.first[0], sum.first[1]),
    goingSecond: rate(sum.second[0], sum.second[1]),
  };
}

// ---------------------------------------------------------------------------
// Cumulative reports
// ---------------------------------------------------------------------------

export interface CumulativeInfo {
  /** Calls so far, this one included. */
  calls: number;
  /** Games played on this call alone (per version, in a comparison), summed over opponents. */
  thisCall: number;
}

export interface CumulativeInput {
  opponents: DeckInput[];
  calls: number;
  thisCall: number;
  /** The latest call's pilot name, seed and turn cap. */
  pilot: string;
  seed: number;
  maxTurns: number;
}

export interface CumulativeRunInput extends CumulativeInput {
  subject: DeckInput;
  /** One per opponent, in order. */
  totals: MatchupTotals[];
}

export function buildCumulativeReport(input: CumulativeRunInput): SimReport {
  const { totals, subject, opponents } = input;
  const played = totals.reduce((a, t) => a + t.played, 0);
  return {
    kind: 'deckpal.simulation',
    version: 1,
    simulated: true,
    caveat: CAVEAT,
    subject: subject.name,
    pilot: input.pilot,
    seed: input.seed,
    maxTurns: input.maxTurns,
    gamesRequested: played,
    gamesPlayed: played,
    stoppedEarly: totals.some((t) => t.stoppedEarly),
    elapsedMs: totals.reduce((a, t) => a + t.elapsedMs, 0),
    overall: overallFromTotals(totals),
    matchups: totals.map((t, i) => statsFromTotals(t, subject.name, opponents[i]?.name ?? `opponent ${i + 1}`)),
    cardImpact: { byTurn: 2, minN: 0, cards: [] },
    coverage: [subject, ...opponents].map(deckCoverage),
    cumulative: { calls: input.calls, thisCall: input.thisCall },
  };
}

/** One opponent in a paired comparison: each version's totals and the paired statistics. */
export interface CompareTotals {
  a: MatchupTotals;
  b: MatchupTotals;
  paired: PairedStats;
}

export function emptyCompareTotals(next = 0): CompareTotals {
  return { a: emptyTotals(next), b: emptyTotals(next), paired: emptyPairedStats() };
}

export function compareTotalsOf(r: [SimulationResult, SimulationResult], firstPair = 0): CompareTotals {
  // Only pairs both versions finished count, for both (interrupted pairs are replayed: see keepComplete).
  const pa = completePairs(r[0].games);
  const pb = completePairs(r[1].games);
  const both = new Set([...pa].filter((p) => pb.has(p)));
  const ka = keepComplete(r[0], both);
  const kb = keepComplete(r[1], both);
  return { a: totalsOf(ka, firstPair), b: totalsOf(kb, firstPair), paired: pairedStatsOf(pairClusters(ka, kb)) };
}

export function addCompareTotals(x: CompareTotals, y: CompareTotals): CompareTotals {
  return { a: addTotals(x.a, y.a), b: addTotals(x.b, y.b), paired: addPairedStats(x.paired, y.paired) };
}

export interface CumulativeCompareInput extends CumulativeInput {
  a: DeckInput;
  b: DeckInput;
  totals: CompareTotals[];
}

export function buildCumulativeComparison(input: CumulativeCompareInput): ComparisonReport {
  const { a, b, opponents, totals } = input;
  const report = (deck: DeckInput, pick: (t: CompareTotals) => MatchupTotals): SimReport => {
    const ts = totals.map(pick);
    const base = buildCumulativeReport({ ...input, subject: deck, totals: ts });
    return base;
  };
  const reportA = report(a, (t) => t.a);
  const reportB = report(b, (t) => t.b);
  // The static parts (method, changes, coverage, caveat) come from the one place that builds a report.
  const shell = buildComparison({ a, b, opponents, results: [] });
  const overall = diffFromStats(totals.reduce((acc, t) => addPairedStats(acc, t.paired), emptyPairedStats()));
  return {
    ...shell,
    pilot: input.pilot,
    seed: input.seed,
    maxTurns: input.maxTurns,
    gamesRequested: reportA.gamesPlayed,
    gamesPlayed: reportA.gamesPlayed,
    stoppedEarly: reportA.stoppedEarly || reportB.stoppedEarly,
    elapsedMs: reportA.elapsedMs + reportB.elapsedMs,
    overall,
    matchups: totals.map((t, i) => ({ opponent: opponents[i]?.name ?? `opponent ${i + 1}`, paired: diffFromStats(t.paired) })),
    changedImpact: { byTurn: 2, cards: [] },
    reportA,
    reportB,
    cumulative: { calls: input.calls, thisCall: input.thisCall },
  };
}

// ---------------------------------------------------------------------------
// Wire form (the token's payload; plain arrays and numbers, no names)
// ---------------------------------------------------------------------------

const nat = (x: unknown): number => {
  if (typeof x !== 'number' || !Number.isSafeInteger(x) || x < 0) throw new Error('malformed continuation totals');
  return x;
};
const fin = (x: unknown): number => {
  if (typeof x !== 'number' || !Number.isFinite(x) || Math.abs(x) > 1e9) throw new Error('malformed continuation totals');
  return x;
};
const arr = (x: unknown, n: number): unknown[] => {
  if (!Array.isArray(x) || x.length < n) throw new Error('malformed continuation totals');
  return x;
};

function reasonsToWire(r: Record<string, number>): Array<string | number> {
  return Object.entries(r).flat();
}

function reasonsFromWire(w: unknown): Record<string, number> {
  const a = arr(w, 0);
  if (a.length % 2 || a.length > 40) throw new Error('malformed continuation totals');
  const out: Record<string, number> = {};
  for (let i = 0; i < a.length; i += 2) {
    const k = a[i];
    if (typeof k !== 'string' || k.length > 40) throw new Error('malformed continuation totals');
    out[k] = nat(a[i + 1]);
  }
  return out;
}

export function totalsToWire(t: MatchupTotals): unknown[] {
  const s = (x: SideSetupTotals) => [x.games, x.attacked, x.byTurn2, x.mulligans];
  const r = t.record;
  return [
    t.next, t.played, [r.wins, r.losses, r.draws, r.timeouts, r.errors], t.decidedWins, t.decidedLosses, t.first, t.second,
    t.turns, t.finished, reasonsToWire(t.winReasons), reasonsToWire(t.lossReasons), s(t.setup[0]), s(t.setup[1]),
    [t.loss.noAttackByTurn3, t.loss.deckOut, t.loss.benchedOut, t.loss.mulliganed], t.elapsedMs, t.stoppedEarly ? 1 : 0,
    ...(t.firstError ? [t.firstError] : []),
  ];
}

export function totalsFromWire(w: unknown): MatchupTotals {
  const a = arr(w, 16);
  const rec = arr(a[2], 5);
  const pair = (x: unknown): [number, number] => {
    const p = arr(x, 2);
    return [nat(p[0]), nat(p[1])];
  };
  const side = (x: unknown): SideSetupTotals => {
    const p = arr(x, 4);
    return { games: nat(p[0]), attacked: nat(p[1]), byTurn2: nat(p[2]), mulligans: nat(p[3]) };
  };
  const loss = arr(a[13], 4);
  const t: MatchupTotals = {
    next: nat(a[0]),
    played: nat(a[1]),
    record: { wins: nat(rec[0]), losses: nat(rec[1]), draws: nat(rec[2]), timeouts: nat(rec[3]), errors: nat(rec[4]) },
    decidedWins: nat(a[3]),
    decidedLosses: nat(a[4]),
    first: pair(a[5]),
    second: pair(a[6]),
    turns: nat(a[7]),
    finished: nat(a[8]),
    winReasons: reasonsFromWire(a[9]),
    lossReasons: reasonsFromWire(a[10]),
    setup: [side(a[11]), side(a[12])],
    loss: { noAttackByTurn3: nat(loss[0]), deckOut: nat(loss[1]), benchedOut: nat(loss[2]), mulliganed: nat(loss[3]) },
    elapsedMs: nat(a[14]),
    stoppedEarly: nat(a[15]) === 1,
  };
  if (typeof a[16] === 'string') t.firstError = a[16].slice(0, 160);
  return t;
}

export function pairedToWire(p: PairedStats): number[] {
  return [p.m, p.n, p.sum, p.sumSq, p.sumN, p.nSq, p.bAhead, p.aAhead];
}

export function pairedFromWire(w: unknown): PairedStats {
  const a = arr(w, 8);
  return { m: nat(a[0]), n: nat(a[1]), sum: fin(a[2]), sumSq: fin(a[3]), sumN: fin(a[4]), nSq: nat(a[5]), bAhead: nat(a[6]), aAhead: nat(a[7]) };
}

export function compareToWire(c: CompareTotals): unknown[] {
  return [totalsToWire(c.a), totalsToWire(c.b), pairedToWire(c.paired)];
}

export function compareFromWire(w: unknown): CompareTotals {
  const a = arr(w, 3);
  return { a: totalsFromWire(a[0]), b: totalsFromWire(a[1]), paired: pairedFromWire(a[2]) };
}
