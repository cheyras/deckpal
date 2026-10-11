/**
 * One simulation run → a structured report (for code) and a compact text (for
 * a model). The text is what Deck-E and an MCP client read, and Deck-E clamps a
 * tool result at 6,000 characters, so it is rendered to fit `limit` (5,000 by
 * default) by dropping detail in a fixed order — never the sample sizes, never
 * the coverage names, never the caveat.
 *
 * HONESTY IS THE FORMAT, not a footnote:
 *  - every rate is printed with its n and its Wilson 95% interval;
 *  - draws, time-outs and engine errors are printed apart from wins and losses;
 *  - every card the engine only approximates (or cannot play) is named;
 *  - the first line and the last say these are simulated games, and the
 *    standing caveat says why a bot's results are not a person's.
 */
import { buildDef } from './cards/frame.js';
import { scriptFor } from './cards/registry.js';
import type { DeckInput } from './context.js';
import type { SimulationResult } from './runner.js';
import {
  cardImpact,
  matchupStats,
  overallStats,
  type CardImpact,
  type MatchupStats,
  type OverallStats,
  type PrizeRow,
  type Rate,
  type SideSetup,
} from './stats.js';

export interface CoverageLine {
  name: string;
  count: number;
}

export interface DeckCoverage {
  deck: string;
  total: number;
  /** Copies the engine plays from a script or from the frame alone (no effect text). */
  covered: number;
  /** Pokémon whose effects/Abilities are ignored: attacks deal printed damage only. */
  approx: CoverageLine[];
  /** Trainers and Special Energy with no script: they cannot be played at all. */
  none: CoverageLine[];
}

/** How well the engine plays each card of a deck — the same rule `buildDef` applies in a game. */
export function deckCoverage(deck: DeckInput): DeckCoverage {
  const approx = new Map<string, number>();
  const none = new Map<string, number>();
  let total = 0;
  let covered = 0;
  for (const e of deck.cards) {
    total += e.count;
    const cov = buildDef(0, e.frame, scriptFor(e.frame), 'cov').coverage;
    if (cov === 'full' || cov === 'vanilla') covered += e.count;
    else {
      const m = cov === 'approx' ? approx : none;
      const n = e.frame.name.trim();
      m.set(n, (m.get(n) ?? 0) + e.count);
    }
  }
  const list = (m: Map<string, number>) => [...m].map(([name, count]) => ({ name, count })).sort((x, y) => x.name.localeCompare(y.name));
  return { deck: deck.name, total, covered, approx: list(approx), none: list(none) };
}

export const CAVEAT =
  'These are SIMULATED games, not real ones. A heuristic CPU pilots both decks and plays well below a strong human; ' +
  'it knows each opponent only from its decklist. Read the numbers as how these lists fare under the same bot — ' +
  'most useful for comparing two versions of a deck against the same opponents — never as real-world or ladder win rates. ' +
  'Cards listed under Coverage are approximated or unplayable, which skews the matchups they appear in.';

export const RANDOM_PILOT_WARNING =
  'This run used the RANDOM placeholder pilot (uniformly random legal moves): its results say very little about deck quality.';

export interface SimReport {
  kind: 'deckpal.simulation';
  version: 1;
  simulated: true;
  caveat: string;
  subject: string;
  pilot: string;
  seed: number;
  maxTurns: number;
  gamesRequested: number;
  gamesPlayed: number;
  stoppedEarly: boolean;
  elapsedMs: number;
  overall: OverallStats;
  matchups: MatchupStats[];
  cardImpact: { byTurn: number; minN: number; cards: CardImpact[] };
  /** Subject first, then each opponent in matchup order. */
  coverage: DeckCoverage[];
}

export interface BuildReportInput {
  subject: DeckInput;
  opponents: DeckInput[];
  /** One result per opponent, same order; a result may be missing when the budget ran out first. */
  results: SimulationResult[];
  /** Total wall time, if the caller timed more than the games. */
  elapsedMs?: number;
}

