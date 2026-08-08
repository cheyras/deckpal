import { loadEnv } from '@deckscout/db';

/**
 * Thin fetch client for deckscout-api (SPEC §3: writes and all deck/list
 * operations go through the REST API on :3700 so the write logic stays
 * single-sourced). JSON in/out. The API's `{ error: { code, message } }`
 * envelope on non-2xx is surfaced as a thrown Error carrying that message.
 * One retry on ECONNREFUSED after 500 ms; no retries on 4xx/5xx.
 */

const DEFAULT_BASE = 'http://127.0.0.1:3700/deckscout/api';

export function apiBase(): string {
  loadEnv();
  return process.env.DECKSCOUT_API_BASE ?? DEFAULT_BASE;
}

function isConnRefused(err: unknown): boolean {
  if (err === null || typeof err !== 'object') return false;
  const anyErr = err as { code?: string; cause?: unknown; errors?: unknown[] };
  if (anyErr.code === 'ECONNREFUSED') return true;
  if (Array.isArray(anyErr.errors) && anyErr.errors.some(isConnRefused)) return true;
  return anyErr.cause !== undefined && isConnRefused(anyErr.cause);
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface ApiErrorBody {
  error?: { code?: string; message?: string };
}

async function request(method: string, path: string, body?: unknown): Promise<unknown> {
  const url = apiBase() + path;
  const init: RequestInit = {
    method,
    ...(body !== undefined
      ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
      : {}),
  };
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    if (!isConnRefused(err)) throw err;
    await sleep(500); // deckscout-api may be mid-restart under pm2; one retry only.
    res = await fetch(url, init);
  }
  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  if (!res.ok) {
    const envelope = (json ?? {}) as ApiErrorBody;
    const message = envelope.error?.message ?? `deckscout-api ${method} ${path} → ${res.status}`;
    throw new Error(message);
  }
  return json;
}

/** GET a JSON payload from deckscout-api. `path` starts with '/', e.g. '/health'. */
export function apiGet(path: string): Promise<unknown> {
  return request('GET', path);
}

/** Send a JSON body (POST/PATCH/DELETE …) to deckscout-api. */
export function apiSend(method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<unknown> {
  return request(method, path, body);
}
