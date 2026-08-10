import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { defaultUserId, pool } from './db.js';
import { looksLikeApiToken, resolveToken, touchToken } from '@deckscout/db';
import { makeResolveIdentity } from './identity.js';

/**
 * Supabase JWT authentication middleware for the cloud deployment.
 *
 * Verifies the JWT from the Authorization header, extracts the user UUID
 * (`sub` claim), and attaches it to `req.user`. Routes never read `req.user`
 * themselves — they call `currentUserId(req)` from `identity.js`, which is
 * total in both deployments. See that module for why.
 *
 * The same header also carries the second credential kind: a personal access
 * token (`dsk_…`, migration 026) minted in Profile → Agent access and used by
 * the MCP endpoint and other non-browser clients. The two can never be
 * confused — a JWT is three dot-separated base64url segments and never starts
 * with `dsk_`. A resolved token sets `req.user` exactly as a JWT would, plus
 * `req.authKind = 'token'` so privileged routes (token management itself) can
 * insist on a real browser session.
 *
 * Supports two signing algorithms:
 * - **ES256** (default for new Supabase projects) — verified via the project's
 *   JWKS endpoint (`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`). Keys are
 *   cached in-memory by `kid` and refetched on unknown `kid` (rate-limited to
 *   once per 60 s to prevent a bad-token stampede).
 * - **HS256** (legacy / self-hosted Supabase) — verified with the shared
 *   `SUPABASE_JWT_SECRET`.
 *
 * Dispatch is based on the token header's `alg` claim. Any other algorithm is
 * rejected.
 *
 * In self-host mode (neither SUPABASE_JWT_SECRET nor SUPABASE_URL set), the
 * middleware is a no-op and all routes behave as before (the reverse proxy is
 * the auth boundary).
 *
 * JWT verification uses Web Crypto only — no external dependencies.
 */

// ── Types ──────────────────────────────────────────────────────────────────────

export interface AuthUser {
  /** Supabase Auth UUID (the `sub` claim from the JWT). */
  id: string;
  /** Email from the JWT `email` claim (present in most Supabase JWTs). */
  email?: string;
}

/**
 * Which credential produced `req.user`. Absent when the request is anonymous.
 *
 * `'local'` is the self-host case: no credential was presented and none is
 * required, so `resolveIdentity` supplied the single local user. It can never
 * appear when Supabase auth is configured.
 */
export type AuthKind = 'jwt' | 'token' | 'local';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
      authKind?: AuthKind;
      /** `api_token.id` behind a token-authenticated request (never the raw token). */
      apiTokenId?: string;
    }
  }
}

/** Resolves a JWK by key id. Implementations may cache / fetch as needed. */
export type JwksProvider = (kid: string) => Promise<JsonWebKey>;

export interface VerifyOptions {
  /** HS256 shared secret (required when verifying HS256 tokens). */
  secret?: string;
  /** JWKS key provider for ES256 verification. */
  jwksProvider?: JwksProvider;
}

// ── JWT helpers (no external dependency) ────────────────────────────────────────

