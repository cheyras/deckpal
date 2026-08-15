import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type pg from 'pg';

/**
 * Personal access tokens (`api_token`, migration 026).
 *
 * One long-lived bearer credential a user mints in Profile → Agent access and
 * hands to a non-browser client: the MCP endpoint at /mcp, or the REST API
 * directly. It resolves to exactly one `app_user.id`, and every query that
 * follows runs in that user's RLS context — the token grants no more than the
 * user's own session would.
 *
 * Secrecy contract:
 *  - The raw token exists only in the response to POST /tokens. It is shown
 *    once and never recoverable.
 *  - Only `sha256(raw)` is persisted. Verification is a single indexed
 *    equality on that hash — no per-row comparison, no timing loop.
 *  - `prefix` (the first 12 characters) is stored for display only.
 *
 * This module is deliberately pool-agnostic: every function takes the
 * queryable to use, so the auth path can run on the base pool (before a user
 * is known) while the management routes run inside the caller's RLS
 * transaction client.
 *
 * It lives in `@deckpal/db` rather than in either server because BOTH need
 * it and they must agree byte for byte: `deckpal-api` mints and verifies
 * tokens, `deckpal-mcp` verifies them at the /mcp edge. Two copies of a
 * hashing rule is one copy too many.
 */

/** Human-visible prefix so a leaked string is recognisable as a DeckPal key. */
export const TOKEN_PREFIX = 'dsk_';

/** Characters of the raw token kept for display: 'dsk_' + 8 of the secret. */
const DISPLAY_PREFIX_LEN = TOKEN_PREFIX.length + 8;

/** Anything with `.query()` — a `pg.Pool` or a checked-out `pg.PoolClient`. */
export interface Queryable {
  query<T extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<pg.QueryResult<T>>;
}

export interface ApiTokenRow {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface ResolvedToken {
  tokenId: string;
  userId: string;
}

/** `dsk_` + 32 bytes of CSPRNG output, base64url — 256 bits of entropy. */
export function generateToken(): string {
  return TOKEN_PREFIX + randomBytes(32).toString('base64url');
}

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

export function tokenPrefix(raw: string): string {
  return raw.slice(0, DISPLAY_PREFIX_LEN);
}

/**
 * Cheap shape check before touching the database, so a stray `Bearer <jwt>`
 * never costs a query. A JWT has three dot-separated segments and no `dsk_`
 * prefix, so the two credential kinds can never be confused.
 */
export function looksLikeApiToken(raw: string): boolean {
  return raw.startsWith(TOKEN_PREFIX) && raw.length > DISPLAY_PREFIX_LEN;
}

/**
 * Resolve a raw bearer token to its owner, or null when it is unknown or
 * revoked. Returns null (never throws) for any malformed input.
 *
 * The `timingSafeEqual` here is belt-and-braces: the lookup is already an
 * equality on a 256-bit hash, so there is nothing to walk, but comparing the
 * stored and computed digests in constant time costs nothing and keeps the
 * property true if the query ever gains an ordering.
 */
export async function resolveToken(db: Queryable, raw: string): Promise<ResolvedToken | null> {
  if (!looksLikeApiToken(raw)) return null;
  const hash = hashToken(raw);
  const { rows } = await db.query<{ id: string; user_id: string; token_hash: string }>(
    `SELECT id, user_id, token_hash
       FROM api_token
      WHERE token_hash = $1 AND revoked_at IS NULL`,
    [hash],
  );
  const row = rows[0];
  if (!row) return null;
  const a = Buffer.from(row.token_hash, 'utf8');
  const b = Buffer.from(hash, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return { tokenId: row.id, userId: row.user_id };
}

/**
 * Stamp `last_used_at`, but at most once a minute per token. A busy agent
 * session fires dozens of tool calls a minute and the column is only ever read
 * by a human looking at a list — one write per minute is all the fidelity it
 * needs, and it keeps the hot auth path to a single round trip most of the time.
 */
export async function touchToken(db: Queryable, tokenId: string): Promise<void> {
  await db.query(
    `UPDATE api_token
        SET last_used_at = now()
      WHERE id = $1
        AND (last_used_at IS NULL OR last_used_at < now() - interval '1 minute')`,
    [tokenId],
  );
}

function shape(r: {
  id: string;
  name: string;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}): ApiTokenRow {
  return {
    id: r.id,
    name: r.name,
    prefix: r.prefix,
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
    revokedAt: r.revoked_at,
  };
}

/** All of a user's tokens, newest first. `token_hash` is never selected. */
export async function listTokens(db: Queryable, userId: string): Promise<ApiTokenRow[]> {
  const { rows } = await db.query<Parameters<typeof shape>[0]>(
    `SELECT id, name, prefix, created_at, last_used_at, revoked_at
       FROM api_token
      WHERE user_id = $1
      ORDER BY created_at DESC`,
    [userId],
  );
  return rows.map(shape);
}

export interface CreatedToken {
  token: ApiTokenRow;
  /** The raw value. Returned exactly once; never persisted, never logged. */
  raw: string;
}

export async function createToken(db: Queryable, userId: string, name: string): Promise<CreatedToken> {
  const raw = generateToken();
  const { rows } = await db.query<Parameters<typeof shape>[0]>(
    `INSERT INTO api_token (user_id, name, token_hash, prefix)
     VALUES ($1, $2, $3, $4)
     RETURNING id, name, prefix, created_at, last_used_at, revoked_at`,
    [userId, name, hashToken(raw), tokenPrefix(raw)],
  );
  const row = rows[0];
  if (!row) throw new Error('token insert returned no row');
  return { token: shape(row), raw };
}

/**
 * Revoke by id, scoped to the owner. Idempotent: revoking an already-revoked
 * token keeps the original timestamp and still reports success, so a retried
 * request never looks like a failure.
 */
export async function revokeToken(db: Queryable, userId: string, id: string): Promise<ApiTokenRow | null> {
  const { rows } = await db.query<Parameters<typeof shape>[0]>(
    `UPDATE api_token
        SET revoked_at = COALESCE(revoked_at, now())
      WHERE id = $1 AND user_id = $2
      RETURNING id, name, prefix, created_at, last_used_at, revoked_at`,
    [id, userId],
  );
  const row = rows[0];
  return row ? shape(row) : null;
}
