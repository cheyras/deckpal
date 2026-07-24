// TCGCSV daily bulk price ingest (DATA-LAYER §4.2, §7.2/§7.3).
//
// Walk the sets that carry a TCGplayer groupId, fetch each group's `prices`, join every price row
// to a card_variant on (tcgplayer_product_id, tcgplayer_printing) ↔ (productId, subTypeName), and
// append idempotent price_observation rows + upsert price_current. One transaction per group so a
// crash resumes mid-list; captured_at = TCGCSV's own last-updated.txt stamp, never now().

import { fetchText, fetchJson } from './http.js';
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
async function variantLookup(client: Queryable, setId: number): Promise<Map<string, number>> {
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
}

// Reusable per-set writer: given already-fetched price rows, join + write. Returns rows written.
export async function writeSetPrices(
  client: Queryable, setId: number, prices: TcgcsvPriceRow[], capturedAt: Date, runId: number | null,
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
  await upsertCurrent(client, points, capturedAt);
  return { observations, matched: points.length, unmatched };
}

export interface IngestOpts { sets?: string[]; force?: boolean }

export async function ingestTcgcsvPrices(client: Queryable, opts: IngestOpts = {}): Promise<PriceIngestResult> {
  const filter = opts.sets && opts.sets.length ? opts.sets : null;
  const stamp = await fetchLastUpdated();
  const capturedAt = new Date(stamp); // the source's own timestamp — NOT now()
  if (Number.isNaN(capturedAt.getTime())) throw new Error(`unparseable last-updated.txt: "${stamp}"`);

  if (!(await tryLock(client, 'prices-tcgcsv'))) throw new Error('prices-tcgcsv already running (advisory lock held)');
  try {
    // Skip-if-unchanged: only gate a full run (no set filter). A targeted --sets run always proceeds.
    if (!opts.force && !filter) {
      const last = await lastOkStamp(client, 'prices-tcgcsv');
      if (last === stamp) return { sets: 0, groupsFetched: 0, observations: 0, current: 0, pricedVariants: 0, unmatchedRows: 0, skipped: true, stamp };
    }
    const runId = await startRun(client, 'prices-tcgcsv', stamp);
    await ensureObservationPartition(client, capturedAt);
    const sets = await resolveSets(client, filter);
    let observations = 0, matched = 0, unmatched = 0, groupsFetched = 0, lastGroup: number | null = null;
    try {
      for (const s of sets) {
        const prices = await fetchGroupPrices(s.groupId);
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
    return { sets: sets.length, groupsFetched, observations, current: matched, pricedVariants: matched, unmatchedRows: unmatched, skipped: false, stamp };
  } finally {
    await unlock(client, 'prices-tcgcsv');
  }
}
