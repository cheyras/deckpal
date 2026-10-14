/**
 * POST /tokens and GET /tokens through the REAL router (migration 085): a
 * token's scope is accepted, defaulted and refused here, and the list says
 * what each token may do.
 *
 * No database and no network. Every query is answered by a fake client placed
 * in rlsStore, the seam a signed-in request runs on in SUPABASE_MODE, so the
 * route's own transaction handling (SAVEPOINT, the advisory lock, the commit
 * before the secret is shown) runs unchanged. The real-Postgres half, the
 * column grant included, is apps/api/src/__integration__/oauth.mjs.
 *
 * Run: node --import tsx --test src/__tests__/tokensRoute.test.ts
 */
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import type pg from 'pg';
import { rlsStore, closePool } from '../db.js';
import { errorMiddleware } from '../http.js';
import { requestAccessStore } from '../admin/access.js';
import { tokensRouter } from '../routes/tokens.js';

// Defensive: the pool is never connected (every query is answered by the fake
// RLS client), but pin the config so no ambient .env can reach a real database.
Object.assign(process.env, {
  PGHOST: '127.0.0.1',
  PGPORT: '9',
  PGDATABASE: 'tokens_route_no_network',
  PGUSER: 'tokens_route',
  PGPASSWORD: '',
  PGSSLMODE: 'disable',
});

const USER = '00000000-0000-4000-8000-000000000005';

interface Row {
  id: string;
  user_id: string;
  name: string;
  token_hash: string;
  prefix: string;
  created_at: string;
  last_used_at: null;
  revoked_at: null;
  scope: 'full' | 'read';
}

/**
 * A signed-in request's RLS client: migration 075 applied, 078 too, and 085
 * applied or not (`scopeGrant`). Recognises the statements the route issues
 * and throws on any other, so a new query has to be looked at here.
 */
function fakeClient({ scopeGrant = true }: { scopeGrant?: boolean } = {}) {
  const rows: Row[] = [];
  const inserts: { sql: string; params: unknown[] }[] = [];
  const client = {
    rows,
    inserts,
    escapeLiteral: (s: string) => `'${s.replace(/'/g, "''")}'`,
    async query(text: string, params: unknown[] = []) {
      const sql = text.replace(/\s+/g, ' ').trim();
      if (/^(SAVEPOINT|RELEASE SAVEPOINT|ROLLBACK TO SAVEPOINT) sp_\d+$/.test(sql)) return { rows: [] };
      if (sql.startsWith('COMMIT; BEGIN;')) return { rows: [] };
      if (sql === 'SELECT pg_advisory_xact_lock(741290064)') return { rows: [] };
      if (sql.startsWith("SELECT current_setting('request.jwt.claims',true)")) {
        return { rows: [{ claims: JSON.stringify({ sub: USER, role: 'authenticated' }) }] };
      }
      if (sql.startsWith("SELECT to_regclass('public.oauth_token')")) return { rows: [{ ready: true }] };
      if (sql.includes('information_schema.columns')) return { rows: [{ ready: true }] };
      if (sql.startsWith("SELECT has_column_privilege('public.api_token', 'scope', 'INSERT')")) {
        return { rows: [{ ready: scopeGrant }] };
      }
      if (sql.startsWith('SELECT public.admin_access($1)')) {
        return { rows: [{ access: { ready: true, suspended: false, permissions: [], role: null } }] };
      }
      if (sql.startsWith('SELECT count(*)::text AS count FROM api_token')) {
        return { rows: [{ count: String(rows.filter((r) => r.user_id === params[0]).length) }] };
      }
      if (sql.startsWith('INSERT INTO api_token')) {
        inserts.push({ sql, params });
        const namesScope = sql.startsWith('INSERT INTO api_token (user_id, name, token_hash, prefix, scope)');
        if (namesScope && !scopeGrant) throw Object.assign(new Error('permission denied for table api_token'), { code: '42501' });
        const [user_id, name, token_hash, prefix, scope] = params as [string, string, string, string, 'full' | 'read'];
        const row: Row = {
          id: `00000000-0000-4000-8000-0000000001${String(rows.length).padStart(2, '0')}`,
          user_id, name, token_hash, prefix,
          created_at: new Date().toISOString(),
          last_used_at: null,
          revoked_at: null,
          scope: namesScope ? scope : 'full',
        };
        rows.push(row);
        return { rows: [{ ...row, expires_at: null, oauth_client_id: null, oauth_redirect_uri: null, decke_improvement_read: false }] };
      }
      if (sql.startsWith('SELECT id, name, prefix') && sql.includes('FROM api_token WHERE user_id = $1')) {
        return {
          rows: rows
            .filter((r) => r.user_id === params[0])
            .map((r) => ({ ...r, expires_at: null, oauth_client_id: null, oauth_redirect_uri: null, decke_improvement_read: false })),
        };
      }
      throw new Error('fakeClient: unexpected SQL: ' + sql.slice(0, 160));
    },
  };
  return client;
}

