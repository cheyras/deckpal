import { existsSync } from 'node:fs';
import express, { type Request, type Response } from 'express';
import {
  CACHE_ROOT,
  IMAGES_PORT,
  IMMUTABLE_CACHE_CONTROL,
  LANG,
  QUALITIES,
  type Quality,
} from './config.js';
import { cardAbsolutePath, cardCacheKey, type CardRef } from './layout.js';
import { cacheStats, closePool, touchLastAccess } from './assets.js';
import { PLACEHOLDER_CONTENT_TYPE, PLACEHOLDER_WEBP } from './placeholder.js';

/**
 * pokedex-images — serves the local WebP cache (ARCHITECTURE §4, §5.2, §7.5).
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

export function createApp(): express.Express {
  const app = express();
  app.disable('x-powered-by');

  app.get('/api/pokedex/images/health', async (_req, res) => {
    let db: 'up' | 'down' = 'down';
    let stats: Awaited<ReturnType<typeof cacheStats>> | null = null;
    try {
      stats = await cacheStats();
      db = 'up';
    } catch {
      /* health still reports; DB optional for serving */
    }
    res.json({
      status: 'ok',
      cacheRoot: CACHE_ROOT,
      cacheExists: existsSync(CACHE_ROOT),
      db,
      cache: stats,
    });
  });

  // Mirrored-upstream card route: the local path is a pure function of the
  // upstream image URL (DATA-LAYER §5.3), so no DB lookup is needed to locate a file.
  //   GET /pokedex/images/en/sv/sv03.5/006/high.webp
  app.get('/pokedex/images/:lang/:serie/:set/:localId/:file', cardHandler);

  return app;
}

function cardHandler(req: Request, res: Response): void {
  const p = (v: string | string[] | undefined): string => (typeof v === 'string' ? v : '');
  const lang = p(req.params.lang);
  const serie = p(req.params.serie);
  const set = p(req.params.set);
  const localId = p(req.params.localId);
  const file = p(req.params.file);

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
    if (!err) touchLastAccess(cardCacheKey(ref, quality)); // fire-and-forget LRU bump
  });
}

function servePlaceholder(res: Response, reason: 'miss' | 'bad-request'): void {
  res.status(reason === 'bad-request' ? 400 : 200);
  res.setHeader('Content-Type', PLACEHOLDER_CONTENT_TYPE);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Cache', 'MISS');
  res.setHeader('X-Placeholder', '1');
  res.end(PLACEHOLDER_WEBP);
}

const isMain = process.argv[1]?.endsWith('index.js') || process.argv[1]?.endsWith('index.ts');
if (isMain) {
  const app = createApp();
  const server = app.listen(IMAGES_PORT, '127.0.0.1', () => {
    console.log(`pokedex-images listening on 127.0.0.1:${IMAGES_PORT} (cache: ${CACHE_ROOT})`);
  });
  const shutdown = () => {
    server.close(() => {
      void closePool().finally(() => process.exit(0));
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
