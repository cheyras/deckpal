// Cardmarket daily price ingest (DATA-LAYER §4.3, §7.2). One request for the ~15 MB public
// price_guide_6.json; version===1 guard; captured_at = the file's own createdAt.
//
// 🔴 THE REVERSE-HOLO TRAP (DATA-LAYER §4, price_source_field_map / SCHEMA §7.3):
//   Cardmarket carries TWO price sets on ONE product object: the base fields (avg/low/trend/avg1/7/30)
//   and the `-holo`-suffixed fields. The `-holo` fields are the REVERSE-HOLO listing, NOT a holo
//   finish. We do NOT string-match "holo"; we read price_source_field_map to learn which upstream
//   fields carry target_finish='reverse', and route those to the card's reverse variant. The base
//   fields go to the card's default (non-reverse) printing. Verified on swsh3-136 Furret
//   (holo:false / reverse:true, yet carries avg-holo/trend-holo).

import { fetchJson } from './http.js';
import { toMinor, type CardmarketFile, type CardmarketGuide, type Metrics } from './types.js';
import {
  type Queryable, type PricePoint, appendObservations, upsertCurrent, ensureObservationPartition,
  startRun, finishRun, lastOkStamp, tryLock, unlock,
} from './db.js';

const URL = 'https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_6.json';
const SOURCE_ID = 2; // price_source.id  'tcgdex-cardmarket'
const SOURCE_CODE = 'tcgdex-cardmarket';
const CURRENCY = 'EUR';
const EUR_MINOR = 2;
const SUPPORTED_VERSION = 1;

// The 6 base fields + their `-holo` (reverse) twins, and which observation column each feeds.
// `trend` is Cardmarket's headline → both market_minor (the hot "market price") and trend_minor.
type Col = 'mid_minor' | 'low_minor' | 'trend_minor' | 'avg1_minor' | 'avg7_minor' | 'avg30_minor';
const BASE_FIELDS: Array<[keyof CardmarketGuide, Col]> = [
  ['avg', 'mid_minor'], ['low', 'low_minor'], ['trend', 'trend_minor'],
  ['avg1', 'avg1_minor'], ['avg7', 'avg7_minor'], ['avg30', 'avg30_minor'],
];
const REVERSE_FIELDS: Array<[keyof CardmarketGuide, Col]> = [
  ['avg-holo', 'mid_minor'], ['low-holo', 'low_minor'], ['trend-holo', 'trend_minor'],
  ['avg1-holo', 'avg1_minor'], ['avg7-holo', 'avg7_minor'], ['avg30-holo', 'avg30_minor'],
];

function metricsFrom(g: CardmarketGuide, fields: Array<[keyof CardmarketGuide, Col]>): Metrics {
  const m: Metrics = {};
  for (const [field, col] of fields) m[col] = toMinor(g[field] as number | null, EUR_MINOR);
  if (m.trend_minor != null) m.market_minor = m.trend_minor; // Cardmarket headline = trend
  return m;
}

// Guard: the field-map must agree that every `-holo` field we treat as reverse is declared reverse,
// and it must not declare any reverse field we are treating as base. This is what makes the field-map
// "do its job" — flip a row in migration 013 and this assertion fires instead of shipping bad prices.
async function assertFieldMap(client: Queryable): Promise<void> {
  const { rows } = await client.query<{ upstream_field: string; target_finish: string }>(
    `SELECT upstream_field, target_finish FROM price_source_field_map WHERE source_code=$1`,
    [SOURCE_CODE],
  );
  const reverseHere = new Set(REVERSE_FIELDS.map(([f]) => f as string));
  const baseHere = new Set(BASE_FIELDS.map(([f]) => f as string));
  for (const r of rows) {
    if (r.target_finish === 'reverse' && !reverseHere.has(r.upstream_field))
      throw new Error(`field-map says ${r.upstream_field} is reverse but importer treats it as base — refusing to ship`);
    if (baseHere.has(r.upstream_field) && r.target_finish === 'reverse')
      throw new Error(`field-map/importer disagree on ${r.upstream_field}`);
  }
}

interface VarRef { cvId: number; finish: string; isPrimary: boolean; sortOrder: number }
const FINISH_RANK: Record<string, number> = { normal: 0, holo: 1, reverse: 2, lenticular: 3, metal: 4 };

