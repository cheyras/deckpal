import { Router } from 'express';
import {
  deleteObject,
  hasStorageEnv,
  listObjectsRecursive,
  publicObjectUrl,
  putUnmanifestedObject,
  unknownProvenance,
} from '@deckpal/storage';
import { ApiError, asyncHandler, badRequest, notFound, str } from '../http.js';
import { labelerOnlyInProduction } from '../ownerGate.js';

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

interface QueueMeta {
  name: string;
  source: 'camera' | 'upload';
  addedAt: string;
}

async function readMeta(objectPath: string): Promise<QueueMeta | null> {
  try {
    const upstream = await fetch(publicObjectUrl(objectPath));
    if (!upstream.ok) return null;
    const data = (await upstream.json()) as Partial<QueueMeta>;
    if (typeof data.name !== 'string') return null;
    return {
      name: data.name,
      source: data.source === 'camera' ? 'camera' : 'upload',
      addedAt: typeof data.addedAt === 'string' ? data.addedAt : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

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
    let epochMs = Date.now();
    let originalMeta: QueueMeta | null = null;
    if (body.repairOf !== undefined) {
      const originalId = body.repairOf;
      if (!Number.isSafeInteger(originalId) || typeof originalId !== 'number' || originalId < 1_000_000_000_000 ||
          !Number.isSafeInteger(originalId * 1000 + 1)) throw badRequest('bad repair photo id');
      epochMs = originalId * 1000 + 1;
      const replacement = await fetch(publicObjectUrl(`${PREFIX}${epochMs}.jpg`), { method: 'HEAD' });
      if (replacement.ok) {
        const meta = await readMeta(`${PREFIX}${epochMs}.json`);
        res.json({ ok: true, id: epochMs, name: meta?.name ?? body.name, source: meta?.source ?? body.source, addedAt: meta?.addedAt ?? new Date(originalId).toISOString() });
        return;
      }
      if (replacement.status !== 404 && replacement.status !== 400) throw new ApiError(502, 'queue_storage_unavailable', 'Could not check the HEIC replacement.');
      const original = await fetch(publicObjectUrl(`${PREFIX}${originalId}.jpg`));
      if (original.status === 404 || original.status === 400) throw notFound('no such queued photo');
      if (!original.ok) throw new ApiError(502, 'queue_storage_unavailable', 'Could not read the HEIC photo to repair.');
      if (!isHeicBytes(Buffer.from(await original.arrayBuffer()))) throw badRequest('repair source is not HEIC');
      originalMeta = await readMeta(`${PREFIX}${originalId}.json`);
    }
    const meta: QueueMeta = {
      name: typeof body.name === 'string' && body.name ? body.name.slice(0, 200) : `photo-${epochMs}.jpg`,
      source: body.source === 'camera' ? 'camera' : 'upload',
      addedAt: originalMeta?.addedAt ?? new Date(body.repairOf === undefined ? epochMs : body.repairOf as number).toISOString(),
    };
    const reason = 'quad-labeler pending photo — client camera frame or picked file, no upstream URL';
    await putUnmanifestedObject({
      objectPath: `${PREFIX}${epochMs}.jpg`,
      bytes,
      provenance: unknownProvenance(reason),
      tierProvenanceReason: 'work-in-progress photos under dev-queue/, deleted when labelled; every object in the prefix shares this one reason',
      contentType: 'image/jpeg',
    });
    await putUnmanifestedObject({
      objectPath: `${PREFIX}${epochMs}.json`,
      bytes: Buffer.from(JSON.stringify(meta, null, 2), 'utf8'),
      provenance: unknownProvenance(reason),
      tierProvenanceReason: 'sidecar metadata for the paired photo above — same class, same reason',
      contentType: 'application/json',
    });

    res.json({ ok: true, id: epochMs, ...meta });
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
    const byId = new Map<string, { hasJpg: boolean; size: number }>();
    for (const obj of objects) {
      const m = QUEUE_ID_RE.exec(obj.path.slice(PREFIX.length));
      if (!m) continue;
      const entry = byId.get(m[1]!) ?? { hasJpg: false, size: 0 };
      if (m[2] === 'jpg') {
        entry.hasJpg = true;
        entry.size = obj.byteSize;
      }
      byId.set(m[1]!, entry);
    }
    // OLDEST FIRST — the order they were shot, which is the order a reader
    // works a stack of cards in. (The corpus listing is newest-first; that one
    // is a review, this one is a work queue.)
    const ids = [...byId.entries()].filter(([, e]) => e.hasJpg);
    const photos = await Promise.all(
      ids.map(async ([id, { size }]) => {
        const meta = await readMeta(`${PREFIX}${id}.json`);
        return {
          id: Number(id),
          size,
          name: meta?.name ?? `photo-${id}.jpg`,
          source: meta?.source ?? 'upload',
          addedAt: meta?.addedAt ?? new Date(Number(id)).toISOString(),
        };
      }),
    );
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

    const removed: string[] = [];
    for (const p of [`${PREFIX}${id}.jpg`, `${PREFIX}${id}.json`]) {
      if (await deleteObject(p)) {
        removed.push(p.slice(PREFIX.length));
        continue;
      }
      const check = await fetch(publicObjectUrl(p), { method: 'HEAD', cache: 'no-store' });
      if (check.status !== 404 && check.status !== 400) {
        throw new ApiError(502, 'queue_delete_failed', 'The queued photo could not be removed. Try again.');
      }
    }
    // Absent is not an error, for `dev/scanFlags.ts`'s reason: two devices can
    // finish the same photo, and the second one must report success rather than
    // 404 over work that is already done.
    res.json({ ok: true, id: Number(id), removed });
  }),
);

// ── GET /:file — one queued photo's bytes ──────────────────────────────────
scanQueueRouter.get(
  '/:file',
  asyncHandler(async (req, res) => {
    const file = str(req.params.file) ?? '';
    if (!QUEUE_ID_RE.test(file)) throw badRequest('bad file id');
    if (!hasStorageEnv()) throw notFound('no object store configured');

    const upstream = await fetch(publicObjectUrl(`${PREFIX}${file}`));
    if (upstream.status === 404 || upstream.status === 400) throw notFound('no such queued photo');
    if (!upstream.ok) {
      throw new ApiError(502, 'queue_storage_unavailable', `Queued photo storage is temporarily unavailable (HTTP ${upstream.status}).`);
    }
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.setHeader('content-type', file.endsWith('.jpg') ? 'image/jpeg' : 'application/json');
    // A queued photo is immutable for its short life — it is written once and
    // deleted, never edited — so the browser may keep it while the reader
    // scrolls the queue.
    res.setHeader('cache-control', 'private, max-age=300');
    res.send(buf);
  }),
);
