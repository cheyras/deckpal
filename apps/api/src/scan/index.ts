import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { makePool } from '@pokedex/db';
import type pg from 'pg';
import { ALGO, hashPath, hashToBytes } from './phash.js';

/**
 * Perceptual-hash indexer for the offline card scanner (Phase 8).
 *
 * Walks the cached card art, computes a dHash per (card, quality) and upserts it
 * into `card_image_phash`. Designed to be gentle on this Pi and to co-exist with
 * the live services:
 *   • idempotent + resumable — skips cards already hashed (unless --force);
 *   • bounded concurrency (default 2) so it never pegs all four cores;
 *   • decode delegated to system ImageMagick (no native node addon);
 *   • one pooled DB connection, batched upserts (short connection hold).
 *
 * Intended launch (nice + idle IO so it yields to live traffic):
 *   nice -n 15 ionice -c3 pnpm --filter pokedex-api scan:index
 *
 * Flags:
 *   --quality low|high   (default low — smaller/faster, plenty for matching)
 *   --concurrency N      (default 2)
 *   --force              (recompute even if a hash already exists)
 *   --limit N            (cap number of cards processed this run)
 *   --set <setId> ...    (restrict to one or more sets, e.g. --set base1 sv03.5)
 */

const CACHE_ROOT = process.env.IMAGE_CACHE_ROOT ?? '/home/cheyras/pokedex/cache';
const LANG = 'en';

interface Args {
  quality: 'low' | 'high';
  concurrency: number;
  force: boolean;
  limit: number | null;
  sets: string[];
}

function parseArgs(argv: string[]): Args {
  const a: Args = { quality: 'low', concurrency: 2, force: false, limit: null, sets: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    const next = (): string => argv[++i] ?? '';
    if (t === '--quality') a.quality = next() === 'high' ? 'high' : 'low';
    else if (t === '--concurrency') a.concurrency = Math.max(1, Number(next()) || 2);
    else if (t === '--force') a.force = true;
    else if (t === '--limit') a.limit = Number(next()) || null;
    else if (t === '--set') {
      // consume following non-flag tokens as set ids
      let peek = argv[i + 1];
      while (peek !== undefined && !peek.startsWith('--')) {
        a.sets.push(peek);
        i++;
        peek = argv[i + 1];
      }
    }
  }
  return a;
}

interface Target {
  card_id: string;
  serie: string;
  set: string;
  local_id: string;
}

// Local path is a pure function of (serie, set, localId, quality) — matches
// apps/images/src/layout.ts (flat `<localId>.<quality>.webp`); replicated here
// rather than imported to avoid a cross-app dependency. Read-only.
function cardPath(t: Target, quality: string): string {
  return join(CACHE_ROOT, 'images', LANG, t.serie, t.set, `${t.local_id}.${quality}.webp`);
}

async function fetchTargets(pool: pg.Pool, args: Args): Promise<Target[]> {
  const params: unknown[] = [args.quality];
  let sql = `
    SELECT c.id AS card_id, ser.tcgdex_id AS serie, cs.tcgdex_id AS set, c.local_id
      FROM card c
      JOIN card_set cs ON cs.id = c.set_id
      JOIN series ser  ON ser.id = cs.series_id`;
  const where: string[] = [];
  if (!args.force) {
    // resumable: only cards without a hash for this quality
    sql += `\n LEFT JOIN card_image_phash ph ON ph.card_id = c.id AND ph.quality = $1`;
    where.push('ph.card_id IS NULL');
  }
  if (args.sets.length) {
    params.push(args.sets);
    where.push(`cs.tcgdex_id = ANY($${params.length})`);
  }
  if (where.length) sql += `\n WHERE ${where.join(' AND ')}`;
  sql += `\n ORDER BY c.id`;
  if (args.limit) sql += `\n LIMIT ${Number(args.limit)}`;
  const { rows } = await pool.query<Target>(sql, params);
  return rows;
}

interface Row {
  card_id: string;
  hash: Buffer;
}

async function flush(pool: pg.Pool, quality: string, batch: Row[]): Promise<void> {
  if (!batch.length) return;
  const values: string[] = [];
  const params: unknown[] = [quality, ALGO];
  for (const r of batch) {
    params.push(r.card_id, r.hash);
    const i = params.length;
    values.push(`($${i - 1}, $1, $2, $${i})`);
  }
  await pool.query(
    `INSERT INTO card_image_phash (card_id, quality, algo, hash) VALUES ${values.join(', ')}
       ON CONFLICT (card_id, quality)
       DO UPDATE SET hash = EXCLUDED.hash, algo = EXCLUDED.algo, computed_at = now()`,
    params,
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const pool = makePool(1);
  const t0 = Date.now();
  try {
    const targets = await fetchTargets(pool, args);
    const totalCards =
      (await pool.query<{ n: string }>('SELECT count(*)::text AS n FROM card')).rows[0]?.n ?? '?';
    console.log(
      `[scan-index] quality=${args.quality} concurrency=${args.concurrency} force=${args.force}` +
        (args.sets.length ? ` sets=${args.sets.join(',')}` : '') +
        `\n[scan-index] ${targets.length} card(s) to hash (catalog has ${totalCards})`,
    );

    let done = 0;
    let hashed = 0;
    let missing = 0;
    let failed = 0;
    const batch: Row[] = [];
    let idx = 0;

    async function worker(): Promise<void> {
      while (idx < targets.length) {
        const t = targets[idx++];
        if (!t) break;
        const p = cardPath(t, args.quality);
        if (!existsSync(p)) {
          missing++;
          done++;
          continue;
        }
        try {
          const h = await hashPath(p);
          batch.push({ card_id: t.card_id, hash: hashToBytes(h) });
          hashed++;
        } catch (e) {
          failed++;
          if (failed <= 5) console.warn(`[scan-index] hash failed ${t.set}-${t.local_id}: ${(e as Error).message}`);
        }
        done++;
        if (batch.length >= 200) {
          const chunk = batch.splice(0, batch.length);
          await flush(pool, args.quality, chunk);
        }
        if (done % 1000 === 0) {
          const rate = done / ((Date.now() - t0) / 1000);
          console.log(`[scan-index] ${done}/${targets.length} (${rate.toFixed(0)}/s, hashed=${hashed} missing=${missing} failed=${failed})`);
        }
      }
    }

    await Promise.all(Array.from({ length: args.concurrency }, () => worker()));
    await flush(pool, args.quality, batch);

    const coverage = await pool.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM card_image_phash WHERE quality = $1',
      [args.quality],
    );
    const secs = (Date.now() - t0) / 1000;
    console.log(
      `[scan-index] done in ${secs.toFixed(1)}s: hashed=${hashed} missing=${missing} failed=${failed} ` +
        `(${(hashed / secs).toFixed(1)}/s)\n` +
        `[scan-index] coverage: ${coverage.rows[0]?.n ?? '?'}/${totalCards} cards have a '${args.quality}' hash`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('[scan-index]', err instanceof Error ? err.message : err);
  process.exit(1);
});