function base64UrlDecode(s: string): Uint8Array<ArrayBuffer> {
  // Base64url → standard Base64
  const padded = s.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function base64UrlEncode(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

interface JwtPayload {
  sub?: string;
  exp?: number;
  role?: string;
  aud?: string;
  [key: string]: unknown;
}

// ── JWKS cache & provider ───────────────────────────────────────────────────────

const _jwksCache = new Map<string, JsonWebKey>();
let _lastFetchMs = 0;
const JWKS_MIN_REFETCH_MS = 60_000;

/**
 * Create a JWKS provider that fetches keys from a Supabase project's
 * well-known JWKS endpoint, with in-memory caching and rate-limited refetch.
 *
 * Keys are cached by `kid`. On an unknown `kid`, the endpoint is refetched
 * at most once per {@link JWKS_MIN_REFETCH_MS} to handle key rotation without
 * enabling a bad-token stampede.
 */
export function createSupabaseJwksProvider(supabaseUrl: string): JwksProvider {
  return async (kid: string): Promise<JsonWebKey> => {
    let jwk = _jwksCache.get(kid);
    if (jwk) return jwk;

    // Unknown kid — refetch if the rate limit allows
    const now = Date.now();
    if (now - _lastFetchMs < JWKS_MIN_REFETCH_MS) {
      throw new Error(`unknown key id: ${kid}`);
    }

    const url = `${supabaseUrl}/auth/v1/.well-known/jwks.json`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
    const body = (await res.json()) as { keys: (JsonWebKey & { kid?: string })[] };

    // Replace cache entirely — rotation may have removed old keys
    _jwksCache.clear();
    for (const k of body.keys) {
      if (k.kid) _jwksCache.set(k.kid, k);
    }
    _lastFetchMs = now;

    jwk = _jwksCache.get(kid);
    if (!jwk) throw new Error(`unknown key id: ${kid}`);
    return jwk;
  };
}

// ── Verification ────────────────────────────────────────────────────────────────

/**
 * Verify a Supabase JWT and return the payload.
 *
 * Dispatches on the token header's `alg`:
 * - **HS256** — verified with a shared secret (pass as a string or
 *   `options.secret`). Rejects if no secret is available.
 * - **ES256** — verified via JWKS (`options.jwksProvider`). Rejects if no
 *   provider is available.
 * - Any other algorithm is rejected.
 *
 * Throws on invalid signature, expiry, malformed token, or missing credentials.
 *
 * @param token    Raw JWT string (three dot-separated segments).
 * @param secretOrOptions  A shared secret string (backward-compatible HS256-only
 *                         shorthand) or a {@link VerifyOptions} object.
 */
export async function verifySupabaseJwt(
  token: string,
  secretOrOptions: string | VerifyOptions,
): Promise<JwtPayload> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('malformed JWT');

  const [headerB64, payloadB64, signatureB64] = parts as [string, string, string];

  // Decode header to determine algorithm
  const header = JSON.parse(new TextDecoder().decode(base64UrlDecode(headerB64)));

  const opts: VerifyOptions =
    typeof secretOrOptions === 'string' ? { secret: secretOrOptions } : secretOrOptions;

  if (header.alg === 'HS256') {
    // ── HS256: shared-secret verification ──────────────────────────────────
    if (!opts.secret) throw new Error('HS256 requires SUPABASE_JWT_SECRET');

    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(opts.secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );

    const signingInput = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
    const expectedSig = await crypto.subtle.sign('HMAC', key, signingInput);
    const expectedB64 = base64UrlEncode(expectedSig);

    if (expectedB64 !== signatureB64) throw new Error('invalid signature');
  } else if (header.alg === 'ES256') {
    // ── ES256: JWKS verification ──────────────────────────────────────────
    if (!opts.jwksProvider) {
      throw new Error('ES256 requires SUPABASE_URL for JWKS verification');
    }
    if (!header.kid) throw new Error('ES256 token missing kid header');

    const jwk = await opts.jwksProvider(header.kid);
    const key = await crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );

    const signingInput = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
    const signatureBytes = base64UrlDecode(signatureB64);

    const valid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      signatureBytes,
      signingInput,
    );
    if (!valid) throw new Error('invalid signature');
  } else {
    throw new Error(`unsupported algorithm: ${header.alg}`);
  }

  // Decode payload
  const payload: JwtPayload = JSON.parse(
    new TextDecoder().decode(base64UrlDecode(payloadB64)),
  );

  // Check expiry
  if (payload.exp !== undefined && payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('token expired');
  }

  return payload;
}

// ── Middleware ──────────────────────────────────────────────────────────────────

const JWT_SECRET = process.env.SUPABASE_JWT_SECRET ?? '';
const SUPABASE_URL = process.env.SUPABASE_URL ?? '';

/** True when at least one auth credential source is configured. */
const AUTH_ENABLED = !!(JWT_SECRET || SUPABASE_URL);

/**
 * True when *any* Supabase environment is present. Wider than AUTH_ENABLED on
 * purpose: SUPABASE_MODE alone (RLS context configured but no verifiable
 * credential) is a broken cloud deployment, and a broken cloud deployment must
 * 401 rather than fall back to the self-host user. Gates the self-host branch
 * of `resolveIdentity` only — it never loosens JWT verification.
 */
const SUPABASE_CONFIGURED = !!(JWT_SECRET || SUPABASE_URL || process.env.SUPABASE_MODE);

/** Verification options built from environment at startup. */
const _verifyOpts: VerifyOptions = {
  ...(JWT_SECRET ? { secret: JWT_SECRET } : {}),
  ...(SUPABASE_URL ? { jwksProvider: createSupabaseJwksProvider(SUPABASE_URL) } : {}),
};

/**
 * Resolve a personal access token to `req.user`.
 *
 * Runs on the base pool, before any RLS context exists — it *has* to, because
 * the whole point of the lookup is to discover which user the request is. The
 * only row it can reach is the one matching a 256-bit secret the caller
 * already proved they hold.
 *
 * Deliberately independent of AUTH_ENABLED: a self-hoster who has run the
 * migrations can use the same tokens, and one who has not gets a swallowed
 * "relation does not exist" and the unchanged anonymous behaviour.
 */
