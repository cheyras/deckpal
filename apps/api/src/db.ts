import { AsyncLocalStorage } from 'node:async_hooks';
import pg from 'pg';
import { loadEnv, makePool } from '@deckscout/db';

/**
 * Shared pool + query helpers for the read API.
 *
 * 🔴 Connection budget. This is the 'request' pool, and in SUPABASE_MODE its
 * `max` IS the server's maximum concurrent requests — the RLS middleware in
 * index.ts checks out one pooled connection for the whole lifetime of every
 * request. It was previously pinned at 2 by a cap written for a co-hosted
 * Postgres box, which meant one SPA page load (6+ parallel calls, doubled
 * again by React StrictMode in dev) exhausted the pool and everything past
 * the second call timed out. makePool now sizes and routes this by role; see
 * packages/db/src/pool.ts and DECISIONS.md 2026-08-11.
 *
 * PGPOOL_MAX_API still wins when set, so the constrained self-host deployment
 * keeps its 2 by configuration rather than by a global ceiling.
 *
 * Every query in this app is parameterized ($1,$2,…). No value from the request
 * is ever concatenated into SQL — sort columns and directions are mapped through
 * closed allow-lists (see routes/*), never interpolated.
 */
loadEnv();

const apiMax = Number(process.env.PGPOOL_MAX_API ?? NaN);
export const pool: pg.Pool = makePool({
  role: 'request',
  ...(Number.isFinite(apiMax) ? { max: apiMax } : {}),
});

// ── Per-request RLS context (defense-in-depth for Supabase deployments) ─────
//
// When SUPABASE_MODE is set, a middleware wraps each authenticated request in a
// transaction with SET LOCAL role = 'authenticated' + request.jwt.claims so that
// RLS policies fire transparently on every query — even if a route forgets a
// WHERE user_id clause. Self-host deployments leave SUPABASE_MODE unset and all
// of this is a no-op (plain Postgres lacks the roles/auth schema).
//
// The rlsStore (AsyncLocalStorage) holds the per-request PoolClient. q(), q1(),
// and withTx() check the store before touching the pool, so existing routes work
// unchanged — no call-site rewrites required.

const SUPABASE_MODE = !!process.env.SUPABASE_MODE;
export { SUPABASE_MODE };

/** AsyncLocalStorage carrying the per-request RLS-enabled PoolClient. */
export const rlsStore = new AsyncLocalStorage<pg.PoolClient>();

/**
 * Run `fn` inside a per-request RLS context (defense-in-depth).
 *
 * When SUPABASE_MODE is set:
 *   1. Check out a PoolClient and BEGIN a transaction.
 *   2. SET LOCAL role = 'authenticated' and set request.jwt.claims so
 *      auth.uid() resolves to `userId` for the remainder of the transaction.
 *   3. Run `fn` inside the AsyncLocalStorage context (q/q1/withTx pick it up).
 *   4. COMMIT (or ROLLBACK on error) and release the client.
 *
 * When SUPABASE_MODE is unset: passthrough — `fn` runs directly with no RLS,
 * and the existing parameterized-query pattern is the sole access-control layer.
 */
