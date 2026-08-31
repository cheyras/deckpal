import express, { Router, type RequestHandler } from 'express';
import { q1 } from '../db.js';
import { ApiError, asyncHandler, badRequest, toBuffer, userCache } from '../http.js';
import { currentUserId } from '../identity.js';
import {
  ACCEPTED_AVATAR_UPLOAD_TYPES,
  AVATAR_EDGE,
  MAX_AVATAR_UPLOAD_BYTES,
  type AvatarRecorder,
  type StoredAvatar,
  avatarPublicUrl,
  deleteAvatarObject,
  hasAvatarStorage,
  isAvatarKey,
  newAvatarKey,
  putAvatarObject,
  sniffContentType,
} from '../workspace-storage.js';

/**
 * Profile photos — `/avatar` (issue #14, migration 029).
 *
 * Three verbs on one resource: read the current photo, replace it, remove it.
 * Mounted behind `requireSession` (see index.ts) for the same reason token
 * management is: a personal access token is for reading a collection, not for
 * changing the face attached to the account it was minted from.
 *
 * ── What is trusted ────────────────────────────────────────────────────────
 * Nothing the client says about the file. Not the `Content-Type` header, not
 * the filename, not the extension — a `.txt` renamed `.png` and sent as
 * `image/png` is a real thing a browser will happily do. The declared type is
 * used for exactly one thing: nothing. The decision comes from the magic bytes
 * (`sniffContentType`, the same sniffer the card-art tier uses), and then from
 * whether `sharp` can actually decode the buffer — a file that passes the magic
 * check but is truncated or malformed dies there, before anything is stored.
 *
 * ── Why we re-encode rather than store the original ────────────────────────
 * Three reasons, in order of importance:
 *   1. It is the real content check. Bytes that survive a decode → resize →
 *      re-encode round trip are an image, whatever else they may also have been.
 *      Polyglot files (a valid PNG header in front of something else) do not
 *      survive it, and neither does anything hidden in a metadata segment.
 *   2. Privacy. A phone photo carries EXIF — GPS coordinates, device, timestamp.
 *      Re-encoding drops all of it. Storing the original would publish the
 *      user's home address to a public bucket, which nobody asked for.
 *   3. Weight. A 12 MP upload becomes a ~15 KB 256×256 WebP, served from the CDN
 *      to the header chip on every page.
 *
 * ── Where the bytes go ─────────────────────────────────────────────────────
 * Through `putAvatarObject` (packages/storage/src/avatar-store.ts), which is
 * the choke point and refuses to publish without a record. The record is this
 * user's `user_profile` row. That is a documented departure from contract B1's
 * `image_asset` manifest, not an accident — the reasoning is at the top of
 * migration 029 and repeated in avatar-store.ts.
 *
 * ── Self-host ──────────────────────────────────────────────────────────────
 * No object store, so no feature. `GET /avatar` answers `{enabled: false}` and
 * the UI hides the control entirely; the write verbs answer 501 rather than
 * failing halfway through. Storing avatars on the image server's local disk was
 * considered and rejected: that cache is LRU-evictable and rebuildable from
 * upstream by design, and an avatar is neither.
 */
export const avatarRouter: Router = Router();

/** Human-facing size limit, for messages. */
const MAX_MB = Math.round((MAX_AVATAR_UPLOAD_BYTES / (1024 * 1024)) * 10) / 10;

const UNSUPPORTED_MESSAGE =
  'That file is not a JPEG, PNG or WebP image. Pick a photo saved in one of those formats.';

function unavailable(): ApiError {
  return new ApiError(
    501,
    'avatar_unavailable',
    'Profile photos need cloud storage, which this deployment does not have.',
  );
}

// ── Body parsing ─────────────────────────────────────────────────────────────
/**
 * Raw bytes, any declared content-type (`type: () => true`).
 *
 * Multipart would mean a parser dependency and a temp-file story for a request
 * that carries exactly one thing. The browser sends the `File` as the body and
 * we read it as a Buffer.
 *
 * The `limit` matters twice: it stops a large upload from being buffered into
 * function memory at all, and it fires before Vercel's own 4.5 MB body cap, so
 * the user gets our sentence instead of the platform's error page.
 */
const rawImageBody = express.raw({ type: () => true, limit: MAX_AVATAR_UPLOAD_BYTES });

