/**
 * Collection value: current total, value-over-time series, top movers, and the
 * daily snapshot writer.
 *
 * Money model (see apps/api/src/db.ts): prices are integer minor units per
 * (variant, source, currency), with genuine NULLs meaning "no price" — never 0.
 * "Total collection value" = Σ over owned variants of qty × best market price,
 * computed PER CURRENCY (USD from tcgcsv, EUR from cardmarket coexist as separate
 * rows — they are never summed together). "Best" = the max market_minor across
 * sources within a currency, so a variant priced by two USD sources counts once
 * at its highest quote.
 *
 * collection_value_point is the value-snapshot time series (SCHEMA §3): it is
 * SEPARATE from catalog price history, so "reset collection" can truncate it.
 * snapshotCollectionValue() is what the deckpal-sync cron calls once a day; it is
 * idempotent per (user, day, currency).
 *
 * Pure aggregation lives in aggregateValue(); everything else is a thin DB adapter.
 */
import type pg from 'pg';
import { pool, q, toMajor } from '../db.js';

// The 18m/2y windows were rendered by the web client as decorative "PRO" chips
// with no server support behind them. The owner's call on 2026-08-29: there is
// no paid tier and no plan for one, so the gate was advertising a product that
// does not exist. They are ordinary ranges.
export type Range = '30d' | '3m' | '6m' | '1y' | '18m' | '2y';

const RANGE_INTERVAL: Record<Range, string> = {
  '30d': '30 days',
  '3m': '3 months',
  '6m': '6 months',
  '1y': '1 year',
  '18m': '18 months',
  '2y': '2 years',
};

/** Every range the API accepts, in display order. The web chips mirror this. */
export const RANGES = Object.keys(RANGE_INTERVAL) as Range[];

// ── Pure aggregation ──────────────────────────────────────────────────────────

export interface OwnedPriceRow {
  currency: string;
  qty: number;
  bestMinor: number;
}

export interface CurrencyTotal {
  currency: string;
  totalMinor: number;
  total: number; // major units
  pricedVariants: number;
  quantity: number;
}

/** Fold owned (variant × currency × best-price) rows into per-currency totals. */
export function aggregateValue(rows: readonly OwnedPriceRow[]): CurrencyTotal[] {
  const byCur = new Map<string, { totalMinor: number; pricedVariants: number; quantity: number }>();
  for (const r of rows) {
    const cur = r.currency.trim().toUpperCase();
    const acc = byCur.get(cur) ?? { totalMinor: 0, pricedVariants: 0, quantity: 0 };
    acc.totalMinor += r.qty * r.bestMinor;
    acc.pricedVariants += 1;
    acc.quantity += r.qty;
    byCur.set(cur, acc);
  }
  return [...byCur.entries()]
    .map(([currency, a]) => ({
      currency,
      totalMinor: a.totalMinor,
      total: toMajor(a.totalMinor, currency) ?? 0,
      pricedVariants: a.pricedVariants,
      quantity: a.quantity,
    }))
    .sort((x, y) => x.currency.localeCompare(y.currency));
}

// ── DB adapters ────────────────────────────────────────────────────────────────

/**
 * Best market price per owned variant, per currency (the raw material for the
 * total). One row per (owned variant, currency) that has a market price.
 */
export async function ownedPriceRows(userId: string): Promise<OwnedPriceRow[]> {
  const rows = await q<{ currency_code: string; quantity: number; best_minor: string }>(
    `WITH best AS (
       SELECT pc.card_variant_id, pc.currency_code, max(pc.market_minor) AS best_minor
         FROM price_current pc
        WHERE pc.market_minor IS NOT NULL
        GROUP BY pc.card_variant_id, pc.currency_code
     )
     SELECT b.currency_code, ci.quantity, b.best_minor
       FROM collection_item ci
       JOIN best b ON b.card_variant_id = ci.card_variant_id
      WHERE ci.user_id = $1 AND ci.quantity > 0`,
    [userId],
  );
  return rows.map((r) => ({ currency: r.currency_code, qty: Number(r.quantity), bestMinor: Number(r.best_minor) }));
}

/** Current total collection value, per currency. */
export async function currentCollectionValue(userId: string): Promise<CurrencyTotal[]> {
  return aggregateValue(await ownedPriceRows(userId));
}

