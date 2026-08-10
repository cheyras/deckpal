import { existsSync } from 'node:fs';
import { appendFile, readFile } from 'node:fs/promises';
import { LANG, MAX_CONCURRENCY, QUALITIES, type Quality } from './config.js';
import { headAsset } from './fetch.js';
import {
  cardCacheKey,
  cardSourceUrl,
  setImageCacheKey,
  type CardRef,
  type SetImageKind,
} from './layout.js';
import { closePool, getPool, upsertImageObject } from './assets.js';
import { ensureRecorded, fromUrl, sniffFile, unknownProvenance, type Provenance } from './store.js';
import { checkManifest } from './manifestCheck.js';
import { absoluteFromRelative } from './layout.js';
import { stat } from 'node:fs/promises';

/**
 * manifest:backfill — give every un-recorded file in the image cache a manifest
 * row, with HONEST provenance.
 *
 * Written for the 1,970 orphans found on 2026-08-07: files that ad-hoc gap-fill
 * scripts wrote straight to the cache path without recording where they came
 * from. Re-runnable and safe on a clean cache (it just finds nothing to do).
 *
 * How provenance is decided — and the rule is CONFIRM, NEVER GUESS:
 *
 *   1. Reconstruct the canonical upstream URL from the cache path (the path is a
 *      pure function of that URL — layout.ts).
 *   2. HEAD it. If the origin serves an image there, the asset is attested at that
 *      URL and we record it as the source.
 *   3. If the origin 404s, errors, or serves a non-image, we DO NOT record a URL.
 *      The row gets `source_url = NULL` — provenance honestly unknown. A
 *      plausible-looking URL that nobody verified is worse than an honest blank:
 *      it would make `manifest:check` report full coverage over a fiction.
 *
 * Never touches image bytes — metadata only, additive.
 *
 *   pnpm --filter deckscout-images manifest:backfill -- --dry-run
 *   pnpm --filter deckscout-images manifest:backfill
 *   pnpm --filter deckscout-images manifest:backfill -- --probe-cache probe.tsv
 *   pnpm --filter deckscout-images manifest:backfill -- --disk-tier
 *
 * `--disk-tier` is a different job in the same file: it fills the per-tier
 * `image_object` rows migration 025 added (see `backfillDiskTier`), rather than
 * hunting orphans. Run it once on an existing cache; it is idempotent after that.
 *
 * `--probe-cache <file>` memoises HEAD results (TSV: relPath, status, contentType,
 * contentLength) so a re-run does not re-hit the origin. It is appended to as the
 * run proceeds, which also makes an interrupted run resumable.
 *
 * Connection budget: ONE connection via the shared images pool, closed in a finally.
 */

type Decision = 'confirmed' | 'unknown';

interface OrphanPlan {
  relativePath: string;
  cacheKey: string;
  kind: 'card' | 'set-logo' | 'set-symbol';
  candidateUrl: string | null;
  /** null until probed. */
  decision?: Decision;
  reason?: string;
  serie?: string;
  /** The file sits under a serie directory the catalog disagrees with. */
  staleDuplicate?: boolean;
}

/**
 * `cardCacheKey` is `card:<setId>-<localId>:<quality>` — it does NOT include the
 * serie, because a set belongs to exactly one serie. The cache, however, can hold
 * the SAME set under two serie directories when an earlier pass wrote it to the
 * wrong one (found 2026-08-07: `dv1` under both bw/ and dp/, `me02.5` under both
 * me/ and sv/). Those collide on the primary key, and recording them naively makes
 * the canonical row point at whichever file was processed last.
 *
 * So: the catalog decides. A file under the set's catalog serie gets the canonical
 * key; a file under any other serie directory is a STALE DUPLICATE and is recorded
 * under its own path-derived key, so it is documented without stealing the real
 * card's row. Stale duplicates are dead weight — safe to delete once a human says so.
 */
export const staleDuplicateKey = (relativePath: string): string =>
  `stale-duplicate:${relativePath}`;

/** setId → the serie the catalog says it belongs to. */
async function catalogSeries(): Promise<Map<string, string>> {
  const { rows } = await getPool().query<{ set_id: string; serie_id: string }>(
    `SELECT s.tcgdex_id AS set_id, sr.tcgdex_id AS serie_id
       FROM card_set s JOIN series sr ON sr.id = s.series_id`,
  );
  return new Map(rows.map((r) => [r.set_id, r.serie_id]));
}

