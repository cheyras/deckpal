import { readFileSync } from 'node:fs';

/**
 * warm:cloud:summary — turn a `warm:cloud` residue file into a GitHub job
 * summary, and (given a baseline) tell a REGRESSION apart from a KNOWN gap.
 *
 * ── Why this exists (issue #24, reopened 2026-09-26) ────────────────────────
 * `warm:cloud` already prints its residue to the console and writes it to
 * `--residue` (cloudWarm.ts) -- and has since 2026-08-26. Nothing ever READ that
 * file after the run that produced it. So when MEP grew 60 -> 89 cards and the 29
 * new cards had no art on any approved source, the residue count went up in a
 * file nobody was looking at, and the regression surfaced three weeks later as a
 * reopened bug report instead of as a number changing in CI. `catalog-refresh.yml`
 * has the identical shape: it EXISTS because "sets do not stop growing at release"
 * had already cost 17 days of silent drift once (DECISIONS.md 2026-08-10, issue
 * #21) before its own job summary was built. This is the same fix for the image
 * side of that exact failure mode.
 *
 * ── What it does NOT do ──────────────────────────────────────────────────────
 * It does not fetch anything, write any bytes, or touch the provenance choke
 * point (B1) -- it only reads the residue JSON `warm:cloud` already wrote and
 * renders it. A card in the residue is not necessarily a bug: TCGdex and
 * pokemontcg.io -- the two approved sources (`packages/storage/src/upstream.ts`)
 * -- genuinely do not have art for some cards (see `research/CARD-ART-SOURCES.md`).
 * The point of this report is to make that STATE observable and its CHANGES
 * loud, not to imply every row is actionable.
 */

export interface ResidueEntry {
  category: 'card' | 'set';
  setId: string;
  cardId: string;
  key: string;
  reason: string;
}

export interface ResidueDiff {
  /** In `current` but not in `baseline` -- a set grew, or something regressed. */
  newGaps: ResidueEntry[];
  /** In `baseline` but not in `current` -- warmed since, or the card was removed. */
  resolved: ResidueEntry[];
}

/**
 * Diff two residue snapshots by `key` -- the request path (e.g.
 * `/deckpal/images/en/me/mep/087/low.webp`), which is stable across runs and
 * unique per asset+quality, unlike array position.
 */
export function diffResidue(baseline: ResidueEntry[], current: ResidueEntry[]): ResidueDiff {
  const baseKeys = new Set(baseline.map((r) => r.key));
  const curKeys = new Set(current.map((r) => r.key));
  return {
    newGaps: current.filter((r) => !baseKeys.has(r.key)),
    resolved: baseline.filter((r) => !curKeys.has(r.key)),
  };
}

function countBySet(entries: ResidueEntry[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of entries) m.set(e.setId, (m.get(e.setId) ?? 0) + 1);
  return m;
}

function table(counts: Map<string, number>, limit: number): string[] {
  const rows = [...counts].sort((a, b) => b[1] - a[1]).slice(0, limit);
  if (rows.length === 0) return ['_none_'];
  const L = ['| set | count |', '|---|---|'];
  for (const [setId, n] of rows) L.push(`| \`${setId}\` | ${n} |`);
  return L;
}

export interface SummaryInput {
  /** Deployment the sweep ran against, for the header only. */
  base: string;
  current: ResidueEntry[];
  /** The previous run's residue, or `null`/`undefined` when there is none yet
   * (first run, or the cache lapsed) -- the summary degrades to a snapshot. */
  baseline?: ResidueEntry[] | null;
}

