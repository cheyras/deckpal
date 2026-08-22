/**
 * Per-tool-call RLS sessions for Deck-E, with the watchdog the other two doors
 * lack.
 *
 * This is the third door into the same database. The API has one
 * (`apps/api/src/index.ts`'s middleware) and the MCP server has one
 * (`apps/mcp/src/rls.ts`), and the mechanism is deliberately identical in all
 * three — stated separately rather than imported, because they are separate
 * serverless functions with separate pools and no shared process:
 *
 *   BEGIN
 *   SELECT set_config('request.jwt.claims', '{"sub":…,"role":"authenticated"}', true)
 *   SET LOCAL role = 'authenticated'
 *   … the tool's queries …
 *   COMMIT / ROLLBACK
 *   RESET ROLE
 *
 * With the role switched, `auth.uid()` inside every policy from migration 021
 * resolves to the caller, so a tool that forgot its `WHERE user_id = $1` returns
 * nothing rather than someone else's collection. The bind parameter and the
 * policy are two independent locks on the same door.
 *
 * The three statements go as one semicolon-separated batch: the simple-query
 * protocol runs a batch in a single exchange, and the database is ~90 ms away,
 * so three awaits would cost a quarter-second before the first tool query.
 * (`escapeLiteral` rather than a bind parameter for the same reason the other
 * two use it — the extended protocol permits one statement per call.)
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * THE RULE THAT MAKES THIS SAFE ON A STREAMING ENDPOINT
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * **Never hold a connection across the stream.** One tool call, one short
 * session, released on return — including on the error and abort paths.
 *
 * `api/chat.mjs` exists as its own function precisely because the Express app
 * holds one pooled connection for a whole request with a 30 s watchdog, and a
 * streaming endpoint under that arrangement would cap Deck-E at the pool
 * maximum and get its connection yanked mid-sentence. That reasoning still
 * stands. What changed is that Deck-E now needs to READ, and the answer is not
 * to relax the rule but to make each read small enough that the rule is free.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * WHY THERE IS A WATCHDOG HERE AND NOT IN apps/mcp/src/rls.ts
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Aborts are ROUTINE on this path, not exceptional. `useDeckeChat` aborts the
 * previous stream on every new send, and there is a visible stop button.
 *
 * When the response socket dies, the handler's pump loop returns but
 * `createUIMessageStream`'s `execute` keeps running — and Vercel then FREEZES
 * the instance. A tool call inside a transaction at that moment holds a
 * checked-out client, in an open transaction, on an instance that will not run
 * another line of JavaScript until it is thawed. With `PGPOOL_MAX_CHAT=2`, two
 * aborted turns wedge that instance's pool permanently.
 *
 * The MCP server has no watchdog because its requests are not streamed and not
 * routinely abandoned. This one does, and it is the same contract the Express
 * app has carried since the pool-exhaustion incident.
 */
import type pg from 'pg';

const SUPABASE_MODE = (): boolean => !!process.env.SUPABASE_MODE;

/** The one place this name is spelled. Declared in DEPLOYMENT.md. */
export const DECKE_HOLD_VAR = 'DECKE_PGRLS_MAX_HOLD_MS';

/**
 * How long ONE tool call may hold its connection.
 *
 * Deliberately far below the API's 30 s `PGRLS_MAX_HOLD_MS`, because the unit is
 * different: that budget covers a whole request, this one covers a single
 * `search_cards`. A read that takes ten seconds is not slow, it is stuck — and
 * on a conversational path the reader gave up several seconds ago.
 */
