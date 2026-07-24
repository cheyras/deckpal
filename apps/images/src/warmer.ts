import { existsSync } from 'node:fs';
import { mkdir, rename, stat, writeFile, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  CACHE_ROOT,
  DATAS_URL,
  LANG,
  QUALITIES,
  USER_AGENT,
  type Quality,
} from './config.js';
import { fetchWebp } from './fetch.js';
import {
  cardAbsolutePath,
  cardCacheKey,
  cardRelativePath,
  cardSourceUrl,
  type CardRef,
} from './layout.js';
import { closePool, existingCacheKeys, getStoredEtag, upsertImageAsset } from './assets.js';

/**
 * Image warmer. Walks the upstream asset manifest (datas.json) as the work-list —
 * NOT probing for 404s (DATA-LAYER §3.5/§5.3). Resumable (skips files already on
 * disk / recorded), rate-limited by the fetcher (≤5 req/s, ≤2 concurrent, If-None-
 * Match), and idempotent (ON CONFLICT upsert). It is INVOCABLE, never auto-run.
 */

// datas.json: { lang: { serie: { set: { localId: sha1 } } } }
type Datas = Record<string, Record<string, Record<string, Record<string, string>>>>;

const DATAS_PATH = `${CACHE_ROOT}/catalog/datas.json`;

async function loadManifest(forceRefresh = false): Promise<Datas> {
  if (!forceRefresh && existsSync(DATAS_PATH)) {
    return JSON.parse(await readFile(DATAS_PATH, 'utf-8')) as Datas;
  }
  process.stderr.write(`[warmer] fetching manifest ${DATAS_URL} …\n`);
  const res = await fetch(DATAS_URL, { headers: { 'user-agent': USER_AGENT } });
  if (!res.ok) throw new Error(`datas.json fetch failed: HTTP ${res.status}`);
  const text = await res.text();
  await mkdir(dirname(DATAS_PATH), { recursive: true });
  await writeFile(DATAS_PATH, text);
  return JSON.parse(text) as Datas;
}

interface Task {
  ref: CardRef;
  quality: Quality;
  cacheKey: string;
}

function buildTasks(datas: Datas, setFilter?: string): Task[] {
  const byLang = datas[LANG];
  if (!byLang) throw new Error(`manifest has no '${LANG}' language`);
  const tasks: Task[] = [];
  for (const [serie, sets] of Object.entries(byLang)) {
    for (const [set, cards] of Object.entries(sets)) {
      if (setFilter && set !== setFilter) continue;
      for (const localId of Object.keys(cards)) {
        const ref: CardRef = { serie, set, localId };
        for (const quality of QUALITIES) {
          tasks.push({ ref, quality, cacheKey: cardCacheKey(ref, quality) });
        }
      }
    }
  }
  return tasks;
}

interface Stats {
  seen: number;
  fetched: number;
  skippedDisk: number;
  recordedFromDisk: number;
  notModified: number;
  rejected: number;
  errors: number;
  bytesLow: number;
  bytesHigh: number;
}

