import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  TOKEN_PREFIX,
  countActiveTokens,
  createToken,
  generateToken,
  hashToken,
  listTokens,
  looksLikeApiToken,
  resolveToken,
  revokeToken,
  tokenPrefix,
  touchToken,
  type Queryable,
} from '@deckpal/db';

/**
 * Unit tests for personal access tokens (migration 026). No database: the
 * `Queryable` seam lets a fake stand in for pg, so these run in CI as part of
 * `test:pure` alongside the other pure suites (contract B7).
 *
 * Run: node --import tsx --test src/__tests__/tokens.test.ts
 */

// ── A minimal in-memory api_token ───────────────────────────────────────────

interface Row {
  id: string;
  user_id: string;
  name: string;
  token_hash: string;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  // Migration 075. A pre-075 database has none of these.
  expires_at?: string | null;
  scope?: 'full' | 'read';
}

/** An OAuth access token in `oauth_token` (075), resolving through its row. */
interface Secret {
  token_hash: string;
  token_id: string;
  expires_at: string;
}

const live = (r: Row): boolean =>
  r.revoked_at === null && (r.expires_at == null || Date.parse(r.expires_at) > Date.now());

/**
 * Recognises the exact statements the module issues, rather than parsing SQL —
 * the point is to pin the module's *behaviour* (what it stores, what it returns,
 * what it refuses), not to reimplement Postgres. `migrated: false` is a
 * database 075 has not reached yet: every statement must then take its old form.
 */
function fakeDb(
  rows: Row[] = [],
  { migrated = true, secrets = [] as Secret[] }: { migrated?: boolean; secrets?: Secret[] } = {},
): Queryable & { rows: Row[] } {
  let seq = rows.length;
  const out = (r: Row) => (migrated ? { expires_at: null, scope: 'full', oauth_client_id: null, oauth_redirect_uri: null, ...r } : r);
  const db = {
    rows,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async query(text: string, params: unknown[] = []): Promise<any> {
      const sql = text.replace(/\s+/g, ' ').trim();
      if (!migrated && /expires_at|oauth_token|oauth_client_id|oauth_redirect_uri|\bt\.scope\b/.test(sql) && !sql.includes('to_regclass')) {
        throw new Error(`fakeDb: pre-075 database has no such column or table: ${sql}`);
      }

      if (sql.startsWith("SELECT to_regclass('public.oauth_token')")) {
        return { rows: [{ ready: migrated }] };
      }
      if (sql.startsWith('SELECT t.id, t.user_id, t.scope, h.token_hash')) {
        const [hash] = params as [string];
        const own = rows.filter((r) => r.token_hash === hash);
        const viaSecret = secrets
          .filter((x) => x.token_hash === hash && Date.parse(x.expires_at) > Date.now())
          .map((x) => ({ ...rows.find((r) => r.id === x.token_id)!, token_hash: x.token_hash }));
        return {
          rows: [...own, ...viaSecret].filter(live).map((r) => ({ id: r.id, user_id: r.user_id, scope: r.scope ?? 'full', token_hash: r.token_hash })),
        };
      }
      if (sql.startsWith("SELECT id, user_id, 'full' AS scope, token_hash")) {
        const [hash] = params as [string];
        return { rows: rows.filter((r) => r.token_hash === hash && r.revoked_at === null).map((r) => ({ ...r, scope: 'full' })) };
      }
      if (sql.startsWith('SELECT count(*)::text AS count FROM api_token')) {
        const [userId] = params as [string];
        const counted = rows.filter((r) => r.user_id === userId && (migrated ? live(r) : r.revoked_at === null));
        return { rows: [{ count: String(counted.length) }] };
      }
      if (sql.startsWith('UPDATE api_token SET last_used_at')) {
        const [id] = params as [string];
        const r = rows.find((x) => x.id === id);
        if (r) r.last_used_at = new Date().toISOString();
        return { rows: [] };
      }
      if (sql.startsWith('SELECT id, name, prefix')) {
        const [userId] = params as [string];
        return { rows: rows.filter((r) => r.user_id === userId).map(out) };
      }
      if (sql.startsWith('INSERT INTO api_token')) {
        const [user_id, name, token_hash, prefix] = params as [string, string, string, string];
        const row: Row = {
          id: `id-${++seq}`,
          user_id,
          name,
          token_hash,
          prefix,
          created_at: new Date().toISOString(),
          last_used_at: null,
          revoked_at: null,
        };
        rows.push(row);
        return { rows: [out(row)] };
      }
      if (sql.startsWith('UPDATE api_token SET revoked_at')) {
        const [id, userId] = params as [string, string];
        const r = rows.find((x) => x.id === id && x.user_id === userId);
        if (!r) return { rows: [] };
        r.revoked_at = r.revoked_at ?? new Date().toISOString();
        return { rows: [out(r)] };
      }
      throw new Error(`fakeDb: unexpected SQL: ${sql}`);
    },
  };
  return db;
}

