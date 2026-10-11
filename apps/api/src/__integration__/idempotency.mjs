/**
 * Every approved Deck-E write happens at most once per signed tool call, proved
 * against real PostgreSQL 16 with every shipped migration applied. Invoked only
 * by scripts/test-db-integration.mjs.
 *
 * What a fake cannot prove, and this does: the key really lives on
 * `mutation_batch` under its unique index, it commits with the write and only
 * with it, a concurrent duplicate blocks and then replays, and a request with no
 * key still runs exactly the code it always ran. The headline case drives a held
 * `add_battle_log` through the real AI SDK, approves it, and resumes the same
 * signed approval twice: one battle log.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
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
assert.equal(process.env.PGDATABASE, 'deckpal_ci_idempotency');
assert.equal(dirname(process.env.DECKPAL_TEST_RESULT), root);
assert.equal(existsSync(join(REPO, '.env')), false);
assert.equal(process.env.DATABASE_URL, undefined);
assert.ok(!Object.keys(process.env).some((key) => /^SUPABASE/.test(key)), 'Supabase environment must not reach integration imports.');

const config = { host: process.env.PGHOST, port: 55432, user: process.env.PGUSER, database: process.env.PGDATABASE, ssl: false };
const results = { name: 'approved-write-idempotency', status: 'running', cases: [] };
async function test(name, fn) {
  await fn();
  results.cases.push({ name, status: 'passed' });
  console.log('PASS ' + name);
}

const USER = '00000000-0000-4000-8000-000000000001';
const LOG = [
  'Setup',
  'Alice drew 7 cards for the opening hand.',
  'Bob drew 7 cards for the opening hand.',
  "Alice's Turn",
  'Alice played Pikachu to the Active Spot.',
  "Bob's Turn",
  'Bob played Charmander to the Active Spot.',
  'Alice took 2 Prize cards.',
  'All Prize cards taken. Alice wins.',
].join('\n');

const db = new pg.Client(config);
await db.connect();
let server;
let apiPool;
try {
  const { migrateUp } = await import('../../../../packages/db/src/migrate.ts');
  const migrations = new pg.Pool({ ...config, max: 1 });
  try { await migrateUp(migrations); } finally { await migrations.end(); }

  // ── fixtures: one user, one card with one printing ────────────────────────
  const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
  await db.query('INSERT INTO app_user (id, username) VALUES ($1, $2)', [USER, 'idempotency-user']);
  const series = (await one(`INSERT INTO series (catalogue_code, tcgdex_id, slug, name) VALUES ('en','sv','scarlet-violet','Scarlet & Violet') RETURNING id`)).id;
  const set = (await one(`INSERT INTO card_set (series_id, tcgdex_id, slug, name, abbreviation) VALUES ($1,'sv01','sv01','Scarlet & Violet','SVI') RETURNING id`, [series])).id;
  await db.query(`INSERT INTO variant_kind (code, display_name, finish, size, tier_derived, tier_rule_version)
                  VALUES ('normal','normal','normal','standard','standard',3) ON CONFLICT DO NOTHING`);
  const card = (await one(
    `INSERT INTO card (set_id, tcgdex_id, local_id, local_id_numeric, number_sort, name, name_normalized, category)
     VALUES ($1,'sv01-025','025',25,'025','Pikachu','pikachu','Pokemon') RETURNING id`, [set])).id;
  const variant = Number((await one(
    `INSERT INTO card_variant (card_id, variant_kind_code, sort_order, is_primary, id_source, id_confidence)
     VALUES ($1,'normal',0,true,'none',0) RETURNING id`, [card])).id);

  // ── the real routes, as one signed-in user, on a loopback server ──────────
  const { default: express } = await import('express');
  const database = await import('../db.ts');
  apiPool = database.pool;
  const { decksRouter } = await import('../routes/decks.ts');
  const { listsRouter } = await import('../routes/lists.ts');
  const { mutationsRouter } = await import('../routes/mutations.ts');
  const { errorMiddleware } = await import('../http.ts');
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use((req, _res, next) => { req.user = { id: USER }; next(); });
  app.use('/api/decks', decksRouter);
  app.use('/api/lists', listsRouter);
  app.use('/api/mutations', mutationsRouter);
  app.use(errorMiddleware);
  server = await new Promise((resolveServer, reject) => {
    const listening = app.listen(0, '127.0.0.1', () => resolveServer(listening));
    listening.once('error', reject);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body, key) => {
    const response = await fetch(base + '/api' + path, {
      method,
      headers: { 'content-type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(20_000),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : undefined };
  };
  const count = async (sql, args = []) => Number((await one(sql, args)).n);
  const logsOn = (deckId) => count('SELECT count(*) AS n FROM battle_log WHERE deck_id = $1', [deckId]);
  const batchesWith = (tool) => count(`SELECT count(*) AS n FROM mutation_batch WHERE user_id = $1 AND tool = $2`, [USER, tool]);

  const deck = await call('POST', '/decks/save', { name: 'Pikachu deck', cards: [{ cardId: 'sv01-025', quantity: 4 }], source: 'test-suite' });
  assert.equal(deck.status, 201, JSON.stringify(deck.body));
  const deckId = deck.body.deck.id;

  // ── 1. The headline: a signed approval resumed twice through Deck-E ───────
  await test('a replayed Deck-E approval writes one battle log, however the resume POST differs', async () => {
    const { convertToModelMessages, streamText } = await import('ai');
    const { MockLanguageModelV3 } = await import('ai/test');
    const { buildDataTools } = await import('../decke/adapters/aisdk.ts');
    const secret = 'integration-only-approval-secret';
    const input = { deck_id: deckId, log: LOG, dry_run: false };
    const model = (calls = []) => new MockLanguageModelV3({
      doStream: async () => ({
        stream: new ReadableStream({
          start(c) {
            c.enqueue({ type: 'stream-start', warnings: [] });
            for (const x of calls) c.enqueue({ type: 'tool-call', toolCallId: x.id, toolName: 'add_battle_log', input: JSON.stringify(input) });
            c.enqueue({
              type: 'finish',
              finishReason: { unified: calls.length ? 'tool-calls' : 'stop', raw: calls.length ? 'tool_calls' : 'stop' },
              usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } },
            });
          },
        }),
      }),
    });
    const drain = async (result) => {
      const parts = [];
      const reader = result.fullStream.getReader();
      try {
        for (;;) {
          let timer;
          const quiet = new Promise((r) => { timer = setTimeout(() => r('quiet'), 2_000); });
          const next = await Promise.race([reader.read(), quiet]);
          clearTimeout(timer);
          if (next === 'quiet' || next.done) return parts;
          parts.push(next.value);
        }
      } finally { await reader.cancel().catch(() => {}); }
    };
    // The adapter's database handle is never opened by this tool: every read
    // and the write go through the API, which is the real one above.
    const tools = (conversationId) => buildDataTools({
      pool: apiPool, userId: USER, jwt: 'unused-by-this-server', apiBase: base + '/api',
      include: (d) => d.name === 'add_battle_log', conversationId,
    });
    const hold = async (id) => {
      const issued = await drain(streamText({
        model: model([{ id }]), messages: [{ role: 'user', content: 'log this game' }],
        tools: tools('c1'), experimental_toolApprovalSecret: secret,
      }));
      const request = issued.find((p) => p.type === 'tool-approval-request');
      assert.ok(request, 'the write was not held for approval');
      return () => convertToModelMessages([
        { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'log this game' }] },
        { id: 'a1', role: 'assistant', parts: [{
          type: 'tool-add_battle_log', toolCallId: id, input, state: 'approval-responded',
          approval: { id: request.approvalId, approved: true, signature: request.signature },
        }] },
      ]);
    };
    const before = await logsOn(deckId);
    const resume = await hold('signed-call-1');
    assert.equal(await logsOn(deckId), before, 'the held call wrote before approval');

    const out = (parts) => String(parts.find((p) => p.type === 'tool-result')?.output ?? '');
    const first = await drain(streamText({ model: model(), messages: await resume(), tools: tools('original'), experimental_toolApprovalSecret: secret }));
    assert.match(out(first), /^Logged battle #/, out(first));
    assert.equal(await logsOn(deckId), before + 1);
    // Same approval, resumed again with an unsigned field changed.
    const second = await drain(streamText({ model: model(), messages: await resume(), tools: tools('changed'), experimental_toolApprovalSecret: secret }));
    assert.equal(await logsOn(deckId), before + 1, 'the replayed approval wrote a second battle log');
    assert.match(out(second), /REPLAYED/);
    assert.equal(out(second).split('\n')[0], out(first).split('\n')[0], 'the replay did not return the original log');

    const keyed = await db.query(
      `SELECT b.idempotency_key, b.status, e.operation FROM mutation_batch b JOIN mutation_event e ON e.batch_id = b.id
        WHERE b.user_id = $1 AND b.tool = 'battle_log.create'`, [USER]);
    assert.equal(keyed.rows.length, 1);
    assert.match(keyed.rows[0].idempotency_key, /^decke-call:[0-9a-f]{64}$/);
    assert.equal(keyed.rows[0].status, 'committed');
    assert.equal(keyed.rows[0].operation, 'battle_log.create');

    // A second signed call with the identical input is a second consent.
    const again = await hold('signed-call-2');
    await drain(streamText({ model: model(), messages: await again(), tools: tools('c2'), experimental_toolApprovalSecret: secret }));
    assert.equal(await logsOn(deckId), before + 2);
  });

  // ── 2. The routes directly ────────────────────────────────────────────────
  await test('battle log: same key replays even with a changed body, a new key writes, no key behaves as before', async () => {
    const before = await logsOn(deckId);
    const batches = await batchesWith('battle_log.create');
    const a = await call('POST', `/decks/${deckId}/logs`, { rawLog: LOG, notes: 'first', source: 'test-suite' }, 'route-log-1');
    assert.equal(a.status, 201);
    assert.equal(a.body.replayed, false);
    const b = await call('POST', `/decks/${deckId}/logs`, { rawLog: LOG, notes: 'changed', source: 'test-suite' }, 'route-log-1');
    assert.equal(b.status, 200);
    assert.equal(b.body.replayed, true);
    assert.equal(b.body.log.id, a.body.log.id);
    assert.equal(b.body.log.notes, 'first', 'a replay must return the original write, not the new body');
    assert.equal(await logsOn(deckId), before + 1);
    const c = await call('POST', `/decks/${deckId}/logs`, { rawLog: LOG, source: 'test-suite' }, 'route-log-2');
    assert.equal(c.status, 201);
    assert.notEqual(c.body.log.id, a.body.log.id);
    assert.equal(await logsOn(deckId), before + 2);
    // No key: two writes, no batch, and the response body has no `replayed`.
    for (let i = 0; i < 2; i++) {
      const plain = await call('POST', `/decks/${deckId}/logs`, { rawLog: LOG, source: 'test-suite' });
      assert.equal(plain.status, 201);
      assert.equal('replayed' in plain.body, false);
    }
    assert.equal(await logsOn(deckId), before + 4);
    assert.equal(await batchesWith('battle_log.create'), batches + 2);
    // A preview never takes part.
    const dry = await call('POST', `/decks/${deckId}/logs`, { rawLog: LOG, dryRun: true }, 'route-log-1');
    assert.equal(dry.body.dryRun, true);
    // A replay whose log has since been deleted says so and writes nothing.
    assert.equal((await call('DELETE', `/decks/${deckId}/logs/${a.body.log.id}`)).status, 200);
    const gone = await call('POST', `/decks/${deckId}/logs`, { rawLog: LOG }, 'route-log-1');
    assert.equal(gone.status, 410);
    assert.equal(await logsOn(deckId), before + 3);
  });

  await test('battle log edit and delete: a replay neither undoes a later edit nor 404s', async () => {
    const made = await call('POST', `/decks/${deckId}/logs`, { rawLog: LOG, source: 'test-suite' });
    const logId = made.body.log.id;
    const e1 = await call('PATCH', `/decks/${deckId}/logs/${logId}`, { notes: 'from Deck-E', source: 'test-suite' }, 'route-edit-1');
    assert.equal(e1.body.log.notes, 'from Deck-E');
    await call('PATCH', `/decks/${deckId}/logs/${logId}`, { notes: 'the reader fixed it' });
    const e2 = await call('PATCH', `/decks/${deckId}/logs/${logId}`, { notes: 'from Deck-E', source: 'test-suite' }, 'route-edit-1');
    assert.equal(e2.body.replayed, true);
    assert.equal(e2.body.log.notes, 'the reader fixed it', 'the replay put back a field the reader changed since');
    const d1 = await call('DELETE', `/decks/${deckId}/logs/${logId}`, { source: 'test-suite' }, 'route-del-1');
    const d2 = await call('DELETE', `/decks/${deckId}/logs/${logId}`, { source: 'test-suite' }, 'route-del-1');
    assert.deepEqual([d1.status, d2.status, d2.body.replayed, d2.body.deleted], [200, 200, true, logId]);
    // The delete's event keeps the summary, never the raw log.
    const ev = await one(`SELECT e.before FROM mutation_event e JOIN mutation_batch b ON b.id = e.batch_id WHERE b.idempotency_key = 'route-del-1'`);
    assert.equal('rawLog' in ev.before || 'raw_log' in ev.before, false);
  });

  await test('deck revert: a replay makes no extra version; unkeyed repeats still do', async () => {
    const versions = () => count('SELECT count(*) AS n FROM deck_version WHERE deck_id = $1', [deckId]);
    // Battle logs on the current version make the next edit a new version.
    const edited = await call('POST', '/decks/save', { deckId, cards: [{ cardId: 'sv01-025', quantity: 2 }], source: 'test-suite' });
    assert.equal(edited.status, 200, JSON.stringify(edited.body));
    const start = await versions();
    assert.ok(start >= 2);
    const r1 = await call('POST', `/decks/${deckId}/revert`, { toVersion: 1, source: 'test-suite' }, 'route-revert-1');
    assert.equal(r1.status, 200, JSON.stringify(r1.body));
    const r2 = await call('POST', `/decks/${deckId}/revert`, { toVersion: 1, source: 'test-suite' }, 'route-revert-1');
    assert.equal(r2.body.replayed, true);
    assert.deepEqual(r2.body.revert, r1.body.revert);
    assert.equal(await versions(), start + 1, 'a replayed revert made another version');
    await call('POST', `/decks/${deckId}/revert`, { toVersion: 1, source: 'test-suite' });
    assert.equal(await versions(), start + 2, 'the unkeyed route changed behaviour');
  });

  await test('strategy guide: a replay does not overwrite the reader’s later guide', async () => {
    await call('PUT', `/decks/${deckId}/strategy`, { strategyMd: '# Deck-E guide', source: 'test-suite' }, 'route-guide-1');
    await call('PUT', `/decks/${deckId}/strategy`, { strategyMd: '# My guide' });
    const replay = await call('PUT', `/decks/${deckId}/strategy`, { strategyMd: '# Deck-E guide', source: 'test-suite' }, 'route-guide-1');
    assert.equal(replay.body.replayed, true);
    assert.equal((await one('SELECT strategy_md FROM deck WHERE id = $1', [deckId])).strategy_md, '# My guide');
  });

  await test('deck save: a per-call key replays its deck after an edit instead of making a twin', async () => {
    const decks = () => count('SELECT count(*) AS n FROM deck WHERE user_id = $1', [USER]);
    const made = await call('POST', '/decks/save', { name: 'Keyed deck', cards: [{ cardId: 'sv01-025', quantity: 1 }], source: 'test-suite' }, 'route-save-1');
    assert.equal(made.status, 201);
    const n = await decks();
    await call('POST', '/decks/save', { deckId: made.body.deck.id, cards: [{ cardId: 'sv01-025', quantity: 3 }], source: 'test-suite' });
    const replay = await call('POST', '/decks/save', { name: 'Keyed deck', cards: [{ cardId: 'sv01-025', quantity: 1 }], source: 'test-suite' }, 'route-save-1');
    assert.equal(replay.status, 200);
    assert.equal(replay.body.replayed, true);
    assert.equal(replay.body.deck.id, made.body.deck.id);
    assert.equal(await decks(), n, 'a replayed approval created a twin deck');
  });

  await test('lists: create, rename, bulk add and remove replay; concurrent duplicates write once; unkeyed bags still duplicate', async () => {
    const lists = () => count('SELECT count(*) AS n FROM card_list WHERE user_id = $1', [USER]);
    const items = (listId) => count('SELECT count(*) AS n FROM list_item WHERE list_id = $1', [listId]);
    const before = await lists();
    const c1 = await call('POST', '/lists', { name: 'Trade binder', kind: 'static', source: 'test-suite' }, 'route-list-1');
    const c2 = await call('POST', '/lists', { name: 'Trade binder', kind: 'static', source: 'test-suite' }, 'route-list-1');
    assert.deepEqual([c1.status, c2.status, c2.body.replayed], [201, 200, true]);
    assert.equal(c2.body.list.id, c1.body.list.id);
    assert.equal(await lists(), before + 1);
    const listId = c1.body.list.id;

    const add = { items: [{ cardVariantId: variant, quantity: 2 }], source: 'test-suite' };
    const a1 = await call('POST', `/lists/${listId}/items/bulk`, add, 'route-bulk-1');
    const a2 = await call('POST', `/lists/${listId}/items/bulk`, add, 'route-bulk-1');
    assert.deepEqual([a1.body.added, a2.body.added, a2.body.replayed, a2.body.batchId], [1, 1, true, a1.body.batchId]);
    assert.equal(await items(listId), 1, 'a replayed bulk add doubled a static list');

    // Two at once with one key: the second blocks on the index, then replays.
    const [p, q] = await Promise.all([
      call('POST', `/lists/${listId}/items/bulk`, add, 'route-bulk-2'),
      call('POST', `/lists/${listId}/items/bulk`, add, 'route-bulk-2'),
    ]);
    assert.deepEqual([p.body.replayed, q.body.replayed].sort(), [false, true]);
    assert.equal(await items(listId), 2);

    await call('POST', `/lists/${listId}/items/bulk`, add);
    await call('POST', `/lists/${listId}/items/bulk`, add);
    assert.equal(await items(listId), 4, 'an unkeyed static bulk add changed behaviour');

    await call('PATCH', `/lists/${listId}`, { name: 'Deck-E name', source: 'test-suite' }, 'route-rename-1');
    await call('PATCH', `/lists/${listId}`, { name: 'Reader name' });
    const rn = await call('PATCH', `/lists/${listId}`, { name: 'Deck-E name', source: 'test-suite' }, 'route-rename-1');
    assert.equal(rn.body.replayed, true);
    assert.equal(rn.body.list.name, 'Reader name');

    const itemId = (await one('SELECT id FROM list_item WHERE list_id = $1 ORDER BY position LIMIT 1', [listId])).id;
    const r1 = await call('DELETE', `/lists/${listId}/items/${itemId}`, undefined, 'route-remove-1');
    const r2 = await call('DELETE', `/lists/${listId}/items/${itemId}`, undefined, 'route-remove-1');
    assert.deepEqual([r1.status, r2.status, r2.body.replayed], [200, 200, true]);
    assert.equal(await items(listId), 3);
  });

  await test('list delete: a replay does not re-delete a list the reader restored', async () => {
    const made = await call('POST', '/lists', { name: 'Restorable', source: 'test-suite' });
    const listId = made.body.list.id;
    const d1 = await call('DELETE', `/lists/${listId}`, { source: 'test-suite' }, 'route-list-del-1');
    assert.equal(d1.body.deleted, listId);
    await call('POST', `/lists/${listId}/restore`, {});
    const d2 = await call('DELETE', `/lists/${listId}`, { source: 'test-suite' }, 'route-list-del-1');
    assert.equal(d2.body.replayed, true);
    const live = await one('SELECT deleted_at FROM card_list WHERE id = $1', [listId]);
    assert.equal(live.deleted_at, null, 'the replay deleted the list again');
  });

  await test('mutation revert: a replay returns the first revert and records nothing new', async () => {
    const made = await call('POST', '/lists', { name: 'To revert', kind: 'static', source: 'test-suite' });
    const listId = made.body.list.id;
    const added = await call('POST', `/lists/${listId}/items/bulk`, { items: [{ cardVariantId: variant }], source: 'test-suite' });
    const body = { batchId: added.body.batchId, dryRun: false, source: 'test-suite' };
    const events = () => count('SELECT count(*) AS n FROM mutation_event WHERE user_id = $1', [USER]);
    const v1 = await call('POST', '/mutations/revert', body, 'route-mrevert-1');
    assert.equal(v1.status, 200, JSON.stringify(v1.body));
    assert.equal(v1.body.applied, 1);
    const n = await events();
    const v2 = await call('POST', '/mutations/revert', body, 'route-mrevert-1');
    assert.deepEqual([v2.body.replayed, v2.body.batchId, v2.body.applied], [true, v1.body.batchId, 1]);
    assert.equal(await events(), n);
    const keyedBatch = await one('SELECT reverts_batch_id, note FROM mutation_batch WHERE idempotency_key = $1', ['route-mrevert-1']);
    assert.equal(keyedBatch.reverts_batch_id, added.body.batchId);
  });

  await test('a key over 200 characters is refused, not truncated', async () => {
    const long = await call('POST', `/decks/${deckId}/logs`, { rawLog: LOG }, 'k'.repeat(201));
    assert.equal(long.status, 400);
  });

  results.status = 'passed';
} catch (error) {
  results.status = 'failed';
  results.error = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(error);
  process.exitCode = 1;
} finally {
  if (server) await new Promise((r) => server.close(r));
  if (apiPool) await apiPool.end().catch(() => {});
  await db.end().catch(() => {});
  writeFileSync(process.env.DECKPAL_TEST_RESULT, JSON.stringify(results, null, 2));
}
