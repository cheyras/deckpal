import { Router } from 'express';
import {
  deleteObject,
  hasStorageEnv,
  listObjectsRecursive,
  objectExists,
  publicObjectUrl,
  putUnmanifestedObject,
  unknownProvenance,
} from '@deckpal/storage';
import { ApiError, asyncHandler, badRequest, notFound, str } from '../http.js';
import { labelerOnlyInProduction } from '../ownerGate.js';

/**
 * Scan-harness "Flag frame" capture — POST/GET /dev/scan-flags.
 *
 * The harness (apps/web/.../scan-harness.html) used to hand the flagged frame
 * to the browser as a download; mobile Safari saved it as a bare .html file
 * instead of a .png, so the owner never actually got the image. This uploads
 * the frame + its sidecar metadata to the object store instead.
 *
 * Objects are unmanifested (no `image_asset` row): they are debug captures,
 * not catalog art, and `ImageAssetKind` has no slot for them. Provenance is
 * tracked at the class level, same shape as sprites — see put-asset.ts.
 */

const FLAG_ID_RE = /^(\d+)\.(png|json)$/;
// The comment sidecar is a distinct object class from the flag's own png/json
// (it's written by a later, separate request, and may never exist at all), so
// it gets its own regex rather than a third alternative on FLAG_ID_RE above —
// that one still means exactly "a flag's own capture files" everywhere it's
// used (the listing loop's byId map, the .files it reports).
const COMMENT_RE = /^(\d+)\.comment\.json$/;
const ID_RE = /^\d+$/;
const PREFIX = 'dev-flags/';

// ~3MB for the decoded frame + its sidecar JSON combined. The app-wide
// express.json({limit:'12mb'}) in index.ts runs BEFORE this router (it is
// mounted on `app`, ahead of every route) and fully drains the request
// stream, so a second express.json() here with a smaller limit would find
// body-parser's `read()` sees the request already finished (on-finished's
// `isFinished(req)`, i.e. `req.complete`) and call next() without re-reading
// or re-checking any limit — not a smaller cap, just a no-op. The cap is
// therefore enforced by hand, after decoding, below.
const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;

// A comment is a short owner annotation, not a report; 4KB is generous for that.
const MAX_COMMENT_BYTES = 4 * 1024;

/**
 * The comment TEXT for one flag, or null if it has none / the fetch failed.
 * Best-effort: a corrupt or unreachable comment object must not break the
 * list, since every other field in that entry is still good.
 */
async function readComment(objectPath: string): Promise<string | null> {
  try {
    const upstream = await fetch(publicObjectUrl(objectPath));
    if (!upstream.ok) return null;
    const data = (await upstream.json()) as { comment?: unknown };
    return typeof data.comment === 'string' ? data.comment : null;
  } catch {
    return null;
  }
}

/**
 * The label's own verdict, read out of its sidecar JSON.
 *
 * ── WHY THE LISTING CAN RETURN THIS AND WHY IT IS OPT-IN ────────────────────
 *
 * The listing knows an id, a size and a timestamp; it does not know whether the
 * row is a card, a card back or a reason-coded negative, because Storage's list
 * endpoint reports metadata about OBJECTS and the verdict lives inside one. A
 * harvest view that cannot sort by verdict is a wall of thumbnails, so `?meta=1`
 * fetches each sidecar and reports a summary.
 *
 * It is OPT-IN because it costs one request per row. The default listing — used
 * by everything that only wants ids — is unchanged and still one call.
 */
interface LabelSummary {
  /** 'positive' | 'back' | 'negative' | 'unknown' — `unknown` covers the rows
   *  written by the OTHER two producers in this prefix (the harness's frame
   *  flags and the scanner's reports), which are not quad labels at all. */
  verdict: string;
  /** For a negative, the reason code. Null otherwise. */
  reason: string | null;
  /** `meta.type` verbatim — 'quad-label' for the labeler's own rows. */
  type: string | null;
  source: string | null;
  seededFrom: string | null;
  /** The live pipeline's stage at the shutter, when the row was captured with
   *  sweep mode on. Null on every other row. */
  sweepStage: string | null;
  hasObj: number | null;
}

