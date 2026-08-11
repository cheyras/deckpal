import { Router } from 'express';
import { q1 } from '../db.js';
import { asyncHandler, clampInt, notFound, oneOf, str, userCache } from '../http.js';
import { currentUserId, optionalUserId } from '../identity.js';
import { TRAINER_UNIQUE_MODE, trainerLevelProgress } from '../insights/trainerLevel.js';
import {
  aggregateValue,
  currentCollectionValue,
  snapshotCollectionValue,
  topMovers,
  valueSeries,
  type Range,
} from '../insights/collectionValue.js';
import { speciesDetail, speciesGrid } from '../insights/pokedex.js';

/**
 * Insights / gamification router — Phase 6 backend, mounted at /insights in
 * apps/api/src/index.ts. Every GET is read-only over the collection; the one
 * write is POST /value/snapshot (insights/collectionValue.snapshotCollectionValue,
 * idempotent per day), which the deckscout-sync daily cron calls over HTTP — sync
 * must not import this app (its db.ts opens a 2-connection pool at module load).
 */
export const insightsRouter: Router = Router();

/** GET /insights/overview — trainer level + collection value + dex summary. */
insightsRouter.get(
  '/overview',
  asyncHandler(async (req, res) => {
    const userId = currentUserId(req);

    // These three result sets (owned counts, collection value, dex completion)
    // used to be separate queries — ownedCounts() sequentially, then
    // currentCollectionValue() and dexCompletion() in a Promise.all. That
    // Promise.all dispatched two concurrent q() calls on the single
    // per-request RLS PoolClient (SUPABASE_MODE), which node-postgres does
    // not support — the "parallel" calls were actually serialised, and the
    // concurrent dispatch wedged the connection pool under real concurrent
    // traffic (the root cause of #35). /insights/overview fires from AppShell
    // on every authenticated page, so this one endpoint alone was enough to
    // starve the 2–3 connection pool on first paint.
    //
    // Folded into one statement of independent scalar subqueries: same
    // sub-plans, same indexes, one round trip instead of three. JS-side
    // post-processing (aggregateValue for prices, pct rounding for dex)
    // preserved identically. See the analogous fix in routes/cards.ts.
    const bundle = await q1<{
      counts: { unique_cards: number; unique_pairs: number; total_qty: number };
      price_rows: { currency_code: string; quantity: number; best_minor: number }[];
      dex: { captured: number; total: number };
    }>(
      `SELECT
         (SELECT json_build_object(
            'unique_cards', count(DISTINCT cv.card_id),
            'unique_pairs', count(DISTINCT ci.card_variant_id),
            'total_qty', COALESCE(sum(ci.quantity), 0)
          ) FROM collection_item ci
            JOIN card_variant cv ON cv.id = ci.card_variant_id
           WHERE ci.user_id = $1 AND ci.quantity > 0
         ) AS counts,
         COALESCE((SELECT json_agg(r) FROM (
           SELECT b.currency_code, ci.quantity, b.best_minor
             FROM collection_item ci
             JOIN (
               SELECT pc.card_variant_id, pc.currency_code,
                      max(pc.market_minor) AS best_minor
                 FROM price_current pc
                WHERE pc.market_minor IS NOT NULL
                GROUP BY pc.card_variant_id, pc.currency_code
             ) b ON b.card_variant_id = ci.card_variant_id
            WHERE ci.user_id = $1 AND ci.quantity > 0
         ) r), '[]'::json) AS price_rows,
         (SELECT json_build_object(
            'captured', (
              SELECT count(DISTINCT cs.dex_id)
                FROM collection_item ci
                JOIN card_variant cv ON cv.id = ci.card_variant_id
                JOIN card c ON c.id = cv.card_id
                JOIN card_species cs ON cs.card_id = c.id
               WHERE ci.user_id = $1 AND ci.quantity > 0
                 AND c.category = 'Pokemon'
            ),
            'total', (SELECT count(*) FROM dex_species)
         )) AS dex`,
      [userId],
    );

    const counts = {
      uniqueCards: Number(bundle?.counts?.unique_cards ?? 0),
      uniquePairs: Number(bundle?.counts?.unique_pairs ?? 0),
      totalQuantity: Number(bundle?.counts?.total_qty ?? 0),
    };
    const value = aggregateValue(
      (bundle?.price_rows ?? []).map((r) => ({
        currency: String(r.currency_code),
        qty: Number(r.quantity),
        bestMinor: Number(r.best_minor),
      })),
    );
    const dexCaptured = Number(bundle?.dex?.captured ?? 0);
    const dexTotal = Number(bundle?.dex?.total ?? 0);
    const round1 = (o: number, t: number): number =>
      o && t ? Math.round((o / t) * 1000) / 10 : 0;

    const uniqueForLevel = TRAINER_UNIQUE_MODE === 'pairs'
      ? counts.uniquePairs : counts.uniqueCards;
    userCache(res);
    res.json({
      trainer: {
        ...trainerLevelProgress(uniqueForLevel),
        uniqueMode: TRAINER_UNIQUE_MODE,
        totalCards: counts.totalQuantity,
        uniqueCards: counts.uniqueCards,
        uniquePairs: counts.uniquePairs,
      },
      collectionValue: value,
      pokedex: {
        captured: dexCaptured,
        total: dexTotal,
        pct: round1(dexCaptured, dexTotal),
      },
    });
  }),
);

