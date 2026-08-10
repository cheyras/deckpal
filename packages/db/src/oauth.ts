import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Queryable } from './tokens.js';

/**
 * OAuth 2.1 + PKCE + Dynamic Client Registration (`oauth_client` / `oauth_code`,
 * migrations 031-033).
 *
 * A standards-based "Connect" flow that sits in front of the existing personal
 * access token system (tokens.ts, migration 026) rather than beside it: the
 * token endpoint's only real job is to call {@link createToken} from
 * tokens.ts once a code is verified, so every credential /mcp ever accepts —
 * whether pasted from Profile or minted by an OAuth exchange — is the exact
 * same `api_token` row, checked by the exact same code.
 *
 * Three moving parts:
 *  - **Client registration** (RFC 7591). A client self-registers once and
 *    gets an opaque `client_id` back. Every client is PUBLIC — no secret is
 *    issued, because PKCE is mandatory on every authorization request and
 *    does the job a confidential-client secret would have done here.
 *  - **Authorization codes** (RFC 6749 §4.1). Single-use, ~5 minutes, created
 *    when a signed-in user approves the consent screen, bound to exactly the
 *    (client_id, redirect_uri, code_challenge) that requested it.
 *  - **PKCE verification** (RFC 7636, S256 only — "plain" is not accepted).
 *
 * Pool-agnostic like tokens.ts: every function takes the `Queryable` to run
 * on, because /register and /token run on the bare pool (no user identity
 * exists yet) while the consent-decision endpoint runs inside the caller's
 * RLS transaction.
 */

// ── Client registration ─────────────────────────────────────────────────────

export const CLIENT_ID_PREFIX = 'dscl_';

const MAX_CLIENT_NAME_LEN = 80;
const MAX_REDIRECT_URIS = 5;
const MAX_REDIRECT_URI_LEN = 2000;

export interface OAuthClientRow {
  clientId: string;
  clientName: string;
  redirectUris: string[];
  createdAt: string;
}

export function generateClientId(): string {
  return CLIENT_ID_PREFIX + randomBytes(24).toString('base64url');
}

/** A scheme+host an OAuth redirect is allowed to target — see registerClient. */
function isAllowedRedirectUri(raw: string): boolean {
  if (raw.length === 0 || raw.length > MAX_REDIRECT_URI_LEN) return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol === 'https:') return true;
  // Loopback http is the one exception RFC 8252 / the MCP spec carve out, for
  // native and CLI clients that run their own localhost callback listener.
  if (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname)) {
    return true;
  }
  return false;
}

export class OAuthValidationError extends Error {}

/**
 * Register a new public OAuth client (RFC 7591). Throws
 * {@link OAuthValidationError} on a malformed request — the route maps that
 * to a 400 `invalid_client_metadata`, the RFC's own error code.
 */
export async function registerClient(
  db: Queryable,
  input: { clientName?: string; redirectUris: string[] },
): Promise<OAuthClientRow> {
  const redirectUris = input.redirectUris;
  if (!Array.isArray(redirectUris) || redirectUris.length === 0) {
    throw new OAuthValidationError('redirect_uris must be a non-empty array');
  }
  if (redirectUris.length > MAX_REDIRECT_URIS) {
    throw new OAuthValidationError(`redirect_uris must have at most ${MAX_REDIRECT_URIS} entries`);
  }
  for (const uri of redirectUris) {
    if (typeof uri !== 'string' || !isAllowedRedirectUri(uri)) {
      throw new OAuthValidationError(`redirect_uri must be https://, or http:// on localhost/127.0.0.1: ${String(uri)}`);
    }
  }

  const clientName = (typeof input.clientName === 'string' ? input.clientName : '')
    .replace(/[\r\n\t]/g, ' ')
    .trim()
    .slice(0, MAX_CLIENT_NAME_LEN) || 'Unnamed MCP client';

  const clientId = generateClientId();
  const { rows } = await db.query<{ client_id: string; client_name: string; redirect_uris: string[]; created_at: string }>(
    `INSERT INTO oauth_client (client_id, client_name, redirect_uris)
     VALUES ($1, $2, $3)
     RETURNING client_id, client_name, redirect_uris, created_at`,
    [clientId, clientName, redirectUris],
  );
  const row = rows[0];
  if (!row) throw new Error('oauth_client insert returned no row');
  return { clientId: row.client_id, clientName: row.client_name, redirectUris: row.redirect_uris, createdAt: row.created_at };
}

