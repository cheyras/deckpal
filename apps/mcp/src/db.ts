import type pg from 'pg';

/**
 * Tiny query helpers, mirroring apps/api/src/db.ts's q/q1 shape — but with NO
 * module-level pool side-effect: the single-connection pool is built once in
 * ctx.ts and passed in explicitly, so importing this file never opens a
 * connection. Every query is parameterized ($1, $2, …); nothing from tool
 * arguments is ever concatenated into SQL.
 */

export async function q<T extends pg.QueryResultRow = pg.QueryResultRow>(
  pool: pg.Pool,
  text: string,
  params: readonly unknown[] = [],
): Promise<T[]> {
  const res = await pool.query<T>(text, params as unknown[]);
  return res.rows;
}

export async function q1<T extends pg.QueryResultRow = pg.QueryResultRow>(
  pool: pg.Pool,
  text: string,
  params: readonly unknown[] = [],
): Promise<T | null> {
  const rows = await q<T>(pool, text, params);
  return rows[0] ?? null;
}
