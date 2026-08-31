import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import { closePool, pool, q, rlsStore, SUPABASE_MODE } from './db.js';
import { ownerGateStatus } from './routes/me.js';
import { deckeApprovalSigning, deckeApprovalWarning, deckeGateStatus, deckeGateWarning } from './decke/gate.js';
import { checkModels, modelCheckStatus, modelCheckWarning, type ModelCheck } from './decke/modelCheck.js';
import {
  deckeEntitledCount,
  deckeEntitlementStatus,
  deckeEntitlementWarning,
} from './decke/entitlement.js';
import { maxDeepCallsPerDay, maxTurnsPerDay } from './decke/meter.js';
import { asyncHandler, catalogCache, errorMiddleware } from './http.js';
import { authMiddleware, resolveIdentity, resolveOptionalIdentity, requireSession } from './auth.js';
import { seriesRouter } from './routes/series.js';
import { setsRouter } from './routes/sets.js';
import { cartRouter, massEntryRouter } from './routes/massentry.js';
import { mutationsRouter } from './routes/mutations.js';
import { cardsRouter } from './routes/cards.js';
import { searchRouter } from './routes/search.js';
import { dexRouter } from './routes/dex.js';
import { collectionRouter } from './routes/collection.js';
import { listsRouter } from './routes/lists.js';
import { decksRouter } from './routes/decks.js';
import { insightsRouter, publicPokedexRouter } from './routes/insights.js';
import { meRouter } from './routes/me.js';
import { deckeHistoryRouter } from './routes/deckeHistory.js';
import { exportRouter } from './export/router.js';
import { scanRouter } from './scan/router.js';
import { bugsRouter } from './routes/bugs.js';
import { tokensRouter } from './routes/tokens.js';
import { avatarRouter } from './routes/avatar.js';
import { oauthRouter } from './routes/oauth.js';
import { mountOAuthServer } from './oauthServer.js';
import { familyOwnerGateStatus } from './family/access.js';
import { familyRouter } from './routes/family.js';
import { supabaseAdminStatus } from './family/supabaseAdmin.js';
import { familyAiGateStatus, familyAiRouter } from './routes/familyAi.js';
import { familyPricesRouter } from './routes/familyPrices.js';
import { familyImportRouter } from './routes/familyImport.js';

/**
 * deckpal-api — the read/write API over the populated catalog.
 *
 * Base path is configurable via API_BASE_PATH:
 *   - Self-host (default): /deckpal/api (behind nginx sub-path)
 *   - Cloud (Vercel):      /api
 *
 * Auth is layered: in cloud mode SUPABASE_JWT_SECRET enables JWT verification
 * and user-scoped routes require a valid Bearer token. In self-host mode the
 * reverse proxy is the auth boundary; the API passes all
 * requests through.
 */

