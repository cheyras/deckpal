import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { isIP } from 'node:net';
import { rateLimit, ipKeyGenerator, type Store, type Options, type ClientRateLimitInfo, type RateLimitInfo } from 'express-rate-limit';

/**
 * Bounded in-memory rate limiter for per-user and per-IP abuse control.
 *
 * Limitations (document in summary.md):
 *   - Per-process: on serverless (Vercel), each cold start has its own budget.
 *     The limits below are per-function-instance, not global. A determined
 *     attacker spreading requests across instances gets N × budget. This is
 *     acceptable: the goal is stopping retry storms and casual abuse, not
 *     replacing a WAF.
 *   - No persistence: a process restart resets all windows.
 *   - Key cardinality is bounded by MAX_KEYS to prevent memory exhaustion from
 *     spoofed identities or IPs.
 */

// ── Bounded bucket store ────────────────────────────────────────────────────

interface Bucket {
  count: number;
  resetAt: number;
}

const MAX_KEYS = 10_000;

export class RateLimitStore {
  private readonly buckets = new Map<string, Bucket>();
  private readonly sweepTimer: ReturnType<typeof setInterval>;
  private lastSweepAt = 0;
  private _sweepCount = 0;

  constructor(private readonly sweepMs = 5 * 60_000) {
    this.sweepTimer = setInterval(() => this.sweep(), this.sweepMs);
    this.sweepTimer.unref();
  }

  /**
   * Check and increment. Returns seconds until reset if over limit, or 0 if allowed.
   * `whenFull`: what a NEW key gets when the map is at capacity. 'refuse' (the default) suits keys an attacker can
   * mint for free (IPs, guesses); 'admit' suits keys only a legitimate holder can present (a verified grant), where
   * refusing would let a full map lock out everyone else's valid requests (Astra, #339).
   */
  check(key: string, max: number, windowMs: number, now = Date.now(), whenFull: 'refuse' | 'admit' = 'refuse'): number {
    let b = this.buckets.get(key);
    if (!b || b.resetAt <= now) {
      // Enforce cardinality bound: if at capacity and this is a new key, reject
      // rather than evicting an active key (which would let an attacker reset
      // someone else's window).
      if (!b && this.buckets.size >= MAX_KEYS) {
        // Amortize sweep: only run a full scan at most once per second to
        // prevent a burst of rejected fresh keys from triggering unbounded
        // sequential full scans of the entire map. The periodic timer still
        // ensures eventual cleanup, and the 1-second cap means expired entries
        // are reclaimed promptly relative to typical 60-second windows.
        if (now - this.lastSweepAt >= 1000) {
          this.sweep(now);
        }
        if (this.buckets.size >= MAX_KEYS) {
          // Still full — reject cheaply (or, for verified keys, admit untracked).
          return whenFull === 'admit' ? 0 : Math.ceil(windowMs / 1000);
        }
      }
      b = { count: 0, resetAt: now + windowMs };
      this.buckets.set(key, b);
    }
    b.count++;
    if (b.count > max) {
      return Math.max(1, Math.ceil((b.resetAt - now) / 1000));
    }
    return 0;
  }

  /** Store adapter: retain the same atomic count and bounded admission policy. */
  increment(key: string, max: number, windowMs: number, now = Date.now()): ClientRateLimitInfo {
    this.check(key, max, windowMs, now);
    const bucket = this.buckets.get(key);
    // A fresh key at capacity is denied without allocation or active-key eviction.
    return {
      totalHits: bucket?.count ?? max + 1,
      resetTime: new Date(bucket?.resetAt ?? now + windowMs),
    };
  }

  decrement(key: string): void {
    const bucket = this.buckets.get(key);
    if (bucket) bucket.count = Math.max(0, bucket.count - 1);
  }

  resetKey(key: string): void { this.buckets.delete(key); }

  /** Remove expired entries. */
  sweep(now = Date.now()): void {
    this.lastSweepAt = now;
    this._sweepCount++;
    for (const [k, b] of this.buckets) {
      if (b.resetAt <= now) this.buckets.delete(k);
    }
  }

