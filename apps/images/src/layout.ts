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
