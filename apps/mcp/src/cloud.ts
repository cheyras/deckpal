import express, { type Express, type Request, type Response } from 'express';
import type pg from 'pg';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { loadEnv, makePool, resolveToken, touchToken } from '@deckscout/db';
import { makeApi } from './api.js';
import type { Ctx } from './ctx.js';
import { withUserContext } from './rls.js';
import { buildServer } from './server.js';

/**
 * rotom-mcp, multi-user — the serverless face of the MCP server.
 *
 * Self-host (`index.ts`) runs one long-lived process for one user behind a
 * shared `x-brain-key`. This entry serves *any* signed-up user from a single
 * Vercel function, and the difference is entirely in how the context is built:
 *
 *   1. `Authorization: Bearer dsk_…` → SHA-256 → `api_token` row → `user_id`.
 *      Missing, malformed, unknown or revoked ⇒ 401, no further work.
 *   2. Open that user's RLS transaction (`SET LOCAL role = 'authenticated'`,
 *      `request.jwt.claims.sub = user_id`) and build a per-request `Ctx` whose
 *      `db` is that transaction's client.
 *   3. Serve exactly one MCP exchange on a fresh `McpServer` built from that
 *      context (stateless HTTP — the SDK's `createMcpHandler` factory shape),
 *      then close it and commit.
 *
 * Every tool is therefore doubly scoped: its own `WHERE user_id = $1` bind
 * parameter, and the row-level policies of migration 021 firing underneath it.
 * API-backed tools carry the same token onward in their own `Authorization`
 * header, so the REST side resolves the identical user rather than trusting
 * anything the MCP layer says.
 *
 * Nothing is shared between requests except the pg pool and the module itself.
 */

// ── Host allowlist (DNS-rebinding protection, SPEC §2) ──────────────────────
// Public deployments answer on their own domain; the code default also lets
// localhost through so `vercel dev` and a plain `node dist/cloud.js` work out
// of the box. Override with MCP_ALLOWED_HOSTS (comma-separated) — set it to
// your own domain on a fork. '*' disables the check for hosts that already
// terminate at a single trusted proxy.
const DEFAULT_ALLOWED_HOSTS = 'deckscout.io,www.deckscout.io,localhost,127.0.0.1';

function allowedHosts(): string[] {
  return (process.env.MCP_ALLOWED_HOSTS ?? DEFAULT_ALLOWED_HOSTS)
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

/** Host header without its port; '' when absent. */
function hostname(req: Request): string {
  const raw = (req.headers.host ?? '').toLowerCase();
  // IPv6 literals arrive bracketed: [::1]:3000
  if (raw.startsWith('[')) return raw.slice(0, raw.indexOf(']') + 1);
  const colon = raw.lastIndexOf(':');
  return colon === -1 ? raw : raw.slice(0, colon);
}

function hostAllowed(req: Request): boolean {
  const list = allowedHosts();
  if (list.includes('*')) return true;
  const host = hostname(req);
  // Vercel serves every deployment on a *.vercel.app alias too; allowing them
  // keeps preview deployments testable without widening production's list.
  if (host.endsWith('.vercel.app')) return true;
  return list.includes(host);
}

/**
 * Where the REST API lives, derived from the (already host-validated) request
 * rather than configured: the MCP endpoint and the API are the same
 * deployment, so `https://<this host>/api` is true by construction and there
 * is no env var to get wrong. DECKSCOUT_API_BASE still wins when set, which is
 * what a split-hosting fork or a local `node dist/cloud.js` needs.
 */
function apiBaseFor(req: Request): string {
  const configured = process.env.DECKSCOUT_API_BASE;
  if (configured) return configured;
  const host = req.headers.host ?? 'localhost';
  const proto = host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https';
  return `${proto}://${host}/api`;
}

// ── Pool ────────────────────────────────────────────────────────────────────
// Module-scoped so warm invocations reuse connections. 2 is the serverless
// budget from contract B2 (makePool hard-caps at 3 regardless): one for the
// token lookup, one for the request's RLS transaction, which run in sequence.
let _pool: pg.Pool | undefined;
function pool(): pg.Pool {
  if (!_pool) {
    loadEnv();
    process.env.PGAPPNAME ??= 'deckscout-mcp';
    _pool = makePool(Number(process.env.PGPOOL_MAX_MCP ?? 2));
  }
  return _pool;
}

/**
 * The caller's personal access token, from either place a client can put it.
 *
 * 1. `Authorization: Bearer dsk_…` — the standard, and what Claude Code's
 *    `--header` flag produces.
 * 2. The last path segment — `https://deckscout.io/mcp/dsk_…`. claude.ai's
 *    "Add custom connector" dialog takes a URL and (unless the server runs a
 *    full OAuth flow) nothing else, so for that client the URL *is* the
 *    credential. It is exactly the same secret, revocable from the same panel
 *    and scoped to exactly one user; the UI labels the URL as a password so
 *    nobody pastes it into a screenshot.
 *
 * Nothing else is accepted — in particular no query string, so a token cannot
 * arrive somewhere a `Referer` header would carry it onward.
 */
function tokenFrom(req: Request): string {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) return auth.slice(7).trim();
  const last = (req.path || '/').split('/').filter(Boolean).pop() ?? '';
  return last.startsWith('dsk_') ? last : '';
}