  /** Test seam. */
  clear(): void {
    this.buckets.clear();
  }

  get size(): number {
    return this.buckets.size;
  }

  /** How many full sweeps have been executed (test instrumentation). */
  get sweepCount(): number {
    return this._sweepCount;
  }

  destroy(): void {
    clearInterval(this.sweepTimer);
    this.buckets.clear();
  }
}

// ── Client identity resolution ──────────────────────────────────────────────

function isPlausibleIp(value: string): boolean {
  // Use Node's built-in net.isIP which correctly validates both IPv4 and IPv6
  // syntax, rejecting malformed values like ':', ':::', '1:2:3', '1::2::3',
  // too many groups, oversized groups, and IPv4 with leading zeros ('001.2.3.4').
  return isIP(value) !== 0;
}

/**
 * Resolve the rate-limit key for a request. Platform-aware:
 *
 * - **Vercel** (process.env.VERCEL === '1'): Vercel overwrites X-Forwarded-For
 *   and provides x-vercel-forwarded-for to prevent client spoofing (documented
 *   at vercel.com/docs/headers/request-headers). We prefer x-vercel-forwarded-for
 *   and fall back to x-forwarded-for. Both are validated for IP shape before use.
 *
 * - **Self-host / other**: Express trust proxy is left at its default (false),
 *   which means req.ip === req.socket.remoteAddress (the direct TCP peer).
 *   ALL forwarding headers are ignored — an attacker who controls them would
 *   bypass the limit otherwise.
 *
 * Never keys on the bearer token value or a token hash: an attacker can vary
 * synthetic dsk_ tokens to bypass protection entirely.
 */
function resolveClientKey(req: Request): string {
  if (process.env.VERCEL === '1') {
    // Vercel platform: trust its injected headers (Vercel overwrites these;
    // clients cannot spoof them on the Vercel edge).
    const vercelFwd = req.headers['x-vercel-forwarded-for'];
    if (typeof vercelFwd === 'string') {
      const ip = vercelFwd.split(',')[0]!.trim();
      if (ip && isPlausibleIp(ip)) return ip;
    }
    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string') {
      const ip = xff.split(',')[0]!.trim();
      if (ip && isPlausibleIp(ip)) return ip;
    }
    // Malformed headers — fall through to safe default
  }
  // Self-host / direct: use the socket peer address. Express trust proxy is
  // FALSE by default (not loopback — the Express docs at
  // expressjs.com/en/guide/behind-proxies.html confirm this), so req.ip is
  // the raw socket.remoteAddress.
  return req.ip ?? req.socket?.remoteAddress ?? 'unknown';
}

// ── Shared store for the API process ────────────────────────────────────────

const store = new RateLimitStore();

// ── Middleware factories ────────────────────────────────────────────────────

/**
 * Per-user rate limit middleware. Requires identity to be settled (after
 * authMiddleware / resolveIdentity). Uses req.user.id as the key.
 */
export function perUserRateLimit(
  routeTag: string,
  max: number,
  windowMs: number,
  injectedStore?: RateLimitStore,
): RequestHandler {
  const s = injectedStore ?? store;
  return (req: Request, res: Response, next: NextFunction): void => {
    const userId = req.user?.id;
    // Build the rate-limit key from user identity when available.
    // In self-host mode, authMiddleware does not set req.user (no Supabase),
    // but the single local user should still be metered: key on the socket
    // peer address instead. Cloud anonymous users are rejected earlier by
    // requireSession (401) and never reach this middleware.
    const key = userId
      ? `${routeTag}:${userId}`
      : `${routeTag}:local:${req.ip ?? req.socket?.remoteAddress ?? 'unknown'}`;
    const retryAfter = s.check(key, max, windowMs);
    if (retryAfter > 0) {
      res.setHeader('Retry-After', String(retryAfter));
      res.status(429).json({
        error: {
          code: 'rate_limited',
          message: `Too many requests — wait ${retryAfter}s and try again.`,
        },
      });
      return;
    }
    next();
  };
}

