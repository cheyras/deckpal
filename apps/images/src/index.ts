import { existsSync } from 'node:fs';
import express from 'express';
import { loadEnv } from '@pokedex/db';

// Phase 2 · task 1 skeleton. Separate process so image I/O can never stall the API (ARCHITECTURE §4).
// It serves the WebP cache from disk; warming/fetch logic and image_asset LRU land in a later task.
loadEnv();

const cacheRoot = process.env.IMAGE_CACHE_ROOT ?? '/home/cheyras/pokedex/cache';

const app = express();

app.get('/api/pokedex/images/health', (_req, res) => {
  res.json({ status: 'ok', cacheRoot, cacheExists: existsSync(cacheRoot) });
});

// Static serving of the cache tree (no directory listing). Real cache-key routing is later work.
app.use('/pokedex/images', express.static(cacheRoot, { fallthrough: true, index: false }));

const port = Number(process.env.POKEDEX_IMAGES_PORT ?? 3701);
app.listen(port, '127.0.0.1', () => {
  console.log(`pokedex-images listening on 127.0.0.1:${port} (cache: ${cacheRoot})`);
});
