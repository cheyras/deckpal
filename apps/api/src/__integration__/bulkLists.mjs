/**
 * Bulk list tooling (Phase 4, 2026-10-14) against a real PostgreSQL 16 with every shipped migration
 * applied. Invoked only by scripts/test-db-integration.mjs.
 *
 * The job it exists for, from the owner's Haiku test: "make a list of my holo Pikachus". search_cards
 * showed no finishes and one page, so the model checked ~150 cards one call at a time, added normal
 * printings of cards that have a holo one, and missed 19. Now:
 *   - search_cards shows each card's finishes and filters by finish (SQL: only a database proves it);
 *   - edit_list add_search adds every card the same search matches, choosing each card's printing
 *     by finish in one query, skipping cards already in the list.
 *
 * The list API is stubbed (its bulk endpoint has its own suites): what this proves is which variant
 * ids the tool sends, chosen by real SQL over real rows.
 *
 * Fixture, set "sp" Sparks:
 *   pk-1 Pikachu     normal, reverse               → reverse (no holo)
 *   pk-2 Pikachu ex  holo                          → holo
 *   pk-3 Pikachu     normal                        → never: neither finish
 *   pk-4 Pikachu     normal (primary), holo        → holo; in the list as NORMAL (item i-4n)
 *   pk-5 Pikachu V   holo-cosmos (sort 0), holo (primary) → the plain holo, not the cosmos foil
 *   pk-6 Pikachu     reverse, holo                 → in the list already (item i-6): skipped
 *   rc-1 Raichu      holo                          → never: not a Pikachu
 * and 501 "Bulkmon" cards for the limit.
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
assert.equal(process.env.PGDATABASE, 'deckpal_ci_bulklists');
assert.equal(dirname(process.env.DECKPAL_TEST_RESULT), root);
assert.equal(existsSync(join(REPO, '.env')), false);
assert.equal(process.env.DATABASE_URL, undefined);

const config = { host: process.env.PGHOST, port: 55432, user: process.env.PGUSER, database: process.env.PGDATABASE, ssl: false };
const results = { name: 'bulk-lists', status: 'running', cases: [] };
async function test(name, fn) {
  await fn();
  results.cases.push({ name, status: 'passed' });
  console.log('PASS ' + name);
}

const db = new pg.Client(config);
await db.connect();
let pool;
try {
  const { migrateUp } = await import('../../../../packages/db/src/migrate.ts');
  const migrator = new pg.Pool({ ...config, max: 1 });
  try { await migrateUp(migrator); } finally { await migrator.end(); }
  const { catalogTools } = await import('../../../../packages/agent-tools/src/tools/catalog.ts');
  const { listTools } = await import('../../../../packages/agent-tools/src/tools/lists.ts');
  const searchCards = catalogTools.find((t) => t.name === 'search_cards');
  const editList = listTools.find((t) => t.name === 'edit_list');
  assert.ok(searchCards && editList, 'search_cards and edit_list are registered');

  // ── fixtures ──────────────────────────────────────────────────────────────
  const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
  const userId = (await one(`SELECT id FROM app_user WHERE username = 'cheyras'`)).id;
  const series = (await one(
    `INSERT INTO series (catalogue_code, tcgdex_id, slug, name) VALUES ('en','sp','sparks','Sparks') RETURNING id`)).id;
  const set = (await one(
    `INSERT INTO card_set (series_id, tcgdex_id, slug, name, released_on, card_count_official, card_count_total)
     VALUES ($1,'sp','sp','Sparks','2026-01-30',10,10) RETURNING id`, [series])).id;
  for (const [code, finish] of [['normal', 'normal'], ['reverse', 'reverse'], ['holo', 'holo'], ['holo-cosmos', 'holo']]) {
    await db.query(
      `INSERT INTO variant_kind (code, display_name, finish, size, tier_derived, tier_rule_version)
       VALUES ($1,$1,$2,'standard','standard',3) ON CONFLICT DO NOTHING`, [code, finish]);
  }
  let n = 0;
  /** One card and its printings (in sort order); `primary` is the index of the primary one. */
  const mkCard = async (tcgdexId, name, kinds, primary = 0) => {
    n++;
    const card = (await one(
      `INSERT INTO card (set_id, tcgdex_id, local_id, local_id_numeric, number_sort, name, name_normalized, category, rarity)
       VALUES ($1,$2,$3,$4,$3,$5,lower($5),'Pokemon','Common') RETURNING id`,
      [set, tcgdexId, String(n).padStart(3, '0'), n, name])).id;
    const ids = {};
    for (const [i, kind] of kinds.entries()) {
      ids[kind] = Number((await one(
        `INSERT INTO card_variant (card_id, variant_kind_code, sort_order, is_primary) VALUES ($1,$2,$3,$4) RETURNING id`,
        [card, kind, i, i === primary])).id);
    }
    return ids;
  };
  const pk1 = await mkCard('pk-1', 'Pikachu', ['normal', 'reverse']);
  const pk2 = await mkCard('pk-2', 'Pikachu ex', ['holo']);
  await mkCard('pk-3', 'Pikachu', ['normal']);
  const pk4 = await mkCard('pk-4', 'Pikachu', ['normal', 'holo']);
  const pk5 = await mkCard('pk-5', 'Pikachu V', ['holo-cosmos', 'holo'], 1);
  await mkCard('pk-6', 'Pikachu', ['reverse', 'holo']);
  await mkCard('rc-1', 'Raichu', ['holo']);
  // 501 cards for the limit, in one statement.
  await db.query(
    `WITH c AS (
       INSERT INTO card (set_id, tcgdex_id, local_id, local_id_numeric, number_sort, name, name_normalized, category, rarity)
       SELECT $1, 'bm-' || g, 'B' || g, NULL, 'B' || lpad(g::text, 4, '0'), 'Bulkmon', 'bulkmon', 'Pokemon', 'Common'
         FROM generate_series(1, 501) g RETURNING id)
     INSERT INTO card_variant (card_id, variant_kind_code, sort_order, is_primary) SELECT id, 'normal', 0, true FROM c`,
    [set]);

  // ── the list API, stubbed: one static list "Holo Pikachus" holding pk-6 and pk-4 (normal) ──
  const LIST = { id: '11111111-1111-4111-8111-111111111111', kind: 'static', name: 'Holo Pikachus', itemCount: 2, progress: null, marketValueUsd: null, updatedAt: '2026-10-14T00:00:00Z' };
  const ITEMS = [
    { itemId: 'i-6', position: 0, kind: 'card', cardId: 'pk-6', name: 'Pikachu', staticQuantity: 1 },
    { itemId: 'i-4n', position: 1, kind: 'card', cardId: 'pk-4', name: 'Pikachu', staticQuantity: 1 },
  ];
  let calls = [];
  const api = {
    async get(path) {
      calls.push(['GET', path]);
      if (path === '/lists' || path.startsWith('/lists?')) return { lists: [LIST] };
      if (path === `/lists/${LIST.id}` || path === '/lists/new-list') return { list: LIST, items: ITEMS };
      throw new Error(`unexpected GET ${path}`);
    },
    async send(method, path, body) {
      calls.push([method, path, body]);
      if (method === 'POST' && path === '/lists') return { list: { ...LIST, id: 'new-list', name: body.name, itemCount: 0 } };
      if (method === 'POST' && path.endsWith('/items/bulk')) return { added: body.items.length, alreadyPresent: 0, unresolved: [], batchId: 'b-1' };
      if (method === 'DELETE') return {};
      throw new Error(`unexpected ${method} ${path}`);
    },
  };
  pool = new pg.Pool({ ...config, max: 1 });
  const ctx = { db: pool, api, userId };
  const search = (args) => searchCards.handler({ page: 1, page_size: 50, owned_only: false, exclude_owned: false, text_same_attack: true, ...args }, ctx);
  const edit = (args) => editList.handler({ kind: 'dynamic', restore: false, dry_run: true, ...args }, ctx);
  const rowsOf = (text) => text.split('\n').filter((l) => / \| /.test(l));

  await test('search_cards: every row says which finishes the card is printed in', async () => {
    const r = await search({ query: 'pikachu' });
    assert.equal(r.isError, undefined, r.text);
    const byId = Object.fromEntries(rowsOf(r.text).map((l) => [l.split(' | ')[1], l]));
    assert.match(byId['pk-1'], /finishes normal\/reverse/);
    assert.match(byId['pk-2'], /finishes holo/);
    assert.match(byId['pk-3'], /finishes normal(?!\/)/);
    assert.match(byId['pk-4'], /finishes normal\/holo/);
    assert.match(byId['pk-6'], /finishes holo\/reverse/, 'in finish order, not printing order');
  });

  await test("search_cards finish: only cards printed in one of the finishes, every page's worth counted", async () => {
    const r = await search({ query: 'pikachu', finish: ['holo'] });
    assert.equal(r.isError, undefined, r.text);
    assert.deepEqual(rowsOf(r.text).map((l) => l.split(' | ')[1]).sort(), ['pk-2', 'pk-4', 'pk-5', 'pk-6']);
    assert.equal(r.structured.total, 4);
    const either = await search({ query: 'pikachu', finish: ['holo', 'reverse'] });
    assert.equal(either.structured.total, 5, 'pk-1 joins on reverse; pk-3 has neither');
  });

  await test('search_cards: a finish that empties the search is named as the filter that did it', async () => {
    const r = await search({ query: 'pikachu', finish: ['lenticular'] });
    assert.match(r.text, /^No cards match: name contains 'pikachu' AND finish lenticular\./);
    assert.match(r.text, /6 match without finish lenticular — that filter is what emptied it/);
  });

  await test('add_search dry run: each card in the first finish it has, the plain holo over a cosmos foil, listed cards skipped', async () => {
    calls = [];
    const r = await edit({ mode: 'edit', list_id: 'Holo Pikachus', add_search: { query: 'pikachu', finish: ['holo', 'reverse'] } });
    assert.equal(r.isError, undefined, r.text);
    assert.match(r.text, /add 3 card\(s\) the search finds \(name contains 'pikachu' AND finish holo\/reverse\): 2 holo, 1 reverse; 2 already in the list, skipped/);
    assert.match(r.text, /Pikachu \(pk-1, reverse\)/);
    assert.match(r.text, /Pikachu ex \(pk-2, holo\)/);
    assert.match(r.text, /Pikachu V \(pk-5, holo\)/, 'the primary holo, not holo-cosmos');
    assert.doesNotMatch(r.text, /pk-3|pk-6|rc-1|holo-cosmos/);
    assert.ok(!calls.some(([m]) => m !== 'GET'), 'a dry run writes nothing');
  });

  await test('add_search executes as one bulk write of exactly the chosen printings', async () => {
    calls = [];
    const r = await edit({ mode: 'edit', list_id: 'Holo Pikachus', add_search: { query: 'pikachu', finish: ['holo', 'reverse'] }, dry_run: false });
    assert.equal(r.isError, undefined, r.text);
    const bulk = calls.filter(([m, p]) => m === 'POST' && p.endsWith('/items/bulk'));
    assert.equal(bulk.length, 1, 'one call, whatever the count');
    assert.deepEqual(
      bulk[0][2].items.map((i) => i.cardVariantId).sort((a, b) => a - b),
      [pk1.reverse, pk2.holo, pk5.holo].sort((a, b) => a - b),
    );
    assert.ok(bulk[0][2].items.every((i) => i.quantity === 1));
  });

  await test("removing a card's item in the same call lets add_search bring it back in the new finish", async () => {
    calls = [];
    const r = await edit({ mode: 'edit', list_id: 'Holo Pikachus', add_search: { query: 'pikachu', finish: ['holo'] }, remove_item_ids: ['i-4n'], dry_run: false });
    assert.equal(r.isError, undefined, r.text);
    const bulk = calls.find(([m, p]) => m === 'POST' && p.endsWith('/items/bulk'));
    assert.ok(bulk[2].items.some((i) => i.cardVariantId === pk4.holo), 'pk-4 back as holo');
    assert.ok(calls.some(([m, p]) => m === 'DELETE' && p.endsWith('/items/i-4n')), 'and the normal one removed');
  });

  await test('add_search fills a list in the call that creates it', async () => {
    calls = [];
    const r = await edit({ mode: 'create', name: 'All my Pikachu holos', kind: 'static', add_search: { query: 'pikachu', finish: ['holo'] }, dry_run: false });
    assert.equal(r.isError, undefined, r.text);
    assert.ok(calls.some(([m, p]) => m === 'POST' && p === '/lists'), 'created');
    const bulk = calls.find(([m, p]) => m === 'POST' && p.endsWith('/items/bulk'));
    assert.equal(bulk[1], '/lists/new-list/items/bulk');
    assert.equal(bulk[2].items.length, 4, 'a new list skips nothing');
  });

  await test('add_search over the limit says how many and adds none; no filter at all is refused', async () => {
    calls = [];
    const big = await edit({ mode: 'edit', list_id: 'Holo Pikachus', add_search: { query: 'bulkmon' }, dry_run: false });
    assert.equal(big.isError, true);
    assert.match(big.text, /add_search would add 501 cards \(name contains 'bulkmon'\); one call adds at most 500/);
    assert.ok(!calls.some(([m]) => m !== 'GET'), 'nothing written');
    const none = await edit({ mode: 'edit', list_id: 'Holo Pikachus', add_search: {} });
    assert.equal(none.isError, true);
    assert.match(none.text, /needs at least one filter/);
  });

  results.status = 'passed';
} catch (err) {
  results.status = 'failed';
  results.error = String(err?.stack ?? err);
  console.error(err);
  process.exitCode = 1;
} finally {
  writeFileSync(process.env.DECKPAL_TEST_RESULT, JSON.stringify(results, null, 2));
  await pool?.end();
  await db.end();
}
