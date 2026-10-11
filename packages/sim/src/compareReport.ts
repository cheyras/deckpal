/**
 * A paired comparison (compare.ts) → a structured report and a compact text
 * that LEADS with the answer to "is B better than A?": the paired difference
 * with its interval and a verdict line that claims a winner only when the
 * interval excludes 0. Same honesty rules as report.ts — every rate with its n
 * and interval, coverage named, the standing caveat last — and the same
 * 5,000-character default bound, met by shedding detail in a fixed order.
 */
import {
  deckChanges,
  pairedDiff,
  pairedOverall,
  MIN_VERDICT_PAIRS,
  type CardChange,
  type PairedDiff,
} from './compare.js';
import type { DeckInput } from './context.js';
import {
  CAVEAT,
  COVERAGE_KEY,
  RANDOM_PILOT_WARNING,
  buildReport,
  coverageLine,
  deckCoverage,
  pct,
  rateText,
  recordText,
  type DeckCoverage,
  type SimReport,
} from './report.js';
import type { SimulationResult } from './runner.js';
import type { ImpactSplit } from './stats.js';

export interface ComparisonMatchup {
  opponent: string;
  paired: PairedDiff;
}

export interface ChangedCardImpact {
  card: string;
  a: number;
  b: number;
  /** Played by own turn byTurn vs not, in each version; null when that split is too thin (or the version has none). */
  inA: ImpactSplit | null;
  inB: ImpactSplit | null;
}

export interface ComparisonReport {
  kind: 'deckpal.simulation.comparison';
  version: 1;
  simulated: true;
  caveat: string;
  /** How the difference and its interval are computed, in one sentence. */
  method: string;
  a: string;
  b: string;
  pilot: string;
  seed: number;
  maxTurns: number;
  /** Per version. */
  gamesRequested: number;
  gamesPlayed: number;
  stoppedEarly: boolean;
  elapsedMs: number;
  minVerdictPairs: number;
  overall: PairedDiff;
  matchups: ComparisonMatchup[];
  changes: CardChange[];
  changedImpact: { byTurn: number; cards: ChangedCardImpact[] };
  /** Each version's own full report (same shape as a single run). */
  reportA: SimReport;
  reportB: SimReport;
  /** A, B, then each opponent. */
  coverage: DeckCoverage[];
}

export const PAIRED_METHOD =
  'Both versions play each opponent on the same seeds and seats. Per game, score = win 1, draw/time-out ½, loss 0; ' +
  'Δ = mean(score B − score A) over paired games; the 95% interval is a t-interval with the two seat-swapped games ' +
  `of each seed as one cluster (df = seeds − 1). A verdict needs the interval to exclude 0 and at least ${MIN_VERDICT_PAIRS} seeds.`;

export interface BuildComparisonInput {
  a: DeckInput;
  b: DeckInput;
  opponents: DeckInput[];
  /** One [A, B] pair of results per opponent, same order. */
  results: [SimulationResult, SimulationResult][];
  elapsedMs?: number;
}

