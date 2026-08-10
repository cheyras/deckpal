import {
  deleteManifestRow,
  insertManifestRow,
  type ImageAssetKind,
} from './manifest.js';
import { deleteObject, uploadObject } from './object-store.js';
import { sniffContentType } from './sniff.js';

/**
 * put-asset.ts — THE CHOKE POINT for the cloud image tier.
 *
 * It is the object-store twin of `apps/images/src/store.ts` (the disk tier's
 * choke point) and it keeps the same contract, for the same reason: as of
 * 2026-08-07 the disk cache held 47,924 files but only 45,954 manifest rows,
 * because ad-hoc scripts wrote bytes and never touched the DB — so we lost the
 * record of where those images came from. Chey: "yes, please fix and make sure
 * we're always documenting original source when we add images to the cache going
 * forward." (DECISIONS.md 2026-08-07.)
 *
 * The contract, in three rules:
 *   1. PROVENANCE IS REQUIRED. You cannot call this without saying where the bytes
 *      came from. There is no default and no optional argument. An invented URL is
 *      worse than an honest blank.
 *   2. CONTENT TYPE IS SNIFFED, NOT ASSUMED. The recorded `content_type` comes
 *      from the magic bytes, never from the `.webp` in the name.
 *   3. SERVING NEVER DEPENDS ON THIS. The read path answers a Storage HIT with a
 *      302 and no DB call at all; the manifest is provenance, not an index.
 *
 * Ordering mirrors store.ts (stage → record → publish):
 *   record the row, then upload. If the upload fails we remove the row ONLY if we
 *   inserted it — a pre-existing row (the disk tier's) is left alone, because
 *   dropping it would destroy a good record, whereas leaving it is at worst
 *   visible drift. Bytes are never published without a row behind them.
 */

// ── Provenance ───────────────────────────────────────────────────────────────
/**
 * Where the bytes came from. A discriminated union with no default, so the caller
 * has to make a conscious, documented choice.
 *
 *  - `{ origin: 'url' }`     — fetched from a real, resolvable URL. This is what
 *                              you want; `url` is persisted to `source_url`.
 *  - `{ origin: 'unknown' }` — provenance genuinely could not be established.
 *                              Persists `source_url = NULL`. `reason` is required.
 *
 * NEVER pick `unknown` to avoid looking up a URL, and NEVER pass a plausible-but-
 * unverified URL as `url` — pass only a URL a fetch actually succeeded against.
 */
export type Provenance =
  | { origin: 'url'; url: string; etag?: string | null }
  | { origin: 'unknown'; reason: string };

export const fromUrl = (url: string, etag: string | null = null): Provenance => ({
  origin: 'url',
  url,
  etag,
});
export const unknownProvenance = (reason: string): Provenance => ({ origin: 'unknown', reason });

function provenanceColumns(p: Provenance): { sourceUrl: string | null; etag: string | null } {
  if (p.origin === 'url') {
    if (!p.url || !/^[a-z][a-z0-9+.-]*:/i.test(p.url)) {
      throw new Error(
        `[storage] provenance origin='url' needs an absolute URL, got ${JSON.stringify(p.url)}. ` +
          `If you don't know the source, use unknownProvenance('<why>') — do not invent one.`,
      );
    }
    return { sourceUrl: p.url, etag: p.etag ?? null };
  }
  if (!p.reason || !p.reason.trim()) {
    throw new Error(
      `[storage] provenance origin='unknown' requires a non-empty reason explaining why the ` +
        `source could not be established.`,
    );
  }
  return { sourceUrl: null, etag: null };
}

export interface PutStorageAssetInput {
  /** `image_asset.cache_key` — build it with paths.ts, never by hand. */
  cacheKey: string;
  kind: ImageAssetKind;
  /** Object key in the bucket == the tier-shared relative path. Build it with paths.ts. */
  relativePath: string;
  bytes: Buffer;
  /** REQUIRED. Where these bytes came from. See `Provenance`. */
  provenance: Provenance;
  /** Override the sniffed content type. You almost never know better than the bytes. */
  contentType?: string;
}

