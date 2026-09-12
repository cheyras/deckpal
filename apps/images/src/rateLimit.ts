import type { Request, Response, NextFunction, RequestHandler } from 'express';

/**
 * Application-level rate limiting for deckpal-images.
 *
 * This server binds to 127.0.0.1 only; nginx is the sole ingress. Rate limits
 * here protect against localhost abuse (misconfigured warm scripts, runaway
 * crawlers behind the proxy) without touching nginx config.
 *
 * Identity: uses the safe socket-peer address (req.ip with Express trust proxy
 * at its default FALSE). Behind a loopback nginx proxy this means all clients
 * share a single per-process budget — a coarse per-process/peer budget, not
 * per-end-user. This is accurate for self-host: the budget stops tight loops
 * before filesystem/DB work, while per-client granularity remains a
 * proxy/platform concern.
 *
 * Limitations:
 *   - Per-process only. If running multiple instances behind a load balancer
 *     each has its own budget.
 *   - No persistence across restarts.
 *   - Key cardinality bounded by MAX_KEYS.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const MAX_KEYS = 5_000;

export class ImageRateLimitStore {
  private readonly buckets = new Map<string, Bucket>();
  private readonly sweepTimer: ReturnType<typeof setInterval>;
  private lastSweepAt = 0;
  private _sweepCount = 0;

  constructor(sweepMs = 5 * 60_000) {
    this.sweepTimer = setInterval(() => this.sweep(), sweepMs);
    this.sweepTimer.unref();
  }

  check(key: string, max: number, windowMs: number, now = Date.now()): number {
    let b = this.buckets.get(key);
    if (!b || b.resetAt <= now) {
      if (!b && this.buckets.size >= MAX_KEYS) {
        // Amortize sweep: at most once per second to prevent a burst of
        // rejected fresh keys from triggering unbounded full scans.
        if (now - this.lastSweepAt >= 1000) {
          this.sweep(now);
        }
        if (this.buckets.size >= MAX_KEYS) {
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

  sweep(now = Date.now()): void {
    this.lastSweepAt = now;
    this._sweepCount++;
    for (const [k, b] of this.buckets) {
      if (b.resetAt <= now) this.buckets.delete(k);
    }
  }

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

const store = new ImageRateLimitStore();

function ipRateLimit(
  routeTag: string,
  max: number,
  windowMs: number,
  injectedStore?: ImageRateLimitStore,
): RequestHandler {
  const s = injectedStore ?? store;
  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = req.ip ?? 'unknown';
    const retryAfter = s.check(`${routeTag}:${ip}`, max, windowMs);
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
 * Health endpoint: 60 requests per 60s per IP.
 * Health calls cacheStats() which queries the DB, so it must be limited
 * BEFORE that work runs. Generous enough for monitoring probes while
 * stopping tight loops before DB work.
 */
export const healthRateLimit: RequestHandler = ipRateLimit('health', 60, 60_000);

/**
 * Asset routes (cards, sets, sprites): 3000 requests per 60s per IP.
 * Generous — large card/dex grids can request many images simultaneously.
 * Behind the loopback nginx proxy this is a per-process/peer budget shared
 * across all end-users: it stops tight loops before filesystem/DB work,
 * while per-client granularity remains a proxy/platform concern.
 */
export const assetRateLimit: RequestHandler = ipRateLimit('asset', 3000, 60_000);

export { ImageRateLimitStore as _ImageRateLimitStore };
export { ipRateLimit as _ipRateLimit };