/**
 * Pre-auth ingress rate limit applied to ALL API requests, before
 * authMiddleware, to bound unauthenticated DB work (the RLS middleware
 * acquires a database connection even for catalog requests).
 *
 * Keys on the platform-aware client IP (see resolveClientKey):
 *   - Vercel: validated x-vercel-forwarded-for or x-forwarded-for
 *   - Self-host: raw socket peer address (trust proxy is FALSE by default)
 *
 * 600 requests per 60s per source IP per process — conservative enough for
 * normal app loads (a page load makes ~5-10 API calls, heavy browsing ~50)
 * while bounding unauthenticated DB connection acquisition.
 *
 * ⚠️ Express trust proxy is FALSE by default (not loopback — see
 * expressjs.com/en/guide/behind-proxies.html). We do NOT change it.
 */
export function preAuthRateLimit(
  max: number,
  windowMs: number,
  injectedStore?: RateLimitStore,
): RequestHandler {
  const s = injectedStore ?? store;
  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = resolveClientKey(req);
    const retryAfter = s.check(`preauth:${ip}`, max, windowMs);
    if (retryAfter > 0) {
      res.setHeader('Retry-After', String(retryAfter));
      res.status(429).json({
        error: {
          code: 'rate_limited',
          message: 'Too many requests — slow down.',
        },
      });
      return;
    }
    next();
  };
}

/**
 * Adapter for the maintained Express middleware. All instances share the
 * existing 10,000-key process bound, with separate prefixes and unchanged
 * fixed windows. No successful/failed-request refunds or skip rules are used.
 */
export class BoundedExpressStore implements Store {
  readonly localKeys = false;
  readonly prefix: string;

  constructor(
    routeTag: string,
    private readonly max: number,
    private readonly windowMs: number,
    private readonly backend: RateLimitStore = store,
  ) { this.prefix = routeTag + ':'; }

  increment(key: string): ClientRateLimitInfo {
    return this.backend.increment(this.prefix + key, this.max, this.windowMs);
  }
  decrement(key: string): void { this.backend.decrement(this.prefix + key); }
  resetKey(key: string): void { this.backend.resetKey(this.prefix + key); }
}

function verifiedUserKey(req: Request): string {
  return req.user?.id ?? 'local:' + ipKeyGenerator(req.ip ?? req.socket?.remoteAddress ?? 'unknown', false);
}

