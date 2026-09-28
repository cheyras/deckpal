import { createHash } from 'node:crypto';
import { storageEnv } from './config.js';
import { assertSafeObjectPath, encodeObjectPath, storageUrl } from './object-path.js';
import { listObjectsRecursive, withRetries, type StoredObject, type UploadResult } from './object-store.js';
import type { Provenance } from './put-asset.js';
import { supabaseKeyHeaders } from './supabase-key-headers.mjs';

/**
 * capture-store.ts — the PRIVATE home of the scanner's and labeler's captures.
 *
 * ── WHAT LIVES HERE ────────────────────────────────────────────────────────
 *
 * Photographs of cards taken in the owner's house, and everything paired with
 * them: quad-labeler labels, the scan harness's "Flag frame" captures, the
 * product scanner's capture/lock/identity reports, their JSON sidecars and
 * comment sidecars (`dev-flags/`), and the labeler's pending photos
 * (`dev-queue/`).
 *
 * ── WHY IT IS NOT THE CARD-ART BUCKET ANY MORE (2026-09-28) ────────────────
 *
 * Until this date both prefixes lived in `card-art`, the PUBLIC bucket that
 * serves catalog art as a CDN. The routes in front of them were gated, but the
 * objects were not: a public bucket answers anyone who can name an object, and
 * these names are millisecond timestamps. So anyone patient enough to guess an
 * id could read a photo of the owner's table. The gate was protecting the
 * listing, not the bytes.
 *
 * Now they live in {@link CAPTURE_BUCKET}, a PRIVATE bucket. Every request below
 * carries the server's service key; nothing in this module can build a public
 * URL, and nothing in the browser needs one — the API's labeler-gated routes
 * stream the bytes (`apps/api/src/dev/scanFlags.ts`, `scanQueue.ts`).
 *
 * ── HOW THE BUCKET COMES TO EXIST ──────────────────────────────────────────
 *
 * {@link ensureCaptureBucket}: an idempotent create-if-missing through the
 * Storage API, run (once per warm process) before the first request that
 * touches the bucket. Not a migration, because nothing applies migrations on a
 * deploy here — `pnpm migrate` against production is a human step, and a
 * bucket the code depends on must not wait for one. Not a dashboard click, for
 * the same reason. If a bucket of this name already exists and is PUBLIC, the
 * ensure refuses to use it rather than quietly re-creating the leak.
 *
 * ── THE LEGACY COPIES ──────────────────────────────────────────────────────
 *
 * Objects written before the move are still in `card-art/dev-flags/` and
 * `card-art/dev-queue/`. {@link createCaptureStore} reads through to them (so
 * nothing disappears from the owner's view mid-move) and deletes them with
 * their private twin; `capture-migration.ts` moves them. The legacy handle can
 * READ, LIST and DELETE only, and only under the two capture prefixes: it
 * cannot write at all, and it cannot address a single byte of catalog art.
 *
 * ── B1 ─────────────────────────────────────────────────────────────────────
 *
 * Captures have no `image_asset` row, exactly as before: they are not catalog
 * art and their provenance is recorded for the class, not per file (the same
 * documented exception as sprites — see put-asset.ts `putUnmanifestedObject`).
 * {@link CaptureStore.put} still demands the provenance and the class-level
 * reason, so the obligation did not get lost in the move.
 */

/** The private bucket. A constant, not configuration: see the decision record. */
export const CAPTURE_BUCKET = 'dev-captures';

/** The only two top-level prefixes a capture lives under, in either bucket. */
export const CAPTURE_PREFIXES = ['dev-flags', 'dev-queue'] as const;
export type CapturePrefix = (typeof CAPTURE_PREFIXES)[number];

/**
 * Where the migration parks a public copy whose key is already taken in the
 * private bucket by DIFFERENT bytes. Private-bucket only; nothing lists it.
 */
export const CAPTURE_CONFLICT_PREFIX = 'legacy-conflicts';

/**
 * The header stored on every private capture, and therefore the one Storage
 * serves back. Belt and braces: nothing public ever serves these bytes, and
 * nothing in between should keep a copy either.
 */
