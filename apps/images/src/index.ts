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

  // Pokédex species sprites (registered BEFORE the 5-segment card route; these are
  // 3–4 segments so they never collide). id is validated numeric to bar traversal.
  //   GET /pokedex/images/sprites/pixel/6.png        → {SPRITE_ROOT}/6.png
  //   GET /pokedex/images/sprites/pixel/shiny/6.png  → {SPRITE_ROOT}/shiny/6.png
  //   GET /pokedex/images/sprites/art/6.png          → {SPRITE_ROOT}/other/official-artwork/6.png
  //   GET /pokedex/images/sprites/art/shiny/6.png    → {SPRITE_ROOT}/other/official-artwork/shiny/6.png
  app.get('/pokedex/images/sprites/:kind/:a', spriteHandler);
  app.get('/pokedex/images/sprites/:kind/:shiny/:a', spriteHandler);

  // Mirrored-upstream card route: the local path is a pure function of the
  // upstream image URL (DATA-LAYER §5.3), so no DB lookup is needed to locate a file.
  //   GET /pokedex/images/en/sv/sv03.5/006/high.webp
  app.get('/pokedex/images/:lang/:serie/:set/:localId/:file', cardHandler);

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

// Under pm2 fork mode process.argv[1] is pm2's ProcessContainerFork.js wrapper, not
// our entry, so an argv-only check never fires. pm2 exposes the real script path in
// pm_exec_path; fall back to argv[1] for direct `node dist/index.js` runs.
const entryPath = process.env.pm_exec_path ?? process.argv[1] ?? '';
const isMain = entryPath.endsWith('index.js') || entryPath.endsWith('index.ts');
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
