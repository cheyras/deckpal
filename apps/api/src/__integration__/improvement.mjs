/**
 * Per-chat Deck-E improvement consent and pseudonymised corpus contract.
 * Invoked only by the runner-owned disposable PostgreSQL cluster.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { backfillShared, recordLeg } from '../decke/improvement.js';
import * as improvementRoute from '../routes/deckeImprovement.js';

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
const owner = id(1), member = id(2), outsider = id(3), newcomer = id(4), plusMember = id(5);
const slash = String.fromCharCode(92);
const identityTerms = ['John Smith', 'José', 'jsmith@example.invalid', 'alice+tag@example.invalid'];
const unicodeTerms = ['é', 'Иван', 'דוד', 'محمد', '李', '😀'];
const utf8ClassTerms = ['é', '\u0800', '李', '\uD7E3', '\uE000', '😀', '\u{40000}', '\u{100000}', 'Иван', 'דוד', 'محمد'];

function percentEncode(value) {
  return [...Buffer.from(value, 'utf8')].map((byte) => `%${byte.toString(16).toUpperCase().padStart(2, '0')}`).join('');
}

function encodeDepth(value, depth) {
  for (let pass = 0; pass < depth; pass++) value = percentEncode(value);
  return value;
}

function lenientPercentDecode(value) {
  return value.replace(/(?:%[0-9a-f]{2})+/giu, (run) => {
    const bytes = run.match(/%[0-9a-f]{2}/giu).map((token) => Number.parseInt(token.slice(1), 16));
    return Buffer.from(bytes).toString('utf8').replaceAll('\u0000', '\uFFFD');
  });
}

function jsonEscapeDecode(value) {
  return value.replace(
    /\\u([dD][89aAbB][0-9a-f]{2})\\u([dD][c-fC-F][0-9a-f]{2})|\\u([0-9a-f]{4})/giu,
    (_match, highHex, lowHex, scalarHex) => {
      let point;
      if (highHex !== undefined) {
        const high = Number.parseInt(highHex, 16);
        const low = Number.parseInt(lowHex, 16);
        point = 0x10000 + ((high - 0xD800) * 0x400) + (low - 0xDC00);
      } else {
        point = Number.parseInt(scalarHex, 16);
      }
      return point === 0 || (point >= 0xD800 && point <= 0xDFFF) ? '\uFFFD' : String.fromCodePoint(point);
    },
  );
}

function htmlEntityDecode(value) {
  const named = { commat: '@', quot: '"', apos: "'", lt: '<', gt: '>', amp: '&' };
  return value.replace(/&#(?:x([0-9a-f]{1,6})|([0-9]{1,7}));|&(commat|quot|apos|lt|gt|amp);/giu,
    (_match, hex, decimal, entity) => {
      if (entity !== undefined) return named[entity.toLowerCase()];
      const point = Number.parseInt(hex ?? decimal, hex === undefined ? 10 : 16);
      return point === 0 || point > 0x10FFFF || (point >= 0xD800 && point <= 0xDFFF)
        ? '\uFFFD' : String.fromCodePoint(point);
    });
}

// This test oracle deliberately explores the primitive decoders in every
// order. It does not share the production redactor's fixed-step pipeline.
function independentlyDecodedViews(value, maxDepth = 5) {
  const decoders = [lenientPercentDecode, jsonEscapeDecode, htmlEntityDecode, (input) => input.replaceAll('+', ' ')];
  const seen = new Set([value]);
  let frontier = [value];
  for (let depth = 1; depth <= maxDepth; depth++) {
    const next = [];
    for (const view of frontier) {
      for (const decode of decoders) {
        const candidate = decode(view);
        if (!seen.has(candidate)) {
          seen.add(candidate);
          next.push(candidate);
        }
      }
    }
    frontier = next;
    if (frontier.length === 0) break;
  }
  return seen;
}

function assertIdentitySafe(value, label, terms = identityTerms) {
  for (const view of independentlyDecodedViews(value)) {
    const candidate = view.normalize('NFKC').toLowerCase();
    for (const term of terms) {
      for (const expected of [term, term.replaceAll('+', ' ')]) {
        assert.equal(candidate.includes(expected.normalize('NFKC').toLowerCase()), false,
          `${label} leaked ${term} after independent decoding: ${value}`);
      }
    }
  }
}

function jsonEscapeFirst(value) {
  const first = String.fromCodePoint(value.codePointAt(0));
  let escaped = '';
  for (let index = 0; index < first.length; index++) {
    escaped += `${slash}u${first.charCodeAt(index).toString(16).padStart(4, '0')}`;
  }
  return escaped + value.slice(first.length);
}

function htmlEncodeFirst(value) {
  const first = String.fromCodePoint(value.codePointAt(0));
  return `&#x${first.codePointAt(0).toString(16)};${value.slice(first.length)}`;
}

function percentEncodeFirst(value) {
  const first = String.fromCodePoint(value.codePointAt(0));
  return percentEncode(first) + value.slice(first.length);
}

function formEncode(value) {
  return value.replaceAll(' ', '+');
}

function encodingSequences(maxDepth = 4) {
  const encoders = [percentEncodeFirst, jsonEscapeFirst, htmlEncodeFirst, formEncode];
  const sequences = [[]];
  let frontier = [[]];
  for (let depth = 1; depth <= maxDepth; depth++) {
    frontier = frontier.flatMap((sequence) => encoders.map((encode) => [...sequence, encode]));
    sequences.push(...frontier);
  }
  return sequences;
}

function seededRedactionCorpus(terms = identityTerms, seed = 0x268079) {
  const malformed = ['', '%FF', '%00', '%C3'];
  const separators = [' | ', ' C++ ', ' 100% ', ' 50%off ', ' &amp; '];
  let state = seed >>> 0;
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state;
  };
  const corpus = encodingSequences().map((encoders, index) => {
    const term = encoders.includes(formEncode)
      ? terms.find((candidate) => candidate.includes(' ')) ?? terms[0]
      : terms[index % terms.length];
    const poison = malformed[Math.floor(index / 16) % malformed.length];
    const separator = separators[next() % separators.length];
    const representation = encoders.reduce((value, encode) => encode(value), term);
    return `sequence-${index}${separator}${poison}${representation}${poison}${separator}tail`;
  });
  for (let index = 0; index < 240; index++) {
    const separator = separators[next() % separators.length];
    const pieces = terms.map((term, termIndex) => {
      const poison = malformed[(index + termIndex) % malformed.length];
      return poison + encodeDepth(term, (index + termIndex) % 4) + poison;
    });
    corpus.push(`mixed-${index}${separator}${pieces.join(separator)}${separator}tail`);
  }
  const exactTerm = terms[0];
  const escapedPercent = percentEncode(exactTerm).replaceAll('%', `${slash}u0025`);
  corpus.push(
    `%FF${encodeDepth(exactTerm, 1)}%FF`,
    `%00${encodeDepth(exactTerm, 1)}`,
    [1, 2, 3].map((depth) => encodeDepth(exactTerm, depth)).join(' | '),
    terms.map((term, index) => encodeDepth(term, index % 4)).join(' | '),
    escapedPercent,
    escapedPercent.replaceAll(slash, '%5C'),
  );
  return corpus;
}

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

// Mirrors packages/db/src/migrate.ts: each file in one transaction, recorded in
// schema_migrations (021 enables RLS on that table, so it must exist). The
// runner itself cannot stop at 077, and this suite needs rows created before 078.
async function migration(file) {
  const sql = readFileSync(join(REPO, 'packages/db/src/migrations', file), 'utf8');
  await db.query('BEGIN');
  try {
    await db.query(sql);
    await db.query('INSERT INTO schema_migrations(version,checksum) VALUES($1,$2)', [file.replace(/\.sql$/, ''), 'integration']);
    await db.query('COMMIT');
  }
  catch (error) { await db.query('ROLLBACK'); throw new Error(`${file}: ${error.message}`, { cause: error }); }
}

async function seedConversation({ conversation, request, operation, seq = 0, cost = 0.001, suffix, user = member }) {
  await db.query(`INSERT INTO public.decke_conversation(id,user_id,title,turns)
    VALUES($1,$2,'private title',1)`, [conversation, user]);
  await db.query(`INSERT INTO public.decke_turn
    (conversation_id,user_id,seq,asked,answered,tools,build_sha,build_pr,finish_reason,exchange_id)
    VALUES($1,$2,$3,$4,$5,$6::jsonb,'fixture-sha',278,'stop',$7)`, [
    conversation, user, seq, `raw Jos\u00e9 question ${suffix}`,
    `raw John Smith answer jsmith@example.invalid ${suffix}`,
    JSON.stringify([{ name: 'search_cards', phase: 'ok', title: 'private', summary: suffix }]), id(700 + Number(suffix)),
  ]);
  await db.query(`INSERT INTO public.decke_ai_request
    (id,user_id,conversation_id,exchange_id,seq,request_key,payload_hash,charge_mode,status,finished_at,build_sha,build_pr)
    VALUES($1,$2,$3,$4,$5,$6,$7,'daily','completed',now(),'fixture-sha',278)`, [
    request, user, conversation, id(800 + Number(suffix)), seq, `improvement-${suffix}-request`, 'a'.repeat(64),
  ]);
  await db.query(`INSERT INTO public.decke_ai_operation
    (id,request_id,category,tool_key,model_id,provider,operation_key,status,finished_at,
     input_tokens,output_tokens,cache_read_tokens,cache_write_tokens,reasoning_tokens,cost_usd,cost_source)
    VALUES($1,$2,'response','chat_turn','fixture/model','fixture','chat_turn','completed',now(),123,27,44,62,13,$3,$4)`, [
    operation, request, cost, cost === null ? 'unknown' : 'provider_reported',
  ]);
}

const validLeg = (answer = 'redacted answer') => ({
  asked: 'redacted question', answered: answer, model_id: 'fixture/model', provider: 'fixture',
  started_at: '2026-09-28T18:00:00.000Z', finished_at: '2026-09-28T18:00:01.000Z', latency_ms: 1000,
  input_tokens: 123, output_tokens: 27, cache_read_tokens: 44, cache_write_tokens: 62, reasoning_tokens: 13,
  cost_usd: 0.00137, cost_coverage: 'complete', cost_source: 'provider_reported', status: 'completed', finish_reason: 'stop',
  build_sha: 'fixture-sha', build_pr: 278, error: { owner: 'John%20Smith' },
  tool_calls: [{ id: 'tool-1', name: 'search_cards', args: { person: 'John+Smith', email: 'jsmith%40example.invalid' }, output: {
    owner: 'Jose\u0301', requestedAt: '2026-09-28T18:00:00.250Z', requestId: id(121), generationId: 'generation-secret',
    inputTokens: 123, costUsd: 0.00137,
    encoded: `{"mail":"j${slash}u0073mith${slash}u0040example.invalid","owner":"J${slash}u006fhn${slash}u0020Smith","startedAt":"2026-09-28T18:00:00.250Z"}`,
  }, phase: 'completed' }],
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

  await db.query(`CREATE TABLE schema_migrations (
    version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
  const migrationFiles = readdirSync(join(REPO, 'packages/db/src/migrations'))
    .filter((file) => /^\d+.*\.sql$/.test(file) && Number(file.slice(0, 3)) <= 77)
    .sort();
  for (const file of migrationFiles) {
    if (file.startsWith('021_')) await db.query('DELETE FROM public.app_user WHERE id NOT IN (SELECT id FROM auth.users)');
    await migration(file);
    if (file.startsWith('021_')) {
      await db.query(`INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
        ($1,'owner@example.invalid','{"username":"owner-name"}'),
        ($2,'jsmith@example.invalid','{"username":"José"}'),
        ($3,'outsider@example.invalid','{"username":"outsider-name"}'),
        ($4,'alice+tag@example.invalid','{"username":"alice-user"}')`, [owner, member, outsider, plusMember]);
      await db.query(`UPDATE public.user_profile SET display_name=CASE user_id::text
        WHEN $1 THEN 'Owner Name' WHEN $2 THEN 'John Smith' WHEN $3 THEN 'Outsider Name' WHEN $4 THEN 'Alice Trainer' END
        WHERE user_id::text=ANY($5::text[])`, [owner, member, outsider, plusMember, [owner, member, outsider, plusMember]]);
    }
  }

  await test('pre-078 settings have no share-prompt column', async () => {
    const count = await db.query("SELECT count(*)::int n FROM information_schema.columns WHERE table_schema='public' AND table_name='user_settings' AND column_name='decke_share_prompts'");
    assert.equal(count.rows[0].n, 0);
  });

  const legacyRequest = id(90);
  await db.query("INSERT INTO public.decke_sharing(user_id,enabled,revision) VALUES($1,true,7)", [member]);
  await db.query(`INSERT INTO public.decke_ai_request
    (id,user_id,exchange_id,request_key,payload_hash,charge_mode)
    VALUES($1,$2,$3,'legacy-before-078',$4,'daily')`, [legacyRequest, member, id(91), '9'.repeat(64)]);
  await db.query("INSERT INTO public.decke_ai_content(request_id,asked,answered) VALUES($1,'legacy private question','legacy private answer')", [legacyRequest]);

  await migration('078_decke_improvement.sql');

  // Seed the exact representations that 078 failed to redact so 079 must
  // repair retained rows, not merely protect new writes.
  const retainedConversation = id(96), retainedRequest = id(97);
  const escapedPercentJohn = percentEncode('John Smith').replaceAll('%', `${slash}u0025`);
  const percentEscapedPercentJohn = escapedPercentJohn.replaceAll(slash, '%5C');
  await seedConversation({ conversation: retainedConversation, request: retainedRequest, operation: id(98), suffix: '96' });
  let retainedShared;
  await test('pre-079 corpus fixture contains encoded identities needing repair', async () => {
    const answer = await server(member, (c) => data(c,
      "SELECT public.decke_improvement_answer($1,$2,true,'reader') data", [member, retainedConversation]));
    retainedShared = answer.conversationId;
    await server(member, (c) => data(c,
      'SELECT public.decke_improvement_record_backfill($1,$2,$3::jsonb) data', [member, retainedConversation, JSON.stringify([
        { seq: 0, asked: 'JOS%C3%89', answered: '%4A%6F%68%6E%20%53%6D%69%74%68', tools: [{
          unsupported: '%5Cu0000', nul: '%00', invalidUtf8: '%FF', encodedSurrogate: '%ED%A0%80',
          highSurrogate: String.raw`\uD800`, lowSurrogate: String.raw`\uDC00`,
        }] },
      ])]));
    const retainedTools = [{
      unsupported: '%5Cu0000', nul: '%00', invalidUtf8: '%FF', encodedSurrogate: '%ED%A0%80',
      highSurrogate: String.raw`\uD800`, lowSurrogate: String.raw`\uDC00`,
      escapedPercent: escapedPercentJohn, percentEscapedPercent: percentEscapedPercentJohn,
    }];
    // These model values already held by 078, including the review-4 decoder
    // compositions that its writer could not recognise.
    await db.query('UPDATE public.decke_improvement_turn SET tools=$1::jsonb WHERE conversation_id=$2',
      [JSON.stringify(retainedTools), retainedShared]);
    const before = (await db.query('SELECT asked,answered,tools FROM public.decke_improvement_turn WHERE conversation_id=$1', [retainedShared])).rows[0];
    assert.equal(before.asked, 'JOS%C3%89');
    assert.equal(before.answered, '%4A%6F%68%6E%20%53%6D%69%74%68');
    assert.deepEqual(before.tools[0], {
      unsupported: '%5Cu0000', nul: '%00', invalidUtf8: '%FF', encodedSurrogate: '%ED%A0%80',
      highSurrogate: String.raw`\uD800`, lowSurrogate: String.raw`\uDC00`,
      escapedPercent: escapedPercentJohn, percentEscapedPercent: percentEscapedPercentJohn,
    });
  });

  const retainedUnicodeConversation = id(296), retainedUnicodeRequest = id(297);
  await db.query('UPDATE public.user_profile SET display_name=$1 WHERE user_id=$2', ['Иван', plusMember]);
  await seedConversation({
    conversation: retainedUnicodeConversation, request: retainedUnicodeRequest,
    operation: id(298), suffix: '296', user: plusMember,
  });
  let retainedUnicodeShared;
  await test('pre-079 corpus fixture contains case-varied Cyrillic beside malformed bytes', async () => {
    const answer = await server(plusMember, (c) => data(c,
      "SELECT public.decke_improvement_answer($1,$2,true,'reader') data", [plusMember, retainedUnicodeConversation]));
    retainedUnicodeShared = answer.conversationId;
    const encoded = `%FF${percentEncode('ИВАН')}%C3`;
    await server(plusMember, (c) => data(c,
      'SELECT public.decke_improvement_record_backfill($1,$2,$3::jsonb) data',
      [plusMember, retainedUnicodeConversation, JSON.stringify([{ seq: 0, asked: encoded, answered: '', tools: [] }])]));
    assert.equal((await db.query(
      'SELECT asked FROM public.decke_improvement_turn WHERE conversation_id=$1', [retainedUnicodeShared])).rows[0].asked, encoded);
  });

  const retainedFeedbackConversation = id(196), retainedFeedbackRequest = id(197);
  await seedConversation({
    conversation: retainedFeedbackConversation, request: retainedFeedbackRequest,
    operation: id(198), suffix: '196',
  });
  let retainedFeedbackShared;
  await test('pre-079 corpus fixture contains maximum-length encoded feedback', async () => {
    const answer = await server(member, (c) => data(c,
      "SELECT public.decke_improvement_answer($1,$2,true,'reader') data", [member, retainedFeedbackConversation]));
    retainedFeedbackShared = answer.conversationId;
    const comment = 'x'.repeat(491) + 'JOS%C3%89';
    assert.equal(comment.length, 500);
    const saved = await server(member, (c) => data(c,
      'SELECT public.decke_improvement_record_feedback($1,$2,0,1::smallint,$3,false) data',
      [member, retainedFeedbackConversation, comment]));
    assert.equal(saved.copied, true);
    // Model a row retained by an earlier live writer that did not recognise
    // this encoded spelling; 079 must repair it without violating the bound.
    await db.query('UPDATE public.decke_improvement_turn SET feedback_comment=$1 WHERE conversation_id=$2',
      [comment, retainedFeedbackShared]);
    const before = (await db.query(
      'SELECT feedback_comment FROM public.decke_improvement_turn WHERE conversation_id=$1',
      [retainedFeedbackShared])).rows[0].feedback_comment;
    assert.equal(before.length, 500);
    assert.match(before, /JOS%C3%89$/);
  });

  const orphanConversation = id(99), orphanRequest = id(199);
  await seedConversation({ conversation: orphanConversation, request: orphanRequest, operation: id(299), suffix: '99' });
  let orphanShared;
  await test('pre-079 History deletion fixture leaves an existing corpus orphan', async () => {
    const answer = await server(member, (c) => data(c,
      "SELECT public.decke_improvement_answer($1,$2,true,'reader') data", [member, orphanConversation]));
    orphanShared = answer.conversationId;
    await db.query('DELETE FROM public.decke_conversation WHERE id=$1', [orphanConversation]);
    assert.equal((await db.query('SELECT count(*)::int n FROM public.decke_improvement_conversation WHERE id=$1', [orphanShared])).rows[0].n, 1);
  });

  await migration('079_decke_improvement_fixes.sql');
  await db.query('SELECT public.admin_bootstrap($1,$2,$3)', [owner, [], []]);
  // Deck-E released, so ordinary accounts hold decke.use (as in production).
  await db.query("UPDATE public.app_feature SET lifecycle='released' WHERE key='decke'");
  await db.query("INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES($1,'new@example.invalid','{\"username\":\"new-name\"}')", [newcomer]);

  await test('079 repairs encoded identities already retained by the corpus', async () => {
    const repaired = (await db.query('SELECT asked,answered,tools FROM public.decke_improvement_turn WHERE conversation_id=$1', [retainedShared])).rows[0];
    assert.equal(repaired.asked, '[redacted]');
    assert.equal(repaired.answered, '[redacted]');
    assert.deepEqual(repaired.tools[0], {
      unsupported: '%5Cu0000', nul: '%00', invalidUtf8: '%FF', encodedSurrogate: '%ED%A0%80',
      highSurrogate: String.raw`\uD800`, lowSurrogate: String.raw`\uDC00`,
      escapedPercent: '[redacted]', percentEscapedPercent: '[redacted]',
    });
    // Keep the original suite's empty-corpus baseline after exercising the
    // migration repair path.
    await db.query('DELETE FROM public.decke_conversation WHERE id=$1', [retainedConversation]);
    await db.query('DELETE FROM public.decke_improvement_consent WHERE id=$1', [retainedShared]);
  });

  await test('079 repairs valid Cyrillic UTF-8 surrounded by malformed bytes', async () => {
    const repaired = (await db.query(
      'SELECT asked FROM public.decke_improvement_turn WHERE conversation_id=$1', [retainedUnicodeShared])).rows[0].asked;
    assert.equal(repaired, '[redacted]');
    await db.query('DELETE FROM public.decke_conversation WHERE id=$1', [retainedUnicodeConversation]);
    await db.query('DELETE FROM public.decke_improvement_consent WHERE id=$1', [retainedUnicodeShared]);
    await db.query('UPDATE public.user_profile SET display_name=$1 WHERE user_id=$2', ['Alice Trainer', plusMember]);
  });

  await test('079 bounds repaired maximum-length feedback after redaction', async () => {
    const repaired = (await db.query(
      'SELECT feedback_comment FROM public.decke_improvement_turn WHERE conversation_id=$1',
      [retainedFeedbackShared])).rows[0].feedback_comment;
    assert.ok(repaired.length <= 500);
    assert.doesNotMatch(repaired, /JOS%C3%89|José/i);
    await db.query('DELETE FROM public.decke_conversation WHERE id=$1', [retainedFeedbackConversation]);
    await db.query('DELETE FROM public.decke_improvement_consent WHERE id=$1', [retainedFeedbackShared]);
  });

  await test('079 removes existing History orphans and preserves revoked consent', async () => {
    assert.equal((await db.query('SELECT count(*)::int n FROM public.decke_improvement_conversation WHERE id=$1', [orphanShared])).rows[0].n, 0);
    assert.equal((await db.query('SELECT status FROM public.decke_improvement_consent WHERE id=$1', [orphanShared])).rows[0].status, 'revoked');
    await db.query('DELETE FROM public.decke_improvement_consent WHERE id=$1', [orphanShared]);
  });

  await test('identity helper returns only the calling subject terms', async () => {
    const identity = await session(member, async (c) => (await c.query(
      'SELECT public.decke_improvement_identity_terms($1) terms', [member])).rows[0].terms);
    assert.deepEqual(identity, { username: 'José', displayName: 'John Smith', email: 'jsmith@example.invalid' });
    await denied(session(member, (c) => c.query('SELECT public.decke_improvement_identity_terms($1)', [owner])));
    await denied(as(null, { role: 'anon' }, async (c) => {
      await c.query('RESET ROLE');
      await c.query('SET LOCAL ROLE anon');
      return c.query('SELECT public.decke_improvement_identity_terms($1)', [member]);
    }));
    const privileges = (await db.query(`SELECT
      has_function_privilege('authenticated','public.decke_improvement_identity_terms(text)','EXECUTE') authenticated,
      has_function_privilege('anon','public.decke_improvement_identity_terms(text)','EXECUTE') anon,
      EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
        WHERE p.oid='public.decke_improvement_identity_terms(text)'::regprocedure
          AND acl.grantee=0 AND acl.privilege_type='EXECUTE') public`)).rows[0];
    assert.deepEqual(privileges, { authenticated: true, anon: false, public: false });
    await denied(session(member, (c) => c.query('SELECT public.decke_improvement_purge_expired()')));
  });

  await test('SQL redaction decodes JSON Unicode escapes and protects short identity words', async () => {
    const encoded = `{"mail":"j${slash}u0073mith${slash}u0040example.invalid","owner":"J${slash}u006fhn${slash}u0020Smith"}`;
    const cleaned = (await db.query(
      "SELECT public.decke_improvement_redact_json_identifiers(to_jsonb($1::text),ARRAY['jsmith@example.invalid','John Smith'])#>>'{}' value",
      [encoded],
    )).rows[0].value;
    assert.deepEqual(JSON.parse(cleaned), { mail: '[redacted]', owner: '[redacted]' });
    const escapedText = (await db.query(
      "SELECT public.decke_improvement_redact_text($1,ARRAY['John Smith']) value",
      [`owner=J${slash}u006fhn${slash}u0020Smith`],
    )).rows[0].value;
    assert.equal(escapedText, 'owner=[redacted]');
    const short = (await db.query(
      "SELECT public.decke_improvement_redact_text($1,ARRAY['Li']) value",
      ["Li's list and lithium; LI wins"],
    )).rows[0].value;
    assert.equal(short, "[redacted]'s list and lithium; [redacted] wins");
    const literal = (await db.query(
      "SELECT public.decke_improvement_redact_text($1,ARRAY['alice+tag@example.invalid']) value",
      ['C++ is 100% useful; alice+tag@example.invalid and alice%2Btag%40example.invalid'],
    )).rows[0].value;
    assert.equal(literal, 'C++ is 100% useful; [redacted] and [redacted]');
    const mixed = (await db.query(
      "SELECT public.decke_improvement_redact_text($1,ARRAY['John Smith','José']) value",
      ['John Smith + JOS%25C3%2589 keeps C++'],
    )).rows[0].value;
    assert.equal(mixed, '[redacted]');
    const unicodeSpellings = ['É', '\u0800', '李', '\uD7E3', '\uE000', '😀', '\u{40000}', '\u{100000}', 'ИВАН', 'דוד', 'محمد'];
    const unicodeRows = (await db.query(`SELECT ordinality::int index,
      public.decke_improvement_redact_text('%FF'||value||'%00%C3',$2::text[]) value
      FROM unnest($1::text[]) WITH ORDINALITY input(value,ordinality) ORDER BY ordinality`,
    [unicodeSpellings.map(percentEncode), utf8ClassTerms])).rows;
    unicodeRows.forEach((row, index) =>
      assertIdentitySafe(row.value, `SQL UTF-8 class ${row.index}`, [utf8ClassTerms[index]]));
  });

  await test('near-limit nested percent input redacts within a two-second statement timeout', async () => {
    const unit = 'x%2520';
    const prefix = unit.repeat(Math.floor((1024 * 1024) / unit.length));
    assert.ok(Buffer.byteLength(prefix) >= (1024 * 1024) - unit.length);
    const encoded = prefix + 'JOS%25C3%2589';
    await db.query('BEGIN');
    try {
      await db.query("SET LOCAL statement_timeout='2s'");
      const result = (await db.query(
        "SELECT public.decke_improvement_redact_text($1,ARRAY['José']) value", [encoded],
      )).rows[0].value;
      assert.equal(result, '[redacted]');
      const repeated = (await db.query(
        "SELECT public.decke_improvement_redact_text(repeat('John Smith ',10000),ARRAY['John Smith']) value",
      )).rows[0].value;
      assert.equal(repeated, '[redacted] '.repeat(10000));
      await db.query('COMMIT');
    } catch (error) {
      await db.query('ROLLBACK').catch(() => {});
      throw error;
    }
  });

  await test('Jev reflex and audit create uncharged operations on the current chat request', async () => {
    const beforeSpends = (await db.query('SELECT count(*)::int n FROM public.credit_spend')).rows[0].n;
    await db.query('SELECT public.decke_usage_external_operation_begin($1,$2,$3,$4,$5,$6,NULL)', [
      id(94), legacyRequest, 'jev_reflex', 'typesafe-ai/jev', 'typesafe-ai', 'reflex',
    ]);
    await db.query('SELECT public.decke_usage_external_operation_begin($1,$2,$3,$4,$5,$6,NULL)', [
      id(95), legacyRequest, 'jev_audit', 'typesafe-ai/jev', 'typesafe-ai', 'audit',
    ]);
    const operations = (await db.query(
      'SELECT request_id,tool_key,credit_spend_id FROM public.decke_ai_operation WHERE id=ANY($1::uuid[]) ORDER BY tool_key DESC',
      [[id(94), id(95)]],
    )).rows;
    assert.deepEqual(operations.map((operation) => operation.tool_key), ['jev_reflex', 'jev_audit']);
    assert.ok(operations.every((operation) => operation.request_id === legacyRequest && operation.credit_spend_id === null));
    assert.equal((await db.query('SELECT count(*)::int n FROM public.credit_spend')).rows[0].n, beforeSpends);
  });

  await test('share prompts default on while collection defaults empty', async () => {
    const rows = (await db.query('SELECT decke_share_prompts FROM public.user_settings ORDER BY user_id')).rows;
    assert.equal(rows.length, 5);
    assert.ok(rows.every((row) => row.decke_share_prompts === true));
    assert.equal((await db.query('SELECT count(*)::int n FROM public.decke_improvement_consent')).rows[0].n, 0);
    assert.equal((await db.query('SELECT count(*)::int n FROM public.decke_improvement_conversation')).rows[0].n, 0);
  });

  await test('legacy account-wide sharing is disabled and unshared chats remain metadata-only', async () => {
    const legacy = (await db.query('SELECT enabled FROM public.decke_sharing WHERE user_id=$1', [member])).rows[0];
    assert.equal(legacy.enabled, false);
    assert.equal((await db.query('SELECT count(*)::int n FROM public.decke_ai_content')).rows[0].n, 0);
    const unsharedConversation = id(92);
    const begun = (await db.query(
      'SELECT public.decke_usage_begin($1,$2,$3,0,$4,$5,NULL,NULL,0,0,\'daily\',$6) data',
      [member, unsharedConversation, id(93), 'metadata-only-request', '8'.repeat(64), 'PRIVATE UNCONSENTED QUESTION'],
    )).rows[0].data;
    await db.query('SELECT public.decke_usage_content_append($1,$2)', [begun.id, 'PRIVATE UNCONSENTED ANSWER']);
    assert.equal(begun.consentEpoch, null);
    assert.equal((await db.query('SELECT count(*)::int n FROM public.decke_ai_content')).rows[0].n, 0);
    const usage = await session(owner, (c) => data(c, 'SELECT public.decke_usage_detail($1) data', [begun.id]));
    assert.equal(usage.contentStatus, 'retired');
    assert.equal(usage.content, null);
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
      'SELECT public.decke_improvement_record_feedback($1,$2,0,(-1)::smallint,$3,false) data',
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
  await db.query(`INSERT INTO public.decke_ai_operation
    (id,request_id,category,tool_key,model_id,provider,operation_key,status,finished_at,cost_source)
    VALUES($1,$2,'response','jev_reflex','typesafe-ai/jev','typesafe-ai','unpriced-classifier','completed',now(),'unknown')`, [id(125), sharedRequest]);

  let derivedShared;
  await test('answer share backfills accounting only and returns raw content for API redaction', async () => {
    const answer = await server(member, (c) => data(c,
      "SELECT public.decke_improvement_answer($1,$2,true,'reader') data", [member, sharedConversation]));
    assert.equal(answer.status, 'shared');
    assert.equal(answer.backfill.turns[0].asked, 'raw Jos\u00e9 question 120');
    assert.equal(answer.backfill.requests.length, 2);
    derivedShared = answer.conversationId;
    for (const raw of [member, sharedConversation, sharedRequest, unknownRequest]) assert.notEqual(derivedShared, raw);
    const beforeContent = (await db.query('SELECT asked,answered,cost_usd,cost_coverage FROM public.decke_improvement_turn WHERE conversation_id=$1', [derivedShared])).rows[0];
    assert.equal(beforeContent.asked, '');
    assert.equal(beforeContent.answered, '');
    assert.equal(Number(beforeContent.cost_usd), 0.001);
    assert.equal(beforeContent.cost_coverage, 'partial');
    const legs = (await db.query('SELECT leg,cost_usd,cost_coverage FROM public.decke_improvement_leg WHERE conversation_id=$1 ORDER BY leg', [derivedShared])).rows;
    assert.deepEqual(legs.map((leg) => leg.cost_coverage), ['partial', 'unknown']);
    assert.equal(Number(legs[0].cost_usd), 0.001);
    assert.equal(legs[1].cost_usd, null);
    const backfill = await server(member, (c) => data(c,
      'SELECT public.decke_improvement_record_backfill($1,$2,$3::jsonb) data', [member, sharedConversation, JSON.stringify([
        { seq: 0, asked: 'JOS%C3%89 and %4A%6F%68%6E%20%53%6D%69%74%68 asked', answered: 'John+Smith answered', tools: [{ name: 'search_cards', phase: 'ok', args: { email: 'jsmith%40example.invalid', owner: 'Jose\u0301' } }] },
      ])]));
    assert.equal(backfill.recorded, true);
    const stored = (await db.query('SELECT asked,answered,tools FROM public.decke_improvement_turn WHERE conversation_id=$1', [derivedShared])).rows[0];
    assert.equal(stored.asked, '[redacted]');
    assert.doesNotMatch(JSON.stringify(stored), /John(?:%20|\+| )Smith|%4A%6F%68%6E|jsmith(?:%40|&#64;|@)example\.invalid|JOS%C3%89|Jose\u0301|José/i);
  });

  await test('subject-scoped metadata helpers work only for the production request subject', async () => {
    assert.equal(await server(member, (c) => data(c,
      'SELECT public.decke_improvement_is_shared($1,$2) data', [member, sharedConversation])), true);
    const telemetry = await server(member, (c) => data(c,
      'SELECT public.decke_improvement_request_telemetry($1,$2) data', [member, sharedRequest]));
    assert.equal(telemetry.leg_no, 0);
    assert.equal(telemetry.model_id, 'mixed');
    assert.equal(telemetry.provider, 'mixed');
    assert.equal(telemetry.input_tokens, 123);
    assert.equal(telemetry.output_tokens, 27);
    assert.equal(Number(telemetry.cost_usd), 0.001);
    assert.equal(telemetry.cost_coverage, 'partial');
    assert.equal(telemetry.cost_source, 'provider_reported');
    assert.match(telemetry.started_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    await denied(server(member, (c) => c.query(
      'SELECT public.decke_improvement_request_telemetry($1,$2)', [owner, sharedRequest])));
    await denied(server(outsider, (c) => c.query(
      'SELECT public.decke_improvement_request_telemetry($1,$2)', [outsider, sharedRequest])));
    await denied(server(outsider, (c) => c.query(
      'SELECT public.decke_improvement_is_shared($1,$2)', [outsider, sharedConversation])));
    await denied(session(member, (c) => c.query(
      'SELECT public.decke_improvement_request_telemetry($1,$2)', [member, sharedRequest])));
    await denied(session(member, (c) => c.query(
      'SELECT public.decke_improvement_is_shared($1,$2)', [member, sharedConversation])));
    await denied(as(null, { role: 'anon' }, async (c) => {
      await c.query('RESET ROLE');
      await c.query('SET LOCAL ROLE anon');
      return c.query('SELECT public.decke_improvement_is_shared($1,$2)', [member, sharedConversation]);
    }));
    const privileges = (await db.query(`SELECT
      has_function_privilege('authenticated','public.decke_improvement_is_shared(text,uuid)','EXECUTE') shared_authenticated,
      has_function_privilege('anon','public.decke_improvement_is_shared(text,uuid)','EXECUTE') shared_anon,
      has_function_privilege('authenticated','public.decke_improvement_request_telemetry(text,uuid)','EXECUTE') telemetry_authenticated,
      has_function_privilege('anon','public.decke_improvement_request_telemetry(text,uuid)','EXECUTE') telemetry_anon,
      EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
        WHERE p.oid IN ('public.decke_improvement_is_shared(text,uuid)'::regprocedure,
                        'public.decke_improvement_request_telemetry(text,uuid)'::regprocedure)
          AND acl.grantee=0 AND acl.privilege_type='EXECUTE') public`)).rows[0];
    assert.deepEqual(privileges, {
      shared_authenticated: true, shared_anon: false,
      telemetry_authenticated: true, telemetry_anon: false, public: false,
    });
  });

  await test('real TypeScript backfill records non-empty request legs under authenticated', async () => {
    const answer = await server(member, (c) => data(c,
      "SELECT public.decke_improvement_answer($1,$2,true,'reader') data", [member, sharedConversation]));
    assert.ok(answer.backfill.requests.length > 0);
    const recorded = await server(member, (c) => backfillShared({
      query: (...args) => c.query(...args),
      release() {},
    }, { userId: member, conversationId: sharedConversation, backfill: answer.backfill }));
    assert.equal(recorded, true);
    assert.ok((await db.query(
      'SELECT count(*)::int n FROM public.decke_improvement_leg WHERE conversation_id=$1', [derivedShared])).rows[0].n > 0);
  });

  const plusConversation = id(180), plusRequest = id(181);
  await seedConversation({ conversation: plusConversation, request: plusRequest, operation: id(182), suffix: '180', user: plusMember });
  await test('plus-addressed email is redacted through writers and admin reader without changing prose', async () => {
    const answer = await server(plusMember, (c) => data(c,
      "SELECT public.decke_improvement_answer($1,$2,true,'reader') data", [plusMember, plusConversation]));
    const backfilled = await server(plusMember, (c) => backfillShared({
      query: (...args) => c.query(...args), release() {},
    }, { userId: plusMember, conversationId: plusConversation, backfill: { turns: [{
      seq: 0,
      asked: 'C++ is 100%; alice+tag@example.invalid',
      answered: 'alice%2Btag%40example.invalid keeps C++ at 100%',
      tools: [{ name: 'search_cards', phase: 'ok', args: { email: 'alice+tag@example.invalid' } }],
    }], requests: [] } }));
    assert.equal(backfilled, true);
    const leg = await server(plusMember, (c) => recordLeg({
      query: (...args) => c.query(...args), release() {},
    }, { userId: plusMember, conversationId: plusConversation, seq: 0, requestId: plusRequest, leg: 0,
      payload: { ...validLeg('alice%2Btag%40example.invalid and 100%'), asked: 'C++ by alice+tag@example.invalid' } }));
    assert.equal(leg, true);
    await server(plusMember, (c) => data(c,
      'SELECT public.decke_improvement_record_events($1,$2,0,0,$3::jsonb) data', [plusMember, plusConversation,
        JSON.stringify([{ kind: 'notice', at: '2026-09-28T18:00:00Z', payload: { prose: 'C++ 100%', email: 'alice%2Btag%40example.invalid' } }])]));
    const detail = await session(owner, (c) => data(c,
      'SELECT public.decke_improvement_detail($1) data', [answer.conversationId]));
    const rendered = JSON.stringify(detail);
    assert.doesNotMatch(rendered, /alice(?:\+|%2B| )tag(?:@|%40)example\.invalid/i);
    assert.match(rendered, /C\+\+/);
    assert.match(rendered, /100%/);
    await db.query('DELETE FROM public.decke_conversation WHERE id=$1', [plusConversation]);
  });

  const propertyConversation = id(190), propertyRequest = id(191);
  await seedConversation({ conversation: propertyConversation, request: propertyRequest, operation: id(192), suffix: '190' });
  await test('seeded redaction corpus is safe through API and SQL writers plus admin detail', async () => {
    const memberTerms = ['John Smith', 'José', 'jsmith@example.invalid'];
    const corpus = seededRedactionCorpus(memberTerms);
    assert.ok(corpus.length >= 200);
    assert.ok(corpus.includes('%FF%4A%6F%68%6E%20%53%6D%69%74%68%FF'));
    assert.ok(corpus.includes('%00%4A%6F%68%6E%20%53%6D%69%74%68'));
    assert.ok(corpus.includes([1, 2, 3].map((depth) => encodeDepth('John Smith', depth)).join(' | ')));
    assert.ok(corpus.includes(escapedPercentJohn));
    assert.ok(corpus.includes(percentEscapedPercentJohn));
    const safe = [
      'C++ is 100% useful', '50%off is prose', '%FF and %00 without a name',
      'Fish &amp; chips', String.raw`literal \u0041 and %2520`,
    ];
    const keyed = Object.fromEntries(corpus.slice(-4).map((value, index) => [value, index]));
    keyed['C++ key'] = 'unchanged';
    const answer = await server(member, (c) => data(c,
      "SELECT public.decke_improvement_answer($1,$2,true,'reader') data", [member, propertyConversation]));

    const backfilled = await server(member, (c) => backfillShared({
      query: (...args) => c.query(...args), release() {},
    }, { userId: member, conversationId: propertyConversation, backfill: { turns: [{
      seq: 0, asked: safe[0], answered: safe[1], tools: [{ corpus, safe, keyed }],
    }], requests: [] } }));
    assert.equal(backfilled, true);
    const rawEvent = [{
      kind: 'notice', at: '2026-09-28T18:00:00Z', payload: { corpus, safe, keyed },
    }];
    const event = await server(member, (c) => data(c,
      'SELECT public.decke_improvement_record_events($1,$2,0,79,$3::jsonb) data',
      [member, propertyConversation, JSON.stringify(rawEvent)]));
    assert.equal(event.recorded, true);

    const unicodeSpellings = ['É', 'ИВАН', 'דוד', 'محمد', '李', '😀'];
    for (let index = 0; index < unicodeTerms.length; index++) {
      await db.query('UPDATE public.user_profile SET display_name=$1 WHERE user_id=$2', [unicodeTerms[index], member]);
      const value = `%FF${percentEncode(unicodeSpellings[index])}%00%C3`;
      const recorded = await server(member, (c) => data(c,
        'SELECT public.decke_improvement_record_events($1,$2,0,$3,$4::jsonb) data',
        [member, propertyConversation, 80 + index, JSON.stringify([{
          kind: 'notice', at: '2026-09-28T18:00:00Z', payload: { value },
        }])]));
      assert.equal(recorded.recorded, true);
    }
    await db.query('UPDATE public.user_profile SET display_name=$1 WHERE user_id=$2', ['John Smith', member]);

    const detail = await session(owner, (c) => data(c,
      'SELECT public.decke_improvement_detail($1) data', [answer.conversationId]));
    const apiPayload = detail.turns[0].tools[0];
    const sqlPayload = detail.turns[0].events.find((item) => item.batch === 79).payload;
    assert.equal(apiPayload.corpus.length, corpus.length);
    assert.equal(sqlPayload.corpus.length, corpus.length);
    apiPayload.corpus.forEach((value, index) => assertIdentitySafe(value, `API corpus ${index}`, memberTerms));
    sqlPayload.corpus.forEach((value, index) => assertIdentitySafe(value, `SQL corpus ${index}`, memberTerms));
    Object.keys(apiPayload.keyed).forEach((value, index) => assertIdentitySafe(value, `API key ${index}`, memberTerms));
    Object.keys(sqlPayload.keyed).forEach((value, index) => assertIdentitySafe(value, `SQL key ${index}`, memberTerms));
    assert.deepEqual(apiPayload.safe, safe);
    assert.deepEqual(sqlPayload.safe, safe);
    assert.equal(apiPayload.keyed['C++ key'], 'unchanged');
    assert.equal(sqlPayload.keyed['C++ key'], 'unchanged');
    for (let index = 0; index < unicodeTerms.length; index++) {
      const payload = detail.turns[0].events.find((item) => item.batch === 80 + index).payload;
      assertIdentitySafe(payload.value, `SQL Unicode writer ${index}`, [unicodeTerms[index]]);
    }

    // The SQL primitive also receives the complete cross-account term set so
    // this property covers every identity spelling in one deterministic run.
    const complete = seededRedactionCorpus(identityTerms);
    const sqlRows = (await db.query(`SELECT ordinality::int index,
      public.decke_improvement_redact_text(value,$2::text[]) value
      FROM unnest($1::text[]) WITH ORDINALITY input(value,ordinality) ORDER BY ordinality`,
    [complete, identityTerms])).rows;
    assert.equal(sqlRows.length, complete.length);
    sqlRows.forEach((row) => assertIdentitySafe(row.value, `SQL primitive ${row.index}`));
    const unchanged = (await db.query(`SELECT array_agg(public.decke_improvement_redact_text(value,$2::text[]) ORDER BY ordinality) values
      FROM unnest($1::text[]) WITH ORDINALITY input(value,ordinality)`, [safe, identityTerms])).rows[0].values;
    assert.deepEqual(unchanged, safe);
    await db.query('DELETE FROM public.decke_conversation WHERE id=$1', [propertyConversation]);
  });

  await test('shared writers capture full legs/events and preserve pseudonymous IDs', async () => {
    const recorded = await server(member, (c) => data(c,
      'SELECT public.decke_improvement_record_leg($1,$2,0,$3,0,$4::jsonb) data',
      [member, sharedConversation, sharedRequest, JSON.stringify(validLeg())]));
    assert.equal(recorded.recorded, true);
    assert.notEqual(recorded.legId, sharedRequest);
    const events = [{ kind: 'error', at: '2026-09-28T18:00:00.500Z', payload: { message: 'John%20Smith at jsmith&#64;example.invalid', requestId: sharedRequest } }];
    const first = await server(member, (c) => data(c,
      'SELECT public.decke_improvement_record_events($1,$2,0,7,$3::jsonb) data', [member, sharedConversation, JSON.stringify(events)]));
    const replay = await server(member, (c) => data(c,
      'SELECT public.decke_improvement_record_events($1,$2,0,7,$3::jsonb) data', [member, sharedConversation, JSON.stringify(events)]));
    assert.equal(first.duplicate, false);
    assert.equal(replay.duplicate, true);
  });

  await test('recorded partial leg coverage survives turn and conversation rollups', async () => {
    const partial = { ...validLeg('partially priced answer'), cost_coverage: 'partial' };
    await server(member, (c) => data(c,
      'SELECT public.decke_improvement_record_leg($1,$2,0,$3,0,$4::jsonb) data',
      [member, sharedConversation, sharedRequest, JSON.stringify(partial)]));
    const leg = (await db.query('SELECT cost_usd,cost_coverage FROM public.decke_improvement_leg WHERE conversation_id=$1 AND leg=0', [derivedShared])).rows[0];
    const turn = (await db.query('SELECT cost_usd,cost_coverage FROM public.decke_improvement_turn WHERE conversation_id=$1 AND seq=0', [derivedShared])).rows[0];
    const conversation = (await db.query('SELECT cost_usd,cost_coverage FROM public.decke_improvement_conversation WHERE id=$1', [derivedShared])).rows[0];
    assert.equal(leg.cost_coverage, 'partial');
    assert.equal(turn.cost_coverage, 'partial');
    assert.equal(conversation.cost_coverage, 'partial');
    assert.equal(Number(turn.cost_usd), 0.00137);
    assert.equal(Number(conversation.cost_usd), 0.00137);
  });

  const feedbackConversation = id(130), feedbackRequest = id(131);
  await seedConversation({ conversation: feedbackConversation, request: feedbackRequest, operation: id(132), suffix: '130' });
  await test('feedback can grant sharing, always saves personal feedback, and list_mine maps raw IDs', async () => {
    const saved = await server(member, (c) => data(c,
      'SELECT public.decke_improvement_record_feedback($1,$2,0,1::smallint,$3,true) data',
      [member, feedbackConversation, 'John+Smith liked this; jsmith%40example.invalid']));
    assert.equal(saved.saved, true);
    assert.equal(saved.shared, true);
    assert.equal(saved.copied, true);
    // The bucket-isolation regression below needs two chats in the same public
    // UTC day. Record both through the fixed-time leg fixture so the test does
    // not depend on which calendar day the PostgreSQL runner happens to start.
    const recorded = await server(member, (c) => data(c,
      'SELECT public.decke_improvement_record_leg($1,$2,0,$3,0,$4::jsonb) data',
      [member, feedbackConversation, feedbackRequest, JSON.stringify(validLeg('feedback answer'))]));
    assert.equal(recorded.recorded, true);
    const ownCount = await session(member, async (c) => (await c.query('SELECT count(*)::int n FROM public.decke_turn_feedback')).rows[0].n);
    const otherCount = await session(outsider, async (c) => (await c.query('SELECT count(*)::int n FROM public.decke_turn_feedback')).rows[0].n);
    assert.equal(ownCount, 2);
    assert.equal(otherCount, 0);
    const mine = await server(member, (c) => data(c, 'SELECT public.decke_improvement_list_mine($1) data', [member]));
    assert.deepEqual(new Set(mine.items.map((item) => item.conversationId)), new Set([sharedConversation, feedbackConversation]));
    assert.equal(mine.items.some((item) => item.conversationId === derivedShared), false);
  });

  let tokenId;
  await test('only eligible admins can grant token and OAuth improvement capabilities', async () => {
    const memberToken = (await db.query(
      "INSERT INTO public.api_token(user_id,name,token_hash,prefix) VALUES($1,'member fixture',$2,'dsk_member00') RETURNING id",
      [member, 'e'.repeat(64)])).rows[0].id;
    await denied(session(member, (c) => data(c, 'SELECT public.decke_improvement_token_capability($1,true) data', [memberToken])));
    await db.query("INSERT INTO public.oauth_client(client_id,client_name,redirect_uris) VALUES('fixture-client','Fixture',ARRAY['https://example.invalid/callback'])");
    await db.query(`INSERT INTO public.oauth_code
      (code,client_id,user_id,redirect_uri,code_challenge,code_challenge_method,expires_at)
      VALUES('fixture-code','fixture-client',$1,'https://example.invalid/callback','challenge','S256',now()+interval '5 minutes')`, [member]);
    await denied(session(member, (c) => data(c, "SELECT public.decke_improvement_oauth_capability('fixture-code',true) data")));
    const memberCredentials = await db.query(
      "SELECT (SELECT decke_improvement_read FROM public.api_token WHERE id=$1) token_capability, (SELECT decke_improvement_read FROM public.oauth_code WHERE code='fixture-code') oauth_capability",
      [memberToken]);
    assert.deepEqual(memberCredentials.rows[0], { token_capability: false, oauth_capability: false });
  });

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
    assert.match(list.items[0].date, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal('startedAt' in list.items[0], false);
    assert.equal('updatedAt' in list.items[0], false);
    const detail = await token(owner, tokenId, (c) => data(c, 'SELECT public.decke_improvement_detail($1) data', [derivedShared]));
    assert.equal(detail.turns[0].tools[0].name, 'search_cards');
    assert.equal(JSON.stringify(detail).includes('owner_key'), false);
    const accountingRequest = (await db.query('SELECT started_at,finished_at FROM public.decke_ai_request WHERE id=$1', [sharedRequest])).rows[0];
    const accountingOperation = (await db.query('SELECT input_tokens,output_tokens,cost_usd FROM public.decke_ai_operation WHERE request_id=$1 ORDER BY started_at LIMIT 1', [sharedRequest])).rows[0];
    const rendered = JSON.stringify(detail);
    assert.doesNotMatch(rendered, /John(?:%20|\+| )Smith|%4A%6F%68%6E|jsmith(?:%40|&#64;|@)example\.invalid|JOS%C3%89|Jose\u0301|José/i);
    assert.equal(rendered.includes(new Date(accountingRequest.started_at).toISOString()), false);
    if (accountingRequest.finished_at) assert.equal(rendered.includes(new Date(accountingRequest.finished_at).toISOString()), false);
    assert.equal(detail.turns[0].offsetSeconds % 10, 0);
    for (const removed of ['updatedOffsetMs', 'startedOffsetMs', 'finishedOffsetMs', 'offsetMs', 'durationMs']) {
      assert.equal(rendered.includes(`"${removed}"`), false, `${removed} must not reach an improvement reader`);
    }
    assert.equal(detail.conversation.costUsd, 0);
    assert.notEqual(detail.conversation.costUsd, Number(accountingOperation.cost_usd));
    assert.equal(detail.turns[0].legs[0].tokens.input, 100);
    assert.notEqual(detail.turns[0].legs[0].tokens.input, Number(accountingOperation.input_tokens));
    assert.notEqual(detail.turns[0].legs[0].tokens.output, Number(accountingOperation.output_tokens));
    assert.equal(rendered.includes('generation-secret'), false);
    assert.equal(rendered.includes(sharedRequest), false);
    const toolOutput = detail.turns[0].legs[0].toolCalls[0].output;
    assert.equal('requestId' in toolOutput, false);
    assert.equal(toolOutput.inputTokens, 100);
    assert.equal(toolOutput.costUsd, 0);
    assert.equal(String(toolOutput.encoded).includes('generation-secret'), false);
    assert.equal(String(toolOutput.encoded).includes('2026-09-28T18:00:00.250Z'), false);
    assert.doesNotMatch(String(toolOutput.encoded), /John Smith|jsmith@example\.invalid/i);
    assert.match(String(toolOutput.encoded), /\[redacted\]/);
    const search = await token(owner, tokenId, (c) => data(c, "SELECT public.decke_improvement_search('search_cards',20) data"));
    assert.ok(search.items.length > 0);
    assert.match(search.items[0].date, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal('updatedAt' in search.items[0], false);

    const centBucket = await token(owner, tokenId, (c) => data(c,
      'SELECT public.decke_improvement_list($1::jsonb,NULL,20) data', [JSON.stringify({ min_cost: 0, max_cost: 0 })]));
    assert.ok(centBucket.items.length > 1);
    assert.ok(centBucket.items.some((item) => item.id === derivedShared));
    const day = list.items.find((item) => item.id === derivedShared).date;
    const nextDay = new Date(Date.parse(day + 'T00:00:00Z') + 86_400_000).toISOString().slice(0, 10);
    const dayBucket = await token(owner, tokenId, (c) => data(c,
      'SELECT public.decke_improvement_list($1::jsonb,NULL,20) data', [JSON.stringify({ from: day, to: nextDay })]));
    assert.ok(dayBucket.items.length > 1);
    assert.ok(dayBucket.items.some((item) => item.id === derivedShared));
    assert.equal(typeof improvementRoute.listFilters, 'function');
    const routeFilters = improvementRoute.listFilters({ min_cost: '0.01', max_cost: '2.00' });
    assert.deepEqual(routeFilters, { min_cost: 0.01, max_cost: 2 });
    const routeBucket = await token(owner, tokenId, (c) => data(c,
      'SELECT public.decke_improvement_list($1::jsonb,NULL,20) data', [JSON.stringify(routeFilters)]));
    assert.ok(Array.isArray(routeBucket.items));
    const stringCostBucket = await token(owner, tokenId, (c) => data(c,
      'SELECT public.decke_improvement_list($1::jsonb,NULL,20) data', [JSON.stringify({ min_cost: '0.01', max_cost: '2.00' })]));
    assert.ok(Array.isArray(stringCostBucket.items));
    await assert.rejects(token(owner, tokenId, (c) => data(c,
      'SELECT public.decke_improvement_list($1::jsonb,NULL,20) data', [JSON.stringify({ min_cost: 0.00137, max_cost: 0.00137 })])),
    (error) => error.code === '22023');
    await assert.rejects(token(owner, tokenId, (c) => data(c,
      'SELECT public.decke_improvement_list($1::jsonb,NULL,20) data', [JSON.stringify({ from: new Date(accountingRequest.started_at).toISOString() })])),
    (error) => error.code === '22023');
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

  await test('History deletion revokes and removes corpus while revoke stays idempotent', async () => {
    const feedbackShared = (await db.query(
      "SELECT public.decke_improvement_uuid('conversation:',$1) id", [feedbackConversation])).rows[0].id;
    await session(member, (c) => c.query('DELETE FROM public.decke_conversation WHERE id=$1 AND user_id=auth.uid()', [feedbackConversation]));
    assert.equal((await db.query('SELECT count(*)::int n FROM public.decke_improvement_conversation WHERE id=$1', [feedbackShared])).rows[0].n, 0);
    assert.equal((await db.query('SELECT status FROM public.decke_improvement_consent WHERE id=$1', [feedbackShared])).rows[0].status, 'revoked');
    const revoked = await server(member, (c) => data(c,
      'SELECT public.decke_improvement_revoke($1,$2) data', [member, feedbackConversation]));
    assert.equal(revoked.revoked, true);
    assert.deepEqual(revoked.deleted, { conversations: 0, turns: 0, legs: 0, events: 0 });
    await db.query('INSERT INTO public.decke_conversation(id,user_id,title,turns) VALUES($1,$2,\'recreated fixture\',0)', [feedbackConversation, member]);
    const ask = await server(member, (c) => data(c,
      'SELECT public.decke_improvement_can_ask($1,$2) data', [member, feedbackConversation]));
    assert.deepEqual(ask, { allowed: false, reason: 'already_revoked' });
    await db.query('DELETE FROM public.decke_conversation WHERE id=$1', [feedbackConversation]);
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
    assert.deepEqual(mine.items, []);
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

  await test('180-day purge drains more than one 500-row batch and returns the total', async () => {
    const ownerKey = (await db.query('SELECT public.decke_improvement_owner_key($1) owner', [member])).rows[0].owner;
    await db.query(`INSERT INTO public.decke_improvement_conversation
      (id,owner_key,started_at,updated_at,cost_coverage)
      SELECT extensions.gen_random_uuid(),$1,now()-interval '182 days',now()-interval '181 days','unknown'
      FROM generate_series(1,501)`, [ownerKey]);
    assert.equal((await db.query('SELECT public.decke_improvement_purge_expired() n')).rows[0].n, 501);
    assert.equal((await db.query("SELECT count(*)::int n FROM public.decke_improvement_conversation WHERE updated_at<now()-interval '180 days'")).rows[0].n, 0);
  });

  await test('account deletion removes improvement rows even when settings were deleted first', async () => {
    const directConversation = id(150), directRequest = id(151);
    const settingsFirstConversation = id(160), settingsFirstRequest = id(161);
    await seedConversation({ conversation: directConversation, request: directRequest, operation: id(152), suffix: '150', user: outsider });
    await seedConversation({ conversation: settingsFirstConversation, request: settingsFirstRequest, operation: id(162), suffix: '160', user: newcomer });
    await server(outsider, (c) => data(c, "SELECT public.decke_improvement_answer($1,$2,true,'reader') data", [outsider, directConversation]));
    await server(newcomer, (c) => data(c, "SELECT public.decke_improvement_answer($1,$2,true,'reader') data", [newcomer, settingsFirstConversation]));
    const outsiderKey = (await db.query('SELECT public.decke_improvement_owner_key($1) owner', [outsider])).rows[0].owner;
    const newcomerKey = (await db.query('SELECT public.decke_improvement_owner_key($1) owner', [newcomer])).rows[0].owner;
    await session(newcomer, (c) => c.query('DELETE FROM public.user_settings WHERE user_id=auth.uid()'));
    await db.query('DELETE FROM public.app_user WHERE id=$1', [newcomer]);
    await db.query('DELETE FROM public.app_user WHERE id=$1', [outsider]);
    for (const ownerKey of [outsiderKey, newcomerKey]) {
      assert.equal((await db.query('SELECT count(*)::int n FROM public.decke_improvement_conversation WHERE owner_key=$1', [ownerKey])).rows[0].n, 0);
      assert.equal((await db.query('SELECT count(*)::int n FROM public.decke_improvement_consent WHERE owner_key=$1', [ownerKey])).rows[0].n, 0);
    }
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
