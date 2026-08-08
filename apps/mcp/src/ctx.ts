import type pg from 'pg';
import { loadEnv, makePool } from '@deckscout/db';
import { apiBase, apiGet, apiSend } from './api.js';
import { q1 } from './db.js';

/**
 * Build-once server context. One instance is created at startup and shared by
 * every per-request McpServer (SPEC §2: fresh McpServer per request, but the
 * pool/config/user live for the process).
 *
 * Pool: makePool(1) — the documented 4th connection against the cluster
 * budget (SPEC §3; headroom verified in DECISIONS.md 2026-07-24).
 */

export interface McpConfig {
  /** Listen port (DECKSCOUT_MCP_PORT, default 3704). Bound to 127.0.0.1 only. */
  port: number;
  /** Shared secret gating /mcp (ROTOM_MCP_KEY). Never log this. */
  key: string;
  /** deckscout-api base, e.g. http://127.0.0.1:3700/pokedex/api */
  apiBase: string;
}

export interface Api {
  get: typeof apiGet;
  send: typeof apiSend;
  base: string;
}

export interface Ctx {
  pool: pg.Pool;
  api: Api;
  /** The single default user — lowest app_user.id, resolved once at startup. */
  userId: number;
  config: McpConfig;
}

export async function buildCtx(): Promise<Ctx> {
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
  // and pm2 restarts). Done before the user lookup for a clean error message.
  await pool.query('SELECT 1');

  // Same rule as apps/api/src/db.ts defaultUserId(): lowest app_user.id, else 1.
  const row = await q1<{ id: string }>(pool, 'SELECT id FROM app_user ORDER BY id LIMIT 1');
  const userId = row ? Number(row.id) : 1;

  return { pool, api: { get: apiGet, send: apiSend, base: config.apiBase }, userId, config };
}
