import { createHash } from 'node:crypto';
import { CaptureStorageError, unknownProvenance, type CaptureStore } from '@deckpal/storage';
import { ApiError } from '../http.js';
import type { QueueMeta, QueueStore } from './queueRepair.js';

/**
 * The labeler queue's object operations over the PRIVATE capture store.
 *
 * Its own module (rather than inline in `scanQueue.ts`) so it can be tested
 * against an in-memory store without importing the route, which opens a
 * database pool for the queue's advisory locks.
 *
 * ── A STORAGE OUTAGE IS NEVER "NO SUCH PHOTO" ──────────────────────────────
 *
 * `CaptureStore` distinguishes absent (null / false) from failed (throws a
 * `CaptureStorageError`); this maps the second to a 502 the client can retry,
 * so a temporary failure cannot make a queued photo look deleted — the queue's
 * listing would otherwise drop it and the client would forget it.
 */
async function storage<T>(work: () => Promise<T>, message = 'Queued photo storage is temporarily unavailable.'): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof CaptureStorageError) throw new ApiError(502, 'queue_storage_unavailable', message);
    throw error;
  }
}

/**
 * ── THE LISTING'S READS RETRY A TRANSIENT FAILURE, QUICKLY ──────────────────
 *
 * The listing reads one sidecar per queued photo it has not seen before —
 * over a thousand on 2026-10-05 — so one hung connection or one
 * `429 too_many_connections` (object-store.ts measured Supabase throttling at
 * six parallel requests) used to fail the whole listing. On the PR preview the
 * first cold call did exactly that: a 502 after 32 s, a single read waiting out
 * the 20 s default timeout. A sidecar is ~100 bytes and answers in ~0.1 s, so
 * each attempt gets 5 s, and a throttle, a 5xx, a timeout or a dropped
 * connection (status 0, which is also how a failed object listing reports) is
 * retried twice with backoff. A refusal fails at once. Only reads retry: they
 * are idempotent, and nothing destructive keys off a sidecar.
 */
const SIDECAR_TIMEOUT_MS = 5_000;
const READ_ATTEMPTS = 3;

function transient(error: unknown): boolean {
  return error instanceof CaptureStorageError && (error.status === 0 || error.status === 429 || error.status >= 500);
}

async function retryTransient<T>(work: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await work();
    } catch (error) {
      if (attempt >= READ_ATTEMPTS || !transient(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** (attempt - 1) + Math.floor(Math.random() * 250)));
    }
  }
}

/**
 * ── A SIDECAR THE LISTING HAS ALREADY READ IS NOT READ AGAIN ────────────────
 *
 * The labeler re-lists the queue after every label and every discard, so a
 * thousand-photo queue would cost a thousand Storage reads per label — load on
 * the Storage service the whole product shares, for metadata that almost never
 * changes. The listing passes the etag its snapshot reported for each sidecar,
 * and a sidecar is remembered only when the bytes actually read hash to that
 * etag (Storage's etag is the MD5 of a single-part upload; capture-migration.ts
 * relies on the same fact). A hit therefore returns exactly what reading the
 * listed bytes would; a rewritten sidecar has a new etag and is read afresh;
 * an etag that is not an MD5 simply never caches. Locked reads (opening,
 * repair, cleanup) pass no etag and always read.
 */
const SIDECAR_CACHE_MAX = 20_000;

const md5Hex = (bytes: Buffer) => createHash('md5').update(bytes).digest('hex');

/** A sidecar, or null when it is absent or is not queue metadata at all. */
function parseMeta(bytes: Buffer): QueueMeta | null {
  let data: Partial<QueueMeta>;
  try {
    data = JSON.parse(bytes.toString('utf8')) as Partial<QueueMeta>;
  } catch {
    return null; // a corrupt sidecar is missing metadata, not an outage
  }
  if (!data || typeof data !== 'object' || typeof data.name !== 'string') return null;
  return {
    name: data.name,
    source: data.source === 'camera' ? 'camera' : 'upload',
    addedAt: typeof data.addedAt === 'string' ? data.addedAt : new Date().toISOString(),
  };
}

export function createCaptureQueueStore(store: CaptureStore, locked: QueueStore['locked']): QueueStore {
  // path → the etag its bytes hashed to when read, and what they parsed as.
  const sidecars = new Map<string, { etag: string; meta: QueueMeta | null }>();
  return {
    locked,
    // Both buckets: the private one, plus any photo still waiting in the
    // public one for `POST /migrate-captures` to move it.
    list: async () =>
      (await storage(() => retryTransient(() => store.list('dev-queue')), 'Shared photo queue temporarily unavailable.'))
        .map(({ path, byteSize, etag }) => ({ path, byteSize, etag })),
    exists: (path) => storage(() => store.exists(path)),
    size: async (path) => (await storage(() => store.stat(path)))?.byteSize ?? null,
    // Reads go through the service key, not a public CDN URL, so a photo
    // another device has just discarded cannot come back from an edge cache.
    photo: async (path) => (await storage(() => store.read(path)))?.bytes ?? null,
    meta: async (path, listedEtag) => {
      const remembered = listedEtag ? sidecars.get(path) : undefined;
      if (remembered && remembered.etag === listedEtag) return remembered.meta;
      const object = await storage(
        () => retryTransient(() => store.read(path, { timeoutMs: SIDECAR_TIMEOUT_MS })),
        'Could not read queued photo metadata.',
      );
      if (!object) return null;
      const meta = parseMeta(object.bytes);
      if (listedEtag && md5Hex(object.bytes) === listedEtag) {
        sidecars.delete(path); // re-insert at the end: the oldest entry is evicted first
        sidecars.set(path, { etag: listedEtag, meta });
        if (sidecars.size > SIDECAR_CACHE_MAX) sidecars.delete(sidecars.keys().next().value!);
      }
      return meta;
    },
    put: (path, bytes, contentType) =>
      storage(() =>
        store.put({
          objectPath: path,
          bytes,
          contentType,
          provenance: unknownProvenance('quad-labeler pending photo — client camera frame or picked file, no upstream URL'),
          tierProvenanceReason:
            'work-in-progress photos under dev-queue/ in the private dev-captures bucket; their sidecars share the same provenance',
        }),
      ),
    remove: async (path) => {
      // Both buckets (see CaptureStore.remove). A delete that answered "nothing
      // there" while the object is in fact still there is a refused delete, and
      // it must fail loudly so the photo stays discoverable for a retry.
      if (await storage(() => store.remove(path))) return true;
      if (await storage(() => store.exists(path))) {
        throw new ApiError(502, 'queue_delete_failed', 'The queued photo could not be removed. Try again.');
      }
      return false;
    },
  };
}