const USER_A = '11111111-1111-1111-1111-111111111111';
const USER_B = '22222222-2222-2222-2222-222222222222';

// ── Generation & shape ──────────────────────────────────────────────────────

describe('token generation', () => {
  test('carries the dsk_ prefix and 256 bits of entropy', () => {
    const t = generateToken();
    assert.ok(t.startsWith(TOKEN_PREFIX));
    // 32 bytes base64url = 43 chars, no padding.
    assert.equal(t.length, TOKEN_PREFIX.length + 43);
    assert.match(t.slice(TOKEN_PREFIX.length), /^[A-Za-z0-9_-]+$/);
  });

  test('never repeats', () => {
    const seen = new Set(Array.from({ length: 500 }, () => generateToken()));
    assert.equal(seen.size, 500);
  });

  test('hash is a plain hex sha256 of the raw value', () => {
    const t = generateToken();
    assert.equal(hashToken(t), createHash('sha256').update(t, 'utf8').digest('hex'));
    assert.equal(hashToken(t).length, 64);
  });

  test('display prefix is dsk_ plus eight characters', () => {
    const t = generateToken();
    assert.equal(tokenPrefix(t), t.slice(0, 12));
    assert.ok(tokenPrefix(t).startsWith(TOKEN_PREFIX));
  });

  test('a JWT is never mistaken for an api token', () => {
    assert.equal(looksLikeApiToken('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.sig'), false);
    assert.equal(looksLikeApiToken(''), false);
    assert.equal(looksLikeApiToken('dsk_'), false);
    assert.equal(looksLikeApiToken(generateToken()), true);
  });
});

// ── Persistence & verification ──────────────────────────────────────────────

describe('token lifecycle', () => {
  test('the raw value is never written to the row', async () => {
    const db = fakeDb();
    const { raw, token } = await createToken(db, USER_A, 'laptop');
    const stored = db.rows[0]!;
    assert.equal(stored.token_hash, hashToken(raw));
    assert.ok(!JSON.stringify(stored).includes(raw));
    // Nor does the row handed back to the caller.
    assert.ok(!JSON.stringify(token).includes(raw));
    assert.equal(token.prefix, raw.slice(0, 12));
  });

  test('resolves to its owner', async () => {
    const db = fakeDb();
    const { raw } = await createToken(db, USER_A, 'laptop');
    const resolved = await resolveToken(db, raw);
    assert.equal(resolved?.userId, USER_A);
  });

  test('one user cannot present another user token and become them', async () => {
    const db = fakeDb();
    const a = await createToken(db, USER_A, 'a');
    const b = await createToken(db, USER_B, 'b');
    assert.equal((await resolveToken(db, a.raw))?.userId, USER_A);
    assert.equal((await resolveToken(db, b.raw))?.userId, USER_B);
  });

  test('an unknown or malformed token resolves to nothing', async () => {
    const db = fakeDb();
    await createToken(db, USER_A, 'a');
    assert.equal(await resolveToken(db, generateToken()), null);
    assert.equal(await resolveToken(db, 'not-a-token'), null);
    assert.equal(await resolveToken(db, ''), null);
  });

  test('a revoked token stops resolving', async () => {
    const db = fakeDb();
    const { raw, token } = await createToken(db, USER_A, 'a');
    assert.ok(await resolveToken(db, raw));
    await revokeToken(db, USER_A, token.id);
    assert.equal(await resolveToken(db, raw), null);
  });

  test('revoke is idempotent and keeps the first timestamp', async () => {
    const db = fakeDb();
    const { token } = await createToken(db, USER_A, 'a');
    const first = await revokeToken(db, USER_A, token.id);
    const second = await revokeToken(db, USER_A, token.id);
    assert.ok(first?.revokedAt);
    assert.equal(second?.revokedAt, first.revokedAt);
  });

  test('revoke refuses a token owned by someone else', async () => {
    const db = fakeDb();
    const { token, raw } = await createToken(db, USER_A, 'a');
    assert.equal(await revokeToken(db, USER_B, token.id), null);
    // …and the victim's token still works.
    assert.equal((await resolveToken(db, raw))?.userId, USER_A);
  });

  test('listing is scoped to the owner and omits the hash', async () => {
    const db = fakeDb();
    await createToken(db, USER_A, 'a1');
    await createToken(db, USER_A, 'a2');
    await createToken(db, USER_B, 'b1');
    const mine = await listTokens(db, USER_A);
    assert.equal(mine.length, 2);
    assert.deepEqual(mine.map((t) => t.name).sort(), ['a1', 'a2']);
    assert.ok(!('tokenHash' in mine[0]!));
    assert.ok(!('token_hash' in mine[0]!));
  });

  test('touch stamps last_used_at', async () => {
    const db = fakeDb();
    const { token } = await createToken(db, USER_A, 'a');
    assert.equal(db.rows[0]!.last_used_at, null);
    await touchToken(db, token.id);
    assert.ok(db.rows[0]!.last_used_at);
  });
});

