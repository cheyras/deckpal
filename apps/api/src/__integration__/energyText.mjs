/**
 * `canonicalEnergyTextSql` (the SQL twin of `canonicalEnergyText`, `@deckpal/db/energyText`) on a
 * real PostgreSQL. Invoked only by scripts/test-db-integration.mjs.
 *
 * The pure test (packages/agent-tools/src/__tests__/energyText.test.ts) parses the SQL and replays
 * it in JavaScript, which proves the two are built from the same table and patterns but not that
 * Postgres' ARE regex engine and `replace()` read them the way JavaScript does. This runs
 * `SELECT <canonicalEnergyTextSql($1)>` over the same kinds of sample and compares each result with
 * the TS function, so CI checks the real dialect. No schema or fixture is needed: the fold is a pure
 * expression over a text parameter.
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
assert.equal(process.env.PGDATABASE, 'deckpal_ci_energytext');
assert.equal(dirname(process.env.DECKPAL_TEST_RESULT), root);
assert.equal(existsSync(join(REPO, '.env')), false);
assert.equal(process.env.DATABASE_URL, undefined);

const config = { host: process.env.PGHOST, port: 55432, user: process.env.PGUSER, database: process.env.PGDATABASE, ssl: false };
const results = { name: 'energy-text-sql', status: 'running', cases: [] };
async function test(name, fn) {
  await fn();
  results.cases.push({ name, status: 'passed' });
  console.log('PASS ' + name);
}

const SAMPLES = [
  'Once during your turn, you may discard a Basic {R} Energy card from your hand.',
  'Once during your turn, you may discard a Basic Fire Energy card from your hand.',
  'Attach a Basic <span class="energy-symbol Lightning" title="Lightning">Lightning</span> Energy card.',
  'Attach a Basic <span class="energy-symbol Fire" title="Fire"></span> Energy card.',
  'Attach a Basic <span class="energy-symbol Water" title="Water"></span> Energy card.',
  '<span class="energy-symbol Fire">R</span> and <span class="energy-symbol Plasma">Plasma</span>',
  'This attack does 30 more damage for each {C} in your opponent\'s Active Pokémon\'s Retreat Cost.',
  'Search your deck for up to 2 {G}, {W}, {L}, {P}, {F}, {D}, {M}, {N} or {Y} Energy cards.',
  'Heal 30 damage. <em>(You can\'t use more than 1 GX attack in a game.)</em>',
  '<b>Bold</b> and <br/>break',
  'If this Pokémon has HP < 50 and > 10 remaining, heal it.',
  'Damage <= 30 or 1 < 2 {R}',
  'Flip {X} coins. {RR}',
  'No symbols at all.',
  '',
];

const db = new pg.Client(config);
await db.connect();
try {
  const { canonicalEnergyText, canonicalEnergyTextSql } = await import('../../../../packages/db/src/energyText.ts');
  const sql = `SELECT ${canonicalEnergyTextSql('$1::text')} AS folded`;

  await test('real PostgreSQL folds every sample exactly as canonicalEnergyText does', async () => {
    for (const s of SAMPLES) {
      const { rows } = await db.query(sql, [s]);
      assert.equal(rows[0].folded, canonicalEnergyText(s), s);
    }
  });

  await test('NULL stays NULL', async () => {
    const { rows } = await db.query(sql, [null]);
    assert.equal(rows[0].folded, null);
  });

  await test('KNOWN DIFFERENCE: lower-case {r} is folded by TS only', async () => {
    const s = 'Discard a Basic {r} Energy card.';
    const { rows } = await db.query(sql, [s]);
    assert.equal(rows[0].folded, s);
    assert.equal(canonicalEnergyText(s), 'Discard a Basic Fire Energy card.');
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
