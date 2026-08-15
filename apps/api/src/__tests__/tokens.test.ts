import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  TOKEN_PREFIX,
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
 * `Queryable` seam lets a fake stand in for pg, so these run in CI alongside
 * the other pure suites (contract B7).
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
}

/**
 * Recognises the exact statements the module issues, rather than parsing SQL —
 * the point is to pin the module's *behaviour* (what it stores, what it returns,
 * what it refuses), not to reimplement Postgres.
 */
function fakeDb(rows: Row[] = []): Queryable & { rows: Row[] } {
  let seq = rows.length;
  const db = {
    rows,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async query(text: string, params: unknown[] = []): Promise<any> {
      const sql = text.replace(/\s+/g, ' ').trim();

      if (sql.startsWith('SELECT id, user_id, token_hash')) {
        const [hash] = params as [string];
        return { rows: rows.filter((r) => r.token_hash === hash && r.revoked_at === null) };
      }
      if (sql.startsWith('UPDATE api_token SET last_used_at')) {
        const [id] = params as [string];
        const r = rows.find((x) => x.id === id);
        if (r) r.last_used_at = new Date().toISOString();
        return { rows: [] };
      }
      if (sql.startsWith('SELECT id, name, prefix')) {
        const [userId] = params as [string];
        return { rows: rows.filter((r) => r.user_id === userId) };
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
        return { rows: [row] };
      }
      if (sql.startsWith('UPDATE api_token SET revoked_at')) {
        const [id, userId] = params as [string, string];
        const r = rows.find((x) => x.id === id && x.user_id === userId);
        if (!r) return { rows: [] };
        r.revoked_at = r.revoked_at ?? new Date().toISOString();
        return { rows: [r] };
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
