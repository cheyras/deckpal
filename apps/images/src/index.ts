import { existsSync } from 'node:fs';
import { join } from 'node:path';
import express, { type Request, type Response } from 'express';
import {
  CACHE_ROOT,
  IMAGES_PORT,
  IMMUTABLE_CACHE_CONTROL,
  LANG,
  QUALITIES,
  SPRITE_ROOT,
  type Quality,
} from './config.js';
import {
  cardAbsolutePath,
  cardCacheKey,
  setImageAbsolutePath,
  type CardRef,
  type SetImageKind,
} from './layout.js';
import { cacheStats, closePool, touchLastAccess } from './assets.js';
import { PLACEHOLDER_CONTENT_TYPE, PLACEHOLDER_WEBP } from './placeholder.js';
import { healthRateLimit, assetRateLimit } from './rateLimit.js';

/**
 * deckpal-images — serves the local WebP cache (ARCHITECTURE §4, §5.2, §7.5).
 *
 * Contract:
 *  - Cache HIT  → 200 image/webp, immutable long-cache + ETag (via res.sendFile),
 *    conditional-GET (304) support, plus a fire-and-forget LRU recency bump.
 *  - Cache MISS → 200 image/webp PLACEHOLDER, `no-store`, X-Cache: MISS. The read
 *    path NEVER proxies upstream (would couple page load to network health, §7.5);
 *    warming is the warmer's job, invoked out-of-band.
 *  - 127.0.0.1 only; nginx is the sole ingress. No auth of its own.
 */

function isQuality(v: string): v is Quality {
  return (QUALITIES as readonly string[]).includes(v);
}

/**
 * Optional dependency injection for no-DB testing. When omitted, defaults to
 * the production implementations — no external switch or environment variable.
 */
export interface ImageAppDeps {
  cacheStats?: typeof cacheStats;
  touchLastAccess?: typeof touchLastAccess;
}

export function createApp(deps?: ImageAppDeps): express.Express {
  const _cacheStats = deps?.cacheStats ?? cacheStats;
  const _touchLastAccess = deps?.touchLastAccess ?? touchLastAccess;

  const app = express();
  app.disable('x-powered-by');

  // Health calls cacheStats() which queries the DB — rate-limit BEFORE that work.
  app.get('/api/deckpal/images/health', healthRateLimit, async (_req, res) => {
    let db: 'up' | 'down' = 'down';
    let stats: Awaited<ReturnType<typeof _cacheStats>> | null = null;
    try {
      stats = await _cacheStats();
      db = 'up';
    } catch {
      /* health still reports; DB optional for serving */
    }
    res.json({
      status: 'ok',
      cacheExists: existsSync(CACHE_ROOT),
      db,
      cache: stats,
    });
  });

  // Asset rate limit: 3000 requests per 60s per IP. Applied BEFORE filesystem/DB
  // operations on all four asset handlers. Generous for large card/dex grids
  // but bounds tight loops before expensive work. Behind loopback nginx this is
  // a coarse per-process/peer budget shared across all end-users.
  app.get('/deckpal/images/sprites/:kind/:a', assetRateLimit, spriteHandler);
  app.get('/deckpal/images/sprites/:kind/:shiny/:a', assetRateLimit, spriteHandler);
  app.get('/deckpal/images/sets/:setId/:file', assetRateLimit, setHandler);
  app.get('/deckpal/images/:lang/:serie/:set/:localId/:file', assetRateLimit, makeCardHandler(_touchLastAccess));

  return app;
}

// Resolve a sprite URL to its on-disk path and serve it, or 404 on miss so the
// client renders its own placeholder tile. No upstream fetch (same rule as cards).
function spriteHandler(req: Request, res: Response): void {
  const p = (v: string | string[] | undefined): string => (typeof v === 'string' ? v : '');
  const kind = p(req.params.kind); // 'pixel' | 'art'
  const shinySeg = req.params.shiny !== undefined; // present only on the shiny route
  if (shinySeg && p(req.params.shiny) !== 'shiny') {
    res.status(404).end();
    return;
  }
  const fileParam = p(req.params.a); // e.g. '6.png'
  const m = /^(\d+)\.png$/.exec(fileParam);
  if ((kind !== 'pixel' && kind !== 'art') || !m) {
    res.status(404).end();
    return;
  }
  const id = m[1]!;
  const subdir = kind === 'art' ? 'other/official-artwork' : '';
  const shinyDir = shinySeg ? 'shiny' : '';
  const abs = join(SPRITE_ROOT, subdir, shinyDir, `${id}.png`);
  if (!existsSync(abs)) {
    res.status(404).end();
    return;
  }
  res.setHeader('Cache-Control', IMMUTABLE_CACHE_CONTROL);
  res.setHeader('X-Cache', 'HIT');
  res.sendFile(abs, { headers: { 'Cache-Control': IMMUTABLE_CACHE_CONTROL } }, (err) => {
    if (err && !res.headersSent) res.status(404).end();
  });
}