export interface PutStorageAssetResult {
  relativePath: string;
  byteSize: number;
  contentType: string;
  sourceUrl: string | null;
  /** True when this call created the manifest row (vs. one already existing). */
  recorded: boolean;
}

export async function putStorageAsset(
  input: PutStorageAssetInput,
): Promise<PutStorageAssetResult> {
  const { cacheKey, kind, relativePath, bytes, provenance } = input;
  if (!bytes || bytes.length === 0) {
    throw new Error(`[storage] refusing to store 0 bytes for ${cacheKey} (${relativePath})`);
  }
  const { sourceUrl, etag } = provenanceColumns(provenance);
  const contentType = input.contentType ?? sniffContentType(bytes);

  // 1. Record. A row first means bytes can never become visible unrecorded.
  const outcome = await insertManifestRow({
    cacheKey,
    kind,
    relativePath,
    contentType,
    byteSize: bytes.length,
    sourceUrl,
    etag,
  });

  // 2. Publish.
  const upload = await uploadObject(relativePath, bytes, contentType);
  if (!upload.ok) {
    if (outcome === 'inserted') {
      await deleteManifestRow(cacheKey).catch(() => undefined);
      await deleteObject(relativePath).catch(() => undefined); // in case of a partial write
    }
    throw new Error(
      `[storage] upload failed for ${relativePath}: HTTP ${upload.status} ${upload.error ?? ''}`,
    );
  }

  return {
    relativePath,
    byteSize: bytes.length,
    contentType,
    sourceUrl,
    recorded: outcome === 'inserted',
  };
}

export interface PutUnmanifestedInput {
  objectPath: string;
  bytes: Buffer;
  /** REQUIRED, exactly as above. Still a URL a fetch actually succeeded against. */
  provenance: Provenance;
  /**
   * REQUIRED. Why this asset class is provenance-tracked at the TIER level rather
   * than per file. There is exactly one legitimate answer today (sprites: one
   * pinned upstream SHA covers the whole tree, and per-file rows would make the
   * self-host `manifest:check` report thousands of phantom missing files). If you
   * are reaching for this for anything else, you want `putStorageAsset`.
   */
  tierProvenanceReason: string;
  contentType?: string;
}

/**
 * The deliberate exception to "every byte gets a row".
 *
 * It is not a loophole: provenance is still required and still has to be a URL a
 * fetch succeeded against — it is just recorded once, for the whole class, in the
 * script that pins it, instead of once per file. See `SPRITES_SHA` in paths.ts
 * and `scripts/fetch-sprites.sh`. Everything else must go through
 * `putStorageAsset`.
 */
export async function putUnmanifestedObject(
  input: PutUnmanifestedInput,
): Promise<PutStorageAssetResult> {
  const { objectPath, bytes, provenance, tierProvenanceReason } = input;
  if (!bytes || bytes.length === 0) {
    throw new Error(`[storage] refusing to store 0 bytes for ${objectPath}`);
  }
  if (!tierProvenanceReason.trim()) {
    throw new Error(
      `[storage] putUnmanifestedObject requires tierProvenanceReason — say where this asset ` +
        `class's provenance IS recorded, or use putStorageAsset.`,
    );
  }
  const { sourceUrl } = provenanceColumns(provenance);
  const contentType = input.contentType ?? sniffContentType(bytes);

  const upload = await uploadObject(objectPath, bytes, contentType);
  if (!upload.ok) {
    throw new Error(
      `[storage] upload failed for ${objectPath}: HTTP ${upload.status} ${upload.error ?? ''}`,
    );
  }
  return { relativePath: objectPath, byteSize: bytes.length, contentType, sourceUrl, recorded: false };
}