function summarize(meta: Record<string, unknown>): LabelSummary {
  const pipeline = (meta.pipeline ?? {}) as Record<string, unknown>;
  const sweep = (pipeline.sweep ?? {}) as Record<string, unknown>;
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const str_ = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
  const isQuadLabel = meta.type === 'quad-label';
  let verdict = 'unknown';
  if (isQuadLabel) {
    if (meta.corners === null) verdict = 'negative';
    else if (Array.isArray(meta.corners)) verdict = meta.face === 'back' ? 'back' : 'positive';
  }
  return {
    verdict,
    reason: verdict === 'negative' ? str_(meta.invalidReason) : null,
    type: str_(meta.type),
    source: str_(meta.source),
    seededFrom: str_(meta.seededFrom),
    sweepStage: str_(sweep.stage),
    // The seed's own presence head, which is the number a `no_object` fallback
    // is about. Not the sweep's — that one travels under sweepStage.
    hasObj: num(pipeline.hasObj),
  };
}

/** Fetch one sidecar and summarize it. Best-effort, exactly like `readComment`:
 *  a row whose JSON is unreachable still lists, just without its verdict. */
async function readSummary(objectPath: string): Promise<LabelSummary | null> {
  try {
    const upstream = await fetch(publicObjectUrl(objectPath));
    if (!upstream.ok) return null;
    const data = (await upstream.json()) as Record<string, unknown>;
    return summarize(data);
  } catch {
    return null;
  }
}

/**
 * `Promise.all` with a ceiling on how many are in flight.
 *
 * The comment fetch above has always been an unbounded `Promise.all` and got
 * away with it because comments are rare. Summaries are not — `?meta=1` wants
 * one per row — and 1000 simultaneous fetches out of a serverless function is
 * how you discover its socket limit in production rather than here.
 */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return out;
}

export const scanFlagsRouter: Router = Router();
// The LABELER SET on production (owner + QA, see ../ownerGate.ts); open on
// preview and self-host. Mounted ahead of resolveIdentity in index.ts
// specifically so a preview deployment is not ALSO forced through its 401 for
// having no app session — `authMiddleware` has already run by then, so
// `req.user` is populated and the gate has a verified subject to check.
//
// WIDENED FROM OWNER-ONLY 2026-09-08. This router is the only path a quad
// label takes (`scan/labeler/saveLabel.ts` -> `api.scanFlag` -> POST here), so
// it has to agree with `/dev/quad-labeler`'s route guard or the QA account
// gets a surface it can open and cannot save from.
//
// `forbidden` rather than `not-found`: this is a documented operator tool, and
// saying "you may not" to the wrong account is more useful than pretending the
// route is absent — the opposite of the scanner's gate, which is meant to be
// invisible.
scanFlagsRouter.use(labelerOnlyInProduction('forbidden'));

// ── POST / — upload a flagged frame ─────────────────────────────────────────
scanFlagsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    if (!hasStorageEnv()) throw new ApiError(501, 'storage_unavailable', 'No object store configured.');

    const body = (req.body ?? {}) as { png?: unknown; meta?: unknown };
    if (typeof body.png !== 'string' || !body.png) throw badRequest('png (base64 string) is required');
    if (typeof body.meta !== 'object' || body.meta === null || Array.isArray(body.meta)) {
      throw badRequest('meta (object) is required');
    }

    const pngBytes = Buffer.from(body.png, 'base64');
    if (pngBytes.length === 0) throw badRequest('png decoded to 0 bytes');
    const metaJson = JSON.stringify(body.meta, null, 2);
    if (pngBytes.length + Buffer.byteLength(metaJson) > MAX_UPLOAD_BYTES) {
      throw new ApiError(
        413,
        'payload_too_large',
        `flagged frame is over the ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB dev-harness limit`,
      );
    }

    const epochMs = Date.now();
    const reason = 'scan-harness "Flag frame" capture — client-generated canvas frame, no upstream URL';
    await putUnmanifestedObject({
      objectPath: `${PREFIX}${epochMs}.png`,
      bytes: pngBytes,
      provenance: unknownProvenance(reason),
      tierProvenanceReason: 'dev-only debug captures under dev-flags/, not catalog art; every object in the prefix shares this one reason',
      contentType: 'image/png',
    });
    await putUnmanifestedObject({
      objectPath: `${PREFIX}${epochMs}.json`,
      bytes: Buffer.from(metaJson, 'utf8'),
      provenance: unknownProvenance(reason),
      tierProvenanceReason: 'sidecar metadata for the paired PNG above — same class, same reason',
      contentType: 'application/json',
    });

    res.json({ ok: true, id: epochMs });
  }),
);