async function productVariants(client: Queryable, sets: string[] | null): Promise<Map<number, VarRef[]>> {
  const { rows } = await client.query<{ id: string; pid: number; finish: string; prim: boolean; so: number }>(
    `SELECT cv.id, cv.cardmarket_product_id AS pid, vk.finish, cv.is_primary AS prim, cv.sort_order AS so
       FROM card_variant cv
       JOIN variant_kind vk ON vk.code = cv.variant_kind_code
       JOIN card c ON c.id = cv.card_id
       JOIN card_set s ON s.id = c.set_id
      WHERE cv.cardmarket_product_id IS NOT NULL
        AND ($1::text[] IS NULL OR s.tcgdex_id = ANY($1))`,
    [sets],
  );
  const map = new Map<number, VarRef[]>();
  for (const r of rows) {
    const arr = map.get(r.pid) ?? [];
    arr.push({ cvId: Number(r.id), finish: r.finish, isPrimary: r.prim, sortOrder: r.so });
    map.set(r.pid, arr);
  }
  return map;
}

// base bucket → default non-reverse printing (is_primary, else lowest finish rank);
// reverse bucket → the reverse variant. Never invents a variant; only routes to existing ones.
function route(vars: VarRef[]): { base?: VarRef; reverse?: VarRef } {
  const reverse = vars.find((v) => v.finish === 'reverse');
  const nonRev = vars.filter((v) => v.finish !== 'reverse');
  nonRev.sort((a, b) => (Number(b.isPrimary) - Number(a.isPrimary)) || (FINISH_RANK[a.finish]! - FINISH_RANK[b.finish]!) || (a.sortOrder - b.sortOrder));
  const base = nonRev[0] ?? reverse; // reverse-only product: base fields describe the reverse listing
  return { base, reverse: reverse && reverse !== base ? reverse : undefined };
}

export interface CardmarketResult {
  version: number; createdAt: string; guides: number; matchedProducts: number;
  observations: number; pricedVariants: number; skipped: boolean;
}
export interface CardmarketOpts { sets?: string[]; force?: boolean; file?: CardmarketFile }

export async function ingestCardmarket(client: Queryable, opts: CardmarketOpts = {}): Promise<CardmarketResult> {
  const filter = opts.sets && opts.sets.length ? opts.sets : null;
  // ⚠ FLAGGED DEVIATION from DATA-LAYER §4.3's "stream, don't json.load": no stream-json dependency
  //   is vendored, so we JSON.parse the ~15 MB file (≈100 MB transient heap). Acceptable as a
  //   once-daily job on the Pi 5; revisit with a streaming parser if heap pressure appears.
  const file = opts.file ?? (await fetchJson<CardmarketFile>(URL, { minIntervalMs: 0, timeoutMs: 60_000 }));
  if (file.version !== SUPPORTED_VERSION) throw new Error(`Cardmarket version ${file.version} != ${SUPPORTED_VERSION} — bailing (schema may have changed)`);
  const capturedAt = new Date(file.createdAt);
  if (Number.isNaN(capturedAt.getTime())) throw new Error(`unparseable Cardmarket createdAt: "${file.createdAt}"`);

  if (!(await tryLock(client, 'prices-cardmarket'))) throw new Error('prices-cardmarket already running (advisory lock held)');
  try {
    if (!opts.force && !filter) {
      const last = await lastOkStamp(client, 'prices-cardmarket');
      if (last === file.createdAt) return { version: file.version, createdAt: file.createdAt, guides: file.priceGuides.length, matchedProducts: 0, observations: 0, pricedVariants: 0, skipped: true };
    }
    await assertFieldMap(client);
    const runId = await startRun(client, 'prices-cardmarket', file.createdAt);
    await ensureObservationPartition(client, capturedAt);
    const byProduct = await productVariants(client, filter);

    const points: PricePoint[] = [];
    let matchedProducts = 0;
    for (const g of file.priceGuides) {
      const vars = byProduct.get(g.idProduct);
      if (!vars) continue;
      matchedProducts++;
      const { base, reverse } = route(vars);
      if (base) points.push({ cardVariantId: base.cvId, sourceId: SOURCE_ID, sourceCode: SOURCE_CODE, currency: CURRENCY, metrics: metricsFrom(g, BASE_FIELDS) });
      if (reverse) points.push({ cardVariantId: reverse.cvId, sourceId: SOURCE_ID, sourceCode: SOURCE_CODE, currency: CURRENCY, metrics: metricsFrom(g, REVERSE_FIELDS) });
    }
    let observations = 0;
    try {
      await client.query('BEGIN');
      observations = await appendObservations(client, points, capturedAt, runId);
      await upsertCurrent(client, points, capturedAt);
      await client.query('COMMIT');
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch { /* ignore */ }
      await finishRun(client, runId, 'failed', { error: (err as Error).message });
      throw err;
    }
    await finishRun(client, runId, 'ok', { rowsWritten: observations, itemsSeen: matchedProducts });
    return { version: file.version, createdAt: file.createdAt, guides: file.priceGuides.length, matchedProducts, observations, pricedVariants: points.length, skipped: false };
  } finally {
    await unlock(client, 'prices-cardmarket');
  }
}
