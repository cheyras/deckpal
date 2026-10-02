// TCGCSV daily bulk price ingest (DATA-LAYER §4.2, §7.2/§7.3).
//
// Walk the sets that carry a TCGplayer groupId, fetch each group's `prices`, join every price row
// to a card_variant on (tcgplayer_product_id, tcgplayer_printing) ↔ (productId, subTypeName), and
// append idempotent price_observation rows + upsert price_current. One transaction per group so a
// crash resumes mid-list; captured_at = TCGCSV's own last-updated.txt stamp, never now().

import { fetchText, fetchJson, RateLimited } from './http.js';
import { linkTcgcsvProducts } from './linkTcgcsv.js';
import { toMinor, type TcgcsvPriceEnvelope, type TcgcsvPriceRow, type Metrics } from './types.js';
import {
  type Queryable, type PricePoint, appendObservations, upsertCurrent, ensureObservationPartition,
  startRun, finishRun, lastOkStamp, tryLock, unlock,
} from './db.js';

const BASE = 'https://tcgcsv.com/tcgplayer/3';
const SOURCE_ID = 1; // price_source.id  (SMALLINT) for price_observation
const SOURCE_CODE = 'tcgcsv'; // price_source.code (TEXT)  for price_current
const CURRENCY = 'USD';
const USD_MINOR = 2;

export async function fetchLastUpdated(): Promise<string> {
  return (await fetchText('https://tcgcsv.com/last-updated.txt')).trim();
}
export async function fetchGroupPrices(groupId: number): Promise<TcgcsvPriceRow[]> {
  const env = await fetchJson<TcgcsvPriceEnvelope>(`${BASE}/${groupId}/prices`);
  if (!env.success) throw new Error(`TCGCSV prices ${groupId}: ${env.errors.join('; ') || 'success=false'}`);
  return env.results;
}

// TCGplayer price row → the 9-column metric bag. Printing is carried by the join, not the metric.
export function tcgplayerMetrics(row: TcgcsvPriceRow): Metrics {
  return {
    market_minor: toMinor(row.marketPrice, USD_MINOR),
    low_minor: toMinor(row.lowPrice, USD_MINOR),
    mid_minor: toMinor(row.midPrice, USD_MINOR),
    high_minor: toMinor(row.highPrice, USD_MINOR),
    direct_low_minor: toMinor(row.directLowPrice, USD_MINOR),
  };
}

export interface SetRef { setId: number; tcgdexId: string; groupId: number }

export async function resolveSets(client: Queryable, filter: string[] | null): Promise<SetRef[]> {
  const { rows } = await client.query<{ id: string; tcgdex_id: string; g: number }>(
    `SELECT id, tcgdex_id, tcgplayer_group_id AS g FROM card_set
       WHERE tcgplayer_group_id IS NOT NULL
         AND ($1::text[] IS NULL OR tcgdex_id = ANY($1))
       ORDER BY tcgplayer_group_id`,
    [filter],
  );
  return rows.map((r) => ({ setId: Number(r.id), tcgdexId: r.tcgdex_id, groupId: Number(r.g) }));
}

// (productId, printing) → card_variant.id for one set. Printing-aware so the two rows of a shared
// product (Normal + Reverse Holofoil) each land on the right variant — this is where the TCGplayer
// side of the reverse-holo distinction is honoured (it is keyed by printing name, unlike Cardmarket).
// Exported for the archive backfill, which builds one lookup per SET ONCE and
// reuses it across every replayed day. Calling this per (set, day) instead would
// be 217 x 730 = 158,000 identical queries for a two-year replay.
export async function variantLookup(client: Queryable, setId: number): Promise<Map<string, number>> {
  const { rows } = await client.query<{ id: string; pid: number; printing: string | null }>(
    `SELECT cv.id, cv.tcgplayer_product_id AS pid, cv.tcgplayer_printing AS printing
       FROM card_variant cv JOIN card c ON c.id = cv.card_id
      WHERE c.set_id = $1 AND cv.tcgplayer_product_id IS NOT NULL`,
    [setId],
  );
  const m = new Map<string, number>();
  for (const r of rows) if (r.printing) m.set(`${r.pid}|${r.printing}`, Number(r.id));
  return m;
}

export interface PriceIngestResult {
  sets: number; groupsFetched: number; observations: number; current: number;
  pricedVariants: number; unmatchedRows: number; skipped: boolean; stamp: string;
  /** What the link pass did before the walk (linkTcgcsv.ts); zeros when it had nothing to do. */
  linkedVariants: number; assignedGroups: number;
}

