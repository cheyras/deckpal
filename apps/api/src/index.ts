import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { closePool, pool, q } from './db.js';
import { asyncHandler, catalogCache, errorMiddleware } from './http.js';
import { seriesRouter } from './routes/series.js';
import { setsRouter } from './routes/sets.js';
import { massEntryRouter } from './routes/massentry.js';
import { cardsRouter } from './routes/cards.js';
import { searchRouter } from './routes/search.js';
import { dexRouter } from './routes/dex.js';
import { collectionRouter } from './routes/collection.js';
import { listsRouter } from './routes/lists.js';
import { decksRouter } from './routes/decks.js';
import { insightsRouter } from './routes/insights.js';
import { exportRouter } from './export/router.js';
import { scanRouter } from './scan/router.js';
import { bugsRouter } from './routes/bugs.js';

/**
 * pokedex-api — the read API over the populated catalog (ARCHITECTURE §4).
 *
 * Everything mounts under the /pokedex/api base: the app is served behind nginx
 * at the /pokedex/ sub-path (never the domain root), so no route assumes it.
 * Bound to 127.0.0.1 — nginx (LAN) / Authelia (remote) is the sole ingress and
 * the only auth boundary; the API has none of its own. All queries are read-only
 * and parameterized. Connection budget: 2 (shared pool, hard-capped at 3).
 */

export function createApp(): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors());
  // 12mb accommodates the bug reporter's screenshot dataURL; every other route
  // posts tiny JSON, so the raised ceiling only ever matters for /bugs.
  app.use(express.json({ limit: '12mb' }));

  const api = express.Router();

  // Health: DB liveness + per-sync freshness (cheap; single grouped query).
  api.get(
    '/health',
    asyncHandler(async (_req, res) => {
      try {
        await q('SELECT 1');
      } catch (err) {
        res.status(503).json({ status: 'degraded', db: 'down', error: (err as Error).message });
        return;
      }
      let syncs: Array<{ job: string; status: string; finishedAt: string | null; sourceStamp: string | null }> = [];
      try {
        const rows = await q<{ job: string; status: string; finished_at: string | null; source_stamp: string | null }>(
          `SELECT DISTINCT ON (job) job, status, finished_at, source_stamp
             FROM sync_run ORDER BY job, started_at DESC`,
        );
        syncs = rows.map((r) => ({ job: r.job, status: r.status, finishedAt: r.finished_at, sourceStamp: r.source_stamp }));
      } catch {
        /* sync_run optional for liveness */
      }
      res.json({ status: 'ok', db: 'up', syncs });
    }),
  );

  // A tiny index so hitting the base is not a 404.
  api.get('/', (_req, res) => {
    catalogCache(res, 3600);
    res.json({
      name: 'pokedex-api',
      endpoints: [
        '/health', '/series', '/series/:seriesSlug', '/sets/:setId', '/sets/:setId/massentry', '/cards/:cardId', '/search', '/dex', '/dex/:speciesId',
        'PATCH /collection/variants/:variantId', 'POST /collection/variants/:variantId/increment', 'POST /collection/cards/:cardId/have',
        '/lists', '/lists/:id', 'POST /lists', 'PATCH /lists/:id', 'DELETE /lists/:id', 'POST /lists/:id/items', 'DELETE /lists/:id/items/:itemId',
        '/decks', 'POST /decks', '/decks/:id', 'PATCH /decks/:id', 'DELETE /decks/:id',
        'POST /decks/:id/cards', 'PATCH /decks/:id/cards/:cardId', 'DELETE /decks/:id/cards/:cardId',
        '/decks/:id/validate', 'POST /decks/import', '/decks/:id/export', '/decks/:id/testhand', '/decks/:id/pricing', '/decks/:id/massentry',
        'PUT /decks/:id/strategy', '/decks/:id/versions', '/decks/:id/versions/:v', 'POST /decks/:id/revert',
        '/decks/:id/logs', 'POST /decks/:id/logs', '/decks/:id/logs/:logId',
        'PATCH /decks/:id/logs/:logId', 'DELETE /decks/:id/logs/:logId',
        '/decks/:id/pdf', '/lists/:id/pdf', '/sets/:setId/checklist.pdf',
        'POST /scan',
      ],
    });
  });

  // PDF export routes carry full paths (/decks/:id/pdf, /lists/:id/pdf,
  // /sets/:setId/checklist.pdf) and are mounted first so they resolve here rather
  // than falling through the /decks, /lists, /sets routers below.
  api.use('/', exportRouter);

  api.use('/series', seriesRouter);
  // /sets/:setId/massentry (TCGplayer cart deep links) resolves before the
  // general set-detail router; the two never overlap (:setId is one segment).
  api.use('/sets', massEntryRouter);
  api.use('/sets', setsRouter);
  api.use('/cards', cardsRouter);
  api.use('/search', searchRouter);
  api.use('/dex', dexRouter);
  api.use('/collection', collectionRouter);
  api.use('/lists', listsRouter);
  api.use('/decks', decksRouter);
  api.use('/insights', insightsRouter);
  api.use('/scan', scanRouter);
  api.use('/bugs', bugsRouter);

  app.use('/pokedex/api', api);

  // Serve the built SPA (matches the box convention: every first-party app serves
  // its own frontend on its own port, proxied by nginx — no nginx-static-from-home,
  // which would need www-data to traverse the 700 home dir). Static assets first,
  // then a client-routing fallback to index.html for any non-API GET under /pokedex/.
  // webDist resolves relative to this compiled file: apps/api/dist -> apps/web/dist.
  const webDist = fileURLToPath(new URL('../../web/dist', import.meta.url));
  if (existsSync(webDist)) {
    app.use('/pokedex', express.static(webDist, { index: false, maxAge: '1h' }));
    app.get(/^\/pokedex(\/.*)?$/, (req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/pokedex/api')) return next();
      res.sendFile(join(webDist, 'index.html'));
    });
  }

  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'not_found', message: 'No such route' } });
  });
  app.use(errorMiddleware);
  return app;
}

// Under pm2 fork mode process.argv[1] is pm2's ProcessContainerFork.js wrapper, not
// our entry, so an argv-only check never fires. pm2 exposes the real script path in
// pm_exec_path; fall back to argv[1] for direct `node dist/index.js` runs.
const entryPath = process.env.pm_exec_path ?? process.argv[1] ?? '';
const isMain = entryPath.endsWith('index.js') || entryPath.endsWith('index.ts');
if (isMain) {
  const app = createApp();
  const port = Number(process.env.POKEDEX_API_PORT ?? 3700);
  const server = app.listen(port, '127.0.0.1', () => {
    console.log(`pokedex-api listening on 127.0.0.1:${port} (base /pokedex/api)`);
  });
  const shutdown = (): void => {
    server.close(() => {
      void closePool().finally(() => process.exit(0));
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  // Keep a reference so lint doesn't flag pool as unused before first request.
  void pool;
}
