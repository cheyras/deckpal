import type pg from 'pg';
import type { Queryable } from '@deckpal/db';

/**
 * Tiny query helpers, mirroring apps/api/src/db.ts's q/q1 shape — but with NO
 * module-level pool side-effect: the connection source is built once in ctx.ts
 * (self-host) or per request in cloud.ts (multi-user), and passed in
 * explicitly, so importing this file never opens a connection. Every query is
 * parameterized ($1, $2, …); nothing from tool arguments is ever concatenated
 * into SQL.
 *
 * The parameter is a {@link Queryable}, not a `pg.Pool`: in the cloud path the
 * caller hands in the checked-out client that is already inside the per-request
 * RLS transaction (`SET LOCAL role = 'authenticated'`), so every tool query
 * runs under the token owner's row-level policies. Self-host hands in the pool
 * itself and nothing changes.
 */

/**
 * Anything with `.query()` — a `pg.Pool` or a checked-out `pg.PoolClient`.
 * The one definition lives in `@deckpal/db` (tokens.ts); re-exported here so
 * this package's consumers keep importing it from the tool layer.
 */
export type { Queryable };

export async function q<T extends pg.QueryResultRow = pg.QueryResultRow>(
  db: Queryable,
  text: string,
  params: readonly unknown[] = [],
): Promise<T[]> {
  const res = await db.query<T>(text, params as unknown[]);
  return res.rows;
}

export async function q1<T extends pg.QueryResultRow = pg.QueryResultRow>(
  db: Queryable,
  text: string,
  params: readonly unknown[] = [],
): Promise<T | null> {
  const rows = await q<T>(db, text, params);
  return rows[0] ?? null;
}
