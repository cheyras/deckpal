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
  return {
    locked,
    // Both buckets: the private one, plus any photo still waiting in the
    // public one for `POST /migrate-captures` to move it.
    list: async () =>
      (await storage(() => store.list('dev-queue'), 'Shared photo queue temporarily unavailable.'))
        .map(({ path, byteSize }) => ({ path, byteSize })),
    exists: (path) => storage(() => store.exists(path)),
    size: async (path) => (await storage(() => store.stat(path)))?.byteSize ?? null,
    // Reads go through the service key, not a public CDN URL, so a photo
    // another device has just discarded cannot come back from an edge cache.
    photo: async (path) => (await storage(() => store.read(path)))?.bytes ?? null,
    meta: async (path) => {
      const object = await storage(() => store.read(path), 'Could not read queued photo metadata.');
      return object ? parseMeta(object.bytes) : null;
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