export const CAPTURE_CACHE_CONTROL = 'private, no-store';

const DEFAULT_TIMEOUT_MS = 20_000;

/** Storage answers a missing object (or bucket) with 404, or with 400 and a
 *  JSON body saying 404 on older versions. Both mean "absent". */
const MISSING = new Set([400, 404]);

/** A failure talking to Storage — distinct from "the object is not there". */
export class CaptureStorageError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'CaptureStorageError';
    this.status = status;
  }
}

export interface CaptureObject {
  bytes: Buffer;
  contentType: string;
}

export type CaptureWriteMode = 'upsert' | 'create';

/**
 * One bucket, as the capture routes and the migration see it. Every method
 * distinguishes ABSENT (null / false / 'exists') from FAILED (throws), because
 * the migration's safety rests on never reading "Storage was down" as "there
 * is nothing here".
 */
export interface CaptureBucket {
  readonly name: string;
  list(prefix: CapturePrefix): Promise<StoredObject[]>;
  read(path: string): Promise<CaptureObject | null>;
  stat(path: string): Promise<{ byteSize: number } | null>;
  /** `create` never overwrites: an existing object answers 'exists'. */
  write(path: string, bytes: Buffer, contentType: string, mode: CaptureWriteMode): Promise<'written' | 'exists'>;
  /** true = removed, false = was not there. */
  remove(path: string): Promise<boolean>;
}

// ── Key guards ───────────────────────────────────────────────────────────────

function captureKeyProblem(path: string, allowConflicts: boolean): string | null {
  const [top, ...rest] = path.split('/');
  if (rest.length === 0) return 'has no prefix';
  if ((CAPTURE_PREFIXES as readonly string[]).includes(top!)) return null;
  if (allowConflicts && top === CAPTURE_CONFLICT_PREFIX) return null;
  return `is not under ${CAPTURE_PREFIXES.map((p) => `${p}/`).join(' or ')}`;
}

/**
 * Throw unless `path` is a safe object key under a capture prefix. This is what
 * stops the legacy handle — which holds the service key for the card-art
 * bucket — from ever reading or deleting a catalog image.
 */
export function assertCaptureKey(path: string, where: string, allowConflicts = false): void {
  assertSafeObjectPath(path, where);
  const problem = captureKeyProblem(path, allowConflicts);
  if (problem) throw new Error(`[storage] ${where}: refusing a key that ${problem}: ${JSON.stringify(path)}`);
}

/** Supabase answers a create-only upload onto an existing key with 409, or
 *  (older versions) 400 whose body says `"statusCode":"409"` / Duplicate. */
function isDuplicate(result: Pick<UploadResult, 'status' | 'error'>): boolean {
  if (result.status === 409) return true;
  if (result.status !== 400) return false;
  return /"statusCode"\s*:\s*"409"|duplicate|already exists/i.test(result.error ?? '');
}

// ── The bucket itself ────────────────────────────────────────────────────────

let ensuring: Promise<void> | null = null;

/**
 * Make sure the private capture bucket exists and IS private. Idempotent,
 * memoised per process, and retried on the next call if it fails.
 *
 * Safe under concurrency: two cold starts that both find it missing both try
 * to create it; the loser's "already exists" is success, and both then re-read
 * it and check `public === false` before anything is stored.
 */
export function ensureCaptureBucket(): Promise<void> {
  ensuring ??= establishPrivateBucket(CAPTURE_BUCKET).catch((error: unknown) => {
    ensuring = null;
    // Always a CaptureStorageError, so a caller that maps storage failures to a
    // retryable 502 maps this one too (a network error here is a TypeError).
    throw error instanceof CaptureStorageError
      ? error
      : new CaptureStorageError(`[storage] could not reach bucket ${CAPTURE_BUCKET}: ${(error as Error).message}`, 0);
  });
  return ensuring;
}

/** TEST SEAM: forget the memoised ensure. */
export function __resetCaptureBucketEnsure(): void {
  ensuring = null;
}

