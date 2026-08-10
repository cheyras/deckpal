import type pg from 'pg';
import { loadEnv, makePool } from '@deckscout/db';
import { apiBase, makeApi, type Api } from './api.js';
import { q1, type Queryable } from './db.js';

/**
 * Server context — everything a tool needs that is not a tool argument.
 *
 * Two deployments build it two different ways:
 *
 *  • **Self-host** (`index.ts`): built once at startup. `db` is the process
 *    pool, `userId` is the single default user, `api` is unauthenticated
 *    (the reverse proxy is the auth boundary). Shared by every request.
 *
 *  • **Cloud** (`cloud.ts`): built per request from the caller's personal
 *    access token. `db` is the client already inside that user's RLS
 *    transaction, `userId` is the token's owner, and `api` carries the token
 *    so the REST side resolves the same identity.
 *
 * Tools are written against this interface only, so they are identical in both.
 *
 * Pool (self-host): makePool(1) — the documented 4th connection against the
 * cluster budget (SPEC §3; headroom verified in DECISIONS.md 2026-07-24).
 */

export interface McpConfig {
  /** Listen port (DECKSCOUT_MCP_PORT, default 3704). Bound to 127.0.0.1 only. */
  port: number;
  /** Shared secret gating /mcp (ROTOM_MCP_KEY). Never log this. */
  key: string;
  /** deckscout-api base, e.g. http://127.0.0.1:3700/deckscout/api */
  apiBase: string;
}

export interface Ctx {
  /** Pool (self-host) or the request's RLS-scoped client (cloud). */
  db: Queryable;
  api: Api;
  /**
   * `app_user.id` — a UUID since migration 020. Every user-scoped query passes
   * it as a bind parameter; in the cloud it is additionally enforced by RLS.
   */
  userId: string;
  config: McpConfig;
}

/** Self-host context: process-wide, one user, one pool. */
export interface SelfHostCtx extends Ctx {
  pool: pg.Pool;
}

export async function buildCtx(): Promise<SelfHostCtx> {
  loadEnv();
  // Label this app's connection in pg_stat_activity without leaking the name
  // into sibling apps: PGAPPNAME is set process-locally, never in .env.
  process.env.PGAPPNAME ??= 'deckscout-mcp';

  const config: McpConfig = {
    port: Number(process.env.DECKSCOUT_MCP_PORT ?? 3704),
    key: process.env.ROTOM_MCP_KEY ?? '',
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
