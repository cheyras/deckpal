// Price + cross-fill CLI. `tsx src/prices/cli.ts <cmd> [flags]`
//   tcgcsv      [--sets a,b] [--force]         daily TCGCSV price ingest
//   cardmarket  [--sets a,b] [--force]         daily Cardmarket price ingest
//   crossfill   [--series a,b] [--price]       reverse-holo cross-fill (+ recompute coverage)
//   recompute   [--sets a,b]                   recompute set-progress denominators only
//
// Connection budget: ONE pooled client for the whole process (sync = 1 of 3). DATA-LAYER §6.5.

import { makePool, loadEnv } from '@deckscout/db';
import { ingestTcgcsvPrices, fetchLastUpdated } from './tcgcsv.js';
import { ingestCardmarket } from './cardmarket.js';
import { crossFillReverse, AFFECTED_SERIES } from './crossfill.js';
import { recomputeCoverage } from './coverage.js';
import type { Queryable } from './db.js';

function flag(name: string): string | undefined {
  const pfx = `--${name}=`;
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(pfx));
  if (!hit) return undefined;
  return hit.includes('=') ? hit.slice(hit.indexOf('=') + 1) : '';
}
function list(name: string): string[] | undefined {
  const v = flag(name);
  return v == null ? undefined : v.split(',').map((s) => s.trim()).filter(Boolean);
}

async function main(): Promise<void> {
  loadEnv();
  const cmd = process.argv[2];
  const pool = makePool(1);
  const client = (await pool.connect()) as unknown as Queryable & { release(): void };
  try {
    if (cmd === 'tcgcsv') {
      const r = await ingestTcgcsvPrices(client, { sets: list('sets'), force: flag('force') != null });
      console.log(JSON.stringify(r, null, 2));
    } else if (cmd === 'cardmarket') {
      const r = await ingestCardmarket(client, { sets: list('sets'), force: flag('force') != null });
      console.log(JSON.stringify(r, null, 2));
    } else if (cmd === 'crossfill') {
      const series = list('series') ?? AFFECTED_SERIES;
      const writePrices = flag('price') != null;
      const capturedAt = writePrices ? new Date(await fetchLastUpdated()) : undefined;
      const r = await crossFillReverse(client, { series, writePrices, capturedAt });
      // recompute denominators for every affected set (idempotent, catalog-derived columns only)
      const { rows } = await client.query<{ id: string }>(
        `SELECT s.id FROM card_set s JOIN series se ON se.id = s.series_id
          WHERE se.slug = ANY($1) AND s.tcgplayer_group_id IS NOT NULL`,
        [series],
      );
      const recomputed = await recomputeCoverage(client, rows.map((x) => Number(x.id)));
      console.log(JSON.stringify({ ...r, recomputedProgressRows: recomputed }, null, 2));
    } else if (cmd === 'recompute') {
      const sets = list('sets');
      const { rows } = await client.query<{ id: string }>(
        `SELECT id FROM card_set WHERE ($1::text[] IS NULL OR tcgdex_id = ANY($1))`,
        [sets ?? null],
      );
      const n = await recomputeCoverage(client, rows.map((x) => Number(x.id)));
      console.log(JSON.stringify({ recomputedProgressRows: n }, null, 2));
    } else {
      console.error('usage: cli.ts <tcgcsv|cardmarket|crossfill|recompute> [flags]');
      process.exitCode = 2;
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('[prices] FAILED:', err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
