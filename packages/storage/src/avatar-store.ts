import { randomBytes } from 'node:crypto';
import { hasStorageEnv, storageEnv } from './config.js';
import { sniffContentType } from './sniff.js';

/**
 * avatar-store.ts — the choke point for USER-UPLOADED profile photos.
 *
 * The sibling of `put-asset.ts`, for the other kind of byte this project
 * stores. `put-asset.ts` owns catalog art we FETCHED from an upstream URL;
 * this owns images a signed-in human HANDED us. They share the record-then-
 * publish ordering and the "no byte without a record" rule, and they share
 * nothing else — different bucket, different table, different lifetime.
 *
 * ── B1 in this file ────────────────────────────────────────────────────────
 * Contract B1 (AGENTS.md) requires a provenance record for every stored byte,
 * written through a choke point. The avatar's record is its `user_profile` row
 * (migration 029), not an `image_asset` row, and the reasoning is written out
 * at length at the top of that migration. In one line: an avatar's source is
 * neither a URL nor unknown — it is "this user, at this time" — and
 * `image_asset` is world-readable, LRU-evictable, and reconciled against a
 * different bucket.
 *
 * This is a documented exception in the same shape as `putUnmanifestedObject`
 * (sprites), not a bypass. It is enforced the same way, too: {@link
 * putAvatarObject} cannot be called without an {@link AvatarRecorder}, the
 * recorder runs BEFORE the bytes are published, and a failed publish rolls the
 * record back. Bytes with nothing pointing at them are unrepresentable here
 * except as a crash between two awaits — and that residue is reapable by
 * construction (see {@link listAvatarObjectKeys}).
 *
 * ── Bucket ─────────────────────────────────────────────────────────────────
 * `user-avatars`, PUBLIC, `allowed_mime_types: ['image/webp']`,
 * `file_size_limit: 1 MiB`. Public because a profile photo is meant to be seen
 * (and because a private bucket would put a signing round trip in front of the
 * header chip on every page load); the MIME allowlist and size limit are a
 * server-side backstop underneath this module's own validation, so even a bug
 * here cannot land a non-WebP or an oversized object.
 *
 * ── Key (contract B6) ──────────────────────────────────────────────────────
 * `<32 lowercase hex>.webp`, flat at the bucket root. Random, NOT derived from
 * the user id: in a public bucket a derived key could be probed by iterating
 * account ids. It is not a secret either — `user_profile` is world-readable by
 * design — it just refuses to be the thing that leaks the mapping. Because it
 * is fresh on every upload, a replacement also lands on a new URL, which is how
 * a replaced avatar beats the immutable CDN header without a cache-busting
 * query string.
 */

/** Bucket holding user profile photos. Overridable for forks; never a secret. */
export const DEFAULT_AVATAR_BUCKET = 'user-avatars';

/** Stored avatars are square WebP at this edge length. */
export const AVATAR_EDGE = 256;

/**
 * Largest upload we will read off the wire, in bytes.
 *
 * Vercel caps a serverless function's request body at 4.5 MB and answers with
 * its own error page before our handler ever runs — an error we could neither
 * shape nor explain. 3 MB keeps the rejection ours, with a message that names
 * the limit. It is generous for the input: what we STORE is a 256×256 WebP,
 * typically 10–30 KB.
 */
export const MAX_AVATAR_UPLOAD_BYTES = 3 * 1024 * 1024;

/**
 * Upload formats we accept — decided by MAGIC BYTES, never by the client's
 * declared content-type or the file extension. GIF and SVG are deliberately
 * absent: an animated avatar is not in scope, and SVG is a script-execution
 * vector we have no reason to accept.
 */
export const ACCEPTED_AVATAR_UPLOAD_TYPES: readonly string[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
];

/** The facts about one stored avatar object — what the record must carry. */
export interface StoredAvatar {
  /** Object key inside the avatar bucket, e.g. `9f3c…a1.webp`. */
  key: string;
  byteSize: number;
  /** Sniffed from the stored bytes, not assumed. Always `image/webp` in practice. */
  contentType: string;
  /** ISO timestamp the object was published. */
  storedAt: string;
}

/**
 * The B1 obligation, expressed as an argument you cannot omit.
 *
 * `record` writes the row that makes the object attributable; it runs BEFORE
 * the bytes are published. `revert` undoes it if publishing then fails, so a
 * failed upload does not leave a row pointing at an object that never existed.
 */
export interface AvatarRecorder {
  record(avatar: StoredAvatar): Promise<void>;
  revert(avatar: StoredAvatar): Promise<void>;
}

export function avatarBucket(): string {
  return process.env.USER_AVATAR_BUCKET ?? DEFAULT_AVATAR_BUCKET;
}

/** Is the object store configured at all? Self-host answers false. */
export function hasAvatarStorage(): boolean {
  return hasStorageEnv();
}

const AVATAR_KEY_RE = /^[0-9a-f]{32}\.webp$/;

/** A fresh, unguessable object key. */
export function newAvatarKey(): string {
  return `${randomBytes(16).toString('hex')}.webp`;
}

/**
 * Does this string look like a key this module minted?
 *
 * Used before any key read out of the database reaches a URL or a DELETE — the
 * column is plain TEXT, and "it came from our own table" is an assumption, not
 * a guarantee.
 */
