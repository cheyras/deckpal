import { USER_AGENT } from './config.js';
import { isCacheableImage, sniffContentType } from './sniff.js';

/**
 * One-shot upstream fetch for a cold asset.
 *
 * The trap this guards (ARCHITECTURE §7, DATA-LAYER §3.4, and apps/images
 * fetch.ts): assets.tcgdex.net answers HTTP **200 with a ~299-byte text/html
 * error page** for assets it does not have. Trusting the status code caches
 * garbage — and here it would cache garbage that then serves as an image
 * forever. So the bytes have to prove themselves: an image content-type AND
 * recognised magic bytes, or we do not cache them.
 *
 * No rate limiter: this path fires at most once per asset per lifetime (the next
 * request is a Storage hit), unlike the warmer which walks the whole catalog.
 */
export type SourceFetchResult =
  | { ok: true; bytes: Buffer; contentType: string; etag: string | null }
  | { ok: false; reason: string; httpStatus: number };

const MAX_BYTES = 8 * 1024 * 1024; // no card asset is anywhere near this

export async function fetchSourceBytes(
  url: string,
  timeoutMs = 15_000,
): Promise<SourceFetchResult> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { 'user-agent': USER_AGENT, accept: 'image/webp,image/*' },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    return { ok: false, reason: (err as Error).message, httpStatus: 0 };
  }

  if (!res.ok) {
    await res.arrayBuffer().catch(() => undefined); // drain to free the socket
    return { ok: false, reason: `HTTP ${res.status}`, httpStatus: res.status };
  }

  const declared = (res.headers.get('content-type') ?? '').toLowerCase();
  if (!declared.startsWith('image/')) {
    await res.arrayBuffer().catch(() => undefined);
    return {
      ok: false,
      reason: `content-type '${declared || '(none)'}' is not an image (soft-404 trap)`,
      httpStatus: res.status,
    };
  }

  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length === 0) return { ok: false, reason: 'empty body', httpStatus: res.status };
  if (bytes.length > MAX_BYTES) {
    return { ok: false, reason: `body too large (${bytes.length} bytes)`, httpStatus: res.status };
  }

  // Magic bytes are the real check — the declared type is only a first filter.
  const sniffed = sniffContentType(bytes);
  if (!isCacheableImage(sniffed)) {
    return {
      ok: false,
      reason: `body is not a recognised raster image (sniffed ${sniffed}, ${bytes.length} bytes)`,
      httpStatus: res.status,
    };
  }

  return { ok: true, bytes, contentType: sniffed, etag: res.headers.get('etag') };
}