type Fake = ReturnType<typeof fakeClient>;
let current: Fake = fakeClient();
const servers: Server[] = [];

async function start(): Promise<string> {
  const app = express();
  app.use(express.json());
  // What index.ts establishes before /tokens: a verified session (requireSession
  // already passed) and the request's RLS transaction client.
  app.use((req, _res, next) => {
    req.user = { id: USER };
    req.authKind = 'jwt';
    rlsStore.run(current as unknown as pg.PoolClient, () => requestAccessStore.run(new Map(), next));
  });
  app.use('/tokens', tokensRouter);
  app.use(errorMiddleware);
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  servers.push(server);
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const base = await start();
const mint = (body: unknown) =>
  fetch(`${base}/tokens`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

after(async () => {
  for (const s of servers) await new Promise((resolve) => s.close(resolve));
  await closePool();
});

describe('POST /tokens: scope', () => {
  test('absent means full, minted exactly as before 085', async () => {
    current = fakeClient();
    const res = await mint({ name: 'laptop' });
    assert.equal(res.status, 201);
    const body = (await res.json()) as { token: { scope: string; name: string }; secret: string };
    assert.equal(body.token.scope, 'full');
    assert.match(body.secret, /^dsk_/);
    assert.equal(current.inserts.length, 1);
    assert.ok(current.inserts[0]!.sql.startsWith('INSERT INTO api_token (user_id, name, token_hash, prefix) VALUES'));
    assert.equal(res.headers.get('cache-control'), 'no-store');
  });

  test('"full" is accepted and is the same mint', async () => {
    current = fakeClient();
    const res = await mint({ name: 'laptop', scope: 'full' });
    assert.equal(res.status, 201);
    assert.equal(((await res.json()) as { token: { scope: string } }).token.scope, 'full');
    assert.ok(current.inserts[0]!.sql.startsWith('INSERT INTO api_token (user_id, name, token_hash, prefix) VALUES'));
  });

  test('"read" mints a read-only token and the response says so', async () => {
    current = fakeClient();
    const res = await mint({ name: 'reader', scope: 'read' });
    assert.equal(res.status, 201);
    const body = (await res.json()) as { token: { scope: string; name: string; expiresAt: null }; secret: string };
    assert.equal(body.token.scope, 'read');
    assert.equal(body.token.name, 'reader');
    assert.equal(body.token.expiresAt, null);
    assert.equal(current.rows[0]!.scope, 'read');
    assert.deepEqual(current.inserts[0]!.params.slice(4), ['read']);
  });

  test('anything else is a 400 that names the two choices, and nothing is minted', async () => {
    current = fakeClient();
    for (const scope of ['admin', 'READ', 'Read only', '', null, true, 1, ['read'], { read: true }]) {
      const res = await mint({ name: 'x', scope });
      assert.equal(res.status, 400, JSON.stringify(scope));
      const body = (await res.json()) as { error: { code: string; message: string } };
      assert.equal(body.error.code, 'bad_request');
      assert.equal(body.error.message, 'scope must be "full" or "read"');
    }
    assert.equal(current.inserts.length, 0);
  });

  test('before 085, "read" is a 503 and nothing is minted, while a full token still works', async () => {
    current = fakeClient({ scopeGrant: false });
    const refused = await mint({ name: 'reader', scope: 'read' });
    assert.equal(refused.status, 503);
    assert.equal(((await refused.json()) as { error: { code: string } }).error.code, 'unavailable');
    assert.equal(current.inserts.length, 0, 'never minted full in place of the read-only token asked for');
    const full = await mint({ name: 'laptop' });
    assert.equal(full.status, 201);
    assert.equal(((await full.json()) as { token: { scope: string } }).token.scope, 'full');
  });

  test('the name is still checked first, scope or not', async () => {
    current = fakeClient();
    const res = await mint({ scope: 'read' });
    assert.equal(res.status, 400);
    assert.equal(((await res.json()) as { error: { message: string } }).error.message, 'name is required');
  });
});

describe('GET /tokens: scope', () => {
  test('every row says what it may do', async () => {
    current = fakeClient();
    assert.equal((await mint({ name: 'reader', scope: 'read' })).status, 201);
    assert.equal((await mint({ name: 'writer' })).status, 201);
    const res = await fetch(`${base}/tokens`);
    assert.equal(res.status, 200);
    const { tokens } = (await res.json()) as { tokens: { name: string; scope: string; redirect: unknown }[] };
    assert.deepEqual(tokens.map((t) => [t.name, t.scope]).sort(), [['reader', 'read'], ['writer', 'full']]);
    for (const t of tokens) assert.equal(t.redirect, null, 'a hand-made token has no OAuth redirect');
  });
});
