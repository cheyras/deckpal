import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

/**
 * OAuth connections against real PostgreSQL (migration 075, security audit
 * SEC-07), run by admin.mjs's cloud mode on its runner-owned database.
 *
 * Two halves, because the promise that matters most spans the migration:
 * every token that exists before 075 keeps working after it, unchanged.
 * `legacyTokensBefore075` mints tokens on the pre-075 schema and proves they
 * resolve through the old statements; `runOAuthIntegration` runs after 075
 * and checks them again, then drives the whole connection lifecycle through
 * the real Express routes: consent with a scope, the code exchange, refresh
 * rotation, reuse revoking the connection, read-only refusals, expiry, and
 * which columns a signed-in user may still write directly.
 */

const sha = (raw) => createHash('sha256').update(raw, 'utf8').digest('hex');

export async function legacyTokensBefore075({ db, id, test }) {
  const { generateToken, hashToken, resolveToken, tokenPrefix } = await import('@deckpal/db');
  const legacy = { manual: generateToken(), connector: generateToken() };
  await test('before 075: a hand-made token and an OAuth-minted one resolve through the old statements', async () => {
    assert.equal((await db.query("SELECT to_regclass('public.oauth_token') AS t")).rows[0].t, null);
    for (const [name, raw] of [['laptop', legacy.manual], ['Claude (OAuth)', legacy.connector]]) {
      await db.query('INSERT INTO api_token(user_id,name,token_hash,prefix) VALUES($1,$2,$3,$4)', [id(6), name, hashToken(raw), tokenPrefix(raw)]);
      const resolved = await resolveToken(db, raw);
      assert.equal(resolved?.userId, id(6));
      assert.equal(resolved?.scope, 'full');
    }
  });
  return legacy;
}

