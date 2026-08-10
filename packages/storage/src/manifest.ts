import { storageEnv } from './config.js';

/**
 * `image_asset` access for the cloud tier, over PostgREST.
 *
 * Why not `pg` like every other server module: this runs in a serverless function
 * that may cold-start on any request. A pooled TCP connection per instance would
 * spend the cluster's connection budget (ARCHITECTURE §6) on a path that touches
 * the DB at most ONCE per asset, ever. PostgREST is stateless HTTP against the
 * same table with the same service role — no sockets to keep, nothing to leak.
 *
 * The table is the same manifest the disk tier writes (apps/images store.ts): one
 * row per `cache_key`, and `relative_path` doubles as the Storage object key. So a
 * later bulk backfill of the on-disk tree lands on exactly these rows.
 */

export interface ManifestRow {
  cache_key: string;
  kind: string;
  relative_path: string;
  content_type: string;
  byte_size: number;
  source_url: string | null;
  etag: string | null;
}

export type ImageAssetKind =
  | 'card'
  | 'set-logo'
  | 'set-symbol'
  | 'set-background'
  | 'sprite'
  | 'avatar'
  | 'banner';

function restHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const { serviceKey } = storageEnv();
  return { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, ...extra };
}

function restUrl(path: string): string {
  return `${storageEnv().supabaseUrl}/rest/v1/${path}`;
}

/** The manifest row for a cache key, or null when the asset was never recorded. */
export async function getManifestRow(
  cacheKey: string,
  timeoutMs = 8_000,
): Promise<ManifestRow | null> {
  const url = restUrl(
    `image_asset?cache_key=eq.${encodeURIComponent(cacheKey)}` +
      `&select=cache_key,kind,relative_path,content_type,byte_size,source_url,etag&limit=1`,
  );
  const res = await fetch(url, {
    headers: restHeaders({ accept: 'application/json' }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`[manifest] read failed: HTTP ${res.status}`);
  const rows = (await res.json()) as ManifestRow[];
  return rows[0] ?? null;
}

export interface InsertManifestInput {
  cacheKey: string;
  kind: ImageAssetKind;
  relativePath: string;
  contentType: string;
  byteSize: number;
  sourceUrl: string | null;
  etag: string | null;
}

/**
 * Insert a manifest row, or report that one already exists.
 *
 * Idempotent under concurrency: `cache_key` is the primary key and
 * `relative_path` is UNIQUE, so a racing writer gets 409 and we treat that as
 * 'exists' — the row that won says the same thing ours would have.
 */
export async function insertManifestRow(
  input: InsertManifestInput,
  timeoutMs = 8_000,
): Promise<'inserted' | 'exists'> {
  const res = await fetch(restUrl('image_asset'), {
    method: 'POST',
    headers: restHeaders({ 'content-type': 'application/json', prefer: 'return=minimal' }),
    body: JSON.stringify({
      cache_key: input.cacheKey,
      kind: input.kind,
      relative_path: input.relativePath,
      content_type: input.contentType,
      byte_size: input.byteSize,
      source_url: input.sourceUrl,
      etag: input.etag,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (res.status === 409) return 'exists'; // duplicate cache_key / relative_path
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`[manifest] insert failed: HTTP ${res.status} ${body.slice(0, 200)}`);
  }
  return 'inserted';
}

/** Roll back a row this process inserted (only ever called on a torn write). */
export async function deleteManifestRow(cacheKey: string, timeoutMs = 8_000): Promise<void> {
  await fetch(restUrl(`image_asset?cache_key=eq.${encodeURIComponent(cacheKey)}`), {
    method: 'DELETE',
    headers: restHeaders({ prefer: 'return=minimal' }),
    signal: AbortSignal.timeout(timeoutMs),
  });
}

// ── Per-tier physical metadata (migration 025) ───────────────────────────────
/**
 * `image_asset` says what an asset IS and where it came from. `image_object`
 * says what one TIER actually stored — because the two copies are not always the
 * same bytes.
 *
 * They diverge for an ordinary reason: TCGdex re-encodes. The Pi's disk copy of
 * `card:sv03.5-102:low` is the 14,906 bytes upstream served when it was warmed;
 * the object in the bucket is the 17,954 bytes upstream serves today. Before
 * this table one row had to answer for both and silently described whichever
 * writer touched it last.
 *
 * The object tier writes `tier='object'`; apps/images writes `tier='disk'` over
 * `pg`. Neither ever writes the other's row.
 */
export type ImageObjectTier = 'disk' | 'object';

export interface ImageObjectInput {
  cacheKey: string;
  tier: ImageObjectTier;
  byteSize: number;
  contentType: string;
  /** Storage's validator for the stored bytes (MD5 hex), or null if none. */
  etag: string | null;
}

/**
 * Record what this tier stored, replacing any previous record for the SAME tier.
 *
 * Upsert rather than insert-or-ignore: unlike the provenance row, a re-write is
 * new truth. If the object is overwritten with re-encoded bytes, the object
 * tier's size and etag genuinely changed and the row must follow. `on_conflict`
 * names the composite PK so the merge targets (cache_key, tier), never just one.
 */
export async function upsertImageObjectRow(
  input: ImageObjectInput,
  timeoutMs = 8_000,
): Promise<void> {
  const res = await fetch(restUrl('image_object?on_conflict=cache_key,tier'), {
    method: 'POST',
    headers: restHeaders({
      'content-type': 'application/json',
      prefer: 'resolution=merge-duplicates,return=minimal',
    }),
    body: JSON.stringify({
      cache_key: input.cacheKey,
      tier: input.tier,
      byte_size: input.byteSize,
      content_type: input.contentType,
      etag: input.etag,
      stored_at: new Date().toISOString(),
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`[manifest] image_object upsert failed: HTTP ${res.status} ${body.slice(0, 200)}`);
  }
}

/**
 * Fill in provenance for a row that has NONE — and only such a row.
 *
 * `source_url IS NULL` is a documented value meaning "we could not establish
 * where these bytes came from" (apps/images store.ts). When the cloud tier
 * successfully fetches the asset from its canonical upstream URL it has actually
 * established that, so writing it is an improvement, not a guess. The
 * `source_url=is.null` filter is what keeps it honest: a row that already carries
 * provenance is never overwritten by a tier that merely re-fetched.
 *
 * Best-effort — a failure here must never fail an image request.
 */
export async function recordProvenanceIfUnknown(
  cacheKey: string,
  sourceUrl: string,
  etag: string | null,
  timeoutMs = 8_000,
): Promise<void> {
  try {
    await fetch(
      restUrl(`image_asset?cache_key=eq.${encodeURIComponent(cacheKey)}&source_url=is.null`),
      {
        method: 'PATCH',
        headers: restHeaders({ 'content-type': 'application/json', prefer: 'return=minimal' }),
        body: JSON.stringify({ source_url: sourceUrl, etag }),
        signal: AbortSignal.timeout(timeoutMs),
      },
    );
  } catch {
    /* provenance enrichment is opportunistic */
  }
}
