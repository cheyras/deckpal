import { MAX_CONCURRENCY, RATE_PER_SEC, USER_AGENT } from './config.js';

/**
 * Polite fetcher for assets.tcgdex.net (DATA-LAYER §7.4):
 *   ≤5 req/s, ≤2 concurrent, sends If-None-Match, and — critically — validates
 *   `content-type`, because the origin returns HTTP 200 + a 299-byte text/html
 *   error page for unsupported extensions (.avif/.tiff). Trusting the status code
 *   alone caches garbage (ARCHITECTURE §7 trap; DATA-LAYER §3.4).
 */

// Token-bucket-ish gate: at most RATE_PER_SEC starts per rolling second, and at
// most MAX_CONCURRENCY in flight.
let inFlight = 0;
let recentStarts: number[] = [];
const waiters: Array<() => void> = [];

function tryRelease(): void {
  while (waiters.length > 0) {
    const now = Date.now();
    recentStarts = recentStarts.filter((t) => now - t < 1000);
    if (inFlight < MAX_CONCURRENCY && recentStarts.length < RATE_PER_SEC) {
      inFlight++;
      recentStarts.push(now);
      const w = waiters.shift()!;
      w();
    } else {
      const wait =
        recentStarts.length >= RATE_PER_SEC ? 1000 - (now - recentStarts[0]!) + 5 : 25;
      setTimeout(tryRelease, Math.max(5, wait));
      return;
    }
  }
}

function acquire(): Promise<void> {
  return new Promise((resolve) => {
    waiters.push(resolve);
    tryRelease();
  });
}

function release(): void {
  inFlight--;
  tryRelease();
}

export type FetchResult =
  | { status: 'ok'; body: Buffer; contentType: string; etag: string | null }
  | { status: 'not-modified' }
  | { status: 'rejected'; reason: string; httpStatus: number; contentType: string | null }
  | { status: 'error'; reason: string; httpStatus: number };

/**
 * Fetch a WebP asset. `expectedType` defaults to image/webp; a body whose
 * content-type does not start with it is REJECTED (the soft-404 trap), never written.
 */
export async function fetchWebp(
  url: string,
  etag: string | null,
  expectedType = 'image/webp',
): Promise<FetchResult> {
  await acquire();
  try {
    const headers: Record<string, string> = { 'user-agent': USER_AGENT };
    if (etag) headers['if-none-match'] = etag;

    const res = await fetch(url, { headers });
    const ct = res.headers.get('content-type');

    if (res.status === 304) return { status: 'not-modified' };
    if (!res.ok) {
      // drain to free the socket
      await res.arrayBuffer().catch(() => undefined);
      return { status: 'error', reason: `HTTP ${res.status}`, httpStatus: res.status };
    }
    if (!ct || !ct.toLowerCase().startsWith(expectedType)) {
      await res.arrayBuffer().catch(() => undefined);
      return {
        status: 'rejected',
        reason: `content-type '${ct ?? '(none)'}' is not ${expectedType} (soft-404 trap)`,
        httpStatus: res.status,
        contentType: ct,
      };
    }
    const body = Buffer.from(await res.arrayBuffer());
    // Defence in depth: WebP files start with 'RIFF'…'WEBP'. Reject if not.
    if (body.length < 12 || body.toString('ascii', 0, 4) !== 'RIFF' || body.toString('ascii', 8, 12) !== 'WEBP') {
      return {
        status: 'rejected',
        reason: `body is not a RIFF/WEBP container (${body.length} bytes)`,
        httpStatus: res.status,
        contentType: ct,
      };
    }
    return { status: 'ok', body, contentType: ct, etag: res.headers.get('etag') };
  } catch (err) {
    return { status: 'error', reason: (err as Error).message, httpStatus: 0 };
  } finally {
    release();
  }
}
