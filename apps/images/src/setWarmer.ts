import { existsSync } from 'node:fs';
import { fetchWebp, type FetchResult } from './fetch.js';
import {
  setImageAbsolutePath,
  setImageCacheKey,
  setImageRelativePath,
  setImageSourceUrl,
  type SetImageKind,
} from './layout.js';
import { closePool, getStoredEtag, listSetImageSources } from './assets.js';
import { parallelMap } from './parallel.js';
import { ensureRecorded, fromUrl, putAsset } from './store.js';
import { SET_IMAGE_FALLBACK_TABLE, setImageFallbackUrl } from '@deckpal/storage';
import { USER_AGENT } from './config.js';

/**
 * Set-imagery warmer. The card warmer walks datas.json (a CARD-only manifest), so
 * set logos/symbols were never cached — this closes that gap (the primary "empty"
 * cause). The work-list is card_set.{logo_url,symbol_url}; the upstream asset is the
 * stored base URL + '.webp' (DATA-LAYER §3.4). ~326 fetches total.
 *
 * When a catalog column is NULL, the work-list falls back to the approved
 * crosswalk in @deckpal/storage (`setImageFallbackUrl` / SET_IMAGE_FALLBACK_TABLE)
 * — 43 (setId, kind) pairs sourced from pokemontcg.io / Bulbagarden .png files.
 * The catalog column always takes precedence; the fallback is PNG, not the
 * TCGdex .webp `setImageSourceUrl` appends, so the source URL is derived per-task.
 *
 * Same politeness/safety as the card warmer: the fetcher gate (≤5 req/s, ≤2
 * concurrent, If-None-Match) is the limiter; content-type + RIFF/WEBP (catalog)
 * and content-type + PNG-signature (fallback) validated so the soft-404 HTML trap
 * (200 + text/html) is never written; resumable (skips files already on disk);
 * idempotent (ON CONFLICT upsert). INVOCABLE, never auto-run.
 */

interface Task {
  setId: string;
  kind: SetImageKind;
  baseUrl: string;
  cacheKey: string;
  fromFallback: boolean;
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
  fallback: number;
}

async function buildTasks(): Promise<Task[]> {
  const rows = await listSetImageSources();
  // Index the catalog columns so a fallback can tell whether the catalog already
  // sources a given (setId, kind) — the catalog column always takes precedence.
  const catalog = new Map<string, { logo: string | null; symbol: string | null }>();
  for (const r of rows) {
    catalog.set(r.set_id, { logo: r.logo_url, symbol: r.symbol_url });
  }
  const tasks: Task[] = [];
  for (const r of rows) {
    if (r.logo_url) {
      tasks.push({ setId: r.set_id, kind: 'logo', baseUrl: r.logo_url, cacheKey: setImageCacheKey(r.set_id, 'logo'), fromFallback: false });
    }
    if (r.symbol_url) {
      tasks.push({ setId: r.set_id, kind: 'symbol', baseUrl: r.symbol_url, cacheKey: setImageCacheKey(r.set_id, 'symbol'), fromFallback: false });
    }
  }
  // Gap fill: the 43 (setId, kind) pairs whose catalog column is NULL but for
  // which an approved source exists. listSetImageSources filters out sets with
  // BOTH columns NULL, so the both-null fallback pairs are reached only here;
  // a pair whose column IS populated is skipped (the catalog URL wins). The
  // resolver is setImageFallbackUrl; SET_IMAGE_FALLBACK_TABLE just enumerates.
  for (const entry of SET_IMAGE_FALLBACK_TABLE) {
    const cat = catalog.get(entry.setId);
    const catUrl = entry.kind === 'logo' ? (cat?.logo ?? null) : (cat?.symbol ?? null);
    if (catUrl) continue;
    const fb = setImageFallbackUrl(entry.setId, entry.kind);
    if (!fb) continue;
    tasks.push({
      setId: entry.setId,
      kind: entry.kind,
      baseUrl: fb,
      cacheKey: setImageCacheKey(entry.setId, entry.kind),
      fromFallback: true,
    });
  }
  return tasks;
}