export function buildReport(input: BuildReportInput): SimReport {
  const { results } = input;
  const first = results[0];
  return {
    kind: 'deckpal.simulation',
    version: 1,
    simulated: true,
    caveat: CAVEAT,
    subject: input.subject.name,
    pilot: first?.pilot ?? 'unknown',
    seed: first?.seed ?? 0,
    maxTurns: first?.maxTurns ?? 60,
    gamesRequested: results.reduce((a, r) => a + r.requested, 0),
    gamesPlayed: results.reduce((a, r) => a + r.played, 0),
    stoppedEarly: results.some((r) => r.stoppedEarly),
    elapsedMs: input.elapsedMs ?? results.reduce((a, r) => a + r.elapsedMs, 0),
    overall: overallStats(results),
    matchups: results.map((r) => matchupStats(r)),
    cardImpact: cardImpact(results),
    coverage: [input.subject, ...input.opponents].map(deckCoverage),
  };
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------


export const pct = (x: number | null | undefined) => (x == null ? '–' : `${Math.round(x * 100)}%`);
const num = (x: number | null | undefined) => (x == null ? '–' : `${Math.round(x * 100)}`);

/** "36% [15–65%, n=11]": the bracket is the Wilson 95% interval (the key line says so). */
export function rateText(r: Rate): string {
  if (!r.n) return '– (n=0)';
  return `${pct(r.p)} [${num(r.lo)}–${pct(r.hi)}, n=${r.n}]`;
}

function shortRate(r: Rate): string {
  return r.n ? `${pct(r.p)} (n=${r.n})` : '– (n=0)';
}

export function recordText(m: { wins: number; losses: number; draws: number; timeouts: number; errors: number }): string {
  const parts = [`${m.wins}W–${m.losses}L`];
  parts.push(`${m.draws} draw${m.draws === 1 ? '' : 's'}`);
  parts.push(`${m.timeouts} time-out${m.timeouts === 1 ? '' : 's'}`);
  if (m.errors) parts.push(`${m.errors} engine error${m.errors === 1 ? '' : 's'}`);
  return parts.join(', ');
}

function reasonsText(r: Record<string, number>): string {
  const e = Object.entries(r).sort((x, y) => y[1] - x[1]);
  return e.length ? e.map(([k, v]) => `${k} ${v}`).join(', ') : 'none';
}

function setupText(s: SideSetup): string {
  if (s.attackByTurn2 === null) return '–';
  const med = s.medianFirstAttack === null ? 'never' : `T${s.medianFirstAttack}`;
  return `attack by T2 ${pct(s.attackByTurn2)} (median first attack ${med}, never ${pct(s.neverAttacked)})`;
}

function prizeRows(rows: PrizeRow[]): string {
  return rows.length ? rows.map((r) => `${r.name} ${r.prizes} (${r.kos} KO${r.kos === 1 ? '' : 's'})`).join(', ') : 'none';
}

type Detail = 'full' | 'compact' | 'minimal';

function matchupLines(m: MatchupStats, i: number, detail: Detail): string[] {
  const head =
    `${i + 1}. vs ${m.b} — ${m.played}${m.played < m.requested ? ` of ${m.requested}` : ''} played: ${recordText(m.record)} → ` +
    `win ${rateText(m.winRate)}; first ${shortRate(m.goingFirst)}, second ${shortRate(m.goingSecond)}`;
  if (detail === 'minimal') return [head];
  const lines = [head];
  const lp = m.lossPatterns;
  const turns = m.avgTurns === null ? '–' : m.avgTurns.toFixed(1);
  lines.push(`   Avg ${turns} turns. Won by ${reasonsText(m.winReasons)}; lost by ${reasonsText(m.lossReasons)}.`);
  if (detail === 'full') {
    lines.push(`   Setup — you ${setupText(m.setup[0])}; them ${setupText(m.setup[1])}.`);
    lines.push(`   Prizes taken by yours: ${prizeRows(m.prizeTakers[0])} | theirs: ${prizeRows(m.prizeTakers[1])}.`);
    lines.push(`   You gave up most Prizes with: ${prizeRows(m.liabilities[0])}.`);
  }
  if (lp.losses) {
    const of = (k: number) => pct(k / lp.losses);
    lines.push(
      `   Your ${lp.losses} loss${lp.losses === 1 ? '' : 'es'}: no attack by T3 ${of(lp.noAttackByTurn3)}, decked out ${of(lp.deckOut)}, ` +
        `no Pokémon left ${of(lp.benchedOut)}, mulliganed ${of(lp.mulliganed)}.`,
    );
  }
  if (m.firstError) lines.push(`   Engine error (game not counted): ${m.firstError}`);
  return lines;
}

function impactLines(r: SimReport, max: number): string[] {
  const rows = r.cardImpact.cards
    .filter((c) => c.played)
    .sort((x, y) => Math.abs(y.played!.deltaPts) - Math.abs(x.played!.deltaPts) || x.card.localeCompare(y.card))
    .slice(0, max);
  if (!rows.length) {
    return [`Card impact: too few games to split any card (needs n≥${r.cardImpact.minN} on each side).`];
  }
  const out = [
    `Card impact, ${r.subject} (all opponents; played by T${r.cardImpact.byTurn} vs not; association, not cause; n≥${r.cardImpact.minN} each side):`,
  ];
  for (const c of rows) {
    const s = c.played!;
    const sign = s.deltaPts > 0 ? '+' : '';
    out.push(`  ${c.card} ${sign}${s.deltaPts} pts: ${pct(s.with.p)} played (n=${s.with.n}) vs ${pct(s.without.p)} not (n=${s.without.n})`);
  }
  return out;
}

export const COVERAGE_KEY = 'Coverage — approx: attacks deal printed damage, effects and Abilities ignored; unplayable: never played.';

/** One deck's coverage line, with at most `maxNames` names per list. */
export function coverageLine(c: DeckCoverage, label: string, maxNames: number): string {
  if (!c.approx.length && !c.none.length) return `  ${label}: all ${c.total} cards fully played.`;
  const names = (xs: { name: string; count: number }[]) => {
    const shown = xs.slice(0, maxNames).map((x) => `${x.count} ${x.name}`);
    return xs.length > maxNames ? `${shown.join(', ')} +${xs.length - maxNames} more` : shown.join(', ');
  };
  const parts = [`${c.covered}/${c.total} fully played`];
  if (c.approx.length) parts.push(`approx ${names(c.approx)}`);
  if (c.none.length) parts.push(`unplayable ${names(c.none)}`);
  return `  ${label}: ${parts.join('; ')}.`;
}

function coverageLines(r: SimReport, maxNames: number): string[] {
  return [COVERAGE_KEY, ...r.coverage.map((c, i) => coverageLine(c, i === 0 ? `${c.deck} (yours)` : `#${i} ${c.deck}`, maxNames))];
}

function render(r: SimReport, detail: Detail, impactMax: number, coverageMax: number): string {
  const n = r.matchups.length;
  const lines: string[] = [];
  lines.push(`SIMULATED BATTLES (not real games) — ${r.subject} vs ${n} opponent${n === 1 ? '' : 's'}`);
  lines.push(
    `${r.gamesPlayed} of ${r.gamesRequested} games played${r.stoppedEarly ? ' (time budget reached: fewer games than asked)' : ''}; ` +
      `seats swapped each pair, so each deck goes first half the time. Pilot: ${r.pilot}. Seed ${r.seed}. Turn cap ${r.maxTurns}. ${(r.elapsedMs / 1000).toFixed(1)} s.`,
  );
  lines.push('Key: [a–b%] = 95% interval; n = decided games (draws, time-outs excluded); T2 = own turn 2; turns count both players.');
  if (r.pilot.includes('random')) lines.push(RANDOM_PILOT_WARNING);
  lines.push(
    `Overall: ${recordText(r.overall.record)} → win ${rateText(r.overall.winRate)}; first ${shortRate(r.overall.goingFirst)}, second ${shortRate(r.overall.goingSecond)}.`,
  );
  lines.push('');
  r.matchups.forEach((m, i) => lines.push(...matchupLines(m, i, detail)));
  lines.push('');
  if (impactMax > 0) lines.push(...impactLines(r, impactMax), '');
  lines.push(...coverageLines(r, coverageMax));
  lines.push('');
  lines.push(`Caveat: ${r.caveat}`);
  return lines.join('\n');
}

/**
 * The report as text, at most `limit` characters. Detail is shed in order —
 * per-matchup setup and Prize lines, then card-impact rows, then a
 * one-line-per-matchup form — and only as a last resort are long coverage
 * lists cut to "+N more" (the structured report always carries them whole).
 */
export function renderReport(r: SimReport, limit = 5000): string {
  const attempts: [Detail, number, number][] = [
    ['full', 6, 99],
    ['compact', 6, 99],
    ['compact', 3, 99],
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
  // Still over (dozens of very long names): keep the head and the caveat, cut the middle.
  const tail = `\n…(cut to fit; the structured report has every row)\nCaveat: ${r.caveat}`;
  return text.slice(0, Math.max(0, limit - tail.length)) + tail;
}