const CARD_RE = /^images\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)\.(low|high)\.webp$/;
const SET_RE = /^sets\/([^/]+)\/(logo|symbol)\.webp$/;

/**
 * Map a cache-relative path back to its cache key, kind and candidate source URL.
 * Returns null for paths that are not a recognised cache asset — those get
 * recorded as unknown rather than silently skipped.
 */
export function planForPath(rel: string, catalog?: Map<string, string>): OrphanPlan | null {
  const card = CARD_RE.exec(rel);
  if (card) {
    const [, lang, serie, set, localId, quality] = card as unknown as [
      string,
      string,
      string,
      string,
      string,
      Quality,
    ];
    if (lang !== LANG || !QUALITIES.includes(quality)) return null;
    const ref: CardRef = { serie, set, localId };
    // If the catalog puts this set under a DIFFERENT serie, this file is a stray
    // copy at a path the app never serves — record it under its own key rather
    // than letting it hijack the real card's row. See `staleDuplicateKey`.
    const catalogSerie = catalog?.get(set);
    const stale = catalogSerie !== undefined && catalogSerie !== serie;
    if (stale) {
      return {
        relativePath: rel,
        cacheKey: staleDuplicateKey(rel),
        kind: 'card',
        candidateUrl: null,
        decision: 'unknown',
        reason:
          `stale duplicate: the catalog puts set '${set}' under serie '${catalogSerie}', ` +
          `not '${serie}', so nothing serves this path and its origin was never recorded`,
        serie: `${serie} (stale dup of ${catalogSerie})`,
        staleDuplicate: true,
      };
    }
    return {
      relativePath: rel,
      cacheKey: cardCacheKey(ref, quality),
      kind: 'card',
      candidateUrl: cardSourceUrl(ref, quality),
      serie,
    };
  }
  const set = SET_RE.exec(rel);
  if (set) {
    const [, setId, kind] = set as unknown as [string, string, SetImageKind];
    return {
      relativePath: rel,
      cacheKey: setImageCacheKey(setId, kind),
      kind: kind === 'logo' ? 'set-logo' : 'set-symbol',
      // Set imagery lives at a base URL stored in card_set, not derivable from the
      // path — so there is nothing to reconstruct and nothing to confirm.
      candidateUrl: null,
      serie: `sets/${kind}`,
    };
  }
  return null;
}

interface ProbeRow {
  status: number;
  contentType: string | null;
  contentLength: number | null;
}

async function loadProbeCache(path?: string): Promise<Map<string, ProbeRow>> {
  const m = new Map<string, ProbeRow>();
  if (!path || !existsSync(path)) return m;
  for (const line of (await readFile(path, 'utf-8')).split('\n')) {
    if (!line.trim()) continue;
    const [rel, , status, ct, len] = line.split('\t');
    if (!rel || status === undefined) continue;
    m.set(rel, {
      status: Number(status),
      contentType: ct || null,
      contentLength: len ? Number(len) : null,
    });
  }
  return m;
}

export interface BackfillOptions {
  dryRun?: boolean;
  probeCache?: string;
  limit?: number;
}

/**
 * Run `backfill` until it converges.
 *
 * One pass is not always enough: repointing a canonical row onto the
 * catalog-correct file orphans whatever that row used to point at, and that new
 * orphan only shows up on the next scan. Each pass strictly reduces the orphan
 * count, so this terminates; `maxPasses` is a guard against a bug, not a
 * expected limit.
 */
export async function backfillUntilStable(
  opts: BackfillOptions = {},
  maxPasses = 5,
): Promise<BackfillReport[]> {
  const passes: BackfillReport[] = [];
  for (let i = 0; i < maxPasses; i++) {
    const r = await backfill(opts);
    passes.push(r);
    if (r.orphansFound === 0 || opts.dryRun) break;
    process.stderr.write(
      `[backfill] pass ${i + 1}: ${r.recorded} recorded; rescanning for new orphans …\n`,
    );
  }
  return passes;
}

