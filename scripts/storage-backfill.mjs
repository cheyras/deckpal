#!/usr/bin/env node
/**
 * storage-backfill.mjs — upload part (or all) of the local image cache into the
 * cloud Supabase Storage bucket.
 *
 * The cloud tier (api/images.mjs) normally fills itself lazily from each asset's
 * recorded `source_url`. That covers everything upstream still serves. It does
 * NOT cover assets we hold and upstream has since dropped or re-encoded away —
 * and there are real examples: the "Pitch Black" (me05) set logo 404s as .webp
 * upstream today, and 1,854 card rows have honestly-unknown provenance precisely
 * because their canonical URL stopped resolving. For those, the bytes on this
 * disk are the only copy, and only an upload fixes them.
 *
 * Because the Storage object key IS `image_asset.relative_path`, this is a plain
 * mirror — no remapping, no manifest changes.
 *
 *   node scripts/storage-backfill.mjs --prefix sets            # ~5 MB, 326 files
 *   node scripts/storage-backfill.mjs --prefix images --dry-run
 *   node scripts/storage-backfill.mjs --prefix images          # the full ~2.1 GB
 *
 * Flags:
 *   --prefix <sets|images>  subtree of IMAGE_CACHE_ROOT to mirror (default: sets)
 *   --dry-run               report what would happen, upload nothing
 *   --force                 re-upload objects that already exist
 *   --missing-source        ONLY files whose row has source_url IS NULL — i.e. the
 *                           assets the lazy fill can provably never recover,
 *                           because there is no upstream URL to fetch them from.
 *                           This is the highest-value, lowest-cost subset:
 *                           1,854 cards / ~121 MB as of 2026-08-10.
 *   --limit <n>             stop after n uploads (for a bounded first run)
 *   --concurrency <n>       parallel uploads (default 3; Supabase throttles above this)
 *
 * SAFETY RAIL — the same one store.ts enforces on disk: a file with NO manifest
 * row is NOT uploaded. Bytes whose origin we cannot state do not get published;
 * they are counted and listed so `manifest:backfill` can be run first.
 *
 * Storage budget: the full `images` tree is ~2.1 GB and does not fit Supabase's
 * Free 1 GB. `--prefix sets` is ~5 MB and always fits. The full mirror is the
 * Pro-tier ($25/mo, 100 GB) path.
 *
 * Env: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (already set for the cloud
 * deploy), IMAGE_CACHE_ROOT (or the repo's ./cache), PG* for the manifest.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_ROOT = process.env.IMAGE_CACHE_ROOT ?? join(REPO_ROOT, 'cache');
const BUCKET = process.env.CARD_ART_BUCKET ?? 'card-art';

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (process.argv[i + 1] ?? fallback);
}
const flag = (name) => process.argv.includes(`--${name}`);

const PREFIX = arg('prefix', 'sets');
const DRY = flag('dry-run');
const FORCE = flag('force');
const MISSING_SOURCE = flag('missing-source');
const LIMIT = Number(arg('limit', '0')) || Infinity;
const CONCURRENCY = Math.max(1, Math.min(16, Number(arg('concurrency', '3')) || 3));

const SUPABASE_URL = (process.env.SUPABASE_URL ?? '').replace(/\/+$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('[backfill] SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  process.exit(2);
}
if (!['sets', 'images', 'sprites'].includes(PREFIX)) {
  console.error(`[backfill] --prefix must be one of sets|images|sprites, got ${PREFIX}`);
  process.exit(2);
}

const auth = { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}` };

async function walk(dir, out) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) await walk(p, out);
    else if (e.isFile() && !e.name.endsWith('.tmp')) out.push(p);
  }
  return out;
}

async function objectExists(key) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${encodeURI(key)}`, {
    method: 'HEAD',
  });
  return res.status === 200;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Upload with backoff. Supabase Storage answers 429 `too_many_connections` well
 * below what a naive loop will offer it (measured: six parallel uploads is
 * already too many), and a bulk mirror that gives up on the first 429 leaves a
 * half-filled bucket. Retry the throttles and the 5xx; never retry a 4xx that is
 * actually about the request.
 */
