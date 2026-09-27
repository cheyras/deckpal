import { Router } from 'express';
import { makePool } from '@deckpal/db';
import {
  deleteObject,
  hasStorageEnv,
  listObjectsRecursive,
  publicObjectUrl,
  putUnmanifestedObject,
  unknownProvenance,
} from '@deckpal/storage';
import { ApiError, asyncHandler, badRequest, notFound, str } from '../http.js';
import { pool, SUPABASE_MODE } from '../db.js';
import { labelerOnlyInProduction } from '../ownerGate.js';
import { cleanupRepairedOriginal, discardQueuePhoto, enqueueQueuePhoto, listQueuePhotos, readQueuePhoto, repairQueuePhoto, validQueuePhotoId, type QueueMeta, type QueueStore } from './queueRepair.js';
import { createQueueLocker } from './queueLock.js';

/**
 * The labeler's pending-photo queue — POST/GET/DELETE /dev/scan-queue.
 *
 * ── WHY THIS EXISTS (owner report, 2026-09-10) ─────────────────────────────
 *
 * *"I added a whole bunch of images in the quad labeler on my macbook. They're
 * in the queue there, but they are NOT in the queue when I bring it up on
 * mobile."*
 *
 * The queue was IndexedDB, which is per-origin PER DEVICE. That was a real
 * reading of "persistent" — it survives a reload, a backgrounded tab, a phone
 * that slept — and it was the wrong one for the workflow the owner actually
 * has: photograph a stack on whatever camera is to hand, label it wherever you
 * happen to be sitting. A queue that cannot cross that gap is a queue that has
 * to be worked on the device that filled it, which is the constraint the
 * feature was meant to remove.
 *
 * So the queue lives in the object store, beside the labels it becomes.
 *
 * ── WHY ITS OWN PREFIX, AND NOT `dev-flags/` ───────────────────────────────
 *
 * `dev-flags/` is the CORPUS: finished labels, plus the scanner's own capture,
 * lock and identity events. A pending photo is none of those — it is work in
 * progress, it carries no verdict, and it is deleted the moment it becomes a
 * label. Putting it in the same prefix would mean the harvest had to learn to
 * hide a fourth record type (it already shows three), and a listing that
 * answers "what is in my corpus" would be answering "…plus what I have not
 * looked at yet". Separate prefix, separate question.
 */

const QUEUE_ID_RE = /^(\d+)\.(jpg|json)$/;
const ID_RE = /^\d+$/;
const PREFIX = 'dev-queue/';

/**
 * The decoded-photo cap.
 *
 * ── SIZED AGAINST THE LIMIT THAT ACTUALLY BITES ────────────────────────────
 *
 * **Vercel rejects a serverless function's request body over 4.5 MB before this
 * handler runs.** `scan/router.ts` sizes itself at 4 MB for that reason and
 * says so; `ui/uploadNormalize.ts` opens with it; DECISIONS records it three
 * times. This route shipped at 12 MB, then 8 MB — both above a ceiling the
 * platform enforces first, so neither could ever be the thing that refused a
 * photo, and what the reader actually got was a platform error about nothing.
 *
 * The body is base64 (+33%), so 3 MB decoded is 4 MB on the wire and fits with
 * room for the JSON wrapper. It is also the number `dev-flags` already uses.
 * Clients normalize down to this before sending (`queueDb.normalizeForUpload`,
 * which steps quality and edge down until it fits); the cap is the backstop for
 * a client that does not.
 */
const MAX_PHOTO_BYTES = 3 * 1024 * 1024;
const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs']);

function isHeicBytes(bytes: Buffer): boolean {
  if (bytes.length < 12 || bytes.toString('ascii', 4, 8) !== 'ftyp') return false;
  for (let i = 8; i + 4 <= Math.min(bytes.length, 32); i += 4) {
    if (HEIC_BRANDS.has(bytes.toString('ascii', i, i + 4))) return true;
  }
  return false;
}

