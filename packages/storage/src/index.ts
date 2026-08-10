/**
 * @deckscout/storage — the cached-image asset layer.
 *
 * Two things live here:
 *   1. `paths.ts` — the ONE definition of the path/cache-key algebra, shared by
 *      the self-host disk tier (apps/images re-exports it) and the cloud object
 *      tier, plus the request parser both use to validate an incoming image URL.
 *   2. everything else — the cloud object tier: Supabase Storage reads/writes,
 *      the `image_asset` manifest over PostgREST, and `put-asset.ts`, the choke
 *      point that keeps bytes and provenance in step.
 *
 * Importing this package is side-effect free; credentials are read lazily, so
 * apps/images can depend on it for the path algebra alone.
 */
export * from './paths.js';
export * from './sniff.js';
export * from './placeholder.js';
export * from './config.js';
export * from './object-store.js';
export * from './manifest.js';
export * from './fetch-source.js';
export * from './put-asset.js';