export async function runOAuthIntegration({ db, as, id, test, legacy }) {
  const tokens = await import('@deckpal/db');
  const { resolveToken, listTokens, countActiveTokens } = tokens;

  await test('075 changes nothing for a token that existed before it', async () => {
    for (const raw of Object.values(legacy)) {
      const resolved = await resolveToken(db, raw);
      assert.equal(resolved?.userId, id(6));
      assert.equal(resolved?.scope, 'full');
    }
    const listed = await listTokens(db, id(6));
    assert.equal(listed.length, 2);
    for (const t of listed) {
      assert.equal(t.expiresAt, null, 'no expiry was invented for an existing token');
      assert.equal(t.scope, 'full');
      assert.equal(t.oauthClientId, null);
    }
  });

  const { default: express } = await import('express');
  const database = await import('../db.ts');
  const { oauthRouter } = await import('../routes/oauth.ts');
  const { tokensRouter } = await import('../routes/tokens.ts');
  const { authMiddleware, enforceTokenScope, requireSession } = await import('../auth.ts');
  const { mountOAuthServer } = await import('../oauthServer.ts');
  const { errorMiddleware } = await import('../http.ts');
  const { requestAccessStore } = await import('../admin/access.ts');

  const app = express();
  app.use(express.json());
  mountOAuthServer(app);
  // The signed-in browser half, on a fixture session exactly as admin.mjs does.
  const session = express.Router();
  session.use(async (req, res, next) => {
    const user = String(req.headers['x-fixture-user'] ?? id(5));
    req.user = { id: user };
    req.authKind = 'jwt';
    const c = await database.pool.connect();
    await c.query('BEGIN');
    await c.query("SELECT set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: user, role: 'authenticated', deckpal_auth_kind: 'jwt' })]);
    await c.query('SET LOCAL ROLE authenticated');
    let released = false;
    const cleanup = async () => {
      if (released) return;
      released = true;
      try { await c.query('ROLLBACK; RESET ROLE'); c.release(); } catch { c.release(true); }
    };
    res.once('finish', cleanup);
    res.once('close', cleanup);
    database.rlsStore.run(c, () => requestAccessStore.run(new Map(), next));
  });
  session.use('/oauth', oauthRouter);
  session.use('/tokens', requireSession, tokensRouter);
  app.use('/s', session);
  // The token half: the real credential middleware and the scope guard.
  app.use('/t', authMiddleware, enforceTokenScope, (req, res) => {
    res.json({ user: req.user?.id ?? null, kind: req.authKind ?? null, scope: req.tokenScope ?? null });
  });
  app.use(errorMiddleware);

  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const request = (path, options = {}) => fetch(base + path, { signal: AbortSignal.timeout(10000), ...options });
  const json = (body) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const form = (body) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() });
  const bearer = (token, method = 'GET') => request('/t', { method, headers: { authorization: 'Bearer ' + token } });

  async function register(name, redirect) {
    const res = await request('/register', json({ client_name: name, redirect_uris: [redirect] }));
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.deepEqual(body.grant_types, ['authorization_code', 'refresh_token']);
    return body.client_id;
  }
  async function connect(clientId, redirect, scope) {
    const verifier = 'v'.repeat(64);
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const decision = await request('/s/oauth/authorize/decision', json({
      decision: 'allow', clientId, redirectUri: redirect, responseType: 'code', codeChallenge: challenge, codeChallengeMethod: 'S256', ...(scope ? { scope } : {}),
    }));
    if (decision.status !== 200) assert.fail('consent decision: ' + decision.status + ' ' + (await decision.text()));
    const code = new URL((await decision.json()).redirectTo).searchParams.get('code');
    // Claude sends the exchange form-encoded, so that is what is exercised.
    const exchange = await request('/token', form({ grant_type: 'authorization_code', code, client_id: clientId, redirect_uri: redirect, code_verifier: verifier }));
    if (exchange.status !== 200) assert.fail('code exchange: ' + exchange.status + ' ' + (await exchange.text()));
    assert.equal(exchange.headers.get('cache-control'), 'no-store');
    return exchange.json();
  }
  const refresh = (clientId, refreshToken) => request('/token', form({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId }));
  const connection = async (accessToken) => (await db.query(
    'SELECT t.* FROM oauth_token o JOIN api_token t ON t.id=o.token_id WHERE o.token_hash=$1', [sha(accessToken)])).rows[0];

  const LOOKALIKE = 'https://evil.example/cb';
  const CLAUDE = 'https://claude.ai/api/mcp/auth_callback';

  try {
    const metadata = await (await request('/.well-known/oauth-authorization-server')).json();
    assert.deepEqual(metadata.grant_types_supported, ['authorization_code', 'refresh_token']);
    assert.deepEqual(metadata.scopes_supported, ['offline_access']);

    const lookalike = await register('Claude', LOOKALIKE);
    const claude = await register('claudeai', CLAUDE);

    await test('consent facts name the destination, and only a known callback is verified', async () => {
      const shown = await (await request('/s/oauth/client?client_id=' + lookalike + '&redirect_uri=' + encodeURIComponent(LOOKALIKE))).json();
      assert.deepEqual(shown, { clientName: 'Claude', redirectUri: LOOKALIKE, redirectHost: 'evil.example', trust: 'unverified', verifiedName: null });
      const real = await (await request('/s/oauth/client?client_id=' + claude + '&redirect_uri=' + encodeURIComponent(CLAUDE))).json();
      assert.equal(real.trust, 'verified');
      assert.equal(real.verifiedName, 'Claude');
      const bad = await request('/s/oauth/authorize/decision', json({ decision: 'allow', clientId: claude, redirectUri: CLAUDE, responseType: 'code', codeChallenge: 'x'.repeat(43), codeChallengeMethod: 'S256', scope: 'admin' }));
      assert.equal(bad.status, 400);
    });

    let reader;
    await test('a read-only approval mints a renewing pair on a connection named for where it went', async () => {
      reader = await connect(lookalike, LOOKALIKE, 'read');
      assert.match(reader.access_token, /^dsk_/);
      assert.match(reader.refresh_token, /^dsr_/);
      assert.equal(reader.token_type, 'Bearer');
      assert.equal(reader.expires_in, 3600);
      const row = await connection(reader.access_token);
      assert.equal(row.name, 'Claude (OAuth · evil.example)');
      assert.equal(row.scope, 'read');
      assert.equal(row.oauth_client_id, lookalike);
      assert.equal(row.oauth_redirect_uri, LOOKALIKE);
      assert.notEqual(row.token_hash, sha(reader.access_token), 'the row\'s own hash is sealed, not the access token');
      const days = (Date.parse(row.expires_at) - Date.now()) / 86_400_000;
      assert.ok(days > 89.9 && days <= 90, 'connection lapses 90 days out: ' + days);
      const listed = (await (await request('/s/tokens')).json()).tokens.find((t) => t.id === row.id);
      assert.deepEqual(listed.redirect, { host: 'evil.example', trust: 'unverified', verifiedName: null });
      assert.equal(listed.scope, 'read');
    });

    await test('a read-only token reads and is refused every write; a refresh token is never a bearer credential', async () => {
      assert.deepEqual(await (await bearer(reader.access_token)).json(), { user: id(5), kind: 'token', scope: 'read' });
      for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
        const refused = await bearer(reader.access_token, method);
        assert.equal(refused.status, 403, method);
        assert.equal((await refused.json()).error.code, 'insufficient_scope');
      }
      assert.deepEqual(await (await bearer(reader.refresh_token)).json(), { user: null, kind: null, scope: null });
      // The one POST that writes nothing (set_cart's cart links) still gets through.
      const cart = await request('/t/massentry', { method: 'POST', headers: { authorization: 'Bearer ' + reader.access_token } });
      assert.equal(cart.status, 200);
    });

    let second;
    await test('refresh rotates: a new pair, the old access token lives out its hour, a second use inside a minute is refused without forking', async () => {
      const r1 = await refresh(lookalike, reader.refresh_token);
      assert.equal(r1.status, 200);
      second = await r1.json();
      assert.notEqual(second.access_token, reader.access_token);
      assert.notEqual(second.refresh_token, reader.refresh_token);
      assert.equal((await resolveToken(db, second.access_token))?.scope, 'read', 'scope survives renewal');
      assert.ok(await resolveToken(db, reader.access_token));
      const racing = await refresh(lookalike, reader.refresh_token);
      assert.equal(racing.status, 400, 'one refresh token never yields a second pair');
      assert.equal((await connection(second.access_token)).revoked_at, null, 'a race inside a minute is not treated as theft');
      assert.ok(await resolveToken(db, second.access_token), 'the first renewal stays the live chain');
      const tripwire = (await db.query('SELECT expires_at FROM oauth_token WHERE token_hash=$1', [sha(reader.refresh_token)])).rows[0];
      assert.ok(Date.parse(tripwire.expires_at) - Date.now() <= 86_400_000, 'a used refresh token is kept only a day');
    });

    await test('a used refresh token presented after the grace minute revokes the whole connection', async () => {
      await db.query("UPDATE oauth_token SET used_at=now()-interval '2 minutes' WHERE token_hash=$1", [sha(reader.refresh_token)]);
      const replay = await refresh(lookalike, reader.refresh_token);
      assert.equal(replay.status, 400);
      assert.equal((await replay.json()).error, 'invalid_grant');
      assert.ok((await connection(second.access_token)).revoked_at);
      for (const raw of [reader.access_token, second.access_token]) assert.equal(await resolveToken(db, raw), null);
      assert.equal((await refresh(lookalike, second.refresh_token)).status, 400, 'the thief\'s chain is dead too');
    });

    let full;
    await test('a full connection writes; a wrong client_id, an expired access token and a lapse behave', async () => {
      full = await connect(claude, CLAUDE);
      assert.equal((await connection(full.access_token)).name, 'Claude (OAuth · claude.ai)');
      assert.equal((await bearer(full.access_token, 'POST')).status, 200);
      const wrong = await refresh(lookalike, full.refresh_token);
      assert.equal(wrong.status, 400);
      assert.equal((await connection(full.access_token)).revoked_at, null, 'a mismatch is refused, not treated as theft');
      await db.query("UPDATE oauth_token SET expires_at=now()-interval '1 second' WHERE token_hash=$1", [sha(full.access_token)]);
      assert.equal(await resolveToken(db, full.access_token), null, 'an access token lasts its hour and no longer');
      const renewed = await refresh(claude, full.refresh_token);
      assert.equal(renewed.status, 200, 'the connection itself is fine, so it renews');
      full = await renewed.json();
      assert.equal((await db.query('SELECT count(*)::int n FROM oauth_token WHERE expires_at < now()')).rows[0].n, 0, 'the sweep keeps only live secrets');
      const before = await countActiveTokens(db, id(5));
      const row = await connection(full.access_token);
      await db.query("UPDATE api_token SET expires_at=now()-interval '1 second' WHERE id=$1", [row.id]);
      assert.equal(await resolveToken(db, full.access_token), null, 'a lapsed connection ends its access tokens');
      assert.equal((await refresh(claude, full.refresh_token)).status, 400);
      assert.equal(await countActiveTokens(db, id(5)), before - 1, 'and stops holding a MAX_ACTIVE_TOKENS slot');
    });

    await test('revoking a connection in Profile ends every secret it issued', async () => {
      const again = await connect(claude, CLAUDE);
      const row = await connection(again.access_token);
      assert.equal((await request('/s/tokens/' + row.id, { method: 'DELETE' })).status, 200);
      assert.equal(await resolveToken(db, again.access_token), null);
      assert.equal((await refresh(claude, again.refresh_token)).status, 400);
    });

    await test('a signed-in user can no longer rewrite a connection\'s scope or expiry, or see its secrets', async () => {
      const row = await connection(reader.access_token);
      const denied = (sql, args) => assert.rejects(as(id(5), (c) => c.query(sql, args)), (e) => e.code === '42501', sql);
      await denied("UPDATE api_token SET scope='full' WHERE id=$1", [row.id]);
      await denied("UPDATE api_token SET expires_at=now()+interval '10 years' WHERE id=$1", [row.id]);
      await denied("UPDATE api_token SET oauth_redirect_uri='https://claude.ai/api/mcp/auth_callback' WHERE id=$1", [row.id]);
      await denied("INSERT INTO api_token(user_id,name,token_hash,prefix,scope) VALUES($1,'x',repeat('c',64),'dsk_cccccccc','full')", [id(5)]);
      await denied('SELECT * FROM oauth_token', []);
      // What the app itself does as the user still works: minting and revoking.
      await as(id(5), (c) => c.query("INSERT INTO api_token(user_id,name,token_hash,prefix) VALUES($1,'direct',repeat('d',64),'dsk_dddddddd')", [id(5)]));
      await as(id(5), (c) => c.query('UPDATE api_token SET revoked_at=COALESCE(revoked_at,now()), last_used_at=now() WHERE user_id=$1', [id(5)]));
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}
