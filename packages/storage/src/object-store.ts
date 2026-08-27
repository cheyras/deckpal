import { storageEnv } from './config.js';
import { assertSafeObjectPath, storageUrl } from './object-path.js';

/**
 * Supabase Storage access over its REST API — no SDK, no extra dependency, and
 * nothing that opens a socket at import time (this runs in a serverless function
 * whose cold start we pay for on every unwarmed asset).
 *
 * The bucket is PUBLIC, so reads are served straight off Supabase's CDN and the
 * function only ever answers a 302 pointing at it. Writes carry the service role.
 *
 * THE OBJECT KEY IS CHECKED HERE, in every exported function that takes one.
 * The host is `process.env.SUPABASE_URL` and is never attacker-controlled, so the
 * exposure was path injection into a fixed host rather than host redirection —
 * but the key's allow-list lived in `parseImagePath`, i.e. in the CALLER, and the
 * bulk paths (`storage:backfill`, `rekey:set`, the warmers) reach these functions
 * with `relative_path` values read back out of Postgres without passing through
 * it. `assertSafeObjectPath` makes that an invariant of the function instead of a
 * convention of its call sites. See `object-path.ts` for the full reasoning and
 * for why `encodeURI` was never the boundary it looks like.
 */

export function publicObjectUrl(objectPath: string): string {
  assertSafeObjectPath(objectPath, 'publicObjectUrl');
  const { supabaseUrl, bucket } = storageEnv();
  // Each segment is validated above ([A-Za-z0-9.-] only), so encodeURI is
  // belt-and-braces, not the security boundary — it escapes neither '/' nor '%'.
  return storageUrl(supabaseUrl, `storage/v1/object/public/${bucket}/${encodeURI(objectPath)}`).href;
}

function authHeaders(): Record<string, string> {
  const { serviceKey } = storageEnv();
  return { apikey: serviceKey, authorization: `Bearer ${serviceKey}` };
}

/**
 * Does the object exist?
 *
 * HEAD against the PUBLIC endpoint: unauthenticated, CDN-accelerated, and
 * measured against this project — a missing object answers 400 (a JSON error),
 * an existing one 200. Verified 2026-08-09 that a miss is NOT negatively cached:
 * a GET immediately after an upload returns the bytes (cf-cache-status MISS then
 * HIT), so a cold fill is visible to the very next request.
 */
