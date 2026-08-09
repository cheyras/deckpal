import { dirname, join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '@deckscout/db';

loadEnv();

// Walk up from this compiled file to the repo root (marked by pnpm-workspace.yaml),
// so the paths are correct whether we run from dist/ (pm2) or src/ (tsx dev).
function repoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  throw new Error('repo root (pnpm-workspace.yaml) not found from ' + fileURLToPath(import.meta.url));
}

/**
 * Image-service configuration. All values come from the repo .env (loaded above)
 * or pm2 env; the defaults here match ecosystem.config.cjs so a bare `tsx` run
 * behaves identically to the pm2-managed process.
 */

// On-disk cache root. Wired in .env + ecosystem.config.cjs as IMAGE_CACHE_ROOT.
// It sits on the same filesystem as the repo and is gitignored (`cache/` and
// `**/*.webp` in .gitignore). DATA-LAYER §5.3 draws the layout under `data/`,
// but the shipped wiring points at `cache/`; we honour the wiring — the sub-tree
// layout (images/<lang>/<serie>/<set>/…) is identical.
export const CACHE_ROOT = process.env.IMAGE_CACHE_ROOT ?? resolve(repoRoot(), 'cache');

// Pokédex species sprite root (pixel art + official artwork, normal + shiny),
// populated out-of-band by the sprite background job. Disk layout under this root:
//   {id}.png                              → pixel art (normal)
//   shiny/{id}.png                        → pixel art (shiny)
//   other/official-artwork/{id}.png       → official artwork (normal)
//   other/official-artwork/shiny/{id}.png → official artwork (shiny)
// The insights backend (apps/api insights/pokedex.ts speciesSprite) references
// these at /deckscout/images/sprites/{pixel|art}[/shiny]/{id}.png — this service
// resolves those URLs to the paths above. Missing sprites 404 so the client can
// render its own placeholder tile (no layout shift), mirroring un-warmed card art.
export const SPRITE_ROOT = process.env.SPRITE_ROOT ?? resolve(repoRoot(), 'assets/sprites/pokemon');

export const IMAGES_PORT = Number(process.env.DECKSCOUT_IMAGES_PORT ?? 3701);

// Upstream asset origin. Only ever touched by the warmer, never the read path.
export const ASSETS_ORIGIN = 'https://assets.tcgdex.net';
export const DATAS_URL = `${ASSETS_ORIGIN}/datas.json`;

// English-only build (DATA-LAYER §3.5). One language; no server-side fallback.
export const LANG = 'en';

// The two real resolutions (DATA-LAYER §3.4). There is nothing above 600×825.
export const QUALITIES = ['low', 'high'] as const;
export type Quality = (typeof QUALITIES)[number];

// LRU / cap policy (DATA-LAYER §5.3, ARCHITECTURE §5.2).
export const CAP_BYTES = 4 * 1024 * 1024 * 1024; // 4 GB hard cap
export const EVICT_HIGH_WATER = Math.round(3.5 * 1024 * 1024 * 1024); // start evicting at 3.5 GB
export const EVICT_LOW_WATER = Math.round(3.0 * 1024 * 1024 * 1024); // stop at 3.0 GB

// Politeness to assets.tcgdex.net (DATA-LAYER §7.4): ≤5 req/s, ≤2 concurrent.
export const RATE_PER_SEC = 5;
export const MAX_CONCURRENCY = 2;

export const USER_AGENT = 'deckscout-images/1.0 (+cheyras@gmail.com)';

// Immutable-asset cache header, mirroring the origin (max-age=31536000).
export const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';
