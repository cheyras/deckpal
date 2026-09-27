import express, { type Express, type Request, type Response } from 'express';
import type pg from 'pg';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { loadEnv, makePool, resolveToken, touchToken } from '@deckpal/db';
import { makeApi, redactEndpoints, type Ctx } from '@deckpal/agent-tools';
import { withUserContext } from './rls.js';
import { buildServer } from './server.js';

/**
 * deckpal-mcp, multi-user — the serverless face of the MCP server.
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
const DEFAULT_ALLOWED_HOSTS = 'deckpal.app,www.deckpal.app,localhost,127.0.0.1';

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
 * is no env var to get wrong. DECKPAL_API_BASE still wins when set, which is
 * what a split-hosting fork or a local `node dist/cloud.js` needs.
 */
function apiBaseFor(req: Request): string {
  const configured = process.env.DECKPAL_API_BASE;
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
    process.env.PGAPPNAME ??= 'deckpal-mcp';
    _pool = makePool(Number(process.env.PGPOOL_MAX_MCP ?? 2));
  }
  return _pool;
}

/**
 * The caller's personal access token, from either place a client can put it.
 *
 * 1. `Authorization: Bearer dsk_…` — the standard, and what Claude Code's
 *    `--header` flag produces.
 * 2. The last path segment — `https://deckpal.app/mcp/dsk_…`. claude.ai's
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

/**
 * Rate limiting (SEC-09): `/mcp` used to sit outside every limiter in this
 * codebase. Every request carrying a token-shaped credential runs a
 * `resolveToken` lookup and a `touchToken` UPDATE against
 * `PGPOOL_MAX_MCP=2` connections — a tiny, deliberately serverless-sized
 * budget — so a burst on one warm instance can starve every other caller
 * sharing it. Two layers, for two different threats:
 *
 * 1. {@link mcpPreResolveOk} — a single GLOBAL counter, checked before
 *    `resolveToken` runs at all, so a flood of credentials that never resolve
 *    (garbage, guesses, expired) is throttled before it can touch the pool.
 *    Deliberately ONE shared key, not one per credential: the first version
 *    of this limiter keyed the pre-resolution check on the credential itself
 *    (`sha256(raw token)`), and a caller who never authenticates can mint an
 *    unlimited number of distinct credential strings for free. Against a
 *    bounded per-credential map that means filling it with garbage entries —
 *    verified by reproduction: 10,000 fabricated Bearer values exhausted the
 *    map's admission capacity, and a brand-new, never-before-seen credential
 *    was then rejected even a full window later, because expired-but-present
 *    entries still counted against capacity until the next sweep. A global
 *    counter has no per-key capacity to exhaust; the worst a flood can do is
 *    spend the one shared budget for its own window, which self-heals every
 *    minute and never targets a specific future credential.
 * 2. {@link mcpRateOk} — a per-credential budget, checked AFTER
 *    `resolveToken` succeeds, keyed on the resolved `tokenId` rather than the
 *    raw credential string. This is the fairness guarantee SEC-09 actually
 *    asked for: no single (legitimate) token can crowd out another token's
 *    share of the connection budget. Keying it on `tokenId` rather than the
 *    raw string is what makes the bounded map safe again — a `tokenId` only
 *    exists for a real, database-verified token, and minting many of those
 *    already costs an account plus `/register`+`/token`'s own rate limits
 *    and `MAX_ACTIVE_TOKENS` (20/account), unlike a raw string an attacker
 *    can vary for free.
 *
 * Neither layer is keyed on the source IP. claude.ai's (and every other
 * hosted connector's) traffic arrives from that provider's own egress IPs,
 * shared across every one of that provider's users — an IP-keyed limit would
 * let one heavy user on a shared connector exhaust the budget for everyone
 * else behind the same egress IP, which is exactly the bug SEC-11 fixes for
 * `/bugs` one hop downstream. A request with no credential at all is already
 * the cheapest path in this handler (an immediate 401, no DB) and is not
 * metered by either layer — but see (1): the pre-resolution counter still
 * covers it once a credential-shaped string is present, valid or not.
 *
 * Per-instance only, like every limiter in this codebase (see
 * apps/api/src/rateLimit.ts): a cold start gets its own budget, so a caller
 * spread across instances gets N × this. That is an accepted trade-off
 * already documented for the REST API's limiters, and MCP traffic — a
 * handful of tool calls per conversational turn, per real user — is
 * low-volume enough that it holds here too.
 */

