import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { consumeAuthCode } from '../oauth.js';
import { openConnection, refreshConnection } from '../grants.js';
import type { Queryable } from '../tokens.js';

describe('OAuth Deck-E improvement capability', () => {
  test('the consumed code exposes the explicitly approved capability', async () => {
    const db: Queryable = {
      async query(sql: string) {
        if (sql.includes('information_schema.columns')) return { rows: [{ ready: true }] } as never;
        assert.match(sql, /RETURNING[\s\S]*decke_improvement_read/);
        return { rows: [{
          code: 'code', client_id: 'client', user_id: 'user', redirect_uri: 'https://example.test/callback',
          code_challenge: 'challenge', resource: null, scope: 'read', decke_improvement_read: true,
        }] } as never;
      },
    };

    const consumed = await consumeAuthCode(db, 'code');
    assert.equal(consumed?.deckeImprovementRead, true);
  });

  test('opening a connection copies the code capability onto api_token', async () => {
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const db: Queryable = {
      async query(sql: string, params: unknown[] = []) {
        if (sql.includes('information_schema.columns')) return { rows: [{ ready: true }] } as never;
        statements.push({ sql, params });
        if (sql.includes('INSERT INTO api_token')) return { rows: [{ id: 'token-id' }] } as never;
        return { rows: [] } as never;
      },
    };

    await openConnection(db, {
      userId: 'user', name: 'assistant', clientId: 'client', redirectUri: 'https://example.test/callback',
      scope: 'read', deckeImprovementRead: true,
    });

    const insert = statements.find(({ sql }) => sql.includes('INSERT INTO api_token'))!;
    assert.match(insert.sql, /decke_improvement_read/);
    assert.equal(insert.params[8], true);
  });

  test('ordinary OAuth connections remain mintable before migration 078', async () => {
    const db: Queryable = {
      async query(sql: string, params: unknown[] = []) {
        if (sql.includes('information_schema.columns')) return { rows: [{ ready: false }] } as never;
        if (sql.includes('INSERT INTO api_token')) {
          assert.doesNotMatch(sql, /decke_improvement_read/);
          assert.equal(params.length, 8);
          return { rows: [{ id: 'token-id' }] } as never;
        }
        return { rows: [] } as never;
      },
    };

    await openConnection(db, {
      userId: 'user', name: 'assistant', clientId: 'client', redirectUri: 'https://example.test/callback',
      scope: 'full', deckeImprovementRead: false,
    });
  });

  test('refresh rotates child secrets without changing the connection capability', async () => {
    const statements: string[] = [];
    const db: Queryable = {
      async query(sql: string) {
        statements.push(sql);
        if (sql.includes('FROM oauth_token o')) return { rows: [{
          token_id: 'token-id', used_at: null, racing: false, live: true, scope: 'read', oauth_client_id: 'client',
        }] } as never;
        if (sql.includes('UPDATE api_token SET expires_at')) return { rows: [{ id: 'token-id' }] } as never;
        return { rows: [] } as never;
      },
    };

    const result = await refreshConnection(db, { refreshToken: `dsr_${'x'.repeat(43)}`, clientId: 'client' });
    assert.equal(result.ok, true);
    const tokenUpdates = statements.filter((sql) => /UPDATE api_token/.test(sql));
    assert.equal(tokenUpdates.length, 1);
    assert.doesNotMatch(tokenUpdates[0]!, /decke_improvement_read/);
  });
});
