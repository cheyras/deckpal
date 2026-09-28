import { Router } from 'express';
import { makePool } from '@deckpal/db';
import { CaptureStorageError, captureStore, ensureCaptureBucket, hasStorageEnv, migrateLegacyCaptures, type CaptureStore } from '@deckpal/storage';
import { ApiError, asyncHandler, badRequest, notFound, str, userCache } from '../http.js';
import { pool, SUPABASE_MODE } from '../db.js';
import { labelerOnlyInProduction } from '../ownerGate.js';
import { cleanupRepairedOriginal, discardQueuePhoto, enqueueQueuePhoto, listQueuePhotos, originalId as queueFamilyId, readQueuePhoto, repairQueuePhoto, validQueuePhotoId, type QueueStore } from './queueRepair.js';
import { createQueueLocker } from './queueLock.js';
import { createCaptureQueueStore } from './captureQueueStore.js';

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
 *
 * ── PRIVATE SINCE 2026-09-28 ───────────────────────────────────────────────
 *
 * Both prefixes live in the PRIVATE `dev-captures` bucket, reached only with
 * the server's key (`captureStore()`, packages/storage/src/capture-store.ts).
 * They used to be in the public `card-art` bucket under guessable timestamp
 * names. `POST /migrate-captures` below moves what is still there — for both
 * prefixes, because this router owns the queue's family lock and the move of a
 * queued photo has to take it.
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
 * The body is base64 (+33%), so 3 MB decoded is EXACTLY 4 MB on the wire —
 * 3,145,728 divides evenly by 3, so there is no rounding to save it — which
 * leaves no room at all for the `{"jpg":"…","name":"…","source":"…"}`
 * wrapper around it, not "room for the JSON wrapper" as this comment used to
 * claim (a max-size upload 413'd against a bare 4mb parser once index.ts
 * actually enforced one at this boundary — SEC-08 review caught it). The
 * real headroom lives in index.ts's route-scoped parser for `/dev/scan-queue`
 * (4200kb, not 4mb), which is the number that actually has to fit this. It
 * is also the number `dev-flags` already uses for the same decoded cap.
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

// Cloud requests already hold a connection for RLS. A second checkout from
// that same pool could deadlock at capacity, and its request transaction is
// rolled back on disconnect while storage work can still be running. The
// worker pool keeps the lock alive until the object operations finish. A
// self-host request has no RLS checkout, so it stays inside the API budget.
const queueLockPool = SUPABASE_MODE ? makePool({ role: 'worker', max: 3 }) : pool;
// Cloud has a dedicated three-connection session pool. Self-host shares the
// request pool, so queue storage work uses only one of its connections.
const queueLocked = createQueueLocker(queueLockPool, SUPABASE_MODE ? 3 : 1);

// Built on first use: `captureStore()` reads the storage credentials, and a
// self-host deploy without them must still be able to import this router.
let queueStoreInstance: QueueStore | null = null;
function queueStore(): QueueStore {
  queueStoreInstance ??= createCaptureQueueStore(captureStore(), queueLocked);
  return queueStoreInstance;
}

/**
 * The migration's lock for one object: a queued photo's family lock, the same
 * one listing, reading, repair, cleanup and discard take (queue-state.md), so a
 * photo cannot be moved out from under a discard and resurrected by it. Labels
 * (`dev-flags/`) have no such lock and run bare.
 */
const QUEUE_OBJECT_RE = /^dev-queue\/(\d+)\.(jpg|json)$/;
function migrationLock<T>(path: string, work: () => Promise<T>): Promise<T> {
  const match = QUEUE_OBJECT_RE.exec(path);
  const id = match ? Number(match[1]) : Number.NaN;
  return validQueuePhotoId(id) ? queueLocked(queueFamilyId(id), work) : work();
}

/**
 * How long one migration request may keep STARTING objects. The function's
 * ceiling is 60 s (vercel.json); objects already in flight finish after this,
 * and a request killed mid-object is safe anyway (see capture-migration.ts).
 * The labeler calls again until the answer says `done`.
 */
