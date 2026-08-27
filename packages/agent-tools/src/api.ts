import { loadEnv } from '@deckpal/db';

/**
 * Thin fetch client for deckpal-api (SPEC §3: writes and all deck/list
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

const DEFAULT_BASE = 'http://127.0.0.1:3700/deckpal/api';

export function apiBase(): string {
  loadEnv();
  return process.env.DECKPAL_API_BASE ?? DEFAULT_BASE;
}

/**
 * Compose `base` + `path` into a URL that provably still points at deckpal-api.
 *
 * WHY THIS IS NOT `base + path` (CodeQL `js/request-forgery` #56/#57). `base` is
 * deployment configuration, but `path` is assembled at the tool call sites out of
 * ids that came from a MODEL, which got them from a user. Plain concatenation
 * means an id containing `?` or `#` stops being a path segment and becomes a
 * query string or a fragment on an INTERNAL, ALREADY-AUTHENTICATED call —
 * `read_deck('x?deleted=true')` is not the request the tool believed it was
 * making. An id containing `../` is worse: it re-points the call at a different
 * endpoint entirely.
 *
 * Host redirection was never reachable here (a `path` beginning `https://` makes
 * `base + path` a malformed URL, not a hostname swap), so this is parameter
 * injection rather than SSRF — but the fix for both is the same one CodeQL is
 * asking for: resolve the URL properly, then check the result.
 *
 * Three guarantees, in order:
 *   1. `path` must be a single-slash absolute path. `//evil.example` is a
 *      protocol-relative URL to `new URL()`, so it is refused outright rather
 *      than normalised — nothing here legitimately produces one.
 *   2. resolution happens against the base's own directory, so the deployment's
 *      path prefix (`/deckpal/api`) survives. `new URL('/decks', base)` on its
 *      own would silently drop it and call the wrong endpoint.
 *   3. the RESULT is checked: same scheme, same host, still underneath the base's
 *      path. That is what catches a `..` escape, and it is the local,
 *      terminating barrier the analyser could not previously find.
 *
 * The call sites percent-encode their ids as well (`encodeURIComponent`), so a
 * hostile id is a weird 404 rather than a different request. Both layers, on
 * purpose: encoding is the fix, this is the backstop for the call site that
 * forgets.
 */
export function resolveApiUrl(base: string, path: string): URL {
  if (!path.startsWith('/') || path.startsWith('//')) {
    throw new Error(
      `deckpal-api path must be an absolute single-slash path, got ${JSON.stringify(
        path.slice(0, 120),
      )}`,
    );
  }
  const root = new URL(base.endsWith('/') ? base : `${base}/`);
  const target = new URL(path.slice(1), root);
  if (
    target.protocol !== root.protocol ||
    target.host !== root.host ||
    !target.pathname.startsWith(root.pathname)
  ) {
    throw new Error(
      `deckpal-api path ${JSON.stringify(path.slice(0, 120))} resolves outside the configured ` +
        `API base (${root.origin}${root.pathname}) — refusing to send it`,
    );
  }
  return target;
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
 * @param base   Base URL, e.g. `https://deckpal.app/api`.
 * @param bearer Raw credential for the `Authorization: Bearer …` header. Omit
 *               on self-host, where the reverse proxy is the auth boundary.
 *               NEVER logged — not in errors, not in diagnostics.
 */
export function makeApi(
  base: string,
  bearer?: string,
  /**
   * Extra headers on every request.
   *
   * ── WHY THIS EXISTS: THE SELF-HOP ────────────────────────────────────────
   *
   * Writes go through deckpal-api rather than straight to Postgres, so the
   * write logic stays single-sourced (SPEC §3). For Deck-E that means the chat
   * function makes an HTTP call to the SAME DEPLOYMENT it is running in — out
   * to the public hostname and back.
   *
   * Which means anything guarding that hostname guards US. On a Vercel preview
   * with Deployment Protection the self-hop is answered with the SSO page:
   * measured, `log_cards` came back "NOT SENT … applied 0 … STOPPED: Protected
   * deployment", the mutation ledger never moved, and the approval flow it was
   * testing could not be verified end to end. The same will be true of any
   * self-host deployment sitting behind an auth proxy, which `SECURITY.md`
   * describes as the expected arrangement.
   *
   * So the caller can forward whatever the platform needs to recognise its own
   * traffic. Never logged, like the bearer.
   */
  extraHeaders?: Record<string, string>,
): Api {
  const authHeader: Record<string, string> = {
    ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
    ...(extraHeaders ?? {}),
  };

  async function request(method: string, path: string, body?: unknown): Promise<unknown> {
    const url = resolveApiUrl(base, path);
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
      await sleep(500); // deckpal-api may be mid-restart; one retry only.
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
      const message = envelope.error?.message ?? `deckpal-api ${method} ${path} → ${res.status}`;
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
