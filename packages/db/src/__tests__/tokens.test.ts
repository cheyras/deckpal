import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hashToken, resolveToken, type Queryable } from '../tokens.js';

test('resolveToken carries the live improvement capability', async () => {
  const raw = 'dsk_' + 'x'.repeat(43);
  const db: Queryable = {
    async query(sql: string) {
      if (sql.includes("to_regclass('public.oauth_token')")) return { rows: [{ ready: true }] } as never;
      if (sql.includes('information_schema.columns')) return { rows: [{ ready: true }] } as never;
      assert.match(sql, /t\.decke_improvement_read/);
      return { rows: [{ id: 'token', user_id: 'user', scope: 'read', token_hash: hashToken(raw), decke_improvement_read: true }] } as never;
    },
  };
  assert.deepEqual(await resolveToken(db, raw), {
    tokenId: 'token', userId: 'user', scope: 'read', deckeImprovementRead: true,
  });
});

test('resolveToken defaults the capability off before migration 078', async () => {
  const raw = 'dsk_' + 'y'.repeat(43);
  const db: Queryable = {
    async query(sql: string) {
      if (sql.includes("to_regclass('public.oauth_token')")) return { rows: [{ ready: true }] } as never;
      if (sql.includes('information_schema.columns')) return { rows: [{ ready: false }] } as never;
      assert.match(sql, /false AS decke_improvement_read/);
      return { rows: [{ id: 'token', user_id: 'user', scope: 'full', token_hash: hashToken(raw), decke_improvement_read: false }] } as never;
    },
  };
  assert.equal((await resolveToken(db, raw))?.deckeImprovementRead, false);
});
