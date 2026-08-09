import type { Request, Response, NextFunction } from 'express';

/**
 * Supabase JWT authentication middleware for the cloud deployment.
 *
 * Verifies the JWT from the Authorization header, extracts the user UUID
 * (`sub` claim), and attaches it to `req.user`. Routes that need the
 * authenticated user read `req.user!.id`.
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

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
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

/** Verification options built from environment at startup. */
const _verifyOpts: VerifyOptions = {
  ...(JWT_SECRET ? { secret: JWT_SECRET } : {}),
  ...(SUPABASE_URL ? { jwksProvider: createSupabaseJwksProvider(SUPABASE_URL) } : {}),
};

/**
 * Auth middleware: verifies the JWT and attaches `req.user`.
 * If no auth is configured (self-host), attaches nothing (routes fall
 * back to whatever user resolution they need).
 */
export function authMiddleware(req: Request, _res: Response, next: NextFunction): void {
  if (!AUTH_ENABLED) {
    // Self-host mode — no Supabase auth. The route will need its own fallback.
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    // No token — leave req.user undefined; requireAuth will reject if needed.
    next();
    return;
  }

  const token = authHeader.slice(7);
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
      next();
    })
    .catch(() => {
      // Invalid token — leave req.user undefined.
      next();
    });
}

/**
 * Guard middleware: rejects unauthenticated requests with 401.
 * Place after `authMiddleware` on routes that require a logged-in user.
 *
 * In self-host mode (no auth configured), all requests pass through — the
 * reverse proxy is the auth boundary.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!AUTH_ENABLED) {
    // Self-host: no Supabase auth, requests pass through.
    // Routes that need a user id will use the self-host fallback in db.ts.
    next();
    return;
  }
  if (!req.user) {
    res.status(401).json({ error: { code: 'unauthorized', message: 'Authentication required' } });
    return;
  }
  next();
}
