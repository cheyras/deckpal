/**
 * Card-art maintenance — `pnpm --filter deckpal-api art:upgrade` / `art:self-source`.
 *
 * upgrade [--base https://deckpal.app] [--dry-run]
 *   The swap half of the self-source rule (@deckpal/storage `self-source.ts`): TCGdex's art
 *   replaces any other source as soon as TCGdex has the card. Reads every card asset whose
 *   recorded source is not TCGdex, asks TCGdex whether it now serves that card, and for each one
 *   it does, sends the deployed image tier `?refresh=tcgdex`, which re-checks and swaps it in
 *   place (handler.ts `refreshFromTcgdex`). Needs the database (PG*) and nothing else: the write
 *   happens inside the tier. The weekly catalog refresh runs it.
 *
 * self-source --card <set>-<localId> --from <url|file> --source <url|self-sourced:note> [--out dir]
 *   Art the owner found anywhere. Encodes both slots exactly as the tier's self-source fallback
 *   does, and writes them through the cloud choke point (`putStorageAsset`, so needs the storage
 *   env) recorded with `--source`: where it was found, or a `self-sourced:` note when it has no
 *   URL. `--out` writes the two encodes to a folder instead, to look at first.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makePool } from '@deckpal/db';
import {
  QUALITIES,
  SELF_SOURCED_CACHE_CONTROL,
  cardCacheKey,
  cardRelativePath,
  cardSourceUrl,
  fromUrl,
  putStorageAsset,
  type CardRef,
} from '@deckpal/storage';
import { encodeToSlot } from './selfSource.js';

const argv = process.argv.slice(2);
const cmd = argv[0];
const arg = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const flag = (name: string): boolean => argv.includes(`--${name}`);

const PATH = /^images\/en\/([^/]+)\/([^/]+)\/(.+)\.(low|high)\.webp$/;

async function tcgdexServes(url: string): Promise<boolean> {
  // TCGdex keeps the same art as .webp/.png/.jpg and answers a miss with 404 or a 200 HTML page.
  for (const ext of ['.webp', '.png', '.jpg']) {
    try {
      const res = await fetch(url.replace(/\.webp$/, ext), { method: 'HEAD', signal: AbortSignal.timeout(10_000) });
      if (res.status === 200 && (res.headers.get('content-type') ?? '').startsWith('image/')) return true;
    } catch { /* try the next */ }
  }
  return false;
}

async function upgrade(): Promise<void> {
  const base = (arg('base') ?? 'https://deckpal.app').replace(/\/+$/, '');
  const dryRun = flag('dry-run');
  const pool = makePool(1);
  try {
    const { rows } = await pool.query<{ relative_path: string; source_url: string }>(
      `SELECT relative_path, source_url FROM image_asset
        WHERE kind = 'card' AND source_url IS NOT NULL AND source_url NOT LIKE 'https://assets.tcgdex.net/%'
        ORDER BY relative_path`,
    );
    const tally = { candidates: rows.length, tcgdexHas: 0, swapped: 0, kept: 0, failed: 0, unparsed: 0 };
    for (const r of rows) {
      const m = r.relative_path.match(PATH);
      if (!m) { tally.unparsed++; continue; }
      const [, serie, set, localId, quality] = m as unknown as [string, string, string, string, 'low' | 'high'];
      if (!(await tcgdexServes(cardSourceUrl({ serie, set, localId }, quality)))) continue;
      tally.tcgdexHas++;
      if (dryRun) { console.log(`would swap\t${r.relative_path}\t(from ${r.source_url})`); continue; }
      const url = `${base}/deckpal/images/en/${serie}/${set}/${encodeURIComponent(localId)}/${quality}.webp?refresh=tcgdex`;
      try {
        const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(30_000) });
        const outcome = res.headers.get('x-image-refresh');
        if (outcome === 'swapped') { tally.swapped++; console.log(`swapped\t${r.relative_path}`); }
        else { tally.kept++; console.warn(`kept\t${r.relative_path}\t(${res.status} ${outcome ?? 'no refresh header'})`); }
      } catch (err) {
        tally.failed++;
        console.error(`failed\t${r.relative_path}\t${(err as Error).message}`);
      }
      await new Promise((ok) => setTimeout(ok, 150));
    }
    console.log(JSON.stringify(tally));
    if (tally.failed) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

async function selfSource(): Promise<void> {
  const cardId = arg('card');
  const from = arg('from');
  const source = arg('source');
  const out = arg('out');
  if (!cardId || !from || !source) throw new Error('usage: self-source --card <set>-<localId> --from <url|file> --source <url|self-sourced:note> [--out dir]');
  if (!/^[a-z][a-z0-9+.-]*:/i.test(source)) throw new Error('--source must be the URL it was found at, or a self-sourced:<note>');

  const pool = makePool(1);
  let ref: CardRef;
  try {
    const { rows } = await pool.query<{ serie: string; set: string; local_id: string }>(
      `SELECT sr.tcgdex_id AS serie, s.tcgdex_id AS set, c.local_id
         FROM card c JOIN card_set s ON s.id = c.set_id JOIN series sr ON sr.id = s.series_id
        WHERE c.tcgdex_id = $1 AND c.lang = 'en'`,
      [cardId],
    );
    if (!rows[0]) throw new Error(`no card ${cardId}`);
    ref = { serie: rows[0].serie, set: rows[0].set, localId: rows[0].local_id };
  } finally {
    await pool.end();
  }

  const bytes = /^https?:\/\//i.test(from)
    ? Buffer.from(await (await fetch(from, { signal: AbortSignal.timeout(20_000) })).arrayBuffer())
    : readFileSync(from);
  for (const quality of QUALITIES) {
    const encoded = await encodeToSlot(bytes, quality);
    if (!encoded.ok) throw new Error(`${cardId} ${quality}: ${encoded.reason}`);
    if (out) {
      mkdirSync(out, { recursive: true });
      const file = join(out, `${cardId}.${quality}.webp`);
      writeFileSync(file, encoded.bytes);
      console.log(`wrote ${file} (${encoded.bytes.length} bytes, from ${encoded.native.width}x${encoded.native.height})`);
      continue;
    }
    const r = await putStorageAsset({
      cacheKey: cardCacheKey(ref, quality),
      kind: 'card',
      relativePath: cardRelativePath(ref, quality),
      bytes: encoded.bytes,
      provenance: fromUrl(source),
      contentType: 'image/webp',
      cacheControl: SELF_SOURCED_CACHE_CONTROL,
      replace: true,
    });
    console.log(`stored ${r.relativePath} (${r.byteSize} bytes, from ${encoded.native.width}x${encoded.native.height})`);
  }
}

const run = cmd === 'upgrade' ? upgrade : cmd === 'self-source' ? selfSource : null;
if (!run) {
  console.error('usage: artCli.ts upgrade [--base URL] [--dry-run] | self-source --card ID --from SRC --source URL [--out DIR]');
  process.exit(2);
}
run().catch((err) => {
  console.error(`[art] ${(err as Error).message}`);
  process.exit(1);
});
