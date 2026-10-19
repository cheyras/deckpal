/**
 * Knowledge notes (Phase 6, migrations 089/090) against a real PostgreSQL 16 with every shipped migration applied,
 * Supabase's RLS files included (an auth schema stub as in improvement.mjs). Invoked only by
 * scripts/test-db-integration.mjs.
 *
 * What it proves, at the database, where the guarantees live:
 *   - knowledge.review is held by the admin tiers and may be given to a contributor role, never to a user role;
 *   - an account inserts only its own pending, unreviewed note, and sees approved notes plus its own;
 *   - only a reviewer, in a browser session, decides a note, once, and every decision is audited;
 *   - nobody edits or deletes a note through the table.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../../..');
const root = process.env.DECKPAL_TEST_ROOT;
assert.ok(root && /^\/tmp\/deckpal-db-[^/]+$/.test(root));
assert.equal(realpathSync(root), root);
assert.equal(readFileSync(join(root, '.deckpal-ci-owner'), 'utf8'), process.env.DECKPAL_TEST_MARKER);
assert.equal(process.env.PGHOST, join(root, 'socket'));
assert.equal(process.env.PGPORT, '55432');
assert.equal(process.env.PGUSER, 'deckpal_ci_fixture');
assert.equal(process.env.PGDATABASE, 'deckpal_ci_knowledge');
assert.equal(dirname(process.env.DECKPAL_TEST_RESULT), root);
assert.equal(existsSync(join(REPO, '.env')), false);
assert.equal(process.env.DATABASE_URL, undefined);

const config = { host: process.env.PGHOST, port: 55432, user: process.env.PGUSER, database: process.env.PGDATABASE, ssl: false };
const db = new pg.Client(config);
const results = { name: 'knowledge-notes', status: 'running', cases: [] };
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner = id(1), member = id(2), outsider = id(3), contributor = id(4);
const CONTRIBUTOR_ROLE = '68000000-0000-4000-8000-000000000030';

async function test(name, fn) {
  await fn();
  results.cases.push({ name, status: 'passed' });
  console.log('PASS ' + name);
}

async function as(user, claims, fn) {
  const c = new pg.Client(config);
  await c.connect();
  try {
    await c.query('BEGIN');
    await c.query("SELECT set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: user, role: 'authenticated', ...claims })]);
    await c.query('SET LOCAL ROLE authenticated');
    const value = await fn(c);
    await c.query('COMMIT');
    return value;
  } catch (error) {
    await c.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { await c.end(); }
}
const session = (user, fn) => as(user, { deckpal_auth_kind: 'jwt' }, fn);
const token = (user, fn) => as(user, { deckpal_auth_kind: 'token', deckpal_token_id: id(900) }, fn);
const denied = (promise, code = '42501') => assert.rejects(promise, (error) => {
  assert.equal(error.code, code, error.message);
  return true;
});

async function migration(file) {
  const sql = readFileSync(join(REPO, 'packages/db/src/migrations', file), 'utf8');
  await db.query('BEGIN');
  try {
    await db.query(sql);
    await db.query('INSERT INTO schema_migrations(version,checksum) VALUES($1,$2)', [file.replace(/\.sql$/, ''), 'integration']);
    await db.query('COMMIT');
  } catch (error) { await db.query('ROLLBACK'); throw new Error(`${file}: ${error.message}`, { cause: error }); }
}

const note = (who, extra = {}) => ({
  card_names: ['dragapult ex', 'nighttime mine'],
  statement: 'Nighttime Mine makes Phantom Dive cost one more Colorless, because Dragapult ex is a Tera Pokémon.',
  source_url: 'https://www.pokemon.com/us/pokemon-tcg/rules',
  quote: 'Attacks used by each Tera Pokémon in play cost one more Colorless Energy.',
  proposed_by: who,
  ...extra,
});
const insert = (c, n) => c.query(
  `INSERT INTO public.knowledge_note (card_names, statement, source_url, quote, proposed_by${n.status ? ', status, reviewed_at' : ''})
   VALUES ($1, $2, $3, $4, $5${n.status ? ', $6, now()' : ''}) RETURNING id`,
  [n.card_names, n.statement, n.source_url, n.quote, n.proposed_by, ...(n.status ? [n.status] : [])],
);

try {
  await db.connect();
  assert.equal((await db.query('SELECT inet_server_addr() addr')).rows[0].addr, null);
  await db.query(`
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (
      id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb DEFAULT '{}',
      encrypted_password text, last_sign_in_at timestamptz
    );
    CREATE TABLE auth.sessions (id uuid PRIMARY KEY, user_id uuid REFERENCES auth.users(id));
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT NULLIF(NULLIF(current_setting('request.jwt.claims',true),'')::jsonb->>'sub','')::uuid $$;
    GRANT USAGE ON SCHEMA auth TO anon,authenticated,service_role;
    GRANT EXECUTE ON FUNCTION auth.uid() TO anon,authenticated,service_role;
    GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated,service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon,authenticated,service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon,authenticated,service_role;
  `);
  await db.query(`CREATE TABLE schema_migrations (
    version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
  const files = readdirSync(join(REPO, 'packages/db/src/migrations')).filter((f) => /^\d+.*\.sql$/.test(f)).sort();
  assert.ok(files.includes('089_knowledge_note.sql') && files.includes('090_knowledge_note_rls.sql'));
  for (const file of files) {
    if (file.startsWith('021_')) await db.query('DELETE FROM public.app_user WHERE id NOT IN (SELECT id FROM auth.users)');
    await migration(file);
    if (file.startsWith('021_')) {
      await db.query(`INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
        ($1,'owner@example.invalid','{"username":"owner-name"}'),
        ($2,'member@example.invalid','{"username":"member-name"}'),
        ($3,'outsider@example.invalid','{"username":"outsider-name"}'),
        ($4,'contributor@example.invalid','{"username":"contributor-name"}')`, [owner, member, outsider, contributor]);
    }
    if (file.startsWith('089_')) {
      // The runner commits 089 on its own: until 090's policies exist, a client role must not reach the table at all.
      await denied(session(member, (c) => insert(c, note(member, { status: 'approved' }))));
      await denied(session(member, (c) => insert(c, note(member))));
      assert.equal((await session(member, (c) => c.query('SELECT count(*)::int n FROM public.knowledge_note'))).rows[0].n, 0);
      results.cases.push({ name: 'between 089 and 090 a client role can neither read nor write notes', status: 'passed' });
      console.log('PASS between 089 and 090 a client role can neither read nor write notes');
    }
  }
  await db.query('SELECT public.admin_bootstrap($1,$2,$3)', [owner, [], []]);

  await test('knowledge.review is held by the admin tiers, may be given to a contributor, and never to a user role', async () => {
    const held = (await db.query(`SELECT r.key FROM public.admin_role r JOIN public.admin_role_permission rp ON rp.role_id = r.id
      WHERE rp.permission_key = 'knowledge.review' AND r.system ORDER BY r.tier`)).rows.map((r) => r.key);
    assert.deepEqual(held, ['admin', 'super_admin', 'owner']);
    assert.ok((await db.query('SELECT public.admin_permission_ceiling(30) c')).rows[0].c.includes('knowledge.review'));
    assert.ok(!(await db.query('SELECT public.admin_permission_ceiling(20) c')).rows[0].c.includes('knowledge.review'));
    assert.ok((await db.query('SELECT public.admin_permissions($1) p', [owner])).rows[0].p.includes('knowledge.review'));
    assert.ok(!(await db.query('SELECT public.admin_permissions($1) p', [member])).rows[0].p.includes('knowledge.review'));
  });

  let pendingId;
  await test('an account inserts only its own pending, unreviewed note', async () => {
    pendingId = (await session(member, (c) => insert(c, note(member)))).rows[0].id;
    await denied(session(member, (c) => insert(c, note(outsider))));
    await denied(session(member, (c) => insert(c, note(member, { status: 'approved' }))));
  });

  await test('a pending note is its proposer\'s alone; nobody edits or deletes a note through the table', async () => {
    assert.equal((await session(member, (c) => c.query('SELECT count(*)::int n FROM public.knowledge_note'))).rows[0].n, 1);
    assert.equal((await session(outsider, (c) => c.query('SELECT count(*)::int n FROM public.knowledge_note'))).rows[0].n, 0);
    const edit = await session(member, (c) => c.query("UPDATE public.knowledge_note SET status = 'approved' WHERE id = $1", [pendingId]));
    assert.equal(edit.rowCount, 0);
    const drop = await session(member, (c) => c.query('DELETE FROM public.knowledge_note WHERE id = $1', [pendingId]));
    assert.equal(drop.rowCount, 0);
    assert.equal((await db.query('SELECT status FROM public.knowledge_note WHERE id = $1', [pendingId])).rows[0].status, 'pending');
  });

  await test('only a reviewer in a browser session decides a note: not a member, not a token', async () => {
    await denied(session(member, (c) => c.query("SELECT * FROM public.knowledge_note_review($1, 'approved', '')", [pendingId])));
    await denied(token(owner, (c) => c.query("SELECT * FROM public.knowledge_note_review($1, 'approved', '')", [pendingId])));
    await denied(session(member, (c) => c.query("SELECT * FROM public.knowledge_note_queue('pending', NULL, 50)")));
  });

  await test('the queue shows a reviewer what is pending', async () => {
    const queue = await session(owner, (c) => c.query("SELECT id FROM public.knowledge_note_queue('pending', NULL, 50)"));
    assert.deepEqual(queue.rows.map((r) => String(r.id)), [String(pendingId)]);
  });

  await test('an approved note is read by every account, decided once, and audited', async () => {
    const decided = await session(owner, (c) => c.query("SELECT status, reviewed_by FROM public.knowledge_note_review($1, 'approved', 'Matches the card text.')", [pendingId]));
    assert.equal(decided.rows[0].status, 'approved');
    assert.equal(decided.rows[0].reviewed_by, owner);
    assert.equal((await session(outsider, (c) => c.query('SELECT count(*)::int n FROM public.knowledge_note WHERE status = $1', ['approved']))).rows[0].n, 1);
    await denied(session(owner, (c) => c.query("SELECT * FROM public.knowledge_note_review($1, 'rejected', 'no')", [pendingId])), 'P0002');
    const audit = await db.query("SELECT action, reason FROM public.admin_audit WHERE target_type = 'knowledge_note' AND target_id = $1", [String(pendingId)]);
    assert.deepEqual(audit.rows, [{ action: 'knowledge.approved', reason: 'Matches the card text.' }]);
  });

  await test('a rejected note goes back to being its proposer\'s alone', async () => {
    const second = (await session(member, (c) => insert(c, note(member, { statement: 'A second, wrong statement about how these cards interact.' })))).rows[0].id;
    await session(owner, (c) => c.query("SELECT * FROM public.knowledge_note_review($1, 'rejected', 'Contradicts the ruling.')", [second]));
    const seen = await session(outsider, (c) => c.query('SELECT id FROM public.knowledge_note'));
    assert.deepEqual(seen.rows.map((r) => String(r.id)), [String(pendingId)]);
    await denied(session(owner, (c) => c.query("SELECT * FROM public.knowledge_note_review($1, 'maybe', '')", [second])), '22023');
  });

  await test('a contributor given knowledge.review lists and decides notes, without gaining admin.access', async () => {
    await db.query("INSERT INTO public.admin_role_permission(role_id, permission_key) VALUES ($1, 'knowledge.review') ON CONFLICT DO NOTHING", [CONTRIBUTOR_ROLE]);
    await db.query(`INSERT INTO public.admin_account(user_id, role_id) VALUES ($1, $2)
      ON CONFLICT (user_id) DO UPDATE SET role_id = EXCLUDED.role_id`, [contributor, CONTRIBUTOR_ROLE]);
    const perms = (await db.query('SELECT public.admin_permissions($1) p', [contributor])).rows[0].p;
    assert.ok(perms.includes('knowledge.review'));
    assert.ok(!perms.includes('admin.access'));
    const third = (await session(member, (c) => insert(c, note(member, { statement: 'A third statement, for the contributor to decide.' })))).rows[0].id;
    const queue = await session(contributor, (c) => c.query("SELECT id FROM public.knowledge_note_queue('pending', NULL, 50)"));
    assert.deepEqual(queue.rows.map((r) => String(r.id)), [String(third)]);
    const decided = await session(contributor, (c) => c.query("SELECT status, reviewed_by FROM public.knowledge_note_review($1, 'approved', 'Checked against the ruling.')", [third]));
    assert.deepEqual(decided.rows[0], { status: 'approved', reviewed_by: contributor });
    await denied(token(contributor, (c) => c.query("SELECT * FROM public.knowledge_note_queue('pending', NULL, 50)")));
    await denied(session(member, (c) => c.query('SELECT public.knowledge_require_reviewer()')));
  });

  results.status = 'passed';
} catch (error) {
  results.status = 'failed';
  results.error = error.stack || error.message;
  process.exitCode = 1;
  console.error(error);
} finally {
  await db.end().catch(() => {});
  writeFileSync(process.env.DECKPAL_TEST_RESULT, JSON.stringify(results, null, 2) + '\n');
}
