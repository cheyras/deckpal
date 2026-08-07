import { makePool } from '@pokedex/db';

type Pool = ReturnType<typeof makePool>;

/**
 * image_asset access (migration 006). METADATA ONLY — bytes live on the filesystem.
 *
 * Connection budget: the image service's DB usage is part of the API's 2-of-3
 * (ARCHITECTURE §6 / DATA-LAYER §6.5), so we cap this pool at 1. The read path
 * never blocks on it (last-access bumps are fire-and-forget); the warmer and
 * evictor use it synchronously but run alone.
 */
let pool: Pool | null = null;
export function getPool(): Pool {
  if (!pool) pool = makePool(1);
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

export interface ImageAssetRow {
  cache_key: string;
  kind: string;
  relative_path: string;
  content_type: string;
  byte_size: number;
  source_url: string | null;
  etag: string | null;
}

/** The `image_asset.kind` CHECK constraint (migration 006), as a type. */
export type ImageAssetKind =
  | 'card'
  | 'set-logo'
  | 'set-symbol'
  | 'set-background'
  | 'sprite'
  | 'avatar'
  | 'banner';

export interface UpsertInput {
  cacheKey: string;
  kind: ImageAssetKind;
  relativePath: string;
  contentType: string;
  byteSize: number;
  /**
   * The asset's original source URL, or NULL for honestly-unknown provenance.
   * NULL is a documented value, not a placeholder: it means "we could not
   * establish where these bytes came from" (see store.ts `Provenance`). Never
   * write a guessed URL here — `manifest:check` counts NULLs, and an invented URL
   * would hide a real gap behind a plausible lie.
   */
  sourceUrl: string | null;
  etag: string | null;
}

/**
 * Idempotent upsert keyed on cache_key. Re-warming an existing card updates size/
 * etag and refreshes last_access to today — never a duplicate row.
 *
 * Call this through `store.ts` (`putAsset` / `recordExistingAsset`) rather than
 * directly — those are the choke point that keeps bytes and metadata in step.
 * Writers that bypassed it are exactly how the cache drifted (DECISIONS 2026-08-07).
 */
export async function upsertImageAsset(input: UpsertInput): Promise<boolean> {
  const { rows } = await getPool().query<{ inserted: boolean }>(
    `INSERT INTO image_asset
       (cache_key, kind, relative_path, content_type, byte_size, source_url, etag,
        fetched_at, last_access_on, is_pinned)
     VALUES ($1,$2,$3,$4,$5,$6,$7, now(), CURRENT_DATE, false)
     ON CONFLICT (cache_key) DO UPDATE SET
       relative_path = EXCLUDED.relative_path,
       content_type  = EXCLUDED.content_type,
       byte_size     = EXCLUDED.byte_size,
       source_url    = EXCLUDED.source_url,
       etag          = EXCLUDED.etag,
       fetched_at    = now(),
       last_access_on= CURRENT_DATE
     RETURNING (xmax = 0) AS inserted`,
    [
      input.cacheKey,
      input.kind,
      input.relativePath,
      input.contentType,
      input.byteSize,
      input.sourceUrl,
      input.etag,
    ],
  );
  return rows[0]?.inserted ?? false;
}

/**
 * Insert a row if absent; if one already exists, refresh only the physical facts
 * (path/size/content-type) and LEAVE `source_url`/`etag`/`fetched_at` alone.
 *
 * Used by the "the file is already on disk" paths. A warmer that skipped a file
 * because it was already cached did not fetch it, so it has no standing to
 * restate where it came from — the row that recorded the actual fetch wins.
 * Returns true if a new row was inserted.
 */
export async function upsertPreservingProvenance(input: UpsertInput): Promise<boolean> {
  const { rows } = await getPool().query<{ inserted: boolean }>(
    `INSERT INTO image_asset
       (cache_key, kind, relative_path, content_type, byte_size, source_url, etag,
        fetched_at, last_access_on, is_pinned)
     VALUES ($1,$2,$3,$4,$5,$6,$7, now(), CURRENT_DATE, false)
     ON CONFLICT (cache_key) DO UPDATE SET
       relative_path  = EXCLUDED.relative_path,
       content_type   = EXCLUDED.content_type,
       byte_size      = EXCLUDED.byte_size,
       last_access_on = CURRENT_DATE
     RETURNING (xmax = 0) AS inserted`,
    [
      input.cacheKey,
      input.kind,
      input.relativePath,
      input.contentType,
      input.byteSize,
      input.sourceUrl,
      input.etag,
    ],
  );
  return rows[0]?.inserted ?? false;
}

// Resumability: which of these cache_keys are already recorded?
export async function existingCacheKeys(cacheKeys: string[]): Promise<Set<string>> {
  if (cacheKeys.length === 0) return new Set();
  const { rows } = await getPool().query<{ cache_key: string }>(
    `SELECT cache_key FROM image_asset WHERE cache_key = ANY($1::text[])`,
    [cacheKeys],
  );
  return new Set(rows.map((r) => r.cache_key));
}

export async function getStoredEtag(cacheKey: string): Promise<string | null> {
  const { rows } = await getPool().query<{ etag: string | null }>(
    `SELECT etag FROM image_asset WHERE cache_key = $1`,
    [cacheKey],
  );
  return rows[0]?.etag ?? null;
}

// Best-effort, non-blocking recency bump for LRU. DATE granularity ⇒ ≤1 write/day
// per asset. Swallows errors so a DB hiccup never affects serving.
export function touchLastAccess(cacheKey: string): void {
  getPool()
    .query(
      `UPDATE image_asset SET last_access_on = CURRENT_DATE
        WHERE cache_key = $1 AND last_access_on <> CURRENT_DATE`,
      [cacheKey],
    )
    .catch(() => {
      /* read path must not depend on the DB */
    });
}

export interface CacheStats {
  totalBytes: number;
  highBytes: number;
  lowBytes: number;
  fileCount: number;
}

export async function cacheStats(): Promise<CacheStats> {
  const { rows } = await getPool().query<{
    total: string | null;
    high: string | null;
    low: string | null;
    n: string;
  }>(
    `SELECT COALESCE(SUM(byte_size),0) AS total,
            COALESCE(SUM(byte_size) FILTER (WHERE cache_key LIKE '%:high'),0) AS high,
            COALESCE(SUM(byte_size) FILTER (WHERE cache_key LIKE '%:low'),0)  AS low,
            COUNT(*) AS n
       FROM image_asset`,
  );
  const r = rows[0]!;
  return {
    totalBytes: Number(r.total),
    highBytes: Number(r.high),
    lowBytes: Number(r.low),
    fileCount: Number(r.n),
  };
}

// LRU candidates for eviction — `high` only, never `low` (DATA-LAYER §5.3),
// coldest first, unpinned only.
export async function evictionCandidates(): Promise<ImageAssetRow[]> {
  const { rows } = await getPool().query<ImageAssetRow>(
    `SELECT cache_key, kind, relative_path, content_type, byte_size, source_url, etag
       FROM image_asset
      WHERE cache_key LIKE '%:high' AND NOT is_pinned
      ORDER BY last_access_on ASC, fetched_at ASC`,
  );
  return rows;
}

export async function deleteAsset(cacheKey: string): Promise<void> {
  await getPool().query(`DELETE FROM image_asset WHERE cache_key = $1`, [cacheKey]);
}

// Set imagery work-list for the set warmer: every set with a logo and/or symbol
// base URL. NULLs are genuinely absent upstream (DATA-LAYER §3.4) and are skipped —
// we never fabricate. Ordered for stable, resumable runs.
export interface SetImageRow {
  set_id: string;
  logo_url: string | null;
  symbol_url: string | null;
}
export async function listSetImageSources(): Promise<SetImageRow[]> {
  const { rows } = await getPool().query<SetImageRow>(
    `SELECT tcgdex_id AS set_id, logo_url, symbol_url
       FROM card_set
      WHERE logo_url IS NOT NULL OR symbol_url IS NOT NULL
      ORDER BY tcgdex_id`,
  );
  return rows;
}