async function runTask(t: Task, st: Stats, dryRun: boolean): Promise<void> {
  st.seen++;
  const absPath = cardAbsolutePath(t.ref, t.quality);
  const relPath = cardRelativePath(t.ref, t.quality);
  const url = cardSourceUrl(t.ref, t.quality);

  // Resumable: never re-fetch a file already on disk (assets are immutable).
  if (existsSync(absPath)) {
    st.skippedDisk++;
    // ensure a DB row exists for an on-disk file (self-heal a torn write)
    const s = await stat(absPath);
    if (!dryRun) {
      await upsertImageAsset({
        cacheKey: t.cacheKey,
        kind: 'card',
        relativePath: relPath,
        contentType: 'image/webp',
        byteSize: s.size,
        sourceUrl: url,
        etag: null,
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
      await mkdir(dirname(absPath), { recursive: true });
      const tmp = `${absPath}.tmp`;
      await writeFile(tmp, result.body);
      await rename(tmp, absPath);
      await upsertImageAsset({
        cacheKey: t.cacheKey,
        kind: 'card',
        relativePath: relPath,
        contentType: result.contentType.split(';')[0]!.trim(),
        byteSize: result.body.length,
        sourceUrl: url,
        etag: result.etag,
      });
      st.fetched++;
      if (t.quality === 'high') st.bytesHigh += result.body.length;
      else st.bytesLow += result.body.length;
      break;
    }
    case 'not-modified':
      st.notModified++;
      break;
    case 'rejected':
      st.rejected++;
      process.stderr.write(`[warmer] REJECT ${url}: ${result.reason}\n`);
      break;
    case 'error':
      st.errors++;
      process.stderr.write(`[warmer] ERROR ${url}: ${result.reason}\n`);
      break;
  }
}

// Bounded parallel map. The fetcher gate is the real limiter; this just keeps the
// queue fed with up to `width` outstanding tasks.
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

export interface WarmOptions {
  set?: string;
  limitCards?: number; // limit number of CARDS (each yields both qualities)
  dryRun?: boolean;
  refreshManifest?: boolean;
}

export async function warm(opts: WarmOptions): Promise<Stats> {
  const datas = await loadManifest(opts.refreshManifest);
  let tasks = buildTasks(datas, opts.set);

  if (opts.limitCards && opts.limitCards > 0) {
    // Keep both qualities per card: cap by distinct card, preserving order.
    const seenCards = new Set<string>();
    tasks = tasks.filter((t) => {
      const cardId = `${t.ref.set}-${t.ref.localId}`;
      if (seenCards.has(cardId)) return true;
      if (seenCards.size >= opts.limitCards!) return false;
      seenCards.add(cardId);
      return true;
    });
  }

  // Skip work already recorded before we even hit the network.
  const known = await existingCacheKeys(tasks.map((t) => t.cacheKey));
  const pending = tasks.filter((t) => !known.has(t.cacheKey) || !existsSync(cardAbsolutePath(t.ref, t.quality)));
  const preSkipped = tasks.length - pending.length;

  const st: Stats = {
    seen: 0,
    fetched: 0,
    skippedDisk: 0,
    recordedFromDisk: 0,
    notModified: 0,
    rejected: 0,
    errors: 0,
    bytesLow: 0,
    bytesHigh: 0,
  };

  await parallelMap(pending, 2, (t) => runTask(t, st, opts.dryRun ?? false));

  process.stderr.write(
    `[warmer] done. tasks=${tasks.length} pre-skipped(recorded)=${preSkipped} ` +
      `seen=${st.seen} fetched=${st.fetched} skipped-on-disk=${st.skippedDisk} ` +
      `not-modified=${st.notModified} rejected=${st.rejected} errors=${st.errors}\n`,
  );
  return st;
}

// ── CLI ─────────────────────────────────────────────────────────────────────
// Usage: node dist/warmer.js [--set sv03.5] [--limit 20] [--dry-run] [--refresh-manifest]
function parseArgs(argv: string[]): WarmOptions {
  const o: WarmOptions = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--set') o.set = argv[++i];
    else if (a === '--limit') o.limitCards = Number(argv[++i]);
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--refresh-manifest') o.refreshManifest = true;
  }
  return o;
}

const isMain = process.argv[1]?.endsWith('warmer.js') || process.argv[1]?.endsWith('warmer.ts');
if (isMain) {
  const opts = parseArgs(process.argv.slice(2));
  warm(opts)
    .then((st) => {
      process.stderr.write(
        `[warmer] bytes fetched: low=${st.bytesLow} high=${st.bytesHigh} ` +
          `total=${st.bytesLow + st.bytesHigh}\n`,
      );
      return closePool();
    })
    .then(() => process.exit(0))
    .catch(async (err) => {
      process.stderr.write(`[warmer] fatal: ${(err as Error).message}\n`);
      await closePool().catch(() => undefined);
      process.exit(1);
    });
}