const MIGRATION_BUDGET_MS = 20_000;

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
        const repaired = await repairQueuePhoto(originalId, bytes, requested, queueStore(), isHeicBytes);
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
    const queued = await enqueueQueuePhoto(epochMs, bytes, requested, queueStore());
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
    // Both buckets: the private one, plus any photo still waiting in the
    // public one for `POST /migrate-captures` to move it.
    let objects: Awaited<ReturnType<CaptureStore['list']>>;
    try {
      objects = await captureStore().list('dev-queue');
    } catch (error) {
      if (error instanceof CaptureStorageError) {
        throw new ApiError(502, 'queue_storage_unavailable', 'Shared photo queue temporarily unavailable.');
      }
      throw error;
    }
    const ids = new Set<number>();
    for (const obj of objects) {
      const m = QUEUE_ID_RE.exec(obj.path.slice(PREFIX.length));
      if (!m) continue;
      ids.add(Number(m[1]));
    }
    // OLDEST FIRST — the order they were shot, which is the order a reader
    // works a stack of cards in. (The corpus listing is newest-first; that one
    // is a review, this one is a work queue.)
    const photos = (await listQueuePhotos(ids, queueStore())).map(({ id, size, meta }) => ({ id, size, ...meta }));
    photos.sort((a, b) => Date.parse(a.addedAt) - Date.parse(b.addedAt) || a.id - b.id);
    res.json({ photos });
  }),
);

// ── POST /migrate-captures — move public captures into the private bucket ───
//
// Captures written before 2026-09-28 are still in the PUBLIC card-art bucket
// (`dev-flags/`, `dev-queue/`). This moves a time-boxed batch of them — copy,
// read back and compare, and only then delete the public copy — and says how
// many are left. The labeler and the harvest call it when they open and keep
// calling until it answers `done`, so the move needs no operator and finishes
// in the first session after a deploy. Idempotent and safe to run from two
// tabs at once; see packages/storage/src/capture-migration.ts for why.
//
// Here, behind the labeler gate, rather than on a cron: nothing else in this
// deployment runs on a schedule without a new secret, and the people who can
// call it are exactly the people whose photos these are.
scanQueueRouter.post(
  '/migrate-captures',
  asyncHandler(async (_req, res) => {
    userCache(res);
    if (!hasStorageEnv()) {
      res.json({ ok: true, listed: 0, moved: 0, preserved: 0, gone: 0, failed: 0, failures: [], remaining: 0, done: true });
      return;
    }
    const store = captureStore();
    let report: Awaited<ReturnType<typeof migrateLegacyCaptures>>;
    try {
      // Up front, once: a bucket that cannot be made (or is public) fails the
      // whole request here, instead of failing every object in turn.
      await ensureCaptureBucket();
      report = await migrateLegacyCaptures({
        primary: store.primary,
        legacy: store.legacy,
        budgetMs: MIGRATION_BUDGET_MS,
        concurrency: 4,
        lock: migrationLock,
      });
    } catch (error) {
      // The bucket, or a listing, failed: nothing was moved and nothing deleted.
      if (error instanceof CaptureStorageError) {
        throw new ApiError(502, 'capture_storage_unavailable', 'Capture storage is temporarily unavailable. Nothing was moved.');
      }
      throw error;
    }
    if (report.failed.length) {
      console.warn(`[capture-migration] ${report.failed.length} left in the public bucket this run`, report.failed.slice(0, 5));
    }
    res.json({
      ok: true,
      listed: report.listed,
      moved: report.moved,
      preserved: report.preserved,
      gone: report.gone,
      failed: report.failed.length,
      failures: report.failed.slice(0, 20),
      remaining: report.remaining,
      done: report.done,
    });
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
        removed = await cleanupRepairedOriginal(numericId, queueStore());
      } catch (error) {
        if (error instanceof Error && error.message === 'replacement is incomplete') {
          throw new ApiError(409, 'queue_repair_incomplete', 'The JPEG replacement is not complete yet. Try again.');
        }
        throw error;
      }
    } else {
      removed = await discardQueuePhoto(numericId, queueStore());
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
    const selected = await readQueuePhoto(numericId, queueStore());
    if (!selected) throw notFound('no such queued photo');
    // `private, no-store`: read with the server's key and served only through
    // this gate; nothing between here and the browser should keep a copy.
    userCache(res);
    if (ext === 'json') {
      res.json(selected.photo.meta);
    } else {
      res.setHeader('content-type', 'image/jpeg');
      res.send(selected.bytes);
    }
  }),
);