// ── Migration 075: expiry, scope, and the window before it lands ─────────────

describe('tokens across migration 075', () => {
  test('a token minted before 075 has no expiry, full scope, and keeps resolving after it', async () => {
    const db = fakeDb();
    const { raw } = await createToken(db, USER_A, 'claude.ai (OAuth)');
    // What a pre-075 row looks like once 075 adds its columns: NULL expiry, default scope.
    delete db.rows[0]!.expires_at;
    delete db.rows[0]!.scope;
    assert.deepEqual(await resolveToken(db, raw), { tokenId: db.rows[0]!.id, userId: USER_A, scope: 'full' });
    const [listed] = await listTokens(db, USER_A);
    assert.equal(listed?.expiresAt, null);
    assert.equal(listed?.scope, 'full');
    assert.equal(listed?.oauthRedirectUri, null);
  });

  test('before 075 is applied every statement takes its old form, and live tokens still resolve', async () => {
    const db = fakeDb([], { migrated: false });
    const { raw, token } = await createToken(db, USER_A, 'laptop');
    assert.equal(token.expiresAt, null);
    assert.equal(token.scope, 'full');
    assert.equal((await resolveToken(db, raw))?.userId, USER_A);
    assert.equal((await listTokens(db, USER_A)).length, 1);
    assert.equal(await countActiveTokens(db, USER_A), 1);
    assert.ok(await revokeToken(db, USER_A, token.id));
    // The fake throws on any 075 column or table, so reaching here proves none was named.
    assert.equal(await resolveToken(db, raw), null);
  });

  test('a token past its expiry stops resolving and stops holding a slot', async () => {
    const db = fakeDb();
    const { raw } = await createToken(db, USER_A, 'a');
    await createToken(db, USER_A, 'b');
    db.rows[0]!.expires_at = new Date(Date.now() - 1000).toISOString();
    assert.equal(await resolveToken(db, raw), null);
    assert.equal(await countActiveTokens(db, USER_A), 1);
  });

  test('a read-only token resolves with its scope, so the edges can refuse writes', async () => {
    const db = fakeDb();
    const { raw } = await createToken(db, USER_A, 'reader');
    db.rows[0]!.scope = 'read';
    assert.equal((await resolveToken(db, raw))?.scope, 'read');
  });

  test('an OAuth access token resolves through its connection, and dies with it', async () => {
    const access = generateToken();
    const soon = new Date(Date.now() + 3_600_000).toISOString();
    const secrets: Secret[] = [];
    const db = fakeDb([], { secrets });
    const { token } = await createToken(db, USER_A, 'Claude (OAuth · claude.ai)');
    db.rows[0]!.scope = 'read';
    secrets.push({ token_hash: hashToken(access), token_id: token.id, expires_at: soon });
    assert.deepEqual(await resolveToken(db, access), { tokenId: token.id, userId: USER_A, scope: 'read' });
    // An hour later the access token is gone; the connection is not, so a refresh can issue another.
    secrets[0]!.expires_at = new Date(Date.now() - 1).toISOString();
    assert.equal(await resolveToken(db, access), null);
    assert.equal(db.rows[0]!.revoked_at, null);
    secrets[0]!.expires_at = soon;
    await revokeToken(db, USER_A, token.id);
    assert.equal(await resolveToken(db, access), null);
  });
});
