import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type pg from 'pg';

/**
 * Personal access tokens (`api_token`, migration 026).
 *
 * One long-lived bearer credential a user mints in Profile → Agent access and
 * hands to a non-browser client: the MCP endpoint at /mcp, or the REST API
 * directly. It resolves to exactly one `app_user.id`, and every query that
 * follows runs in that user's RLS context — the token grants no more than the
 * user's own session would, and a `read` token less (migration 075).
 *
 * An OAuth connection is a row of this same table (grants.ts); its secrets
 * rotate beneath it and it carries an `expires_at`. Hand-made tokens have no
 * expiry, because the clients they exist for (a URL pasted into a connector
 * dialog) have no way to renew one.
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

/** What a credential may do. `read` is refused every write (migration 075). */
export type TokenScope = 'full' | 'read';

export interface ApiTokenRow {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  /** NULL = never. Every token minted before migration 075 is NULL. */
  expiresAt: string | null;
  scope: TokenScope;
  /** Set only on a connection approved through OAuth; NULL on a hand-made token. */
  oauthClientId: string | null;
  oauthRedirectUri: string | null;
}

export interface ResolvedToken {
  tokenId: string;
  userId: string;
  scope: TokenScope;
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

// ── Migration 075, and the window before it is applied ──────────────────────
//
// Migrations are run by hand and Vercel deploys on merge (DECISIONS.md, the
// 046 entry), so for a while this code can meet a database without 075's
// columns. Every live token must keep resolving through that window, the
// OAuth connectors people already use above all. So each statement below has
// a pre-075 form, chosen by one cheap check. Only `true` is cached: the moment
// the migration lands, the next request sees it.
const grantsReady = new WeakMap<Queryable, true>();
let warnedPending = false;

export async function grantSchemaReady(db: Queryable): Promise<boolean> {
  if (grantsReady.has(db)) return true;
  const { rows } = await db.query<{ ready: boolean }>(
    `SELECT to_regclass('public.oauth_token') IS NOT NULL AS ready`,
  );
  if (rows[0]?.ready) {
    grantsReady.set(db, true);
    return true;
  }
  if (!warnedPending) {
    warnedPending = true;
    console.warn(
      '[deckpal] migration 075_oauth_grants is not applied: tokens resolve as before it, and new OAuth ' +
        'connections are refused until `pnpm --filter @deckpal/db migrate` runs.',
    );
  }
  return false;
}

/**
 * Resolve a raw bearer token to its owner, or null when it is unknown,
 * revoked or expired. Returns null (never throws) for any malformed input.
 *
 * Two kinds of secret resolve here, and both land on an `api_token` row, whose
 * revocation, expiry and account state decide the answer: a token's own hash
 * (hand-made tokens, and connections approved before 075), or an OAuth access
 * token in `oauth_token`, which has its own one-hour expiry as well.
 *
 * The `timingSafeEqual` here is belt-and-braces: the lookup is already an
 * equality on a 256-bit hash, so there is nothing to walk, but comparing the
 * stored and computed digests in constant time costs nothing and keeps the
 * property true if the query ever gains an ordering.
 */
export async function resolveToken(db: Queryable, raw: string): Promise<ResolvedToken | null> {
  if (!looksLikeApiToken(raw)) return null;
  const hash = hashToken(raw);
  const { rows } = (await grantSchemaReady(db))
    ? await db.query<{ id: string; user_id: string; scope: TokenScope; token_hash: string }>(
        `SELECT t.id, t.user_id, t.scope, h.token_hash
           FROM (SELECT id AS token_id, token_hash FROM api_token WHERE token_hash = $1
                 UNION ALL
                 SELECT token_id, token_hash FROM oauth_token
                  WHERE token_hash = $1 AND kind = 'access' AND expires_at > now()) h
           JOIN api_token t ON t.id = h.token_id
          WHERE t.revoked_at IS NULL
            AND (t.expires_at IS NULL OR t.expires_at > now())
            AND public.admin_account_active(t.user_id::text)`,
        [hash],
      )
    : await db.query<{ id: string; user_id: string; scope: TokenScope; token_hash: string }>(
        `SELECT id, user_id, 'full' AS scope, token_hash
           FROM api_token
          WHERE token_hash = $1 AND revoked_at IS NULL
            AND public.admin_account_active(user_id::text)`,
        [hash],
      );
  const row = rows[0];
  if (!row) return null;
  const a = Buffer.from(row.token_hash, 'utf8');
  const b = Buffer.from(hash, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return { tokenId: row.id, userId: row.user_id, scope: row.scope };
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

const LEGACY_COLUMNS = 'id, name, prefix, created_at, last_used_at, revoked_at';
const COLUMNS = `${LEGACY_COLUMNS}, expires_at, scope, oauth_client_id, oauth_redirect_uri`;

/** The columns a row is read back with. `token_hash` is never among them. */
async function columns(db: Queryable): Promise<string> {
  return (await grantSchemaReady(db)) ? COLUMNS : LEGACY_COLUMNS;
}

function shape(r: {
  id: string;
  name: string;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  expires_at?: string | null;
  scope?: TokenScope;
  oauth_client_id?: string | null;
  oauth_redirect_uri?: string | null;
}): ApiTokenRow {
  return {
    id: r.id,
    name: r.name,
    prefix: r.prefix,
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
    revokedAt: r.revoked_at,
    expiresAt: r.expires_at ?? null,
    scope: r.scope ?? 'full',
    oauthClientId: r.oauth_client_id ?? null,
    oauthRedirectUri: r.oauth_redirect_uri ?? null,
  };
}

/** All of a user's tokens, newest first. */
export async function listTokens(db: Queryable, userId: string): Promise<ApiTokenRow[]> {
  const { rows } = await db.query<Parameters<typeof shape>[0]>(
    `SELECT ${await columns(db)}
       FROM api_token
      WHERE user_id = $1
      ORDER BY created_at DESC`,
    [userId],
  );
  return rows.map(shape);
}

/**
 * Tokens that still work: not revoked and not past their expiry. This is the
 * count `MAX_ACTIVE_TOKENS` caps, so a connection that lapsed unused stops
 * holding a slot without anyone having to revoke it.
 */
export async function countActiveTokens(db: Queryable, userId: string): Promise<number> {
  const live = (await grantSchemaReady(db))
    ? 'revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())'
    : 'revoked_at IS NULL';
  const { rows } = await db.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM api_token WHERE user_id = $1 AND ${live}`,
    [userId],
  );
  return Number(rows[0]?.count ?? '0');
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
     RETURNING ${await columns(db)}`,
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
      RETURNING ${await columns(db)}`,
    [id, userId],
  );
  const row = rows[0];
  return row ? shape(row) : null;
}