export interface BackfillReport {
  orphansFound: number;
  confirmed: number;
  unknown: number;
  recorded: number;
  /** Of `unknown`: files at a serie path the catalog disagrees with. */
  staleDuplicates: string[];
  bySerieConfirmed: Record<string, number>;
  bySerieUnknown: Record<string, number>;
  byContentType: Record<string, number>;
  failures: Array<{ relativePath: string; error: string }>;
}

export async function backfill(opts: BackfillOptions = {}): Promise<BackfillReport> {
  // Reuse the drift check as the source of truth for "what is an orphan".
  const drift = await checkManifest();
  let orphans = drift.orphans;
  if (opts.limit && opts.limit > 0) orphans = orphans.slice(0, opts.limit);

  process.stderr.write(
    `[backfill] ${drift.diskFiles} files on disk, ${drift.manifestRows} rows, ` +
      `${drift.orphans.length} orphans${opts.limit ? ` (limited to ${orphans.length})` : ''}\n`,
  );

  const probeCache = await loadProbeCache(opts.probeCache);
  if (probeCache.size) {
    process.stderr.write(`[backfill] ${probeCache.size} cached probe results loaded\n`);
  }

  const report: BackfillReport = {
    orphansFound: drift.orphans.length,
    confirmed: 0,
    unknown: 0,
    recorded: 0,
    staleDuplicates: [],
    bySerieConfirmed: {},
    bySerieUnknown: {},
    byContentType: {},
    failures: [],
  };

  // The catalog settles which serie directory is real when a set appears twice.
  const catalog = await catalogSeries();

  // ── stage 1: decide provenance for each orphan (network, bounded + polite) ──
  const plans: OrphanPlan[] = [];
  for (const rel of orphans) {
    const p = planForPath(rel, catalog);
    plans.push(
      p ?? {
        relativePath: rel,
        cacheKey: `unrecognised:${rel}`,
        kind: 'card',
        candidateUrl: null,
        decision: 'unknown',
        reason: 'path does not match any known cache layout',
        serie: '(unrecognised)',
      },
    );
  }

  let idx = 0;
  let probed = 0;
  const decide = async (p: OrphanPlan): Promise<void> => {
    if (p.decision) return; // already settled (unrecognised path)
    if (!p.candidateUrl) {
      p.decision = 'unknown';
      p.reason = 'no upstream URL is derivable from this cache path';
      return;
    }
    let row = probeCache.get(p.relativePath);
    if (!row) {
      const h = await headAsset(p.candidateUrl);
      row = { status: h.status, contentType: h.contentType, contentLength: h.contentLength };
      probed++;
      if (opts.probeCache) {
        await appendFile(
          opts.probeCache,
          `${p.relativePath}\t\t${row.status}\t${row.contentType ?? ''}\t${row.contentLength ?? ''}\n`,
        );
      }
    }
    if (row.status === 200 && (row.contentType ?? '').toLowerCase().startsWith('image/')) {
      p.decision = 'confirmed';
    } else {
      p.decision = 'unknown';
      p.reason =
        row.status === 0
          ? 'could not reach the origin to confirm the canonical URL'
          : `origin does not serve the canonical URL (HTTP ${row.status}` +
            `${row.contentType ? `, ${row.contentType}` : ''})`;
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(MAX_CONCURRENCY, plans.length) }, async () => {
      while (idx < plans.length) {
        const my = idx++;
        await decide(plans[my]!);
        if (probed > 0 && probed % 200 === 0) {
          process.stderr.write(`[backfill] probed ${probed} …\n`);
        }
      }
    }),
  );

  // ── stage 2: record ──
  for (const p of plans) {
    const serie = p.serie ?? '(unknown)';
    if (p.decision === 'confirmed') {
      report.confirmed++;
      report.bySerieConfirmed[serie] = (report.bySerieConfirmed[serie] ?? 0) + 1;
    } else {
      report.unknown++;
      report.bySerieUnknown[serie] = (report.bySerieUnknown[serie] ?? 0) + 1;
      if (p.staleDuplicate) report.staleDuplicates.push(p.relativePath);
    }
    if (opts.dryRun) continue;
    if (p.cacheKey.startsWith('unrecognised:')) {
      report.failures.push({
        relativePath: p.relativePath,
        error: 'no cache key could be derived — left unrecorded, investigate by hand',
      });
      continue;
    }
    const provenance: Provenance =
      p.decision === 'confirmed'
        ? fromUrl(p.candidateUrl!)
        : unknownProvenance(p.reason ?? 'provenance could not be established');
    try {
      const res = await ensureRecorded({
        cacheKey: p.cacheKey,
        kind: p.kind,
        relativePath: p.relativePath,
        fallbackProvenance: provenance,
      });
      report.recorded++;
      report.byContentType[res.contentType] = (report.byContentType[res.contentType] ?? 0) + 1;
    } catch (err) {
      report.failures.push({ relativePath: p.relativePath, error: (err as Error).message });
    }
  }

  return report;
}