async function runTask(t: Task, st: Stats, dryRun: boolean): Promise<void> {
  st.seen++;
  const absPath = setImageAbsolutePath(t.setId, t.kind);
  const relPath = setImageRelativePath(t.setId, t.kind);
  // Fallback sources are complete .png URLs (pokemontcg.io / Bulbagarden), NOT
  // the TCGdex base URLs `setImageSourceUrl` appends '.webp' to. Use the fallback
  // URL verbatim; only the catalog base URL needs the '.webp' suffix.
  const url = t.fromFallback ? t.baseUrl : setImageSourceUrl(t.baseUrl);
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
  // Catalog assets are .webp (RIFF/WEBP, validated by fetchWebp). Fallback
  // assets are .png — fetchWebp hardcodes the RIFF/WEBP body check and would
  // reject them, so fall back to a PNG-validated fetch. Both paths carry real
  // provenance through the choke point (B1): fromUrl(<the actual URL fetched>),
  // never an invented or assumed source.
  const result: FetchResult = t.fromFallback
    ? await fetchFallbackPng(url, etag)
    : await fetchWebp(url, etag);
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

export interface SetWarmOptions {
  dryRun?: boolean;
}

// PNG magic signature: 89 50 4E 47 0D 0A 1A 0A — the PNG equivalent of fetchWebp's
// RIFF/WEBP check, used to reject a soft-404 HTML body that lied about its type.
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Fetch a fallback PNG source (pokemontcg.io / Bulbagarden). `fetchWebp` hardcodes
 * the RIFF/WEBP body check, so it cannot validate a PNG; this mirrors its
 * content-type + magic-byte defence for PNG and returns the same `FetchResult`
 * shape so `runTask`'s switch is shared. The per-second rate gate (≤5/s) lives in
 * `fetch.ts` and is not exported; fallback concurrency is bounded by the same
 * `parallelMap(2)` pool that feeds the catalog path, so the ≤2-concurrent half
 * of the gate still holds. Soft-404 HTML (200 + text/html) is rejected, never
 * written — same trap `fetchWebp` guards the catalog path against.
 */
async function fetchFallbackPng(url: string, etag: string | null): Promise<FetchResult> {
  try {
    const headers: Record<string, string> = { 'user-agent': USER_AGENT };
    if (etag) headers['if-none-match'] = etag;
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
    const ct = res.headers.get('content-type');
    if (res.status === 304) return { status: 'not-modified' };
    if (!res.ok) {
      await res.arrayBuffer().catch(() => undefined);
      return { status: 'error', reason: `HTTP ${res.status}`, httpStatus: res.status };
    }
    if (!ct || !ct.toLowerCase().startsWith('image/png')) {
      await res.arrayBuffer().catch(() => undefined);
      return {
        status: 'rejected',
        reason: `content-type '${ct ?? '(none)'}' is not image/png (soft-404 trap)`,
        httpStatus: res.status,
        contentType: ct,
      };
    }
    const body = Buffer.from(await res.arrayBuffer());
    if (body.length < 8 || !body.subarray(0, 8).equals(PNG_SIGNATURE)) {
      return {
        status: 'rejected',
        reason: `body is not a PNG container (${body.length} bytes)`,
        httpStatus: res.status,
        contentType: ct,
      };
    }
    return { status: 'ok', body, contentType: ct, etag: res.headers.get('etag') };
  } catch (err) {
    return { status: 'error', reason: (err as Error).message, httpStatus: 0 };
  }
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
    fallback: 0,
  };
  st.fallback = tasks.filter((t) => t.fromFallback).length;
  await parallelMap(tasks, 2, (t) => runTask(t, st, opts.dryRun ?? false));
  process.stderr.write(
    `[set-warmer] done. tasks=${tasks.length} (fallback=${st.fallback}) seen=${st.seen} fetched=${st.fetched} ` +
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
