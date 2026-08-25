import { mkdir, open, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { sniffContentType, type Provenance } from '@deckpal/storage';
import { absoluteFromRelative } from './layout.js';
import {
  deleteAsset,
  upsertImageAsset,
  upsertImageObject,
  upsertPreservingProvenance,
  type ImageAssetKind,
} from './assets.js';

/**
 * store.ts — THE CHOKE POINT for the image cache.
 *
 * Every byte that lands under IMAGE_CACHE_ROOT must go through `putAsset` (new
 * bytes) or `recordExistingAsset` (bytes already on disk). Both write the file
 * and the `image_asset` manifest row together, so a byte can never land
 * unrecorded. Bytes on disk with no manifest row are a DEFECT — see
 * `manifest:check`, which fails on exactly that drift.
 *
 * Why this exists: as of 2026-08-07 the cache held 47,924 files but only 45,954
 * manifest rows. The 1,970 orphans came from ad-hoc gap-fill scripts that wrote
 * straight to the cache path and never touched the DB, so we lost the record of
 * where those images came from. Chey: "yes, please fix and make sure we're
 * always documenting original source when we add images to the cache going
 * forward." (DECISIONS.md 2026-08-07.)
 *
 * The contract, in three rules:
 *   1. PROVENANCE IS REQUIRED. You cannot call these helpers without saying where
 *      the bytes came from. There is no default and no optional argument.
 *   2. CONTENT TYPE IS SNIFFED, NOT ASSUMED. The recorded `content_type` comes
 *      from the file's magic bytes, never from its extension — a `.webp` name is
 *      not evidence of WebP bytes (30 cached "webp" files are actually PNG).
 *   3. SERVING NEVER DEPENDS ON THIS. apps/images serves from disk; a missing row
 *      degrades metadata (LRU, stats, provenance), never a page. Do not add a
 *      manifest lookup to the read path.
 *
 * Since migration 025 every write here records TWO rows, in one place, together:
 * the `image_asset` row (identity + provenance, shared by both image tiers) and
 * an `image_object` row for `tier='disk'` (what this machine's filesystem
 * actually holds). They are separate because the disk copy and the cloud
 * object are not always the same bytes — upstream re-encodes between the day a
 * file is warmed and the day the cloud tier fetches it — and one row cannot
 * honestly answer "how big is this asset" for both. This app never writes the
 * `object` tier; that belongs to packages/storage.
 */

// ── Provenance ───────────────────────────────────────────────────────────────
// Where the bytes came from. The discriminated union and its constructors are
// defined ONCE in @deckpal/storage (put-asset.ts, the cloud tier's twin choke
// point) and re-exported here, so both tiers force the same conscious,
// documented choice — read the definition there before picking
// `unknownProvenance`. Only `provenanceColumns` stays local: its error
// messages name this tier's `[store]` prefix.
export { fromUrl, unknownProvenance, type Provenance } from '@deckpal/storage';

function provenanceColumns(p: Provenance): { sourceUrl: string | null; etag: string | null } {
  if (p.origin === 'url') {
    if (!p.url || !/^[a-z][a-z0-9+.-]*:/i.test(p.url)) {
      throw new Error(
        `[store] provenance origin='url' needs an absolute URL, got ${JSON.stringify(p.url)}. ` +
          `If you don't know the source, use unknownProvenance('<why>') — do not invent one.`,
      );
    }
    return { sourceUrl: p.url, etag: p.etag ?? null };
  }
  if (!p.reason || !p.reason.trim()) {
    throw new Error(
      `[store] provenance origin='unknown' requires a non-empty reason explaining why the ` +
        `source could not be established.`,
    );
  }
  return { sourceUrl: null, etag: null };
}

// ── Content-type sniffing ────────────────────────────────────────────────────
// Truthful content type from magic bytes — defined in @deckpal/storage and
// re-exported here (every call site in this app imports it from './store.js').
// Shared with the cloud tier so both record the same truth about the same bytes.
export { isWebp, sniffContentType } from '@deckpal/storage';

// ── The choke point ──────────────────────────────────────────────────────────
export interface PutAssetInput {
  /** `image_asset.cache_key` — build it with layout.ts, never by hand. */
  cacheKey: string;
  kind: ImageAssetKind;
  /** Path under IMAGE_CACHE_ROOT — build it with layout.ts. */
  relativePath: string;
  bytes: Buffer;
  /** REQUIRED. Where these bytes came from. See `Provenance`. */
  provenance: Provenance;
  /**
   * Override the sniffed content type. Only pass this when you know better than
   * the magic bytes (you almost never do); the sniffed value is used otherwise.
   */
  contentType?: string;
}

export interface PutAssetResult {
  relativePath: string;
  byteSize: number;
  contentType: string;
  sourceUrl: string | null;
}

/**
 * Write new bytes into the cache AND record them, or do neither.
 *
 * Order matters: we stage the bytes to a temp file, record the row, and only then
 * publish the file with an atomic rename. So the failure modes are
 *   - metadata write fails → temp removed, nothing published, no row;
 *   - publish fails        → temp removed, and the row is rolled back ONLY if this
 *     call created it. A pre-existing row (a re-warm) is left alone: dropping it
 *     would silently destroy a good record, whereas leaving it makes
 *     `manifest:check` report a visible missing-file row. Visible drift beats
 *     silent loss.
 * Bytes are never visible to the serving path without a row behind them.
 */
export async function putAsset(input: PutAssetInput): Promise<PutAssetResult> {
  const { cacheKey, kind, relativePath, bytes, provenance } = input;
  if (!bytes || bytes.length === 0) {
    throw new Error(`[store] refusing to cache 0 bytes for ${cacheKey} (${relativePath})`);
  }
  const { sourceUrl, etag } = provenanceColumns(provenance);
  const contentType = input.contentType ?? sniffContentType(bytes);

  const abs = absoluteFromRelative(relativePath);
  const tmp = `${abs}.tmp`;
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(tmp, bytes);

  let insertedByUs = false;
  try {
    insertedByUs = await upsertImageAsset({
      cacheKey,
      kind,
      relativePath,
      contentType,
      byteSize: bytes.length,
      sourceUrl,
      etag,
    });
    // The disk tier's own measurement of the copy about to be published. A
    // filesystem assigns no etag, so that column is honestly null.
    await upsertImageObject({
      cacheKey,
      tier: 'disk',
      byteSize: bytes.length,
      contentType,
      etag: null,
    });
    await rename(tmp, abs);
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => undefined);
    if (insertedByUs) await deleteAsset(cacheKey).catch(() => undefined);
    throw err;
  }

  return { relativePath, byteSize: bytes.length, contentType, sourceUrl };
}

