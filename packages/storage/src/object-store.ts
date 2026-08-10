import { storageEnv } from './config.js';

/**
 * Supabase Storage access over its REST API — no SDK, no extra dependency, and
 * nothing that opens a socket at import time (this runs in a serverless function
 * whose cold start we pay for on every unwarmed asset).
 *
 * The bucket is PUBLIC, so reads are served straight off Supabase's CDN and the
 * function only ever answers a 302 pointing at it. Writes carry the service role.
 */

export function publicObjectUrl(objectPath: string): string {
  const { supabaseUrl, bucket } = storageEnv();
  // Each segment is already validated by parseImagePath ([A-Za-z0-9.-] only), so
  // encodeURI is belt-and-braces, not the security boundary.
  return `${supabaseUrl}/storage/v1/object/public/${bucket}/${encodeURI(objectPath)}`;
}

function authHeaders(): Record<string, string> {
  const { serviceKey } = storageEnv();
  return { apikey: serviceKey, authorization: `Bearer ${serviceKey}` };
}

/**
 * Does the object exist?
 *
 * HEAD against the PUBLIC endpoint: unauthenticated, CDN-accelerated, and
 * measured against this project — a missing object answers 400 (a JSON error),
 * an existing one 200. Verified 2026-08-09 that a miss is NOT negatively cached:
 * a GET immediately after an upload returns the bytes (cf-cache-status MISS then
 * HIT), so a cold fill is visible to the very next request.
 */
export async function objectExists(objectPath: string, timeoutMs = 5_000): Promise<boolean> {
  try {
    const res = await fetch(publicObjectUrl(objectPath), {
      method: 'HEAD',
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.status === 200;
  } catch {
    return false; // treat an unreachable check as a miss; the fill path is idempotent
  }
}

export interface UploadResult {
  ok: boolean;
  status: number;
  error?: string;
}

/**
 * Upload bytes, overwriting any existing object (`x-upsert`).
 *
 * Idempotent by construction, which is the whole concurrency story: two requests
 * racing on the same cold asset fetch the same URL and write byte-identical
 * content, so last-writer-wins is indistinguishable from first-writer-wins. No
 * lock, no partial object (Supabase publishes an upload atomically).
 */
export async function uploadObject(
  objectPath: string,
  bytes: Uint8Array,
  contentType: string,
  cacheControl = 'max-age=31536000',
  timeoutMs = 20_000,
): Promise<UploadResult> {
  const { supabaseUrl, bucket } = storageEnv();
  const url = `${supabaseUrl}/storage/v1/object/${bucket}/${encodeURI(objectPath)}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        ...authHeaders(),
        'content-type': contentType,
        'cache-control': cacheControl,
        'x-upsert': 'true',
      },
      body: bytes as unknown as BodyInit,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.ok) return { ok: true, status: res.status };
    const body = await res.text().catch(() => '');
    return { ok: false, status: res.status, error: body.slice(0, 200) };
  } catch (err) {
    return { ok: false, status: 0, error: (err as Error).message };
  }
}

/** Remove an object. Used only to roll back a torn write. */
export async function deleteObject(objectPath: string, timeoutMs = 10_000): Promise<boolean> {
  const { supabaseUrl, bucket } = storageEnv();
  try {
    const res = await fetch(`${supabaseUrl}/storage/v1/object/${bucket}/${encodeURI(objectPath)}`, {
      method: 'DELETE',
      headers: authHeaders(),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok;
  } catch {
    return false;
  }
}
