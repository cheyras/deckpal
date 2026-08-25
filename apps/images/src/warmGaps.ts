import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { LANG, MAX_CONCURRENCY, QUALITIES, type Quality } from './config.js';
import { fetchWebp } from './fetch.js';
import {
  cardAbsolutePath,
  cardCacheKey,
  cardRelativePath,
  cardSourceUrl,
  type CardRef,
} from './layout.js';
import { closePool, getPool } from './assets.js';
import { parallelMap } from './parallel.js';
import { fromUrl, putAsset } from './store.js';

/**
 * warm:gaps — fill card-art gaps the manifest-driven warmer misses.
 *
 * Root cause: `warmer.ts` uses TCGdex's compiled datas.json as its work-list, but
 * datas.json OMITS many promo / energy / trainer-kit sets (mep, svp, smp, tk-*,
 * mc-*) even though the image CDN still serves art for some of them. So this drives
 * off OUR `card` table (the rule from the fill-missing-assets skill: enumerate the
 * work-list from the DB, never the source manifest) and probes the CDN directly.
 *
 * Was `scripts/warm-missing.mjs`, which wrote bytes straight to the cache path and
 * never recorded a manifest row — that script is where most of the 1,970 orphans
 * found on 2026-08-07 came from. It now writes through store.ts `putAsset`, so the
 * bytes and their source URL land together or not at all.
 *
 *   pnpm --filter deckpal-images warm:gaps                   # every card in the DB
 *   pnpm --filter deckpal-images warm:gaps -- --set svp      # one set
 *   pnpm --filter deckpal-images warm:gaps -- --csv gaps.csv # explicit work-list
 *   pnpm --filter deckpal-images warm:gaps -- --dry-run
 *
 * CSV rows (legacy format, still accepted): serie,set,localId[,missHigh,missLow]
 *
 * Only ADDS files; never deletes or evicts. Cards the CDN 404s are genuine upstream
 * gaps and are reported as such — we never invent an asset.
 */

interface Job {
  ref: CardRef;
  quality: Quality;
}

interface Stats {
  considered: number;
  alreadyOnDisk: number;
  warmed: number;
  upstreamGap: number;
  rejected: number;
  errors: number;
  bytes: number;
}

async function jobsFromDb(setFilter?: string): Promise<Job[]> {
  const { rows } = await getPool().query<{
    local_id: string;
    set_id: string;
    serie_id: string;
  }>(
    `SELECT c.local_id, s.tcgdex_id AS set_id, sr.tcgdex_id AS serie_id
       FROM card c
       JOIN card_set s ON s.id = c.set_id
       JOIN series  sr ON sr.id = s.series_id
      WHERE c.lang = $1
        AND ($2::text IS NULL OR s.tcgdex_id = $2)
      ORDER BY sr.tcgdex_id, s.tcgdex_id, c.local_id`,
    [LANG, setFilter ?? null],
  );
  const jobs: Job[] = [];
  for (const r of rows) {
    const ref: CardRef = { serie: r.serie_id, set: r.set_id, localId: r.local_id };
    for (const q of QUALITIES) jobs.push({ ref, quality: q });
  }
  return jobs;
}

async function jobsFromCsv(path: string, setFilter?: string): Promise<Job[]> {
  const text = await readFile(path, 'utf-8');
  const jobs: Job[] = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    const [serie, set, localId, missHigh, missLow] = t.split(',');
    if (!serie || !set || !localId) continue;
    if (setFilter && set !== setFilter) continue;
    const ref: CardRef = { serie, set, localId };
    // Legacy CSV carried per-quality flags; with no flags, consider both.
    const flagged = missHigh !== undefined || missLow !== undefined;
    if (!flagged) {
      for (const q of QUALITIES) jobs.push({ ref, quality: q });
    } else {
      if (missHigh === '1') jobs.push({ ref, quality: 'high' });
      if (missLow === '1') jobs.push({ ref, quality: 'low' });
    }
  }
  return jobs;
}

