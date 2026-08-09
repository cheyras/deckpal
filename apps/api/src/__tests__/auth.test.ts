import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { verifySupabaseJwt, type JwksProvider } from '../auth.js';

/**
 * Unit tests for the Supabase JWT verification used by the auth middleware.
 * These run without network access — they use self-signed JWTs with known keys.
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

// ── ES256 helpers ──────────────────────────────────────────────────────────────

const EC_KID = 'test-ec-kid-1';

let _ecKeyPair: CryptoKeyPair | undefined;
let _ecPublicJwk: JsonWebKey | undefined;

async function getEcKeyPair(): Promise<{ keyPair: CryptoKeyPair; publicJwk: JsonWebKey }> {
  if (!_ecKeyPair || !_ecPublicJwk) {
    _ecKeyPair = await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign', 'verify'],
    );
    _ecPublicJwk = await crypto.subtle.exportKey('jwk', _ecKeyPair.publicKey);
  }
  return { keyPair: _ecKeyPair, publicJwk: _ecPublicJwk! };
}

async function createEs256Jwt(
  payload: Record<string, unknown>,
  privateKey: CryptoKey,
  kid: string = EC_KID,
): Promise<string> {
  const headerB64 = toBase64Url({ alg: 'ES256', typ: 'JWT', kid });
  const payloadB64 = toBase64Url(payload);
  const signingInput = `${headerB64}.${payloadB64}`;
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${base64UrlEncode(sig)}`;
}

/** Test-only JWKS provider backed by a static map. */
function testJwksProvider(jwks: Map<string, JsonWebKey>): JwksProvider {
  return async (kid: string) => {
    const jwk = jwks.get(kid);
    if (!jwk) throw new Error(`unknown key id: ${kid}`);
    return jwk;
  };
}

// ── HS256 Tests ────────────────────────────────────────────────────────────────

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

  test('rejects a non-HS256/ES256 algorithm', async () => {
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

  test('HS256 works with options object', async () => {
    const token = await createTestJwt({
      sub: 'user-opts',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    const payload = await verifySupabaseJwt(token, { secret: TEST_SECRET });
    assert.equal(payload.sub, 'user-opts');
  });
});

// ── ES256 Tests ────────────────────────────────────────────────────────────────

describe('verifySupabaseJwt (ES256)', () => {
  test('accepts a valid ES256 JWT and returns the payload', async () => {
    const { keyPair, publicJwk } = await getEcKeyPair();
    const userId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const token = await createEs256Jwt(
      { sub: userId, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600, email: 'test@example.com' },
      keyPair.privateKey,
    );

    const jwks = new Map<string, JsonWebKey>([[EC_KID, publicJwk]]);
    const payload = await verifySupabaseJwt(token, { jwksProvider: testJwksProvider(jwks) });
    assert.equal(payload.sub, userId);
    assert.equal(payload.role, 'authenticated');
    assert.equal(payload.email, 'test@example.com');
  });

  test('rejects an ES256 token verified with wrong key', async () => {
    const { keyPair } = await getEcKeyPair();
    const token = await createEs256Jwt(
      { sub: 'user-1', exp: Math.floor(Date.now() / 1000) + 3600 },
      keyPair.privateKey,
    );

    // Generate a different keypair for verification
    const wrongKp = await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign', 'verify'],
    );
    const wrongPub = await crypto.subtle.exportKey('jwk', wrongKp.publicKey);
    const jwks = new Map<string, JsonWebKey>([[EC_KID, wrongPub]]);

    await assert.rejects(
      () => verifySupabaseJwt(token, { jwksProvider: testJwksProvider(jwks) }),
      { message: 'invalid signature' },
    );
  });

  test('rejects an ES256 token with tampered payload', async () => {
    const { keyPair, publicJwk } = await getEcKeyPair();
    const token = await createEs256Jwt(
      { sub: 'user-1', exp: Math.floor(Date.now() / 1000) + 3600 },
      keyPair.privateKey,
    );

    // Tamper with the payload segment
    const parts = token.split('.');
    const tamperedPayload = toBase64Url({
      sub: 'user-2',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const tampered = `${parts[0]}.${tamperedPayload}.${parts[2]}`;
    const jwks = new Map<string, JsonWebKey>([[EC_KID, publicJwk]]);

    await assert.rejects(
      () => verifySupabaseJwt(tampered, { jwksProvider: testJwksProvider(jwks) }),
      { message: 'invalid signature' },
    );
  });

  test('rejects an expired ES256 token', async () => {
    const { keyPair, publicJwk } = await getEcKeyPair();
    const token = await createEs256Jwt(
      { sub: 'user-1', exp: Math.floor(Date.now() / 1000) - 60 },
      keyPair.privateKey,
    );

    const jwks = new Map<string, JsonWebKey>([[EC_KID, publicJwk]]);

    await assert.rejects(
      () => verifySupabaseJwt(token, { jwksProvider: testJwksProvider(jwks) }),
      { message: 'token expired' },
    );
  });

  test('rejects an ES256 token with unknown kid', async () => {
    const { keyPair, publicJwk } = await getEcKeyPair();
    const token = await createEs256Jwt(
      { sub: 'user-1', exp: Math.floor(Date.now() / 1000) + 3600 },
      keyPair.privateKey,
      'unknown-kid',
    );

    // Provider only knows about EC_KID, not 'unknown-kid'
    const jwks = new Map<string, JsonWebKey>([[EC_KID, publicJwk]]);

    await assert.rejects(
      () => verifySupabaseJwt(token, { jwksProvider: testJwksProvider(jwks) }),
      { message: 'unknown key id: unknown-kid' },
    );
  });

  test('rejects ES256 when no jwksProvider is given', async () => {
    const { keyPair } = await getEcKeyPair();
    const token = await createEs256Jwt(
      { sub: 'user-1', exp: Math.floor(Date.now() / 1000) + 3600 },
      keyPair.privateKey,
    );

    await assert.rejects(
      () => verifySupabaseJwt(token, { secret: TEST_SECRET }),
      { message: 'ES256 requires SUPABASE_URL for JWKS verification' },
    );
  });
});
