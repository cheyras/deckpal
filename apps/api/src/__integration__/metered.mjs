/** Metered Deck-E credit accounting against a disposable PostgreSQL 16 database. */
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
assert.equal(process.env.PGDATABASE, 'deckpal_ci_metered');
assert.equal(dirname(process.env.DECKPAL_TEST_RESULT), root);
assert.equal(existsSync(join(REPO, '.env')), false);
assert.equal(process.env.DATABASE_URL, undefined);

const config = { host: process.env.PGHOST, port: 55432, user: process.env.PGUSER, database: process.env.PGDATABASE, ssl: false };
const db = new pg.Client(config);
const results = { name: 'decke-metered-credits', status: 'running', cases: [] };
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner = id(1), paid = id(2), ten = id(3), low = id(4), held = id(5), debtor = id(6), race = id(7), spare = id(8);
const hash = (char = 'a') => char.repeat(64);
let keyNumber = 0;

async function test(name, fn) {
  await fn();
  results.cases.push({ name, status: 'passed' });
  console.log('PASS ' + name);
}

async function as(role, user, claims, fn) {
  const c = new pg.Client(config);
  await c.connect();
  try {
    await c.query('BEGIN');
    await c.query("SELECT set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: user, role, ...claims })]);
    await c.query('SET LOCAL ROLE ' + role);
    const value = await fn(c);
    await c.query('COMMIT');
    return value;
  } catch (error) {
    await c.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { await c.end(); }
}

const server = (user, fn) => as('authenticated', user, { deckpal_auth_kind: 'jwt', deckpal_server_request: true }, fn);
const session = (user, fn) => as('authenticated', user, { deckpal_auth_kind: 'jwt' }, fn);
const value = async (c, sql, args = []) => (await c.query(sql, args)).rows[0]?.data;
const rejects = (promise, code) => assert.rejects(promise, (error) => {
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
  } catch (error) {
    await db.query('ROLLBACK');
    throw new Error(`${file}: ${error.message}`, { cause: error });
  }
}

async function wallet(user, balance, carry = 0, debt = 0) {
  await db.query(`INSERT INTO public.decke_credit_balance(user_id,balance) VALUES($1,$2)
    ON CONFLICT(user_id) DO UPDATE SET balance=EXCLUDED.balance`, [user, balance]);
  await db.query(`INSERT INTO public.credit_wallet_control(user_id,debt) VALUES($1,$2)
    ON CONFLICT(user_id) DO UPDATE SET debt=EXCLUDED.debt`, [user, debt]);
  await db.query(`INSERT INTO public.decke_metered_credit(user_id,fractional_credits) VALUES($1,$2)
    ON CONFLICT(user_id) DO UPDATE SET fractional_credits=EXCLUDED.fractional_credits`, [user, carry]);
}

async function beginRequest(user, mode = 'paid', suffix = '') {
  const quote = (await db.query('SELECT public.credit_effective_policy($1) data', [user])).rows[0].data;
  const key = `metered:${++keyNumber}:${suffix || user}`;
  const begun = (await db.query(
    "SELECT public.decke_usage_begin($1,NULL,NULL,NULL,$2,$3,'fixture',279,$4,$5,$6,'') data",
    [user, key, hash(String((keyNumber % 9) + 1)), quote.revision, quote.overrideRevision, mode],
  )).rows[0].data;
  return begun.id;
}

async function meteredBegin(user, request) {
  return server(user, (c) => value(c, 'SELECT public.decke_metered_begin($1) data', [request]));
}

async function operation(user, request, tool, cost, n = ++keyNumber) {
  const operationId = id(1000 + n);
  const sql = tool.startsWith('jev_')
    ? 'SELECT public.decke_usage_external_operation_begin($1,$2,$3,\'fixture/model\',\'fixture\',$4,NULL)'
    : 'SELECT public.decke_usage_operation_begin($1,$2,$3,$4,\'fixture/model\',\'fixture\',$5,NULL)';
  const args = tool.startsWith('jev_')
    ? [operationId, request, tool, `${tool}-${n}`]
    : [operationId, request, tool === 'web_research' ? 'research' : 'response', tool, `${tool}-${n}`];
  await server(user, (c) => c.query(sql, args));
  await db.query(`UPDATE public.decke_ai_operation SET status='completed',finished_at=now(),
    cost_usd=$2,cost_source=CASE WHEN $2::numeric IS NULL THEN 'unknown' ELSE 'provider_reported' END
    WHERE id=$1`, [operationId, cost]);
  return operationId;
}

try {
  await db.connect();
  assert.equal((await db.query('SELECT inet_server_addr() addr')).rows[0].addr, null);
  await db.query(`
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY,email text,raw_user_meta_data jsonb DEFAULT '{}',encrypted_password text,last_sign_in_at timestamptz);
    CREATE TABLE auth.sessions (id uuid PRIMARY KEY,user_id uuid REFERENCES auth.users(id));
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT NULLIF(NULLIF(current_setting('request.jwt.claims',true),'')::jsonb->>'sub','')::uuid $$;
    GRANT USAGE ON SCHEMA auth TO anon,authenticated,service_role;
    GRANT EXECUTE ON FUNCTION auth.uid() TO anon,authenticated,service_role;
    GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated,service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon,authenticated,service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon,authenticated,service_role;
    CREATE TABLE schema_migrations(version text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now());
  `);

  const files = readdirSync(join(REPO, 'packages/db/src/migrations'))
    .filter((file) => /^\d+.*\.sql$/.test(file) && Number(file.slice(0, 3)) <= 78).sort();
  for (const file of files) {
    if (file.startsWith('021_')) await db.query('DELETE FROM public.app_user WHERE id NOT IN (SELECT id FROM auth.users)');
    await migration(file);
    if (file.startsWith('021_')) {
      await db.query(`INSERT INTO auth.users(id,email,raw_user_meta_data)
        SELECT ($1||lpad(n::text,12,'0'))::uuid,'metered-'||n||'@example.invalid',jsonb_build_object('username','metered-'||n)
        FROM generate_series(1,8) n`, ['00000000-0000-4000-8000-']);
    }
  }
  await db.query('SELECT public.admin_bootstrap($1,$2,$3)', [owner, [], []]);
  await db.query("UPDATE public.app_feature SET lifecycle='released' WHERE key='decke'");
  await db.query('SELECT public.credit_policy_initialize(true)');
  const v1 = (await db.query('SELECT public.credit_policy_read() data')).rows[0].data;
  assert.equal(v1.policy.version, undefined);
  await db.query("SELECT public.credit_apply_delta($1,200,'grant','Metered fixture','metered-fixture-paid')", [paid]);
  const flat = (await db.query(
    "SELECT public.credit_spend_create_effective($1,'chatTurn',$2,0,'pre-079-flat',$3) data",
    [paid, v1.revision, hash('f')],
  )).rows[0].data;
  assert.equal(flat.allowed, true);
  assert.equal(flat.spent, 1);
  const legacyRequest = (await db.query(
    "SELECT public.decke_usage_begin($1,NULL,NULL,NULL,'pre-079-flat',$2,'fixture',278,$3,0,'paid','') data",
    [paid, hash('f'), v1.revision],
  )).rows[0].data.id;
  await db.query(
    "SELECT public.decke_usage_operation_begin($1,$2,'response','chat_turn','fixture/model','fixture','chat_turn',$3)",
    [id(90), legacyRequest, flat.spendId],
  );
  await db.query("UPDATE public.decke_ai_operation SET status='completed',finished_at=now(),cost_usd='0.01',cost_source='provider_reported' WHERE id=$1", [id(90)]);
  await db.query("UPDATE public.decke_ai_request SET status='completed',finished_at=now(),charged_credits=1 WHERE id=$1", [legacyRequest]);
  await db.query("INSERT INTO public.decke_import_fix_credit(user_id,fractional_credits) VALUES($1,'0.4')", [paid]);
  await migration('079_decke_metered_credits.sql');

  await test('079 creates v2 current policy while preserving exact v1 history and migrated carry', async () => {
    const current = (await db.query('SELECT public.credit_policy_read() data')).rows[0].data;
    assert.deepEqual(current.policy, {
      version: 2, enabled: true, microUsdPerCredit: 10000, markupBps: 0,
      lowBalance: 100, legHoldCredits: 25, legHoldMinCredits: 3,
    });
    assert.deepEqual((await db.query('SELECT policy FROM public.credit_policy_revision WHERE revision=$1', [v1.revision])).rows[0].policy, v1.policy);
    assert.equal((await db.query('SELECT charged_credits::text value FROM public.decke_ai_request WHERE id=$1', [legacyRequest])).rows[0].value, '1.000000000000');
    assert.equal((await db.query('SELECT fractional_credits::text value FROM public.decke_metered_credit WHERE user_id=$1', [paid])).rows[0].value, '0.400000000000');
    assert.equal((await db.query('SELECT fractional_credits::text value FROM public.decke_import_fix_credit WHERE user_id=$1', [paid])).rows[0].value, '0.000000000000');
    await rejects(db.query("SELECT public.credit_validate_policy('{\"version\":2,\"enabled\":true,\"microUsdPerCredit\":10000,\"markupBps\":0,\"lowBalance\":1,\"legHoldCredits\":2,\"legHoldMinCredits\":3}')"), '22023');
  });

  await test('begin holds 25, all 10, or refuses below the three-credit minimum, and replay is idempotent', async () => {
    await wallet(ten, 10); await wallet(low, 2);
    const request25 = await beginRequest(paid, 'paid', 'hold-25');
    const first = await meteredBegin(paid, request25);
    const replay = await meteredBegin(paid, request25);
    assert.equal(first.heldCredits, 25); assert.equal(first.capCredits, '24.600000000000');
    assert.deepEqual(replay, first);
    const request10 = await beginRequest(ten, 'paid', 'hold-10');
    const tenResult = await meteredBegin(ten, request10);
    assert.equal(tenResult.heldCredits, 10); assert.equal(tenResult.balance, '0.000000000000');
    await server(ten, (c) => value(c, "SELECT public.decke_metered_settle($1,'cancelled') data", [request10]));
    const request2 = await beginRequest(low, 'paid', 'too-low');
    assert.deepEqual(await meteredBegin(low, request2), {
      allowed: false, reason: 'insufficient', balance: '2.000000000000', needed: 3,
    });
  });

  await test('payment holds and debt refuse admission without moving the wallet', async () => {
    await wallet(held, 30); await wallet(debtor, 30, 0, 4);
    const revision = (await db.query('SELECT revision FROM public.credit_policy_current')).rows[0].revision;
    const pack = (await db.query("INSERT INTO public.credit_pack(name,credits,price_cents,active) VALUES('hold',10,100,true) RETURNING id")).rows[0].id;
    await db.query(`INSERT INTO public.credit_order(user_id,pack_id,pack_revision,pack_name,credits,price_cents,currency,pricing_revision,attempt_key,pending_refund_cents)
      VALUES($1,$2,1,'hold',10,100,'usd',$3,'metered-payment-hold',1)`, [held, pack, revision]);
    assert.deepEqual(await meteredBegin(held, await beginRequest(held, 'paid', 'payment-hold')), {
      allowed: false, reason: 'payment_hold', balance: '30.000000000000',
    });
    assert.deepEqual(await meteredBegin(debtor, await beginRequest(debtor, 'paid', 'debt')), {
      allowed: false, reason: 'debt', balance: '30.000000000000', debt: 4,
    });
  });

  await test('two concurrent begins racing for the last credits admit exactly one', async () => {
    await wallet(race, 3);
    const requests = [await beginRequest(race, 'paid', 'race-a'), await beginRequest(race, 'paid', 'race-b')];
    const outcomes = await Promise.all(requests.map((request) => meteredBegin(race, request)));
    assert.equal(outcomes.filter((result) => result.allowed).length, 1);
    assert.equal(outcomes.filter((result) => !result.allowed && result.reason === 'insufficient').length, 1);
    assert.equal((await db.query('SELECT balance FROM public.decke_credit_balance WHERE user_id=$1', [race])).rows[0].balance, 0);
    const winner = requests[outcomes.findIndex((result) => result.allowed)];
    await server(race, (c) => value(c, "SELECT public.decke_metered_settle($1,'cancelled') data", [winner]));
  });

  await test('chat, research and Jev costs sum once; statement hides hold plumbing and keeps exact fractions', async () => {
    const reservation = (await db.query('SELECT request_id FROM public.decke_metered_reservation WHERE user_id=$1', [paid])).rows[0].request_id;
    await operation(paid, reservation, 'chat_turn', '0.010');
    await operation(paid, reservation, 'web_research', '0.020');
    await operation(paid, reservation, 'jev_reflex', '0.005');
    const settled = await server(paid, (c) => value(c, "SELECT public.decke_metered_settle($1,'completed') data", [reservation]));
    const replay = await server(paid, (c) => value(c, "SELECT public.decke_metered_settle($1,'completed') data", [reservation]));
    assert.equal(settled.credits, '3.500000000000'); assert.equal(settled.wholeCredits, 3);
    assert.equal(settled.coverage, 'complete'); assert.deepEqual(replay, settled);
    const statement = await session(paid, (c) => value(c, 'SELECT public.credit_events_read(NULL,100,0) data'));
    const chat = statement.events.find((event) => event.reason === 'Deck-E chat');
    assert.equal(chat.delta, -3.5);
    assert.equal(statement.events.some((event) => /chat hold|chat excess/i.test(event.reason)), false);
    const exact = await session(paid, (c) => value(c, 'SELECT public.credit_wallet_read(NULL) data'));
    assert.equal(exact.balance, settled.balance); assert.equal(exact.heldCredits, 0);
  });

  await test('pre-provider abort releases everything; partial and unknown coverage never guesses cost', async () => {
    await wallet(spare, 40);
    const aborted = await beginRequest(spare, 'paid', 'abort');
    await meteredBegin(spare, aborted);
    const zero = await server(spare, (c) => value(c, "SELECT public.decke_metered_settle($1,'cancelled') data", [aborted]));
    assert.equal(zero.credits, '0.000000000000'); assert.equal(zero.coverage, 'unknown'); assert.equal(zero.balance, '40.000000000000');
    const partial = await beginRequest(spare, 'paid', 'partial'); await meteredBegin(spare, partial);
    await operation(spare, partial, 'chat_turn', '0.010'); await operation(spare, partial, 'web_research', null);
    const partialResult = await server(spare, (c) => value(c, "SELECT public.decke_metered_settle($1,'failed') data", [partial]));
    assert.equal(partialResult.credits, '1.000000000000'); assert.equal(partialResult.coverage, 'partial');
    const unknown = await beginRequest(spare, 'paid', 'unknown'); await meteredBegin(spare, unknown);
    await operation(spare, unknown, 'chat_turn', null);
    const unknownResult = await server(spare, (c) => value(c, "SELECT public.decke_metered_settle($1,'failed') data", [unknown]));
    assert.equal(unknownResult.credits, '0.000000000000'); assert.equal(unknownResult.coverage, 'unknown');
    const invokedAbort = await beginRequest(spare, 'paid', 'invoked-abort'); await meteredBegin(spare, invokedAbort);
    await operation(spare, invokedAbort, 'chat_turn', '0.010');
    const chargedAbort = await server(spare, (c) => value(c, "SELECT public.decke_metered_settle($1,'cancelled') data", [invokedAbort]));
    assert.equal(chargedAbort.credits, '1.000000000000');
  });

  await test('known cost at the cap raises DKCAP before another provider operation', async () => {
    await wallet(low, 3);
    const request = await beginRequest(low, 'paid', 'cap'); await meteredBegin(low, request);
    await operation(low, request, 'chat_turn', '0.030');
    const status = await server(low, (c) => value(c, 'SELECT public.decke_metered_status($1) data', [request]));
    assert.equal(status.knownCredits, '3.000000000000'); assert.equal(status.capReached, true);
    await rejects(server(low, (c) => c.query(
      "SELECT public.decke_usage_operation_begin($1,$2,'response','chat_turn','fixture/model','fixture','after-cap',NULL)",
      [id(1900), request],
    )), 'DKCAP');
  });

  await test('provider overrun becomes debt and never a negative wallet', async () => {
    await wallet(race, 3);
    const request = await beginRequest(race, 'paid', 'overrun'); await meteredBegin(race, request);
    await operation(race, request, 'chat_turn', '0.050');
    const result = await server(race, (c) => value(c, "SELECT public.decke_metered_settle($1,'completed') data", [request]));
    assert.equal(result.credits, '5.000000000000');
    assert.equal((await db.query('SELECT balance FROM public.decke_credit_balance WHERE user_id=$1', [race])).rows[0].balance, 0);
    assert.equal((await db.query('SELECT debt FROM public.credit_wallet_control WHERE user_id=$1', [race])).rows[0].debt, 2);
  });

  await test('wallet read recovers a stale reservation after fifteen minutes using known cost', async () => {
    await wallet(ten, 10);
    const request = await beginRequest(ten, 'paid', 'stale'); await meteredBegin(ten, request);
    await operation(ten, request, 'chat_turn', '0.010');
    await db.query("UPDATE public.decke_metered_reservation SET created_at=now()-interval '16 minutes' WHERE request_id=$1", [request]);
    const recovered = await session(ten, (c) => value(c, 'SELECT public.credit_wallet_read(NULL) data'));
    assert.equal(recovered.balance, '9.000000000000');
    assert.equal((await db.query('SELECT status FROM public.decke_ai_request WHERE id=$1', [request])).rows[0].status, 'abandoned');
    assert.equal((await db.query('SELECT count(*)::int n FROM public.decke_metered_settlement WHERE request_id=$1', [request])).rows[0].n, 1);
  });

  await test('settlement uses the request frozen revision after current markup changes', async () => {
    await wallet(spare, 30);
    const request = await beginRequest(spare, 'paid', 'frozen'); await meteredBegin(spare, request);
    const current = (await db.query('SELECT public.credit_policy_read() data')).rows[0].data;
    await session(owner, (c) => value(c, 'SELECT public.credit_policy_save($1,$2) data', [{ ...current.policy, markupBps: 10000 }, current.revision]));
    await operation(spare, request, 'chat_turn', '0.010');
    const result = await server(spare, (c) => value(c, "SELECT public.decke_metered_settle($1,'completed') data", [request]));
    assert.equal(result.credits, '1.000000000000');
    await rejects(db.query("SELECT public.credit_spend_create_effective($1,'chatTurn',$2,0,'v2-flat-retired',$3)", [spare, current.revision + 1, hash('e')]), '22023');
  });

  await test('web roles cannot touch metered tables or recover, and server entry points require the claim', async () => {
    for (const table of ['decke_metered_credit', 'decke_metered_reservation', 'decke_metered_settlement']) {
      assert.equal((await db.query("SELECT has_table_privilege('anon',$1,'SELECT') allowed", [`public.${table}`])).rows[0].allowed, false);
      assert.equal((await db.query("SELECT has_table_privilege('authenticated',$1,'SELECT') allowed", [`public.${table}`])).rows[0].allowed, false);
    }
    await rejects(session(spare, (c) => c.query('SELECT public.decke_metered_recover($1)', [spare])), '42501');
    const request = await beginRequest(spare, 'paid', 'claim');
    await rejects(session(spare, (c) => c.query('SELECT public.decke_metered_begin($1)', [request])), '42501');
    await rejects(as('anon', spare, {}, (c) => c.query('SELECT public.decke_metered_begin($1)', [request])), '42501');
    await meteredBegin(spare, request);
    await rejects(session(spare, (c) => c.query('SELECT public.decke_metered_status($1)', [request])), '42501');
    await rejects(session(spare, (c) => c.query("SELECT public.decke_metered_settle($1,'cancelled')", [request])), '42501');
    await rejects(session(spare, (c) => c.query(
      "SELECT public.decke_usage_operation_begin($1,$2,'response','chat_turn','fixture/model','fixture','forged',NULL)",
      [id(1999), request],
    )), '42501');
    await server(spare, (c) => value(c, "SELECT public.decke_metered_settle($1,'cancelled') data", [request]));
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