/** Markdown for `$GITHUB_STEP_SUMMARY`. Pure, so it is provable without a network call. */
export function summarizeWarmResidue({ base, current, baseline }: SummaryInput): string {
  const L: string[] = [];
  L.push('## Image warm — residue');
  L.push('');
  L.push(
    `Swept \`${base}\`: **${current.length}** asset(s) an approved source could not fill this run.`,
  );
  L.push('');

  if (baseline == null) {
    L.push(
      '_No baseline for this run (first run, or the cached baseline expired) -- this is a ' +
        'point-in-time count, not a comparison._',
    );
  } else {
    const { newGaps, resolved } = diffResidue(baseline, current);
    if (newGaps.length === 0) {
      L.push(
        `No new gaps since the last recorded baseline (${baseline.length} known)` +
          (resolved.length > 0 ? `; **${resolved.length}** resolved since then.` : '.'),
      );
    } else {
      L.push(`### ⚠ ${newGaps.length} new gap(s) since the last baseline`);
      L.push('');
      L.push(
        'These assets warmed clean last run and answer the placeholder now, or are new rows ' +
          "that never got checked -- exactly the shape of issue #24's regression: a set grew, or " +
          'an upstream asset stopped being fetchable, and nothing re-warmed it.',
      );
      L.push('');
      L.push(...table(countBySet(newGaps), 15));
      if (resolved.length > 0) {
        L.push('');
        L.push(`${resolved.length} previously-recorded gap(s) resolved since the baseline.`);
      }
    }
  }

  L.push('');
  L.push('### Current residue by set (top 15)');
  L.push('');
  L.push(...table(countBySet(current), 15));
  L.push('');
  L.push(
    '_A row here is not automatically a bug -- see `research/CARD-ART-SOURCES.md` for which ' +
      'gaps are documented as having no approved source. This report exists so a NEW one is ' +
      'never invisible again, not to imply every row is actionable._',
  );
  return L.join('\n');
}

// ── CLI ──────────────────────────────────────────────────────────────────────
//   node --import tsx src/cloudWarmSummary.ts --residue <path> [--baseline <path>] [--base <url>] [--gate]
//
// Prints markdown to stdout (a workflow redirects it to $GITHUB_STEP_SUMMARY);
// `--gate` instead exits 1 with a `::error::` annotation when new gaps exist
// against a supplied baseline, and is a deliberate no-op (exit 0) with no
// baseline -- there is nothing to regress against on a first run.
function readResidue(path: string): ResidueEntry[] {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'));
  if (!Array.isArray(parsed)) throw new Error(`${path} is not a residue array`);
  return parsed as ResidueEntry[];
}

function parseArgs(argv: string[]): { residue: string; baseline: string | null; base: string; gate: boolean } {
  const get = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i === -1 ? undefined : argv[i + 1];
  };
  const residue = get('residue');
  if (!residue) throw new Error('--residue <path> is required');
  return {
    residue,
    baseline: get('baseline') ?? null,
    base: get('base') ?? 'https://deckpal.app',
    gate: argv.includes('--gate'),
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const current = readResidue(args.residue);
  let baseline: ResidueEntry[] | null = null;
  if (args.baseline) {
    try {
      baseline = readResidue(args.baseline);
    } catch {
      baseline = null; // missing/unreadable baseline degrades to "no comparison", never a failure
    }
  }

  if (args.gate) {
    if (baseline === null) process.exit(0);
    const { newGaps } = diffResidue(baseline, current);
    if (newGaps.length === 0) process.exit(0);
    const bySet = [...countBySet(newGaps)].sort((a, b) => b[1] - a[1]);
    const list = bySet.map(([setId, n]) => `${setId}:${n}`).join(', ');
    process.stderr.write(
      `::error title=New card-art gaps since the last warm::` +
        `${newGaps.length} asset(s) newly serve the placeholder (${list}). ` +
        `See the job summary for the full breakdown.\n`,
    );
    process.exit(1);
  }

  process.stdout.write(summarizeWarmResidue({ base: args.base, current, baseline }) + '\n');
}

// Only run the CLI when this file is the entry point, so tests can import the
// pure functions above without triggering it (same guard cloudWarm.ts and
// rekeySet.ts do not need, since they have no importable pure core today).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err: unknown) => {
    console.error('[warm:cloud:summary]', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