/** Collection-wide owned-card counts (distinct cards, distinct pairs, total qty). */
export async function ownedCounts(
  userId: string,
): Promise<{ uniqueCards: number; uniquePairs: number; totalQuantity: number }> {
  const row = await q<{ unique_cards: string; unique_pairs: string; total_qty: string }>(
    `SELECT count(DISTINCT cv.card_id)        AS unique_cards,
            count(DISTINCT ci.card_variant_id) AS unique_pairs,
            COALESCE(sum(ci.quantity), 0)      AS total_qty
       FROM collection_item ci
       JOIN card_variant cv ON cv.id = ci.card_variant_id
      WHERE ci.user_id = $1 AND ci.quantity > 0`,
    [userId],
  );
  const r = row[0];
  return {
    uniqueCards: Number(r?.unique_cards ?? 0),
    uniquePairs: Number(r?.unique_pairs ?? 0),
    totalQuantity: Number(r?.total_qty ?? 0),
  };
}

export interface ValuePoint {
  date: string; // YYYY-MM-DD
  value: number; // major units
  valueMinor: number;
}

export interface ValueSeries {
  currency: string;
  range: Range;
  points: ValuePoint[];
  /** first→last delta within the window (the "Last 30 Days" style card) */
  delta: { valueMinor: number; value: number; pct: number | null } | null;
}

/**
 * Value-over-time series for one currency + range, read from
 * collection_value_point. Also computes the first→last delta over the window
 * (the "Last 30 Days" ▲ $ / ▲ % card). No axis padding — we return only the days
 * that actually exist, so a cold start reads as "not enough history" rather than
 * as a flat line across days nobody measured.
 */
export async function valueSeries(userId: string, range: Range, currency = 'USD'): Promise<ValueSeries> {
  const cur = currency.trim().toUpperCase();
  const rows = await q<{ observed_on: string; total_minor: string }>(
    `SELECT to_char(observed_on, 'YYYY-MM-DD') AS observed_on, total_minor
       FROM collection_value_point
      WHERE user_id = $1 AND currency_code = $2
        AND observed_on >= (CURRENT_DATE - $3::interval)
      ORDER BY observed_on ASC`,
    [userId, cur, RANGE_INTERVAL[range]],
  );
  const points: ValuePoint[] = rows.map((r) => ({
    date: r.observed_on,
    valueMinor: Number(r.total_minor),
    value: toMajor(Number(r.total_minor), cur) ?? 0,
  }));
  let delta: ValueSeries['delta'] = null;
  if (points.length >= 2) {
    const first = points[0]!;
    const last = points[points.length - 1]!;
    const dMinor = last.valueMinor - first.valueMinor;
    delta = {
      valueMinor: dMinor,
      value: toMajor(dMinor, cur) ?? 0,
      pct: first.valueMinor > 0 ? Math.round((dMinor / first.valueMinor) * 10000) / 100 : null,
    };
  }
  return { currency: cur, range, points, delta };
}

export interface Mover {
  cardId: string;
  variantKind: string;
  name: string;
  currency: string;
  quantity: number;
  marketMinor: number;
  market: number;
  avg30Minor: number;
  changeMinor: number; // market - avg30, ×quantity
  change: number;
  changePct: number | null;
}

/**
 * Top movers among owned variants, best-effort. Reference price is the 30-day
 * average; the mover value is (market − avg30) × quantity. Returned
 * biggest-absolute-move first.
 *
 * UXC-07: `price_current.avg30_minor` is a VENDOR-supplied metric, and only
 * Cardmarket's feed carries one (`price_source_field_map`; see cardmarket.ts's
 * `avg30`/`avg30-holo` columns) — TCGCSV/TCGplayer's raw price rows have no
 * such field (tcgcsv.ts `tcgplayerMetrics()` maps only market/low/mid/high/
 * direct-low). Confirmed empirically: 5/5 sampled USD variants had
 * `avg30_minor IS NULL` on every source. That's not a rollup bug — rollup.ts
 * only re-buckets the metrics a source already supplied, it never derives new
 * ones — so under the old query, USD Top Movers (the default currency) could
 * never populate, no matter how long the feed ran.
 *
 * Prefer the vendor's own avg30 when a source supplies one; otherwise fall
 * back to a self-derived 30-day average of `price_observation.market_minor`
 * for the same (variant, currency) — data we already retain for exactly this
 * long (rollup.ts: "last ~30 days daily rows in price_observation", so the
 * window here matches the retention tier exactly, not an arbitrary choice).
 * Collapse overlapping live and archive observations to one best market price
 * per UTC day before averaging; a duplicated day is still one day of history.
 * `HAVING count(*) >= 2` keeps a single day's observations from posing as an
 * "average". Only variants that end up with both a market and a (vendor or
 * derived) avg30 qualify — a sparse feed still yields fewer movers, never a
 * wrong number.
 */