export async function establishPrivateBucket(bucket: string, timeoutMs = 10_000): Promise<void> {
  const { supabaseUrl, serviceKey } = storageEnv();
  const headers = supabaseKeyHeaders(serviceKey);
  const bucketUrl = storageUrl(supabaseUrl, `storage/v1/bucket/${encodeURIComponent(bucket)}`).href;

  const read = async (): Promise<{ public?: unknown } | null> => {
    const res = await fetch(bucketUrl, { headers, signal: AbortSignal.timeout(timeoutMs) });
    if (res.ok) return (await res.json()) as { public?: unknown };
    await res.body?.cancel().catch(() => {});
    if (MISSING.has(res.status)) return null;
    throw new CaptureStorageError(`[storage] could not read bucket ${bucket}: HTTP ${res.status}`, res.status);
  };

  const existing = await read();
  if (existing) return assertPrivateBucket(bucket, existing);

  const created = await fetch(storageUrl(supabaseUrl, 'storage/v1/bucket').href, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    // Nothing else: no size cap and no MIME allow-list, because either could
    // strand a legacy object mid-migration (older captures carry whatever
    // content type their writer declared). The routes enforce their own caps.
    body: JSON.stringify({ id: bucket, name: bucket, public: false }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!created.ok) {
    const body = await created.text().catch(() => '');
    // A concurrent cold start won the race between our read and our create.
    if (!isDuplicate({ status: created.status, error: body })) {
      throw new CaptureStorageError(
        `[storage] could not create private bucket ${bucket}: HTTP ${created.status} ${body.slice(0, 200)}`,
        created.status,
      );
    }
  }
  const after = await read();
  if (!after) throw new CaptureStorageError(`[storage] bucket ${bucket} is still missing after creating it`, 0);
  assertPrivateBucket(bucket, after);
}

function assertPrivateBucket(bucket: string, info: { public?: unknown }): void {
  if (info.public === false) return;
  // Refuse, do not repair. A same-named PUBLIC bucket was made by a person, and
  // storing private captures in it is the exact leak this module exists to end.
  throw new CaptureStorageError(
    `[storage] bucket ${bucket} exists but is not private (public=${JSON.stringify(info.public)}) — ` +
      'refusing to store captures in it. Make it private in Supabase Storage, or delete it and the API will recreate it private.',
    0,
  );
}

interface HttpCaptureBucketOptions {
  bucket: string;
  /** Runs before every request (the private bucket's ensure). */
  before?: () => Promise<void>;
  /** False for the legacy public bucket: captures are never written there again. */
  writable: boolean;
  /** Only the private bucket holds `legacy-conflicts/`. */
  allowConflicts: boolean;
  timeoutMs?: number;
}

/** A {@link CaptureBucket} over Supabase Storage's authenticated REST API. */
export function httpCaptureBucket(options: HttpCaptureBucketOptions): CaptureBucket {
  const { bucket, before, writable, allowConflicts } = options;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // The AUTHENTICATED object route, never `object/public/`. It works for a
  // private bucket (which is the point) and, on the legacy public one, it skips
  // the CDN, so a read is the stored bytes rather than an edge copy of them.
  const objectUrl = (path: string, op: string): string => {
    const where = `${bucket}.${op}`;
    assertCaptureKey(path, where, allowConflicts);
    const { supabaseUrl } = storageEnv();
    return storageUrl(
      supabaseUrl,
      `storage/v1/object/${encodeURIComponent(bucket)}/${encodeObjectPath(path, where)}`,
    ).href;
  };
  const auth = () => supabaseKeyHeaders(storageEnv().serviceKey);
  const failed = (op: string, path: string, detail: string, status: number) =>
    new CaptureStorageError(`[storage] ${bucket} ${op} failed for ${path}: ${detail}`, status);

  async function request(op: string, path: string, init: RequestInit): Promise<Response> {
    const url = objectUrl(path, op);
    await before?.();
    try {
      return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      throw failed(op, path, (error as Error).message, 0);
    }
  }

  /**
   * Is this non-2xx response "the object is not there"? A 404 is. A 400 is only
   * when its body says so (older Storage wraps a miss as 400 + `"statusCode":
   * "404"`) — the same status also carries auth and validation failures, and
   * reading one of those as "absent" is how a checker learns to lie.
   */
  async function absent(res: Response): Promise<boolean> {
    if (res.status === 404) {
      await res.body?.cancel().catch(() => {});
      return true;
    }
    if (res.status !== 400) return false;
    const body = await res.text().catch(() => '');
    return /"statusCode"\s*:\s*"404"|not[_ ]?found/i.test(body);
  }

  async function read(path: string): Promise<CaptureObject | null> {
    const res = await request('read', path, { headers: auth() });
    if (!res.ok) {
      if (await absent(res)) return null;
      await res.body?.cancel().catch(() => {});
      throw failed('read', path, `HTTP ${res.status}`, res.status);
    }
    const bytes = Buffer.from(await res.arrayBuffer());
    const contentType = (res.headers.get('content-type') ?? 'application/octet-stream').split(';')[0]!.trim();
    return { bytes, contentType };
  }

  return {
    name: bucket,

    async list(prefix) {
      if (!(CAPTURE_PREFIXES as readonly string[]).includes(prefix)) {
        throw new Error(`[storage] ${bucket}.list: ${JSON.stringify(prefix)} is not a capture prefix`);
      }
      await before?.();
      try {
        return await listObjectsRecursive(prefix, undefined, timeoutMs, bucket);
      } catch (error) {
        throw new CaptureStorageError(`[storage] ${bucket} list failed for ${prefix}: ${(error as Error).message}`, 0);
      }
    },

    read,

    async stat(path) {
      const res = await request('stat', path, { method: 'HEAD', headers: auth() });
      // A HEAD has no body to tell a 400-miss from a 400-refusal, so both
      // statuses read as absent here. Nothing destructive keys off `stat`:
      // the migration verifies with full reads.
      if (MISSING.has(res.status)) return null;
      if (!res.ok) throw failed('stat', path, `HTTP ${res.status}`, res.status);
      const length = Number(res.headers.get('content-length'));
      if (Number.isFinite(length) && length > 0) return { byteSize: length };
      // A HEAD that did not say how big: measure it rather than report 0.
      const object = await read(path);
      return object ? { byteSize: object.bytes.length } : null;
    },

    async write(path, bytes, contentType, mode) {
      if (!writable) {
        throw new Error(`[storage] refusing to write ${path} to ${bucket}: captures are never written to the public bucket`);
      }
      const url = objectUrl(path, 'write');
      await before?.();
      const result = await withRetries(
        4,
        () =>
          fetch(url, {
            method: 'POST',
            headers: {
              ...auth(),
              'content-type': contentType,
              'cache-control': CAPTURE_CACHE_CONTROL,
              'x-upsert': mode === 'upsert' ? 'true' : 'false',
            },
            body: bytes as unknown as BodyInit,
            signal: AbortSignal.timeout(timeoutMs),
          }),
        (res) => ({ ok: true, status: res.status }),
      );
      if (result.ok) return 'written';
      if (mode === 'create' && isDuplicate(result)) return 'exists';
      throw failed('write', path, `HTTP ${result.status} ${result.error ?? ''}`.trim(), result.status);
    },

    async remove(path) {
      const res = await request('remove', path, { method: 'DELETE', headers: auth() });
      if (res.ok) {
        await res.body?.cancel().catch(() => {});
        return true;
      }
      if (await absent(res)) return false;
      await res.body?.cancel().catch(() => {});
      throw failed('remove', path, `HTTP ${res.status}`, res.status);
    },
  };
}

// ── The store the routes use ─────────────────────────────────────────────────

export interface PutCaptureInput {
  objectPath: string;
  bytes: Buffer;
  contentType: string;
  /** REQUIRED, as for `putUnmanifestedObject`: captures have no upstream URL,
   *  so this is `unknownProvenance(reason)` in practice — but it is said. */
  provenance: Provenance;
  /** REQUIRED: where this class's provenance IS recorded, since no row is. */
  tierProvenanceReason: string;
}

/**
 * Captures, as the routes see them: private first, the legacy public copy as a
 * read-through until the migration has moved it.
 */
export interface CaptureStore {
  readonly primary: CaptureBucket;
  /** Null when there is nothing to fall back to (or it would be the same bucket). */
  readonly legacy: CaptureBucket | null;
  /** Everything under `prefix` in either bucket; the private copy wins a tie. */
  list(prefix: CapturePrefix): Promise<StoredObject[]>;
  read(path: string): Promise<CaptureObject | null>;
  stat(path: string): Promise<{ byteSize: number } | null>;
  exists(path: string): Promise<boolean>;
  /** Writes the PRIVATE bucket only. Overwrites (a comment re-POST is an edit). */
  put(input: PutCaptureInput): Promise<void>;
  /** Removes BOTH copies — a public straggler left behind would be migrated
   *  straight back. true if either existed. */
  remove(path: string): Promise<boolean>;
}

export function createCaptureStore(primary: CaptureBucket, legacy: CaptureBucket | null): CaptureStore {
  // If configuration ever pointed both handles at one bucket, "copy, then delete
  // the old one" would delete the only copy. Refuse to have a legacy at all.
  const fallback = legacy && legacy.name !== primary.name ? legacy : null;

  // A read that misses in private and then in legacy re-checks private once:
  // the migration may have moved the object between those two requests, and a
  // row must not 404 for the instant it is in flight.
  async function readThrough<T>(get: (bucket: CaptureBucket) => Promise<T | null>): Promise<T | null> {
    const own = await get(primary);
    if (own !== null || !fallback) return own;
    return (await get(fallback)) ?? (await get(primary));
  }

  return {
    primary,
    legacy: fallback,
    async list(prefix) {
      const [own, old] = await Promise.all([primary.list(prefix), fallback ? fallback.list(prefix) : []]);
      const byPath = new Map<string, StoredObject>(old.map((o) => [o.path, o]));
      for (const o of own) byPath.set(o.path, o);
      return [...byPath.values()];
    },
    read: (path) => readThrough((bucket) => bucket.read(path)),
    stat: (path) => readThrough((bucket) => bucket.stat(path)),
    async exists(path) {
      return (await readThrough((bucket) => bucket.stat(path))) !== null;
    },
    async put({ objectPath, bytes, contentType, provenance, tierProvenanceReason }) {
      if (!bytes || bytes.length === 0) throw new Error(`[storage] refusing to store 0 bytes for ${objectPath}`);
      if (!provenance || !tierProvenanceReason?.trim()) {
        throw new Error(`[storage] a capture needs its provenance and tierProvenanceReason (B1): ${objectPath}`);
      }
      await primary.write(objectPath, bytes, contentType, 'upsert');
    },
    async remove(path) {
      // The public copy first: it is the exposure.
      const fromLegacy = fallback ? await fallback.remove(path) : false;
      const fromPrimary = await primary.remove(path);
      return fromLegacy || fromPrimary;
    },
  };
}

/** The legacy handle: the card-art bucket, capture prefixes only, read/list/delete only. */
export function legacyCaptureBucket(): CaptureBucket | null {
  const { bucket } = storageEnv();
  if (bucket === CAPTURE_BUCKET) return null;
  return httpCaptureBucket({ bucket, writable: false, allowConflicts: false });
}

let store: CaptureStore | null = null;

/** The live store. Call only when `hasStorageEnv()` — it reads the credentials. */
export function captureStore(): CaptureStore {
  store ??= createCaptureStore(
    httpCaptureBucket({ bucket: CAPTURE_BUCKET, before: ensureCaptureBucket, writable: true, allowConflicts: true }),
    legacyCaptureBucket(),
  );
  return store;
}

// ── Small shared helpers ─────────────────────────────────────────────────────

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function md5Hex(bytes: Uint8Array): string {
  return createHash('md5').update(bytes).digest('hex');
}
