/**
 * Invoked only by scripts/test-db-integration.mjs in a sanitized fresh process.
 * Real PostgreSQL for two deck-builder contracts that a fake pool cannot prove:
 *
 *   1. A revert always lands as a NEW version, so the list it replaces survives
 *      even when it was never played (the History tab's "nothing is lost").
 *   2. The add-cards "legal only" filter (`formatPoolSql`, run by the real
 *      `/search` route) admits exactly the cards the deck validator's pool rule
 *      admits, on the same rows, with the same reprint oracle.
 *
 * The schema is a focused fixture (decks-fixture.sql), not the production
 * migrations; it does not test auth or RLS.
 */
import assert from 'node:assert/strict';
import { lstatSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../../..');
const root = process.env.DECKPAL_TEST_ROOT;
assert.ok(root && /^\/tmp\/deckpal-db-[^/]+$/.test(root), 'This child requires a runner-owned disposable root.');
assert.equal(realpathSync(root), root);
assert.equal(readFileSync(join(root, '.deckpal-ci-owner'), 'utf8'), process.env.DECKPAL_TEST_MARKER);
assert.equal(process.env.PGHOST, join(root, 'socket'));
assert.equal(process.env.PGPORT, '55432');
assert.equal(process.env.PGDATABASE, 'deckpal_ci_decks_test');
assert.equal(process.env.PGUSER, 'deckpal_ci_fixture');
assert.equal(process.env.PGSSLMODE, 'disable');
assert.equal(process.env.DATABASE_URL, undefined);
assert.ok(!Object.keys(process.env).some((key) => /^SUPABASE/.test(key)), 'Supabase environment must not reach integration imports.');
assert.equal(dirname(process.env.DECKPAL_TEST_RESULT), root);
try {
  lstatSync(join(REPO, '.env'));
  throw new Error('Refusing integration imports: repo-root .env exists; its contents were not read.');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const { default: pg } = await import('pg');
const client = new pg.Client({
  host: join(root, 'socket'), port: 55432,
  user: 'deckpal_ci_fixture', database: 'deckpal_ci_decks_test',
  password: '', ssl: false, connectionTimeoutMillis: 5000,
});
let server;
let pool;
const evidence = { status: 'running', cases: [] };
try {
  await client.connect();
  const identity = (await client.query(`
    SELECT current_database() AS database, current_user AS role, inet_server_addr() AS tcp_address,
           current_setting('data_directory') AS data_directory,
           (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS superuser`)).rows[0];
  assert.equal(identity.database, 'deckpal_ci_decks_test');
  assert.equal(identity.role, 'deckpal_ci_fixture');
  assert.equal(identity.superuser, false);
  assert.equal(identity.tcp_address, null);
  assert.equal(realpathSync(identity.data_directory), join(root, 'data'));
  await client.query(readFileSync(join(HERE, 'decks-fixture.sql'), 'utf8'));

  const { recordDeckChange, recordStrategyChange, restoreSnapshot } = await import('../deck/versions.ts');
  const { buildReprintOracle, formatPoolSql } = await import('../deck/db.ts');
  const { validateDeck, poolRule } = await import('../deck/formats.ts');
  const { formatConfig } = await import('../deck/data.ts');
  const { normalizeName } = await import('../deck/names.ts');

  // ── 1. Revert keeps the list it replaces ──────────────────────────────────
  const userId = '00000000-0000-4000-8000-000000000001';
  const deckId = '00000000-0000-4000-8000-0000000000d1';
  const tx = async (fn) => {
    await client.query('BEGIN');
    try { const out = await fn(); await client.query('COMMIT'); return out; }
    catch (error) { await client.query('ROLLBACK'); throw error; }
  };
  const setCard = (cardId, quantity) => client.query(
    `INSERT INTO deck_card (deck_id, card_id, card_variant_id, user_id, quantity) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (deck_id, card_variant_id) DO UPDATE SET quantity = $5`,
    [deckId, cardId, 100 + cardId, userId, quantity]);
  const versions = async () => (await client.query(
    `SELECT version, cards, strategy_md, note FROM deck_version WHERE deck_id = $1 ORDER BY version`, [deckId])).rows;
  const live = async () => (await client.query(
    `SELECT card_id::int AS id, quantity FROM deck_card WHERE deck_id = $1 ORDER BY card_id`, [deckId])).rows;

  await client.query(`INSERT INTO deck (id, user_id, format_code) VALUES ($1, $2, 'standard')`, [deckId, userId]);
  await tx(async () => { await setCard(1, 2); await recordDeckChange(client, deckId, { source: 'test-suite' }); });
  await client.query(`INSERT INTO battle_log (deck_id, deck_version) VALUES ($1, 1)`, [deckId]);
  // A played v1, then an edit: v2 is the unplayed working list.
  const bumped = await tx(async () => {
    await setCard(4, 1);
    return recordDeckChange(client, deckId, { source: 'test-suite', note: 'trying Zamazenta' });
  });
  assert.deepEqual(bumped, { version: 2, bumped: true });
  await tx(() => recordStrategyChange(client, deckId, '# v2 guide'));
  // Stepper noise on the unplayed v2 still amends in place: the rule a revert is the exception to.
  const amended = await tx(async () => { await setCard(4, 2); return recordDeckChange(client, deckId, { source: 'web' }); });
  assert.deepEqual(amended, { version: 2, bumped: false });

  const [v1] = await versions();
  const restored = await tx(() => restoreSnapshot(client, deckId, userId,
    { cards: v1.cards, strategyMd: v1.strategy_md },
    { includeStrategy: true, source: 'web', note: 'Reverted to v1' }));
  assert.deepEqual(restored, { version: 3, bumped: true, skippedCards: [] });
  const after = await versions();
  assert.deepEqual(after.map((v) => v.version), [1, 2, 3], 'the revert created v3; nothing was amended');
  const v2 = after[1];
  assert.deepEqual(v2.cards.map((c) => [c.cardId, c.quantity]), [[1, 2], [4, 2]], 'v2 still holds the unplayed list');
  assert.equal(v2.strategy_md, '# v2 guide', 'and its guide');
  assert.equal(v2.note, 'trying Zamazenta', 'and its note');
  assert.deepEqual(after[2].cards.map((c) => [c.cardId, c.quantity]), [[1, 2]]);
  assert.equal(after[2].note, 'Reverted to v1');
  assert.deepEqual(await live(), [{ id: 1, quantity: 2 }], 'the live list is v1 again');
  const deck = (await client.query(`SELECT version, strategy_md FROM deck WHERE id = $1`, [deckId])).rows[0];
  assert.deepEqual(deck, { version: 3, strategy_md: null }, "v1's (empty) guide came back with it");

  // And back again: reverting to v2 restores the list the first revert replaced.
  const back = await tx(() => restoreSnapshot(client, deckId, userId,
    { cards: v2.cards, strategyMd: v2.strategy_md },
    { includeStrategy: true, source: 'web', note: 'Reverted to v2' }));
  assert.equal(back.version, 4);
  assert.deepEqual(await live(), [{ id: 1, quantity: 2 }, { id: 4, quantity: 2 }]);
  evidence.cases.push({
    name: 'revert_always_creates_a_version_and_keeps_the_unplayed_list',
    versions: (await versions()).map((v) => ({ version: v.version, cards: v.cards.length, note: v.note })),
  });

  // ── 2. The pool filter and the validator agree, row for row ───────────────
  const { rows: catalog } = await client.query(
    `SELECT c.id::int, c.tcgdex_id, c.local_id, c.name, c.category, c.energy_type, c.regulation_mark,
            cs.tcgdex_id AS set_tcgdex_id
       FROM card c JOIN card_set cs ON cs.id = c.set_id
      WHERE c.lang = 'en' ORDER BY c.id`);
  const facts = catalog.map((r) => ({
    id: r.id, tcgdexId: r.tcgdex_id, setTcgdexId: r.set_tcgdex_id, localId: r.local_id,
    localIdNumeric: /^\d+$/.test(r.local_id) ? Number(r.local_id) : null,
    name: r.name, normalizedName: normalizeName(r.name), category: r.category,
    stage: r.category === 'Pokemon' ? 'Basic' : null, suffix: null, trainerType: null,
    energyType: r.energy_type, hp: null, retreat: null, regulationMark: r.regulation_mark,
    evolveFrom: null, types: [],
  }));
  const EXPECTED = { standard: [1, 2, 3, 7, 12], expanded: [1, 2, 3, 4, 6, 7, 9, 11, 12], glc: [1, 2, 3, 4, 6, 7, 9, 11, 12] };
  const pools = {};
  for (const format of ['standard', 'expanded', 'glc']) {
    const params = [];
    const predicate = formatPoolSql(format, (value) => { params.push(value); return `$${params.length}`; });
    const inSql = (await client.query(
      `SELECT c.id::int FROM card c JOIN card_set cs ON cs.id = c.set_id WHERE c.lang = 'en' AND ${predicate} ORDER BY c.id`,
      params)).rows.map((r) => r.id);
    const oracle = await buildReprintOracle(client, facts, formatConfig(format).legal_marks);
    const result = validateDeck(
      { formatCode: format, glcType: 'Lightning', entries: facts.map((card) => ({ card, quantity: 1, section: 'pokemon' })) },
      { isInFormatByReprint: oracle },
    );
    const refused = result.violations.filter((v) => v.code === 'NOT_IN_FORMAT');
    const outOfPool = new Set(refused.flatMap((v) => v.card_ids));
    const byValidator = facts.map((f) => f.id).filter((id) => !outOfPool.has(id));
    assert.deepEqual(inSql, byValidator, `${format}: the SQL pool must equal the validator's pool`);
    assert.deepEqual(inSql, EXPECTED[format], `${format}: pool membership`);
    assert.ok(refused.every((v) => v.rule === poolRule(format)), `${format}: one sentence for the rule`);
    pools[format] = inSql;
  }
  assert.equal(formatPoolSql('unlimited', () => '$1'), null);
  evidence.cases.push({ name: 'pool_sql_equals_validator_pool', pools });

  // ── 3. The real /search route pages the filtered pool ─────────────────────
  const { default: express } = await import('express');
  const database = await import('../db.ts');
  pool = database.pool;
  const { searchRouter } = await import('../routes/search.ts');
  const { errorMiddleware } = await import('../http.ts');
  const app = express();
  app.use((req, res, next) => {
    if (req.method !== 'GET') return res.status(405).end();
    req.identityResolution = 'anonymous';
    next();
  });
  app.use('/api/search', searchRouter);
  app.use(errorMiddleware);
  server = await new Promise((resolveServer, reject) => {
    const listening = app.listen(0, '127.0.0.1', () => resolveServer(listening));
    listening.once('error', reject);
  });
  const base = `http://127.0.0.1:${server.address().port}/api/search`;
  const search = async (query) => {
    const response = await fetch(`${base}?${query}`, { signal: AbortSignal.timeout(5000) });
    return { status: response.status, body: await response.json() };
  };
  // The measured bug, in miniature: name order puts an unmarked print first,
  // so a page-one-only filter finds nothing while legal prints exist.
  const unfiltered = await search('q=Pikachu&sort=name&pageSize=1');
  assert.equal(unfiltered.status, 200);
  assert.equal(unfiltered.body.pagination.total, 4);
  assert.equal(unfiltered.body.cards[0].name, "Ash's Pikachu");
  assert.equal(unfiltered.body.cards[0].regulationMark, null);
  assert.equal('legal' in unfiltered.body, false);
  const filtered = await search('q=Pikachu&sort=name&pageSize=1&legal=standard');
  assert.equal(filtered.status, 200);
  assert.equal(filtered.body.pagination.total, 2, 'every legal Pikachu is counted, not just page one');
  assert.equal(filtered.body.pagination.pageCount, 2);
  const second = await search('q=Pikachu&sort=name&pageSize=1&page=2&legal=standard');
  const legalIds = [filtered.body.cards[0].cardId, second.body.cards[0].cardId].sort();
  assert.deepEqual(legalIds, ['sv05-051', 'sv08-057']);
  assert.deepEqual(filtered.body.legal, { format: 'standard', rule: poolRule('standard') });
  assert.equal(filtered.body.query.legal, 'standard');
  const reprint = await search('q=Lost%20Vacuum&legal=standard');
  assert.deepEqual(reprint.body.cards.map((c) => c.cardId).sort(), ['sv08-200', 'swsh12-162'],
    'a G-mark print with a legal English reprint is in the pool');
  const bogus = await search('q=Pikachu&legal=modern');
  assert.equal(bogus.status, 400, 'an unknown format is refused, never silently unfiltered');
  evidence.cases.push({
    name: 'search_route_legal_filter_pages_the_whole_pool',
    unfilteredFirst: unfiltered.body.cards[0].cardId, legalTotal: filtered.body.pagination.total, legalIds,
    rule: filtered.body.legal.rule,
  });

  evidence.status = 'passed';
  writeFileSync(process.env.DECKPAL_TEST_RESULT, JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  if (server) {
    server.closeAllConnections();
    await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  }
  if (pool) await pool.end();
  await client.end();
}
