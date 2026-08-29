// Polite HTTP for TCGCSV / Cardmarket (DATA-LAYER §4.2, §7.4).
//
// - Custom User-Agent (TCGCSV blocks generic/missing UAs).
// - A single process-wide 100 ms floor between TCGCSV requests (their stated requirement).
// - 429/403 → throw RateLimited so the caller aborts the whole run (their 10-min throttle window).
// - No retries on 4xx other than a clean abort; a 5xx bubbles up and fails the run (sync_run='failed').

export const USER_AGENT = 'pokedex/1.0 (+cheyras@gmail.com)';
export const TCGCSV_MIN_INTERVAL_MS = 100;

export class RateLimited extends Error {
  constructor(public readonly status: number, url: string) {
    super(`rate-limited (${status}) on ${url} — backing off, aborting run per TCGCSV policy`);
    this.name = 'RateLimited';
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Shared monotonic gate so every TCGCSV call in the process honours the 100 ms floor,
// regardless of which loop issued it.
let nextAllowedAt = 0;
async function throttle(minIntervalMs: number): Promise<void> {
  const now = Date.now();
  if (now < nextAllowedAt) await sleep(nextAllowedAt - now);
  nextAllowedAt = Date.now() + minIntervalMs;
}

export interface FetchOpts {
  minIntervalMs?: number; // 0 to skip the shared gate (e.g. the single Cardmarket request)
  timeoutMs?: number;
}

async function politeFetch(url: string, opts: FetchOpts = {}): Promise<Response> {
  const { minIntervalMs = TCGCSV_MIN_INTERVAL_MS, timeoutMs = 30_000 } = opts;
  if (minIntervalMs > 0) await throttle(minIntervalMs);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: ctrl.signal,
    });
    if (res.status === 429 || res.status === 403) throw new RateLimited(res.status, url);
    if (!res.ok) throw new Error(`HTTP ${res.status} on ${url}`);
    return res;
  } finally {
    clearTimeout(t);
  }
}

/**
 * A BINARY body, for the daily price archives (`prices-YYYY-MM-DD.ppmd.7z`).
 *
 * Goes through the same gate as every other TCGCSV call rather than calling
 * `fetch` directly, and that is not tidiness: TCGCSV answers **401** to a
 * generic or missing User-Agent, which is exactly what a bare `fetch` sends.
 * The first draft of `archive.ts` did call `fetch` directly and every request
 * came back 401 — a scheduled 730-day replay would have failed on day one,
 * reporting "no archive published" for a file that is plainly there.
 *
 * Returns `null` for 404 instead of throwing, because TCGCSV has not published
 * every historical date and a gap is a fact the caller reports rather than an
 * error that should abandon the other 729 days.
 */
export async function fetchBinary(url: string, opts: FetchOpts = {}): Promise<Buffer | null> {
  const { minIntervalMs = TCGCSV_MIN_INTERVAL_MS, timeoutMs = 120_000 } = opts;
  if (minIntervalMs > 0) await throttle(minIntervalMs);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/octet-stream' },
      signal: ctrl.signal,
    });
    if (res.status === 404) return null;
    if (res.status === 429 || res.status === 403) throw new RateLimited(res.status, url);
    if (!res.ok) throw new Error(`HTTP ${res.status} on ${url}`);
    return Buffer.from(await res.arrayBuffer());
  } finally {
    clearTimeout(t);
  }
}

export async function fetchText(url: string, opts?: FetchOpts): Promise<string> {
  const res = await politeFetch(url, opts);
  return res.text();
}

export async function fetchJson<T>(url: string, opts?: FetchOpts): Promise<T> {
  const res = await politeFetch(url, opts);
  return res.json() as Promise<T>;
}