export async function getClient(db: Queryable, clientId: string): Promise<OAuthClientRow | null> {
  const { rows } = await db.query<{ client_id: string; client_name: string; redirect_uris: string[]; created_at: string }>(
    `SELECT client_id, client_name, redirect_uris, created_at FROM oauth_client WHERE client_id = $1`,
    [clientId],
  );
  const row = rows[0];
  if (!row) return null;
  return { clientId: row.client_id, clientName: row.client_name, redirectUris: row.redirect_uris, createdAt: row.created_at };
}

// ── Authorization codes ─────────────────────────────────────────────────────

const CODE_TTL_MS = 5 * 60_000;

export interface CreateAuthCodeInput {
  clientId: string;
  userId: string;
  redirectUri: string;
  codeChallenge: string;
  resource?: string | undefined;
}

export interface AuthCodeRow {
  code: string;
  clientId: string;
  userId: string;
  redirectUri: string;
  codeChallenge: string;
  resource: string | null;
}

/** `dsac_` + 32 bytes CSPRNG, base64url. A short, recognisable, single-use secret. */
export function generateAuthCode(): string {
  return 'dsac_' + randomBytes(32).toString('base64url');
}

export async function createAuthCode(
  db: Queryable,
  input: CreateAuthCodeInput,
): Promise<{ code: string; expiresAt: Date }> {
  const code = generateAuthCode();
  const expiresAt = new Date(Date.now() + CODE_TTL_MS);
  await db.query(
    `INSERT INTO oauth_code (code, client_id, user_id, redirect_uri, code_challenge, code_challenge_method, resource, expires_at)
     VALUES ($1, $2, $3, $4, $5, 'S256', $6, $7)`,
    [code, input.clientId, input.userId, input.redirectUri, input.codeChallenge, input.resource ?? null, expiresAt],
  );
  return { code, expiresAt };
}

/**
 * Atomically consume a code: the `used_at IS NULL AND expires_at > now()`
 * guard in the WHERE clause means a second exchange attempt — a retry, a
 * replay, two concurrent requests racing the same code — always loses; only
 * the first `UPDATE` to reach Postgres can ever return a row.
 */
export async function consumeAuthCode(db: Queryable, code: string): Promise<AuthCodeRow | null> {
  const { rows } = await db.query<{
    code: string;
    client_id: string;
    user_id: string;
    redirect_uri: string;
    code_challenge: string;
    resource: string | null;
  }>(
    `UPDATE oauth_code
        SET used_at = now()
      WHERE code = $1 AND used_at IS NULL AND expires_at > now()
      RETURNING code, client_id, user_id, redirect_uri, code_challenge, resource`,
    [code],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    code: row.code,
    clientId: row.client_id,
    userId: row.user_id,
    redirectUri: row.redirect_uri,
    codeChallenge: row.code_challenge,
    resource: row.resource,
  };
}

// ── PKCE (S256 only — RFC 7636 §4.2; "plain" is not accepted) ──────────────

/** `BASE64URL(SHA256(code_verifier))`, compared to the stored challenge in constant time. */
export function verifyPkceS256(codeVerifier: string, codeChallenge: string): boolean {
  if (!codeVerifier || !codeChallenge) return false;
  const computed = createHash('sha256').update(codeVerifier, 'ascii').digest('base64url');
  const a = Buffer.from(computed, 'utf8');
  const b = Buffer.from(codeChallenge, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