/** Bare 401. Deliberately WITHOUT `WWW-Authenticate`: claude.ai reads that header as an OAuth trigger and abandons the manual-token flow (SPEC §2). */
function unauthorized(res: Response, message: string): void {
  res.status(401).json({ error: { code: 'unauthorized', message } });
}

/** A human hitting https://deckscout.io/mcp in a browser deserves a sentence, not a protocol error. */
function endpointCard(res: Response): void {
  res.status(200).json({
    name: 'rotom-mcp',
    transport: 'streamable-http',
    auth: 'Authorization: Bearer <personal access token>',
    tokens: 'Create one at /profile → Agent access',
    docs: 'https://github.com/cheyras/deckscout/blob/main/DEPLOYMENT.md#connect-an-ai-assistant-mcp',
  });
}

export function createCloudApp(): Express {
  const app = express();
  app.disable('x-powered-by');
  // Vercel terminates TLS ahead of the function; trust its forwarding headers
  // so req.ip is the caller and not the proxy.
  app.set('trust proxy', true);
  app.use(express.json({ limit: '1mb' }));

  app.all(/.*/, (req, res) => {
    void (async () => {
      if (!hostAllowed(req)) {
        res.status(421).json({ error: { code: 'bad_host', message: 'Host not allowed' } });
        return;
      }
      // CORS preflight carries no custom headers, so it can never be authorised.
      if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Origin', req.headers.origin ?? '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,Mcp-Session-Id,MCP-Protocol-Version');
        res.status(204).end();
        return;
      }

      const raw = tokenFrom(req);

      // A browser GET (no credential, HTML accepted) gets the endpoint card;
      // an MCP client always sends Authorization and Accept: …/event-stream.
      if (!raw && req.method === 'GET' && (req.headers.accept ?? '').includes('text/html')) {
        endpointCard(res);
        return;
      }
      if (!raw) {
        unauthorized(
          res,
          'No token. Send Authorization: Bearer <token>, or use the personal connector URL ' +
            'https://deckscout.io/mcp/<token>. Create a token in DeckScout at Profile → Agent access.',
        );
        return;
      }

      let resolved: Awaited<ReturnType<typeof resolveToken>>;
      try {
        resolved = await resolveToken(pool(), raw);
      } catch (err) {
        console.error('[deckscout-mcp] token lookup failed:', (err as Error).message);
        res.status(503).json({ error: { code: 'unavailable', message: 'Token store unreachable' } });
        return;
      }
      if (!resolved) {
        unauthorized(res, 'Invalid or revoked token.');
        return;
      }

      // Outside the RLS transaction on purpose: a tool error rolls that
      // transaction back, and "when was this token last used" should survive it.
      try {
        await touchToken(pool(), resolved.tokenId);
      } catch (err) {
        console.error('[deckscout-mcp] last_used_at touch failed:', (err as Error).message);
      }

      const config = {
        port: 0, // never listens here — Vercel owns the socket
        key: '',
        apiBase: apiBaseFor(req),
      };

      try {
        await withUserContext(pool(), resolved.userId, async (client) => {
          const ctx: Ctx = {
            db: client,
            api: makeApi(config.apiBase, raw),
            userId: resolved.userId,
            config,
          };
          const handler = createMcpHandler(() => buildServer(ctx), {
            onerror: (err) => console.error(`[deckscout-mcp] mcp handler error: ${err.message}`),
          });
          try {
            await toNodeHandler(handler, {
              onerror: (err) => console.error(`[deckscout-mcp] adapter error: ${err.message}`),
            })(req, res, req.body);
          } finally {
            await handler.close();
          }
        });
      } catch (err) {
        console.error('[deckscout-mcp] request failed:', (err as Error).message);
        if (!res.headersSent) {
          res.status(500).json({ error: { code: 'internal', message: 'Internal server error' } });
        }
      }
    })();
  });

  return app;
}

// A plain `node dist/cloud.js` runs the same app on a port — handy for probing
// the multi-user path locally without a Vercel deployment.
const entryPath = process.env.pm_exec_path ?? process.argv[1] ?? '';
if (entryPath.endsWith('cloud.js') || entryPath.endsWith('cloud.ts')) {
  const port = Number(process.env.DECKSCOUT_MCP_CLOUD_PORT ?? 3705);
  createCloudApp().listen(port, '127.0.0.1', () => {
    console.log(`[deckscout-mcp] multi-user MCP listening on 127.0.0.1:${port}`);
  });
}
