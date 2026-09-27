import { randomBytes } from 'node:crypto';
import { generateToken, hashToken, tokenPrefix, type Queryable, type TokenScope } from './tokens.js';

/**
 * OAuth connections (migration 075, security audit SEC-07).
 *
 * A connection is the `api_token` row an approval creates: the thing Profile →
 * Agent access lists, revoke ends, and an administrator's revoke-all and
 * suspension already reach. Its working secrets rotate underneath it, in
 * `oauth_token`, so the client holds a short-lived access token and a
 * single-use refresh token instead of one secret that works forever.
 *
 * Lifetimes, and why:
 *  - **Access token, one hour.** The MCP authorization spec asks for
 *    short-lived access tokens, and Claude refreshes up to five minutes before
 *    the stored expiry and again on any 401, so an hour costs a person nothing.
 *    A copy that leaks from a log stops working within the hour.
 *  - **Refresh token, 90 days, single use.** OAuth 2.1 §4.3.1 requires public
 *    clients' refresh tokens to rotate, and every DCR client is public here.
 *    Each use returns a new pair and pushes the connection's `expires_at` out
 *    another 90 days, so a connection in use never ends, and one abandoned in
 *    a client nobody opens any more ends by itself.
 *  - **A used refresh token is a tripwire for a day.** Presented again within
 *    a minute it is most likely the client racing itself (two requests
 *    renewing at once), so it is refused and nothing else happens: the first
 *    renewal's pair stays the one live chain. Presented after that, two
 *    parties hold the chain, and the connection is revoked outright. No
 *    presentation ever issues a second pair from one refresh token, so the
 *    chain can never fork into two that renew independently.
 *
 * Every function takes the transaction client to run on, like the rest of
 * this package; the token endpoint runs them on the base pool inside one
 * transaction, because no user identity exists yet.
 */

export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
export const REFRESH_TOKEN_TTL_DAYS = 90;
const REFRESH_RACE_SECONDS = 60;
const REFRESH_TRIPWIRE_SECONDS = 24 * 60 * 60;

/** Refresh tokens never start `dsk_`, so one can never be accepted as a bearer credential. */
export const REFRESH_TOKEN_PREFIX = 'dsr_';

export interface IssuedTokens {
  /** The api_token row this pair belongs to. */
  tokenId: string;
  accessToken: string;
  refreshToken: string;
  /** Seconds until `accessToken` stops resolving — the response's `expires_in`. */
  expiresIn: number;
  scope: TokenScope;
}

export interface NewConnection {
  userId: string;
  /** Profile's label for it — see `connectionName()` in oauth.ts. */
  name: string;
  clientId: string;
  redirectUri: string;
  scope: TokenScope;
}

/**
 * Open a connection and issue its first pair. The row's own `token_hash`
 * hashes a secret that is generated here and never returned, so the row
 * itself can never be presented; only the pairs beneath it can.
 */