// Reusable per-set writer: given already-fetched price rows, join + write. Returns rows written.
//
// `updateCurrent` exists for the archive backfill and defaults to the live
// behaviour. `price_current` is the LATEST price per variant, with no history —
// so replaying an archive from three weeks ago through this function with the
// default would leave every card in the app quoting a three-week-old price as
// if it were today's. The backfill appends observations and leaves the hot
// snapshot alone; only a live run may write it.
export async function writeSetPrices(
  client: Queryable, setId: number, prices: TcgcsvPriceRow[], capturedAt: Date, runId: number | null,
  opts: { updateCurrent?: boolean } = {},
): Promise<{ observations: number; matched: number; unmatched: number }> {
  const lut = await variantLookup(client, setId);
  const points: PricePoint[] = [];
  let unmatched = 0;
  for (const row of prices) {
    const cv = lut.get(`${row.productId}|${row.subTypeName}`);
    if (cv == null) { unmatched++; continue; }
    points.push({ cardVariantId: cv, sourceId: SOURCE_ID, sourceCode: SOURCE_CODE, currency: CURRENCY, metrics: tcgplayerMetrics(row) });
  }
  const observations = await appendObservations(client, points, capturedAt, runId);
  if (opts.updateCurrent !== false) await upsertCurrent(client, points, capturedAt);
  return { observations, matched: points.length, unmatched };
}

export interface IngestOpts {
  sets?: string[]; force?: boolean;
  /** Run the link pass (default true). Off only for tests and for isolating a price bug. */
  link?: boolean;
}

/** Test seams: the three things `ingestTcgcsvPrices` reaches over the network. */
export interface IngestDeps {
  fetchLastUpdated?: () => Promise<string>;
  fetchGroupPrices?: (groupId: number) => Promise<TcgcsvPriceRow[]>;
  linkProducts?: typeof linkTcgcsvProducts;
}

interface LinkStepResult { linked: number; assigned: number; failure: string | null }

/**
 * The link pass as its OWN sync_run job (`products-tcgcsv`), keyed on TCGCSV's stamp like the price
 * ingest. That is what lets it retry independently: a failed link run is recorded `failed`, which
 * `lastOkStamp` does not count, so the next 15-minute tick tries the link pass again instead of
 * waiting for tomorrow's stamp — and a good one is recorded `ok`, so it costs one query per tick.
 * A run restricted with `--sets` records no stamp, so it can never satisfy the full run.
 */
