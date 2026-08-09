import pg from 'pg';
import { loadEnv } from './env.js';

const { Pool } = pg;

/**
 * A pg Pool with a HARD connection cap.
 *
 * 🔴 Connection budget is 4 TOTAL across the whole app (API 2 + sync 1 + mcp 1;
 * see DECISIONS.md 2026-07-29). Postgres on this box runs at max_connections=20,
 * 3 reserved, ~11 already used by co-hosted apps. See DECISIONS.md
 * 2026-07-24 (storage) and research/DATA-LAYER.md §6.5. Never raise past 5
 * without re-checking headroom AND a Postgres restart (which requires the
 * user's permission).
 *
 * `PGPOOL_MAX` is clamped to 3 PER PROCESS regardless of what the environment
 * asks for, so a misconfigured process cannot blow the cluster budget (no
 * single app is allotted more than 2).
 */
const HARD_CAP = 3;

export function makePool(maxOverride?: number): pg.Pool {
  loadEnv();
  const requested = maxOverride ?? Number(process.env.PGPOOL_MAX ?? 3);
  const max = Math.min(Number.isFinite(requested) ? requested : 3, HARD_CAP);
  return new Pool({
    host: process.env.PGHOST ?? '127.0.0.1',
    port: Number(process.env.PGPORT ?? 5432),
    database: process.env.PGDATABASE ?? 'deckscout',
    user: process.env.PGUSER ?? 'deckscout',
    password: process.env.PGPASSWORD,
    max,
    min: 0,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    application_name: process.env.PGAPPNAME ?? 'deckscout',
  });
}
