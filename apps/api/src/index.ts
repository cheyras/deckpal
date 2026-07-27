import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { closePool, pool, q } from './db.js';
import { asyncHandler, catalogCache, errorMiddleware } from './http.js';
import { seriesRouter } from './routes/series.js';
import { setsRouter } from './routes/sets.js';
import { cardsRouter } from './routes/cards.js';
import { searchRouter } from './routes/search.js';
import { dexRouter } from './routes/dex.js';
import { collectionRouter } from './routes/collection.js';

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
  app.use(express.json());

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
        '/health', '/series', '/series/:seriesSlug', '/sets/:setId', '/cards/:cardId', '/search', '/dex', '/dex/:speciesId',
        'PATCH /collection/variants/:variantId', 'POST /collection/variants/:variantId/increment', 'POST /collection/cards/:cardId/have',
      ],
    });
  });

  api.use('/series', seriesRouter);
  api.use('/sets', setsRouter);
  api.use('/cards', cardsRouter);
  api.use('/search', searchRouter);
  api.use('/dex', dexRouter);
  api.use('/collection', collectionRouter);

  app.use('/pokedex/api', api);

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