async function runLinkStep(
  client: Queryable, stamp: string, filter: string[] | null, link: typeof linkTcgcsvProducts,
): Promise<LinkStepResult> {
  let runId: number | null = null;
  try {
    runId = await startRun(client, 'products-tcgcsv', filter ? null : stamp);
    const r = await link(client, { sets: filter });
    const failed = r.failedSets.length;
    await finishRun(client, runId, failed ? 'failed' : 'ok', {
      rowsWritten: r.variantsLinked, itemsSeen: r.setsScanned, itemsFailed: failed,
      cursor: { groupsAssigned: r.groupsAssigned, unresolvedSets: r.unresolvedSets },
      error: failed ? `${failed} set(s) failed: ${r.failedSets.slice(0, 5).map((f) => `${f.set}: ${f.error}`).join('; ')}` : undefined,
    });
    return {
      linked: r.variantsLinked, assigned: r.groupsAssigned,
      failure: failed ? `${failed} set(s) could not be linked (${r.failedSets[0]!.set}: ${r.failedSets[0]!.error})` : null,
    };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* nothing open */ }
    // Recording the failure is best-effort: if the database is what failed, the original error is
    // the one to report, and the next run's sweep (below) clears whatever row was left behind.
    if (runId != null) {
      try { await finishRun(client, runId, 'failed', { error: err instanceof Error ? err.message : String(err) }); } catch { /* see above */ }
    }
    if (err instanceof RateLimited) throw err; // TCGCSV's policy is to stop the whole run
    return { linked: 0, assigned: 0, failure: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * `sync_run_one_active` allows ONE `running` row per job, and nothing else ever clears one: a run
 * that is cancelled, loses its runner or its connection leaves its row `running` forever, and every
 * later `startRun` for that job then fails on the unique index. For the link pass that would have
 * stopped ALL price ingestion (it runs in front of the walk) until someone edited the table by hand.
 * Called only while holding the `prices-tcgcsv` advisory lock — the one lock both jobs run under — so
 * a `running` row seen here cannot belong to a live run. `orphaned` is in the status CHECK and is not
 * counted by `lastOkStamp`, so the interrupted work is retried.
 */
async function sweepInterruptedRuns(client: Queryable): Promise<void> {
  await client.query(
    `UPDATE sync_run SET status = 'orphaned', finished_at = now(),
            error = 'left running by an interrupted run; cleared by the next run'
      WHERE job = ANY($1::text[]) AND status = 'running'`,
    [['prices-tcgcsv', 'products-tcgcsv']],
  );
}

export async function ingestTcgcsvPrices(
  client: Queryable, opts: IngestOpts = {}, deps: IngestDeps = {},
): Promise<PriceIngestResult> {
  const filter = opts.sets && opts.sets.length ? opts.sets : null;
  const stamp = await (deps.fetchLastUpdated ?? fetchLastUpdated)();
  const capturedAt = new Date(stamp); // the source's own timestamp — NOT now()
  if (Number.isNaN(capturedAt.getTime())) throw new Error(`unparseable last-updated.txt: "${stamp}"`);
  const walkPrices = deps.fetchGroupPrices ?? fetchGroupPrices;

  if (!(await tryLock(client, 'prices-tcgcsv'))) throw new Error('prices-tcgcsv already running (advisory lock held)');
  try {
    await sweepInterruptedRuns(client);
    // Skip-if-unchanged: only gate a full run (no set filter). A targeted --sets run always proceeds.
    const pricesUnchanged = !opts.force && !filter && (await lastOkStamp(client, 'prices-tcgcsv')) === stamp;

    // Link first: the walk below starts from "sets that carry a groupId" and joins on "variants that
    // carry a productId", so a link made after it prices the card a day late. It is decided apart
    // from the price skip, so a failed link pass is retried on the next tick even though today's
    // prices are already in. A failure is held and thrown once the prices that CAN be written are
    // written, so the job goes red rather than cards staying unpriced behind a green dashboard.
    let linkRun: LinkStepResult = { linked: 0, assigned: 0, failure: null };
    if (opts.link !== false) {
      const due = !!filter || !!opts.force || (await lastOkStamp(client, 'products-tcgcsv')) !== stamp;
      if (due) linkRun = await runLinkStep(client, stamp, filter, deps.linkProducts ?? linkTcgcsvProducts);
    }
    const linkFailed = (): Error =>
      new Error(`the TCGCSV link pass failed, so cards TCGdex has no TCGplayer id for stay unpriced: ${linkRun.failure}`);

    if (pricesUnchanged) {
      if (linkRun.failure) throw linkFailed();
      return {
        sets: 0, groupsFetched: 0, observations: 0, current: 0, pricedVariants: 0, unmatchedRows: 0,
        skipped: true, stamp, linkedVariants: linkRun.linked, assignedGroups: linkRun.assigned,
      };
    }

    const runId = await startRun(client, 'prices-tcgcsv', stamp);
    await ensureObservationPartition(client, capturedAt);
    const sets = await resolveSets(client, filter);
    let observations = 0, matched = 0, unmatched = 0, groupsFetched = 0, lastGroup: number | null = null;
    try {
      for (const s of sets) {
        const prices = await walkPrices(s.groupId);
        groupsFetched++;
        await client.query('BEGIN');
        const r = await writeSetPrices(client, s.setId, prices, capturedAt, runId);
        await client.query('COMMIT');
        observations += r.observations; matched += r.matched; unmatched += r.unmatched;
        lastGroup = s.groupId;
      }
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch { /* ignore */ }
      await finishRun(client, runId, 'partial', { rowsWritten: observations, itemsSeen: groupsFetched, cursor: { lastGroup }, error: (err as Error).message });
      throw err;
    }
    await finishRun(client, runId, 'ok', { rowsWritten: observations, itemsSeen: groupsFetched, cursor: { lastGroup } });
    if (linkRun.failure) throw linkFailed();
    return {
      sets: sets.length, groupsFetched, observations, current: matched, pricedVariants: matched,
      unmatchedRows: unmatched, skipped: false, stamp, linkedVariants: linkRun.linked, assignedGroups: linkRun.assigned,
    };
  } finally {
    await unlock(client, 'prices-tcgcsv');
  }
}
