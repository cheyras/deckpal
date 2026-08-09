import type { Request, Response, NextFunction } from 'express';

/**
 * Supabase JWT authentication middleware for the cloud deployment.
 *
 * Verifies the JWT from the Authorization header, extracts the user UUID
 * (`sub` claim), and attaches it to `req.user`. Routes that need the
 * authenticated user read `req.user!.id`.
 *
 * In self-host mode (no SUPABASE_JWT_SECRET set), the middleware is a no-op
 * and all routes behave as before (nginx/the SSO gate is the auth boundary).
 *
 * JWT verification uses HMAC-SHA256 (Supabase's default signing algorithm)
 * with the project's JWT secret. The middleware does NOT call Supabase's
 * network APIs — verification is entirely local.
 */

// ── Types ──────────────────────────────────────────────────────────────────────

export interface AuthUser {
  /** Supabase Auth UUID (the `sub` claim from the JWT). */
  id: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

// ── JWT helpers (no external dependency) ────────────────────────────────────────

function base64UrlDecode(s: string): Uint8Array {
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

/**
 * Verify a Supabase JWT (HS256) and return the payload.
 * Throws on invalid signature, expiry, or malformed token.
 */
export async function verifySupabaseJwt(token: string, secret: string): Promise<JwtPayload> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('malformed JWT');

  const [headerB64, payloadB64, signatureB64] = parts as [string, string, string];

  // Decode header to confirm HS256
  const header = JSON.parse(new TextDecoder().decode(base64UrlDecode(headerB64)));
  if (header.alg !== 'HS256') throw new Error(`unsupported algorithm: ${header.alg}`);

  // Verify signature using Web Crypto API (available in Node 18+)
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const signingInput = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const expectedSig = await crypto.subtle.sign('HMAC', key, signingInput);
  const expectedB64 = base64UrlEncode(expectedSig);

  if (expectedB64 !== signatureB64) throw new Error('invalid signature');

  // Decode payload
  const payload: JwtPayload = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadB64)));

  // Check expiry
  if (payload.exp !== undefined && payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('token expired');
  }

  return payload;
}

// ── Middleware ──────────────────────────────────────────────────────────────────

const JWT_SECRET = process.env.SUPABASE_JWT_SECRET ?? '';

/**
 * Auth middleware: verifies the JWT and attaches `req.user`.
 * If no JWT secret is configured (self-host), attaches nothing (routes fall
 * back to whatever user resolution they need).
 */
export function authMiddleware(req: Request, _res: Response, next: NextFunction): void {
  if (!JWT_SECRET) {
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
  verifySupabaseJwt(token, JWT_SECRET)
    .then((payload) => {
      if (!payload.sub) {
        next();
        return;
      }
      req.user = { id: payload.sub };
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
 * In self-host mode (no JWT_SECRET), all requests pass through — the reverse
 * proxy is the auth boundary.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!JWT_SECRET) {
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