export interface RecordExistingInput {
  cacheKey: string;
  kind: ImageAssetKind;
  relativePath: string;
  /** REQUIRED. Where the bytes on disk came from. See `Provenance`. */
  provenance: Provenance;
  /** Skip re-reading the file to sniff its type (pass only if you already know). */
  contentType?: string;
}

/**
 * Record bytes that are ALREADY on disk — the backfill path, and the warmers'
 * "file exists, self-heal the row" path. Reads the file to get a truthful size
 * and content type; throws if the file is missing or empty (`byte_size > 0` is a
 * schema CHECK, and a row pointing at nothing is its own kind of drift).
 */
export async function recordExistingAsset(input: RecordExistingInput): Promise<PutAssetResult> {
  const { cacheKey, kind, relativePath, provenance } = input;
  const { sourceUrl, etag } = provenanceColumns(provenance);
  const abs = absoluteFromRelative(relativePath);

  const st = await stat(abs);
  if (!st.isFile() || st.size === 0) {
    throw new Error(`[store] cannot record ${cacheKey}: ${relativePath} is missing or empty`);
  }

  const contentType = input.contentType ?? (await sniffFile(abs, st.size));

  await upsertImageAsset({
    cacheKey,
    kind,
    relativePath,
    contentType,
    byteSize: st.size,
    sourceUrl,
    etag,
  });
  await upsertImageObject({
    cacheKey,
    tier: 'disk',
    byteSize: st.size,
    contentType,
    etag: null,
  });

  return { relativePath, byteSize: st.size, contentType, sourceUrl };
}

/**
 * Ensure a row exists for bytes already on disk, WITHOUT restating provenance
 * that someone else established. If a row exists we refresh only path/size/
 * content-type; if it does not, `fallbackProvenance` is recorded.
 *
 * This is the warmers' "skipped — already cached" path and the rsync-restore
 * path. Pick `fallbackProvenance` honestly: the card/set warmers pass the
 * canonical upstream URL because their work-list IS the upstream manifest, so
 * that URL is attested for that asset, not guessed. A writer that cannot say
 * that much must pass `unknownProvenance(...)`.
 *
 * Returns `{ inserted: true }` when it created a new row.
 */
export async function ensureRecorded(
  input: Omit<RecordExistingInput, 'provenance'> & { fallbackProvenance: Provenance },
): Promise<PutAssetResult & { inserted: boolean }> {
  const { cacheKey, kind, relativePath, fallbackProvenance } = input;
  const { sourceUrl, etag } = provenanceColumns(fallbackProvenance);
  const abs = absoluteFromRelative(relativePath);

  const st = await stat(abs);
  if (!st.isFile() || st.size === 0) {
    throw new Error(`[store] cannot record ${cacheKey}: ${relativePath} is missing or empty`);
  }
  const contentType = input.contentType ?? (await sniffFile(abs, st.size));

  const inserted = await upsertPreservingProvenance({
    cacheKey,
    kind,
    relativePath,
    contentType,
    byteSize: st.size,
    sourceUrl,
    etag,
  });
  // The per-tier row IS refreshed even though provenance is not. Provenance is a
  // claim only the fetcher can make; size and content type are facts about the
  // file we just measured, and this caller measured it.
  await upsertImageObject({
    cacheKey,
    tier: 'disk',
    byteSize: st.size,
    contentType,
    etag: null,
  });

  return { relativePath, byteSize: st.size, contentType, sourceUrl, inserted };
}

/** Sniff a file's content type from its header without reading the whole file. */
export async function sniffFile(absPath: string, size?: number): Promise<string> {
  const fh = await open(absPath, 'r');
  try {
    const n = Math.min(32, size ?? 32);
    const head = Buffer.alloc(n);
    await fh.read(head, 0, n, 0);
    return sniffContentType(head);
  } finally {
    await fh.close();
  }
}