async function runJob(j: Job, st: Stats, dryRun: boolean, knownGaps: Set<string>): Promise<void> {
  st.considered++;
  const abs = cardAbsolutePath(j.ref, j.quality);
  if (existsSync(abs)) {
    st.alreadyOnDisk++;
    return;
  }
  const key = `${j.ref.serie}/${j.ref.set}/${j.ref.localId}/${j.quality}`;
  if (knownGaps.has(key)) {
    st.upstreamGap++;
    return;
  }
  if (dryRun) return;

  const url = cardSourceUrl(j.ref, j.quality);
  const result = await fetchWebp(url, null);
  switch (result.status) {
    case 'ok':
      // THE CHOKE POINT: bytes + provenance, together or not at all.
      await putAsset({
        cacheKey: cardCacheKey(j.ref, j.quality),
        kind: 'card',
        relativePath: cardRelativePath(j.ref, j.quality),
        bytes: result.body,
        provenance: fromUrl(url, result.etag),
      });
      st.warmed++;
      st.bytes += result.body.length;
      break;
    // No 'not-modified' case: the fetch above sends no etag, so a 304 cannot happen.
    case 'rejected':
      // content-type/magic-byte failure — the soft-404 trap. A genuine gap.
      st.rejected++;
      break;
    case 'error':
      if (result.httpStatus === 404) {
        st.upstreamGap++;
      } else {
        st.errors++;
        process.stderr.write(`[warm:gaps] ERROR ${url}: ${result.reason}\n`);
      }
      break;
  }
}

export interface WarmGapsOptions {
  set?: string;
  csv?: string;
  dryRun?: boolean;
  /** Newline-delimited "serie/set/localId/quality" keys known to 404 — skip them. */
  gapFile?: string;
  limit?: number;
}

export async function warmGaps(opts: WarmGapsOptions = {}): Promise<Stats> {
  const jobs = opts.csv
    ? await jobsFromCsv(opts.csv, opts.set)
    : await jobsFromDb(opts.set);
  const work = opts.limit && opts.limit > 0 ? jobs.slice(0, opts.limit) : jobs;

  const knownGaps = new Set<string>();
  if (opts.gapFile && existsSync(opts.gapFile)) {
    for (const l of (await readFile(opts.gapFile, 'utf-8')).split('\n')) {
      if (l.trim()) knownGaps.add(l.trim());
    }
    process.stderr.write(`[warm:gaps] ${knownGaps.size} known gaps loaded\n`);
  }

  const st: Stats = {
    considered: 0,
    alreadyOnDisk: 0,
    warmed: 0,
    upstreamGap: 0,
    rejected: 0,
    errors: 0,
    bytes: 0,
  };

  await parallelMap(work, MAX_CONCURRENCY, async (j) => {
    await runJob(j, st, opts.dryRun ?? false, knownGaps);
    if (st.considered % 200 === 0) {
      process.stderr.write(
        `[warm:gaps] ${st.considered}/${work.length} warmed=${st.warmed} gap=${st.upstreamGap}\n`,
      );
    }
  });

  process.stderr.write(
    `[warm:gaps] done. considered=${st.considered} already-on-disk=${st.alreadyOnDisk} ` +
      `warmed=${st.warmed} upstream-gap=${st.upstreamGap} rejected=${st.rejected} ` +
      `errors=${st.errors} bytes=${st.bytes}\n`,
  );
  return st;
}

// ── CLI ─────────────────────────────────────────────────────────────────────
function parseArgs(argv: string[]): WarmGapsOptions {
  const o: WarmGapsOptions = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--set') o.set = argv[++i];
    else if (a === '--csv') o.csv = argv[++i];
    else if (a === '--gapfile') o.gapFile = argv[++i];
    else if (a === '--limit') o.limit = Number(argv[++i]);
    else if (a === '--dry-run') o.dryRun = true;
  }
  return o;
}

const entryPath = process.env.pm_exec_path ?? process.argv[1] ?? '';
const isMain = entryPath.endsWith('warmGaps.js') || entryPath.endsWith('warmGaps.ts');
if (isMain) {
  try {
    await warmGaps(parseArgs(process.argv.slice(2)));
  } catch (err) {
    process.stderr.write(`[warm:gaps] fatal: ${(err as Error).message}\n`);
    await closePool().catch(() => undefined);
    process.exit(1);
  }
  await closePool().catch(() => undefined);
  process.exit(0);
}
