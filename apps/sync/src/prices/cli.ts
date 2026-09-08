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
//                                              A day covered by a price_bucket counts as
//                                              ingested — see alreadyIngestedDays.
//   rollup      [--month=YYYY-MM] [--limit=N] [--dry-run] [--force] [--allow-gaps]
//                                              tiered retention: roll old months up into
//                                              weekly/monthly OHLC buckets, VERIFY them
//                                              against the source, then retire the daily
//                                              partition (dropping it one run later).
//                                              DESTRUCTIVE by design; --dry-run first.
//                                              --limit=0 means drops only, retire nothing.
//                                              --force  = roll a month still inside the
//                                                         30-day daily window.
//                                              --allow-gaps = roll a month with days
//                                                         nobody ever ingested (makes the
//                                                         hole permanent — replay first).
//   value-parity                               does the SQL value rule agree with the
//                                              API's TypeScript one? (live DB, not CI)
//   snapshot    [--on=YYYY-MM-DD]              today's collection-value point, ALL users
//   snapshot-backfill --from=D --to=D [--max-stale=N]
//                                              reconstruct missing value points from the
//                                              collection_event ledger + whichever price
//                                              tier covers each day (daily rows, or a
//                                              bucket CLOSE filed at the bucket's end).
//                                              The staleness gate scales with that tier
//                                              (2/9/33 days) unless --max-stale pins it.
//
// Connection budget: ONE pooled client for the whole process (sync = 1 of 3). DATA-LAYER §6.5.

import { makePool, loadEnv } from '@deckpal/db';
import { ingestTcgcsvPrices, fetchLastUpdated } from './tcgcsv.js';
import { ingestCardmarket } from './cardmarket.js';
import { crossFillReverse, AFFECTED_SERIES } from './crossfill.js';
import { backfillPricesFromArchive } from './backfill.js';
import { runRollup, DEFAULT_MONTH_LIMIT } from './rollup.js';
import {
  backfillValuePoints, ledgerAgreesWithCollection, snapshotAllUsers, valueParity,
} from '../jobs/valueSnapshot.js';
import { recomputeCoverage } from './coverage.js';
import { tryLock, unlock, type Queryable } from './db.js';

/**
 * The two jobs that must never overlap, and why they share a lock.
 *
 * A rollup DURING an incomplete archive replay would bake a partial month into
 * buckets, verify them against the partial source (they would agree — both
 * halves see the same missing days), and drop the rest. Every check would pass
 * and the month would still be wrong.
 *
 * Neither job held a lock before this: `backfill` was a manual command and the
 * rollup did not exist. Now the backfill takes `prices-backfill` for its whole
 * run, and the rollup takes BOTH — so it cannot start while a replay is in
 * flight and a replay cannot start under it. The live 15-minute ingest is
 * deliberately NOT in this set: it writes only the current month, which is
 * inside the daily window and never a rollup target, and blocking the price
 * feed behind a multi-minute rollup would be a worse bug than the one this
 * prevents.
 */
