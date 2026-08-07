import { existsSync } from 'node:fs';
import { fetchWebp } from './fetch.js';
import {
  setImageAbsolutePath,
  setImageCacheKey,
  setImageRelativePath,
  setImageSourceUrl,
  type SetImageKind,
} from './layout.js';
import { closePool, getStoredEtag, listSetImageSources } from './assets.js';
import { ensureRecorded, fromUrl, putAsset } from './store.js';

/**
 * Set-imagery warmer. The card warmer walks datas.json (a CARD-only manifest), so
 * set logos/symbols were never cached — this closes that gap (the primary "empty"
 * cause). The work-list is card_set.{logo_url,symbol_url}; the upstream asset is the
 * stored base URL + '.webp' (DATA-LAYER §3.4). ~326 fetches total.
 *
 * Same politeness/safety as the card warmer: the fetcher gate (≤5 req/s, ≤2
 * concurrent, If-None-Match) is the limiter; content-type + RIFF/WEBP validated so
 * the soft-404 HTML trap (200 + text/html) is never written; resumable (skips files
 * already on disk); idempotent (ON CONFLICT upsert). INVOCABLE, never auto-run.
 */

interface Task {
  setId: string;
  kind: SetImageKind;
  baseUrl: string;
  cacheKey: string;
}

interface Stats {
  seen: number;
  fetched: number;
  skippedDisk: number;
  recordedFromDisk: number;
  notModified: number;
  rejected: number;
  errors: number;
  logos: number;
  symbols: number;
  bytes: number;
}

async function buildTasks(): Promise<Task[]> {
  const rows = await listSetImageSources();
  const tasks: Task[] = [];
  for (const r of rows) {
    if (r.logo_url) {
      tasks.push({ setId: r.set_id, kind: 'logo', baseUrl: r.logo_url, cacheKey: setImageCacheKey(r.set_id, 'logo') });
    }
    if (r.symbol_url) {
      tasks.push({ setId: r.set_id, kind: 'symbol', baseUrl: r.symbol_url, cacheKey: setImageCacheKey(r.set_id, 'symbol') });
    }
  }
  return tasks;
}

async function runTask(t: Task, st: Stats, dryRun: boolean): Promise<void> {
  st.seen++;
  const absPath = setImageAbsolutePath(t.setId, t.kind);
  const relPath = setImageRelativePath(t.setId, t.kind);
  const url = setImageSourceUrl(t.baseUrl);
  const kindTag = t.kind === 'logo' ? 'set-logo' : 'set-symbol';

  // Resumable: never re-fetch a file already on disk (assets are immutable).
  // Self-heal a torn write without restating provenance we didn't establish —
  // see store.ts `ensureRecorded`.
  if (existsSync(absPath)) {
    st.skippedDisk++;
    if (!dryRun) {
      await ensureRecorded({
        cacheKey: t.cacheKey,
        kind: kindTag,
        relativePath: relPath,
        fallbackProvenance: fromUrl(url),
      });
      st.recordedFromDisk++;
    }
    return;
  }

  if (dryRun) return;

  const etag = await getStoredEtag(t.cacheKey);
  const result = await fetchWebp(url, etag);
  switch (result.status) {
    case 'ok': {
      await putAsset({
        cacheKey: t.cacheKey,
        kind: kindTag,
        relativePath: relPath,
        bytes: result.body,
        provenance: fromUrl(url, result.etag),
      });
      st.fetched++;
      st.bytes += result.body.length;
      if (t.kind === 'logo') st.logos++;
      else st.symbols++;
      break;
    }
    case 'not-modified':
      st.notModified++;
      break;
    case 'rejected':
      st.rejected++;
      process.stderr.write(`[set-warmer] REJECT ${url}: ${result.reason}\n`);
      break;
    case 'error':
      st.errors++;
      process.stderr.write(`[set-warmer] ERROR ${url}: ${result.reason}\n`);
      break;
  }
}

async function parallelMap(tasks: Task[], width: number, fn: (t: Task) => Promise<void>): Promise<void> {
  let idx = 0;
  const workers = Array.from({ length: Math.min(width, tasks.length) }, async () => {
    while (idx < tasks.length) {
      const my = idx++;
      await fn(tasks[my]!);
    }
  });
  await Promise.all(workers);
}

export interface SetWarmOptions {
  dryRun?: boolean;
}

export async function warmSets(opts: SetWarmOptions = {}): Promise<Stats> {
  const tasks = await buildTasks();
  const st: Stats = {
    seen: 0,
    fetched: 0,
    skippedDisk: 0,
    recordedFromDisk: 0,
    notModified: 0,
    rejected: 0,
    errors: 0,
    logos: 0,
    symbols: 0,
    bytes: 0,
  };
  await parallelMap(tasks, 2, (t) => runTask(t, st, opts.dryRun ?? false));
  process.stderr.write(
    `[set-warmer] done. tasks=${tasks.length} seen=${st.seen} fetched=${st.fetched} ` +
      `(logos=${st.logos} symbols=${st.symbols}) skipped-on-disk=${st.skippedDisk} ` +
      `not-modified=${st.notModified} rejected=${st.rejected} errors=${st.errors} bytes=${st.bytes}\n`,
  );
  return st;
}

// ── CLI ─────────────────────────────────────────────────────────────────────
// Usage: node dist/setWarmer.js [--dry-run]
const isMain = process.argv[1]?.endsWith('setWarmer.js') || process.argv[1]?.endsWith('setWarmer.ts');
if (isMain) {
  const dryRun = process.argv.slice(2).includes('--dry-run');
  warmSets({ dryRun })
    .then(() => closePool())
    .then(() => process.exit(0))
    .catch(async (err) => {
      process.stderr.write(`[set-warmer] fatal: ${(err as Error).message}\n`);
      await closePool().catch(() => undefined);
      process.exit(1);
    });
}
