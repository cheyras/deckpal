import type pg from 'pg';
import { loadEnv, makePool } from '@deckpal/db';
import { apiBase, makeApi, q1, type Ctx } from '@deckpal/agent-tools';

/**
 * The self-host server's own context, on top of the shared {@link Ctx}.
 *
 * `Ctx` itself — `{ db, api, userId }`, the three things a tool needs — now
 * lives in `@deckpal/agent-tools` because Deck-E builds one too and neither
 * caller should own the other's definition. What is left here is what only a
 * process with a listening socket cares about.
 *
 * `McpConfig` used to hang off `Ctx`, which meant every caller had to invent a
 * port and a shared secret to construct one; `cloud.ts` was passing
 * `{ port: 0, key: '' }` for a function that never listens. No tool ever read
 * it. It belongs here, with the server that has a socket.
 *
 * Pool (self-host): makePool(1) — the documented 4th connection against the
 * cluster budget (SPEC §3; headroom verified in DECISIONS.md 2026-07-24).
 */

export interface McpConfig {
  /** Listen port (DECKPAL_MCP_PORT, default 3704). Bound to 127.0.0.1 only. */
  port: number;
  /** Shared secret gating /mcp (DECKPAL_MCP_KEY). Never log this. */
  key: string;
  /** deckpal-api base, e.g. http://127.0.0.1:3700/deckpal/api */
  apiBase: string;
}

/** Self-host context: process-wide, one user, one pool. */
export interface SelfHostCtx extends Ctx {
  pool: pg.Pool;
  config: McpConfig;
}

export async function buildCtx(): Promise<SelfHostCtx> {
  loadEnv();
  // Label this app's connection in pg_stat_activity without leaking the name
  // into sibling apps: PGAPPNAME is set process-locally, never in .env.
  process.env.PGAPPNAME ??= 'deckpal-mcp';

  const config: McpConfig = {
    port: Number(process.env.DECKPAL_MCP_PORT ?? 3704),
    key: process.env.DECKPAL_MCP_KEY ?? '',
    apiBase: apiBase(),
  };

  const pool = makePool(Number(process.env.PGPOOL_MAX_MCP ?? 1));

  // Startup DB self-check: SELECT 1 — a failure here is fatal (index.ts exits 1
  // and the supervisor restarts). Done before the user lookup for a clean error message.
  await pool.query('SELECT 1');

  // Same rule as apps/api/src/db.ts defaultUserId(): lowest app_user.id, else '1'.
  // Kept as a STRING: app_user.id is a UUID since migration 020, and the old
  // Number() coercion here turned every id into NaN, which Postgres then
  // rejected as invalid uuid input on the first user-scoped query.
  const row = await q1<{ id: string }>(pool, 'SELECT id FROM app_user ORDER BY id LIMIT 1');
  const userId = row ? String(row.id) : '1';

  return { pool, db: pool, api: makeApi(config.apiBase), userId, config };
}
