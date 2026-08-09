import type { NextFunction, Request, Response, RequestHandler } from 'express';

/**
 * HTTP plumbing shared by all routes: async error funnel, a typed
 * ApiError, query-param coercion, and cache-header helpers.
 *
 * Caching posture: the catalog is near-static between syncs, so pure-catalog
 * responses (series, sets, cards, search vocab) get a short shared-cache TTL.
 * Anything that mixes in the user's collection (progress, own= filters, dex
 * capture, prices as-of) is marked private + must-revalidate so a stale
 * collection never renders.
 */

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const notFound = (msg = 'Not found'): ApiError => new ApiError(404, 'not_found', msg);
export const badRequest = (msg: string): ApiError => new ApiError(400, 'bad_request', msg);

/** Wrap an async handler so thrown/rejected errors reach the error middleware. */
export function asyncHandler(fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler {
  return (req, res, next) => {
    fn(req, res).catch(next);
  };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorMiddleware(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ApiError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return;
  }
  // Log the real error server-side; send a generic message to the client.
  console.error('[deckscout-api] unhandled', err);
  res.status(500).json({ error: { code: 'internal', message: 'Internal server error' } });
}

// ── Cache headers ────────────────────────────────────────────────────────────

/** Catalog data that changes only on a sync. Safe for a shared cache. */
export function catalogCache(res: Response, seconds = 300): void {
  res.setHeader('Cache-Control', `public, max-age=${seconds}, stale-while-revalidate=600`);
}

/** Anything derived from the user's collection/prices. Private, revalidate. */
export function userCache(res: Response): void {
  res.setHeader('Cache-Control', 'private, no-cache, must-revalidate');
}

// ── Query-param coercion (all defensive; never throws on junk) ───────────────

export function str(v: unknown): string | undefined {
  if (typeof v === 'string' && v.length > 0) return v;
  if (Array.isArray(v) && typeof v[0] === 'string') return v[0];
  return undefined;
}

/** A repeatable param: ?variant=a&variant=b or a single ?variant=a. */
export function strList(v: unknown): string[] {
  if (typeof v === 'string') return v.length ? [v] : [];
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string' && x.length > 0);
  return [];
}

export function int(v: unknown, fallback: number): number {
  const s = str(v);
  if (s === undefined) return fallback;
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) ? n : fallback;
}

/** Bounded integer for pagination. */
export function clampInt(v: unknown, fallback: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, int(v, fallback)));
}

/** Map a raw value against a closed allow-list (case-insensitive). */
export function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  const s = str(v)?.toLowerCase();
  const hit = allowed.find((a) => a.toLowerCase() === s);
  return hit ?? fallback;
}
