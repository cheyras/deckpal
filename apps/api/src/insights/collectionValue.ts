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
 * snapshotCollectionValue() is what the deckscout-sync cron calls once a day; it is
 * idempotent per (user, day, currency).
 *
 * Pure aggregation lives in aggregateValue(); everything else is a thin DB adapter.
 */
import type pg from 'pg';
import { pool, q, toMajor } from '../db.js';

export type Range = '30d' | '3m' | '6m' | '1y';

const RANGE_INTERVAL: Record<Range, string> = {
  '30d': '30 days',
  '3m': '3 months',
  '6m': '6 months',
  '1y': '1 year',
};

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
export async function ownedPriceRows(userId: number): Promise<OwnedPriceRow[]> {
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
export async function currentCollectionValue(userId: number): Promise<CurrencyTotal[]> {
  return aggregateValue(await ownedPriceRows(userId));
}

/** Collection-wide owned-card counts (distinct cards, distinct pairs, total qty). */
export async function ownedCounts(
  userId: number,
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
 * (pkmn.gg's "Last 30 Days" ▲ $ / ▲ % card). No axis padding —
 * we render only the days that exist, matching pkmn.gg's cold-start behaviour.
 */
export async function valueSeries(userId: number, range: Range, currency = 'USD'): Promise<ValueSeries> {
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
 * Top movers among owned variants, best-effort. Uses price_current.avg30_minor
 * as the reference (30-day average) and the current market as "now"; the mover
 * value is (market − avg30) × quantity. Only variants that carry BOTH a market
 * and an avg30 quote qualify — a sparse feed simply yields fewer movers, never a
 * wrong number. Returned biggest-absolute-move first.
 */
export async function topMovers(userId: number, currency = 'USD', limit = 5): Promise<Mover[]> {
  const cur = currency.trim().toUpperCase();
  const rows = await q<{
    tcgdex_id: string; variant_kind_code: string; name: string; quantity: number;
    market_minor: number; avg30_minor: number;
  }>(
    `SELECT c.tcgdex_id, cv.variant_kind_code, c.name, ci.quantity,
            pc.market_minor, pc.avg30_minor
       FROM collection_item ci
       JOIN card_variant cv ON cv.id = ci.card_variant_id
       JOIN card c ON c.id = cv.card_id
       JOIN price_current pc ON pc.card_variant_id = cv.id AND pc.currency_code = $2
      WHERE ci.user_id = $1 AND ci.quantity > 0
        AND pc.market_minor IS NOT NULL AND pc.avg30_minor IS NOT NULL`,
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
 * sanctioned write of this module — the daily cron (deckscout-sync) calls it.
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
  userId: number,
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