export async function objectExists(objectPath: string, timeoutMs = 5_000): Promise<boolean> {
  // OUTSIDE the try, deliberately: an unsafe key is a bug, not a cache miss, and
  // must not be swallowed into `false` by the catch below.
  assertSafeObjectPath(objectPath, 'objectExists');
  try {
    const res = await fetch(publicObjectUrl(objectPath), {
      method: 'HEAD',
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.status === 200;
  } catch {
    return false; // treat an unreachable check as a miss; the fill path is idempotent
  }
}

/**
 * The object's stored facts, or null if it is not there.
 *
 * A superset of `objectExists` for callers that will need the metadata anyway —
 * a bulk mirror asking "is this already uploaded?" gets the answer AND the
 * size/type/etag it would otherwise have to fetch in a second round trip.
 *
 * NOTE: `cache-control` is deliberately not read here. Supabase's public endpoint
 * answers HEAD with `cache-control: no-cache` regardless of what the object
 * stores — verified 2026-08-10, same object, same second: HEAD says `no-cache`,
 * GET says `public, max-age=31536000` and Cloudflare caches it (MISS then HIT).
 * Reading it from a HEAD would record a header the object does not actually
 * serve. Use `listObjectsRecursive` when you need the stored value.
 */
export async function headObject(
  objectPath: string,
  timeoutMs = 5_000,
): Promise<StoredObject | null> {
  assertSafeObjectPath(objectPath, 'headObject'); // outside the try — see objectExists
  try {
    const res = await fetch(publicObjectUrl(objectPath), {
      method: 'HEAD',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status !== 200) return null;
    const len = Number(res.headers.get('content-length') ?? 0);
    if (!Number.isFinite(len) || len <= 0) return null;
    return {
      path: objectPath,
      byteSize: len,
      contentType: (res.headers.get('content-type') ?? 'application/octet-stream').split(';')[0]!.trim(),
      etag: normaliseEtag(res.headers.get('etag')),
      cacheControl: null,
    };
  } catch {
    return null;
  }
}

export interface UploadResult {
  ok: boolean;
  status: number;
  error?: string;
  /**
   * The entity tag Storage assigned to the stored object — an MD5 hex of the
   * bytes, quotes stripped. It is the OBJECT tier's own validator, not upstream's
   * (that one is provenance and lives on `image_asset.etag`), and it is recorded
   * as `image_object.etag`. Verified 2026-08-10 against 1,854 backfilled objects:
   * it equals the MD5 of the local source file every time, which makes it a free
   * content check rather than an opaque token. Null when the response omitted it.
   */
  etag?: string | null;
}

/** Strip the quoting (and any weak-validator prefix) from an HTTP ETag header. */
function normaliseEtag(raw: string | null): string | null {
  if (!raw) return null;
  const t = raw.trim().replace(/^W\//, '').replace(/^"|"$/g, '');
  return t.length > 0 ? t : null;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * The one retry ladder `uploadObject` and `moveObject` share: exponential
 * backoff with jitter, retrying only 429/5xx and network errors — see
 * `uploadObject`'s header for why, and for the deliberately small default
 * budget. `attemptOnce` runs the request; `onSuccess` shapes the result for a
 * 2xx (only the upload has an etag to record).
 */
async function withRetries(
  maxAttempts: number,
  attemptOnce: () => Promise<Response>,
  onSuccess: (res: Response) => UploadResult,
): Promise<UploadResult> {
  let last: UploadResult = { ok: false, status: 0, error: 'no attempt made' };

  for (let attempt = 0; attempt < Math.max(1, maxAttempts); attempt++) {
    if (attempt > 0) await sleep(400 * 2 ** (attempt - 1) + Math.floor(Math.random() * 200));
    try {
      const res = await attemptOnce();
      if (res.ok) return onSuccess(res);
      const body = await res.text().catch(() => '');
      last = { ok: false, status: res.status, error: body.slice(0, 200) };
      if (res.status !== 429 && res.status < 500) return last; // a real rejection
    } catch (err) {
      // Network error / timeout — worth another try, same as a 5xx.
      last = { ok: false, status: 0, error: (err as Error).message };
    }
  }
  return last;
}

/**
 * Upload bytes, overwriting any existing object (`x-upsert`).
 *
 * Idempotent by construction, which is the whole concurrency story: two requests
 * racing on the same cold asset fetch the same URL and write byte-identical
 * content, so last-writer-wins is indistinguishable from first-writer-wins. No
 * lock, no partial object (Supabase publishes an upload atomically).
 *
 * RETRIES on 429 and 5xx, with exponential backoff and jitter. Supabase Storage
 * answers `429 too_many_connections` well below what a bulk mirror will offer it
 * — measured 2026-08-10, six parallel uploads was already too many — and without
 * this a throttled asset is simply lost from the run. Only throttles and server
 * errors are retried: a 4xx that is genuinely about the request will say the same
 * thing however many times you ask.
 *
 * The default budget is deliberately small (4 attempts, ~2.8 s worst case) because
 * this same function runs inside the serverless image fill, where a long retry
 * ladder would turn a slow asset into a function timeout. Bulk callers that can
 * afford to wait raise `maxAttempts`.
 */
export async function uploadObject(
  objectPath: string,
  bytes: Uint8Array,
  contentType: string,
  cacheControl = 'max-age=31536000',
  timeoutMs = 20_000,
  maxAttempts = 4,
): Promise<UploadResult> {
  assertSafeObjectPath(objectPath, 'uploadObject');
  const { supabaseUrl, bucket } = storageEnv();
  const url = storageUrl(supabaseUrl, `storage/v1/object/${bucket}/${encodeURI(objectPath)}`).href;
  return withRetries(
    maxAttempts,
    () =>
      fetch(url, {
        method: 'POST',
        headers: {
          ...authHeaders(),
          'content-type': contentType,
          'cache-control': cacheControl,
          'x-upsert': 'true',
        },
        body: bytes as unknown as BodyInit,
        signal: AbortSignal.timeout(timeoutMs),
      }),
    (res) => ({ ok: true, status: res.status, etag: normaliseEtag(res.headers.get('etag')) }),
  );
}

// ── Inventory ────────────────────────────────────────────────────────────────
/**
 * What Storage says about one stored object. These are the OBJECT tier's facts —
 * the numbers `image_object` records for `tier='object'`.
 */
export interface StoredObject {
  /** Full object key, i.e. `image_asset.relative_path`. */
  path: string;
  byteSize: number;
  contentType: string;
  etag: string | null;
  cacheControl: string | null;
}

interface ListEntry {
  name: string;
  id: string | null;
  metadata: {
    size?: number;
    mimetype?: string;
    eTag?: string;
    cacheControl?: string;
  } | null;
}

const LIST_PAGE = 1000;

/**
 * List ONE level of the bucket under `prefix`.
 *
 * Supabase's list endpoint is directory-shaped: real objects come back with an
 * `id` and a `metadata` blob, while sub-directories come back as synthetic
 * entries with both null. `listObjectsRecursive` uses that distinction to walk.
 */
async function listObjectLevel(
  prefix: string,
  timeoutMs: number,
): Promise<{ objects: StoredObject[]; folders: string[] }> {
  const { supabaseUrl, bucket, serviceKey } = storageEnv();
  const objects: StoredObject[] = [];
  const folders: string[] = [];

  for (let offset = 0; ; offset += LIST_PAGE) {
    const res = await fetch(storageUrl(supabaseUrl, `storage/v1/object/list/${bucket}`).href, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        authorization: `Bearer ${serviceKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        prefix,
        limit: LIST_PAGE,
        offset,
        sortBy: { column: 'name', order: 'asc' },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      throw new Error(`[storage] list failed for '${prefix}': HTTP ${res.status}`);
    }
    const page = (await res.json()) as ListEntry[];
    for (const e of page) {
      const full = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.id === null || e.metadata === null) {
        folders.push(full);
        continue;
      }
      objects.push({
        path: full,
        byteSize: Number(e.metadata.size ?? 0),
        contentType: e.metadata.mimetype ?? 'application/octet-stream',
        etag: normaliseEtag(e.metadata.eTag ?? null),
        cacheControl: e.metadata.cacheControl ?? null,
      });
    }
    if (page.length < LIST_PAGE) break;
  }
  return { objects, folders };
}

/**
 * Every object under `prefix`, depth-first.
 *
 * This is the object tier's answer to "walk the cache directory" — the thing
 * apps/images does with readdir. It is the only complete source for what is
 * ACTUALLY in the bucket, which is what `manifest:check --object-store` needs in
 * order to be a real tripwire rather than a self-report from the manifest.
 *
 * `onBatch` is called per directory so a caller can stream progress on a bucket
 * with tens of thousands of objects instead of buffering it all.
 */
export async function listObjectsRecursive(
  prefix = '',
  onBatch?: (objects: StoredObject[], dir: string) => void | Promise<void>,
  timeoutMs = 20_000,
): Promise<StoredObject[]> {
  const all: StoredObject[] = [];
  const queue = [prefix];
  while (queue.length > 0) {
    const dir = queue.shift()!;
    const { objects, folders } = await listObjectLevel(dir, timeoutMs);
    if (objects.length > 0) {
      all.push(...objects);
      if (onBatch) await onBatch(objects, dir);
    }
    queue.push(...folders);
  }
  return all;
}

/**
 * Re-address an object that is already in the bucket — a server-side RENAME.
 *
 * This is not a write of new bytes and it is deliberately not a `put`: the bytes
 * are already correct and already attributed, only their *address* is stale. The
 * case that produced it is an upstream set-id re-key (TCGdex went `swsh9.5tg` →
 * `swsh9tg` in 2026-08 without renaming the set), which moves every derived path
 * under B6 while changing nothing about the images themselves.
 *
 * Rename rather than copy-then-delete, for three reasons:
 *   1. the bytes never leave Supabase — no 240-object download/re-upload, no
 *      transient double storage, and no chance of a re-encode sneaking in;
 *   2. the stored object keeps its size, content type and MD5 etag, so the
 *      `image_object(tier='object')` row that measured it stays true and does not
 *      have to be re-measured;
 *   3. one operation has one failure mode. Copy-then-delete can leave BOTH keys
 *      populated, which reads as an unrecorded object to
 *      `manifest:check --object-store` and needs a human to tell the live copy
 *      from the leftover.
 *
 * `/object/move` is Supabase Storage's own endpoint and does the rename inside
 * the storage backend. If a deployment's Storage version lacks it the caller
 * gets `ok: false` with the status, and can fall back to copy + delete
 * explicitly rather than having a silent second write path here.
 *
 * RETRIES on 429/5xx with the same backoff as `uploadObject`, for the same
 * reason: Supabase throttles a bulk caller well below what it will offer.
 */
export async function moveObject(
  sourceKey: string,
  destinationKey: string,
  timeoutMs = 20_000,
  maxAttempts = 4,
): Promise<UploadResult> {
  // BOTH keys: a move is two addresses, and only checking one of them checks nothing.
  assertSafeObjectPath(sourceKey, 'moveObject(source)');
  assertSafeObjectPath(destinationKey, 'moveObject(destination)');
  const { supabaseUrl, bucket } = storageEnv();
  return withRetries(
    maxAttempts,
    () =>
      fetch(storageUrl(supabaseUrl, 'storage/v1/object/move').href, {
        method: 'POST',
        headers: { ...authHeaders(), 'content-type': 'application/json' },
        body: JSON.stringify({
          bucketId: bucket,
          sourceKey,
          destinationKey,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      }),
    (res) => ({ ok: true, status: res.status }),
  );
}

/** Remove an object. Used only to roll back a torn write. */
export async function deleteObject(objectPath: string, timeoutMs = 10_000): Promise<boolean> {
  assertSafeObjectPath(objectPath, 'deleteObject');
  const { supabaseUrl, bucket } = storageEnv();
  try {
    // Composed into a local first, exactly as `uploadObject` does. Same
    // construct either way, but the two shapes did not read the same to CodeQL:
    // the assigned form cleared and the inline one raised a fresh alert (#64).
    // Consistency here is cheaper than arguing with the analyser.
    const url = storageUrl(supabaseUrl, `storage/v1/object/${bucket}/${encodeURI(objectPath)}`).href;
    const res = await fetch(url, {
      method: 'DELETE',
      headers: authHeaders(),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok;
  } catch {
    return false;
  }
}
