/**
 * What each MCP tool actually returns, measured against a seeded database.
 *
 * `tools/list` says what the surface costs before a call; this says what a
 * call costs after. It seeds a real-sized catalog and a heavy user (see
 * seed.mjs), starts the real API on loopback and the real MCP server over an
 * in-memory transport, then calls every read tool the way a model would — at
 * its defaults, and at the largest page the schema lets it ask for — and
 * records the size of each result.
 *
 * Run two ways, both on a disposable cluster that nothing else uses:
 *   - `pnpm mcp:audit --responses` (scripts/mcp-audit.mjs) prints the table;
 *   - scripts/test-db-integration.mjs runs it in CI with
 *     DECKPAL_MCP_AUDIT_BUDGETS=1, which turns the BUDGETS below into
 *     assertions, so a read that quietly grows past its cap fails the build
 *     instead of a user's context window.
 *
 * Outbound network is refused (only 127.0.0.1 is reachable), so the numbers
 * cannot depend on anything outside the box.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { OWNER_NAME, asOwner, liveLogs, review, seedCatalog, seedPriceHistory, strategyGuide, unit } from './seed.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../..');
const root = process.env.DECKPAL_TEST_ROOT;
assert.ok(root && /^\/tmp\/deckpal-db-[^/]+$/.test(root), 'runs only on a runner-owned disposable cluster');
assert.equal(realpathSync(root), root);
assert.equal(readFileSync(join(root, '.deckpal-ci-owner'), 'utf8'), process.env.DECKPAL_TEST_MARKER);
assert.equal(process.env.PGHOST, join(root, 'socket'));
assert.equal(process.env.PGPORT, '55432');
assert.equal(process.env.PGUSER, 'deckpal_ci_fixture');
assert.equal(existsSync(join(REPO, '.env')), false);
assert.equal(process.env.DATABASE_URL, undefined);
assert.ok(!Object.keys(process.env).some((key) => /^SUPABASE/.test(key)), 'Supabase environment must not reach audit imports.');

const BUDGETS_ON = process.env.DECKPAL_MCP_AUDIT_BUDGETS === '1';
const config = { host: process.env.PGHOST, port: 55432, user: process.env.PGUSER, database: process.env.PGDATABASE, ssl: false };
const USER = '00000000-0000-4000-8000-0000000000a1';
const results = { name: 'mcp-tool-audit', status: 'running', seed: {}, calls: [], cases: [] };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Loopback only, and paced under the API's per-IP flood guard ─────────────
// preAuthFloodGuard admits 600 requests a minute from one address; the seed
// alone makes several hundred, all from 127.0.0.1.
const realFetch = globalThis.fetch;
let lastRequest = 0;
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url);
  if (url.hostname !== '127.0.0.1') throw new Error(`network is disabled in the MCP audit (${url.host})`);
  const wait = lastRequest + 110 - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequest = Date.now();
  return realFetch(input, init);
};

const db = new pg.Client(config);
await db.connect();
let server;
let toolPool;
let conn;
try {
  const { migrateUp } = await import('../../../packages/db/src/migrate.ts');
  const migrations = new pg.Pool({ ...config, max: 1 });
  try { await migrateUp(migrations); } finally { await migrations.end(); }

  // ── Catalog and user ──────────────────────────────────────────────────────
  const { FRAMES } = await import('../../../packages/sim/src/cards/frames-all.ts');
  const { POOL_DATA } = await import('../../../packages/sim/src/meta/data.ts');
  const catalog = await seedCatalog(db, FRAMES);
  await db.query('INSERT INTO app_user (id, username) VALUES ($1, $2)', [USER, 'mcp-audit']);
  await db.query('INSERT INTO user_settings (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [USER]);
  results.seed.catalog = { cards: catalog.cards, sets: catalog.sets, variants: catalog.variants, prices: catalog.prices };

  // ── The real API (self-host mode: the single local user) on loopback ──────
  const { createApp } = await import('../../api/src/index.ts');
  const app = createApp();
  server = await new Promise((resolveServer, reject) => {
    const listening = app.listen(0, '127.0.0.1', () => resolveServer(listening));
    listening.once('error', reject);
  });
  const base = `http://127.0.0.1:${server.address().port}/deckpal/api`;

  // ── The real MCP server, as a client sees it ──────────────────────────────
  const { makeApi } = await import('@deckpal/agent-tools');
  const { connectInMemory } = await import('../src/audit/connect.ts');
  const { measureSurface } = await import('../src/audit/surface.ts');
  toolPool = new pg.Pool({ ...config, max: 2 });
  const ctx = { db: toolPool, api: makeApi(base), userId: USER };
  conn = await connectInMemory(ctx);

  async function call(name, args = {}) {
    const started = Date.now();
    const reply = await conn.request('tools/call', { name, arguments: args });
    if (reply.error) return { text: `JSON-RPC error ${reply.error.code}: ${reply.error.message}`, isError: true, ms: Date.now() - started };
    const text = (reply.result.content ?? []).map((c) => c.text ?? '').join('\n');
    return { text, isError: reply.result.isError === true, ms: Date.now() - started };
  }
  async function write(name, args) {
    const r = await call(name, { ...args, dry_run: false });
    assert.equal(r.isError, false, `${name} failed while seeding: ${r.text.slice(0, 800)}`);
    return r;
  }

  // Collection: every card in the first four meta decks, then a broad spread,
  // in three batches (one at the 250-item cap, so mutation_history and revert
  // have a full-size operation to show).
  const owned = new Map();
  for (const deck of POOL_DATA.decks.slice(0, 4)) for (const [id, q] of deck.list) owned.set(id, Math.max(owned.get(id) ?? 0, q));
  const allIds = Object.keys(FRAMES).sort();
  for (const id of allIds) if (owned.size < 640 && unit(id + ':own') < 0.25) owned.set(id, 1 + Math.floor(unit(id + ':qty') * 3));
  const ownedItems = [...owned].map(([card_id, delta]) => ({ card_id, delta }));
  const batches = [ownedItems.slice(0, 250), ownedItems.slice(250, 500), ownedItems.slice(500)];
  let bigBatchId = null;
  for (const [i, items] of batches.entries()) {
    const r = await write('log_cards', { items, note: `audit seed batch ${i + 1}` });
    bigBatchId ??= /batch[ _]?(?:id)?[:= ]+"?([0-9a-f-]{36})/i.exec(r.text)?.[1] ?? null;
  }
  const collectionRows = Number((await db.query('SELECT count(*) AS n FROM collection_item WHERE user_id = $1 AND quantity > 0', [USER])).rows[0].n);
  assert.equal(collectionRows, owned.size, 'log_cards dry_run:false must land every item');
  if (!bigBatchId) {
    bigBatchId = (await db.query(`SELECT id FROM mutation_batch WHERE user_id = $1 AND tool = 'collection.batch' ORDER BY started_at LIMIT 1`, [USER])).rows[0]?.id;
  }
  assert.ok(bigBatchId, 'the first log_cards batch is recorded in mutation_history');

  // Decks: the twelve meta lists, then variants of them, thirty in all.
  const metaNames = [];
  for (const deck of POOL_DATA.decks) {
    const name = `${deck.name} (${deck.id})`;
    metaNames.push(name);
    await write('save_deck', { mode: 'create', name, format: 'standard', cards: deck.list.map(([card_id, quantity]) => ({ card_id, quantity })) });
  }
  for (let i = 0; metaNames.length < 30; i++) {
    const deck = POOL_DATA.decks[i % POOL_DATA.decks.length];
    const name = `${deck.name} testing ${Math.floor(i / POOL_DATA.decks.length) + 2}`;
    metaNames.push(name);
    await write('save_deck', { mode: 'create', name, format: 'standard', cards: deck.list.map(([card_id, quantity]) => ({ card_id, quantity })) });
  }

  // One deck played seriously: six versions, 120 battle logs, a full guide.
  const main = metaNames[0];
  const mainDeck = POOL_DATA.decks[0];
  const logs = liveLogs(REPO);
  assert.ok(logs.length >= 10, 'the repo carries at least ten real Live logs');
  let logCount = 0;
  for (let version = 1; version <= 6; version++) {
    for (let g = 0; g < 20; g++, logCount++) {
      if (g % 5 === 4) {
        await write('add_battle_log', {
          deck_id: main, origin: 'in_person', result: g % 2 ? 'win' : 'loss',
          opponent_archetype: POOL_DATA.decks[1 + (logCount % 6)].id,
          notes: 'Locals round — opened slow, stabilised on turn three, lost the prize race by one. '.repeat(3),
          review: review(logCount),
        });
      } else {
        await write('add_battle_log', {
          deck_id: main, log: asOwner(logs[logCount % logs.length].text, logCount), player_name: OWNER_NAME,
          ...(g % 3 === 0 ? { review: review(logCount) } : {}),
        });
      }
    }
    if (version < 6) {
      // Swap one card's count so the next game lands on a new version.
      const list = mainDeck.list.map(([card_id, quantity], k) => ({ card_id, quantity: k === version ? Math.max(1, quantity - 1) : quantity }));
      const extra = list.find((c) => c.quantity >= 1 && c !== list[version]);
      extra.quantity += mainDeck.list[version][1] - list[version].quantity;
      await write('save_deck', { mode: 'edit', deck_id: main, cards: list, version_note: `v${version + 1}: tuned after ${20 * version} games` });
    }
  }
  await call('deck_strategy', { deck_id: main, markdown: strategyGuide(main) });
  const logRows = Number((await db.query('SELECT count(*) AS n FROM battle_log WHERE user_id = $1', [USER])).rows[0].n);
  assert.equal(logRows, logCount, 'add_battle_log dry_run:false must attach every log');
  const firstLogId = Number((await db.query('SELECT min(id) AS id FROM battle_log WHERE user_id = $1 AND raw_log IS NOT NULL', [USER])).rows[0].id);

  // Lists: a static trade binder of 300 cards, and a master-set list.
  const staticCards = allIds.filter((id) => unit(id + ':trade') < 0.12).slice(0, 300).map((card_id) => ({ card_id }));
  await write('edit_list', { mode: 'create', name: 'Trade binder', kind: 'static', add_cards: staticCards });
  await write('edit_list', { mode: 'create', name: 'sv08 master set', kind: 'dynamic' });
  await write('edit_list', { mode: 'edit', list_id: 'sv08 master set', add_missing: { set_id: 'sv08', goal: 'master' } });
  const listItems = Number((await db.query('SELECT count(*) AS n FROM list_item WHERE user_id = $1', [USER])).rows[0].n);

  // card_price_history needs a series; one card, its printings, 120 days.
  const historyCard = mainDeck.list.find(([id]) => FRAMES[id]?.category === 'Pokemon')[0];
  const observations = await seedPriceHistory(db, catalog.cardIdOf.get(historyCard));
  results.seed.user = { collectionRows, decks: metaNames.length, battleLogs: logRows, listItems, observations };
  console.log('seeded', JSON.stringify(results.seed));

  // ── Measure ───────────────────────────────────────────────────────────────
  const surface = await measureSurface();
  results.surface = { tools: surface.rows.length, listChars: surface.listChars, instructionsChars: surface.instructionsChars, tokens: surface.tokens };

  const firstSet = 'sv08';
  const measure = async (label, name, args, kind = 'default') => {
    const r = await call(name, args);
    const row = { label, tool: name, args, kind, chars: r.text.length, tokens: Math.ceil(r.text.length / 4), isError: r.isError, ms: r.ms };
    if (r.isError) row.error = r.text.slice(0, 300);
    results.calls.push(row);
    return r;
  };
  await measure('health', 'health', {});
  await measure('collection_summary', 'collection_summary', {});
  await measure('collection_summary top_n 25', 'collection_summary', { top_n: 25 }, 'max');
  await measure('collection_log', 'collection_log', {});
  await measure('collection_log limit 200', 'collection_log', { limit: 200 }, 'max');
  await measure('collection_value', 'collection_value', {});
  await measure('search_cards "pikachu"', 'search_cards', { query: 'pikachu' });
  await measure('search_cards category Pokemon (broad)', 'search_cards', { category: 'Pokemon' });
  await measure('search_cards category Pokemon page_size 200', 'search_cards', { category: 'Pokemon', page_size: 200 }, 'max');
  await measure('search_cards text ["energy"]', 'search_cards', { text: ['energy'] });
  await measure('get_card', 'get_card', { card_id: historyCard });
  await measure('set_progress overview', 'set_progress', {});
  await measure('set_progress all_sets', 'set_progress', { all_sets: true });
  await measure(`set_progress ${firstSet}`, 'set_progress', { set_id: firstSet });
  await measure(`set_progress ${firstSet} page_size 200`, 'set_progress', { set_id: firstSet, goal: 'master', page_size: 200 }, 'max');
  await measure('card_price_history', 'card_price_history', { card_id: historyCard });
  await measure('card_price_history 2y', 'card_price_history', { card_id: historyCard, range: '2y' }, 'max');
  await measure('decks (index of 30)', 'decks', {});
  await measure('decks one deck', 'decks', { deck_id: main });
  for (const include of ['cards', 'validate', 'pricing', 'testhand', 'strategy']) {
    await measure(`decks include ${include}`, 'decks', { deck_id: main, include: [include] }, include === 'strategy' ? 'explicit' : 'default');
  }
  await measure('decks include all', 'decks', { deck_id: main, include: ['cards', 'validate', 'pricing', 'testhand', 'strategy'] }, 'max');
  await measure('check_deck (60 cards)', 'check_deck', { cards: mainDeck.list.map(([card_id, quantity]) => ({ card_id, quantity })) });
  await measure('deck_odds', 'deck_odds', { deck_id: main });
  await measure('battle_logs list', 'battle_logs', { deck_id: main });
  await measure('battle_logs list page_size 200', 'battle_logs', { deck_id: main, page_size: 200 }, 'max');
  await measure('battle_logs list version 3', 'battle_logs', { deck_id: main, version: 3 });
  await measure('battle_logs list include_raw', 'battle_logs', { deck_id: main, include_raw: true }, 'explicit');
  await measure('battle_logs list include_raw page_size 200', 'battle_logs', { deck_id: main, include_raw: true, page_size: 200 }, 'max');
  await measure('battle_logs one log', 'battle_logs', { deck_id: main, log_id: firstLogId });
  await measure('battle_logs one log include_raw', 'battle_logs', { deck_id: main, log_id: firstLogId, include_raw: true }, 'explicit');
  await measure('battle_digest one log', 'battle_digest', { deck_id: main, log_id: firstLogId });
  await measure('deck_history timeline', 'deck_history', { deck_id: main });
  await measure('deck_history version 3', 'deck_history', { deck_id: main, version: 3 });
  await measure('deck_history revert_to 1 (dry run)', 'deck_history', { deck_id: main, revert_to: 1 });
  await measure('deck_strategy read', 'deck_strategy', { deck_id: main }, 'explicit');
  await measure('lists index', 'lists', {});
  await measure('lists Trade binder (300 items)', 'lists', { list_id: 'Trade binder' });
  await measure('lists sv08 master set', 'lists', { list_id: 'sv08 master set' });
  await measure('mutation_history', 'mutation_history', {});
  await measure('mutation_history limit 200', 'mutation_history', { limit: 200 }, 'max');
  await measure('mutation_history one 250-item batch', 'mutation_history', { batch_id: bigBatchId });
  await measure('revert one 250-item batch (dry run)', 'revert', { batch_id: bigBatchId });
  await measure(`set_cart set ${firstSet}`, 'set_cart', { set_id: firstSet });
  await measure('set_cart list', 'set_cart', { list_id: 'Trade binder' });
  await measure('add_battle_log preview', 'add_battle_log', { deck_id: main, log: asOwner(logs[0].text, 0), player_name: OWNER_NAME });
  await measure('save_deck edit preview', 'save_deck', { mode: 'edit', deck_id: main, cards: mainDeck.list.map(([card_id, quantity]) => ({ card_id, quantity })) });
  await measure('simulate_battles', 'simulate_battles', { deck_id: main }, 'explicit');

  const width = Math.max(...results.calls.map((c) => c.label.length));
  console.log(`\n${'call'.padEnd(width)}  kind      chars  ~tokens  ms`);
  for (const c of results.calls) {
    console.log(`${c.label.padEnd(width)}  ${c.kind.padEnd(8)} ${String(c.chars).padStart(7)}  ${String(c.tokens).padStart(7)}  ${String(c.ms).padStart(5)}${c.isError ? `  ERROR: ${c.error}` : ''}`);
  }
  const errors = results.calls.filter((c) => c.isError);
  assert.deepEqual(errors.map((c) => c.label), [], 'every measured call must succeed');
  results.cases.push({ name: 'every measured MCP call succeeds against the seeded database', status: 'passed' });
  results.status = 'passed';
} catch (error) {
  results.status = 'failed';
  results.error = error.stack ?? String(error);
  console.error(error);
  process.exitCode = 1;
} finally {
  await conn?.close().catch(() => {});
  await new Promise((r) => (server ? server.close(() => r()) : r()));
  await toolPool?.end().catch(() => {});
  await db.end().catch(() => {});
  try {
    const { closePool } = await import('../../api/src/db.ts');
    await closePool();
  } catch { /* the API was never imported */ }
  const out = process.env.DECKPAL_TEST_RESULT;
  if (out) writeFileSync(out, JSON.stringify(results, null, 2) + '\n');
  if (process.env.DECKPAL_MCP_AUDIT_OUT) writeFileSync(process.env.DECKPAL_MCP_AUDIT_OUT, JSON.stringify(results, null, 2) + '\n');
}
