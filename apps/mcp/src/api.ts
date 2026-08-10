import { loadEnv } from '@deckscout/db';

/**
 * Thin fetch client for deckscout-api (SPEC §3: writes and all deck/list
 * operations go through the REST API so the write logic stays single-sourced).
 * JSON in/out. The API's `{ error: { code, message } }` envelope on non-2xx is
 * surfaced as a thrown Error carrying that message. One retry on ECONNREFUSED
 * after 500 ms; no retries on 4xx/5xx.
 *
 * An instance carries its own base URL and (in the multi-user cloud path) the
 * caller's `Authorization` header, so two concurrent MCP requests can never
 * borrow each other's identity: the API resolves the personal access token on
 * every call and answers with that user's rows only.
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

export interface Api {
  /** GET a JSON payload. `path` starts with '/', e.g. '/health'. */
  get(path: string): Promise<unknown>;
  /** Send a JSON body (POST/PATCH/PUT/DELETE …). */
  send(method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<unknown>;
  /** The base URL this client talks to (for diagnostics; carries no secret). */
  base: string;
}

/**
 * Build an API client.
 *
 * @param base   Base URL, e.g. `https://deckscout.io/api`.
 * @param bearer Raw credential for the `Authorization: Bearer …` header. Omit
 *               on self-host, where the reverse proxy is the auth boundary.
 *               NEVER logged — not in errors, not in diagnostics.
 */
export function makeApi(base: string, bearer?: string): Api {
  const authHeader: Record<string, string> = bearer ? { authorization: `Bearer ${bearer}` } : {};

  async function request(method: string, path: string, body?: unknown): Promise<unknown> {
    const url = base + path;
    const init: RequestInit = {
      method,
      headers: {
        ...authHeader,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    };
    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (err) {
      if (!isConnRefused(err)) throw err;
      await sleep(500); // deckscout-api may be mid-restart; one retry only.
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

  return {
    get: (path) => request('GET', path),
    send: (method, path, body) => request(method, path, body),
    base,
  };
}
