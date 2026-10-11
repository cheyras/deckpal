/**
 * Invoked only by scripts/test-db-integration.mjs. Applies EVERY migration with
 * the real runner, then asks what someone could do directly over PostgREST, as
 * the anon key or as a different signed-in user. That question, answered badly,
 * was three findings of the 2026-09-26 security audit (SEC-01, SEC-02, SEC-10),
 * and the enumeration below is meant to catch the next table or view that
 * answers it badly, not only those three.
 *
 * `self-host` runs before the runner creates any Supabase role: plain Postgres,
 * SUPABASE_MODE unset, proving migration 072 applies there (it is deliberately
 * not @supabase-only). `cloud` adds the roles, Supabase's default grants and the
 * auth stubs, and measures reach.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../../..');
const root = process.env.DECKPAL_TEST_ROOT;
const mode = process.env.DECKPAL_TEST_REACH_MODE;
assert.ok(mode === 'self-host' || mode === 'cloud');
assert.ok(root && /^\/tmp\/deckpal-db-[^/]+$/.test(root), 'This child requires a runner-owned disposable root.');
assert.equal(realpathSync(root), root);
assert.equal(readFileSync(join(root, '.deckpal-ci-owner'), 'utf8'), process.env.DECKPAL_TEST_MARKER);
assert.equal(process.env.PGHOST, join(root, 'socket'));
assert.equal(process.env.PGPORT, '55432');
assert.equal(process.env.PGUSER, 'deckpal_ci_fixture');
assert.equal(process.env.PGDATABASE, 'deckpal_ci_reach_' + mode.replace('-', '_'));
assert.equal(dirname(process.env.DECKPAL_TEST_RESULT), root);
assert.equal(existsSync(join(REPO, '.env')), false);
assert.equal(process.env.DATABASE_URL, undefined);
assert.ok(!Object.keys(process.env).some((key) => /^SUPABASE/.test(key)), 'Supabase environment must not reach integration imports.');

const config = { host: process.env.PGHOST, port: Number(process.env.PGPORT), user: process.env.PGUSER, database: process.env.PGDATABASE, ssl: false };
const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
// World-readable on purpose: the public /u/{name} profile (DECISIONS.md,
// 2026-08-10 "Profile photos"). Every other per-user relation must answer zero.
const PUBLIC_BY_DESIGN = new Set(['user_profile', 'user_showcase']);
const db = new pg.Client(config);
const results = { name: 'reach-' + mode, status: 'running', cases: [] };

async function test(name, fn) {
  await fn();
  results.cases.push({ name, status: 'passed' });
  console.log('PASS ' + name);
}
const rejects = (promise, code) => assert.rejects(promise, (e) => { assert.equal(e.code, code, e.message); return true; });

/**
 * The real decks router behind the real RLS request session, as user A — or
 * as whoever the request's `x-test-user` names, for the cross-account cases.
 */
async function decksApp() {
  const { default: express } = await import('express');
  const database = await import('../db.ts');
  const { decksRouter } = await import('../routes/decks.ts');
  const { errorMiddleware } = await import('../http.ts');
  const { requestAccessStore } = await import('../admin/access.ts');
  const app = express();
  app.use(express.json());
  app.use(async (req, res, next) => {
    const user = req.get('x-test-user') ?? A;
    req.user = { id: user };
    req.authKind = 'jwt';
    const c = await database.pool.connect();
    await c.query(`BEGIN; SELECT set_config('request.jwt.claims', $$${JSON.stringify({ sub: user, role: 'authenticated', deckpal_auth_kind: 'jwt', deckpal_server_request: true })}$$, true); SET LOCAL role = 'authenticated'`);
    let done = false;
    const finish = async (sql) => { if (done) return; done = true; try { await c.query(sql); c.release(); } catch { c.release(true); } };
    res.once('finish', () => void finish('COMMIT; RESET ROLE'));
    res.once('close', () => void finish('ROLLBACK; RESET ROLE'));
    database.rlsStore.run(c, () => requestAccessStore.run(new Map(), next));
  });
  app.use('/decks', decksRouter);
  app.use(errorMiddleware);
  const server = await new Promise((resolveServer) => { const s = app.listen(0, '127.0.0.1', () => resolveServer(s)); });
  const post = async (path, body, user) => {
    const r = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...(user ? { 'x-test-user': user } : {}) },
      body: JSON.stringify(body), signal: AbortSignal.timeout(10000),
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  return { server, post };
}

/** One transaction as `role` (with `user` as the JWT subject), always rolled back. */
async function as(role, user, fn, extraClaims = {}) {
  assert.ok(role === 'anon' || role === 'authenticated');
  const c = new pg.Client(config);
  await c.connect();
  try {
    await c.query('BEGIN');
    if (user) await c.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: user, role, ...extraClaims })]);
    await c.query('SET LOCAL ROLE ' + role);
    return await fn(c);
  } finally {
    await c.query('ROLLBACK').catch(() => {});
    await c.end();
  }
}

/** The API's server-authored claim, committed so accounting can be read back. */
async function asServer(user, fn) {
  const c = new pg.Client(config);
  await c.connect();
  try {
    await c.query('BEGIN');
    await c.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({
      sub: user, role: 'authenticated', deckpal_auth_kind: 'jwt', deckpal_server_request: true,
    })]);
    await c.query('SET LOCAL ROLE authenticated');
    const result = await fn(c);
    await c.query('COMMIT');
    return result;
  } catch (error) {
    await c.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { await c.end(); }
}

/** Every relation in `public` that carries an owner, and which client roles may SELECT it. */
async function perUserRelations() {
  return (await db.query(`
    SELECT c.relname, CASE WHEN c.relname = 'app_user' THEN 'id' ELSE 'user_id' END AS owner,
           has_table_privilege('anon', c.oid, 'SELECT') AS anon,
           has_table_privilege('authenticated', c.oid, 'SELECT') AS authenticated
      FROM pg_class c
     WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
       AND (c.relname = 'app_user' OR EXISTS (
             SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'user_id' AND NOT a.attisdropped))
     ORDER BY c.relname`)).rows;
}