async function readMeta(objectPath: string, strict = false): Promise<QueueMeta | null> {
  try {
    const upstream = await fetch(publicObjectUrl(objectPath), { cache: 'no-store' });
    if (!upstream.ok) {
      if (strict && upstream.status !== 404 && upstream.status !== 400) {
        throw new ApiError(502, 'queue_storage_unavailable', 'Could not read queued photo metadata.');
      }
      return null;
    }
    const data = (await upstream.json()) as Partial<QueueMeta>;
    if (!data || typeof data !== 'object' || typeof data.name !== 'string') return null;
    return {
      name: data.name,
      source: data.source === 'camera' ? 'camera' : 'upload',
      addedAt: typeof data.addedAt === 'string' ? data.addedAt : new Date().toISOString(),
    };
  } catch (error) {
    if (strict && (error instanceof ApiError || !(error instanceof SyntaxError))) {
      throw error instanceof ApiError ? error : new ApiError(502, 'queue_storage_unavailable', 'Could not read queued photo metadata.');
    }
    return null;
  }
}

async function checkedObject(objectPath: string, method: 'HEAD' | 'GET'): Promise<Response | null> {
  const response = await fetch(publicObjectUrl(objectPath), { method, cache: 'no-store' });
  if (response.status === 404 || response.status === 400) return null;
  if (!response.ok) throw new ApiError(502, 'queue_storage_unavailable', 'Queued photo storage is temporarily unavailable.');
  return response;
}

// Cloud requests already hold a connection for RLS. A second checkout from
// that same pool could deadlock at capacity, and its request transaction is
// rolled back on disconnect while storage work can still be running. The
// worker pool keeps the lock alive until the object operations finish. A
// self-host request has no RLS checkout, so it stays inside the API budget.
const queueLockPool = SUPABASE_MODE ? makePool({ role: 'worker', max: 3 }) : pool;
// Cloud has a dedicated three-connection session pool. Self-host shares the
// request pool, so queue storage work uses only one of its connections.
const queueLocked = createQueueLocker(queueLockPool, SUPABASE_MODE ? 3 : 1);

const queueStore: QueueStore = {
  locked: queueLocked,
  exists: async (path) => !!(await checkedObject(path, 'HEAD')),
  size: async (path) => {
    const response = await checkedObject(path, 'HEAD');
    return response ? Number(response.headers.get('content-length') ?? 0) : null;
  },
  photo: async (path) => {
    // Public GETs may be CDN-cached after another device discards the photo.
    if (!(await checkedObject(path, 'HEAD'))) return null;
    const response = await checkedObject(path, 'GET');
    return response ? Buffer.from(await response.arrayBuffer()) : null;
  },
  meta: (path) => readMeta(path, true),
  put: async (path, bytes, contentType) => {
    await putUnmanifestedObject({
      objectPath: path,
      bytes,
      provenance: unknownProvenance('quad-labeler pending photo — client camera frame or picked file, no upstream URL'),
      tierProvenanceReason: 'work-in-progress photos under dev-queue/; their sidecars share the same provenance',
      contentType,
    });
  },
  remove: async (path) => {
    if (await deleteObject(path)) return true;
    if (await checkedObject(path, 'HEAD')) {
      throw new ApiError(502, 'queue_delete_failed', 'The queued photo could not be removed. Try again.');
    }
    return false;
  },
};

export const scanQueueRouter: Router = Router();
// The labeler set, same as the corpus router beside it: whoever may write a
// label may hold photos waiting to become one. Mounted ahead of resolveIdentity
// for the same reason `dev/scanFlags.ts` is — see that file.
scanQueueRouter.use(labelerOnlyInProduction('forbidden'));

