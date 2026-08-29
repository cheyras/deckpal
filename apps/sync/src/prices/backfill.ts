// Replay TCGCSV's daily archives into `price_observation` for a past date range.
//
// Repair and history, not a routine job. The live ingest owns the present; this
// exists because the scheduled jobs stopped on 2026-08-08 and left three weeks
// with no prices at all — see `archive.ts` for how that turned out to be
// recoverable, and DECISIONS.md 2026-08-29 for why it nearly was not.
//
// It is also how the value chart gets a past longer than its own uptime: the
// owner's call (2026-08-29) was a two-year replay, so every range chip —
// including the 18m and 2y ones that used to be decorative PRO badges — has
// real observations behind it rather than a caption apologising for their
// absence.
//
// ── Cost, measured rather than guessed ─────────────────────────────────────
// One archived day carries 44,385 Pokémon price rows with a market price
// (2026-08-15, counted). Two years is ~32M `price_observation` rows and ~3-4 GB
// once the primary key index is counted. That is a real fraction of a Supabase
// Pro disk, which is why the range is an explicit argument and not a default.
//
// ── Contracts ───────────────────────────────────────────────────────────────
// B8  Idempotent by construction: `appendObservations` is ON CONFLICT DO
//     NOTHING on the natural key, AND `alreadyIngestedDays` skips whole days
//     that are already present, so a re-run costs one query rather than 730
//     downloads. A run that dies halfway is resumed by running it again.
// B2  One connection. The per-day transaction is the unit of work.

import { resolveSets, variantLookup, type SetRef } from './tcgcsv.js';
import { archiveCapturedAt, fetchArchiveDay, find7z } from './archive.js';
import {
  appendObservations, ensureObservationPartition, type PricePoint, type Queryable,
} from './db.js';
import { toMinor, type TcgcsvPriceRow } from './types.js';

const SOURCE_ID = 1; // price_source.id for tcgcsv — matches tcgcsv.ts
const SOURCE_CODE = 'tcgcsv';
const CURRENCY = 'USD';
const USD_MINOR = 2;

/** Same nine-column metric bag the live ingest writes. */
function metricsOf(row: TcgcsvPriceRow) {
  return {
    market_minor: toMinor(row.marketPrice, USD_MINOR),
    low_minor: toMinor(row.lowPrice, USD_MINOR),
    mid_minor: toMinor(row.midPrice, USD_MINOR),
    high_minor: toMinor(row.highPrice, USD_MINOR),
    direct_low_minor: toMinor(row.directLowPrice, USD_MINOR),
  };
}

export interface PriceBackfillOpts {
  from: string;
  to: string;
  /** Restrict to these set tcgdex ids. Omit for every set with a group id. */
  sets?: string[];
  /** Stop after this many days actually processed — the chunking knob. */
  limit?: number;
  /** Replay days that already have observations (normally skipped). */
  force?: boolean;
  /** Report what would be written without writing it. */
  dryRun?: boolean;
}

export interface PriceBackfillDay {
  date: string;
  groupsMatched: number;
  observations: number;
  unmatchedRows: number;
}

export interface PriceBackfillResult {
  /** Days in range that already had data and were not re-downloaded. */
  alreadyPresent: number;
  /** Days still to do after this run — 0 means the range is complete. */
  remaining: number;
  days: PriceBackfillDay[];
  missingDays: string[];
  observations: number;
}

/**
 * Which days in the range already carry tcgcsv observations.
 *
 * The whole point of a chunked replay: without this, run 12 of 24 would
 * re-download the 340 days runs 1-11 already did. One index scan answers it.
 */
async function alreadyIngestedDays(
  client: Queryable, from: string, to: string,
): Promise<Set<string>> {
  const { rows } = await client.query<{ d: string }>(
    `SELECT DISTINCT to_char(captured_at, 'YYYY-MM-DD') AS d
       FROM price_observation
      WHERE source_code = $3
        AND captured_at >= $1::date
        AND captured_at < ($2::date + 1)`,
    [from, to, SOURCE_ID],
  );
  return new Set(rows.map((r) => r.d));
}

