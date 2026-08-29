// Price + cross-fill CLI. `tsx src/prices/cli.ts <cmd> [flags]`
//   tcgcsv      [--sets a,b] [--force]         daily TCGCSV price ingest
//   cardmarket  [--sets a,b] [--force]         daily Cardmarket price ingest
//   crossfill   [--series a,b] [--price]       reverse-holo cross-fill (+ recompute coverage)
//   recompute   [--sets a,b]                   recompute set-progress denominators only
//   backfill    --from=D --to=D [--limit=N] [--sets a,b] [--force] [--dry-run]
//                                              replay TCGCSV daily ARCHIVES into
//                                              price_observation for a past range
//                                              (repair; never touches price_current).
//                                              Days already ingested are skipped, so
//                                              re-running is how you resume a chunked
//                                              replay; --limit caps days per run.
//   snapshot    [--on=YYYY-MM-DD]              today's collection-value point, ALL users
//   snapshot-backfill --from=D --to=D [--max-stale=N]
//                                              reconstruct missing value points from the
//                                              collection_event + price_observation ledgers
//
// Connection budget: ONE pooled client for the whole process (sync = 1 of 3). DATA-LAYER §6.5.

import { makePool, loadEnv } from '@deckpal/db';
import { ingestTcgcsvPrices, fetchLastUpdated } from './tcgcsv.js';
import { ingestCardmarket } from './cardmarket.js';
import { crossFillReverse, AFFECTED_SERIES } from './crossfill.js';
import { backfillPricesFromArchive } from './backfill.js';
import {
  backfillValuePoints, ledgerAgreesWithCollection, snapshotAllUsers,
} from '../jobs/valueSnapshot.js';
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
    } else if (cmd === 'backfill') {
      const from = flag('from');
      const to = flag('to');
      if (!from || !to) throw new Error('backfill needs --from=YYYY-MM-DD --to=YYYY-MM-DD');
      const limitRaw = flag('limit');
      const r = await backfillPricesFromArchive(client, {
        from, to,
        sets: list('sets'),
        limit: limitRaw ? Number(limitRaw) : undefined,
        force: flag('force') != null,
        dryRun: flag('dry-run') != null,
      });
      // Summarised, not dumped: a 31-day chunk would otherwise print 31 objects
      // and bury the one number that says whether to run it again.
      console.log(JSON.stringify({
        processed: r.days.length,
        observations: r.observations,
        alreadyPresent: r.alreadyPresent,
        remaining: r.remaining,
        missingDays: r.missingDays,
        first: r.days[0]?.date ?? null,
        last: r.days[r.days.length - 1]?.date ?? null,
      }, null, 2));
      if (r.missingDays.length) {
        console.warn(`[prices] no archive published for: ${r.missingDays.join(', ')}`);
      }
      if (r.remaining > 0) {
        console.warn(`[prices] ${r.remaining} day(s) still to do — run the same command again to continue.`);
      }
    } else if (cmd === 'snapshot') {
      const r = await snapshotAllUsers(client, { observedOn: flag('on') ?? null });
      console.log(JSON.stringify(r, null, 2));
    } else if (cmd === 'snapshot-backfill') {
      const from = flag('from');
      const to = flag('to');
      if (!from || !to) throw new Error('snapshot-backfill needs --from=YYYY-MM-DD --to=YYYY-MM-DD');
      // Preflight: the reconstruction reads ownership out of collection_event,
      // so a ledger that disagrees with collection_item would produce a chart
      // that is confidently wrong. Today is a day both methods can see, which
      // makes this a question with a known right answer.
      const drift = await ledgerAgreesWithCollection(client);
      if (drift.length) {
        console.error(
          '[prices] REFUSING to backfill: the collection_event ledger disagrees with ' +
          'collection_item for ' + drift.length + ' account(s), so reconstructed ' +
          'history would be wrong:' + JSON.stringify(drift, null, 2),
        );
        process.exitCode = 1;
        return;
      }
      const maxStale = flag('max-stale');
      const r = await backfillValuePoints(client, {
        from, to, maxPriceStalenessDays: maxStale ? Number(maxStale) : undefined,
      });
      console.log(JSON.stringify(r, null, 2));
      for (const s of r.skipped) console.warn(`[prices] skipped ${s.date}: ${s.reason}`);
    } else {
      console.error(
        'usage: cli.ts <tcgcsv|cardmarket|crossfill|recompute|backfill|snapshot|snapshot-backfill> [flags]',
      );
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
