import { dirname, join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '@deckpal/db';

loadEnv();

// Walk up from this compiled file to the repo root (marked by pnpm-workspace.yaml),
// so the paths are correct whether we run from dist/ (production) or src/ (tsx dev).
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
 * or process-manager env; the defaults here match the project conventions so a
 * bare `tsx` run behaves identically to a managed process.
 */

// On-disk cache root. Wired as IMAGE_CACHE_ROOT in the repo .env (and whatever
// env the process manager passes through).
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
// these at /deckpal/images/sprites/{pixel|art}[/shiny]/{id}.png — this service
// resolves those URLs to the paths above. Missing sprites 404 so the client can
// render its own placeholder tile (no layout shift), mirroring un-warmed card art.
export const SPRITE_ROOT = process.env.SPRITE_ROOT ?? resolve(repoRoot(), 'assets/sprites/pokemon');

export const IMAGES_PORT = Number(process.env.DECKPAL_IMAGES_PORT ?? 3701);

// Upstream asset origin. Only ever touched by the warmer, never the read path.
export const ASSETS_ORIGIN = 'https://assets.tcgdex.net';
export const DATAS_URL = `${ASSETS_ORIGIN}/datas.json`;

// English-only build (DATA-LAYER §3.5), and the two real resolutions
// (DATA-LAYER §3.4 — there is nothing above 600×825). Defined once in
// @deckpal/storage so the cloud image tier cannot drift from this one.
export { LANG, QUALITIES, type Quality } from '@deckpal/storage';

// LRU / cap policy (DATA-LAYER §5.3, ARCHITECTURE §5.2).
export const CAP_BYTES = 4 * 1024 * 1024 * 1024; // 4 GB hard cap
export const EVICT_HIGH_WATER = Math.round(3.5 * 1024 * 1024 * 1024); // start evicting at 3.5 GB
export const EVICT_LOW_WATER = Math.round(3.0 * 1024 * 1024 * 1024); // stop at 3.0 GB

// Politeness to assets.tcgdex.net (DATA-LAYER §7.4): ≤5 req/s, ≤2 concurrent.
export const RATE_PER_SEC = 5;
export const MAX_CONCURRENCY = 2;

// Upstream user-agent and the immutable-asset cache header (max-age=31536000,
// mirroring the origin) — shared with the cloud tier, same reason as above.
export { IMMUTABLE_CACHE_CONTROL, USER_AGENT } from '@deckpal/storage';