export function createApp(): express.Express {
  // Say it out loud when an owner-only surface is closed to everybody. Failing
  // closed is correct; failing closed SILENTLY cost four days of `/design`
  // being shut with nothing to indicate it. One line in the deploy log turns
  // that into something you notice. See AGENTS.md B11.
  if (ownerGateStatus() === 'unset') {
    console.warn(
      '[deckpal-api] DESIGN_EDITOR_USER_ID is unset — owner-only surfaces ' +
        '(/design, /dev/decke) are closed to EVERY account. Set it to the ' +
        "owner's auth.users UUID and redeploy.",
    );
  }

  // Same rule, same reason, for the feature that also costs money when it is
  // configured and costs a support ticket when it is not.
  const deckeWarning = deckeGateWarning();
  if (deckeWarning) console.warn(deckeWarning);

  // And once more for the gate that decides WHO, as distinct from the gate that
  // decides WHETHER. A configured key with an empty entitlement list is a
  // deployment that pays for a model nobody is allowed to call.
  const entitlementWarning = deckeEntitlementWarning();
  if (entitlementWarning) console.warn(entitlementWarning);

  // A control that is OFF, as distinct from a feature that is off. Said
  // separately so the louder message cannot hide the quieter one.
  const approvalWarning = deckeApprovalWarning();
  if (approvalWarning) console.warn(approvalWarning);

  // ── AND WHETHER THE MODELS WE ARE CONFIGURED TO CALL ACTUALLY EXIST ──────
  //
  // MODELS.research.id was a model that is not on the Gateway key, for the
  // whole life of the feature. It typechecked, built, passed CI and passed
  // review, and every call 404d — while the failure was framed as an answer,
  // so even USING it did not reveal the fault. Six ways to not notice.
  //
  // Fired and forgotten: this must never delay a boot, and a Gateway that is
  // unreachable at cold start is a thing to say, not a reason to stay down.
  let modelCheck: ModelCheck = { missing: [], checked: 0, unreachable: 'not checked yet' };
  void checkModels(process.env.DECKE_VERCEL_AI_GATEWAY_KEY ?? process.env.AI_GATEWAY_API_KEY)
    .then((c) => {
      modelCheck = c;
      const w = modelCheckWarning(c);
      if (w) console.warn(w);
    })
    .catch(() => {
      /* checkModels already turns every failure into . */
    });

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

  // The public half of the OAuth "Connect" flow lives at the bare origin
  // (RFC 8414/9728 well-known paths, /register, /token) — mounted on `app`
  // directly, ahead of the `basePath` API router, and only in cloud mode: the
  // flow mints api_token rows tied to a Supabase user, which self-host has no
  // concept of (SPEC.md §3b).
  if (SUPABASE_MODE) {
    mountOAuthServer(app);
  }

  const api = express.Router();

  // JWT verification runs on every request (extracts req.user from Bearer token).
  // It never rejects — user-scoped routers are gated by resolveIdentity below,
  // and the session-only ones (/tokens, /avatar, /oauth) by requireSession too.
  api.use(authMiddleware);

  // RLS context: in SUPABASE_MODE, wrap authenticated requests in a transaction
  // with SET LOCAL role = 'authenticated' + request.jwt.claims. This makes RLS
  // policies fire on every query — defense-in-depth on top of the parameterized
  // WHERE user_id = $1 clauses. q(), q1(), and withTx() automatically use the
  // per-request client via AsyncLocalStorage, so routes need no changes.
  if (SUPABASE_MODE) {
    // How long one request may hold its pooled connection before it is
    // reclaimed. No endpoint in this API streams or long-polls, so anything
    // still holding after this is stuck — and holding forever is precisely what
    // exhausted the pool in production.
    const MAX_HOLD_MS = Number(process.env.PGRLS_MAX_HOLD_MS ?? 30_000);
    // COMMIT/ROLLBACK can HANG rather than reject on a half-dead connection.
    // Unbounded, cleanup never reaches release() and the client is gone for good.
    const CLEANUP_MS = Number(process.env.PGRLS_CLEANUP_MS ?? 5_000);

    api.use((req, res, next) => {
      const userId = req.user?.id ?? null;
      pool.connect().then(async (client) => {
        let cleaned = false;
        let watchdog: ReturnType<typeof setTimeout> | null = null;

        const cleanup = async (mode: 'commit' | 'rollback') => {
          if (cleaned) return;
          cleaned = true;
          if (watchdog) { clearTimeout(watchdog); watchdog = null; }
          try {
            await Promise.race([
              client.query(`${mode === 'commit' ? 'COMMIT' : 'ROLLBACK'}; RESET ROLE`),
              new Promise((_, reject) =>
                setTimeout(() => reject(new Error('rls cleanup timeout')), CLEANUP_MS),
              ),
            ]);
            // Only the COMMIT path — res 'finish', meaning the handler ran to
            // completion — may return the client to the pool. The rollback
            // paths ('close' on early disconnect, the watchdog) fire while the
            // route handler may STILL be running: Express does not cancel it,
            // and its rlsStore reference keeps pointing at this client. If the
            // client went back to the pool, the next request would check it
            // out, set ITS user's RLS claims, and the still-running handler
            // would silently query inside the wrong user's context. Destroying
            // the connection instead makes the slow handler's next query fail
            // loudly — the correct outcome, and worth the reconnect.
            if (mode === 'commit') client.release();
            else client.release(true);
          } catch {
            // The statement either failed or hung. Handing back a connection
            // that may still be inside a transaction — or still wearing the
            // 'authenticated' role — poisons whoever borrows it next, so
            // discard it instead and let the pool open a fresh one.
            // release(true) is node-postgres' documented "destroy this client".
            try { client.release(true); } catch { /* already gone */ }
          }
        };

        // ── These listeners are attached BEFORE the first await, deliberately.
        //
        // This was the leak. They used to be registered after
        // `await client.query(setup)`, so a client that disconnected while the
        // setup statement was still in flight had ALREADY emitted 'close' — the
        // listener was never called, cleanup never ran, and that connection was
        // held for the lifetime of the process. A browser navigating away
        // mid-load does exactly this, so the pool bled a connection at a time
        // until every one was checked out and every request timed out on
        // connectionTimeoutMillis. Raising `max` only changed how long it took.
        res.on('finish', () => void cleanup('commit'));
        res.on('close', () => void cleanup('rollback'));
        // ...and for the window before even these existed.
        if (res.writableEnded || res.destroyed) {
          void cleanup('rollback');
          return;
        }
        // Last resort: a response that never finishes and never closes would
        // otherwise hold its connection forever.
        watchdog = setTimeout(() => void cleanup('rollback'), MAX_HOLD_MS);

        try {
          // One round trip, not three. The DB lives in a different AWS region from
          // the function (measured ~90 ms RTT iad1 → aws-1-us-west-2), so each
          // extra `await client.query(...)` here cost ~90 ms on EVERY authenticated
          // request before the route ran a single query of its own. Postgres'
          // simple-query protocol runs a semicolon-separated batch in one exchange;
          // the claims JSON is escaped with pg's own escapeLiteral because the
          // extended (parameterised) protocol permits only one statement per call.
          //
          // An ANONYMOUS request gets the same treatment with Supabase's `anon`
          // role and no claims, so `auth.uid()` is NULL. That is not decoration:
          // the pool connects as `postgres`, which OWNS every table in `public`
          // and therefore BYPASSES row-level security (the tables are not FORCE
          // RLS). Public catalog routes read `collection_item`,
          // `user_set_progress` and `user_dex_state` in LEFT JOINs, so serving
          // them on the bare pool connection would mean the one thing standing
          // between a logged-out visitor and somebody's collection was a bound
          // parameter. Under `anon`, RLS actually fires: the catalog policies are
          // USING (true) and every per-user table has no policy an anonymous
          // caller satisfies, so those tables are EMPTY — measured, not assumed
          // (see DECISIONS.md 2026-08-10).
          const setup = userId
            ? `BEGIN; SELECT set_config('request.jwt.claims', ${client.escapeLiteral(
                JSON.stringify({ sub: userId, role: 'authenticated' }),
              )}, true); SET LOCAL role = 'authenticated'`
            : `BEGIN; SET LOCAL role = 'anon'`;
          await client.query(setup);
          // The request may have been aborted while that was in flight; cleanup
          // has then already run and the client is no longer ours to use.
          if (cleaned) return;

          // Run the rest of the middleware chain inside the RLS store context
          // so q()/q1()/withTx() pick up the client transparently.
          rlsStore.run(client, () => next());
        } catch (err) {
          void cleanup('rollback');
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
        console.error('[deckpal-api] health: db unreachable', (err as Error).message);
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
      // Pool census. This is here because the pool exhausting itself was
      // diagnosable only by instrumenting a build and reproducing — which is
      // exactly the situation a health endpoint should remove. `waiting` above
      // zero while `idle` is zero means requests are queueing for a connection;
      // `total` pinned at max with `idle` zero and no traffic means a leak.
      res.json({
        status: 'ok',
        db: 'up',
        pool: { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount },
        syncs,
        // Whether an owner is configured — never WHO. `unset` means every
        // owner-only surface is closed to everyone, which is a deployment
        // mistake that is otherwise invisible from outside. See AGENTS.md B11.
        ownerGate: ownerGateStatus(),
        familyOwnerGate: familyOwnerGateStatus(),
        familyInvitations: supabaseAdminStatus(),
        familyAi: familyAiGateStatus(),
        // Whether Deck-E's brain has a Gateway credential — never which one,
        // and never any part of its value. `unset` means POST /api/chat 503s
        // for everybody, which is otherwise invisible from outside. B11 again.
        deckeGate: deckeGateStatus(),
        // Whether a crafted client could forge a write approval. B11: a
        // security control that is off must be visible from outside.
        deckeApprovals: deckeApprovalSigning(),
        // WHO may use Deck-E, and how much of him — never the ids themselves,
        // because /health is unauthenticated and a list of user UUIDs is
        // exactly the sort of thing that should not be readable from it. A
        // count is not an identity. B11 again: `nobody` here means POST
        // /api/chat refuses every account, which is otherwise invisible from
        // outside.
        deckeEntitlement: {
          status: deckeEntitlementStatus(),
          extraAccounts: deckeEntitledCount(),
        },
        // Whether every configured model id is real. NAMES the missing ones,
        // unlike the entitlement block above — a model id is a public product
        // name, and "one model is wrong" without saying which is a puzzle
        // rather than a report. B11: the configuration defect that was
        // invisible from outside for months is now the first thing visible.
        deckeModels: modelCheckStatus(modelCheck),
        // The CONFIGURED caps, and the configured size of a pool this process
        // cannot see. `api/chat.mjs` is a separate serverless function with a
        // separate process, so the live census above covers the Express app's
        // pool and nothing else. Reporting a number we cannot measure as if we
        // had measured it would be worse than reporting the setting and saying
        // which it is — see DECISIONS.md for why this is the honest half of
        // B11 rather than a shortcut.
        deckeLimits: {
          maxTurnsPerDay: maxTurnsPerDay(),
          maxDeepCallsPerDay: maxDeepCallsPerDay(),
          chatPoolMaxConfigured: Number.parseInt(process.env.PGPOOL_MAX_CHAT ?? '', 10) || 2,
        },
      });
    }),
  );

  // The two values a browser needs before it can talk to Supabase at all.
  //
  // Neither is a secret: both are compiled into the SPA bundle this same
  // deployment serves, so anyone can already read them with View Source. This
  // endpoint exists so a *development* server can learn them at startup instead
  // of the repo having to commit them (see AGENTS.md B12). That indirection is
  // what makes `pnpm dev` work on a fresh clone with no .env, and it means a
  // rotated anon key reaches every developer on their next `pnpm dev` rather
  // than needing a commit.
  //
  // ⚠️ Only ever add values here that are already public in the client bundle.
  // The service-role key and the JWT secret are NOT, and must never be.
  api.get('/public-config', (_req, res) => {
    catalogCache(res, 300);
    res.json({
      // Self-host answers with empty strings and mode 'self-host': it has no
      // Supabase, so a dev server pointed at it correctly gets nothing and
      // stays in self-host shape rather than half-configuring itself.
      supabaseUrl: SUPABASE_MODE ? (process.env.VITE_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '') : '',
      supabaseAnonKey: SUPABASE_MODE ? (process.env.VITE_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '') : '',
      mode: SUPABASE_MODE ? 'cloud' : 'self-host',
    });
  });

  // A tiny index so hitting the base is not a 404.
  api.get('/', (_req, res) => {
    catalogCache(res, 3600);
    res.json({
      name: 'deckpal-api',
      endpoints: [
        '/health', '/public-config', '/me', '/series', '/series/:seriesSlug', '/sets/:setId', '/sets/:setId/massentry', '/cards/:cardId', '/search', '/dex', '/dex/:speciesId',
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
        '/tokens', 'POST /tokens', 'DELETE /tokens/:id',
        '/avatar', 'POST /avatar', 'DELETE /avatar',
        '/oauth/client', 'POST /oauth/authorize/decision',
      ],
    });
  });

  // ── Public routes (catalog reads, no auth required) ───────────────────────
  // Search is pure catalog — no user_id in the queries at all, so it needs no
  // identity of any kind.
  api.use('/search', searchRouter);

  // ── Public catalog (browsable signed-out) ─────────────────────────────────
  // The catalog is the product's shop window: a visitor can read every set,
  // card, price and species without an account. These responses still EMBED the
  // caller's ownership when there is a caller, so they get the optional seam:
  //   cloud + credential → the verified subject, response unchanged;
  //   cloud, no credential → nobody. optionalUserId() returns null, the query
  //     binds SQL NULL (never equal to any user_id) and the route omits every
  //     ownership field;
  //   self-host → the single local user, exactly as before.
  // See identity.ts. Anything per-user — collection, lists, decks, insights,
  // scanner, profile, bug reports, tokens — stays below resolveIdentity.
  api.use(resolveOptionalIdentity);
  api.use('/series', seriesRouter);
  api.use('/sets', setsRouter);
  api.use('/cards', cardsRouter);
  api.use('/dex', dexRouter);
  // The Pokédex surface the web app actually renders is /insights/pokedex (the
  // sprite/level/shiny shape), not /dex — so the two Pokédex reads are split off
  // the insights router and mounted here. Every other /insights route is a
  // report on YOUR collection and stays gated below.
  api.use('/insights', publicPokedexRouter);

  // ── User-scoped routes ────────────────────────────────────────────────────
  // resolveIdentity settles "who is calling" once, for both deployments:
  //   cloud     → the verified JWT/token subject, or 401 with no fallback;
  //   self-host → the single local user (the reverse proxy is the auth
  //               boundary, so no credential is required or expected).
  // Every router below reads it through currentUserId(req) and never branches
  // on deployment. See identity.ts.
  api.use(resolveIdentity);

  api.use('/me', meRouter);
  api.use('/family', familyRouter);
  api.use('/family', familyAiRouter);
  api.use('/family', familyPricesRouter);
  api.use('/family', familyImportRouter);

  // Deck-E's transcript history. Mounted under `/decke` so the feature's routes
  // are findable as a group, and gated inside the router rather than here —
  // every route needs the same two facts (signed in, entitled) and the check
  // belongs beside the queries it protects.
  api.use('/decke', deckeHistoryRouter);

  // PDF export routes carry full paths (/decks/:id/pdf, /lists/:id/pdf,
  // /sets/:setId/checklist.pdf) and are mounted first so they resolve here rather
  // than falling through the /decks, /lists, /sets routers below.
  api.use('/', exportRouter);

  // /sets/:setId/massentry (TCGplayer cart deep links for the cards you still
  // NEED) is per-user, so it stays gated even though /sets/:setId above is not.
  // The two never collide: setsRouter's '/:setId' matches one path segment, so
  // '/sets/sv01/massentry' falls straight through it to here.
  api.use('/sets', massEntryRouter);
  // Cart links that are not scoped to a set: /lists/:id/massentry and the
  // ad-hoc POST /massentry. Mounted at '/' with full paths, and BEFORE the
  // /lists router so the two-segment list path resolves here.
  api.use('/', cartRouter);
  api.use('/mutations', mutationsRouter);
  api.use('/collection', collectionRouter);
  api.use('/lists', listsRouter);
  api.use('/decks', decksRouter);
  api.use('/insights', insightsRouter);
  api.use('/scan', scanRouter);
  api.use('/bugs', bugsRouter);
  // Token management is session-only: a personal access token can use the API,
  // but it can never mint another one or revoke the ones that gate it.
  api.use('/tokens', requireSession, tokensRouter);
  // Profile photo. Session-only for the same reason: a personal access token
  // reads a collection, it does not restyle the account that minted it.
  api.use('/avatar', requireSession, avatarRouter);
  // OAuth consent decision. Session-only for the same reason as /tokens:
  // approving a connector mints a new personal access token, so a token must
  // never be able to approve minting another one.
  api.use('/oauth', requireSession, oauthRouter);

  // Base path: /api on Vercel, /deckpal/api on self-host (nginx sub-path).
  const basePath = process.env.API_BASE_PATH ?? '/deckpal/api';
  app.use(basePath, api);

  // Serve the built SPA. On self-host the sub-path is /deckpal/; on Vercel the
  // SPA is served by Vercel's static layer (outputDirectory in vercel.json), so
  // this block only fires for the self-host entrypoint (process manager / direct node).
  // webDist resolves relative to this compiled file: apps/api/dist -> apps/web/dist.
  const webDist = fileURLToPath(new URL('../../web/dist', import.meta.url));
  const spaBase = process.env.API_BASE_PATH === '/api' ? '/' : '/deckpal';
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
  const port = Number(process.env.DECKPAL_API_PORT ?? 3700);
  const server = app.listen(port, '127.0.0.1', () => {
    console.log(`deckpal-api listening on 127.0.0.1:${port} (base /deckpal/api)`);
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