/**
 * Layer 1: global pre-resolution admission. 300/min per instance —
 * generous headroom over ordinary multi-tenant traffic on one warm instance
 * (every MCP tool call resolves its token fresh; there is no session reuse),
 * while still bounding how many `resolveToken` round trips a flood of
 * unresolvable credentials can force against the tiny 2-connection pool.
 */
export const MCP_PRERESOLVE_MAX = 300;
export const MCP_PRERESOLVE_WINDOW_MS = 60_000;
let mcpPreResolveCount = 0;
let mcpPreResolveResetAt = 0;

/** Exported for this gate's own tests; the HTTP handler below is the only other caller. */
export function mcpPreResolveOk(now = Date.now()): boolean {
  if (now >= mcpPreResolveResetAt) {
    mcpPreResolveCount = 0;
    mcpPreResolveResetAt = now + MCP_PRERESOLVE_WINDOW_MS;
  }
  mcpPreResolveCount++;
  return mcpPreResolveCount <= MCP_PRERESOLVE_MAX;
}

/** Test seam. */
export function __resetMcpPreResolveForTests(): void {
  mcpPreResolveCount = 0;
  mcpPreResolveResetAt = 0;
}

/**
 * Layer 2: per-resolved-token budget, 60/min. Called with `resolved.tokenId`
 * (a database-verified uuid), never the raw credential — see the block
 * comment above for why that distinction is what makes the bounded map safe.
 */
export const MCP_RATE_MAX = 60;
export const MCP_RATE_WINDOW_MS = 60_000;
const MCP_RATE_MAX_KEYS = 10_000;
const MCP_RATE_SWEEP_MS = 5 * 60_000;
const mcpRateBuckets = new Map<string, { count: number; resetAt: number }>();
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of mcpRateBuckets) {
    if (bucket.resetAt <= now) mcpRateBuckets.delete(key);
  }
}, MCP_RATE_SWEEP_MS).unref();

/** Exported for `mcpRateOk`'s own tests; the HTTP handler below is the only other caller. */
export function mcpRateOk(tokenId: string): boolean {
  const now = Date.now();
  let bucket = mcpRateBuckets.get(tokenId);
  if (!bucket || bucket.resetAt <= now) {
    // Bounded cardinality, same policy as RateLimitStore: never evict an
    // active bucket to admit a fresh key, so a flood of distinct tokenIds
    // cannot be used to push a real user's budget out of the map. Safe here
    // specifically because a tokenId cannot be fabricated for free (see the
    // block comment above) — the same check on a raw credential string was
    // the SEC-09 regression this layering fixes.
    if (!bucket && mcpRateBuckets.size >= MCP_RATE_MAX_KEYS) return false;
    bucket = { count: 0, resetAt: now + MCP_RATE_WINDOW_MS };
    mcpRateBuckets.set(tokenId, bucket);
  }
  bucket.count++;
  return bucket.count <= MCP_RATE_MAX;
}

/** Test seam: clears every bucket so cases don't leak into each other. */
export function __resetMcpRateLimitForTests(): void {
  mcpRateBuckets.clear();
}

/**
 * Where `/.well-known/oauth-protected-resource` lives — same host-validated
 * derivation as {@link apiBaseFor}, minus the `/api` suffix, since the
 * metadata endpoint is served from apps/api at the bare origin
 * (apps/api/src/oauthServer.ts), not under this MCP function.
 */
function originFor(req: Request): string {
  const configured = process.env.DECKPAL_PUBLIC_ORIGIN;
  if (configured) return configured.replace(/\/+$/, '');
  const host = req.headers.host ?? 'localhost';
  const proto = host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https';
  return `${proto}://${host}`;
}

/**
 * Bare 401, now WITH `WWW-Authenticate` — a real OAuth 2.1 "Connect" flow
 * exists (apps/api/src/oauthServer.ts), so a client that reads this hint and
 * fetches the protected-resource metadata lands on a working /authorize
 * instead of guessing one and 404ing (issue #29). The manual token / personal
 * connector URL below still works unchanged for clients that don't speak MCP
 * OAuth at all.
 */