async function applyApiToken(req: Request, raw: string): Promise<void> {
  const resolved = await resolveToken(pool, raw);
  if (!resolved) return;
  req.user = { id: resolved.userId };
  req.authKind = 'token';
  req.apiTokenId = resolved.tokenId;
  await touchToken(pool, resolved.tokenId);
}

/**
 * Auth middleware: verifies the credential and attaches `req.user`.
 * If no auth is configured (self-host) and no personal access token is
 * presented, attaches nothing (routes fall back to whatever user resolution
 * they need).
 */
export function authMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    // No credential — leave req.user undefined; requireAuth will reject if needed.
    next();
    return;
  }

  const token = authHeader.slice(7);

  // ── Personal access token (dsk_…) ──────────────────────────────────────
  if (looksLikeApiToken(token)) {
    applyApiToken(req, token)
      .catch((err: unknown) => {
        // A missing table (un-migrated self-host) or a transient DB error must
        // not 500 the request — it stays anonymous and requireAuth decides.
        console.error('[deckscout-api] api token lookup failed:', (err as Error).message);
      })
      .finally(() => next());
    return;
  }

  if (!AUTH_ENABLED) {
    // Self-host mode — no Supabase auth. The route will need its own fallback.
    next();
    return;
  }

  verifySupabaseJwt(token, _verifyOpts)
    .then((payload) => {
      if (!payload.sub) {
        next();
        return;
      }
      req.user = {
        id: payload.sub,
        ...(typeof payload.email === 'string' ? { email: payload.email } : {}),
      };
      req.authKind = 'jwt';
      next();
    })
    .catch(() => {
      // Invalid token — leave req.user undefined.
      next();
    });
}

/**
 * Settle request identity for every user-scoped route: cloud → the verified
 * JWT/token subject or 401; self-host → the single local user. Mounted once in
 * index.ts ahead of the user-scoped routers; after it, `currentUserId(req)`
 * always answers. See `identity.ts` for the contract.
 *
 * The self-host branch is doubly unreachable under Supabase: `localUserId`
 * itself rejects, and `makeResolveIdentity` asserts `supabaseConfigured` again
 * before it would ever call it.
 */
export const resolveIdentity: RequestHandler = makeResolveIdentity({
  supabaseConfigured: SUPABASE_CONFIGURED,
  localUserId: SUPABASE_CONFIGURED
    ? (): Promise<string> =>
        Promise.reject(
          new Error(
            'self-host identity fallback is unreachable when Supabase auth is configured',
          ),
        )
    : defaultUserId,
});

/**
 * Guard middleware: rejects unauthenticated requests with 401.
 * Place after `authMiddleware` on routes that require a logged-in user.
 *
 * In self-host mode (no auth configured), all requests pass through — the
 * reverse proxy is the auth boundary.
 *
 * Retained for `requireSession` below. The user-scoped mount uses
 * `resolveIdentity`, which enforces the same 401 *and* supplies the self-host
 * user that this one leaves to the route.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!AUTH_ENABLED) {
    // Self-host: no Supabase auth, requests pass through.
    // Identity has already been settled by resolveIdentity.
    next();
    return;
  }
  if (!req.user) {
    res.status(401).json({ error: { code: 'unauthorized', message: 'Authentication required' } });
    return;
  }
  next();
}

/**
 * Stricter guard for routes a personal access token must never reach — the
 * account itself rather than its contents. A leaked token can read and write
 * the collection it was issued for (that is what it is for), but it cannot mint
 * a second credential, revoke the ones that would let the owner cut it off, or
 * change the face on the account.
 *
 * The message is deliberately about the ACCOUNT, not about tokens: this guard
 * started life in front of `/tokens` alone and said "cannot manage tokens",
 * which became a lie the moment `/avatar` was mounted behind it. Anything added
 * here in future is account administration by definition, so the general
 * sentence stays true.
 *
 * Self-host (no Supabase auth) keeps the pass-through posture of requireAuth,
 * except that a token-authenticated request is still refused: there the
 * reverse proxy is the boundary, and a token holder is by definition not
 * behind it.
 */
export function requireSession(req: Request, res: Response, next: NextFunction): void {
  if (req.authKind === 'token') {
    res.status(403).json({
      error: {
        code: 'forbidden',
        message: 'Personal access tokens cannot change account settings. Sign in to the web app.',
      },
    });
    return;
  }
  requireAuth(req, res, next);
}
