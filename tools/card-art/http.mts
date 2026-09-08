/**
 * Shared politeness + retry layer for the card-art re-sourcing tools.
 *
 * UNTRACKED, on purpose (Holo 2c PREP). Nothing here is imported by the app.
 *
 * Budget (matches apps/images/src/config.ts RATE_PER_SEC / MAX_CONCURRENCY, and
 * the stricter of the two upstreams' own published limits):
 *   - global: <= 5 requests/second, <= 2 concurrent
 *   - api.pokemontcg.io: additionally <= 30 requests/minute, because the free,
 *     unauthenticated tier is documented at 1,000/day and 30/minute. Set
 *     POKEMONTCG_IO_API_KEY in the environment to lift the daily ceiling to
 *     20,000; the key is sent as `X-Api-Key` and is NEVER logged.
 *
 * Both upstreams answered `502 error code: 502` intermittently during the
 * 2026-08-31 probe run (measured: 3 of 5 sequential requests to
 * api.pokemontcg.io, and one truncated body with HTTP 200). A truncated body is
 * the nastier of the two because the status code is fine — so every JSON read
 * here parses before it counts as success, and a parse failure is retried like a
 * 5xx rather than thrown.
 */

const RATE_PER_SEC = 5;
const MAX_CONCURRENCY = 2;
const PTCGIO_PER_MIN = 30;

export const USER_AGENT = 'deckpal-card-art-resource/1.0 (+cheyras@gmail.com)';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

let inFlight = 0;
let recentGlobal: number[] = [];
let recentPtcgio: number[] = [];

function prune(list: number[], windowMs: number): number[] {
  const cutoff = Date.now() - windowMs;
  return list.filter((t) => t > cutoff);
}

/** Block until this request fits inside every budget, then claim a slot. */
async function acquire(host: string): Promise<void> {
  for (;;) {
    recentGlobal = prune(recentGlobal, 1_000);
    recentPtcgio = prune(recentPtcgio, 60_000);
    // The 30/minute ceiling is documented for the JSON **API**. `images.pokemontcg.io`
    // is a static asset CDN and is not covered by it, so image downloads are held
    // only to the global 5/s + 2-concurrent budget — otherwise re-sourcing ~1,850
    // assets would take an hour of wall clock for no politeness gain.
    const isPtcgio = host === 'api.pokemontcg.io';
    const ok =
      inFlight < MAX_CONCURRENCY &&
      recentGlobal.length < RATE_PER_SEC &&
      (!isPtcgio || recentPtcgio.length < PTCGIO_PER_MIN);
    if (ok) {
      inFlight++;
      const now = Date.now();
      recentGlobal.push(now);
      if (isPtcgio) recentPtcgio.push(now);
      return;
    }
    await sleep(120);
  }
}

function release(): void {
  inFlight--;
}

/**
 * Hand a per-minute slot back after a request that never reached the API.
 *
 * A `502` from the CDN in 190 ms, or a `500` with a zero-byte body, is not a
 * request the origin served — a successful call takes ~3 s. Charging those to a
 * 30/minute budget would spend most of the budget on the upstream's own faults
 * and turn a 20-minute build into a 3-hour one. Successful responses, 4xx, and
 * anything with a body are still charged.
 */
function refundMinuteSlot(host: string): void {
  if (host !== 'api.pokemontcg.io') return;
  recentPtcgio.pop();
}

export interface RawResponse {
  ok: boolean;
  status: number;
  headers: Headers;
  bytes: Buffer;
  url: string;
}

/**
 * One HTTP request, budgeted. `method` 'HEAD' returns an empty body by design.
 * Never throws on a transport error — the caller decides whether to retry.
 */
