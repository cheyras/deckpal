import { USER_AGENT } from './config.js';
import { isCacheableImage, sniffContentType } from './sniff.js';
import { IMAGE_SOURCE_POLICY, checkUpstreamUrl, type UpstreamPolicy } from './upstream.js';

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
 * That is a CONTENT check. The DESTINATION check — which host we are willing to
 * talk to at all, on the first request and on every redirect hop — lives in
 * `upstream.ts`; read its header for why an image fetcher needs one. The two are
 * complementary rather than redundant: the sniff catches a soft-404 from a host
 * we trust, the allow-list catches a host we do not.
 *
 * No rate limiter: this path fires at most once per asset per lifetime (the next
 * request is a Storage hit), unlike the warmer which walks the whole catalog.
 */
export type SourceFetchResult =
  | { ok: true; bytes: Buffer; contentType: string; etag: string | null }
  | { ok: false; reason: string; httpStatus: number };

const MAX_BYTES = 8 * 1024 * 1024; // no card asset is anywhere near this

/**
 * Redirect hops we will follow. Neither allow-listed upstream is known to
 * redirect an asset URL at all — what TCGdex does instead is answer 200 with an
 * HTML soft-404, or move the asset to a sibling extension (the ladder below) —
 * so this is headroom, not a requirement.
 */
const MAX_REDIRECTS = 5;

const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);

export async function fetchSourceBytes(
  url: string,
  timeoutMs = 15_000,
  policy: UpstreamPolicy = IMAGE_SOURCE_POLICY,
): Promise<SourceFetchResult> {
  // ONE signal for the whole chain, created before the first check, so the
  // caller's budget still covers the redirect ladder and the DNS checks —
  // which is exactly what `redirect: 'follow'` used to give us for free.
  const signal = AbortSignal.timeout(timeoutMs);

  const first = await checkUpstreamUrl(url, policy, signal);
  if (!first.ok) return { ok: false, reason: `refused: ${first.reason}`, httpStatus: 0 };
  let target: URL = first.url;

  let res: Response;
  for (let hop = 0; ; hop++) {
    try {
      // `redirect: 'manual'` — we walk the hops ourselves so that EVERY hop's
      // host is re-checked. Letting undici follow would check only the URL we
      // asked for, which is the bypass this whole change exists to close.
      res = await fetch(target, {
        headers: { 'user-agent': USER_AGENT, accept: 'image/webp,image/*' },
        redirect: 'manual',
        signal,
      });
    } catch (err) {
      return { ok: false, reason: (err as Error).message, httpStatus: 0 };
    }
    if (!REDIRECT_STATUS.has(res.status)) break;

    const location = res.headers.get('location');
    await res.arrayBuffer().catch(() => undefined); // drain to free the socket
    if (!location) {
      return { ok: false, reason: `HTTP ${res.status} with no Location`, httpStatus: res.status };
    }
    if (hop >= MAX_REDIRECTS) {
      return { ok: false, reason: `more than ${MAX_REDIRECTS} redirects`, httpStatus: res.status };
    }
    let next: URL;
    try {
      next = new URL(location, target); // a relative Location header is legal
    } catch {
      return {
        ok: false,
        reason: `HTTP ${res.status} to an unparseable Location`,
        httpStatus: res.status,
      };
    }
    const hopCheck = await checkUpstreamUrl(next.href, policy, signal);
    if (!hopCheck.ok) {
      return {
        ok: false,
        reason: `refused redirect ${res.status}: ${hopCheck.reason}`,
        httpStatus: res.status,
      };
    }
    target = hopCheck.url;
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

/**
 * Extensions TCGdex may serve an asset under, in preference order.
 *
 * TCGdex asset URLs are a base path plus an extension you pick — the SPA says so
 * out loud (`assetUrl()` in apps/web ui.tsx: "TCGdex asset URLs omit the file
 * extension; append one"). Our stored `source_url`s all end in `.webp` because
 * that is what the warmer asked for, but the origin does not guarantee WebP for
 * every asset, and it re-encodes: the "Pitch Black" (me05) set logo now 404s as
 * `.webp` and returns 131 KB of PNG at the same base as `.png`. Verified
 * 2026-08-10.
 *
 * So a 404 on the recorded URL is not proof the asset is gone — only proof that
 * *that extension* is gone. Trying the siblings is the documented convention, not
 * a guess, and whichever one answers is the URL we record, because it is the one
 * we actually fetched.
 */
const EXTENSION_LADDER = ['.webp', '.png', '.jpg'] as const;

export interface LadderResult {
  result: SourceFetchResult;
  /** The URL that actually served the bytes (may differ from the one passed in). */
  url: string;
  /** True when a sibling extension answered after the given URL 404'd. */
  usedFallback: boolean;
}

/**
 * Fetch `url`, and on a hard miss retry the same base with the sibling
 * extensions. Only 404-class misses are retried — a network error or a 5xx says
 * nothing about the extension, so re-asking under another name is noise.
 */
export async function fetchSourceBytesWithExtensionFallback(
  url: string,
  timeoutMs = 15_000,
  policy: UpstreamPolicy = IMAGE_SOURCE_POLICY,
): Promise<LadderResult> {
  const first = await fetchSourceBytes(url, timeoutMs, policy);
  // A refused destination reports httpStatus 0, so a host we will not talk to
  // never gets asked three more times under a different extension.
  if (first.ok || first.httpStatus !== 404) return { result: first, url, usedFallback: false };

  const lower = url.toLowerCase();
  const ext = EXTENSION_LADDER.find((e) => lower.endsWith(e));
  if (!ext) return { result: first, url, usedFallback: false };

  const base = url.slice(0, url.length - ext.length);
  for (const alt of EXTENSION_LADDER) {
    if (alt === ext) continue;
    const altUrl = `${base}${alt}`;
    const res = await fetchSourceBytes(altUrl, timeoutMs, policy);
    if (res.ok) return { result: res, url: altUrl, usedFallback: true };
  }
  return { result: first, url, usedFallback: false };
}