/** GET /insights/value?range=30d|3m|6m|1y&currency=USD|EUR|JPY — value over time. */
insightsRouter.get(
  '/value',
  asyncHandler(async (req, res) => {
    const userId = currentUserId(req);
    const range = oneOf<Range>(req.query.range, ['30d', '3m', '6m', '1y'], '30d');
    const currency = oneOf(req.query.currency, ['USD', 'EUR', 'JPY'] as const, 'USD');
    // These three calls used to be a Promise.all. In SUPABASE_MODE they share
    // one RLS PoolClient, so node-postgres serialised them anyway — the
    // "parallel" dispatch was a lie that, under concurrent traffic, wedged the
    // connection pool (same root cause as /insights/overview, see #35).
    // Sequential awaits fix the concurrency bug and make the serialisation
    // explicit. Combining into one SQL statement (the cards.ts pattern) was
    // considered, but each function involves non-trivial JS post-processing
    // (aggregateValue, delta computation, sort/slice) and /value is not on the
    // every-page-load critical path — the readability win of keeping the module
    // functions outweighs the marginal round-trip savings here.
    const totals = await currentCollectionValue(userId);
    const series = await valueSeries(userId, range, currency);
    const movers = await topMovers(userId, currency);
    const current = totals.find((t) => t.currency === currency) ?? { currency, totalMinor: 0, total: 0, pricedVariants: 0, quantity: 0 };
    userCache(res);
    res.json({ currency, range, current, series, movers });
  }),
);

/**
 * POST /insights/value/snapshot — append today's per-currency totals to
 * collection_value_point for the default user. Idempotent per
 * (user, observed_on, currency): a same-day re-run inserts nothing
 * (ON CONFLICT DO NOTHING) and reports inserted: 0. Returns the SnapshotResult.
 * Internal: called by the deckscout-sync `snapshot-collection` cron (127.0.0.1;
 * the reverse proxy is the only external ingress). Any request body is ignored.
 */
insightsRouter.post(
  '/value/snapshot',
  asyncHandler(async (req, res) => {
    const userId = currentUserId(req);
    const result = await snapshotCollectionValue(userId);
    userCache(res);
    res.json(result);
  }),
);

/**
 * The two Pokédex reads, split off the insights router because they are the ONLY
 * ones a logged-out visitor may reach. Mounted at /insights ahead of
 * resolveIdentity (see index.ts); everything left on `insightsRouter` is a
 * report on your own collection and stays gated.
 *
 * They live in this file rather than routes/dex.ts because they are the
 * sprite/level/shiny shape the web Pokédex actually renders — /dex is the
 * leaner catalog view of the same species.
 */
export const publicPokedexRouter: Router = Router();

/** GET /insights/pokedex?generation=&own=&q=&page=&pageSize= — species grid. */
publicPokedexRouter.get(
  '/pokedex',
  asyncHandler(async (req, res) => {
    // null when nobody is signed in: speciesGrid then binds SQL NULL for the
    // collection join (matching no row for any user) and omits every capture,
    // level and shiny field. See identity.ts.
    const userId = optionalUserId(req);
    const generationRaw = str(req.query.generation);
    const generation = generationRaw && Number.isFinite(Number(generationRaw)) ? Number(generationRaw) : undefined;
    const own = oneOf(req.query.own, ['all', 'captured', 'uncaptured'] as const, 'all');
    const search = str(req.query.q);
    const pageSize = clampInt(req.query.pageSize, 200, 1, 1025);
    const page = clampInt(req.query.page, 1, 1, 100000);
    const grid = await speciesGrid(userId, { generation, own, search, page, pageSize });
    userCache(res);
    res.json(grid);
  }),
);

/** GET /insights/pokedex/:speciesId — one species' cards + capture/level/shiny. */
publicPokedexRouter.get(
  '/pokedex/:speciesId',
  asyncHandler(async (req, res) => {
    // null when nobody is signed in — see the grid above.
    const userId = optionalUserId(req);
    const raw = String(req.params.speciesId ?? '');
    const detail = await speciesDetail(userId, raw);
    if (!detail) throw notFound(`No species '${raw}'`);
    userCache(res);
    res.json(detail);
  }),
);