export async function rawRequest(
  url: string,
  method: 'GET' | 'HEAD' = 'GET',
  timeoutMs = 20_000,
): Promise<RawResponse> {
  const host = new URL(url).hostname;
  await acquire(host);
  try {
    const headers: Record<string, string> = {
      'user-agent': USER_AGENT,
      accept: method === 'HEAD' ? '*/*' : 'application/json, image/*;q=0.9, */*;q=0.5',
    };
    const key = process.env.POKEMONTCG_IO_API_KEY;
    if (key && host === 'api.pokemontcg.io') headers['x-api-key'] = key;
    const res = await fetch(url, {
      method,
      headers,
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
    const bytes =
      method === 'HEAD' ? Buffer.alloc(0) : Buffer.from(await res.arrayBuffer());
    if (res.status >= 500) refundMinuteSlot(host);
    return { ok: res.ok, status: res.status, headers: res.headers, bytes, url: res.url || url };
  } catch (err) {
    refundMinuteSlot(host);
    return {
      ok: false,
      status: 0,
      headers: new Headers(),
      bytes: Buffer.from(String((err as Error).message)),
      url,
    };
  } finally {
    release();
  }
}

export interface RetryOptions {
  attempts?: number;
  timeoutMs?: number;
  /** Log line prefix; set to null to stay quiet. */
  label?: string | null;
}

/**
 * MEASURED 2026-08-31: `api.pokemontcg.io` fails roughly one request in three,
 * at random, with `502` (a 6 KB Cloudflare page), `500` (a 46-byte body or an
 * empty one), or a truncated `200`. Twelve consecutive identical requests
 * produced 8 × 200, 2 × 502, 2 × 500. The failures are not correlated with the
 * request — same URL, same headers, same second — so the answer is a long retry
 * ladder, not a header change. Ten attempts with the backoff below spans ~4
 * minutes worst case; a five-attempt ladder was measured failing outright.
 */
const DEFAULT_ATTEMPTS = 40;

/**
 * A two-phase ladder, because pokemontcg.io fails two different ways.
 *
 * MEASURED 2026-08-31. A `500`/`502` comes back in ~150-200 ms while a success
 * takes ~3 s, so the ordinary failure is not congestion — the server is not
 * busy, it is intermittently broken, and backing off 30 s teaches it nothing.
 * Twelve identical requests produced 8 × 200, 2 × 502, 2 × 500. But the failures
 * also CLUSTER: a run with an exponential 10-attempt ladder died on `set.id:ex3`
 * after sixteen consecutive failures, and the same URL answered 5-of-6 a minute
 * later. A ~30% independent failure rate cannot produce sixteen in a row, so the
 * upstream goes fully dark for stretches of a minute or two.
 *
 * So: retry FAST while it is probably a one-off (attempts 1-8, sub-2 s), then
 * settle into a slow poll that can wait out a dark stretch without hammering
 * (5 s, then 15 s), for a worst case of ~6 minutes on one request. The first
 * build attempt spent ~75 s per set on an exponential-to-30 s ladder and would
 * have taken 3.5 hours for the catalog; this one costs nothing extra when the
 * upstream is healthy.
 */
function backoffMs(attempt: number): number {
  const base = attempt <= 8 ? 250 * attempt : attempt <= 20 ? 5_000 : 15_000;
  return base + Math.floor(Math.random() * 400);
}

/** Retry ladder: 429/5xx/transport errors only. Exponential backoff + jitter. */
export async function requestWithRetries(
  url: string,
  method: 'GET' | 'HEAD' = 'GET',
  opts: RetryOptions = {},
): Promise<RawResponse> {
  const attempts = opts.attempts ?? DEFAULT_ATTEMPTS;
  let last: RawResponse | null = null;
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await sleep(backoffMs(i));
    const res = await rawRequest(url, method, opts.timeoutMs);
    last = res;
    if (res.ok) return res;
    // A real rejection says the same thing however many times you ask.
    if (res.status !== 0 && res.status !== 429 && res.status < 500) return res;
    if (opts.label !== null) {
      console.warn(
        `[card-art] retry ${i + 1}/${attempts} ${opts.label ?? ''} ${url} -> HTTP ${res.status}`,
      );
    }
  }
  return last!;
}

/**
 * GET + JSON.parse, retried. A truncated 200 (measured on both upstreams) fails
 * the parse and is retried exactly like a 5xx, which is the whole reason this
 * wrapper exists instead of `await res.json()` at the call sites.
 */
export async function getJson<T>(url: string, opts: RetryOptions = {}): Promise<T> {
  const attempts = opts.attempts ?? DEFAULT_ATTEMPTS;
  let lastReason = 'no attempt made';
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await sleep(backoffMs(i));
    const res = await rawRequest(url, 'GET', opts.timeoutMs);
    if (!res.ok) {
      lastReason = `HTTP ${res.status}`;
      if (res.status !== 0 && res.status !== 429 && res.status < 500) break;
      continue;
    }
    try {
      return JSON.parse(res.bytes.toString('utf8')) as T;
    } catch (err) {
      lastReason = `unparseable body (${res.bytes.length} bytes): ${(err as Error).message}`;
    }
    if (opts.label !== null) {
      console.warn(`[card-art] retry ${i + 1}/${attempts} ${url} -> ${lastReason}`);
    }
  }
  throw new Error(`[card-art] GET ${url} failed after ${attempts} attempts: ${lastReason}`);
}
