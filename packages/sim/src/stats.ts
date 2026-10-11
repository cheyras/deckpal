/**
 * Aggregates over game summaries. Every rate carries its sample size and a
 * Wilson 95% interval, because a win rate without its n is a number a model
 * will over-read — 7 of 10 and 700 of 1,000 are not the same claim.
 *
 * Draws (a simultaneous win) and time-outs (the turn or decision cap) are
 * counted on their own and kept OUT of the win-rate denominator; so are engine
 * errors. A win rate here is wins / (wins + losses).
 */
import { isTimeout, type GameSummary, type Side, type SimulationResult } from './runner.js';

export interface Rate {
  wins: number;
  n: number;
  /** wins / n, or null when n = 0. */
  p: number | null;
  /** Wilson 95% interval bounds, or null when n = 0. */
  lo: number | null;
  hi: number | null;
}

const Z95 = 1.959964;

/** Wilson score interval for `wins` successes in `n` trials. */
export function wilson(wins: number, n: number, z = Z95): { lo: number; hi: number } | null {
  if (n <= 0) return null;
  const p = wins / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { lo: Math.max(0, center - half), hi: Math.min(1, center + half) };
}

export function rate(wins: number, n: number): Rate {
  const ci = wilson(wins, n);
  return { wins, n, p: n ? wins / n : null, lo: ci?.lo ?? null, hi: ci?.hi ?? null };
}

export interface Record4 {
  wins: number;
  losses: number;
  draws: number;
  timeouts: number;
  errors: number;
}

export interface SideSetup {
  /** Median own turn of the first attack, over games where the side attacked. */
  medianFirstAttack: number | null;
  /** Share of games in which the side attacked by its own turn 2. */
  attackByTurn2: number | null;
  /** Share of games in which the side never attacked. */
  neverAttacked: number | null;
  /** Mean mulligans per game. */
  mulligans: number | null;
}

export interface PrizeRow {
  name: string;
  prizes: number;
  kos: number;
}

export interface LossPatterns {
  losses: number;
  /** Losses where the subject had not attacked by its own turn 3. */
  noAttackByTurn3: number;
  /** Losses by the subject decking out. */
  deckOut: number;
  /** Losses with no Pokémon left in play. */
  benchedOut: number;
  /** Losses where the subject mulliganed at least once. */
  mulliganed: number;
}

export interface MatchupStats {
  a: string;
  b: string;
  requested: number;
  played: number;
  stoppedEarly: boolean;
  elapsedMs: number;
  record: Record4;
  /** The subject's (deck A's) win rate over decided games. */
  winRate: Rate;
  goingFirst: Rate;
  goingSecond: Rate;
  /** Mean turns (both players counted) over games that finished (no time-outs or errors). */
  avgTurns: number | null;
  /** Reason → count, for the subject's wins and its losses. */
  winReasons: Record<string, number>;
  lossReasons: Record<string, number>;
  /** [subject, opponent]. */
  setup: [SideSetup, SideSetup];
  /** Who took the Prizes, per side: the Pokémon credited with each Knock Out. */
  prizeTakers: [PrizeRow[], PrizeRow[]];
  /** Which of a side's own Pokémon gave up the most Prizes. */
  liabilities: [PrizeRow[], PrizeRow[]];
  lossPatterns: LossPatterns;
  /** First engine error message, when any game errored. */
  firstError?: string;
}

/** The label for Knock Outs no single Pokémon is credited with. */
export const UNCREDITED = '(counters/conditions)';

function decided(g: GameSummary): boolean {
  return g.winner !== null && g.reason !== 'engine error';
}

export function recordOf(games: GameSummary[], side: Side = 0): Record4 {
  const r: Record4 = { wins: 0, losses: 0, draws: 0, timeouts: 0, errors: 0 };
  for (const g of games) {
    if (g.reason === 'engine error') r.errors++;
    else if (isTimeout(g.reason)) r.timeouts++;
    else if (g.winner === null) r.draws++;
    else if (g.winner === side) r.wins++;
    else r.losses++;
  }
  return r;
}