// ── POST /:id/comment — annotate a flagged frame ────────────────────────────
scanFlagsRouter.post(
  '/:id/comment',
  asyncHandler(async (req, res) => {
    if (!hasStorageEnv()) throw new ApiError(501, 'storage_unavailable', 'No object store configured.');

    const id = str(req.params.id) ?? '';
    if (!ID_RE.test(id)) throw badRequest('bad flag id');

    const body = (req.body ?? {}) as { comment?: unknown };
    const comment = typeof body.comment === 'string' ? body.comment.trim() : '';
    if (!comment) throw badRequest('comment is required');
    if (Buffer.byteLength(comment, 'utf8') > MAX_COMMENT_BYTES) {
      throw new ApiError(413, 'payload_too_large', `comment is over the ${MAX_COMMENT_BYTES / 1024} KB limit`);
    }

    // The flag itself has to exist — a comment with nothing to attach to is a
    // typo'd id, not a new resource. Its .json sidecar is the flag's identity
    // (the .png could in principle be missing on a partial failure; the .json
    // is what the POST / handler writes second, so its presence is the
    // stronger signal that the upload actually completed).
    if (!(await objectExists(`${PREFIX}${id}.json`))) throw notFound('no such flag');

    const record = { comment, updatedAt: new Date().toISOString() };
    await putUnmanifestedObject({
      objectPath: `${PREFIX}${id}.comment.json`,
      bytes: Buffer.from(JSON.stringify(record, null, 2), 'utf8'),
      provenance: unknownProvenance('scan-harness owner comment — typed in the harness UI, no upstream URL'),
      tierProvenanceReason: 'comment sidecar for a dev-flags capture — same class as the paired PNG/JSON above; x-upsert makes a re-POST an edit',
      contentType: 'application/json',
    });

    res.json({ ok: true, id: Number(id), ...record });
  }),
);

// ── GET / — list flagged frames, newest first ───────────────────────────────
scanFlagsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    if (!hasStorageEnv()) {
      res.json({ flags: [] });
      return;
    }
    // One listing call sees every key under the prefix, including which ids
    // have a comment.json — but not what it SAYS, since Storage's list
    // endpoint reports size/type/etag, never content. Comment TEXT is fetched
    // below (commentPaths), and only for ids that both (a) survive the
    // top-200 cut and (b) actually have a comment.json — few in practice.
    const objects = await listObjectsRecursive(PREFIX.slice(0, -1));
    const byId = new Map<string, { files: string[]; size: number }>();
    const commentPaths = new Map<string, string>(); // id -> comment.json object path
    for (const obj of objects) {
      const name = obj.path.slice(PREFIX.length);
      const cm = COMMENT_RE.exec(name);
      if (cm) {
        commentPaths.set(cm[1]!, obj.path);
        continue;
      }
      const m = FLAG_ID_RE.exec(name);
      if (!m) continue; // ignore anything under the prefix this router didn't write
      const id = m[1]!;
      const ext = m[2]!;
      const entry = byId.get(id) ?? { files: [], size: 0 };
      entry.files.push(ext);
      entry.size += obj.byteSize;
      byId.set(id, entry);
    }
    // 200 held ~a session's worth of rows until identity-events doubled the
    // rate (owner session 3, 2026-09-06: the cap fell INSIDE the session and
    // 12 of 63 captures were unrecoverable). 1000 holds the densest recorded
    // session ~5x over; ?limit lets a harvester ask for less. The listing
    // call already sees every key either way — the cap only bounds the
    // comment fetches and the response body.
    const limit = Math.min(Math.max(Number(_req.query.limit) || 1000, 1), 5000);
    const top = [...byId.entries()]
      .sort((a, b) => Number(b[0]) - Number(a[0]))
      .slice(0, limit);
    // `?meta=1` costs one extra fetch per row and is what makes a harvest view
    // sortable by verdict; without it the listing is one call, as it always was.
    const wantMeta = _req.query.meta === '1' || _req.query.meta === 'true';
    const flags = await mapLimit(top, 12, async ([id, { files, size }]) => {
      const cpath = commentPaths.get(id);
      const comment = cpath ? await readComment(cpath) : null;
      const label =
        wantMeta && files.includes('json') ? await readSummary(`${PREFIX}${id}.json`) : null;
      return {
        id: Number(id),
        files,
        size,
        uploadedAt: new Date(Number(id)).toISOString(), // the id IS the capture time
        comment,
        label,
      };
    });
    res.json({ flags });
  }),
);