/**
 * Same parser, but `entity.too.large` comes back as a sentence a person can
 * act on — and the Vercel body-consumption race is handled.
 *
 * Vercel's Node.js helpers (`NODEJS_HELPERS`, on by default) define `req.body`
 * as a lazy getter that buffers the request body on first access.  Once the
 * getter fires, the underlying stream is consumed.  If `express.raw()` then
 * reads the same stream, it gets zero bytes and *overwrites* the valid Buffer
 * from the getter with an empty one — producing exactly the "No image was
 * uploaded" error reported in issue #28.
 *
 * The fix: snapshot `req.body` before `express.raw()` runs.  If the getter was
 * already computed (or never existed), this is a harmless `undefined` read.  If
 * `express.raw()` then produces an empty Buffer, the snapshot is restored.
 * On a plain Node server (self-host), the getter does not exist, the stream is
 * untouched, and `express.raw()` works as before.
 */
const readImageBody: RequestHandler = (req, res, next) => {
  const preExisting = req.body;

  rawImageBody(req, res, (err: unknown) => {
    if (err && (err as { type?: string }).type === 'entity.too.large') {
      next(
        new ApiError(
          413,
          'too_large',
          `That image is larger than ${MAX_MB} MB. Try a smaller photo, or crop it first.`,
        ),
      );
      return;
    }
    if (err) { next(err); return; }

    // If express.raw() left us with nothing but the runtime had already parsed
    // the body (Vercel helper, or future middleware), recover the original bytes.
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      const restored = toBuffer(preExisting);
      if (restored && restored.length > 0) {
        if (restored.length > MAX_AVATAR_UPLOAD_BYTES) {
          next(
            new ApiError(
              413,
              'too_large',
              `That image is larger than ${MAX_MB} MB. Try a smaller photo, or crop it first.`,
            ),
          );
          return;
        }
        req.body = restored;
      }
    }

    next();
  });
};

// ── Normalisation ────────────────────────────────────────────────────────────
/**
 * Decode → square-crop → 256×256 → WebP.
 *
 * `sharp` is imported dynamically on purpose. A top-level import would run at
 * module load, which in the cloud deployment is the cold start of the ONE
 * function that serves every route — so a native module that failed to load
 * would take down the whole API rather than just this feature. Imported here,
 * the worst case is a 503 on avatar upload with everything else still serving.
 *
 * `.rotate()` before the resize applies the EXIF orientation tag; without it a
 * photo taken in portrait on a phone lands on its side, because the pixels are
 * landscape and only the tag says otherwise — and the tag is exactly what the
 * re-encode is about to discard.
 */
async function normaliseAvatar(input: Buffer): Promise<Buffer> {
  let sharp: typeof import('sharp').default;
  try {
    sharp = (await import('sharp')).default;
  } catch (err) {
    console.error('[avatar] sharp unavailable:', (err as Error).message);
    throw new ApiError(503, 'resize_unavailable', 'Image processing is temporarily unavailable. Try again later.');
  }
  try {
    return await sharp(input, { failOn: 'error' })
      .rotate()
      .resize(AVATAR_EDGE, AVATAR_EDGE, { fit: 'cover', position: 'attention' })
      .webp({ quality: 82 })
      .toBuffer();
  } catch (err) {
    // A decode failure here means the magic bytes lied — the file is truncated,
    // corrupt, or a header glued onto something else. Same message as a wrong
    // type: from the user's side it is the same mistake.
    console.warn('[avatar] decode failed:', (err as Error).message);
    throw badRequest(UNSUPPORTED_MESSAGE);
  }
}

// ── The record (contract B1, via migration 029) ──────────────────────────────
/**
 * Writes the `user_profile` row that makes the object attributable, and undoes
 * it if the upload then fails.
 *
 * `INSERT … ON CONFLICT DO UPDATE`, not a bare `UPDATE`: migration 021 creates
 * profile rows only from the signup trigger, so a bare UPDATE against a missing
 * row would touch zero rows, report success, and orphan the object. Migration
 * 029 adds the matching INSERT policy. Both statements are own-row only under
 * RLS, and the `user_id` is `currentUserId(req)` — never anything from the body.
 */
function recorder(userId: string, previousKey: string | null): AvatarRecorder {
  return {
    async record(a: StoredAvatar) {
      const row = await q1<{ user_id: string }>(
        `INSERT INTO user_profile (user_id, avatar_path, avatar_updated_at, avatar_byte_size, avatar_content_type)
              VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (user_id) DO UPDATE
                 SET avatar_path         = EXCLUDED.avatar_path,
                     avatar_updated_at   = EXCLUDED.avatar_updated_at,
                     avatar_byte_size    = EXCLUDED.avatar_byte_size,
                     avatar_content_type = EXCLUDED.avatar_content_type
           RETURNING user_id`,
        [userId, a.key, a.storedAt, a.byteSize, a.contentType],
      );
      if (!row) {
        // RLS refused, or app_user has no such id. Either way: do not publish.
        throw new ApiError(500, 'profile_write_failed', 'Could not save your profile photo. Please try again.');
      }
    },
    async revert() {
      // Put the row back the way it was. `previousKey` is null for a first
      // upload, which restores the default letter treatment rather than
      // stranding a pointer to an object that was never published.
      await q1(
        previousKey === null
          ? `UPDATE user_profile
                SET avatar_path = NULL, avatar_updated_at = NULL,
                    avatar_byte_size = NULL, avatar_content_type = NULL
              WHERE user_id = $1`
          : `UPDATE user_profile
                SET avatar_path = $2
              WHERE user_id = $1`,
        previousKey === null ? [userId] : [userId, previousKey],
      );
    },
  };
}

