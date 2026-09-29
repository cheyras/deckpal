/**
 * Per-chat Deck-E improvement consent and pseudonymised corpus contract.
 * Invoked only by the runner-owned disposable PostgreSQL cluster.
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
assert.equal(process.env.PGDATABASE, 'deckpal_ci_improvement');
assert.equal(dirname(process.env.DECKPAL_TEST_RESULT), root);
assert.equal(existsSync(join(REPO, '.env')), false);
assert.equal(process.env.DATABASE_URL, undefined);

const config = { host: process.env.PGHOST, port: 55432, user: process.env.PGUSER, database: process.env.PGDATABASE, ssl: false };
const db = new pg.Client(config);
const results = { name: 'decke-improvement', status: 'running', cases: [] };
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner = id(1), member = id(2), outsider = id(3), newcomer = id(4);

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

const server = (user, fn) => as(user, { deckpal_auth_kind: 'jwt', deckpal_server_request: true }, fn);
const session = (user, fn) => as(user, { deckpal_auth_kind: 'jwt' }, fn);
const token = (user, tokenId, fn) => as(user, { deckpal_auth_kind: 'token', deckpal_token_id: tokenId }, fn);
const data = async (c, sql, args = []) => (await c.query(sql, args)).rows[0]?.data;
const denied = (promise) => assert.rejects(promise, (error) => {
  assert.equal(error.code, '42501', error.message);
  return true;
});

async function migration(file) {
  const sql = readFileSync(join(REPO, 'packages/db/src/migrations', file), 'utf8');
  await db.query('BEGIN');
  try { await db.query(sql); await db.query('COMMIT'); }
  catch (error) { await db.query('ROLLBACK'); throw new Error(`${file}: ${error.message}`, { cause: error }); }
}

async function seedConversation({ conversation, request, operation, seq = 0, cost = 0.001, suffix }) {
  await db.query(`INSERT INTO public.decke_conversation(id,user_id,title,turns)
    VALUES($1,$2,'private title',1)`, [conversation, member]);
  await db.query(`INSERT INTO public.decke_turn
    (conversation_id,user_id,seq,asked,answered,tools,build_sha,build_pr,finish_reason,exchange_id)
    VALUES($1,$2,$3,$4,$5,$6::jsonb,'fixture-sha',278,'stop',$7)`, [
    conversation, member, seq, `raw member-name question ${suffix}`,
    `raw Member Name answer member@example.invalid ${suffix}`,
    JSON.stringify([{ name: 'search_cards', phase: 'ok', title: 'private', summary: suffix }]), id(700 + Number(suffix)),
  ]);
  await db.query(`INSERT INTO public.decke_ai_request
    (id,user_id,conversation_id,exchange_id,seq,request_key,payload_hash,charge_mode,status,finished_at,build_sha,build_pr)
    VALUES($1,$2,$3,$4,$5,$6,$7,'daily','completed',now(),'fixture-sha',278)`, [
    request, member, conversation, id(800 + Number(suffix)), seq, `improvement-${suffix}-request`, 'a'.repeat(64),
  ]);
  await db.query(`INSERT INTO public.decke_ai_operation
    (id,request_id,category,tool_key,model_id,provider,operation_key,status,finished_at,
     input_tokens,output_tokens,cache_read_tokens,cache_write_tokens,reasoning_tokens,cost_usd,cost_source)
    VALUES($1,$2,'response','chat_turn','fixture/model','fixture','chat_turn','completed',now(),100,20,4,2,3,$3,$4)`, [
    operation, request, cost, cost === null ? 'unknown' : 'provider_reported',
  ]);
}

const validLeg = (answer = 'redacted answer') => ({
  asked: 'redacted question', answered: answer, model_id: 'fixture/model', provider: 'fixture',
  started_at: '2026-09-28T18:00:00.000Z', finished_at: '2026-09-28T18:00:01.000Z', latency_ms: 1000,
  input_tokens: 100, output_tokens: 20, cache_read_tokens: 4, cache_write_tokens: 2, reasoning_tokens: 3,
  cost_usd: 0.001, cost_source: 'provider_reported', status: 'completed', finish_reason: 'stop',
  build_sha: 'fixture-sha', build_pr: 278, error: null,
  tool_calls: [{ id: 'tool-1', name: 'search_cards', args: { query: 'redacted' }, output: { ok: true }, phase: 'completed' }],
});

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

  const migrationFiles = readdirSync(join(REPO, 'packages/db/src/migrations'))
    .filter((file) => /^\d+.*\.sql$/.test(file) && Number(file.slice(0, 3)) <= 77)
    .sort();
  for (const file of migrationFiles) {
    if (file.startsWith('021_')) await db.query('DELETE FROM public.app_user WHERE id NOT IN (SELECT id FROM auth.users)');
    await migration(file);
    if (file.startsWith('021_')) {
      await db.query(`INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
        ($1,'owner@example.invalid','{"username":"owner-name"}'),
        ($2,'member@example.invalid','{"username":"member-name"}'),
        ($3,'outsider@example.invalid','{"username":"outsider-name"}')`, [owner, member, outsider]);
      await db.query(`UPDATE public.user_profile SET display_name=CASE user_id::text
        WHEN $1 THEN 'Owner Name' WHEN $2 THEN 'Member Name' WHEN $3 THEN 'Outsider Name' END
        WHERE user_id::text=ANY($4::text[])`, [owner, member, outsider, [owner, member, outsider]]);
    }
  }

  await test('pre-078 settings have no share-prompt column', async () => {
    const count = await db.query("SELECT count(*)::int n FROM information_schema.columns WHERE table_schema='public' AND table_name='user_settings' AND column_name='decke_share_prompts'");
    assert.equal(count.rows[0].n, 0);
  });

  await migration('078_decke_improvement.sql');
  await db.query('SELECT public.admin_bootstrap($1,$2,$3)', [owner, [], []]);
  await db.query("INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES($1,'new@example.invalid','{\"username\":\"new-name\"}')", [newcomer]);

  await test('share prompts default on while collection defaults empty', async () => {
    const rows = (await db.query('SELECT decke_share_prompts FROM public.user_settings ORDER BY user_id')).rows;
    assert.equal(rows.length, 4);
    assert.ok(rows.every((row) => row.decke_share_prompts === true));
    assert.equal((await db.query('SELECT count(*)::int n FROM public.decke_improvement_consent')).rows[0].n, 0);
    assert.equal((await db.query('SELECT count(*)::int n FROM public.decke_improvement_conversation')).rows[0].n, 0);
  });

  const declinedConversation = id(100), declinedRequest = id(101);
  await seedConversation({ conversation: declinedConversation, request: declinedRequest, operation: id(102), suffix: '100' });
  await test('can_ask records once and a decline permanently blocks prompts', async () => {
    const first = await server(member, (c) => data(c, 'SELECT public.decke_improvement_can_ask($1,$2) data', [member, declinedConversation]));
    const second = await server(member, (c) => data(c, 'SELECT public.decke_improvement_can_ask($1,$2) data', [member, declinedConversation]));
    assert.deepEqual(first, { allowed: true, reason: 'asked' });
    assert.deepEqual(second, { allowed: false, reason: 'already_asked' });
    const answer = await server(member, (c) => data(c,
      "SELECT public.decke_improvement_answer($1,$2,false,'decke_ask') data", [member, declinedConversation]));
    assert.equal(answer.status, 'declined');
    const after = await server(member, (c) => data(c, 'SELECT public.decke_improvement_can_ask($1,$2) data', [member, declinedConversation]));
    assert.deepEqual(after, { allowed: false, reason: 'already_declined' });
    assert.equal((await db.query('SELECT count(*)::int n FROM public.decke_improvement_conversation')).rows[0].n, 0);
  });

  const disabledConversation = id(110), disabledRequest = id(111);
  await seedConversation({ conversation: disabledConversation, request: disabledRequest, operation: id(112), suffix: '110' });
  await test('disabled prompt preference blocks asking and writers no-op when not shared', async () => {
    await session(member, (c) => c.query('UPDATE public.user_settings SET decke_share_prompts=false WHERE user_id=auth.uid()'));
    const blocked = await server(member, (c) => data(c, 'SELECT public.decke_improvement_can_ask($1,$2) data', [member, disabledConversation]));
    assert.deepEqual(blocked, { allowed: false, reason: 'prompts_disabled' });
    const leg = await server(member, (c) => data(c,
      'SELECT public.decke_improvement_record_leg($1,$2,0,$3,0,$4::jsonb) data',
      [member, disabledConversation, disabledRequest, JSON.stringify(validLeg())]));
    const events = await server(member, (c) => data(c,
      'SELECT public.decke_improvement_record_events($1,$2,0,0,$3::jsonb) data',
      [member, disabledConversation, JSON.stringify([{ kind: 'animation', at: '2026-09-28T18:00:00Z', payload: { state: 'thinking' } }])]));
    assert.deepEqual(leg, { recorded: false, reason: 'not_shared' });
    assert.deepEqual(events, { recorded: false, reason: 'not_shared' });
    const feedback = await server(member, (c) => data(c,
      'SELECT public.decke_improvement_record_feedback($1,$2,0,-1,$3,false) data',
      [member, disabledConversation, 'personal only']));
    assert.equal(feedback.saved, true);
    assert.equal(feedback.copied, false);
    assert.equal(feedback.shared, false);
    assert.equal((await db.query('SELECT count(*)::int n FROM public.decke_improvement_consent')).rows[0].n, 1);
    await session(member, (c) => c.query('UPDATE public.user_settings SET decke_share_prompts=true WHERE user_id=auth.uid()'));
  });

  const sharedConversation = id(120), sharedRequest = id(121), unknownRequest = id(123);
  await seedConversation({ conversation: sharedConversation, request: sharedRequest, operation: id(122), suffix: '120' });
  await db.query(`INSERT INTO public.decke_ai_request
    (id,user_id,conversation_id,exchange_id,seq,request_key,payload_hash,charge_mode,status,finished_at,build_sha,build_pr)
    VALUES($1,$2,$3,$4,0,'improvement-120-retry',$5,'daily','completed',now(),'fixture-sha',278)`,
  [unknownRequest, member, sharedConversation, id(824), 'b'.repeat(64)]);
  await db.query(`INSERT INTO public.decke_ai_operation
    (id,request_id,category,tool_key,model_id,provider,operation_key,status,finished_at,cost_source)
    VALUES($1,$2,'response','chat_turn','fixture/model','fixture','retry','completed',now(),'unknown')`, [id(124), unknownRequest]);

  let derivedShared;
  await test('answer share backfills accounting only and returns raw content for API redaction', async () => {
    const answer = await server(member, (c) => data(c,
      "SELECT public.decke_improvement_answer($1,$2,true,'reader') data", [member, sharedConversation]));
    assert.equal(answer.status, 'shared');
    assert.equal(answer.backfill.turns[0].asked, 'raw member-name question 120');
    assert.equal(answer.backfill.requests.length, 2);
    derivedShared = answer.conversationId;
    for (const raw of [member, sharedConversation, sharedRequest, unknownRequest]) assert.notEqual(derivedShared, raw);
    const beforeContent = (await db.query('SELECT asked,answered,cost_usd,cost_coverage FROM public.decke_improvement_turn WHERE conversation_id=$1', [derivedShared])).rows[0];
    assert.equal(beforeContent.asked, '');
    assert.equal(beforeContent.answered, '');
    assert.equal(Number(beforeContent.cost_usd), 0.001);
    assert.equal(beforeContent.cost_coverage, 'partial');
    const backfill = await server(member, (c) => data(c,
      'SELECT public.decke_improvement_record_backfill($1,$2,$3::jsonb) data', [member, sharedConversation, JSON.stringify([
        { seq: 0, asked: 'API redacted question', answered: 'API redacted answer', tools: [{ name: 'search_cards', phase: 'ok' }] },
      ])]));
    assert.equal(backfill.recorded, true);
    const stored = (await db.query('SELECT asked,answered,tools FROM public.decke_improvement_turn WHERE conversation_id=$1', [derivedShared])).rows[0];
    assert.equal(stored.asked, 'API redacted question');
    assert.doesNotMatch(JSON.stringify(stored), /member-name|Member Name|member@example\.invalid/i);
  });

  await test('shared writers capture full legs/events and preserve pseudonymous IDs', async () => {
    const recorded = await server(member, (c) => data(c,
      'SELECT public.decke_improvement_record_leg($1,$2,0,$3,0,$4::jsonb) data',
      [member, sharedConversation, sharedRequest, JSON.stringify(validLeg())]));
    assert.equal(recorded.recorded, true);
    assert.notEqual(recorded.legId, sharedRequest);
    const events = [{ kind: 'error', at: '2026-09-28T18:00:00.500Z', payload: { message: 'redacted failure' } }];
    const first = await server(member, (c) => data(c,
      'SELECT public.decke_improvement_record_events($1,$2,0,7,$3::jsonb) data', [member, sharedConversation, JSON.stringify(events)]));
    const replay = await server(member, (c) => data(c,
      'SELECT public.decke_improvement_record_events($1,$2,0,7,$3::jsonb) data', [member, sharedConversation, JSON.stringify(events)]));
    assert.equal(first.duplicate, false);
    assert.equal(replay.duplicate, true);
  });

  const feedbackConversation = id(130), feedbackRequest = id(131);
  await seedConversation({ conversation: feedbackConversation, request: feedbackRequest, operation: id(132), suffix: '130' });
  await test('feedback can grant sharing, always saves personal feedback, and list_mine maps raw IDs', async () => {
    const saved = await server(member, (c) => data(c,
      'SELECT public.decke_improvement_record_feedback($1,$2,0,1,$3,true) data',
      [member, feedbackConversation, 'Member Name liked this']));
    assert.equal(saved.saved, true);
    assert.equal(saved.shared, true);
    assert.equal(saved.copied, true);
    const ownCount = await session(member, async (c) => (await c.query('SELECT count(*)::int n FROM public.decke_turn_feedback')).rows[0].n);
    const otherCount = await session(outsider, async (c) => (await c.query('SELECT count(*)::int n FROM public.decke_turn_feedback')).rows[0].n);
    assert.equal(ownCount, 2);
    assert.equal(otherCount, 0);
    const mine = await server(member, (c) => data(c, 'SELECT public.decke_improvement_list_mine($1) data', [member]));
    assert.deepEqual(new Set(mine.items.map((item) => item.conversationId)), new Set([sharedConversation, feedbackConversation]));
    assert.equal(mine.items.some((item) => item.conversationId === derivedShared), false);
  });

  let tokenId;
  await test('improvement readers require permission and live token capability', async () => {
    await denied(session(member, (c) => data(c, "SELECT public.decke_improvement_list('{}',NULL,20) data")));
    tokenId = (await db.query(
      "INSERT INTO public.api_token(user_id,name,token_hash,prefix) VALUES($1,'improvement fixture',$2,'dsk_fixture0') RETURNING id",
      [owner, 'f'.repeat(64)])).rows[0].id;
    await denied(token(owner, tokenId, (c) => data(c, "SELECT public.decke_improvement_list('{}',NULL,20) data")));
    await session(owner, (c) => data(c, 'SELECT public.decke_improvement_token_capability($1,true) data', [tokenId]));
    const list = await token(owner, tokenId, (c) => data(c, "SELECT public.decke_improvement_list('{}',NULL,20) data"));
    assert.equal(list.items.length, 2);
    assert.equal(JSON.stringify(list).includes('owner_key'), false);
    const detail = await token(owner, tokenId, (c) => data(c, 'SELECT public.decke_improvement_detail($1) data', [derivedShared]));
    assert.equal(detail.turns[0].tools[0].name, 'search_cards');
    assert.equal(JSON.stringify(detail).includes('owner_key'), false);
    await db.query('UPDATE public.api_token SET revoked_at=now() WHERE id=$1', [tokenId]);
    await denied(token(owner, tokenId, (c) => data(c, "SELECT public.decke_improvement_list('{}',NULL,20) data")));
  });

  await test('all-chat cost rollup uses existing AI Usage authorization and includes unshared chats', async () => {
    await denied(session(member, (c) => data(c, "SELECT public.decke_usage_conversation_costs('{}',NULL,100) data")));
    const costs = await session(owner, (c) => data(c, "SELECT public.decke_usage_conversation_costs('{}',NULL,100) data"));
    const ids = new Set(costs.items.map((item) => item.conversationId));
    assert.ok(ids.has(declinedConversation));
    assert.ok(ids.has(disabledConversation));
    assert.ok(ids.has(sharedConversation));
    const shared = costs.items.find((item) => item.conversationId === sharedConversation);
    assert.equal(shared.costCoverage, 'partial');
    assert.equal(Number(shared.costUsd), 0.001);
    assert.equal(shared.userId, member);
    assert.equal(JSON.stringify(costs).includes('asked'), false);
  });

  await test('revoke deletes one corpus, keeps personal state, and blocks later writers', async () => {
    const revoked = await server(member, (c) => data(c,
      'SELECT public.decke_improvement_revoke($1,$2) data', [member, sharedConversation]));
    assert.equal(revoked.revoked, true);
    assert.equal(revoked.deleted.conversations, 1);
    assert.equal((await db.query('SELECT count(*)::int n FROM public.decke_improvement_conversation WHERE id=$1', [derivedShared])).rows[0].n, 0);
    const consent = (await db.query('SELECT status FROM public.decke_improvement_consent WHERE id=$1', [derivedShared])).rows[0];
    assert.equal(consent.status, 'revoked');
    const noop = await server(member, (c) => data(c,
      'SELECT public.decke_improvement_record_leg($1,$2,0,$3,0,$4::jsonb) data',
      [member, sharedConversation, sharedRequest, JSON.stringify(validLeg())]));
    assert.deepEqual(noop, { recorded: false, reason: 'not_shared' });
    const ask = await server(member, (c) => data(c, 'SELECT public.decke_improvement_can_ask($1,$2) data', [member, sharedConversation]));
    assert.deepEqual(ask, { allowed: false, reason: 'already_revoked' });
    const mine = await server(member, (c) => data(c, 'SELECT public.decke_improvement_list_mine($1) data', [member]));
    assert.deepEqual(mine.items.map((item) => item.conversationId), [feedbackConversation]);
  });

  const oldConversation = id(140), oldRequest = id(141);
  await seedConversation({ conversation: oldConversation, request: oldRequest, operation: id(142), suffix: '140' });
  await test('180-day purge removes corpus cascades but retains shared consent', async () => {
    const shared = await server(member, (c) => data(c,
      "SELECT public.decke_improvement_answer($1,$2,true,'reader') data", [member, oldConversation]));
    await db.query("UPDATE public.decke_improvement_conversation SET updated_at=now()-interval '181 days' WHERE id=$1", [shared.conversationId]);
    assert.equal((await db.query('SELECT public.decke_improvement_purge_expired() n')).rows[0].n, 1);
    assert.equal((await db.query('SELECT count(*)::int n FROM public.decke_improvement_leg WHERE conversation_id=$1', [shared.conversationId])).rows[0].n, 0);
    assert.equal((await db.query('SELECT status FROM public.decke_improvement_consent WHERE id=$1', [shared.conversationId])).rows[0].status, 'shared');
  });

  await test('collection and consent tables are unreachable directly from web roles', async () => {
    await denied(session(owner, (c) => c.query('SELECT * FROM public.decke_improvement_consent')));
    await denied(as(null, { role: 'anon' }, async (c) => {
      await c.query('RESET ROLE');
      await c.query('SET LOCAL ROLE anon');
      return c.query('SELECT * FROM public.decke_improvement_secret');
    }));
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