// Serve a cached set logo/symbol, or 404 on miss (the SPA renders its own neutral
// placeholder — no broken image, no layout shift). No upstream fetch (same rule as
// cards/sprites). setId is validated to bar path traversal; only logo|symbol allowed.
function setHandler(req: Request, res: Response): void {
  const p = (v: string | string[] | undefined): string => (typeof v === 'string' ? v : '');
  const setId = p(req.params.setId);
  const file = p(req.params.file);

  // TCGdex set ids are [A-Za-z0-9.-] (e.g. base1, sv03.5, A1a, P-A, tk-bw-e). Reject
  // anything else and, defensively, any '..' so setId can never escape the sets root.
  if (!/^[A-Za-z0-9][A-Za-z0-9.-]*$/.test(setId) || setId.includes('..')) {
    res.status(404).end();
    return;
  }
  const m = /^(logo|symbol)\.webp$/.exec(file);
  if (!m) {
    res.status(404).end();
    return;
  }
  const kind = m[1] as SetImageKind;
  const abs = setImageAbsolutePath(setId, kind);
  if (!existsSync(abs)) {
    res.status(404).end();
    return;
  }
  res.setHeader('Cache-Control', IMMUTABLE_CACHE_CONTROL);
  res.setHeader('X-Cache', 'HIT');
  res.sendFile(abs, { headers: { 'Cache-Control': IMMUTABLE_CACHE_CONTROL } }, (err) => {
    if (err && !res.headersSent) res.status(404).end();
  });
}

function makeCardHandler(onAccess: typeof touchLastAccess) {
  return function cardHandler(req: Request, res: Response): void {
    const p = (v: string | string[] | undefined): string => (typeof v === 'string' ? v : '');
    const lang = p(req.params.lang);
    const serie = p(req.params.serie);
    const set = p(req.params.set);
    const localId = p(req.params.localId);
    const file = p(req.params.file);

    // Same validation setHandler applies: [A-Za-z0-9][A-Za-z0-9.-]* + no '..' to
    // bar path traversal. localId also allows digits-only (e.g. '006', 'TG05').
    const seg = /^[A-Za-z0-9][A-Za-z0-9.-]*$/;
    if (
      !seg.test(serie) || serie.includes('..') ||
      !seg.test(set) || set.includes('..') ||
      !seg.test(localId) || localId.includes('..')
    ) {
      res.status(404).end();
      return;
    }

    const m = /^(low|high)\.webp$/.exec(file);
    const qual = m?.[1];
    if (!qual || lang !== LANG || !isQuality(qual)) {
      servePlaceholder(res, 'bad-request');
      return;
    }
    const quality: Quality = qual;
    const ref: CardRef = { serie, set, localId };
    const abs = cardAbsolutePath(ref, quality);

    if (!existsSync(abs)) {
      servePlaceholder(res, 'miss');
      return;
    }

    // HIT — sendFile handles Content-Type, strong ETag, Last-Modified, Range and
    // conditional-GET (304). We override Cache-Control to the immutable long-cache.
    res.setHeader('Cache-Control', IMMUTABLE_CACHE_CONTROL);
    res.setHeader('X-Cache', 'HIT');
    res.sendFile(abs, { headers: { 'Cache-Control': IMMUTABLE_CACHE_CONTROL } }, (err) => {
      if (err && !res.headersSent) {
        servePlaceholder(res, 'miss');
        return;
      }
      if (!err) onAccess(cardCacheKey(ref, quality)); // fire-and-forget LRU bump
    });
  };
}

function servePlaceholder(res: Response, reason: 'miss' | 'bad-request'): void {
  res.status(reason === 'bad-request' ? 400 : 200);
  res.setHeader('Content-Type', PLACEHOLDER_CONTENT_TYPE);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Cache', 'MISS');
  res.setHeader('X-Placeholder', '1');
  res.end(PLACEHOLDER_WEBP);
}

// Under some process managers (fork mode) process.argv[1] is a wrapper, not our
// entry, so an argv-only check never fires. pm_exec_path (if set) holds the real
// script path; fall back to argv[1] for direct `node dist/index.js` runs.
const entryPath = process.env.pm_exec_path ?? process.argv[1] ?? '';
const isMain = entryPath.endsWith('index.js') || entryPath.endsWith('index.ts');
if (isMain) {
  const app = createApp();
  const server = app.listen(IMAGES_PORT, '127.0.0.1', () => {
    console.log(`deckpal-images listening on 127.0.0.1:${IMAGES_PORT} (cache: ${CACHE_ROOT})`);
  });
  const shutdown = () => {
    server.close(() => {
      void closePool().finally(() => process.exit(0));
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
