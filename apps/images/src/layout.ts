import { join } from 'node:path';
import { CACHE_ROOT, LANG, type Quality } from './config.js';

/**
 * Path + cache-key algebra. The whole point (DATA-LAYER §5.3) is that the local
 * path is a *pure function* of the upstream image URL: no mapping table, and a
 * plain rsync of the tree is a full restore. So the read path never needs the DB
 * to locate a file.
 *
 * Upstream base URL:  https://assets.tcgdex.net/{lang}/{serie}/{set}/{localId}
 * Upstream asset URL:  …/{localId}/{quality}.webp
 * Local relative path: images/{lang}/{serie}/{set}/{localId}.{quality}.webp
 */

export interface CardRef {
  serie: string; // e.g. 'sv'
  set: string; // e.g. 'sv03.5'
  localId: string; // e.g. '006'
}

export function cardRelativePath(ref: CardRef, quality: Quality): string {
  return join('images', LANG, ref.serie, ref.set, `${ref.localId}.${quality}.webp`);
}

export function cardAbsolutePath(ref: CardRef, quality: Quality): string {
  return join(CACHE_ROOT, cardRelativePath(ref, quality));
}

export function absoluteFromRelative(relativePath: string): string {
  return join(CACHE_ROOT, relativePath);
}

// image_asset.cache_key — deterministic, stable, matches the schema comment shape
// ('card:<setId>-<localId>:<quality>'). The card id is TCGdex's own `{set}-{localId}`.
export function cardCacheKey(ref: CardRef, quality: Quality): string {
  return `card:${ref.set}-${ref.localId}:${quality}`;
}

export function cardSourceUrl(ref: CardRef, quality: Quality): string {
  return `https://assets.tcgdex.net/${LANG}/${ref.serie}/${ref.set}/${ref.localId}/${quality}.webp`;
}

// ── Set imagery (logo + symbol) ──────────────────────────────────────────────
// Set logos/symbols are catalog imagery, warmed from the base URLs stored in
// card_set (logo_url / symbol_url). The correct TCGdex asset is the stored base
// URL + '.webp' (DATA-LAYER §3.4). We key/serve them by the set's tcgdex_id, the
// same id the API and SPA already route on, so the read path needs no DB lookup:
//   local path: sets/{setId}/{logo|symbol}.webp
// These are tiny (~4 MB total across 218 sets) and are NOT eviction candidates —
// their cache_key never ends in ':high' (see assets.ts evictionCandidates).

export type SetImageKind = 'logo' | 'symbol';

export function setImageRelativePath(setId: string, kind: SetImageKind): string {
  return join('sets', setId, `${kind}.webp`);
}

export function setImageAbsolutePath(setId: string, kind: SetImageKind): string {
  return join(CACHE_ROOT, setImageRelativePath(setId, kind));
}

export function setImageCacheKey(setId: string, kind: SetImageKind): string {
  return `set:${setId}:${kind}`;
}

// The upstream asset URL is the stored base URL with a '.webp' suffix. The base
// already encodes the correct origin path (…/en/{serie}/{set}/logo for logos,
// …/univ/{serie}/{set}/symbol for symbols), so we only append the extension.
export function setImageSourceUrl(baseUrl: string): string {
  return /\.webp$/i.test(baseUrl) ? baseUrl : `${baseUrl}.webp`;
}