/** Relations where `role` can see A's rows: anon sees any row at all, B sees A's. */
async function leaks(role, user) {
  const found = [];
  for (const r of await perUserRelations()) {
    if (!r[role] || PUBLIC_BY_DESIGN.has(r.relname)) continue;
    const sql = `SELECT count(*)::int AS n FROM public.${db.escapeIdentifier(r.relname)}`
      + (user ? ` WHERE ${db.escapeIdentifier(r.owner)}::text = $1` : '');
    const n = await as(role, user, async (c) => (await c.query(sql, user ? [A] : [])).rows[0].n);
    if (n > 0) found.push(r.relname);
  }
  return found;
}

try {
  await db.connect();
  assert.equal((await db.query('SELECT inet_server_addr() AS addr')).rows[0].addr, null);
  if (mode === 'cloud') {
    // Supabase's shape: the auth schema, and default privileges that hand every
    // new public table, sequence and function to the client roles. Migrations
    // must win against those defaults, exactly as they must in production.
    await db.query(`
      CREATE SCHEMA auth;
      CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb DEFAULT '{}', last_sign_in_at timestamptz);
      CREATE TABLE auth.sessions (id uuid PRIMARY KEY, user_id uuid REFERENCES auth.users (id));
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
        SELECT NULLIF(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid $$;
      GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
      GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
      GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;`);
  }

  const { migrateUp } = await import('../../../../packages/db/src/migrate.ts');
  const pool = new pg.Pool({ ...config, max: 1 });
  // The runner reads SUPABASE_MODE itself; it is a mode flag, not a connection
  // target, and it is removed again before anything else runs.
  if (mode === 'cloud') process.env.SUPABASE_MODE = '1';
  let applied;
  try { applied = await migrateUp(pool); } finally { delete process.env.SUPABASE_MODE; await pool.end(); }

  await test('072 applies in ' + mode + ' mode and is never skipped', async () => {
    const reach = applied.find((m) => m.version === '072_postgrest_reach');
    assert.ok(reach, 'migration 072 is present');
    assert.equal(reach.applied, true);
    assert.equal(reach.skipped, undefined);
    assert.equal(applied.filter((m) => m.skipped).length > 0, mode === 'self-host', 'only self-host skips @supabase-only files');
  });

  await test('every public view runs with its caller\'s rights, and the leaking view is gone', async () => {
    const views = (await db.query(`
      SELECT relname, relkind, coalesce(reloptions, '{}') AS options FROM pg_class
       WHERE relnamespace = 'public'::regnamespace AND relkind IN ('v', 'm') ORDER BY relname`)).rows;
    assert.deepEqual(views.filter((v) => v.relkind === 'm').map((v) => v.relname), [], 'no materialized views: RLS cannot apply to them');
    assert.deepEqual(views.filter((v) => !v.options.includes('security_invoker=true')).map((v) => v.relname), []);
    assert.ok(!views.some((v) => v.relname === 'collection_dupe_predicate'));
    assert.ok(views.length >= 5, 'the catalog views and admin_user_role survive');
  });

  if (mode === 'self-host') {
    await test('owner-bound children and final revocation hold on plain Postgres too', async () => {
      await db.query("INSERT INTO app_user (id, username) VALUES ($1, 'a'), ($2, 'b')", [A, B]);
      const deck = (await db.query("INSERT INTO deck (user_id, format_code, name) VALUES ($1, 'standard', 'A deck') RETURNING id", [A])).rows[0].id;
      await rejects(db.query("INSERT INTO deck_version (deck_id, version, format_code, cards, user_id) VALUES ($1, 1, 'standard', '[]', $2)", [deck, B]), '23503');
      const token = (await db.query("INSERT INTO api_token (user_id, name, token_hash, prefix, revoked_at) VALUES ($1, 't', repeat('b', 64), 'dsk_bbbbbbbb', now()) RETURNING id", [A])).rows[0].id;
      await rejects(db.query('UPDATE api_token SET revoked_at = NULL WHERE id = $1', [token]), '42501');
    });
  } else {
    await db.query(readFileSync(join(HERE, 'reach-fixture.sql'), 'utf8'));

    await test('every per-user relation a client role can read holds a fixture row, so its zero means something', async () => {
      const empty = [];
      for (const r of await perUserRelations()) {
        if (!r.anon && !r.authenticated) continue;
        const sql = `SELECT count(*)::int AS n FROM public.${db.escapeIdentifier(r.relname)} WHERE ${db.escapeIdentifier(r.owner)}::text = $1`;
        if ((await db.query(sql, [A])).rows[0].n === 0) empty.push(r.relname);
      }
      assert.deepEqual(empty, [], 'seed these in reach-fixture.sql');
      // Both sessions are live: each user reads their own row through RLS.
      for (const user of [A, B]) {
        assert.equal(await as('authenticated', user, async (c) => (await c.query('SELECT count(*)::int AS n FROM collection_item')).rows[0].n), 1);
      }
    });

    await test('import fixes settle provider cost in fractions on the shared user session', async () => {
      await db.query("SELECT public.admin_bootstrap($1,'{}'::text[],'{}'::text[])", [A]);
      await db.query("UPDATE public.app_feature SET lifecycle='released' WHERE key='decke'");
      await db.query('SELECT public.credit_policy_initialize(true)');
      await db.query("SELECT public.credit_apply_delta($1,2,'grant','Fixture import credits','reach-import-grant')", [A]);
      await as('authenticated', A, (c) => rejects(c.query(
        "SELECT public.decke_import_fix_begin(120,'import_fix:forged',$1,'fixture-model','fixture',233)",
        ['a'.repeat(64)]), '42501'), { deckpal_auth_kind: 'jwt' });
      const charges = await asServer(A, async (c) => {
        const charged = [];
        for (let i = 0; i < 5; i++) {
          const start = (await c.query(
            'SELECT public.decke_import_fix_begin($1,$2,$3,$4,$5,$6) AS data',
            [120, `import_fix:reach-${i}`, 'a'.repeat(64), 'fixture-model', 'fixture', 233],
          )).rows[0].data;
          const settled = (await c.query(
            'SELECT public.decke_import_fix_finish($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) AS data',
            [start.requestId, start.operationId, 'completed', 1000, 100, 0, 0, 0,
              '0.002', 'provider_reported', `fixture-${i}`],
          )).rows[0].data;
          charged.push(Number(settled.credits));
        }
        return charged;
      });
      assert.deepEqual(charges, [0.2, 0.2, 0.2, 0.2, 0.2]);
      assert.equal((await db.query('SELECT balance FROM public.decke_credit_balance WHERE user_id=$1', [A])).rows[0].balance, 1);
      // 081 folds import fixes into the one generic carry; five 0.2 fixes net to zero there.
      assert.equal(Number((await db.query('SELECT fractional_credits FROM public.decke_metered_credit WHERE user_id=$1', [A])).rows[0].fractional_credits), 0);
      assert.equal((await db.query('SELECT count(*)::int n FROM public.decke_import_fix_settlement WHERE user_id=$1', [A])).rows[0].n, 5);
      const pricing = await asServer(A, async (c) => (await c.query(
        "SELECT public.decke_usage_observations(7,'fixture') AS data",
      )).rows[0].data);
      assert.deepEqual(pricing.groups, [], 'repair usage must not appear as planning price samples');
      const pending = await asServer(A, async (c) => (await c.query(
        'SELECT public.decke_import_fix_begin($1,$2,$3,$4,$5,$6) AS data',
        [120, 'import_fix:pending', 'a'.repeat(64), 'fixture-model', 'fixture', 233],
      )).rows[0].data);
      await assert.rejects(asServer(A, (c) => c.query(
        'SELECT public.decke_import_fix_begin($1,$2,$3,$4,$5,$6)',
        [120, 'import_fix:concurrent', 'a'.repeat(64), 'fixture-model', 'fixture', 233],
      )), (error) => { assert.equal(error.code, 'P0001'); return true; });
      await asServer(A, (c) => c.query(
        'SELECT public.decke_import_fix_finish($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
        [pending.requestId, pending.operationId, 'completed', 1000, 100, 0, 0, 0,
          '0.002', 'provider_reported', 'fixture-pending'],
      ));
    });

    await test('a fix and metered chat race without double spending', async () => {
      // The prior import settlement leaves a .2-credit liability. Four whole
      // credits means either the one-credit fix or the >=3-credit chat can win.
      await db.query("SELECT public.credit_apply_delta($1,3,'grant','Fixture race credits','reach-race-grant')", [A]);
      const policy = (await db.query('SELECT public.credit_effective_policy($1) data', [A])).rows[0].data;
      const request = (await db.query(
        "SELECT public.decke_usage_begin($1,NULL,NULL,NULL,'chat:race-import-fix',$2,'fixture',233,$3,$4,'paid','') data",
        [A, 'b'.repeat(64), policy.revision, policy.overrideRevision],
      )).rows[0].data.id;
      let fix, chatAllowed = false;
      const [fixResult, chatResult] = await Promise.allSettled([
        asServer(A, async (c) => (await c.query(
          'SELECT public.decke_import_fix_begin($1,$2,$3,$4,$5,$6) AS data',
          [120, 'import_fix:race-chat', 'a'.repeat(64), 'fixture-model', 'fixture', 233],
        )).rows[0].data),
        asServer(A, async (c) => (await c.query(
          'SELECT public.decke_metered_begin($1) AS data', [request])).rows[0].data),
      ]);
      if (fixResult.status === 'fulfilled') fix = fixResult.value;
      else assert.equal(fixResult.reason.code, 'P0001');
      assert.equal(chatResult.status, 'fulfilled');
      chatAllowed = chatResult.value.allowed;
      assert.equal(Number(Boolean(fix)) + Number(chatAllowed), 1);
      assert.equal((await db.query('SELECT balance FROM public.decke_credit_balance WHERE user_id=$1', [A])).rows[0].balance, chatAllowed ? 0 : 3);
      assert.equal((await db.query('SELECT debt FROM public.credit_wallet_control WHERE user_id=$1', [A])).rows[0].debt, 0);
      if (fix) await asServer(A, (c) => c.query(
        'SELECT public.decke_import_fix_finish($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
        [fix.requestId, fix.operationId, 'failed', null, null, null, null, null,
          null, 'unknown', null],
      ));
      if (chatAllowed) await asServer(A, (c) => c.query(
        "SELECT public.decke_metered_settle($1,'cancelled')", [request]));
    });

    await test('a suspended account settles its admitted fix exactly once', async () => {
      const balance = (await db.query('SELECT balance FROM public.decke_credit_balance WHERE user_id=$1', [A])).rows[0].balance;
      if (balance < 1) await db.query(
        "SELECT public.credit_apply_delta($1,1,'grant','Fixture suspended fix','reach-suspended-grant')", [A]);
      const started = await asServer(A, async (c) => (await c.query(
        'SELECT public.decke_import_fix_begin($1,$2,$3,$4,$5,$6) AS data',
        [120, 'import_fix:suspended', 'a'.repeat(64), 'fixture-model', 'fixture', 233],
      )).rows[0].data);
      await as('authenticated', A, (c) => rejects(c.query(
        'SELECT public.decke_import_fix_finish($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
        [started.requestId, started.operationId, 'failed', null, null, null, null, null,
          null, 'unknown', null]), '42501'), { deckpal_auth_kind: 'jwt' });
      await db.query('UPDATE public.admin_account SET suspended=true WHERE user_id=$1', [A]);
      try {
        await assert.rejects(asServer(A, (c) => c.query(
          'SELECT public.decke_import_fix_begin($1,$2,$3,$4,$5,$6)',
          [120, 'import_fix:after-suspension', 'a'.repeat(64), 'fixture-model', 'fixture', 233],
        )), (error) => { assert.equal(error.code, '42501'); return true; });
        const args = [started.requestId, started.operationId, 'completed', 1000, 100, 0, 0, 0,
          '0.002', 'provider_reported', 'fixture-suspended'];
        const first = await asServer(A, async (c) => (await c.query(
          'SELECT public.decke_import_fix_finish($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) AS data', args,
        )).rows[0].data);
        const again = await asServer(A, async (c) => (await c.query(
          'SELECT public.decke_import_fix_finish($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) AS data', args,
        )).rows[0].data);
        assert.equal(first.duplicate, false);
        assert.equal(again.duplicate, true);
        assert.equal((await db.query('SELECT count(*)::int n FROM public.decke_import_fix_settlement WHERE request_id=$1',
          [started.requestId])).rows[0].n, 1);
        assert.equal((await db.query('SELECT count(*)::int n FROM public.decke_credit_event WHERE ref=$1',
          ['import-fix-release:' + started.requestId])).rows[0].n, 1);
        assert.equal((await db.query('SELECT debt FROM public.credit_wallet_control WHERE user_id=$1', [A])).rows[0].debt, 0);
      } finally {
        await db.query('UPDATE public.admin_account SET suspended=false WHERE user_id=$1', [A]);
      }
    });

    await test('a wallet read releases an orphaned import hold once', async () => {
      await as('authenticated', A, (c) => rejects(
        c.query('SELECT public.decke_import_fix_recover($1)', [A]), '42501'));
      const before = await asServer(A, async (c) => (await c.query(
        'SELECT public.credit_wallet_read(NULL) AS data')).rows[0].data);
      const beforeWhole = (await db.query(
        'SELECT balance FROM public.decke_credit_balance WHERE user_id=$1', [A])).rows[0].balance;
      const started = await asServer(A, async (c) => (await c.query(
        'SELECT public.decke_import_fix_begin($1,$2,$3,$4,$5,$6) AS data',
        [120, 'import_fix:orphaned', 'a'.repeat(64), 'fixture-model', 'fixture', 233],
      )).rows[0].data);
      assert.equal((await db.query('SELECT balance FROM public.decke_credit_balance WHERE user_id=$1', [A])).rows[0].balance, beforeWhole - 1);
      await db.query("UPDATE public.decke_ai_request SET started_at=now()-interval '16 minutes' WHERE id=$1",
        [started.requestId]);
      const first = await asServer(A, async (c) => (await c.query(
        'SELECT public.credit_wallet_read(NULL) AS data',
      )).rows[0].data);
      const again = await asServer(A, async (c) => (await c.query(
        'SELECT public.credit_wallet_read(NULL) AS data',
      )).rows[0].data);
      assert.equal(first.balance, before.balance);
      assert.equal(again.balance, before.balance);
      assert.equal((await db.query('SELECT status FROM public.decke_ai_request WHERE id=$1',
        [started.requestId])).rows[0].status, 'abandoned');
      assert.equal((await db.query('SELECT count(*)::int n FROM public.decke_credit_event WHERE ref=$1',
        ['import-fix-recover:' + started.requestId])).rows[0].n, 1);
      const late = await asServer(A, async (c) => (await c.query(
        'SELECT public.decke_import_fix_finish($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) AS data',
        [started.requestId, started.operationId, 'completed', 1000, 100, 0, 0, 0,
          '0.002', 'provider_reported', 'fixture-late'],
      )).rows[0].data);
      assert.equal(late.duplicate, true);
      assert.equal((await db.query('SELECT count(*)::int n FROM public.decke_import_fix_settlement WHERE request_id=$1',
        [started.requestId])).rows[0].n, 1);
    });

    await test('anon reaches no per-user row in any table or view', async () => {
      assert.deepEqual(await leaks('anon'), []);
    });

    await test('a second signed-in user reaches none of the first user\'s rows', async () => {
      assert.deepEqual(await leaks('authenticated', B), []);
    });

    await test('the catalog views answer anon and a signed-in user exactly what they answer the owner', async () => {
      // Invoker views read their tables as the caller, so a missing grant or
      // read policy underneath would quietly change what the API serves.
      for (const view of ['variant_tier_resolved', 'master_required_variant', 'card_without_standard_variant', 'set_variant_coverage']) {
        const sql = `SELECT count(*)::int AS n FROM public.${view}`;
        const owner = (await db.query(sql)).rows[0].n;
        assert.equal(await as('anon', null, async (c) => (await c.query(sql)).rows[0].n), owner, view + ' as anon');
        assert.equal(await as('authenticated', B, async (c) => (await c.query(sql)).rows[0].n), owner, view + ' as a user');
      }
      assert.equal((await db.query('SELECT count(*)::int AS n FROM variant_tier_resolved')).rows[0].n, 2);
    });

    await test('the enumeration catches a definer view over per-user rows (SEC-01 as it shipped)', async () => {
      await db.query('CREATE VIEW public.reach_canary AS SELECT user_id FROM public.collection_item');
      try {
        assert.deepEqual(await leaks('anon'), ['reach_canary']);
        assert.deepEqual(await leaks('authenticated', B), ['reach_canary']);
      } finally {
        await db.query('DROP VIEW public.reach_canary');
      }
    });

    await test('SEC-02: nobody can point their profile at another user\'s photo or rewrite their public stats', async () => {
      const key = (await db.query('SELECT avatar_path FROM user_profile WHERE user_id = $1', [A])).rows[0].avatar_path;
      await as('authenticated', B, (c) => rejects(c.query(
        `UPDATE user_profile SET avatar_path = $2, avatar_updated_at = now(), avatar_byte_size = 1,
                avatar_content_type = 'image/webp' WHERE user_id = $1`, [B, key]), '23505'));
      for (const column of ['unique_cards', 'trainer_level', 'total_quantity', 'display_name', 'bio'])
        await as('authenticated', B, (c) => rejects(c.query(`UPDATE user_profile SET ${column} = DEFAULT WHERE user_id = $1`, [B]), '42501'));
      await as('anon', null, (c) => rejects(c.query("UPDATE user_profile SET display_name = 'x'"), '42501'));
      // The API's own writes (routes/avatar.ts recorder + DELETE) still work as the user.
      await as('authenticated', B, async (c) => {
        const row = (await c.query(
          `INSERT INTO user_profile (user_id, avatar_path, avatar_updated_at, avatar_byte_size, avatar_content_type)
                VALUES ($1, $2, now(), 10, 'image/webp')
           ON CONFLICT (user_id) DO UPDATE
                   SET avatar_path = EXCLUDED.avatar_path, avatar_updated_at = EXCLUDED.avatar_updated_at,
                       avatar_byte_size = EXCLUDED.avatar_byte_size, avatar_content_type = EXCLUDED.avatar_content_type
             RETURNING user_id`, [B, 'b'.repeat(32) + '.webp'])).rows[0];
        assert.equal(row.user_id, B);
        const cleared = await c.query(`UPDATE user_profile SET avatar_path = NULL, avatar_updated_at = NULL,
                                              avatar_byte_size = NULL, avatar_content_type = NULL WHERE user_id = $1`, [B]);
        assert.equal(cleared.rowCount, 1);
      });
    });

    await test('SEC-10: a revoked token stays revoked (no un-revoke, no delete and re-mint) and keeps its identity; the API\'s token writes still work', async () => {
      const id = (await db.query('SELECT id FROM api_token WHERE user_id = $1', [A])).rows[0].id;
      await as('authenticated', A, async (c) => {
        await c.query('UPDATE api_token SET last_used_at = now() WHERE id = $1', [id]);
        await c.query('UPDATE api_token SET revoked_at = COALESCE(revoked_at, now()) WHERE id = $1 AND user_id = $2', [id, A]);
        await c.query('SAVEPOINT s');
        await rejects(c.query('UPDATE api_token SET revoked_at = NULL WHERE id = $1', [id]), '42501');
        await c.query('ROLLBACK TO SAVEPOINT s');
        await rejects(c.query("UPDATE api_token SET token_hash = repeat('f', 64) WHERE id = $1", [id]), '42501');
      });
      // An administrator's revoke (the SECURITY DEFINER path) cannot be undone by the user either,
      // neither in place nor by deleting the revoked row and minting its hash again.
      await db.query('UPDATE api_token SET revoked_at = now() WHERE id = $1', [id]);
      await as('authenticated', A, (c) => rejects(c.query('UPDATE api_token SET revoked_at = NULL WHERE id = $1', [id]), '42501'));
      await as('authenticated', A, (c) => rejects(c.query('DELETE FROM api_token WHERE id = $1', [id]), '42501'));
      await as('authenticated', A, (c) => rejects(c.query(
        "INSERT INTO api_token (user_id, name, token_hash, prefix) SELECT user_id, 'again', token_hash, prefix FROM api_token WHERE id = $1", [id]), '23505'));
    });

    await test('SEC-10: nobody can plant rows under another user\'s deck or binder item', async () => {
      const deck = (await db.query('SELECT id FROM deck WHERE user_id = $1', [A])).rows[0].id;
      const { card_id: card, id: variant } = (await db.query(
        'SELECT card_id, id FROM card_variant cv WHERE NOT EXISTS (SELECT 1 FROM deck_card dc WHERE dc.card_variant_id = cv.id)')).rows[0];
      const item = (await db.query(
        'SELECT id FROM list_item li WHERE user_id = $1 AND NOT EXISTS (SELECT 1 FROM binder_placement bp WHERE bp.list_item_id = li.id)', [A])).rows[0].id;
      const plants = [
        ['INSERT INTO deck_card (deck_id, card_id, card_variant_id, user_id, quantity) VALUES ($1, $2, $3, $4, 1)', [deck, card, variant, B]],
        ["INSERT INTO deck_version (deck_id, version, format_code, cards, user_id) VALUES ($1, 2, 'standard', '[]', $2)", [deck, B]],
        ["INSERT INTO battle_log (deck_id, deck_version, raw_log, user_id) VALUES ($1, 1, 'planted', $2)", [deck, B]],
      ];
      for (const [sql, params] of plants) await as('authenticated', B, (c) => rejects(c.query(sql, params), '23503'));
      await as('authenticated', B, async (c) => {
        const list = (await c.query("INSERT INTO card_list (user_id, kind, name) VALUES ($1, 'static', 'B binder') RETURNING id", [B])).rows[0].id;
        await rejects(c.query('INSERT INTO binder_placement (card_list_id, user_id, slot_index, list_item_id) VALUES ($1, $2, 0, $3)', [list, B, item]), '23503');
      });
      // The owner's own writes are untouched (routes/decks.ts add-card upsert).
      await as('authenticated', A, (c) => c.query(
        `INSERT INTO deck_card (deck_id, card_id, card_variant_id, user_id, quantity) VALUES ($1, $2, $3, $4, 1)
         ON CONFLICT (deck_id, card_variant_id) DO UPDATE SET quantity = LEAST(deck_card.quantity + 1, 60)`, [deck, card, variant, A]));
    });

    // Deck-E feedback pass (2026-09-29): a half set with a DOTTED id, two cards
    // that multiply damage by coin flips (one reprinted), and one that does not.
    await db.query(`DO $half$
      DECLARE s bigint; c bigint;
      BEGIN
       INSERT INTO card_set (series_id, tcgdex_id, slug, name)
        SELECT series_id, 'rch2.5', 'rch2-5', 'Reach Two Point Five' FROM card_set WHERE tcgdex_id = 'reach1' RETURNING id INTO s;
       FOR i IN 1..4 LOOP
        INSERT INTO card (set_id, tcgdex_id, local_id, number_sort, name, name_normalized, category)
         VALUES (s, 'rch2.5-00' || i, i::text, '00' || i,
          (ARRAY['Flipper','Flipper','Doubler','Plain'])[i], lower((ARRAY['Flipper','Flipper','Doubler','Plain'])[i]), 'Pokemon')
         RETURNING id INTO c;
        INSERT INTO card_variant (card_id, variant_kind_code, sort_order) VALUES (c, 'reach-normal', 1);
        INSERT INTO card_attack (card_id, ord, name, damage, effect) VALUES (c, 0,
         (ARRAY['Fury Flip','Fury Flip','Double Down','Tackle'])[i],
         (ARRAY['20×','20×','30x','30'])[i],
         (ARRAY['Flip 3 coins. This attack does 20 damage for each heads.','Flip 3 coins. This attack does 20 damage for each heads.',
                'Flip 2 coins. This attack does 30 damage for each heads.',NULL])[i]);
       END LOOP;
       -- The two identical Flippers are reprints (one gameplay fingerprint); a
       -- third Flipper with the same attack but other stats is a different card.
       UPDATE card SET playable_fingerprint = 'fp-flipper' WHERE tcgdex_id IN ('rch2.5-001', 'rch2.5-002');
       INSERT INTO card (set_id, tcgdex_id, local_id, number_sort, name, name_normalized, category, playable_fingerprint)
        VALUES (s, 'rch2.5-005', '5', '005', 'Flipper', 'flipper', 'Pokemon', 'fp-flipper-other') RETURNING id INTO c;
       INSERT INTO card_variant (card_id, variant_kind_code, sort_order) VALUES (c, 'reach-normal', 1);
       INSERT INTO card_attack (card_id, ord, name, damage, effect)
        VALUES (c, 0, 'Fury Flip', '20×', 'Flip 3 coins. This attack does 20 damage for each heads.');
       -- A second, non-primary printing of Doubler, for the printing-preservation case.
       INSERT INTO variant_kind (code, display_name, finish, size, tier_derived, tier_rule_version)
        VALUES ('reach-alt', 'Alt', 'normal', 'standard', 'standard', 1);
       INSERT INTO card_variant (card_id, variant_kind_code, sort_order)
        SELECT id, 'reach-alt', 2 FROM card WHERE tcgdex_id = 'rch2.5-003';
      END $half$`);

    await test('search_cards finds cards by printed attack text and multiplier, collapsing reprints', async () => {
      const { catalogTools } = await import('../../../../packages/agent-tools/src/tools/catalog.ts');
      const search = catalogTools.find((t) => t.name === 'search_cards');
      const text = await as('authenticated', A, async (c) => {
        // Parsed the way both transports parse it, so schema defaults (page 1,
        // text_same_attack) apply exactly as they do for Deck-E and MCP.
        const args = search.inputSchema.parse({ text: ['flip', 'for each heads'], damage: 'x' });
        const out = await search.handler(args, { db: c, api: {}, userId: A });
        assert.notEqual(out.isError, true, out.text);
        return out.text;
      });
      assert.match(text, /Flipper/);
      assert.match(text, /Doubler/, 'a literal "x" multiplier matches as well as "×"');
      assert.doesNotMatch(text, /Plain/);
      assert.match(text, /Flip 3 coins/, 'each row carries the matching attack line');
      assert.match(text, /printings?:?\s*2|2 printings/i, 'the two identical Flippers are one row with a printing count');
      assert.match(text, /rch2\.5-005/, 'a same-name card with other stats is its own row, not hidden as a printing');
    });

    await test('POST /decks/save writes a whole deck or nothing, replays a retry, and a deleted deck can be saved again', async () => {
      const { server, post } = await decksApp();
      const decksNamed = async (name) => Number((await db.query(
        'SELECT count(*) FROM deck WHERE user_id = $1 AND name = $2 AND deleted_at IS NULL', [A, name])).rows[0].count);
      try {
        const good = [{ cardId: 'rch2.5-001', quantity: 3 }, { cardId: 'rch2.5-003', quantity: 2 }];
        const bad = await post('/decks/save', { name: 'Atomic', cards: [...good, { cardId: 'rch2.5-999', quantity: 1 }] });
        assert.equal(bad.status, 400, JSON.stringify(bad.body));
        assert.match(JSON.stringify(bad.body), /rch2\.5-999/);
        assert.equal(await decksNamed('Atomic'), 0, 'one bad id leaves no deck behind');
        assert.equal(Number((await db.query(
          "SELECT count(*) FROM mutation_batch WHERE user_id = $1 AND tool = 'deck.save' AND status = 'committed'", [A])).rows[0].count), 0);

        const first = await post('/decks/save', { name: 'Atomic', cards: good });
        assert.equal(first.status, 201, JSON.stringify(first.body));
        const retry = await post('/decks/save', { name: 'Atomic', cards: good });
        assert.equal(retry.status, 200);
        assert.equal(retry.body.replayed, true);
        assert.equal(await decksNamed('Atomic'), 1, 'a retry of the same save does not make a twin');
        const deckId = (await db.query('SELECT id FROM deck WHERE user_id = $1 AND name = $2', [A, 'Atomic'])).rows[0].id;
        const cardsNow = async () => (await db.query(
          `SELECT c.tcgdex_id, dc.quantity FROM deck_card dc JOIN card c ON c.id = dc.card_id WHERE dc.deck_id = $1 ORDER BY 1, 2`, [deckId])).rows
          .map((r) => `${r.tcgdex_id}x${r.quantity}`);
        assert.deepEqual(await cardsNow(), ['rch2.5-001x3', 'rch2.5-003x2']);

        // A → B → A on an existing deck applies every step; the third is not a replay of the first.
        const b = [{ cardId: 'rch2.5-004', quantity: 4 }];
        assert.equal((await post('/decks/save', { deckId, cards: b })).status, 200);
        assert.deepEqual(await cardsNow(), ['rch2.5-004x4']);
        const back = await post('/decks/save', { deckId, cards: good });
        assert.equal(back.status, 200);
        assert.deepEqual(await cardsNow(), ['rch2.5-001x3', 'rch2.5-003x2'], 'switching back to the first list applies it');

        // An edit changes only what changed: a printing the owner chose and
        // pinned survives an unrelated change to another card (Opus, PR #270).
        const doubler = (await db.query("SELECT id FROM card WHERE tcgdex_id = 'rch2.5-003'")).rows[0].id;
        const alt = (await db.query("SELECT id FROM card_variant WHERE card_id = $1 AND variant_kind_code = 'reach-alt'", [doubler])).rows[0].id;
        await db.query('UPDATE deck_card SET card_variant_id = $3, pin_exact = true WHERE deck_id = $1 AND card_id = $2', [deckId, doubler, alt]);
        const doublerRows = async () => (await db.query(
          'SELECT card_variant_id::text AS v, quantity, pin_exact FROM deck_card WHERE deck_id = $1 AND card_id = $2 ORDER BY 1', [deckId, doubler])).rows;
        const bump = await post('/decks/save', { deckId, cards: [{ cardId: 'rch2.5-001', quantity: 4 }, { cardId: 'rch2.5-003', quantity: 2 }] });
        assert.equal(bump.status, 200, JSON.stringify(bump.body));
        assert.deepEqual(await cardsNow(), ['rch2.5-001x4', 'rch2.5-003x2']);
        assert.deepEqual(await doublerRows(), [{ v: String(alt), quantity: 2, pin_exact: true }], 'the pinned alt printing is untouched');

        // A count change on a card held as two printings would have to guess:
        // it fails whole, and nothing moves.
        await db.query(
          `INSERT INTO deck_card (deck_id, card_id, card_variant_id, user_id, quantity)
           SELECT $1, $2, id, $3, 1 FROM card_variant WHERE card_id = $2 AND variant_kind_code = 'reach-normal'`, [deckId, doubler, A]);
        const ambiguous = await post('/decks/save', { deckId, cards: [{ cardId: 'rch2.5-001', quantity: 3 }, { cardId: 'rch2.5-003', quantity: 2 }] });
        assert.equal(ambiguous.status, 400, JSON.stringify(ambiguous.body));
        assert.match(JSON.stringify(ambiguous.body), /printings/);
        assert.deepEqual(await cardsNow(), ['rch2.5-001x4', 'rch2.5-003x1', 'rch2.5-003x2'], 'nothing was written');
        await db.query("DELETE FROM deck_card WHERE deck_id = $1 AND card_id = $2 AND card_variant_id <> $3", [deckId, doubler, alt]);

        // Restating a GLC deck's format keeps its Pokémon type.
        const glc = await post('/decks/save', { name: 'Fire GLC', formatCode: 'glc', glcType: 'Fire', cards: [{ cardId: 'rch2.5-004', quantity: 1 }] });
        assert.equal(glc.status, 201, JSON.stringify(glc.body));
        const glcId = (await db.query("SELECT id FROM deck WHERE user_id = $1 AND name = 'Fire GLC'", [A])).rows[0].id;
        assert.equal((await post('/decks/save', { deckId: glcId, formatCode: 'glc', cards: [{ cardId: 'rch2.5-004', quantity: 1 }, { cardId: 'rch2.5-001', quantity: 1 }] })).status, 200);
        assert.equal((await db.query('SELECT glc_type FROM deck WHERE id = $1', [glcId])).rows[0].glc_type, 'Fire');
        // The same name and list as a WATER deck is a different request, not a
        // retry of the Fire one (Astra, PR #270 re-check).
        const water = await post('/decks/save', { name: 'Shell', formatCode: 'glc', glcType: 'Water', cards: [{ cardId: 'rch2.5-004', quantity: 1 }] });
        const fire = await post('/decks/save', { name: 'Shell', formatCode: 'glc', glcType: 'Fire', cards: [{ cardId: 'rch2.5-004', quantity: 1 }] });
        assert.deepEqual([water.status, fire.status], [201, 201], JSON.stringify(fire.body));
        assert.deepEqual((await db.query("SELECT glc_type FROM deck WHERE user_id = $1 AND name = 'Shell' AND deleted_at IS NULL ORDER BY glc_type", [A])).rows.map((r) => r.glc_type), ['Fire', 'Water']);

        // Deleted, then the identical list saved again: a new deck, not the dead one's id.
        await db.query('UPDATE deck SET deleted_at = now() WHERE id = $1', [deckId]);
        const again = await post('/decks/save', { name: 'Atomic', cards: good });
        assert.equal(again.status, 201, JSON.stringify(again.body));
        assert.equal(await decksNamed('Atomic'), 1);
        assert.notEqual((await db.query('SELECT id FROM deck WHERE user_id = $1 AND name = $2 AND deleted_at IS NULL', [A, 'Atomic'])).rows[0].id, deckId);
        // And a retry of THAT save replays it, however late (Astra, PR #270).
        const againRetry = await post('/decks/save', { name: 'Atomic', cards: good });
        assert.equal(againRetry.status, 200, JSON.stringify(againRetry.body));
        assert.equal(againRetry.body.replayed, true);
        assert.equal(await decksNamed('Atomic'), 1, 'the retry of a re-save does not make a twin');
      } finally {
        server.closeAllConnections();
        await new Promise((resolveClose) => server.close(() => resolveClose()));
      }
    });

    // The deck widget's "Save as new version" (2026-10-10). The audit: "make a
    // v2 of my Dragapult deck" could only be saved as a SECOND deck, leaving the
    // version history and the battle logs on the first.
    await test('POST /decks/save newVersion lands a revision as the next version of the reader\'s own deck, and only theirs', async () => {
      const { server, post } = await decksApp();
      const versions = async (deckId) => (await db.query(
        'SELECT version, note, cards FROM deck_version WHERE deck_id = $1 ORDER BY version', [deckId])).rows
        .map((r) => ({ v: r.version, note: r.note, cards: r.cards.map((c) => `${c.tcgdexId}x${c.quantity}`).sort().join(' ') }));
      try {
        const first = await post('/decks/save', { name: 'Revisable', cards: [{ cardId: 'rch2.5-001', quantity: 3 }, { cardId: 'rch2.5-003', quantity: 2 }] });
        assert.equal(first.status, 201, JSON.stringify(first.body));
        const deckId = first.body.deck.id;
        // The reader chose and pinned a printing; a version must not undo that.
        const doubler = (await db.query("SELECT id FROM card WHERE tcgdex_id = 'rch2.5-003'")).rows[0].id;
        const alt = (await db.query("SELECT id FROM card_variant WHERE card_id = $1 AND variant_kind_code = 'reach-alt'", [doubler])).rows[0].id;
        await db.query('UPDATE deck_card SET card_variant_id = $3, pin_exact = true WHERE deck_id = $1 AND card_id = $2', [deckId, doubler, alt]);

        // v1 was never played. An ordinary edit would amend it in place and the
        // v1 list would be gone; a new version keeps it.
        const v2 = await post('/decks/save', { deckId, newVersion: true, versionNote: 'Fourth Flipper',
          cards: [{ cardId: 'rch2.5-001', quantity: 4 }, { cardId: 'rch2.5-003', quantity: 2 }] });
        assert.equal(v2.status, 200, JSON.stringify(v2.body));
        assert.deepEqual([v2.body.deck.version, v2.body.bumped], [2, true]);
        assert.deepEqual(await versions(deckId), [
          { v: 1, note: null, cards: 'rch2.5-001x3 rch2.5-003x2' },
          { v: 2, note: 'Fourth Flipper', cards: 'rch2.5-001x4 rch2.5-003x2' },
        ]);
        assert.deepEqual((await db.query('SELECT card_variant_id::text AS v, pin_exact FROM deck_card WHERE deck_id = $1 AND card_id = $2', [deckId, doubler])).rows,
          [{ v: String(alt), pin_exact: true }], 'the pinned printing survives the version');

        // Played on v2, then revised: the game stays on v2, on THIS deck.
        await db.query("INSERT INTO battle_log (deck_id, deck_version, raw_log, user_id) VALUES ($1, 2, 'a game', $2)", [deckId, A]);
        const v3 = await post('/decks/save', { deckId, newVersion: true, versionNote: 'Back to three',
          cards: [{ cardId: 'rch2.5-001', quantity: 3 }, { cardId: 'rch2.5-003', quantity: 2 }] });
        assert.deepEqual([v3.status, v3.body.deck.version, v3.body.bumped], [200, 3, true], JSON.stringify(v3.body));
        assert.deepEqual((await db.query('SELECT deck_id, deck_version FROM battle_log WHERE deck_id = $1', [deckId])).rows,
          [{ deck_id: deckId, deck_version: 2 }]);
        assert.equal(Number((await db.query("SELECT count(*) FROM deck WHERE user_id = $1 AND name = 'Revisable'", [A])).rows[0].count), 1,
          'a version never makes a second deck');

        // The same list again changes nothing, so it writes nothing — no v4,
        // no touched deck — and says so. Its retry replays that answer.
        const touched = (await db.query('SELECT updated_at::text AS at FROM deck WHERE id = $1', [deckId])).rows[0].at;
        const same = await post('/decks/save', { deckId, newVersion: true, versionNote: 'nothing',
          cards: [{ cardId: 'rch2.5-003', quantity: 2 }, { cardId: 'rch2.5-001', quantity: 3 }] });
        assert.deepEqual([same.status, same.body.deck.version, same.body.bumped], [200, 3, false], JSON.stringify(same.body));
        assert.equal((await versions(deckId)).length, 3);
        assert.equal((await db.query('SELECT updated_at::text AS at FROM deck WHERE id = $1', [deckId])).rows[0].at, touched);
        const sameRetry = await post('/decks/save', { deckId, newVersion: true, versionNote: 'nothing',
          cards: [{ cardId: 'rch2.5-001', quantity: 3 }, { cardId: 'rch2.5-003', quantity: 2 }] });
        assert.deepEqual([sameRetry.body.replayed, sameRetry.body.bumped], [true, false]);

        // An ordinary edit keeps the old rule: v3 is unplayed, so it is amended.
        const plain = await post('/decks/save', { deckId, cards: [{ cardId: 'rch2.5-001', quantity: 2 }, { cardId: 'rch2.5-003', quantity: 2 }] });
        assert.deepEqual([plain.status, plain.body.deck.version, plain.body.bumped], [200, 3, false], JSON.stringify(plain.body));

        // Someone else's deck cannot be versioned, whatever id they send.
        const theirs = await post('/decks/save', { deckId, newVersion: true, cards: [{ cardId: 'rch2.5-004', quantity: 4 }] }, B);
        assert.equal(theirs.status, 404, JSON.stringify(theirs.body));
        assert.equal((await versions(deckId)).length, 3);
        assert.equal(Number((await db.query(
          "SELECT count(*) FROM mutation_batch WHERE user_id = $1 AND tool = 'deck.save'", [B])).rows[0].count), 0);

        const loose = await post('/decks/save', { name: 'Loose', newVersion: true, cards: [{ cardId: 'rch2.5-001', quantity: 1 }] });
        assert.equal(loose.status, 400, 'a new deck starts at v1; newVersion needs a deck');
      } finally {
        server.closeAllConnections();
        await new Promise((resolveClose) => server.close(() => resolveClose()));
      }
    });
  }
  results.status = 'passed';
} catch (error) {
  results.status = 'failed';
  results.error = error.stack;
  throw error;
} finally {
  await db.end();
  writeFileSync(process.env.DECKPAL_TEST_RESULT, JSON.stringify(results, null, 2) + '\n');
}
