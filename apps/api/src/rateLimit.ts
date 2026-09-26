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

  /** Check and increment. Returns seconds until reset if over limit, or 0 if allowed. */
  check(key: string, max: number, windowMs: number, now = Date.now()): number {
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
          // Still full — reject cheaply. Return a short retry window.
          return Math.ceil(windowMs / 1000);
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
): Partial<Options> {
  return {
    windowMs, limit: max, keyGenerator,
    store: new BoundedExpressStore(tag, max, windowMs),
    legacyHeaders: false,
    standardHeaders: false,
    passOnStoreError: false,
    handler(req, res) {
      const info = (req as Request & { rateLimit: RateLimitInfo }).rateLimit;
      const retryAfter = Math.max(1, Math.ceil(((info.resetTime?.getTime() ?? Date.now() + windowMs) - Date.now()) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      res.setHeader('Cache-Control', 'no-store');
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
 * The public half of the OAuth "Connect" flow (SEC-09): `/register`,
 * `/token` and the two `.well-known` discovery documents. These are mounted
 * on the bare origin, ahead of the ordinary `/api` router, so none of the
 * limiters above ever see them — `POST /register` in particular is an
 * unauthenticated `oauth_client` INSERT with no limiter at all upstream of it.
 *
 * Keyed the same way `preAuthFloodGuard` is (validated platform IP on Vercel,
 * raw socket peer on self-host — see `resolveClientKey`), because none of
 * these four requests carries a credential yet: there is no user or token to
 * key on. 30/min/IP is generous for a real client's discovery + register +
 * token-exchange sequence (a handful of requests) while still bounding an
 * unauthenticated INSERT loop and the token-exchange advisory lock it shares
 * with `/token`. A distinct tag from `preauth` — sharing that prefix with
 * `preAuthFloodGuard`'s 600/min budget would mean two different limits
 * fighting over one bucket.
 */
export const oauthPublicRateLimit: RequestHandler = rateLimit(
  boundedOptions('oauth-public', 30, 60_000, req => ipKeyGenerator(resolveClientKey(req), false)),
);

/**
 * Pre-auth ingress guard: 600 requests per 60s per source IP per process.
 * Applies to ALL API requests (not just bearer-authenticated ones) because
 * the RLS middleware acquires a DB connection even for anonymous catalog reads.
 * Conservative enough for normal app loads while bounding unauthenticated
 * DB work from floods of any kind.
 */
export const preAuthFloodGuard: RequestHandler = rateLimit(boundedOptions('preauth', 600, 60_000, req => ipKeyGenerator(resolveClientKey(req), false)));

export { RateLimitStore as _RateLimitStore };