export function buildComparison(input: BuildComparisonInput): ComparisonReport {
  const resA = input.results.map((r) => r[0]);
  const resB = input.results.map((r) => r[1]);
  const reportA = buildReport({ subject: input.a, opponents: input.opponents, results: resA });
  const reportB = buildReport({ subject: input.b, opponents: input.opponents, results: resB });
  const changes = deckChanges(input.a, input.b);
  const split = (r: SimReport, card: string) => r.cardImpact.cards.find((c) => c.card === card)?.played ?? null;
  return {
    kind: 'deckpal.simulation.comparison',
    version: 1,
    simulated: true,
    caveat: CAVEAT,
    method: PAIRED_METHOD,
    a: input.a.name,
    b: input.b.name,
    pilot: reportA.pilot,
    seed: reportA.seed,
    maxTurns: reportA.maxTurns,
    gamesRequested: reportA.gamesRequested,
    gamesPlayed: reportA.gamesPlayed,
    stoppedEarly: reportA.stoppedEarly || reportB.stoppedEarly,
    elapsedMs: input.elapsedMs ?? reportA.elapsedMs + reportB.elapsedMs,
    minVerdictPairs: MIN_VERDICT_PAIRS,
    overall: pairedOverall(input.results),
    matchups: input.results.map(([a, b], i) => ({ opponent: input.opponents[i]?.name ?? a.b, paired: pairedDiff(a, b) })),
    changes,
    changedImpact: {
      byTurn: reportA.cardImpact.byTurn,
      cards: changes.map((c) => ({ ...c, inA: split(reportA, c.card), inB: split(reportB, c.card) })),
    },
    reportA,
    reportB,
    coverage: [input.a, input.b, ...input.opponents].map(deckCoverage),
  };
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

const pts = (x: number | null) => (x == null ? '–' : `${x > 0 ? '+' : x < 0 ? '−' : '±'}${Math.abs(Math.round(x * 100))}`);

/** "Δ +8 pts [−6, +22], 12 seeds, 24 paired games; B ahead in 7, A ahead in 3". */
function diffText(d: PairedDiff): string {
  if (d.diff === null) return 'Δ – (no paired games)';
  const ci = d.lo === null || d.hi === null ? ' [no interval: one seed]' : ` [${pts(d.lo)}, ${pts(d.hi)}]`;
  return `Δ ${pts(d.diff)} pts${ci}, ${d.pairs} seed${d.pairs === 1 ? '' : 's'} (${d.games} paired games); B ahead in ${d.bAhead}, A ahead in ${d.aAhead}`;
}

function verdictText(d: PairedDiff, a: string, b: string): string {
  if (d.verdict === 'b') return `B is better: ${b} beats ${a} in these simulations (the interval excludes 0).`;
  if (d.verdict === 'a') return `A is better: ${a} beats ${b} in these simulations (the interval excludes 0).`;
  if (d.pairs < MIN_VERDICT_PAIRS) {
    return `No clear difference at this n: only ${d.pairs} seed${d.pairs === 1 ? '' : 's'} played (a verdict needs ≥${MIN_VERDICT_PAIRS} and an interval that excludes 0) — use speed 'fast', fewer opponents or more games.`;
  }
  return 'No clear difference at this n: the interval includes 0, so the gap is within noise.';
}

function shortVerdict(d: PairedDiff): string {
  return d.verdict === 'b' ? 'B better' : d.verdict === 'a' ? 'A better' : 'no clear difference';
}

function changeText(changes: CardChange[]): string {
  if (!changes.length) return 'Changes A → B: none (the same list).';
  return `Changes A → B: ${changes.map((c) => `${c.card} ${c.a}→${c.b}`).join(', ')}.`;
}

function splitText(s: ImpactSplit | null): string {
  if (!s) return 'too few games';
  return `${s.deltaPts > 0 ? '+' : ''}${s.deltaPts} pts (${pct(s.with.p)} played, n=${s.with.n}, vs ${pct(s.without.p)} not, n=${s.without.n})`;
}

function changedImpactLines(r: ComparisonReport, max: number): string[] {
  const rows = r.changedImpact.cards.slice(0, max);
  if (!rows.length) return [];
  const out = [`Changed cards, win rate when played by T${r.changedImpact.byTurn} vs not (association, not cause):`];
  for (const c of rows) {
    const parts: string[] = [];
    if (c.a > 0) parts.push(`A ${splitText(c.inA)}`);
    if (c.b > 0) parts.push(`B ${splitText(c.inB)}`);
    out.push(`  ${c.card} (${c.a}→${c.b}): ${parts.join('; ')}`);
  }
  if (r.changedImpact.cards.length > max) out.push(`  +${r.changedImpact.cards.length - max} more changed cards in the structured report`);
  return out;
}

type Detail = 'full' | 'minimal';

function render(r: ComparisonReport, detail: Detail, impactMax: number, coverageMax: number): string {
  const n = r.matchups.length;
  const lines: string[] = [];
  lines.push(`SIMULATED BATTLES (not real games) — COMPARISON of two versions vs ${n} opponent${n === 1 ? '' : 's'}: A = ${r.a}, B = ${r.b}`);
  lines.push(`VERDICT: ${verdictText(r.overall, r.a, r.b)}`);
  lines.push(`Overall: ${diffText(r.overall)}.`);
  lines.push(changeText(r.changes));
  lines.push(
    `${r.gamesPlayed} of ${r.gamesRequested} games per version played${r.stoppedEarly ? ' (time budget reached: fewer than asked)' : ''}; ` +
      `both versions on the same seeds and seats, seats swapped each pair. Pilot: ${r.pilot}. Seed ${r.seed}. Turn cap ${r.maxTurns}. ${(r.elapsedMs / 1000).toFixed(1)} s.`,
  );
  lines.push(
    'Key: Δ = B − A in points of game score (win 1, draw/time-out ½, loss 0) on paired games; [x, y] = its 95% interval (t, per-seed clusters); ' +
      'win rates show [a–b%] = Wilson 95% interval, n = decided games.',
  );
  if (r.pilot.includes('random')) lines.push(RANDOM_PILOT_WARNING);
  const oa = r.reportA.overall;
  const ob = r.reportB.overall;
  lines.push(`Win rates: A ${rateText(oa.winRate)} (${recordText(oa.record)}); B ${rateText(ob.winRate)} (${recordText(ob.record)}).`);
  lines.push('');
  r.matchups.forEach((m, i) => {
    const ma = r.reportA.matchups[i]!;
    const mb = r.reportB.matchups[i]!;
    const played = `${ma.played}${ma.played < ma.requested ? ` of ${ma.requested}` : ''} games each`;
    lines.push(`${i + 1}. vs ${m.opponent} — ${played}: ${diffText(m.paired)} → ${shortVerdict(m.paired)}.`);
    if (detail === 'full') lines.push(`   A win ${rateText(ma.winRate)}; B win ${rateText(mb.winRate)}.`);
  });
  lines.push('');
  if (impactMax > 0) {
    const imp = changedImpactLines(r, impactMax);
    if (imp.length) lines.push(...imp, '');
  }
  lines.push(COVERAGE_KEY);
  r.coverage.forEach((c, i) => lines.push(coverageLine(c, i === 0 ? `A ${c.deck}` : i === 1 ? `B ${c.deck}` : `#${i - 1} ${c.deck}`, coverageMax)));
  lines.push('');
  lines.push(`Caveat: ${r.caveat}`);
  return lines.join('\n');
}

/** The comparison as text, at most `limit` characters; detail is shed in a fixed order, the verdict and caveat never. */
export function renderComparison(r: ComparisonReport, limit = 5000): string {
  const attempts: [Detail, number, number][] = [
    ['full', 6, 99],
    ['full', 3, 99],
    ['minimal', 3, 99],
    ['minimal', 0, 99],
    ['minimal', 0, 8],
    ['minimal', 0, 4],
  ];
  let text = '';
  for (const [detail, impact, cov] of attempts) {
    text = render(r, detail, impact, cov);
    if (text.length <= limit) return text;
  }
  const tail = `\n…(cut to fit; the structured report has every row)\nCaveat: ${r.caveat}`;
  return text.slice(0, Math.max(0, limit - tail.length)) + tail;
}