interface AvatarRow {
  avatar_path: string | null;
}

async function currentKey(userId: string): Promise<string | null> {
  const row = await q1<AvatarRow>('SELECT avatar_path FROM user_profile WHERE user_id = $1', [userId]);
  const key = row?.avatar_path ?? null;
  // The column is plain TEXT; treat anything that is not a key we minted as
  // absent rather than feeding it to a URL builder or a DELETE.
  return key && isAvatarKey(key) ? key : null;
}

function urlFor(key: string | null): string | null {
  return key ? avatarPublicUrl(key) : null;
}

// ── GET /avatar ──────────────────────────────────────────────────────────────
// The header chip and the profile page both read this. `enabled` is what the UI
// branches on, so the client never has to know what a Supabase is.
avatarRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    userCache(res);
    const userId = currentUserId(req);
    if (!hasAvatarStorage()) {
      res.json({ avatarUrl: null, enabled: false, maxBytes: MAX_AVATAR_UPLOAD_BYTES });
      return;
    }
    res.json({
      avatarUrl: urlFor(await currentKey(userId)),
      enabled: true,
      maxBytes: MAX_AVATAR_UPLOAD_BYTES,
      accept: ACCEPTED_AVATAR_UPLOAD_TYPES,
    });
  }),
);

// ── POST /avatar ─────────────────────────────────────────────────────────────
// Body is the raw image. Replaces whatever was there and reaps the old object.
avatarRouter.post(
  '/',
  readImageBody,
  asyncHandler(async (req, res) => {
    if (!hasAvatarStorage()) throw unavailable();
    const userId = currentUserId(req);

    const input = toBuffer(req.body);
    if (!input || input.length === 0) {
      throw badRequest('No image was uploaded.');
    }
    // Belt to the parser's braces: express.raw already enforced the limit, but
    // the number is the contract and it is cheap to state it twice.
    if (input.length > MAX_AVATAR_UPLOAD_BYTES) {
      throw new ApiError(413, 'too_large', `That image is larger than ${MAX_MB} MB. Try a smaller photo, or crop it first.`);
    }

    // Magic bytes. The client's Content-Type never enters this decision.
    const sniffed = sniffContentType(input);
    if (!ACCEPTED_AVATAR_UPLOAD_TYPES.includes(sniffed)) {
      throw badRequest(UNSUPPORTED_MESSAGE);
    }

    const normalised = await normaliseAvatar(input);

    const previous = await currentKey(userId);
    const key = newAvatarKey();
    const stored = await putAvatarObject(normalised, recorder(userId, previous), key);

    // The replaced object is now unreferenced. Reap it immediately; if this
    // fails it is an orphan, which is recoverable (avatar-store's reaper query)
    // rather than user-visible, so it must not fail the request.
    if (previous && previous !== stored.key) {
      const gone = await deleteAvatarObject(previous);
      if (!gone) console.warn('[avatar] orphaned previous object', previous);
    }

    userCache(res);
    res.status(201).json({ avatarUrl: avatarPublicUrl(stored.key), enabled: true });
  }),
);

// ── DELETE /avatar ───────────────────────────────────────────────────────────
// Clear the record first, then the bytes. That order is deliberate: if the
// second step fails we are left with an unreferenced object (reapable, and
// invisible to the user) rather than a row pointing at bytes that are gone
// (a broken image on every page).
avatarRouter.delete(
  '/',
  asyncHandler(async (req, res) => {
    if (!hasAvatarStorage()) throw unavailable();
    const userId = currentUserId(req);
    const previous = await currentKey(userId);

    await q1(
      `UPDATE user_profile
          SET avatar_path = NULL, avatar_updated_at = NULL,
              avatar_byte_size = NULL, avatar_content_type = NULL
        WHERE user_id = $1`,
      [userId],
    );

    if (previous) {
      const gone = await deleteAvatarObject(previous);
      if (!gone) console.warn('[avatar] orphaned object after removal', previous);
    }

    userCache(res);
    res.json({ avatarUrl: null, enabled: true });
  }),
);