async function withLocks<T>(
  client: Queryable, jobs: readonly string[], fn: () => Promise<T>,
): Promise<T> {
  const held: string[] = [];
  try {
    for (const j of jobs) {
      if (!(await tryLock(client, j))) {
        throw new Error(
          `${j} is already running (advisory lock held). Wait for it to finish — ` +
          'these jobs write the same rows and must not interleave.',
        );
      }
      held.push(j);
    }
    return await fn();
  } finally {
    for (const j of held.reverse()) await unlock(client, j);
  }
}

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
      const r = await withLocks(client, ['prices-backfill'], () =>
        backfillPricesFromArchive(client, {
          from, to,
          sets: list('sets'),
          limit: limitRaw ? Number(limitRaw) : undefined,
          force: flag('force') != null,
          dryRun: flag('dry-run') != null,
        }));
      // Summarised, not dumped: a 31-day chunk would otherwise print 31 objects
      // and bury the one number that says whether to run it again.
      console.log(JSON.stringify({
        processed: r.days.length,
        progressed: r.progressed,
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
      if (r.remaining > 0 && r.progressed > 0) {
        console.warn(`[prices] ${r.remaining} day(s) still to do — run the same command again to continue.`);
      } else if (r.remaining > 0) {
        console.warn(
          `[prices] ${r.remaining} day(s) left but this run ingested nothing — every day it tried is ` +
          'unpublished upstream. Re-running will not help; the range is as complete as TCGCSV allows.',
        );
      }
    } else if (cmd === 'rollup') {
      const limitRaw = flag('limit');
      const dryRun = flag('dry-run') != null;
      // Both locks: see withLocks. A rollup racing a replay is risk 2 in
      // roadmap/plans/price-retention-tiers.md and the one that silently
      // produces a wrong-but-verified month.
      const r = await withLocks(client, ['prices-rollup', 'prices-backfill'], () =>
        runRollup(client, {
          month: flag('month') || undefined,
          // `limitRaw ? …` would read '0' as falsy and silently mean 3.
          limit: limitRaw != null && limitRaw !== '' ? Number(limitRaw) : DEFAULT_MONTH_LIMIT,
          dryRun,
          force: flag('force') != null,
          allowGaps: flag('allow-gaps') != null,
        }));
      const gib = (b: number) => `${(b / 1024 ** 3).toFixed(3)} GiB`;
      console.log(JSON.stringify({
        dryRun,
        today: r.today,
        eligibleMonths: r.eligible,
        adoptedInterruptedDetaches: r.adopted,
        rolled: r.months.map((m) => ({
          month: m.month, grain: m.weekGrain ? 'week+month' : 'month',
          weekBuckets: m.weekBuckets, monthBuckets: m.monthBuckets,
          missingDays: m.missingDays,
          retiredAs: m.retiredAs, verification: m.verification,
        })),
        haltedAt: r.skipped,
        notAttempted: r.blocked,
        droppedPartitions: r.dropped,
        droppedWeekQuarters: r.droppedWeekQuarters,
        bytesReclaimed: r.bytesReclaimed,
        sizes: { priceObservation: gib(r.sizes.priceObservation), priceBucket: gib(r.sizes.priceBucket) },
      }, null, 2));
      for (const s of r.skipped) console.warn(`[prices] HALTED at ${s.month}: ${s.reason}`);
      if (r.blocked.length) {
        console.warn(
          `[prices] ${r.blocked.length} eligible month(s) NOT attempted — ${r.blocked.join(', ')}. ` +
          'Rolling past the month above would move the daily floor beyond it and hide its ' +
          'rows from the price chart at every grain. Fix that month and re-run.',
        );
      }
      for (const a of r.adopted) console.warn(`[prices] adopted from an interrupted run: ${a}`);
      for (const m of r.months.filter((x) => x.missingDays.length)) {
        console.warn(
          `[prices] ${m.month} was rolled up with ${m.missingDays.length} day(s) that carry no ` +
          `observation at all: ${m.missingDays.slice(0, 10).join(', ')}` +
          `${m.missingDays.length > 10 ? ' …' : ''}. That hole is now permanent.`,
        );
      }
      for (const d of r.dropped.filter((x) => !x.dropped)) {
        console.warn(`[prices] NOT dropped ${d.table}: ${d.reason}`);
      }
      if (dryRun) {
        console.warn('[prices] dry run — nothing was written, detached or dropped.');
      } else if (r.months.length) {
        console.warn(
          `[prices] retired ${r.months.length} partition(s); they are DROPPED by the NEXT run, ` +
          'which re-verifies their buckets first. Until then the daily rows are still recoverable ' +
          'from the …_retired tables.',
        );
      }
      if (r.skipped.length || r.blocked.length || r.dropped.some((d) => !d.dropped)) {
        process.exitCode = 1;
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
      // The disclosed cost of tiered retention. A day rebuilt in the weekly
      // band is priced off that week's close, which can be nine days old — that
      // is what the tiers traded away for the disk, and it belongs in the
      // operator's output rather than in a column nobody reads.
      for (const g of r.grains) {
        if (g.grain === 'day') continue;
        console.warn(
          `[prices] ${g.days} day(s) reconstructed at ${g.grain} grain — those points carry a ` +
          `close up to ${g.maxStaleDays} day(s) old, by design. The nightly snapshot remains ` +
          'the primary record; this is repair.',
        );
      }
    } else if (cmd === 'value-parity') {
      // The check the duplicated value rule is kept honest by. Live-DB, so B7
      // keeps it out of CI — run it after touching either copy.
      const diffs = await valueParity(client);
      if (diffs.length === 0) {
        console.log(JSON.stringify({ agree: true }, null, 2));
      } else {
        console.error('[prices] the SQL and TypeScript value rules DISAGREE:');
        console.error(JSON.stringify(diffs, null, 2));
        process.exitCode = 1;
      }
    } else {
      console.error(
        'usage: cli.ts <tcgcsv|cardmarket|crossfill|recompute|backfill|rollup|snapshot|' +
        'snapshot-backfill|value-parity> [flags]',
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