export async function topMovers(userId: string, currency = 'USD', limit = 5): Promise<Mover[]> {
  const cur = currency.trim().toUpperCase();
  const rows = await q<{
    tcgdex_id: string; variant_kind_code: string; name: string; quantity: number;
    market_minor: number; avg30_minor: number;
  }>(
    `WITH owned AS (
       SELECT ci.card_variant_id, ci.quantity
         FROM collection_item ci
        WHERE ci.user_id = $1 AND ci.quantity > 0
     ),
     daily_market AS (
       SELECT po.card_variant_id,
              (po.captured_at AT TIME ZONE 'UTC')::date AS observed_on,
              max(po.market_minor) AS market_minor
         FROM price_observation po
         JOIN owned o ON o.card_variant_id = po.card_variant_id
        WHERE po.currency_code = $2
          AND po.captured_at >= now() - interval '30 days'
          AND po.market_minor IS NOT NULL
        GROUP BY po.card_variant_id, (po.captured_at AT TIME ZONE 'UTC')::date
     ),
     derived_avg30 AS (
       SELECT card_variant_id, round(avg(market_minor))::bigint AS avg30_minor
         FROM daily_market
        GROUP BY card_variant_id
       HAVING count(*) >= 2
     )
     SELECT c.tcgdex_id, cv.variant_kind_code, c.name, o.quantity,
            pc.market_minor, coalesce(pc.avg30_minor, da.avg30_minor) AS avg30_minor
       FROM owned o
       JOIN card_variant cv ON cv.id = o.card_variant_id
       JOIN card c ON c.id = cv.card_id
       JOIN price_current pc ON pc.card_variant_id = cv.id AND pc.currency_code = $2
       LEFT JOIN derived_avg30 da ON da.card_variant_id = o.card_variant_id
      WHERE pc.market_minor IS NOT NULL
        AND coalesce(pc.avg30_minor, da.avg30_minor) IS NOT NULL`,
    [userId, cur],
  );
  return rows
    .map((r) => {
      const qty = Number(r.quantity);
      const changeMinor = (Number(r.market_minor) - Number(r.avg30_minor)) * qty;
      return {
        cardId: r.tcgdex_id,
        variantKind: r.variant_kind_code,
        name: r.name,
        currency: cur,
        quantity: qty,
        marketMinor: Number(r.market_minor),
        market: toMajor(Number(r.market_minor), cur) ?? 0,
        avg30Minor: Number(r.avg30_minor),
        changeMinor,
        change: toMajor(changeMinor, cur) ?? 0,
        changePct:
          Number(r.avg30_minor) > 0
            ? Math.round(((Number(r.market_minor) - Number(r.avg30_minor)) / Number(r.avg30_minor)) * 10000) / 100
            : null,
      };
    })
    .sort((a, b) => Math.abs(b.changeMinor) - Math.abs(a.changeMinor))
    .slice(0, Math.max(0, limit));
}

export interface SnapshotResult {
  observedOn: string;
  inserted: number;
  currencies: { currency: string; totalMinor: number; inserted: boolean }[];
}

/**
 * Append today's total (per currency) to collection_value_point. This is the ONE
 * sanctioned write of this module — the daily cron (deckpal-sync) calls it.
 *
 * Idempotent per (user, observed_on, currency): a second call on the same day is
 * a no-op (ON CONFLICT DO NOTHING), so a cron double-fire or a same-day manual
 * run cannot double-count or overwrite the day's first reading. Pass `observedOn`
 * only for tests; production always snapshots CURRENT_DATE.
 *
 * Takes an optional client so a caller can run it inside its own transaction;
 * defaults to the shared pool.
 */
export async function snapshotCollectionValue(
  userId: string,
  opts: { observedOn?: string; client?: pg.PoolClient } = {},
): Promise<SnapshotResult> {
  const runner = opts.client ?? pool;
  const totals = aggregateValue(await ownedPriceRows(userId));
  const counts = await ownedCounts(userId);
  const observedOn = opts.observedOn ?? null;

  const currencies: SnapshotResult['currencies'] = [];
  let inserted = 0;
  for (const t of totals) {
    const res = await runner.query(
      `INSERT INTO collection_value_point
         (user_id, observed_on, currency_code, total_minor, unique_cards, total_quantity)
       VALUES ($1, COALESCE($2::date, CURRENT_DATE), $3, $4, $5, $6)
       ON CONFLICT (user_id, observed_on, currency_code) DO NOTHING`,
      [userId, observedOn, t.currency, t.totalMinor, counts.uniqueCards, counts.totalQuantity],
    );
    const didInsert = res.rowCount === 1;
    if (didInsert) inserted += 1;
    currencies.push({ currency: t.currency, totalMinor: t.totalMinor, inserted: didInsert });
  }
  const dateRow = await runner.query<{ d: string }>(
    `SELECT to_char(COALESCE($1::date, CURRENT_DATE), 'YYYY-MM-DD') AS d`,
    [observedOn],
  );
  return { observedOn: dateRow.rows[0]!.d, inserted, currencies };
}
