import { createMcpExpressApp } from '@modelcontextprotocol/express';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler } from '@modelcontextprotocol/server';
import type { RequestHandler } from 'express';
import { loadEnv } from '@deckscout/db';
import { buildCtx, type Ctx } from './ctx.js';
import { q } from './db.js';
import { buildServer } from './server.js';

/**
 * rotom-mcp — the MCP face of DeckScout (SPEC §1/§2).
 *
 * Streamable HTTP on 127.0.0.1:3704/mcp (stateless: fresh McpServer per
 * request via createMcpHandler), plus a plain unauthenticated GET /health for
 * pm2/nginx probes. nginx is the only ingress beyond localhost; /mcp is gated
 * by the x-brain-key shared secret (house convention — bare 401 on failure,
 * never WWW-Authenticate, which claude.ai would treat as an OAuth trigger).
 */

// Hostname allowlist for DNS-rebinding protection (SPEC §2). host '0.0.0.0'
// disables the SDK's automatic localhost-only validation so this explicit
// list is what actually gates; the socket itself still binds 127.0.0.1.
const ALLOWED_HOSTS = [
  'example.invalid',
  'localhost',
  'the-original-host',
  'localhost',
  '10.0.0.1',
  '127.0.0.1',
  'localhost',
];

async function main(): Promise<void> {
  loadEnv();

  if (!process.env.ROTOM_MCP_KEY) {
    console.error('[deckscout-mcp] FATAL: ROTOM_MCP_KEY is not set — refusing to start.');
    process.exit(1);
  }

  // Build-once context; includes the fatal SELECT 1 self-check and the
  // default-user resolution. DB unreachable → exit 1 (pm2 restarts us).
  let ctx: Ctx;
  try {
    ctx = await buildCtx();
  } catch (err) {
    console.error(`[deckscout-mcp] FATAL: Postgres self-check failed: ${(err as Error).message}`);
    process.exit(1);
  }
  console.log(`[deckscout-mcp] db ok · default user id ${ctx.userId}`);

  // API self-check is warn-only: direct-SQL read tools still work without it;
  // API-backed tools (decks/lists/log_cards) will fail per-call.
  try {
    await ctx.api.get('/health');
    console.log(`[deckscout-mcp] deckscout-api ok at ${ctx.config.apiBase}`);
  } catch (err) {
    console.error(
      `[deckscout-mcp] WARN: deckscout-api unreachable at ${ctx.config.apiBase} (${(err as Error).message}) — API-backed tools will fail per-call.`,
    );
  }

  const handler = createMcpHandler(() => buildServer(ctx));
  const nodeHandler = toNodeHandler(handler, {
    onerror: (err) => console.error(`[deckscout-mcp] mcp handler error: ${err.message}`),
  });

  const app = createMcpExpressApp({ host: '0.0.0.0', allowedHosts: ALLOWED_HOSTS });

  // Plain JSON health for supervisors — no auth (SPEC §1). ok tracks the DB
  // (the hard dependency); api is informational.
  app.get('/health', (_req, res) => {
    void (async () => {
      let db = false;
      let api = false;
      try {
        await q(ctx.pool, 'SELECT 1');
        db = true;
      } catch {
        /* db stays false */
      }
      try {
        await ctx.api.get('/health');
        api = true;
      } catch {
        /* api stays false */
      }
      res.status(db ? 200 : 503).json({ ok: db, db, api });
    })();
  });

  // Auth BEFORE the MCP handler: x-brain-key header (fallback ?key= query)
  // must equal ROTOM_MCP_KEY. OPTIONS passes (CORS preflight carries no custom
  // headers). Failure → bare 401 body-less, deliberately WITHOUT
  // WWW-Authenticate (SPEC §2). Never log the supplied or expected key.
  const requireBrainKey: RequestHandler = (req, res, next) => {
    if (req.method === 'OPTIONS') {
      next();
      return;
    }
    const supplied = req.header('x-brain-key') ?? (typeof req.query.key === 'string' ? req.query.key : undefined);
    if (supplied !== undefined && supplied === ctx.config.key) {
      next();
      return;
    }
    res.status(401).end();
  };

  app.use('/mcp', requireBrainKey);
  app.all('/mcp', (req, res) => {
    void nodeHandler(req, res, req.body);
  });

  const httpServer = app.listen(ctx.config.port, '127.0.0.1', () => {
    console.log(`[deckscout-mcp] rotom-mcp listening on 127.0.0.1:${ctx.config.port} (/mcp + /health)`);
  });

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[deckscout-mcp] ${signal} received — shutting down`);
    httpServer.close(() => {
      void handler
        .close()
        .catch((err: unknown) => console.error(`[deckscout-mcp] handler close error: ${(err as Error).message}`))
        .then(() => ctx.pool.end())
        .catch((err: unknown) => console.error(`[deckscout-mcp] pool end error: ${(err as Error).message}`))
        .finally(() => process.exit(0));
    });
    // In-flight SSE streams can hold the server open; don't hang pm2 restarts.
    setTimeout(() => process.exit(0), 5_000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

// Under pm2 fork mode process.argv[1] is pm2's ProcessContainerFork.js wrapper,
// not our entry, so an argv-only check never fires. pm2 exposes the real script
// path in pm_exec_path; fall back to argv[1] for direct `node dist/index.js`
// runs. (Copied from apps/api/src/index.ts.)
const entryPath = process.env.pm_exec_path ?? process.argv[1] ?? '';
const isMain = entryPath.endsWith('index.js') || entryPath.endsWith('index.ts');
if (isMain) {
  main().catch((err: unknown) => {
    console.error(`[deckscout-mcp] FATAL: ${(err as Error).message}`);
    process.exit(1);
  });
}
