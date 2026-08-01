import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import { closePool, pool, q, rlsStore, SUPABASE_MODE, withUserContext } from './db.js';
import { asyncHandler, catalogCache, errorMiddleware } from './http.js';
import { authMiddleware, requireAuth } from './auth.js';
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
import { foilLabRouter } from './routes/foil-lab.js';

/**
 * deckscout-api — the read/write API over the populated catalog.
 *
 * Base path is configurable via API_BASE_PATH:
 *   - Self-host (default): /deckscout/api (behind nginx sub-path)
 *   - Cloud (Vercel):      /api
 *
 * Auth is layered: in cloud mode SUPABASE_JWT_SECRET enables JWT verification
 * and user-scoped routes require a valid Bearer token. In self-host mode the
 * reverse proxy is the auth boundary; the API passes all
 * requests through.
 */

export function createApp(): express.Express {
  const app = express();
  app.disable('x-powered-by');
  // upgrade-insecure-requests (helmet CSP default) is dropped: on plain-HTTP LAN
  // origins the directive upgrades every subresource to https, which breaks the
  // app when the only TLS cert doesn't match the hostname. Public HTTPS access
  // makes the directive a no-op anyway; all content is same-origin.
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: { upgradeInsecureRequests: null },
      },
    }),
  );
  // CORS is off by default: the SPA is served same-origin by this very server,
  // and the MCP calls the API server-side, so cross-origin access is unnecessary.
  // Forks that split hosting can set API_CORS_ORIGINS (comma-separated allowlist).
  const corsOrigins = process.env.API_CORS_ORIGINS;
  if (corsOrigins) {
    const allowed = new Set(corsOrigins.split(',').map((o) => o.trim()).filter(Boolean));
    app.use((req, res, next) => {
      const origin = req.headers.origin;
      if (origin && allowed.has(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
        if (req.method === 'OPTIONS') { res.status(204).end(); return; }
      }
      next();
    });
  }
  // 12mb accommodates the bug reporter's screenshot dataURL; every other route
  // posts tiny JSON, so the raised ceiling only ever matters for /bugs.
  app.use(express.json({ limit: '12mb' }));

  const api = express.Router();

  // JWT verification runs on every request (extracts req.user from Bearer token).
  // It never rejects — routes that need auth use requireAuth below.
  api.use(authMiddleware);

  // RLS context: in SUPABASE_MODE, wrap authenticated requests in a transaction
  // with SET LOCAL role = 'authenticated' + request.jwt.claims. This makes RLS
  // policies fire on every query — defense-in-depth on top of the parameterized
  // WHERE user_id = $1 clauses. q(), q1(), and withTx() automatically use the
  // per-request client via AsyncLocalStorage, so routes need no changes.
  if (SUPABASE_MODE) {
    api.use((req, res, next) => {
      if (!req.user) {
        // No authenticated user — public routes run without RLS context.
        next();
        return;
      }
      const userId = req.user.id;
      pool.connect().then(async (client) => {
        try {
          await client.query('BEGIN');
          await client.query(
            `SELECT set_config('request.jwt.claims', $1, true)`,
            [JSON.stringify({ sub: userId, role: 'authenticated' })],
          );
          await client.query(`SET LOCAL role = 'authenticated'`);

          let cleaned = false;
          const cleanup = async (mode: 'commit' | 'rollback') => {
            if (cleaned) return;
            cleaned = true;
            try {
              await client.query(mode === 'commit' ? 'COMMIT' : 'ROLLBACK');
            } catch { /* swallow — connection may already be dead */ }
            try {
              await client.query('RESET ROLE');
            } catch { /* best-effort */ }
            client.release();
          };

          res.on('finish', () => void cleanup('commit'));
          res.on('close', () => {
            // Early disconnect before finish — roll back rather than commit.
            void cleanup('rollback');
          });

          // Run the rest of the middleware chain inside the RLS store context
          // so q()/q1()/withTx() pick up the client transparently.
          rlsStore.run(client, () => next());
        } catch (err) {
          try { await client.query('ROLLBACK'); } catch { /* swallow */ }
          try { await client.query('RESET ROLE'); } catch { /* swallow */ }
          client.release();
          next(err);
        }
      }).catch(next);
    });
  }

  // Health: DB liveness + per-sync freshness (cheap; single grouped query).
  // Public — no requireAuth.
  api.get(
    '/health',
    asyncHandler(async (_req, res) => {
      try {
        await q('SELECT 1');
      } catch (err) {
        console.error('[deckscout-api] health: db unreachable', (err as Error).message);
        res.status(503).json({ status: 'degraded', db: 'down', error: 'db unreachable' });
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
      name: 'deckscout-api',
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

  // ── Public routes (catalog reads, no auth required) ───────────────────────
  // Search is pure catalog — no user_id in the queries.
  api.use('/search', searchRouter);

  // ── Authenticated routes (user-scoped data) ─────────────────────────────
  // requireAuth rejects 401 in cloud mode when no valid JWT is present.
  // In self-host mode it is a no-op (reverse proxy is the auth boundary).
  api.use(requireAuth);

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
  api.use('/dex', dexRouter);
  api.use('/collection', collectionRouter);
  api.use('/lists', listsRouter);
  api.use('/decks', decksRouter);
  api.use('/insights', insightsRouter);
  api.use('/scan', scanRouter);
  api.use('/bugs', bugsRouter);
  // Quarantined foil-workbench dev surface (masks + comments → working tree).
  // Mounted only on the foil branch's dev api instance (POKEDEX_FOIL_LAB=1,
  // port 3712 per roadmap/ORCHESTRATION.md); inert in prod by construction.
  if (process.env.POKEDEX_FOIL_LAB === '1') {
    api.use('/foil-lab', foilLabRouter);
  }

  // Base path: /api on Vercel, /deckscout/api on self-host (nginx sub-path).
  const basePath = process.env.API_BASE_PATH ?? '/deckscout/api';
  app.use(basePath, api);

  // Serve the built SPA. On self-host the sub-path is /deckscout/; on Vercel the
  // SPA is served by Vercel's static layer (outputDirectory in vercel.json), so
  // this block only fires for the self-host entrypoint (process manager / direct node).
  // webDist resolves relative to this compiled file: apps/api/dist -> apps/web/dist.
  const webDist = fileURLToPath(new URL('../../web/dist', import.meta.url));
  const spaBase = process.env.API_BASE_PATH === '/api' ? '/' : '/deckscout';
  if (existsSync(webDist)) {
    app.use(spaBase, express.static(webDist, { index: false, maxAge: '1h' }));
    const spaApiPrefix = `${spaBase === '/' ? '' : spaBase}/api`;
    app.get(new RegExp(`^${spaBase === '/' ? '' : spaBase.replace('/', '\\/')}(\\/.*)?$`), (req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith(spaApiPrefix)) return next();
      res.sendFile(join(webDist, 'index.html'));
    });
  }

  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'not_found', message: 'No such route' } });
  });
  app.use(errorMiddleware);
  return app;
}

// Under some process managers (fork mode) process.argv[1] is a wrapper, not our
// entry, so an argv-only check never fires. pm_exec_path (if set) holds the real
// script path; fall back to argv[1] for direct `node dist/index.js` runs.
const entryPath = process.env.pm_exec_path ?? process.argv[1] ?? '';
const isMain = entryPath.endsWith('index.js') || entryPath.endsWith('index.ts');
if (isMain) {
  const app = createApp();
  const port = Number(process.env.DECKSCOUT_API_PORT ?? 3700);
  const server = app.listen(port, '127.0.0.1', () => {
    console.log(`deckscout-api listening on 127.0.0.1:${port} (base /deckscout/api)`);
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
