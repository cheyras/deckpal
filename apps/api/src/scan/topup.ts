import { createWriteStream, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { makePool } from '@deckpal/db';
import { EMBED_MODEL_ID, embedStamp } from '@deckpal/matching';
import { cardRelativePath, cardSourceUrl, type CardRef } from '@deckpal/storage/paths';
import type pg from 'pg';
import { ALGO } from './phash.js';

/**
 * Scanner index top-up — `pnpm --filter deckpal-api scan:topup`.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * The scanner finds a card by two indexes of its catalogue art: the dHash in
 * `card_image_phash` (`index.ts`) and the image vector in `card_embedding`
 * (`tools/embed-catalog`). Both indexers were run by hand, and nothing ran them
 * when the weekly catalog refresh imported a new set. So every new set was
 * invisible to the image matcher until somebody remembered.
 *
 * That is what the owner's 2026-11-25 session hit. All 17 captures were Delta
 * Reign (me06, released 2026-11-06), which had no row in either index. The
 * dHash never offered an me06 card, the vector could not, and the only captures
 * that resolved were the ones where OCR read the printed number. That was 6 of
 * 17, and a 'corroborated' answer named the nearest older Masquerain. Replayed
 * offline with me06 indexed, the same 17 crops resolve 16 confident and right,
 * none wrong.
 *
 * ── WHAT IT DOES ────────────────────────────────────────────────────────────
 *
 * Default: list every card that is missing a current-algo dHash or a
 * current-stamp vector, download its catalogue art into IMAGE_CACHE_ROOT in the
 * layout both indexers read, and write the affected set ids to `--sets-out`.
 * The workflow then runs the two indexers with `--set`. They are unchanged and
 * still decide for themselves what to write.
 *
 * `--check`: count the cards that still miss a row although their art is in
 * IMAGE_CACHE_ROOT, and exit 1 if any do. "Has art" is decided by the download,
 * not assumed: hundreds of catalogue cards have no art in any approved source
 * (p2-work/art-sweep/SWEEP.md), and those cannot be indexed by anyone.
 *
 * Read-only on the database. The indexers are the only writers.
 */

const CACHE_ROOT = process.env.IMAGE_CACHE_ROOT ?? '/home/cheyras/pokedex/cache';
const QUALITY = 'low';
/** Same fence as index.ts: Pocket is digital-only, and its rows were purged. */
export const EXCLUDED_SERIES = ['tcgp'];

export interface TopupTarget {
  card_id: string;
  serie: string;
  set: string;
  local_id: string;
  needs_phash: boolean;
  needs_embed: boolean;
}

type ArtTarget = Pick<TopupTarget, 'serie' | 'set' | 'local_id'>;
const ref = (t: ArtTarget): CardRef => ({ serie: t.serie, set: t.set, localId: t.local_id });

/**
 * Where the indexers look for a card's art (index.ts / embed.mts `cardPath`): the
 * stored layout, `cardRelativePath` in @deckpal/storage, under IMAGE_CACHE_ROOT.
 */
export function cachePath(root: string, t: ArtTarget): string {
  return join(root, cardRelativePath(ref(t), QUALITY));
}

/**
 * The art's sources, in order: the deployment's own public card-art bucket
 * (what production serves), then TCGdex, of which the bucket is a byte-identical
 * mirror for every card TCGdex has. Both come from @deckpal/storage's path
 * algebra, so the `!` and `?` cards are asked for where each source keeps them.
 */
export function artUrls(bucketBase: string | null, t: ArtTarget): string[] {
  const urls: string[] = [];
  if (bucketBase) urls.push(`${bucketBase.replace(/\/+$/, '')}/${encodeURI(cardRelativePath(ref(t), QUALITY))}`);
  urls.push(cardSourceUrl(ref(t), QUALITY));
  return urls;
}

export async function fetchTopupTargets(pool: pg.Pool, stamp: string): Promise<TopupTarget[]> {
  const { rows } = await pool.query<TopupTarget>(
    `SELECT c.id::text AS card_id, ser.tcgdex_id AS serie, cs.tcgdex_id AS set, c.local_id,
            ph.card_id IS NULL AS needs_phash,
            ce.card_id IS NULL AS needs_embed
       FROM card c
       JOIN card_set cs ON cs.id = c.set_id
       JOIN series ser  ON ser.id = cs.series_id
       LEFT JOIN card_image_phash ph ON ph.card_id = c.id AND ph.quality = $1 AND ph.algo = $2
       LEFT JOIN card_embedding  ce ON ce.card_id = c.id AND ce.quality = $1 AND ce.stamp = $3
      WHERE ser.tcgdex_id <> ALL($4)
        AND (ph.card_id IS NULL OR ce.card_id IS NULL)
      ORDER BY c.id`,
    [QUALITY, ALGO, stamp, EXCLUDED_SERIES],
  );
  return rows;
}

async function download(urls: string[], dest: string): Promise<boolean> {
  for (const url of urls) {
    for (let attempt = 1; attempt <= 4; attempt++) {
      let res: Response;
      try {
        res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      } catch {
        await new Promise((r) => setTimeout(r, 1000 * attempt));
        continue;
      }
      // A throttled fetch is not missing art: wait and ask again.
      if (res.status === 429 || res.status >= 500) {
        await res.arrayBuffer().catch(() => {});
        await new Promise((r) => setTimeout(r, 2000 * attempt));
        continue;
      }
      if (!res.ok || !(res.headers.get('content-type') ?? '').includes('image') || !res.body) {
        await res.arrayBuffer().catch(() => {});
        break; // this source does not have it; try the next one
      }
      mkdirSync(dirname(dest), { recursive: true });
      await pipeline(Readable.fromWeb(res.body as import('node:stream/web').ReadableStream), createWriteStream(dest));
      return true;
    }
  }
  return false;
}

function arg(argv: string[], name: string): string | null {
  const i = argv.indexOf(name);
  return i >= 0 ? (argv[i + 1] ?? null) : null;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const check = argv.includes('--check');
  const setsOut = arg(argv, '--sets-out');
  const bucketBase = arg(argv, '--art-base') ?? process.env.SCAN_ART_BASE ?? null;
  const stamp = embedStamp(EMBED_MODEL_ID);
  const pool = makePool(1);
  try {
    const targets = await fetchTopupTargets(pool, stamp);
    const withArt = targets.filter((t) => existsSync(cachePath(CACHE_ROOT, t)));

    if (check) {
      const phash = withArt.filter((t) => t.needs_phash).length;
      const embed = withArt.filter((t) => t.needs_embed).length;
      const noArt = targets.length - withArt.length;
      console.log(
        `[scan-topup] coverage: ${phash} card(s) with art lack a dHash, ${embed} lack a ${stamp} vector ` +
          `(${noArt} more have no art anywhere and cannot be indexed)`,
      );
      if (phash || embed) {
        const sample = withArt.slice(0, 10).map((t) => `${t.set}-${t.local_id}`).join(', ');
        console.error(`[scan-topup] the scanner cannot see these cards: ${sample}${withArt.length > 10 ? ', …' : ''}`);
        process.exitCode = 1;
      }
      return;
    }

    console.log(
      `[scan-topup] ${targets.length} card(s) miss an index row ` +
        `(${targets.filter((t) => t.needs_phash).length} dHash, ${targets.filter((t) => t.needs_embed).length} vector)`,
    );
    let fetched = 0;
    let absent = 0;
    let idx = 0;
    const todo = targets.filter((t) => !existsSync(cachePath(CACHE_ROOT, t)));
    async function worker(): Promise<void> {
      for (;;) {
        const t = todo[idx++];
        if (!t) return;
        if (await download(artUrls(bucketBase, t), cachePath(CACHE_ROOT, t))) fetched++;
        else absent++;
      }
    }
    await Promise.all(Array.from({ length: 8 }, () => worker()));
    const sets = [...new Set(targets.filter((t) => existsSync(cachePath(CACHE_ROOT, t))).map((t) => t.set))].sort();
    console.log(`[scan-topup] art: ${fetched} fetched, ${absent} with no art in any source; ${sets.length} set(s) to index`);
    if (setsOut) writeFileSync(setsOut, sets.join(' '));
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.endsWith('topup.ts') || process.argv[1]?.endsWith('topup.js')) {
  main().catch((err) => {
    console.error('[scan-topup]', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
