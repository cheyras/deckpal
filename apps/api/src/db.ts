import pg from 'pg';
import { loadEnv, makePool } from '@pokedex/db';

/**
 * Shared pool + query helpers for the read API.
 *
 * 🔴 Connection budget: the API gets 2 of the 3 total (see .env / DECISIONS.md).
 * makePool() clamps to a HARD_CAP of 3 regardless, so this can never blow the
 * cluster budget even if PGPOOL_MAX_API is misconfigured.
 *
 * Every query in this app is parameterized ($1,$2,…). No value from the request
 * is ever concatenated into SQL — sort columns and directions are mapped through
 * closed allow-lists (see routes/*), never interpolated.
 */
loadEnv();

export const pool: pg.Pool = makePool(Number(process.env.PGPOOL_MAX_API ?? 2));

export async function q<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: readonly unknown[] = [],
): Promise<T[]> {
  const res = await pool.query<T>(text, params as unknown[]);
  return res.rows;
}

export async function q1<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: readonly unknown[] = [],
): Promise<T | null> {
  const rows = await q<T>(text, params);
  return rows[0] ?? null;
}

/**
 * The single default user. This is a one-user app (ARCHITECTURE §8: user_id is
 * threaded everywhere so multi-user is a later, non-breaking change). Resolved
 * once at boot to the lowest app_user id, falling back to 1.
 */
let cachedUserId: number | null = null;
export async function defaultUserId(): Promise<number> {
  if (cachedUserId !== null) return cachedUserId;
  const row = await q1<{ id: string }>('SELECT id FROM app_user ORDER BY id LIMIT 1');
  cachedUserId = row ? Number(row.id) : 1;
  return cachedUserId;
}

export async function closePool(): Promise<void> {
  await pool.end();
}

// ── Money ───────────────────────────────────────────────────────────────────
// Prices are stored as integer minor units per (variant, source, currency) with
// genuine NULLs. A NULL market_minor means "no price" — NEVER render it as 0.

const MINOR_UNIT: Record<string, number> = { USD: 2, EUR: 2, JPY: 0 };

/** minor int → major-unit number, or null. e.g. (80043,'USD') → 800.43 */
export function toMajor(minor: number | null | undefined, currency: string): number | null {
  if (minor === null || minor === undefined) return null;
  const unit = MINOR_UNIT[currency.trim().toUpperCase()] ?? 2;
  return minor / 10 ** unit;
}

export interface PriceRow {
  source_code: string;
  source_label?: string;
  marketplace?: string;
  currency_code: string;
  market_minor: number | null;
  low_minor: number | null;
  mid_minor: number | null;
  high_minor: number | null;
  direct_low_minor: number | null;
  trend_minor: number | null;
  avg1_minor: number | null;
  avg7_minor: number | null;
  avg30_minor: number | null;
  priced_at: string | null;
  is_fallback: boolean;
}

export interface Price {
  source: string;
  sourceLabel: string | null;
  marketplace: string | null;
  currency: string;
  market: number | null;
  low: number | null;
  mid: number | null;
  high: number | null;
  directLow: number | null;
  trend: number | null;
  avg1: number | null;
  avg7: number | null;
  avg30: number | null;
  pricedAt: string | null;
  isFallback: boolean;
}

export function shapePrice(r: PriceRow): Price {
  const cur = r.currency_code.trim();
  return {
    source: r.source_code,
    sourceLabel: r.source_label ?? null,
    marketplace: r.marketplace ?? null,
    currency: cur,
    market: toMajor(r.market_minor, cur),
    low: toMajor(r.low_minor, cur),
    mid: toMajor(r.mid_minor, cur),
    high: toMajor(r.high_minor, cur),
    directLow: toMajor(r.direct_low_minor, cur),
    trend: toMajor(r.trend_minor, cur),
    avg1: toMajor(r.avg1_minor, cur),
    avg7: toMajor(r.avg7_minor, cur),
    avg30: toMajor(r.avg30_minor, cur),
    pricedAt: r.priced_at,
    isFallback: r.is_fallback,
  };
}

// ── Image references ─────────────────────────────────────────────────────────
// The API returns image *paths*, never bytes — the image service on 3701 serves
// them (behind nginx at the same /pokedex/ base). The card path is a pure
// function of (series tcgdex_id, set tcgdex_id, card local_id); see
// apps/images/src/layout.ts. localId is used verbatim (TCGdex's own padding).

export interface CardImages {
  low: string;
  high: string;
}

export function cardImages(serieTcgdexId: string, setTcgdexId: string, localId: string): CardImages {
  const base = `/pokedex/images/en/${serieTcgdexId}/${setTcgdexId}/${localId}`;
  return { low: `${base}/low.webp`, high: `${base}/high.webp` };
}

// ── TCGplayer buy URL ────────────────────────────────────────────────────────
// Prefer the stored tcgplayer_url (present on tcgcsv-sourced variants); otherwise
// compose from product_id + printing, matching the shape pkmn.gg links to
// (ROUTE-MAP §1.11). Returns null when we have no TCGplayer mapping at all.

export function tcgplayerUrl(
  storedUrl: string | null,
  productId: number | null,
  printing: string | null,
): string | null {
  if (storedUrl) return storedUrl;
  if (productId === null || productId === undefined) return null;
  const params = new URLSearchParams();
  if (printing) params.set('Printing', printing);
  params.set('Condition', 'Near Mint');
  return `https://www.tcgplayer.com/product/${productId}?${params.toString()}`;
}
