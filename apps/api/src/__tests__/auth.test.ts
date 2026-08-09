import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { verifySupabaseJwt } from '../auth.js';

/**
 * Unit tests for the Supabase JWT verification used by the auth middleware.
 * These run without network access — they use a self-signed HS256 JWT with
 * a known secret. Added as part of the cloud pivot (wave 2b).
 *
 * Run: node --import tsx --test src/__tests__/auth.test.ts
 */

// ── Helpers to create test JWTs ─────────────────────────────────────────────

const TEST_SECRET = 'test-secret-at-least-32-chars-long!';

function base64UrlEncode(data: ArrayBuffer | Uint8Array): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function toBase64Url(obj: Record<string, unknown>): string {
  return base64UrlEncode(new TextEncoder().encode(JSON.stringify(obj)));
}

async function signHmac(signingInput: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signingInput));
  return base64UrlEncode(sig);
}

async function createTestJwt(
  payload: Record<string, unknown>,
  secret = TEST_SECRET,
  header: Record<string, unknown> = { alg: 'HS256', typ: 'JWT' },
): Promise<string> {
  const headerB64 = toBase64Url(header);
  const payloadB64 = toBase64Url(payload);
  const signingInput = `${headerB64}.${payloadB64}`;
  const signature = await signHmac(signingInput, secret);
  return `${signingInput}.${signature}`;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('verifySupabaseJwt', () => {
  test('accepts a valid HS256 JWT and returns the payload', async () => {
    const userId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const token = await createTestJwt({
      sub: userId,
      role: 'authenticated',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    const payload = await verifySupabaseJwt(token, TEST_SECRET);
    assert.equal(payload.sub, userId);
    assert.equal(payload.role, 'authenticated');
  });

  test('rejects a token with wrong secret', async () => {
    const token = await createTestJwt({
      sub: 'user-1',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    await assert.rejects(
      () => verifySupabaseJwt(token, 'wrong-secret-that-is-also-32-chars'),
      { message: 'invalid signature' },
    );
  });

  test('rejects an expired token', async () => {
    const token = await createTestJwt({
      sub: 'user-1',
      exp: Math.floor(Date.now() / 1000) - 60, // expired 1 minute ago
    });

    await assert.rejects(
      () => verifySupabaseJwt(token, TEST_SECRET),
      { message: 'token expired' },
    );
  });

  test('rejects a malformed token (wrong number of parts)', async () => {
    await assert.rejects(
      () => verifySupabaseJwt('not.a.valid.jwt.token', TEST_SECRET),
      { message: 'malformed JWT' },
    );

    await assert.rejects(
      () => verifySupabaseJwt('tooshort', TEST_SECRET),
      { message: 'malformed JWT' },
    );
  });

  test('rejects a token with tampered payload', async () => {
    const token = await createTestJwt({
      sub: 'user-1',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    // Tamper with the payload segment
    const parts = token.split('.');
    const tamperedPayload = toBase64Url({
      sub: 'user-2', // changed!
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const tampered = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

    await assert.rejects(
      () => verifySupabaseJwt(tampered, TEST_SECRET),
      { message: 'invalid signature' },
    );
  });

  test('accepts a token without exp (no expiry check)', async () => {
    const token = await createTestJwt({
      sub: 'user-no-exp',
      role: 'authenticated',
    });

    const payload = await verifySupabaseJwt(token, TEST_SECRET);
    assert.equal(payload.sub, 'user-no-exp');
  });

  test('rejects a non-HS256 algorithm', async () => {
    const token = await createTestJwt(
      { sub: 'user-1', exp: Math.floor(Date.now() / 1000) + 3600 },
      TEST_SECRET,
      { alg: 'RS256', typ: 'JWT' },
    );

    await assert.rejects(
      () => verifySupabaseJwt(token, TEST_SECRET),
      { message: 'unsupported algorithm: RS256' },
    );
  });
});
