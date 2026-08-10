import type pg from 'pg';

/**
 * Per-request RLS context for the multi-user (cloud) MCP endpoint.
 *
 * This is the same contract as `withUserContext` in apps/api/src/db.ts, applied
 * at the other door into the database. The API and the MCP server are separate
 * Vercel functions with separate pools, so the helper is stated once here for
 * the MCP process rather than imported across an app boundary — but the
 * mechanism is deliberately identical, and the two must change together:
 *
 *   BEGIN
 *   SELECT set_config('request.jwt.claims', '{"sub":…,"role":"authenticated"}', true)
 *   SET LOCAL role = 'authenticated'
 *   … every tool query …
 *   COMMIT / ROLLBACK
 *   RESET ROLE
 *
 * With the role switched, `auth.uid()` inside every policy from migration 021
 * resolves to the token owner, so a tool that forgot its `WHERE user_id = $1`
 * would return nothing rather than someone else's collection. The bind
 * parameter and the policy are two independent locks on the same door.
 *
 * The three statements are issued as one semicolon-separated batch: Postgres'
 * simple-query protocol runs a batch in a single exchange, and the database
 * lives in a different region from the function (~90 ms RTT), so three awaits
 * would cost a quarter-second before the first tool query. Same reasoning, and
 * the same `escapeLiteral` (the extended protocol permits one statement per
 * call, so the claims JSON cannot be a bind parameter here), as the API.
 *
 * When SUPABASE_MODE is unset — self-host, or a scratch database without the
 * Supabase roles — the wrapper degrades to a plain checked-out client with no
 * role switching, exactly like the API's.
 */

const SUPABASE_MODE = (): boolean => !!process.env.SUPABASE_MODE;

export async function withUserContext<T>(
  pool: pg.Pool,
  userId: string,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();

  if (!SUPABASE_MODE()) {
    try {
      return await fn(client);
    } finally {
      client.release();
    }
  }

  try {
    const claims = client.escapeLiteral(JSON.stringify({ sub: userId, role: 'authenticated' }));
    await client.query(
      `BEGIN; SELECT set_config('request.jwt.claims', ${claims}, true); SET LOCAL role = 'authenticated'`,
    );
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore — the original error is what matters */
    }
    throw err;
  } finally {
    // Never return a connection to the pool still wearing 'authenticated'.
    try {
      await client.query('RESET ROLE');
    } catch {
      /* best-effort; the pool discards a broken connection */
    }
    client.release();
  }
}