function boundedOptions(
  tag: string,
  max: number,
  windowMs: number,
  keyGenerator: (req: Request) => string,
  // `backend`: a store other than the shared one (the OAuth limiters below own
  // theirs). `refuse`: a different 429 body for routes whose callers are not
  // DeckPal's own clients; Retry-After and no-store are set either way.
  { backend, refuse }: { backend?: RateLimitStore; refuse?: (res: Response, retryAfter: number) => void } = {},
): Partial<Options> {
  return {
    windowMs, limit: max, keyGenerator,
    store: new BoundedExpressStore(tag, max, windowMs, backend),
    legacyHeaders: false,
    standardHeaders: false,
    passOnStoreError: false,
    handler(req, res) {
      const info = (req as Request & { rateLimit: RateLimitInfo }).rateLimit;
      const retryAfter = Math.max(1, Math.ceil(((info.resetTime?.getTime() ?? Date.now() + windowMs) - Date.now()) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      res.setHeader('Cache-Control', 'no-store');
      if (refuse) {
        refuse(res, retryAfter);
        return;
      }
      res.status(429).json({
        error: {
          code: 'rate_limited',
          message: tag === 'preauth' ? 'Too many requests — slow down.' : 'Too many requests — wait ' + retryAfter + 's and try again.',
        },
      });
    },
  };
}

// ── Pre-built middleware instances ───────────────────────────────────────────

/** Token minting/revocation: 20 requests per 60s per user. */
export const tokensRateLimit: RequestHandler = perUserRateLimit('tokens', 20, 60_000);

/**
 * Administration, including credit policy and operations: 120 requests per
 * 60s per user. Mounted once for the entire /admin subtree.
 */
export const adminRateLimit: RequestHandler = rateLimit(boundedOptions('admin', 120, 60_000, verifiedUserKey));

/** Wallet balance, statement, order polling and checkout: 180 requests per 60s per user. */
export const creditWalletRateLimit: RequestHandler = rateLimit(boundedOptions('credit-wallet', 180, 60_000, verifiedUserKey));

/** Avatar mutations: 10 requests per 60s per user. */
export const avatarRateLimit: RequestHandler = perUserRateLimit('avatar', 10, 60_000);

/** OAuth consent decisions: 30 requests per 60s per user. */
export const oauthRateLimit: RequestHandler = perUserRateLimit('oauth', 30, 60_000);

/**
 * Bug/feature reports (SEC-11): 10 requests per hour, per ACCOUNT rather than
 * per source IP.
 *
 * `routes/bugs.ts` used to key its own hand-rolled bucket on `req.ip` — behind
 * a reverse proxy (self-host, `trust proxy` false) that is always the same
 * loopback peer, so the 10/hour budget was really one bucket shared by every
 * user on the deployment; on Vercel it was the raw, unvalidated `req.ip`
 * rather than the platform-checked header every other limiter here uses. Either
 * way, one signed-in user filing (or scripting) 10 reports silenced reporting
 * for everybody else. The route already requires identity by the time it
 * runs (mounted behind `resolveIdentity`), so keying on `req.user.id` — same
 * as `/tokens` and `/avatar` — gives each account its own budget.
 */
export const bugsRateLimit: RequestHandler = perUserRateLimit('bugs', 10, 60 * 60_000);

/**
 * POST /decks/simulate: each call is up to 25 s of CPU (the battle simulator's
 * budget, apps/api/src/deck/simulate.ts). Six a minute is a person comparing
 * versions as fast as they can read the reports, and not a loop.
 */
export const simulateRateLimit: RequestHandler = perUserRateLimit('simulate', 6, 60_000);

// ── The public OAuth endpoints (SEC-09; limits raised 2026-10-12) ───────────

/**
 * The public half of the OAuth "Connect" flow: `/register`, `/token` and the
 * two `.well-known` discovery documents (oauthServer.ts). They are mounted on
 * the bare origin, ahead of the ordinary `/api` router, so none of the
 * limiters above ever see them.
 *
 * `/token` is where hosted connectors live: claude.ai, ChatGPT and the rest do
 * discovery, registration, the code exchange and every refresh from the
 * provider's own egress IPs, and an access token lasts an hour
 * (`ACCESS_TOKEN_TTL_SECONDS`, packages/db/src/grants.ts). Until 2026-10-12 the
 * limit was 30 a minute per source IP — under two thousand connections
 * refreshing through one IP — and the refusal came in DeckPal's
 * `{"error":{"code":…}}` shape, which an OAuth client reads as a failed
 * refresh: a disconnect.
 *
 * WHAT THE BUDGET IS KEYED ON, AND WHY. Three designs were reviewed and each
 * reproduced as a lockout (decisions/2026/2026-10-13-oauth-token-limits-keyed-on-the-verified-grant.md):
 * a global ceiling is a bucket any sender can empty for everybody; a
 * `client_id` is public, so a per-client budget is one anyone can empty for a
 * named client without a grant; and a per-IP budget at hosted-connector size
 * is one any OTHER sender on the same egress IP can empty. So `/token` keys
 * its real budget on what only the grant's holder has:
 *
 * 1. `tokenPerIpCeiling`: 6,000 a minute per source IP, first, before any body
 *    is read. It bounds the database work one address can cause; it is not
 *    the budget a client runs into. 6,000 is ten times the busiest minute of
 *    12,000 connections refreshing hourly behind one IP.
 * 2. `oauthGrantWait`, in the handler, after a read-only lookup of the
 *    presented secret (`peekGrantKey`) and BEFORE the grant's transaction:
 *    - a live refresh token spends its CONNECTION's budget, `tokenPerGrant`
 *      (30 a minute; a connection refreshes about once an hour). Only the
 *      refresh token's holder can spend it, and a refusal here leaves the
 *      token unrotated, so the client's retry still works;
 *    - a secret that matches nothing spends its source IP's
 *      `tokenInvalidPerIp` (120 a minute). That bucket only ever refuses
 *      requests that were going to fail anyway, so a neighbour's garbage
 *      cannot refuse a valid grant.
 *
 * Accepted limit: one sender can still refuse others on its own egress IP by
 * exceeding the 6,000 ceiling there, and a flood spread across many IPs can
 * load the database, as it always could. There is deliberately no global
 * ceiling.
 *
 * `/register` and the two `.well-known` documents keep per-IP limits:
 * registration happens once per connection (60 a minute), and discovery is
 * static JSON (1,200 a minute, both documents together, two per refresh).
 *
 * Every refusal is an RFC 6749 §5.2 error body; see `refuseOAuth`. Each bucket
 * lives in a store of its own, bounded like every RateLimitStore (a full map
 * refuses new keys rather than evicting live ones). Per-instance, like every
 * limiter in this file: each serverless instance counts for itself, and the
 * figures are sized as if one instance served everything.
 */
export const OAUTH_LIMITS = {
  windowMs: 60_000,
  tokenPerIpCeiling: 6_000,
  tokenPerGrant: 30,
  tokenInvalidPerIp: 120,
  registerPerIp: 60,
  discoveryPerIp: 1_200,
} as const;

/**
 * The 429 these endpoints answer: RFC 6749 §5.2's `{error, error_description}`
 * shape, which every OAuth client parses, instead of DeckPal's own.
 *
 * `temporarily_unavailable` on purpose. RFC 6749 defines it for the
 * authorization endpoint ("temporary overloading or maintenance"), and its
 * token-endpoint list (§5.2) has no rate-limit code at all. `slow_down`
 * belongs to device-flow polling (RFC 8628) and `too_many_requests` is the
 * MCP SDK's own, non-standard code. This is the standard word for "try again
 * later", and `/token` already answers its own 503 with it, so a client that
 * handles one handles both. Above all it is none of the codes that tell a
 * client its grant or registration is dead (`invalid_grant`,
 * `invalid_client`). Those make it throw its tokens away, which is the
 * disconnect this exists to stop.
 *
 * `error_description` stays inside the characters §5.2 allows (printable
 * ASCII without `"` or `\`).
 */
function refuseOAuth(res: Response, retryAfter: number): void {
  res.status(429).json({
    error: 'temporarily_unavailable',
    error_description: `Too many requests. Try again in ${retryAfter} seconds.`,
  });
}

// One store per bucket (see above), bounded like every RateLimitStore: a full
// map refuses new keys rather than evicting live ones.
const oauthTokenStore = new RateLimitStore();
const oauthGrantStore = new RateLimitStore();
const oauthInvalidGrantStore = new RateLimitStore();
const oauthRegisterStore = new RateLimitStore();
const oauthDiscoveryStore = new RateLimitStore();

const sourceIp = (req: Request): string => ipKeyGenerator(resolveClientKey(req), false);

/** `/token` layer 1: the per-IP ceiling, first, before the body is read. */
export const oauthTokenRateLimit: RequestHandler = rateLimit(
  boundedOptions('oauth-token', OAUTH_LIMITS.tokenPerIpCeiling, OAUTH_LIMITS.windowMs, sourceIp, { backend: oauthTokenStore, refuse: refuseOAuth }),
);

/**
 * `/token` layer 2: seconds to wait before this grant may be tried, or 0.
 * `grant` is `peekGrantKey`'s answer: a live grant's own identity (its
 * connection, or its code), or `null` for a secret that matches nothing live,
 * which is counted against the source IP's invalid-grant bucket instead.
 *
 * Two exemptions, both from Astra's third review (#339):
 * - a USED refresh token always passes. It is the reuse signal
 *   `refreshConnection` revokes the connection on; whoever spent the
 *   connection's 30 a minute could otherwise suppress that tripwire;
 * - a full grant store ADMITS a new key rather than refusing it. Its keys can
 *   only be presented by their holders, so refusing there would let a full map
 *   lock out every other valid grant.
 */
export function oauthGrantWait(grant: { key: string; used: boolean } | null, req: Request): number {
  if (grant?.used) return 0;
  return grant
    ? oauthGrantStore.check(grant.key, OAUTH_LIMITS.tokenPerGrant, OAUTH_LIMITS.windowMs, Date.now(), 'admit')
    : oauthInvalidGrantStore.check(sourceIp(req), OAUTH_LIMITS.tokenInvalidPerIp, OAUTH_LIMITS.windowMs);
}

/** The layer-2 refusal: the same 429 the express limiters answer. */
export function refuseOAuthGrant(res: Response, retryAfter: number): void {
  res.setHeader('Retry-After', String(retryAfter));
  res.setHeader('Cache-Control', 'no-store');
  refuseOAuth(res, retryAfter);
}

/** `/register`: per source IP, first, before the body is read. */
export const oauthRegisterRateLimit: RequestHandler = rateLimit(
  boundedOptions('oauth-register', OAUTH_LIMITS.registerPerIp, OAUTH_LIMITS.windowMs, sourceIp, { backend: oauthRegisterStore, refuse: refuseOAuth }),
);

/** Both `.well-known` documents, one bucket per source IP between them. */
export const oauthDiscoveryRateLimit: RequestHandler = rateLimit(
  boundedOptions('oauth-discovery', OAUTH_LIMITS.discoveryPerIp, OAUTH_LIMITS.windowMs, sourceIp, { backend: oauthDiscoveryStore, refuse: refuseOAuth }),
);

/** Test seam: empties every OAuth store so cases don't leak into each other. */
export function __resetOAuthRateLimitsForTests(): void {
  oauthTokenStore.clear();
  oauthGrantStore.clear();
  oauthInvalidGrantStore.clear();
  oauthRegisterStore.clear();
  oauthDiscoveryStore.clear();
}

/**
 * Pre-auth ingress guard: 600 requests per 60s per source IP per process.
 * Applies to ALL API requests (not just bearer-authenticated ones) because
 * the RLS middleware acquires a DB connection even for anonymous catalog reads.
 * Conservative enough for normal app loads while bounding unauthenticated
 * DB work from floods of any kind.
 */
export const preAuthFloodGuard: RequestHandler = rateLimit(boundedOptions('preauth', 600, 60_000, req => ipKeyGenerator(resolveClientKey(req), false)));

/**
 * Client-side crash reports (`POST /client-errors`, unauthenticated —
 * see `routes/clientErrors.ts`): 20 per 60s per source IP. The handler only
 * `console.error`s a truncated, PII-free payload, so this bounds log volume
 * from a repeating crash loop rather than guarding against real cost; the
 * shared `preAuthFloodGuard` above already applies to this route too.
 */
export const clientErrorRateLimit: RequestHandler = rateLimit(boundedOptions('client-errors', 20, 60_000, req => ipKeyGenerator(resolveClientKey(req), false)));

/**
 * The search-engine sitemaps (`GET /sitemap-*.xml`, sitemaps.ts): 30 per 60s
 * per source IP. They are mounted at the bare origin, outside the `/api`
 * router and so outside `preAuthFloodGuard`, and the card sitemap reads the
 * whole catalog. The CDN serves almost every fetch; this bounds the ones that
 * reach the function.
 */
export const sitemapRateLimit: RequestHandler = rateLimit(boundedOptions('sitemaps', 30, 60_000, req => ipKeyGenerator(resolveClientKey(req), false)));

export { RateLimitStore as _RateLimitStore };