export function isAvatarKey(key: string): boolean {
  return AVATAR_KEY_RE.test(key);
}

export function avatarPublicUrl(key: string): string {
  if (!isAvatarKey(key)) {
    throw new Error(`[storage] refusing to build a URL for a malformed avatar key: ${JSON.stringify(key)}`);
  }
  const { supabaseUrl } = storageEnv();
  return `${supabaseUrl}/storage/v1/object/public/${avatarBucket()}/${key}`;
}

function authHeaders(): Record<string, string> {
  const { serviceKey } = storageEnv();
  return { apikey: serviceKey, authorization: `Bearer ${serviceKey}` };
}

/**
 * Publish one avatar, recording it first.
 *
 * `bytes` must already be normalised — square WebP, produced by the caller's
 * re-encode step. This function re-sniffs them anyway: the recorded
 * `content_type` has to describe what was actually stored, and "the caller
 * promised" is how the card-art cache ended up with PNG bytes named `.webp`
 * (see sniff.ts).
 *
 * Ordering, and why: record → upload → (on failure) revert. Bytes are never
 * published without a row behind them. The reverse order would leave an
 * unattributable object every time a write failed midway.
 */
export async function putAvatarObject(
  bytes: Uint8Array,
  recorder: AvatarRecorder,
  key: string = newAvatarKey(),
  timeoutMs = 15_000,
): Promise<StoredAvatar> {
  if (!bytes || bytes.length === 0) {
    throw new Error('[storage] refusing to store 0 bytes as an avatar');
  }
  if (!isAvatarKey(key)) {
    throw new Error(`[storage] malformed avatar key: ${JSON.stringify(key)}`);
  }
  const contentType = sniffContentType(bytes);
  if (contentType !== 'image/webp') {
    // Not a client error — the caller's normalise step is broken. Loud, because
    // the bucket's MIME allowlist would reject it anyway and the resulting
    // Storage error would be far harder to read.
    throw new Error(`[storage] avatar bytes must be WebP after normalisation, sniffed ${contentType}`);
  }

  const avatar: StoredAvatar = {
    key,
    byteSize: bytes.length,
    contentType,
    storedAt: new Date().toISOString(),
  };

  await recorder.record(avatar);

  let published = false;
  try {
    // Everything after the record lives inside this try, including reading the
    // credentials. It did not, once: `storageEnv()` sat between the record and
    // the try, so a deployment with no Supabase configured wrote the row and
    // then threw past the rollback, leaving a row pointing at an object that
    // was never published. Caught by the ordering test in __tests__.
    const { supabaseUrl } = storageEnv();
    const url = `${supabaseUrl}/storage/v1/object/${avatarBucket()}/${key}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        ...authHeaders(),
        'content-type': contentType,
        // Immutable is honest here precisely BECAUSE the key is random: these
        // exact bytes never change, and a replacement gets a different key.
        'cache-control': 'public, max-age=31536000, immutable',
        'x-upsert': 'true',
      },
      body: bytes as unknown as BodyInit,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`[storage] avatar upload failed: HTTP ${res.status} ${body.slice(0, 200)}`);
    }
    published = true;
  } finally {
    if (!published) {
      // Best-effort: if the rollback itself fails the row survives pointing at
      // nothing, which renders as the default letter treatment — visible, and
      // repaired by the next upload — rather than an unattributable object.
      await recorder.revert(avatar).catch((err: unknown) => {
        console.error('[storage] avatar record rollback failed for', key, (err as Error).message);
      });
    }
  }

  return avatar;
}

/** Remove an avatar object. Idempotent enough: a missing object is not an error. */
export async function deleteAvatarObject(key: string, timeoutMs = 10_000): Promise<boolean> {
  if (!isAvatarKey(key)) return false;
  const { supabaseUrl } = storageEnv();
  try {
    const res = await fetch(`${supabaseUrl}/storage/v1/object/${avatarBucket()}/${key}`, {
      method: 'DELETE',
      headers: authHeaders(),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Every object key in the avatar bucket.
 *
 * The reaper's left-hand side: anything here that is not in
 * `SELECT avatar_path FROM user_profile WHERE avatar_path IS NOT NULL` is an
 * orphan. Orphans are expected — deleting an account cascades the profile row
 * away and Supabase Storage has no foreign keys — so this is the supported way
 * to find them rather than an emergency tool.
 */
export async function listAvatarObjectKeys(timeoutMs = 20_000): Promise<string[]> {
  const { supabaseUrl, serviceKey } = storageEnv();
  const PAGE = 1000;
  const keys: string[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const res = await fetch(`${supabaseUrl}/storage/v1/object/list/${avatarBucket()}`, {
      method: 'POST',
      headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ prefix: '', limit: PAGE, offset, sortBy: { column: 'name', order: 'asc' } }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`[storage] avatar list failed: HTTP ${res.status}`);
    const page = (await res.json()) as Array<{ name: string; id: string | null }>;
    for (const e of page) {
      if (e.id !== null) keys.push(e.name);
    }
    if (page.length < PAGE) break;
  }
  return keys;
}