/**
 * Which days this run should actually fetch, and how many are left afterwards.
 *
 * Pure, and separated from the fetching for exactly one reason: this is the
 * whole resume protocol. A chunked replay is ~16 sequential runs, and the way
 * that goes wrong is silently — a slice that always starts at day 0 makes run 12
 * re-download the 340 days runs 1-11 already did, and every run reports success
 * while the range never advances. Testable without a database or a 7z binary.
 */
export function selectDays(
  allDays: readonly string[],
  alreadyDone: ReadonlySet<string>,
  limit?: number,
): { slice: string[]; remaining: number } {
  const todo = allDays.filter((d) => !alreadyDone.has(d));
  const slice = limit && limit > 0 ? todo.slice(0, limit) : [...todo];
  return { slice, remaining: todo.length - slice.length };
}

export async function backfillPricesFromArchive(
  client: Queryable,
  opts: PriceBackfillOpts,
): Promise<PriceBackfillResult> {
  const sevenZip = await find7z();
  const sets = await resolveSets(client, opts.sets && opts.sets.length ? opts.sets : null);

  // ONE lookup per set for the whole run. `writeSetPrices` builds one per call,
  // which is right for a single live day and quadratic nonsense across 730.
  const lutBySet = new Map<number, Map<string, number>>();
  const byGroup = new Map<number, SetRef>();
  for (const s of sets) {
    byGroup.set(s.groupId, s);
    lutBySet.set(s.setId, await variantLookup(client, s.setId));
  }

  const { rows: dayRows } = await client.query<{ d: string }>(
    `SELECT to_char(gs::date, 'YYYY-MM-DD') AS d
       FROM generate_series($1::date, $2::date, interval '1 day') gs
      WHERE gs::date <= CURRENT_DATE
      ORDER BY 1`,
    [opts.from, opts.to],
  );

  const done = opts.force ? new Set<string>() : await alreadyIngestedDays(client, opts.from, opts.to);
  const { slice, remaining } = selectDays(dayRows.map((r) => r.d), done, opts.limit);

  const days: PriceBackfillDay[] = [];
  const missingDays: string[] = [];
  let observations = 0;

  for (const d of slice) {
    const archive = await fetchArchiveDay(d, sevenZip);
    if (!archive) {
      // TCGCSV has not published every historical day. A gap is a fact to
      // report, not a crash — and not a reason to abandon the other 729.
      missingDays.push(d);
      continue;
    }
    const capturedAt = archiveCapturedAt(d);
    await ensureObservationPartition(client, capturedAt);

    const points: PricePoint[] = [];
    let matched = 0;
    let unmatched = 0;
    for (const [groupId, rows] of archive.groups) {
      const set = byGroup.get(groupId);
      if (!set) continue; // a TCGplayer group this catalogue does not carry
      matched += 1;
      const lut = lutBySet.get(set.setId)!;
      for (const row of rows) {
        const cv = lut.get(`${row.productId}|${row.subTypeName}`);
        if (cv == null) { unmatched += 1; continue; }
        points.push({
          cardVariantId: cv, sourceId: SOURCE_ID, sourceCode: SOURCE_CODE,
          currency: CURRENCY, metrics: metricsOf(row),
        });
      }
    }

    let dayObs = 0;
    if (!opts.dryRun) {
      // One transaction per day: a day is the unit that is either recorded or
      // not. `price_current` is deliberately NOT touched — it holds the LATEST
      // price, and replaying 2024 through it would leave the whole app quoting
      // two-year-old prices as today's.
      await client.query('BEGIN');
      try {
        dayObs = await appendObservations(client, points, capturedAt, null);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }

    observations += dayObs;
    days.push({ date: d, groupsMatched: matched, observations: dayObs, unmatchedRows: unmatched });
  }

  return { alreadyPresent: done.size, remaining, days, missingDays, observations };
}
