import { Router } from 'express';
import { asyncHandler, clampInt, notFound, oneOf, str, userCache } from '../http.js';
import { TRAINER_UNIQUE_MODE, trainerLevelProgress } from '../insights/trainerLevel.js';
import {
  currentCollectionValue,
  ownedCounts,
  snapshotCollectionValue,
  topMovers,
  valueSeries,
  type Range,
} from '../insights/collectionValue.js';
import { dexCompletion, speciesDetail, speciesGrid } from '../insights/pokedex.js';

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
    const userId = req.user!.id;
    const counts = await ownedCounts(userId);
    const uniqueForLevel = TRAINER_UNIQUE_MODE === 'pairs' ? counts.uniquePairs : counts.uniqueCards;
    const [value, dex] = await Promise.all([currentCollectionValue(userId), dexCompletion(userId)]);
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
      pokedex: { captured: dex.captured, total: dex.total, pct: dex.pct },
    });
  }),
);

/** GET /insights/value?range=30d|3m|6m|1y&currency=USD|EUR|JPY — value over time. */
insightsRouter.get(
  '/value',
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const range = oneOf<Range>(req.query.range, ['30d', '3m', '6m', '1y'], '30d');
    const currency = oneOf(req.query.currency, ['USD', 'EUR', 'JPY'] as const, 'USD');
    const [totals, series, movers] = await Promise.all([
      currentCollectionValue(userId),
      valueSeries(userId, range, currency),
      topMovers(userId, currency),
    ]);
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
    const userId = req.user!.id;
    const result = await snapshotCollectionValue(userId);
    userCache(res);
    res.json(result);
  }),
);

/** GET /insights/pokedex?generation=&own=&q=&page=&pageSize= — species grid. */
insightsRouter.get(
  '/pokedex',
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;
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
insightsRouter.get(
  '/pokedex/:speciesId',
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const raw = String(req.params.speciesId ?? '');
    const detail = await speciesDetail(userId, raw);
    if (!detail) throw notFound(`No species '${raw}'`);
    userCache(res);
    res.json(detail);
  }),
);