function winRateOf(games: GameSummary[], side: Side = 0): Rate {
  const d = games.filter(decided);
  return rate(d.filter((g) => g.winner === side).length, d.length);
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = xs.slice().sort((x, y) => x - y);
  const mid = s.length >> 1;
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

function share(n: number, of: number): number | null {
  return of ? n / of : null;
}

function setupOf(games: GameSummary[], side: Side): SideSetup {
  const g = games.filter((x) => x.reason !== 'engine error');
  const attacked = g.map((x) => x.firstAttack[side]).filter((t): t is number => t !== null);
  return {
    medianFirstAttack: median(attacked),
    attackByTurn2: share(attacked.filter((t) => t <= 2).length, g.length),
    neverAttacked: share(g.length - attacked.length, g.length),
    mulligans: g.length ? g.reduce((a, x) => a + x.mulligans[side], 0) / g.length : null,
  };
}

function top(map: Map<string, PrizeRow>, n: number): PrizeRow[] {
  return [...map.values()].sort((x, y) => y.prizes - x.prizes || y.kos - x.kos || x.name.localeCompare(y.name)).slice(0, n);
}

function bump(map: Map<string, PrizeRow>, name: string, prizes: number): void {
  const row = map.get(name) ?? { name, prizes: 0, kos: 0 };
  row.prizes += prizes;
  row.kos++;
  map.set(name, row);
}

function reasons(games: GameSummary[], pick: (g: GameSummary) => boolean): Record<string, number> {
  const out: Record<string, number> = {};
  for (const g of games) if (pick(g)) out[g.reason] = (out[g.reason] ?? 0) + 1;
  return out;
}

export function matchupStats(r: SimulationResult, topN = 3): MatchupStats {
  const games = r.games;
  const finished = games.filter((g) => g.reason !== 'engine error' && !isTimeout(g.reason));
  const takers: [Map<string, PrizeRow>, Map<string, PrizeRow>] = [new Map(), new Map()];
  const liab: [Map<string, PrizeRow>, Map<string, PrizeRow>] = [new Map(), new Map()];
  for (const g of games) {
    for (const ko of g.kos) {
      bump(takers[ko.by], ko.attacker ?? UNCREDITED, ko.prizes);
      bump(liab[(1 - ko.by) as Side], ko.victim, ko.prizes);
    }
  }
  const losses = games.filter((g) => decided(g) && g.winner === 1);
  const err = games.find((g) => g.error);
  return {
    a: r.a,
    b: r.b,
    requested: r.requested,
    played: r.played,
    stoppedEarly: r.stoppedEarly,
    elapsedMs: r.elapsedMs,
    record: recordOf(games),
    winRate: winRateOf(games),
    goingFirst: winRateOf(games.filter((g) => g.aFirst)),
    goingSecond: winRateOf(games.filter((g) => !g.aFirst)),
    avgTurns: finished.length ? finished.reduce((a, g) => a + g.turns, 0) / finished.length : null,
    winReasons: reasons(games, (g) => decided(g) && g.winner === 0),
    lossReasons: reasons(games, (g) => decided(g) && g.winner === 1),
    setup: [setupOf(games, 0), setupOf(games, 1)],
    prizeTakers: [top(takers[0], topN), top(takers[1], topN)],
    liabilities: [top(liab[0], topN), top(liab[1], topN)],
    lossPatterns: {
      losses: losses.length,
      noAttackByTurn3: losses.filter((g) => g.firstAttack[0] === null || g.firstAttack[0] > 3).length,
      deckOut: losses.filter((g) => g.reason === 'deck out').length,
      benchedOut: losses.filter((g) => g.reason === 'no Pokémon in play').length,
      mulliganed: losses.filter((g) => g.mulligans[0] > 0).length,
    },
    ...(err?.error ? { firstError: err.error } : {}),
  };
}

export interface OverallStats {
  record: Record4;
  winRate: Rate;
  goingFirst: Rate;
  goingSecond: Rate;
}

export function overallStats(results: SimulationResult[]): OverallStats {
  const games = results.flatMap((r) => r.games);
  return {
    record: recordOf(games),
    winRate: winRateOf(games),
    goingFirst: winRateOf(games.filter((g) => g.aFirst)),
    goingSecond: winRateOf(games.filter((g) => !g.aFirst)),
  };
}

export interface ImpactSplit {
  /** Games where it happened by the cutoff turn. */
  with: Rate;
  without: Rate;
  /** with.p − without.p, in percentage points. */
  deltaPts: number;
}

export interface CardImpact {
  card: string;
  /** Put into play / used by the subject's own turn `byTurn`. Null when either side of the split is under `minN`. */
  played: ImpactSplit | null;
  /** Drawn or searched by own turn `byTurn`. */
  seen: ImpactSplit | null;
}

export interface CardImpactOptions {
  /** Own-turn cutoff for "early". Default 2. */
  byTurn?: number;
  /** Minimum decided games on EACH side of a split. Default max(8, 10% of decided games). */
  minN?: number;
}

function split(games: GameSummary[], hit: (g: GameSummary) => boolean, minN: number): ImpactSplit | null {
  const yes = games.filter(hit);
  const no = games.filter((g) => !hit(g));
  if (yes.length < minN || no.length < minN) return null;
  const w = rate(yes.filter((g) => g.winner === 0).length, yes.length);
  const wo = rate(no.filter((g) => g.winner === 0).length, no.length);
  return { with: w, without: wo, deltaPts: Math.round(((w.p ?? 0) - (wo.p ?? 0)) * 1000) / 10 };
}

/**
 * Win rate when a subject card showed up early vs when it did not. An
 * ASSOCIATION, not a cause: a card played on turn 2 is partly a symptom of a
 * hand that was already working. Cards whose split is too thin to read are
 * dropped rather than shown with a misleading number.
 */
export function cardImpact(results: SimulationResult[], opts: CardImpactOptions = {}): { byTurn: number; minN: number; cards: CardImpact[] } {
  const games = results.flatMap((r) => r.games).filter(decided);
  const byTurn = opts.byTurn ?? 2;
  const minN = opts.minN ?? Math.max(8, Math.ceil(games.length * 0.1));
  const names = new Set<string>();
  for (const g of games) {
    for (const k of Object.keys(g.played[0])) names.add(k);
    for (const k of Object.keys(g.seen[0])) names.add(k);
  }
  const cards: CardImpact[] = [];
  for (const card of [...names].sort()) {
    const played = split(games, (g) => (g.played[0][card] ?? Infinity) <= byTurn, minN);
    const seen = split(games, (g) => (g.seen[0][card] ?? Infinity) <= byTurn, minN);
    if (played || seen) cards.push({ card, played, seen });
  }
  const mag = (c: CardImpact) => Math.max(Math.abs(c.played?.deltaPts ?? 0), Math.abs(c.seen?.deltaPts ?? 0));
  cards.sort((x, y) => mag(y) - mag(x) || x.card.localeCompare(y.card));
  return { byTurn, minN, cards };
}
