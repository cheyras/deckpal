/**
 * Polite read-only HTTP for the maintenance scripts: GET only, one request at a time with a pause between
 * them, retries with back-off on 429/5xx/network errors, and an optional on-disk cache so a re-run while
 * developing a script does not hit the network again.
 *
 *   SIM_FETCH_CACHE=<dir>   cache GET bodies under <dir> (never set in CI; never needed for a real refresh)
 *   SIM_FETCH_DELAY_MS=<n>  pause between requests (default 150)
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DELAY = Number(process.env.SIM_FETCH_DELAY_MS ?? 150);
const CACHE = process.env.SIM_FETCH_CACHE;
let last = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function getText(url: string, opts: { retries?: number; timeoutMs?: number } = {}): Promise<string> {
  const file = CACHE ? join(CACHE, createHash('sha1').update(url).digest('hex') + '.txt') : null;
  if (file && existsSync(file)) return readFileSync(file, 'utf8');
  const retries = opts.retries ?? 4;
  let err: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const wait = last + DELAY - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(opts.timeoutMs ?? 90_000), headers: { 'user-agent': 'deckpal-sim-maintenance/1 (read-only)' } });
      if (res.ok) {
        const body = await res.text();
        if (file) {
          mkdirSync(CACHE!, { recursive: true });
          writeFileSync(file, body);
        }
        return body;
      }
      err = new Error(`HTTP ${res.status} for ${url}`);
      if (res.status !== 429 && res.status < 500) break; // a 404 will not get better
    } catch (e) {
      err = e;
    }
    await sleep(1000 * 2 ** attempt);
  }
  throw new Error(`GET ${url} failed: ${(err as Error)?.message ?? err}`);
}

export async function getJson<T>(url: string, opts?: { retries?: number; timeoutMs?: number }): Promise<T> {
  return JSON.parse(await getText(url, opts)) as T;
}
