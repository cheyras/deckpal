/**
 * Cloud object-tier configuration. Read lazily from the environment so that
 * importing this package (for its pure path algebra, which apps/images does) can
 * never throw on a box that has no Supabase credentials.
 *
 * No new secrets: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are the ones the
 * deployment already sets. The service role is REQUIRED — Storage writes and the
 * manifest write both need it, and both are server-side only. It must never be
 * shipped to the browser.
 */
export interface StorageEnv {
  supabaseUrl: string;
  serviceKey: string;
  bucket: string;
}

/** Bucket holding the cached image tree. Overridable for forks; defaulted, never a secret. */
export const DEFAULT_BUCKET = 'card-art';

/** Immutable-asset cache header, mirroring the origin (max-age=31536000). */
export const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

/**
 * Short TTL for a failure answer (placeholder / 404). Long enough to shield the
 * origin from a hot loop, short enough that the asset self-heals on the next view
 * once upstream recovers or a backfill lands.
 */
export const FAILURE_CACHE_CONTROL = 'public, max-age=60';

export const USER_AGENT = 'deckpal-images/1.0 (+cheyras@gmail.com)';

let cached: StorageEnv | null = null;

export function storageEnv(): StorageEnv {
  if (cached) return cached;
  const supabaseUrl = (process.env.SUPABASE_URL ?? '').replace(/\/+$/, '');
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!supabaseUrl || !serviceKey) {
    throw new Error(
      '[storage] SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for the cloud image tier',
    );
  }
  cached = { supabaseUrl, serviceKey, bucket: process.env.CARD_ART_BUCKET ?? DEFAULT_BUCKET };
  return cached;
}

/** Is the cloud tier configured at all? Lets callers degrade instead of throwing. */
export function hasStorageEnv(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/** Test seam — forget memoised env (never used in production paths). */
export function resetStorageEnv(): void {
  cached = null;
}