// ── DELETE /:id — remove one flag and everything paired with it ─────────────
//
// PERMANENT, AND SAYS SO. There is no recycle bin here: these are debug
// captures in an unmanifested prefix, with no `image_asset` row to soft-delete
// and no restore path that would not be a second feature. The confirmation
// therefore lives in the UI, where the reader can see WHICH row they are about
// to lose, rather than in a `?purge=true` flag they would learn to append.
//
// ALL THREE OBJECTS, and the comment is not optional cleanup: a `<id>.comment
// .json` left behind would keep appearing in the listing loop's `commentPaths`
// map forever, attached to an id whose png and json no longer exist. Deleting
// the frame and orphaning its annotation is the one outcome worth ruling out.
//
// Absent objects are not an error. `deleteObject` reports whether it removed
// anything, and a partial delete retried is exactly how a caller recovers from
// the first attempt failing halfway — so a second run over a half-gone id must
// finish the job and report success, not 404 on the piece already gone.
scanFlagsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = str(req.params.id) ?? '';
    if (!ID_RE.test(id)) throw badRequest('bad flag id');
    if (!hasStorageEnv()) throw new ApiError(501, 'storage_unavailable', 'No object store configured.');

    const paths = [`${PREFIX}${id}.png`, `${PREFIX}${id}.json`, `${PREFIX}${id}.comment.json`];
    const removed: string[] = [];
    for (const p of paths) {
      if (await deleteObject(p)) removed.push(p.slice(PREFIX.length));
    }
    if (!removed.length) throw notFound(`no flag ${id}`);
    res.json({ ok: true, id: Number(id), removed });
  }),
);

// ── GET /:file — one stored object's bytes ──────────────────────────────────
scanFlagsRouter.get(
  '/:file',
  asyncHandler(async (req, res) => {
    const file = str(req.params.file) ?? '';
    // A flag's own png/json, OR its comment sidecar — nothing else lives
    // under this prefix, and no path tricks: both regexes are `^...$`.
    if (!FLAG_ID_RE.test(file) && !COMMENT_RE.test(file)) throw badRequest('bad file id');
    if (!hasStorageEnv()) throw notFound('no object store configured');

    // The bucket is public (see object-store.ts); fetching its own published
    // URL server-side is the same read path `headObject`/`objectExists` use,
    // rather than inventing a second way to reach Storage.
    const upstream = await fetch(publicObjectUrl(`${PREFIX}${file}`));
    if (!upstream.ok) throw notFound('no such flag object');

    res.setHeader('Content-Type', file.endsWith('.json') ? 'application/json' : 'image/png');
    res.setHeader('Cache-Control', 'no-store');
    res.send(Buffer.from(await upstream.arrayBuffer()));
  }),
);
