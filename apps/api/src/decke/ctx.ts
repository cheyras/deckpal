/**
 * Building a `Ctx` for Deck-E, from the JWT he has already verified.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * Both doors end at the same value
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *                      MCP cloud                     Deck-E
 *   credential         `Bearer dsk_…`                Supabase JWT
 *   resolution         SHA-256 → api_token row       verifySupabaseJwt → sub
 *   implemented in     apps/mcp/src/cloud.ts         api/chat.mjs
 *
 * So Deck-E needs NO personal access token. He builds a `Ctx` from the JWT the
 * request already carried, and `Ctx.api` forwards that same JWT — which means
 * RLS and every API-side check apply to him exactly as they do to the person
 * typing. There is no service-role credential anywhere on this path, and adding
 * one would be the single change that turns a bounded feature into an unbounded
 * one.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * THE DATABASE HANDLE IS LAZY, AND THAT IS THE INTERESTING PART
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * `Ctx.db` looks like an open connection and is not. It is a `Queryable` that
 * checks one out on its FIRST query and holds it only until the tool call
 * returns.
 *
 * Roughly half the 23 tools never touch Postgres: writes and all deck/list
 * operations go through the REST API so the write logic stays single-sourced
 * (`apps/mcp/SPEC.md` §3). Opening a transaction for `save_deck` would spend a
 * ~90 ms round trip and one of two pooled connections to run no queries at all.
 * Worse, it would make the connection budget a function of how many tools were
 * called rather than how many actually read — which is the sort of coupling
 * that is invisible until the pool is empty.
 *
 * Lazy also means the ordinary conversational turn — no tool call, or only a
 * cosmetic one — never touches the database. Which is what `api/chat.mjs`'s
 * header has always promised, and now stays true of every turn that does not
 * need otherwise.
 */
import { makeApi, type Api, type Ctx, type Queryable } from '@deckpal/agent-tools';
import type pg from 'pg';
import { openRlsSession, type RlsSession } from './rls.js';

export interface ToolCtxOptions {
  pool: pg.Pool;
  /** `app_user.id` — the JWT's `sub`. */
  userId: string;
  /** The caller's raw Supabase JWT, forwarded so the REST side resolves them. */
  jwt: string;
  /** Base URL for deckpal-api, derived per request — see `apiBaseFor`. */
  apiBase: string;
  /** The turn's abort signal. Propagated into reads AND outbound fetches. */
  signal?: AbortSignal;
}

/**
 * Derive the API base URL from the request's own Host header.
 *
 * The MCP server does this (`apiBaseFor` in `cloud.ts`); the chat function had
 * no equivalent, because until now it never called the API. Deriving it rather
 * than hardcoding it is what lets a preview deployment talk to ITSELF instead
 * of to production — which matters a great deal when the thing being verified
 * is a preview deployment.
 *
 * `DECKPAL_API_BASE` wins when set, for self-host and for local development
 * where the API is on another port.
 *
 * Only `localhost` and `127.0.0.1` are treated as plaintext. Everything else is
 * https, so a spoofed `Host` cannot downgrade the hop — and since this is our
 * own outbound call carrying the user's JWT, a downgrade would put that token
 * on the wire in the clear.
 */
export function apiBaseFor(host: string | undefined): string {
  const configured = process.env.DECKPAL_API_BASE;
  if (configured) return configured;
  const h = (host ?? '').trim() || 'localhost';
  const plain = /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(h);
  return `${plain ? 'http' : 'https'}://${h}/api`;
}

/**
 * Run one tool call with a `Ctx`, and guarantee the connection comes back.
 *
 * The session — if the tool ever opened one — is committed on success and
 * rolled back on failure. Reads have nothing to commit, so this is bookkeeping
 * rather than semantics; it matters because leaving a transaction open is what
 * pins the connection, and "it was only a SELECT" is not a reason the pool
 * cares about.
 */
export async function withToolCtx<T>(
  opts: ToolCtxOptions,
  fn: (ctx: Ctx) => Promise<T>,
): Promise<T> {
  // A HOLDER, not a bare `let`. TypeScript cannot see that the `db.query`
  // closure below assigns it, so it narrows the variable to `null` everywhere
  // after the declaration and then reports `.finish()` as a property of
  // `never` — an error about entirely the wrong thing. An object field is not
  // narrowed that way.
  const held: { session: RlsSession | null } = { session: null };

  const db: Queryable = {
    query: async (text, params) => {
      if (!held.session) {
        held.session = await openRlsSession(opts.pool, opts.userId, opts.signal);
      }
      return held.session.client.query(text, params);
    },
  };

  const ctx: Ctx = {
    db,
    api: abortableApi(makeApi(opts.apiBase, opts.jwt), opts.signal),
    userId: opts.userId,
  };

  try {
    const out = await fn(ctx);
    await held.session?.finish();
    return out;
  } catch (err) {
    await held.session?.discard();
    throw err;
  }
}

/**
 * Make the API client answer to the turn's abort signal.
 *
 * `makeApi` uses bare `fetch` with no signal, which is right for the MCP server
 * — its requests are not abandoned — and wrong here. Without this, pressing
 * stop leaves an in-flight write to deckpal-api running to completion against a
 * conversation that no longer exists.
 *
 * Wrapping rather than changing `makeApi`'s signature keeps the shared package
 * free of a concern only one of its three callers has. If a second caller ever
 * needs it, that is the moment to push it down.
 *
 * NOTE the honest limitation: this aborts the WAIT, not the work. A `POST` that
 * has already reached deckpal-api will finish and commit. That is why writes
 * carry an idempotency key rather than relying on the caller giving up — and
 * why `log_cards` was made idempotent after the incident where a client gave up
 * on a request that had in fact committed.
 */
function abortableApi(api: Api, signal?: AbortSignal): Api {
  if (!signal) return api;
  const guard = <T>(p: Promise<T>): Promise<T> => {
    if (signal.aborted) return Promise.reject(new Error('aborted'));
    return Promise.race([
      p,
      new Promise<never>((_, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      }),
    ]);
  };
  return {
    base: api.base,
    get: (path) => guard(api.get(path)),
    send: (method, path, body) => guard(api.send(method, path, body)),
  };
}