export async function withUserContext<T>(
  userId: string,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  if (!SUPABASE_MODE) {
    // Self-host: no RLS, no role switching. Hand the caller a plain client.
    const client = await pool.connect();
    try {
      return await fn(client);
    } finally {
      client.release();
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('request.jwt.claims', $1, true)`,
      [JSON.stringify({ sub: userId, role: 'authenticated' })],
    );
    await client.query(`SET LOCAL role = 'authenticated'`);
    const result = await rlsStore.run(client, () => fn(client));
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore rollback failure — original error is what matters */
    }
    throw err;
  } finally {
    // RESET ROLE so the connection is returned to the pool in a clean state.
    // This is defensive: pg releases connections back to the pool after the
    // COMMIT/ROLLBACK above, but if the connection is reused before the pool
    // closes, we want the role to be the connection default (the pool user),
    // not 'authenticated'.
    try {
      await client.query('RESET ROLE');
    } catch {
      /* best-effort; the pool will discard a broken connection */
    }
    client.release();
  }
}

export async function q<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: readonly unknown[] = [],
): Promise<T[]> {
  const rlsClient = rlsStore.getStore();
  if (rlsClient) {
    const res = await rlsClient.query<T>(text, params as unknown[]);
    return res.rows;
  }
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
 * The single local user — the self-host answer to "who is the current user".
 * Same rule as `apps/mcp/src/ctx.ts`: lowest `app_user.id`, else '1'.
 *
 * Routes never call this directly. It is injected once into `resolveIdentity`
 * (see identity.ts / auth.ts) as the self-host branch, and that branch is
 * unreachable when any Supabase environment is configured — in cloud, identity
 * comes from the verified JWT subject and nothing else. Standalone proof
 * scripts and live-DB test suites also call it to name the user they operate
 * on.
 *
 * Returns the user_id as a string (UUID in cloud, cast-to-string BIGINT in
 * legacy self-host). Type is `string` so call sites are compatible with UUID
 * user ids without further conversion.
 */
let cachedUserId: string | null = null;
export async function defaultUserId(): Promise<string> {
  if (cachedUserId !== null) return cachedUserId;
  const row = await q1<{ id: string }>('SELECT id FROM app_user ORDER BY id LIMIT 1');
  cachedUserId = row?.id ?? '1';
  return cachedUserId;
}

export async function closePool(): Promise<void> {
  await pool.end();
}

/**
 * Run `fn` inside a single BEGIN/COMMIT transaction on one pooled client, rolling
 * back on any throw. The write path (collection mutations) uses this so that the
 * collection_item write, the collection_event append, and the user_set_progress
 * recompute either all land together or not at all. Stays within the 2-connection
 * budget: one client is checked out for the duration and released in `finally`.
 *
 * When an RLS context is active (withUserContext middleware), the request is
 * already inside a transaction on the rlsStore client. In that case withTx
 * nests via SAVEPOINT instead of a separate BEGIN/COMMIT, reuses the same
 * client (no second connection), and inherits the RLS settings.
 */
let _spCounter = 0;
export async function withTx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const rlsClient = rlsStore.getStore();
  if (rlsClient) {
    // Already inside withUserContext's transaction — nest with SAVEPOINT.
    const sp = `sp_${++_spCounter}`;
    await rlsClient.query(`SAVEPOINT ${sp}`);
    try {
      const out = await fn(rlsClient);
      await rlsClient.query(`RELEASE SAVEPOINT ${sp}`);
      return out;
    } catch (err) {
      try {
        await rlsClient.query(`ROLLBACK TO SAVEPOINT ${sp}`);
      } catch {
        /* ignore rollback failure — original error is what matters */
      }
      throw err;
    }
  }

  // No RLS context — original behaviour: own connection + BEGIN/COMMIT.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore rollback failure — original error is what matters */
    }
    throw err;
  } finally {
    client.release();
  }
}

export interface GoalProgress {
  owned: number;
  total: number;
  pct: number;
  totalQuantity: number;
  setLevel?: number;
}
export interface SetProgress {
  complete: GoalProgress;
  master: GoalProgress;
  grandmaster: GoalProgress;
}

function pct(owned: number, total: number): number {
  if (!owned || !total) return 0;
  return Math.round((owned / total) * 1000) / 10;
}

interface ProgressDbRow {
  goal: 'complete' | 'master' | 'grandmaster';
  owned_required: number;
  total_required: number;
  total_quantity: number;
  set_level: number | null;
}

/**
 * Recompute + persist the three user_set_progress rows for one (user, set) and
 * return them shaped for the API. Must be called on a transaction client so the
 * recompute is atomic with the collection write that triggered it.
 *
 * Semantics (SCHEMA §5.3 / §9.2, pkmn.gg captures §4/§8/§11):
 *   • complete    — card fraction: a card counts owned if ANY variant qty ≥ 1.
 *   • master      — (card, standard-variant) pair fraction over master_required_variant
 *                   (standard-tier pairs + is_primary fallback for cards with no standard).
 *   • grandmaster — (card, ANY variant) pair fraction over all variants.
 * total_required is recomputed from the live catalog in the same pass (identical to
 * the catalog-import baseline), so owned_required ≤ total_required holds by construction
 * and a mid-flight catalog change can never leave a stale denominator behind.
 */
export async function recomputeSetProgress(client: pg.PoolClient, userId: string, setId: number): Promise<SetProgress> {
  await client.query(
    `WITH v AS (
       SELECT c.id AS card_id, cv.id AS cv_id, cv.is_primary,
              (tr.tier = 'standard') AS is_std,
              COALESCE(ci.quantity, 0) AS qty
         FROM card c
         JOIN card_variant cv ON cv.card_id = c.id
         JOIN variant_tier_resolved tr ON tr.card_variant_id = cv.id
    LEFT JOIN collection_item ci ON ci.card_variant_id = cv.id AND ci.user_id = $1
        WHERE c.set_id = $2
     ),
     card_std AS (SELECT card_id, bool_or(is_std) AS has_std FROM v GROUP BY card_id),
     m AS (
       SELECT v.qty, (v.is_std OR (NOT cs.has_std AND v.is_primary)) AS is_master
         FROM v JOIN card_std cs ON cs.card_id = v.card_id
     ),
     totals AS (
       SELECT count(DISTINCT card_id)                          AS complete_total,
              count(DISTINCT card_id) FILTER (WHERE qty >= 1)  AS complete_owned,
              count(*)                                         AS grand_total,
              count(*) FILTER (WHERE qty >= 1)                 AS grand_owned,
              COALESCE(sum(qty), 0)::int                       AS all_qty
         FROM v
     ),
     mt AS (
       SELECT count(*) FILTER (WHERE is_master)                            AS master_total,
              count(*) FILTER (WHERE is_master AND qty >= 1)               AS master_owned,
              COALESCE(sum(qty) FILTER (WHERE is_master), 0)::int          AS master_qty
         FROM m
     )
     INSERT INTO user_set_progress
       (user_id, set_id, goal, owned_required, total_required, total_quantity, catalog_variant_count, recomputed_at, reconciled_at)
     SELECT $1, $2, g.goal,
            CASE g.goal WHEN 'complete' THEN t.complete_owned WHEN 'grandmaster' THEN t.grand_owned ELSE mt.master_owned END,
            CASE g.goal WHEN 'complete' THEN t.complete_total WHEN 'grandmaster' THEN t.grand_total ELSE mt.master_total END,
            CASE g.goal WHEN 'master' THEN mt.master_qty ELSE t.all_qty END,
            t.grand_total, now(), now()
       FROM totals t CROSS JOIN mt
       CROSS JOIN (VALUES ('complete'), ('master'), ('grandmaster')) AS g(goal)
     ON CONFLICT (user_id, set_id, goal) DO UPDATE SET
       owned_required        = EXCLUDED.owned_required,
       total_required        = EXCLUDED.total_required,
       total_quantity        = EXCLUDED.total_quantity,
       catalog_variant_count = EXCLUDED.catalog_variant_count,
       recomputed_at         = now(),
       reconciled_at         = now()`,
    [userId, setId],
  );

  const { rows } = await client.query<ProgressDbRow>(
    `SELECT goal, owned_required, total_required, total_quantity, set_level
       FROM user_set_progress WHERE user_id = $1 AND set_id = $2`,
    [userId, setId],
  );
  const byGoal = new Map(rows.map((r) => [r.goal, r]));
  const shape = (g: 'complete' | 'master' | 'grandmaster'): GoalProgress => {
    const r = byGoal.get(g);
    const owned = r?.owned_required ?? 0;
    const total = r?.total_required ?? 0;
    return {
      owned,
      total,
      pct: pct(owned, total),
      totalQuantity: r?.total_quantity ?? 0,
      ...(g === 'complete' ? { setLevel: r?.set_level ?? 0 } : {}),
    };
  };
  return { complete: shape('complete'), master: shape('master'), grandmaster: shape('grandmaster') };
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
// them (behind nginx at the same /deckscout/ base). The card path is a pure
// function of (series tcgdex_id, set tcgdex_id, card local_id); see
// apps/images/src/layout.ts. localId is used verbatim (TCGdex's own padding).

export interface CardImages {
  low: string;
  high: string;
}

export function cardImages(serieTcgdexId: string, setTcgdexId: string, localId: string): CardImages {
  const base = `/deckscout/images/en/${serieTcgdexId}/${setTcgdexId}/${localId}`;
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