async function upload(key, bytes, contentType) {
  let lastErr = 'unknown';
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${encodeURI(key)}`, {
      method: 'POST',
      headers: {
        ...auth,
        'content-type': contentType,
        'cache-control': 'max-age=31536000',
        'x-upsert': 'true',
      },
      body: bytes,
    });
    if (res.ok) return;
    lastErr = `HTTP ${res.status} ${(await res.text()).slice(0, 160)}`;
    if (res.status !== 429 && res.status < 500) break;
    await sleep(500 * 2 ** attempt + Math.floor(Math.random() * 250));
  }
  throw new Error(lastErr);
}

const root = join(CACHE_ROOT, PREFIX);
console.log(`[backfill] source : ${root}`);
console.log(`[backfill] bucket : ${BUCKET}${DRY ? '  (DRY RUN)' : ''}`);

const files = await walk(root, []);
console.log(`[backfill] files on disk: ${files.length}`);
if (files.length === 0) process.exit(0);

// Manifest rows keyed by relative path. Sprites are deliberately unmanifested
// (one pinned upstream SHA covers the tree — see paths.ts SPRITES_SHA), so the
// row requirement does not apply to them.
const needsRow = PREFIX !== 'sprites';
let rowByPath = new Map();
if (needsRow) {
  const pool = new pg.Pool({
    host: process.env.PGHOST ?? '127.0.0.1',
    port: Number(process.env.PGPORT ?? 5432),
    database: process.env.PGDATABASE ?? 'deckscout',
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    max: 1,
  });
  try {
    const { rows } = await pool.query(
      `SELECT relative_path, content_type, source_url FROM image_asset
        WHERE relative_path LIKE $1` + (MISSING_SOURCE ? ` AND source_url IS NULL` : ''),
      [`${PREFIX}/%`],
    );
    rowByPath = new Map(rows.map((r) => [r.relative_path, r]));
  } finally {
    await pool.end();
  }
  console.log(
    `[backfill] manifest rows for ${PREFIX}/: ${rowByPath.size}` +
      (MISSING_SOURCE ? '  (source_url IS NULL only)' : ''),
  );
}

let uploaded = 0;
let skippedExisting = 0;
let skippedUnrecorded = 0;
let bytesSent = 0;
const failures = [];
const unrecorded = [];

const queue = files.slice();
async function worker() {
  for (;;) {
    if (uploaded >= LIMIT) return;
    const file = queue.shift();
    if (!file) return;
    const key = relative(CACHE_ROOT, file).split('\\').join('/');
    const row = rowByPath.get(key);
    if (needsRow && !row) {
      // Under --missing-source the row set is deliberately narrowed, so "no row
      // here" means "not in scope", not "unrecorded bytes".
      if (!MISSING_SOURCE) {
        skippedUnrecorded++;
        if (unrecorded.length < 20) unrecorded.push(key);
      }
      continue;
    }
    try {
      if (!FORCE && (await objectExists(key))) {
        skippedExisting++;
        continue;
      }
      const bytes = await readFile(file);
      const st = await stat(file);
      if (st.size === 0) throw new Error('empty file');
      if (DRY) {
        uploaded++;
        bytesSent += bytes.length;
        continue;
      }
      await upload(key, bytes, row?.content_type ?? 'application/octet-stream');
      uploaded++;
      bytesSent += bytes.length;
      if (uploaded % 200 === 0) console.log(`[backfill]   ${uploaded} uploaded…`);
    } catch (err) {
      failures.push(`${key}: ${err.message}`);
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

console.log('');
console.log(`[backfill] uploaded          : ${uploaded} (${(bytesSent / 1024 / 1024).toFixed(2)} MB)`);
console.log(`[backfill] already in bucket : ${skippedExisting}`);
if (needsRow) console.log(`[backfill] skipped, no row   : ${skippedUnrecorded}`);
if (unrecorded.length) {
  console.log('[backfill]   (run `pnpm --filter deckscout-images manifest:backfill` first) e.g.:');
  for (const u of unrecorded) console.log(`[backfill]     ${u}`);
}
console.log(`[backfill] failures          : ${failures.length}`);
for (const f of failures.slice(0, 20)) console.log(`[backfill]   ${f}`);
process.exit(failures.length ? 1 : 0);