// ── POST / — add one photo to the queue ────────────────────────────────────
scanQueueRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    if (!hasStorageEnv()) throw new ApiError(501, 'storage_unavailable', 'No object store configured.');

    const body = (req.body ?? {}) as { jpg?: unknown; name?: unknown; source?: unknown; repairOf?: unknown };
    if (typeof body.jpg !== 'string' || !body.jpg) throw badRequest('jpg (base64 string) is required');
    const bytes = Buffer.from(body.jpg, 'base64');
    if (bytes.length === 0) throw badRequest('jpg decoded to 0 bytes');
    if (bytes.length < 3 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
      throw badRequest('queued photo must contain JPEG bytes');
    }
    if (bytes.length > MAX_PHOTO_BYTES) {
      throw new ApiError(413, 'payload_too_large', `photo is over the ${MAX_PHOTO_BYTES / (1024 * 1024)} MB queue limit`);
    }

    // The id is the server's clock, not the client's. Two devices filling one
    // queue cannot agree on a millisecond, and the id is also the sort order —
    // "the order they were shot" only means anything if one clock stamps it.
    const epochMs = Date.now();
    if (body.repairOf !== undefined) {
      const originalId = body.repairOf;
      if (!Number.isSafeInteger(originalId) || typeof originalId !== 'number' || originalId < 1_000_000_000_000 ||
          !Number.isSafeInteger(originalId * 1000 + 1)) throw badRequest('bad repair photo id');
      const requested = {
        name: typeof body.name === 'string' && body.name ? body.name.slice(0, 200) : `photo-${originalId}.jpg`,
        source: body.source === 'camera' ? 'camera' as const : 'upload' as const,
      };
      try {
        const repaired = await repairQueuePhoto(originalId, bytes, requested, queueStore, isHeicBytes);
        res.json({ ok: true, ...repaired });
      } catch (error) {
        if (error instanceof Error && error.message === 'no such queued photo') throw notFound(error.message);
        if (error instanceof Error && error.message === 'repair source is not HEIC') throw badRequest(error.message);
        throw error;
      }
      return;
    }
    const requested = {
      name: typeof body.name === 'string' && body.name ? body.name.slice(0, 200) : `photo-${epochMs}.jpg`,
      source: body.source === 'camera' ? 'camera' as const : 'upload' as const,
    };
    const queued = await enqueueQueuePhoto(epochMs, bytes, requested, queueStore);
    res.json({ ok: true, ...queued });
  }),
);

// ── GET / — everything waiting, oldest first ───────────────────────────────
scanQueueRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    if (!hasStorageEnv()) {
      res.json({ photos: [] });
      return;
    }
    const objects = await listObjectsRecursive(PREFIX.slice(0, -1));
    const ids = new Set<number>();
    for (const obj of objects) {
      const m = QUEUE_ID_RE.exec(obj.path.slice(PREFIX.length));
      if (!m) continue;
      ids.add(Number(m[1]));
    }
    // OLDEST FIRST — the order they were shot, which is the order a reader
    // works a stack of cards in. (The corpus listing is newest-first; that one
    // is a review, this one is a work queue.)
    const photos = (await listQueuePhotos(ids, queueStore)).map(({ id, size, meta }) => ({ id, size, ...meta }));
    photos.sort((a, b) => Date.parse(a.addedAt) - Date.parse(b.addedAt) || a.id - b.id);
    res.json({ photos });
  }),
);

// ── DELETE /:id — it was labelled, or discarded ────────────────────────────
scanQueueRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = str(req.params.id) ?? '';
    if (!ID_RE.test(id)) throw badRequest('bad photo id');
    if (!hasStorageEnv()) throw new ApiError(501, 'storage_unavailable', 'No object store configured.');

    const numericId = Number(id);
    if (!validQueuePhotoId(numericId)) throw badRequest('bad photo id');
    let removed: string[];
    if (req.query.repairCleanup === '1') {
      if (numericId >= 1_000_000_000_000_000) throw badRequest('bad repair photo id');
      try {
        removed = await cleanupRepairedOriginal(numericId, queueStore);
      } catch (error) {
        if (error instanceof Error && error.message === 'replacement is incomplete') {
          throw new ApiError(409, 'queue_repair_incomplete', 'The JPEG replacement is not complete yet. Try again.');
        }
        throw error;
      }
    } else {
      removed = await discardQueuePhoto(numericId, queueStore);
    }
    // Absent is not an error, for `dev/scanFlags.ts`'s reason: two devices can
    // finish the same photo, and the second one must report success rather than
    // 404 over work that is already done.
    res.json({ ok: true, id: numericId, removed });
  }),
);

// ── GET /:file — one queued photo's bytes ──────────────────────────────────
scanQueueRouter.get(
  '/:file',
  asyncHandler(async (req, res) => {
    const file = str(req.params.file) ?? '';
    if (!QUEUE_ID_RE.test(file)) throw badRequest('bad file id');
    if (!hasStorageEnv()) throw notFound('no object store configured');

    const [rawId, ext] = file.split('.') as [string, 'jpg' | 'json'];
    const numericId = Number(rawId);
    if (!validQueuePhotoId(numericId)) throw badRequest('bad file id');
    const selected = await readQueuePhoto(numericId, queueStore);
    if (!selected) throw notFound('no such queued photo');
    res.setHeader('cache-control', 'no-store');
    if (ext === 'json') {
      res.json(selected.photo.meta);
    } else {
      res.setHeader('content-type', 'image/jpeg');
      res.send(selected.bytes);
    }
  }),
);
