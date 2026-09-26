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

/** One transaction as `role` (with `user` as the JWT subject), always rolled back. */
async function as(role, user, fn) {
  assert.ok(role === 'anon' || role === 'authenticated');
  const c = new pg.Client(config);
  await c.connect();
  try {
    await c.query('BEGIN');
    if (user) await c.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: user, role })]);
    await c.query('SET LOCAL ROLE ' + role);
    return await fn(c);
  } finally {
    await c.query('ROLLBACK').catch(() => {});
    await c.end();
  }
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

    await test('SEC-10: a revoked token stays revoked and keeps its identity; the API\'s token writes still work', async () => {
      const id = (await db.query('SELECT id FROM api_token WHERE user_id = $1', [A])).rows[0].id;
      await as('authenticated', A, async (c) => {
        await c.query('UPDATE api_token SET last_used_at = now() WHERE id = $1', [id]);
        await c.query('UPDATE api_token SET revoked_at = COALESCE(revoked_at, now()) WHERE id = $1 AND user_id = $2', [id, A]);
        await c.query('SAVEPOINT s');
        await rejects(c.query('UPDATE api_token SET revoked_at = NULL WHERE id = $1', [id]), '42501');
        await c.query('ROLLBACK TO SAVEPOINT s');
        await rejects(c.query("UPDATE api_token SET token_hash = repeat('f', 64) WHERE id = $1", [id]), '42501');
      });
      // An administrator's revoke (the SECURITY DEFINER path) cannot be undone by the user either.
      await db.query('UPDATE api_token SET revoked_at = now() WHERE id = $1', [id]);
      await as('authenticated', A, (c) => rejects(c.query('UPDATE api_token SET revoked_at = NULL WHERE id = $1', [id]), '42501'));
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