export function maxHoldMs(): number {
  const raw = Number.parseInt(process.env[DECKE_HOLD_VAR] ?? '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 10_000;
}

/** Raised when the watchdog reclaims a connection. Distinguishable on purpose. */
export class ToolHoldTimeout extends Error {
  constructor(ms: number) {
    super(`that lookup went past ${ms} ms, so I stopped waiting for it`);
    this.name = 'ToolHoldTimeout';
  }
}

/**
 * An open RLS session: a checked-out client plus the two ways it can end.
 *
 * Exposed rather than wrapped in a callback because the caller needs it LAZY —
 * see `ctx.ts`. Roughly half the 23 tools never touch Postgres at all (writes
 * and every deck/list operation go through the REST API so the write logic
 * stays single-sourced, SPEC §3), and opening a transaction for those would
 * spend a ~90 ms round trip and one of two pooled connections to run no
 * queries.
 */
export interface RlsSession {
  client: pg.PoolClient;
  /**
   * Run one query under the session's deadline.
   *
   * USE THIS, not `client.query`. The watchdog destroys the CONNECTION when it
   * fires, which does not necessarily settle a query already in flight on it —
   * so a caller awaiting `client.query` directly can wait for ever on a
   * connection that no longer exists. That is the watchdog defeating itself:
   * the pool is protected and the request hangs anyway.
   */
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<pg.QueryResult<R>>;
  /** Commit and return the connection to the pool. */
  finish(): Promise<void>;
  /** Roll back and return it. */
  discard(): Promise<void>;
}

/**
 * Check out a connection and put it in the caller's RLS context.
 *
 * The watchdog starts HERE, not when the first query runs: a `pool.connect()`
 * that never resolves is exactly as wedged as a query that never returns, and
 * it is the more likely of the two when the pool is exhausted.
 */
export async function openRlsSession(
  pool: pg.Pool,
  userId: string,
  signal?: AbortSignal,
): Promise<RlsSession> {
  if (signal?.aborted) throw new Error('aborted before the read started');

  const budget = maxHoldMs();

  // RECLAIM A LATE CONNECTION. `Promise.race` abandons the loser, it does not
  // cancel it — so a `pool.connect()` that resolves AFTER we stopped waiting
  // hands us a checked-out client with nobody holding a reference to release
  // it. That client is then checked out for the life of the instance, which is
  // exactly the pool exhaustion this whole file exists to prevent, arriving
  // through the code written to prevent it.
  const connecting = pool.connect();
  const client = await withDeadline(connecting, budget).catch((err: unknown) => {
    void connecting.then(
      (late) => {
        try {
          late.release(true);
        } catch {
          /* nothing further to do */
        }
      },
      () => {
        /* it failed rather than arriving late; nothing to reclaim */
      },
    );
    throw err;
  });
  let ended = false;
  // Absolute, so every query measures against the SAME deadline.
  const deadlineAt = Date.now() + budget;

  // RELEASE WITH `true`, which DESTROYS the client rather than pooling it. That
  // is the important half. A watchdog or an abort fires while the tool's query
  // may still be running — Postgres does not cancel a statement because
  // JavaScript stopped waiting for it — so the connection is mid-statement,
  // inside an open transaction, carrying this turn's RLS claims. Handing that
  // back means the next request checks it out, sets ITS user's claims, and
  // races a still-running query from someone else's session. A destroyed
  // connection costs one reconnect. A shared one costs a cross-user data leak.
  const destroy = () => {
    if (ended) return;
    ended = true;
    try {
      client.release(true);
    } catch {
      /* the pool discards a broken client on its own */
    }
  };

  const onAbort = () => destroy();
  signal?.addEventListener('abort', onAbort, { once: true });
  const watchdog = setTimeout(destroy, budget);

  const close = async (mode: 'commit' | 'rollback'): Promise<void> => {
    clearTimeout(watchdog);
    signal?.removeEventListener('abort', onAbort);
    if (ended) return;
    ended = true;
    try {
      if (SUPABASE_MODE()) {
        await withDeadline(
          client.query(`${mode === 'commit' ? 'COMMIT' : 'ROLLBACK'}; RESET ROLE`),
          budget,
        );
      }
      client.release();
    } catch {
      // COMMIT can HANG rather than reject on a half-dead connection. Unbounded,
      // cleanup never reaches release() and the client is gone for good — the
      // API's own middleware carries this same note for the same reason.
      try {
        client.release(true);
      } catch {
        /* nothing further to do */
      }
    }
  };

  try {
    if (SUPABASE_MODE()) {
      const claims = client.escapeLiteral(JSON.stringify({ sub: userId, role: 'authenticated' }));
      await withDeadline(
        client.query(
          `BEGIN; SELECT set_config('request.jwt.claims', ${claims}, true); SET LOCAL role = 'authenticated'`,
        ),
        budget,
      );
    }
  } catch (err) {
    destroy();
    throw err;
  }

  return {
    client,
    // Every query is bounded by what is LEFT of the session's budget, not by a
    // fresh copy of it. Otherwise ten queries of nine seconds each are ninety
    // seconds inside a ten-second session, and the deadline means nothing.
    query: <R extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params?: unknown[]) => {
      if (ended) {
        return Promise.reject(new ToolHoldTimeout(budget));
      }
      const left = Math.max(1, deadlineAt - Date.now());
      return withDeadline(client.query<R>(text, params as never), left).catch((err: unknown) => {
        // DESTROY IT HERE, rather than leaving it to the watchdog.
        //
        // The two fire at almost the same instant and the order is not
        // guaranteed, so relying on the watchdog leaves a window where this
        // rejects while the connection is still pooled — with a statement
        // Postgres is very much still running on it, inside an open
        // transaction, carrying this turn's RLS claims. The next borrower would
        // set its own claims on top.
        //
        // A timed-out query is by definition a connection in an unknown state.
        // There is no version of that which is safe to hand to someone else.
        if (err instanceof ToolHoldTimeout) destroy();
        throw err;
      });
    },
    finish: () => close('commit'),
    discard: () => close('rollback'),
  };
}

/**
 * Reject rather than wait for ever.
 *
 * `Promise.race` and not an `AbortSignal`, because `pg` does not take one — and
 * the losing promise is deliberately left to settle on its own. Its connection
 * has already been destroyed by the time this matters, so there is nothing to
 * clean up and nothing to await.
 */
function withDeadline<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ToolHoldTimeout(ms)), ms);
  });
  // CLEARED WHEN THE RACE SETTLES, rather than `unref()`d.
  //
  // `unref()` was the obvious way to avoid holding a serverless instance open
  // for a timer whose only job is to give up. It is also wrong, and CI proved
  // it: an unref'd timer does not keep the event loop alive, so when the thing
  // being raced never settles — which is the ONLY case this timer exists for —
  // Node can decide there is nothing left to do and exit with the race pending.
  // Six tests were cancelled with "Promise resolution is still pending but the
  // event loop has already resolved", and they were the six after the one that
  // deliberately hangs a query.
  //
  // Clearing on settle is strictly better anyway. The timer holds the loop only
  // while a query is genuinely in flight — exactly when the process should be
  // alive — and is gone the instant the query returns, so the ordinary path
  // leaves nothing dangling either.
  return Promise.race([p, deadline]).finally(() => clearTimeout(timer));
}