export async function openConnection(db: Queryable, input: NewConnection): Promise<IssuedTokens> {
  const sealed = generateToken();
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO api_token (user_id, name, token_hash, prefix, expires_at, scope, oauth_client_id, oauth_redirect_uri)
     VALUES ($1, $2, $3, $4, now() + make_interval(days => $5), $6, $7, $8)
     RETURNING id`,
    [input.userId, input.name, hashToken(sealed), tokenPrefix(sealed), REFRESH_TOKEN_TTL_DAYS, input.scope, input.clientId, input.redirectUri],
  );
  const row = rows[0];
  if (!row) throw new Error('api_token insert returned no row');
  return issuePair(db, row.id, input.scope);
}

export type RefreshOutcome =
  | { ok: true; tokens: IssuedTokens }
  /** `reused` means the connection was just revoked for it; the caller answers both the same way. */
  | { ok: false; reason: 'invalid' | 'reused' };

/**
 * Trade a refresh token for a new pair (RFC 6749 §6).
 *
 * The row lock serialises two presentations of the same token, so the second
 * always sees the first one's `used_at`. A revoked, expired or suspended
 * connection answers `invalid`, and so does a `client_id` that differs from
 * the one the connection was approved for, when the client sends one.
 */
export async function refreshConnection(
  db: Queryable,
  input: { refreshToken: string; clientId?: string },
): Promise<RefreshOutcome> {
  if (!input.refreshToken.startsWith(REFRESH_TOKEN_PREFIX)) return { ok: false, reason: 'invalid' };
  const hash = hashToken(input.refreshToken);
  const { rows } = await db.query<{
    token_id: string;
    used_at: string | null;
    racing: boolean;
    live: boolean;
    scope: TokenScope;
    oauth_client_id: string | null;
  }>(
    `SELECT o.token_id, o.used_at, o.used_at > now() - make_interval(secs => $2) AS racing, t.scope, t.oauth_client_id,
            t.revoked_at IS NULL AND (t.expires_at IS NULL OR t.expires_at > now())
              AND public.admin_account_active(t.user_id::text) AS live
       FROM oauth_token o
       JOIN api_token t ON t.id = o.token_id
      WHERE o.token_hash = $1 AND o.kind = 'refresh' AND o.expires_at > now()
      FOR UPDATE OF o`,
    [hash, REFRESH_RACE_SECONDS],
  );
  const row = rows[0];
  if (!row || !row.live) return { ok: false, reason: 'invalid' };
  if (input.clientId && row.oauth_client_id && input.clientId !== row.oauth_client_id) {
    return { ok: false, reason: 'invalid' };
  }

  if (row.used_at) {
    if (row.racing) return { ok: false, reason: 'invalid' };
    await db.query(`UPDATE api_token SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL`, [row.token_id]);
    return { ok: false, reason: 'reused' };
  }
  await db.query(
    `UPDATE oauth_token
        SET used_at = now(), expires_at = LEAST(expires_at, now() + make_interval(secs => $2))
      WHERE token_hash = $1`,
    [hash, REFRESH_TRIPWIRE_SECONDS],
  );

  // In use, so it lives on. `revoked_at IS NULL` again because a revoke may
  // have committed since the SELECT; this UPDATE waits for it and then sees it.
  const renewed = await db.query(
    `UPDATE api_token SET expires_at = now() + make_interval(days => $2)
      WHERE id = $1 AND revoked_at IS NULL
      RETURNING id`,
    [row.token_id, REFRESH_TOKEN_TTL_DAYS],
  );
  if (!renewed.rows[0]) return { ok: false, reason: 'invalid' };
  return { ok: true, tokens: await issuePair(db, row.token_id, row.scope) };
}

async function issuePair(db: Queryable, tokenId: string, scope: TokenScope): Promise<IssuedTokens> {
  const accessToken = generateToken();
  const refreshToken = REFRESH_TOKEN_PREFIX + randomBytes(32).toString('base64url');
  await db.query(
    `INSERT INTO oauth_token (token_hash, token_id, kind, expires_at) VALUES
       ($1, $3, 'access',  now() + make_interval(secs => $4)),
       ($2, $3, 'refresh', now() + make_interval(days => $5))`,
    [hashToken(accessToken), hashToken(refreshToken), tokenId, ACCESS_TOKEN_TTL_SECONDS, REFRESH_TOKEN_TTL_DAYS],
  );
  // Keep the table to live secrets and a day of tripwires. SKIP LOCKED so a
  // sweep never waits on, or deadlocks with, a refresh holding its own row.
  await db.query(
    `DELETE FROM oauth_token WHERE token_hash IN (
       SELECT token_hash FROM oauth_token WHERE expires_at < now() LIMIT 500 FOR UPDATE SKIP LOCKED)`,
  );
  return { tokenId, accessToken, refreshToken, expiresIn: ACCESS_TOKEN_TTL_SECONDS, scope };
}