function unauthorized(req: Request, res: Response, message: string): void {
  res.setHeader('WWW-Authenticate', `Bearer resource_metadata="${originFor(req)}/.well-known/oauth-protected-resource"`);
  res.status(401).json({ error: { code: 'unauthorized', message } });
}

/** A human hitting https://deckpal.app/mcp in a browser deserves a sentence, not a protocol error. */
function endpointCard(res: Response): void {
  res.status(200).json({
    name: 'deckpal-mcp',
    transport: 'streamable-http',
    auth: 'OAuth 2.1 ("Connect" in any MCP client), or Authorization: Bearer <personal access token>',
    tokens: 'Sign in and approve at /authorize, or create a token at /profile → Agent access',
    docs: 'https://github.com/cheyras/deckpal/blob/main/DEPLOYMENT.md#connect-an-ai-assistant-mcp',
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
          req,
          res,
          'No token. Connect via OAuth in your MCP client, send Authorization: Bearer <token>, or use the ' +
            'personal connector URL https://deckpal.app/mcp/<token>. Create a token in DeckPal at Profile → Agent access.',
        );
        return;
      }

      // SEC-09, layer 1: a global admission gate, BEFORE resolveToken, so a
      // flood of unresolvable tokens never reaches the pool. See mcpPreResolveOk's
      // doc comment for why this is one shared counter and not keyed on the
      // credential — the earlier, credential-keyed version of this check is
      // exactly the regression that comment documents.
      if (!mcpPreResolveOk()) {
        res.setHeader('Retry-After', '60');
        res.status(429).json({ error: { code: 'rate_limited', message: 'Too many requests — slow down.' } });
        return;
      }

      let resolved: Awaited<ReturnType<typeof resolveToken>>;
      try {
        resolved = await resolveToken(pool(), raw);
      } catch (err) {
        console.error('[deckpal-mcp] token lookup failed:', redactEndpoints(err));
        res.status(503).json({ error: { code: 'unavailable', message: 'Token store unreachable' } });
        return;
      }
      if (!resolved) {
        unauthorized(req, res, 'Invalid or revoked token.');
        return;
      }

      // SEC-09, layer 2: the per-token fairness budget, now that the
      // credential has resolved to a real, database-verified tokenId.
      if (!mcpRateOk(resolved.tokenId)) {
        res.setHeader('Retry-After', '60');
        res.status(429).json({ error: { code: 'rate_limited', message: 'Too many requests for this token — slow down.' } });
        return;
      }

      // Outside the RLS transaction on purpose: a tool error rolls that
      // transaction back, and "when was this token last used" should survive it.
      try {
        await touchToken(pool(), resolved.tokenId);
      } catch (err) {
        console.error('[deckpal-mcp] last_used_at touch failed:', redactEndpoints(err));
      }

      // Just the REST base. This used to be a whole McpConfig — including a
      // `port: 0` and an empty `key` with a comment saying the function never
      // listens — purely because Ctx demanded one. Ctx now asks for the three
      // fields a tool actually reads, so the placeholders are gone with it.
      const base = apiBaseFor(req);

      try {
        await withUserContext(pool(), resolved.userId, async (client) => {
          const ctx: Ctx = {
            db: client,
            api: makeApi(base, raw),
            userId: resolved.userId,
          };
          const handler = createMcpHandler(() => buildServer(ctx), {
            onerror: (err) => console.error(`[deckpal-mcp] mcp handler error: ${err.message}`),
          });
          try {
            await toNodeHandler(handler, {
              onerror: (err) => console.error(`[deckpal-mcp] adapter error: ${err.message}`),
            })(req, res, req.body);
          } finally {
            await handler.close();
          }
        });
      } catch (err) {
        console.error('[deckpal-mcp] request failed:', (err as Error).message);
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
  const port = Number(process.env.DECKPAL_MCP_CLOUD_PORT ?? 3705);
  createCloudApp().listen(port, '127.0.0.1', () => {
    console.log(`[deckpal-mcp] multi-user MCP listening on 127.0.0.1:${port}`);
  });
}
