import { join } from 'node:path';
import { CACHE_ROOT } from './config.js';
import {
  cardRelativePath,
  setImageRelativePath,
  type CardRef,
  type Quality,
  type SetImageKind,
} from '@deckpal/storage';

/**
 * Path + cache-key algebra, self-host edition.
 *
 * The algebra itself now lives in `@deckpal/storage` (`paths.ts`) so that the
 * cloud image tier — a Vercel function with no local disk — resolves the exact
 * same relative paths and cache keys from the exact same request URLs. One
 * definition, two tiers: the object key in Supabase Storage IS the relative path
 * under IMAGE_CACHE_ROOT, which keeps a future bulk backfill a straight upload of
 * this tree.
 *
 * This module adds the only part that is disk-specific: turning a relative path
 * into an absolute one under CACHE_ROOT. Every existing import site keeps working
 * because the shared names are re-exported here.
 *
 * Upstream base URL:  https://assets.tcgdex.net/{lang}/{serie}/{set}/{localId}
 * Upstream asset URL:  …/{localId}/{quality}.webp
 * Local relative path: images/{lang}/{serie}/{set}/{localId}.{quality}.webp
 */

export {
  cardCacheKey,
  cardRelativePath,
  cardSourceUrl,
  setImageCacheKey,
  setImageRelativePath,
  setImageSourceUrl,
  type CardRef,
  type SetImageKind,
} from '@deckpal/storage';

export function cardAbsolutePath(ref: CardRef, quality: Quality): string {
  return join(CACHE_ROOT, cardRelativePath(ref, quality));
}

export function absoluteFromRelative(relativePath: string): string {
  return join(CACHE_ROOT, relativePath);
}

export function setImageAbsolutePath(setId: string, kind: SetImageKind): string {
  return join(CACHE_ROOT, setImageRelativePath(setId, kind));
}