// ── Disk-tier rows (migration 025) ───────────────────────────────────────────
export interface DiskTierReport {
  manifestRows: number;
  measured: number;
  recorded: number;
  alreadyRecorded: number;
  missingFiles: number;
  failures: Array<{ relativePath: string; error: string }>;
}

/**
 * `--disk-tier`: give every recorded asset an `image_object(tier='disk')` row.
 *
 * The one-time step migration 025 deliberately does NOT do for you: only the
 * operator knows whether this database's `image_asset` rows describe files on
 * THIS machine's disk (true for a self-host box; false for a cloud database that
 * imported the manifest), and writing 47,924 rows asserting a disk that isn't
 * there would be a lie the checker would then confirm.
 *
 * Every row is MEASURED, never copied from `image_asset.byte_size`. Copying would
 * make the disk tier agree with the manifest by construction and quietly destroy
 * the check's ability to detect that they had diverged. Rows whose file is absent
 * are skipped and counted — `manifest:check` already reports those as missing
 * files, and inventing a size for a file that is not there is exactly the failure
 * this whole subsystem exists to prevent.
 *
 * Idempotent and resumable: re-running measures again and upserts the same values.
 */
export async function backfillDiskTier(opts: { dryRun?: boolean } = {}): Promise<DiskTierReport> {
  const { rows } = await getPool().query<{
    cache_key: string;
    relative_path: string;
    has_tier: boolean;
  }>(
    `SELECT a.cache_key, a.relative_path,
            EXISTS (SELECT 1 FROM image_object o
                     WHERE o.cache_key = a.cache_key AND o.tier = 'disk') AS has_tier
       FROM image_asset a
      ORDER BY a.relative_path`,
  );

  const report: DiskTierReport = {
    manifestRows: rows.length,
    measured: 0,
    recorded: 0,
    alreadyRecorded: 0,
    missingFiles: 0,
    failures: [],
  };

  for (const r of rows) {
    if (r.has_tier) report.alreadyRecorded++;
    const abs = absoluteFromRelative(r.relative_path);
    let size: number;
    try {
      const st = await stat(abs);
      if (!st.isFile() || st.size === 0) {
        report.missingFiles++;
        continue;
      }
      size = st.size;
    } catch {
      report.missingFiles++;
      continue;
    }
    report.measured++;
    if (opts.dryRun) continue;
    try {
      const contentType = await sniffFile(abs, size);
      await upsertImageObject({
        cacheKey: r.cache_key,
        tier: 'disk',
        byteSize: size,
        contentType,
        // A POSIX filesystem assigns no entity tag; an honest null beats a
        // fabricated one (the same rule source_url follows).
        etag: null,
      });
      report.recorded++;
      if (report.recorded % 5000 === 0) {
        process.stderr.write(`[backfill] disk tier: ${report.recorded} rows recorded …\n`);
      }
    } catch (err) {
      report.failures.push({ relativePath: r.relative_path, error: (err as Error).message });
    }
  }
  return report;
}

function mergeCounts(
  a: Record<string, number>,
  b: Record<string, number>,
): Record<string, number> {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = (out[k] ?? 0) + v;
  return out;
}

function table(rec: Record<string, number>): string {
  const rows = Object.entries(rec).sort((a, b) => b[1] - a[1]);
  if (!rows.length) return '      (none)';
  return rows.map(([k, v]) => `      ${String(v).padStart(6)}  ${k}`).join('\n');
}

