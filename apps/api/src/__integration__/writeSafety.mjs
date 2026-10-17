/**
 * Write safety (2026-10-12), proved against real PostgreSQL 16 with every
 * shipped migration applied. Invoked only by scripts/test-db-integration.mjs.
 *
 * The owner chose four fixes: a battle-log recycle bin with undo, keeping the
 * deck list a save replaces, no duplicates when a write is retried, and a
 * preview for strategy rewrites. The first three live in the API and the
 * mutation log, so they are checked here on the real routes and the real
 * `revert` planner, and then once more through the shared agent tools the MCP
 * server runs, talking to those same routes over HTTP. The strategy preview is
 * MCP-only and has no database side; apps/mcp's wire tests cover it.
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
assert.equal(process.env.PGDATABASE, 'deckpal_ci_write_safety');
assert.equal(dirname(process.env.DECKPAL_TEST_RESULT), root);
assert.equal(existsSync(join(REPO, '.env')), false);
assert.equal(process.env.DATABASE_URL, undefined);
assert.ok(!Object.keys(process.env).some((key) => /^SUPABASE/.test(key)), 'Supabase environment must not reach integration imports.');

const config = { host: process.env.PGHOST, port: 55432, user: process.env.PGUSER, database: process.env.PGDATABASE, ssl: false };
const results = { name: 'write-safety', status: 'running', cases: [] };
async function test(name, fn) {
  await fn();
  results.cases.push({ name, status: 'passed' });
  console.log('PASS ' + name);
}

const USER = '00000000-0000-4000-8000-000000000002';
// A recognisable phrase, so the check that no event ever copies the raw log
// can search for it.
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

  // ── fixtures: one user, two cards with one printing each ──────────────────
  const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
  await db.query('INSERT INTO app_user (id, username) VALUES ($1, $2)', [USER, 'write-safety-user']);
  const series = (await one(`INSERT INTO series (catalogue_code, tcgdex_id, slug, name) VALUES ('en','sv','scarlet-violet','Scarlet & Violet') RETURNING id`)).id;
  const set = (await one(`INSERT INTO card_set (series_id, tcgdex_id, slug, name, abbreviation) VALUES ($1,'sv01','sv01','Scarlet & Violet','SVI') RETURNING id`, [series])).id;
  await db.query(`INSERT INTO variant_kind (code, display_name, finish, size, tier_derived, tier_rule_version)
                  VALUES ('normal','normal','normal','standard','standard',3) ON CONFLICT DO NOTHING`);
  for (const [local, name] of [['025', 'Pikachu'], ['026', 'Raichu']]) {
    const card = (await one(
      `INSERT INTO card (set_id, tcgdex_id, local_id, local_id_numeric, number_sort, name, name_normalized, category)
       VALUES ($1,$2,$3,$4,$3,$5,lower($5),'Pokemon') RETURNING id`, [set, `sv01-${local}`, local, Number(local), name])).id;
    await db.query(
      `INSERT INTO card_variant (card_id, variant_kind_code, sort_order, is_primary, id_source, id_confidence)
       VALUES ($1,'normal',0,true,'none',0)`, [card]);
  }

  // ── the real routes, as one signed-in user, on a loopback server ──────────
  const { default: express } = await import('express');
  const database = await import('../db.ts');
  apiPool = database.pool;
  const { decksRouter } = await import('../routes/decks.ts');
  const { mutationsRouter } = await import('../routes/mutations.ts');
  const { errorMiddleware } = await import('../http.ts');
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use((req, _res, next) => { req.user = { id: USER }; next(); });
  app.use('/api/decks', decksRouter);
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
  const ok = async (method, path, body, key) => {
    const r = await call(method, path, body, key);
    assert.ok(r.status >= 200 && r.status < 300, `${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
  };
  const count = async (sql, args = []) => Number((await one(sql, args)).n);
  const live = (logId) => count('SELECT count(*) AS n FROM battle_log WHERE id = $1', [logId]);
  const binned = (logId) => count('SELECT count(*) AS n FROM battle_log_bin WHERE id = $1', [logId]);
  const versions = (deckId) => count('SELECT count(*) AS n FROM deck_version WHERE deck_id = $1', [deckId]);
  /** The newest batch of `tool` that touched `entityId`. */
  const latestBatch = async (tool, entityId) => {
    const qs = new URLSearchParams({ tool, entity_id: String(entityId), limit: '1' });
    const r = await ok('GET', `/mutations?${qs}`);
    assert.equal(r.batches.length, 1, `no ${tool} batch for ${entityId}`);
    return r.batches[0];
  };
  const revert = (batchId, extra = {}) => ok('POST', '/mutations/revert', { batchId, source: 'test-suite', ...extra });
  const deckCards = async (deckId) =>
    (await db.query(
      `SELECT c.tcgdex_id, dc.quantity FROM deck_card dc JOIN card c ON c.id = dc.card_id WHERE dc.deck_id = $1 ORDER BY c.tcgdex_id`,
      [deckId],
    )).rows.map((r) => `${r.quantity}x ${r.tcgdex_id}`);

  const deck = await ok('POST', '/decks/save', { name: 'Pikachu deck', cards: [{ cardId: 'sv01-025', quantity: 4 }], source: 'test-suite' });
  const deckId = deck.deck.id;
  const addLog = async (extra = {}) => (await ok('POST', `/decks/${deckId}/logs`, { rawLog: LOG, source: 'test-suite', ...extra })).log;

  // ── 1. The recycle bin ────────────────────────────────────────────────────
  await test('a delete moves a battle log to the recycle bin; restore brings back the same id on the same version', async () => {
    const log = await addLog({ notes: 'keep me' });
    const record = async () => (await ok('GET', `/decks/${deckId}/logs`)).totals.total;
    const before = await record();

    const del = await ok('DELETE', `/decks/${deckId}/logs/${log.id}`, { source: 'test-suite' });
    assert.deepEqual([del.deleted, del.restorable, typeof del.batchId], [log.id, true, 'string']);
    assert.deepEqual([await live(log.id), await binned(log.id)], [0, 1]);
    assert.equal(await record(), before - 1, 'a binned log still counted in the record');
    assert.equal((await call('GET', `/decks/${deckId}/logs/${log.id}`)).status, 404);
    const bin = await ok('GET', `/decks/${deckId}/logs/deleted`);
    assert.equal(bin.logs[0].id, log.id);
    assert.ok(bin.logs[0].deletedAt);

    const back = await ok('POST', `/decks/${deckId}/logs/${log.id}/restore`, { source: 'test-suite' });
    assert.deepEqual([back.log.id, back.log.deckVersion, back.log.notes, back.log.rawLog], [log.id, log.deckVersion, 'keep me', LOG]);
    assert.deepEqual([await live(log.id), await binned(log.id)], [1, 0]);
    assert.equal(await record(), before);
    assert.equal((await call('POST', `/decks/${deckId}/logs/${log.id}/restore`, {})).status, 404, 'a second restore must say there is nothing to restore');
  });

  await test('purge deletes for good, from the live table or the bin, and no event ever holds the log text', async () => {
    const a = await addLog();
    const pa = await ok('DELETE', `/decks/${deckId}/logs/${a.id}?purge=true`, { source: 'test-suite' });
    assert.equal(pa.restorable, false);
    assert.deepEqual([await live(a.id), await binned(a.id)], [0, 0]);

    const b = await addLog();
    await ok('DELETE', `/decks/${deckId}/logs/${b.id}`, { source: 'test-suite' });
    await ok('DELETE', `/decks/${deckId}/logs/${b.id}?purge=true`, { source: 'test-suite' });
    assert.deepEqual([await live(b.id), await binned(b.id)], [0, 0]);
    assert.equal((await call('POST', `/decks/${deckId}/logs/${b.id}/restore`, {})).status, 404);

    const purgeBatch = await latestBatch('battle_log.purge', b.id);
    const plan = await revert(purgeBatch.batchId, { dryRun: true });
    assert.match(plan.plan[0].skipped, /purge is a real DELETE/);
    const leaked = await count(
      `SELECT count(*) AS n FROM mutation_event WHERE user_id = $1 AND (before::text LIKE '%opening hand%' OR after::text LIKE '%opening hand%')`,
      [USER],
    );
    assert.equal(leaked, 0, 'a mutation event copied the raw log, so a purge would not delete the text');
  });

  // ── 2. Every battle-log write is recorded, and revert undoes it ───────────
  await test('unkeyed battle-log writes are in mutation_history, and revert undoes create, edit and delete', async () => {
    const log = await addLog();
    const created = await latestBatch('battle_log.create', log.id);
    assert.equal(created.status, 'committed');

    const changed = log.result === 'loss' ? 'win' : 'loss';
    await ok('PATCH', `/decks/${deckId}/logs/${log.id}`, { result: changed, notes: 'misread', source: 'test-suite' });
    const edit = await latestBatch('battle_log.edit', log.id);
    const dry = await revert(edit.batchId, { dryRun: true });
    assert.deepEqual([dry.wouldApply, dry.conflicts, dry.skipped], [1, 0, 0], JSON.stringify(dry.plan));
    await revert(edit.batchId, { dryRun: false });
    const after = (await ok('GET', `/decks/${deckId}/logs/${log.id}`)).log;
    assert.deepEqual([after.result, after.notes], [log.result, null], 'revert did not put the old values back');

    await ok('DELETE', `/decks/${deckId}/logs/${log.id}`, { source: 'test-suite' });
    const del = await latestBatch('battle_log.delete', log.id);
    await revert(del.batchId, { dryRun: false });
    assert.deepEqual([await live(log.id), await binned(log.id)], [1, 0], 'reverting a delete did not restore the log');

    await revert(created.batchId, { dryRun: false });
    assert.deepEqual([await live(log.id), await binned(log.id)], [0, 1], 'reverting a create did not move the log to the bin');
  });

  await test('revert will not put back an edit over a later one, unless forced', async () => {
    const log = await addLog();
    await ok('PATCH', `/decks/${deckId}/logs/${log.id}`, { notes: 'first', source: 'test-suite' });
    const first = await latestBatch('battle_log.edit', log.id);
    await ok('PATCH', `/decks/${deckId}/logs/${log.id}`, { notes: 'second', source: 'test-suite' });
    const dry = await revert(first.batchId, { dryRun: true });
    assert.equal(dry.conflicts, 1);
    assert.match(dry.plan[0].conflicts[0], /edited again since/);
    await revert(first.batchId, { dryRun: false });
    assert.equal((await ok('GET', `/decks/${deckId}/logs/${log.id}`)).log.notes, 'second', 'an unforced revert overwrote a later edit');
    await revert(first.batchId, { dryRun: false, force: true });
    assert.equal((await ok('GET', `/decks/${deckId}/logs/${log.id}`)).log.notes, null);
  });

  // ── 3. The deck list a save replaces is kept ──────────────────────────────
  await test('a save that amends a logless version in place can be undone: revert puts the old list back as a new version', async () => {
    const made = await ok('POST', '/decks/save', { name: 'Amended deck', cards: [{ cardId: 'sv01-025', quantity: 4 }], source: 'test-suite' });
    const id = made.deck.id;
    await ok('POST', '/decks/save', { deckId: id, cards: [{ cardId: 'sv01-026', quantity: 2 }], source: 'test-suite' });
    assert.equal(await versions(id), 1, 'a logless edit is meant to amend in place — the case this protects');
    assert.deepEqual(await deckCards(id), ['2x sv01-026']);

    const save = await latestBatch('deck.save', id);
    const detail = await ok('GET', `/mutations/${save.batchId}`);
    const ev = detail.events.find((e) => e.operation === 'deck.cards');
    assert.equal(ev.before.v, 2);
    assert.deepEqual(ev.before.cards.map((c) => c.quantity), [4], 'the event did not keep the list it replaced');

    const dry = await revert(save.batchId, { dryRun: true });
    assert.equal(dry.conflicts, 0, JSON.stringify(dry.plan));
    assert.match(dry.plan.find((p) => p.operation === 'deck.cards').action, /as a new version/);
    await revert(save.batchId, { dryRun: false });
    assert.deepEqual(await deckCards(id), ['4x sv01-025']);
    assert.equal(await versions(id), 2, 'the restored list must land as a new version, keeping the one it replaces');

    // A later edit makes the old event a conflict, not a silent overwrite.
    await ok('POST', '/decks/save', { deckId: id, cards: [{ cardId: 'sv01-026', quantity: 3 }], source: 'test-suite' });
    const s2 = await latestBatch('deck.save', id);
    await ok('POST', '/decks/save', { deckId: id, cards: [{ cardId: 'sv01-025', quantity: 1 }], source: 'test-suite' });
    const stale = await revert(s2.batchId, { dryRun: true });
    assert.equal(stale.conflicts, 1);
    assert.match(stale.plan.find((p) => p.operation === 'deck.cards').conflicts[0], /changed since/);
  });

  await test('a deck_history revert is recorded unkeyed and can itself be undone', async () => {
    const made = await ok('POST', '/decks/save', { name: 'Reverted deck', cards: [{ cardId: 'sv01-025', quantity: 4 }], source: 'test-suite' });
    const id = made.deck.id;
    await ok('POST', `/decks/${id}/logs`, { rawLog: LOG, source: 'test-suite' }); // makes the next edit a new version
    await ok('POST', '/decks/save', { deckId: id, cards: [{ cardId: 'sv01-026', quantity: 2 }], source: 'test-suite' });
    await ok('POST', `/decks/${id}/revert`, { toVersion: 1, source: 'test-suite' });
    assert.deepEqual(await deckCards(id), ['4x sv01-025']);
    const rv = await latestBatch('deck.revert', id);
    await revert(rv.batchId, { dryRun: false });
    assert.deepEqual(await deckCards(id), ['2x sv01-026'], 'undoing the revert did not bring back the list it replaced');
  });

  await test('a deck event recorded before 2026-10-12 is skipped, never guessed at', async () => {
    const batch = (await one(
      `INSERT INTO mutation_batch (user_id, source, tool, status) VALUES ($1, 'web', 'deck.save', 'committed') RETURNING id`, [USER])).id;
    await db.query(
      `INSERT INTO mutation_event (batch_id, user_id, entity_type, entity_id, operation, before, after)
       VALUES ($1, $2, 'deck', $3, 'deck.cards', '{"cardsReplaced":true,"formatChanged":false}', '{"cardsReplaced":true}')`,
      [batch, USER, deckId],
    );
    const before = await deckCards(deckId);
    const r = await revert(batch, { dryRun: false });
    assert.equal(r.skipped, 1);
    assert.match(r.plan[0].skipped, /recorded before 2026-10-12/);
    assert.deepEqual(await deckCards(deckId), before);
  });

  // ── 3b. Astra round 1 (2026-10-12): the cases it found ────────────────────
  await test('a log in the bin still holds its version: an edit after deleting the last log makes a new version', async () => {
    const made = await ok('POST', '/decks/save', { name: 'Bin holds version', cards: [{ cardId: 'sv01-025', quantity: 4 }], source: 'test-suite' });
    const id = made.deck.id;
    const log = (await ok('POST', `/decks/${id}/logs`, { rawLog: LOG, source: 'test-suite' })).log;
    await ok('DELETE', `/decks/${id}/logs/${log.id}`, { source: 'test-suite' });
    await ok('POST', '/decks/save', { deckId: id, cards: [{ cardId: 'sv01-026', quantity: 2 }], source: 'test-suite' });
    assert.equal(await versions(id), 2, 'the edit amended the version a binned log was played on');
    const restored = await ok('POST', `/decks/${id}/logs/${log.id}/restore`, { source: 'test-suite' });
    assert.equal(restored.log.deckVersion, 1);
    const v1 = await one('SELECT cards FROM deck_version WHERE deck_id = $1 AND version = 1', [id]);
    assert.deepEqual(v1.cards.map((c) => `${c.quantity}x ${c.tcgdexId}`), ['4x sv01-025'], 'the restored game no longer points at the list it was played with');
  });

  await test('a deck save committing while a revert waits is a conflict, not overwritten', async () => {
    const made = await ok('POST', '/decks/save', { name: 'Raced deck', cards: [{ cardId: 'sv01-025', quantity: 4 }], source: 'test-suite' });
    const id = made.deck.id;
    await ok('POST', '/decks/save', { deckId: id, cards: [{ cardId: 'sv01-026', quantity: 2 }], source: 'test-suite' });
    const save = await latestBatch('deck.save', id);
    // Another writer holds the deck and changes its list; the revert starts,
    // then that writer commits.
    const other = new pg.Client(config);
    await other.connect();
    try {
      await other.query('BEGIN');
      await other.query('SELECT 1 FROM deck WHERE id = $1 FOR UPDATE', [id]);
      await other.query(`UPDATE deck_card SET quantity = 3 WHERE deck_id = $1`, [id]);
      const pending = revert(save.batchId, { dryRun: false });
      await new Promise((r) => setTimeout(r, 400));
      await other.query('COMMIT');
      const r = await pending;
      assert.deepEqual([r.applied, r.conflicts], [0, 1], JSON.stringify(r.plan));
    } finally {
      await other.end();
    }
    assert.deepEqual(await deckCards(id), ['3x sv01-026'], 'the revert overwrote a change that committed while it waited');
  });

  await test('undoing a save puts an exact-printing pin back with the card', async () => {
    const made = await ok('POST', '/decks/save', { name: 'Pinned deck', cards: [{ cardId: 'sv01-025', quantity: 4 }, { cardId: 'sv01-026', quantity: 2 }], source: 'test-suite' });
    const id = made.deck.id;
    await ok('PATCH', `/decks/${id}/cards/sv01-026`, { pinExact: true });
    await ok('POST', '/decks/save', { deckId: id, cards: [{ cardId: 'sv01-025', quantity: 4 }], source: 'test-suite' });
    await revert((await latestBatch('deck.save', id)).batchId, { dryRun: false });
    const pinned = await db.query(
      `SELECT c.tcgdex_id FROM deck_card dc JOIN card c ON c.id = dc.card_id WHERE dc.deck_id = $1 AND dc.pin_exact`, [id]);
    assert.deepEqual(pinned.rows.map((r) => r.tcgdex_id), ['sv01-026'], 'the card came back without its pin');
  });

  await test('undoing the undo of a deck_history revert puts the guide back too', async () => {
    const made = await ok('POST', '/decks/save', { name: 'Guided deck', cards: [{ cardId: 'sv01-025', quantity: 4 }], source: 'test-suite' });
    const id = made.deck.id;
    await ok('PUT', `/decks/${id}/strategy`, { strategyMd: '# Guide one' });
    await ok('POST', `/decks/${id}/logs`, { rawLog: LOG, source: 'test-suite' });
    await ok('POST', '/decks/save', { deckId: id, cards: [{ cardId: 'sv01-026', quantity: 2 }], source: 'test-suite' });
    await ok('PUT', `/decks/${id}/strategy`, { strategyMd: '# Guide two' });
    await ok('POST', `/decks/${id}/revert`, { toVersion: 1, includeStrategy: true, source: 'test-suite' });
    const guide = async () => (await one('SELECT strategy_md FROM deck WHERE id = $1', [id])).strategy_md;
    assert.equal(await guide(), '# Guide one');
    const undo = await revert((await latestBatch('deck.revert', id)).batchId, { dryRun: false });
    assert.equal(await guide(), '# Guide two', 'undoing the revert left its guide');
    await revert(undo.batchId, { dryRun: false });
    assert.equal(await guide(), '# Guide one', 'undoing the undo restored the list but not the guide');
    assert.deepEqual(await deckCards(id), ['4x sv01-025']);
  });

  // ── 4. Through the agent tools the MCP server runs ────────────────────────
  await test('over the agent tools: a retried add_battle_log or deck revert lands once; delete, bin and restore work end to end', async () => {
    const { allTools, makeApi } = await import('@deckpal/agent-tools');
    const ctx = { db: apiPool, userId: USER, api: makeApi(base + '/api') };
    const run = async (name, args) => {
      const tool = allTools().find((t) => t.name === name);
      const schema = tool.mcp?.inputSchema ?? tool.inputSchema;
      const handler = tool.mcp?.handler ?? tool.handler;
      const res = await handler(schema.parse(args), ctx);
      assert.notEqual(res.isError, true, `${name}: ${res.text}`);
      return res.text;
    };
    const made = await ok('POST', '/decks/save', { name: 'Tool deck', cards: [{ cardId: 'sv01-025', quantity: 4 }], source: 'test-suite' });
    const id = made.deck.id;
    const logs = () => count('SELECT count(*) AS n FROM battle_log WHERE deck_id = $1', [id]);

    const args = { deck_id: id, log: LOG, notes: 'retried', dry_run: false };
    assert.match(await run('add_battle_log', args), /^Logged battle #/);
    assert.match(await run('add_battle_log', args), /^Already logged as battle #\d+ on v1 — this exact request had already run/);
    assert.equal(await logs(), 1, 'a retried add_battle_log wrote a second log');
    assert.match(await run('add_battle_log', { ...args, notes: 'game 2' }), /^Logged battle #/, 'a distinct call must still write');
    assert.equal(await logs(), 2);

    await ok('POST', '/decks/save', { deckId: id, cards: [{ cardId: 'sv01-026', quantity: 2 }], source: 'test-suite' });
    const start = await versions(id);
    const revertArgs = { deck_id: id, revert_to: 1, dry_run: false };
    assert.match(await run('deck_history', revertArgs), /^Reverted 'Tool deck' to v1/);
    assert.match(await run('deck_history', revertArgs), /exact revert had already run/);
    assert.equal(await versions(id), start + 1, 'a retried revert made a second version');

    const logId = (await one('SELECT id FROM battle_log WHERE deck_id = $1 ORDER BY id LIMIT 1', [id])).id;
    assert.match(await run('delete_battle_log', { deck_id: id, log_id: Number(logId), dry_run: false }), /recycle bin/);
    assert.match(await run('delete_battle_log', { deck_id: id, log_id: Number(logId), dry_run: false }), /already in the recycle bin — nothing changed/);
    assert.match(await run('battle_logs', { deck_id: id, deleted: true }), new RegExp(`#${logId}\\b`));
    assert.match(await run('delete_battle_log', { deck_id: id, log_id: Number(logId), restore: true, dry_run: false }), /^Restored battle #/);
    assert.equal(await logs(), 2);
    assert.match(await run('battle_logs', { deck_id: id, deleted: true }), /recycle bin is empty/);

    // The MCP history now shows the battle-log writes, attributed to the server.
    const history = await ok('GET', `/mutations?${new URLSearchParams({ entity_type: 'battle_log', entity_id: String(logId) })}`);
    assert.deepEqual(
      history.batches.map((b) => b.tool).sort(),
      ['battle_log.create', 'battle_log.delete', 'battle_log.restore'],
    );
    assert.ok(history.batches.every((b) => b.source === 'deckpal-mcp'));
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
