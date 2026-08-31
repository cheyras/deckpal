import { Router, type NextFunction, type Request, type Response } from 'express';
import {
  hasStorageEnv,
  listObjectsRecursive,
  objectExists,
  publicObjectUrl,
  putUnmanifestedObject,
  unknownProvenance,
} from '@deckpal/storage';
import { SUPABASE_MODE } from '../db.js';
import { ApiError, asyncHandler, badRequest, notFound, str } from '../http.js';

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
 * Same identity this deployment already uses for every other owner-only
 * surface (`/me`'s `isOwner`, `/design`, `/dev/decke`): self-host is always
 * the owner (one user, behind their own reverse proxy); cloud is only the
 * account named by DESIGN_EDITOR_USER_ID. Duplicated rather than imported
 * because `isOwner` in routes/me.ts is not exported — same env var, same
 * fail-closed shape, kept in sync by hand.
 */
function isOwner(userId: string | undefined): boolean {
  if (!SUPABASE_MODE) return true;
  const owner = process.env.DESIGN_EDITOR_USER_ID;
  return !!owner && !!userId && userId === owner;
}

/**
 * Non-production Vercel deployments (preview, and unset for self-host/local
 * `pnpm dev`) are already fronted by Vercel SSO or have no auth boundary at
 * all, so they pass through unconditionally. Production requires the verified
 * JWT subject (authMiddleware already ran; req.user is never client-supplied)
 * to be the owner. Mounted ahead of resolveIdentity in index.ts specifically
 * so a preview deployment is not additionally forced through its 401.
 */
function ownerGate(req: Request, res: Response, next: NextFunction): void {
  if (process.env.VERCEL_ENV !== 'production') {
    next();
    return;
  }
  if (isOwner(req.user?.id)) {
    next();
    return;
  }
  res.status(403).json({ error: { code: 'forbidden', message: 'Owner only.' } });
}

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

export const scanFlagsRouter: Router = Router();
scanFlagsRouter.use(ownerGate);

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
    const top = [...byId.entries()]
      .sort((a, b) => Number(b[0]) - Number(a[0]))
      .slice(0, 200);
    const flags = await Promise.all(
      top.map(async ([id, { files, size }]) => {
        const cpath = commentPaths.get(id);
        const comment = cpath ? await readComment(cpath) : null;
        return {
          id: Number(id),
          files,
          size,
          uploadedAt: new Date(Number(id)).toISOString(), // the id IS the capture time
          comment,
        };
      }),
    );
    res.json({ flags });
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