// ── CLI ─────────────────────────────────────────────────────────────────────
const entryPath = process.env.pm_exec_path ?? process.argv[1] ?? '';
const isMain =
  entryPath.endsWith('manifestBackfill.js') || entryPath.endsWith('manifestBackfill.ts');
if (isMain) {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const diskTier = argv.includes('--disk-tier');
  const pcIdx = argv.indexOf('--probe-cache');
  const probeCache = pcIdx > -1 ? argv[pcIdx + 1] : undefined;
  const limIdx = argv.indexOf('--limit');
  const limit = limIdx > -1 ? Number(argv[limIdx + 1]) : undefined;

  let code = 1;
  try {
    if (diskTier) {
      const r = await backfillDiskTier({ dryRun });
      process.stdout.write(
        [
          '',
          `disk-tier backfill (image_object tier='disk')${dryRun ? ' — DRY RUN, nothing written' : ''}`,
          `  image_asset rows       : ${r.manifestRows}`,
          `  files measured on disk : ${r.measured}`,
          `  rows recorded          : ${r.recorded}`,
          `  already had a row      : ${r.alreadyRecorded}`,
          `  files absent (skipped) : ${r.missingFiles}   (manifest:check reports these separately)`,
          `  failures               : ${r.failures.length}`,
          ...r.failures.slice(0, 20).map((f) => `      ${f.relativePath}: ${f.error}`),
          '',
        ].join('\n'),
      );
      code = r.failures.length ? 1 : 0;
    } else {
    const passes = await backfillUntilStable({ dryRun, probeCache, limit });
    const r: BackfillReport = passes.reduce((acc, p) => ({
      orphansFound: acc.orphansFound + p.orphansFound,
      confirmed: acc.confirmed + p.confirmed,
      unknown: acc.unknown + p.unknown,
      recorded: acc.recorded + p.recorded,
      staleDuplicates: [...acc.staleDuplicates, ...p.staleDuplicates],
      bySerieConfirmed: mergeCounts(acc.bySerieConfirmed, p.bySerieConfirmed),
      bySerieUnknown: mergeCounts(acc.bySerieUnknown, p.bySerieUnknown),
      byContentType: mergeCounts(acc.byContentType, p.byContentType),
      failures: [...acc.failures, ...p.failures],
    }));
    if (passes.length > 1) {
      process.stderr.write(`[backfill] converged after ${passes.length} passes\n`);
    }
    const L = [
      '',
      `manifest backfill${dryRun ? ' (DRY RUN — nothing written)' : ''}`,
      `  orphans found          : ${r.orphansFound}`,
      `  provenance CONFIRMED   : ${r.confirmed}   (origin serves the canonical URL)`,
      `  provenance UNKNOWN     : ${r.unknown}   (source_url NULL — never guessed)`,
      `  rows recorded          : ${r.recorded}`,
      '',
      '  confirmed by series:',
      table(r.bySerieConfirmed),
      '',
      '  unknown by series:',
      table(r.bySerieUnknown),
      '',
      '  recorded content types (sniffed from the bytes, not the extension):',
      table(r.byContentType),
    ];
    if (r.staleDuplicates.length) {
      L.push(
        '',
        `  STALE DUPLICATES: ${r.staleDuplicates.length} file(s) sit under a serie directory the`,
        '  catalog disagrees with, so nothing serves them. They are now recorded (keys prefixed',
        '  `stale-duplicate:`) so the manifest is complete, but they are dead weight and safe to',
        '  delete once a human confirms. Bytes were NOT touched here. Examples:',
      );
      for (const f of r.staleDuplicates.slice(0, 6)) L.push(`      ${f}`);
      if (r.staleDuplicates.length > 6) {
        L.push(`      … and ${r.staleDuplicates.length - 6} more`);
      }
    }
    if (r.failures.length) {
      L.push('', `  FAILURES (${r.failures.length}):`);
      for (const f of r.failures.slice(0, 20)) L.push(`      ${f.relativePath}: ${f.error}`);
    }
    L.push('');
    process.stdout.write(L.join('\n') + '\n');
    code = r.failures.length ? 1 : 0;
    }
  } catch (err) {
    process.stderr.write(`[backfill] fatal: ${(err as Error).message}\n`);
    code = 1;
  } finally {
    await closePool().catch(() => undefined);
  }
  process.exit(code);
}
