/**
 * `set_progress` goal 'numbered' against a real PostgreSQL 16 with every shipped migration
 * applied. Invoked only by scripts/test-db-integration.mjs.
 *
 * The goal is SQL: which cards are in the numbered set (`local_id_numeric BETWEEN 1 AND
 * card_count_official`), that owning ANY variant finishes a card, that a card with two printings
 * is one missing row priced at its cheapest, and that a set with no printed total says so. The
 * unit tests in packages/agent-tools stub the database and so can only pin the rendering; this is
 * where those predicates meet real rows, the real resolver and the real schema.
 *
 * Fixture, set me05 "Pitch Black", printed total 3:
 *
 *   001 Alpha    Common                normal+reverse   owns the REVERSE only   in, owned
 *   002 Beta     Uncommon              normal+reverse   $0.50 / $0.25           in, missing (one row, $0.25)
 *   003 Gamma    Rare                  normal           unpriced                in, missing
 *   004 Delta ex Special illustration  holo             $40.00                  OUT (secret rare, above 3)
 *   005 Epsilon  Hyper rare            holo             owned                   OUT (secret rare, owned anyway)
 *   TG01 Zeta    Trainer gallery       holo             $3.00                   OUT (not a plain number)
 *
 * and set nopt "No Printed Total" (card_count_official NULL), where numbered is unavailable.
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
assert.equal(process.env.PGDATABASE, 'deckpal_ci_numbered');
assert.equal(dirname(process.env.DECKPAL_TEST_RESULT), root);
assert.equal(existsSync(join(REPO, '.env')), false);
assert.equal(process.env.DATABASE_URL, undefined);

const config = { host: process.env.PGHOST, port: 55432, user: process.env.PGUSER, database: process.env.PGDATABASE, ssl: false };
const results = { name: 'set-progress-numbered', status: 'running', cases: [] };
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
  const setProgress = catalogTools.find((t) => t.name === 'set_progress');
  assert.ok(setProgress, 'set_progress is registered');

  // ── fixtures ──────────────────────────────────────────────────────────────
  const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
  const userId = (await one(`SELECT id FROM app_user WHERE username = 'cheyras'`)).id;
  const series = (await one(
    `INSERT INTO series (catalogue_code, tcgdex_id, slug, name) VALUES ('en','me','mega-evolution','Mega Evolution') RETURNING id`)).id;
  const mkSet = async (tcgdexId, name, official, total) => (await one(
    `INSERT INTO card_set (series_id, tcgdex_id, slug, name, released_on, card_count_official, card_count_total)
     VALUES ($1,$2,$2,$3,'2026-01-30',$4,$5) RETURNING id`, [series, tcgdexId, name, official, total])).id;
  for (const [code, finish] of [['normal', 'normal'], ['reverse', 'reverse'], ['holo', 'holo']]) {
    await db.query(
      `INSERT INTO variant_kind (code, display_name, finish, size, tier_derived, tier_rule_version)
       VALUES ($1,$1,$2,'standard','standard',3) ON CONFLICT DO NOTHING`, [code, finish]);
  }
  let n = 0;
  /** One card and its printings; returns { kind: variantId }. */
  const mkCard = async (setId, localId, name, rarity, kinds) => {
    n++;
    const card = (await one(
      `INSERT INTO card (set_id, tcgdex_id, local_id, local_id_numeric, number_sort, name, name_normalized, category, rarity)
       VALUES ($1,$2,$3,$4,$3,$5,lower($5),'Pokemon',$6) RETURNING id`,
      [setId, `fx-${n}`, localId, /^\d+$/.test(localId) ? Number(localId) : null, name, rarity])).id;
    const ids = {};
    for (const [i, kind] of kinds.entries()) {
      ids[kind] = (await one(
        `INSERT INTO card_variant (card_id, variant_kind_code, sort_order, is_primary) VALUES ($1,$2,$3,$4) RETURNING id`,
        [card, kind, i, i === 0])).id;
    }
    return ids;
  };
  const own = (variantId) => db.query(
    `INSERT INTO collection_item (user_id, card_variant_id, quantity) VALUES ($1,$2,1)`, [userId, variantId]);
  const price = (variantId, minor) => db.query(
    `INSERT INTO price_current (card_variant_id, source_code, currency_code, market_minor) VALUES ($1,'tcgcsv','USD',$2)`,
    [variantId, minor]);
  const progress = async (setId, rows) => {
    for (const [goal, owned, total] of rows) {
      await db.query(
        `INSERT INTO user_set_progress (user_id, set_id, goal, owned_required, total_required) VALUES ($1,$2,$3,$4,$5)`,
        [userId, setId, goal, owned, total]);
    }
  };

  const pb = await mkSet('me05', 'Pitch Black', 3, 6);
  const alpha = await mkCard(pb, '001', 'Alpha', 'Common', ['normal', 'reverse']);
  const beta = await mkCard(pb, '002', 'Beta', 'Uncommon', ['normal', 'reverse']);
  await mkCard(pb, '003', 'Gamma', 'Rare', ['normal']);
  const delta = await mkCard(pb, '004', 'Delta ex', 'Special illustration rare', ['holo']);
  const epsilon = await mkCard(pb, '005', 'Epsilon', 'Hyper rare', ['holo']);
  const zeta = await mkCard(pb, 'TG01', 'Zeta', 'Trainer gallery rare holo', ['holo']);
  await own(alpha.reverse);
  await own(epsilon.holo);
  await price(beta.normal, 50);
  await price(beta.reverse, 25);
  await price(delta.holo, 4000);
  await price(zeta.holo, 300);
  await progress(pb, [['complete', 2, 6], ['master', 2, 9], ['grandmaster', 2, 9]]);

  const nopt = await mkSet('nopt', 'No Printed Total', null, 2);
  const foo = await mkCard(nopt, '001', 'Foo', 'Common', ['normal']);
  await mkCard(nopt, '002', 'Bar', 'Common', ['normal']);
  await own(foo.normal);
  await progress(nopt, [['complete', 1, 2], ['master', 1, 2], ['grandmaster', 1, 2]]);

  pool = new pg.Pool({ ...config, max: 1 });
  const ctx = { db: pool, api: {}, userId };
  const call = (args) => setProgress.handler({ all_sets: false, page: 1, page_size: 50, ...args }, ctx);
  const missingLines = (text) => text.split('\n').filter((l) => l.startsWith('  '));

  await test('numbered keeps cards 1..printed total and drops secret rares and subset cards', async () => {
    const r = await call({ set_id: 'Pitch Black', goal: 'numbered' });
    assert.equal(r.isError, undefined, r.text);
    assert.match(r.text, /^numbered 1\/3 \(33\.3%\) — cards numbered 1–3, the printed set total; one of any variant each; 3 other cards in the set \(secret rares above 3, unnumbered subset cards\) not counted$/m);
    const lines = missingLines(r.text);
    assert.deepEqual(lines.map((l) => l.split(' | ')[1]), ['002', '003'], 'only the numbered cards still missing');
    for (const absent of ['Delta ex', 'Epsilon', 'Zeta', 'TG01']) {
      assert.ok(!r.text.includes(absent), `${absent} is outside the numbered set`);
    }
    assert.equal(r.structured.goal, 'numbered');
    assert.equal(r.structured.missing, 2);
    assert.equal(r.structured.printed_total, 3);
    assert.equal(r.structured.numbered_owned, 1);
    assert.equal(r.structured.numbered_total, 3);
  });

  await test('variants collapse: any owned printing finishes a card, and a missing card is one row at its cheapest', async () => {
    const r = await call({ set_id: 'me05', goal: 'numbered' });
    assert.ok(!r.text.includes('Alpha'), 'owning only the reverse of 001 finishes it');
    const beta = missingLines(r.text).filter((l) => l.includes('Beta'));
    assert.equal(beta.length, 1, 'two printings, one missing row');
    assert.equal(beta[0], '  Beta | 002 | reverse | Uncommon | $0.25');
    assert.match(r.text, /cost to finish 'numbered': \$0\.25 \(Σ cheapest USD market over 1 priced missing; 1 missing items unpriced and NOT included\)/);
  });

  await test('complete on the same set still counts the secret rares and the subset card', async () => {
    const r = await call({ set_id: 'me05', goal: 'complete' });
    assert.equal(r.structured.missing, 4);
    assert.deepEqual(Object.keys(r.structured), ['set', 'goal', 'missing'], 'the stored goals keep their structured shape');
    assert.ok(r.text.includes('Delta ex') && r.text.includes('TG01'));
    assert.ok(!/^numbered/m.test(r.text), 'no numbered line on a stored goal');
    assert.match(r.text, /^complete 2\/6 \(33\.3%\) · master 2\/9 \(22\.2%\) · grandmaster 2\/9 \(22\.2%\) · 0 copies held \(complete\)$/m);
  });

  await test('rarity filters still apply inside the numbered set', async () => {
    const r = await call({ set_id: 'me05', goal: 'numbered', rarity_exclude: ['rare'] });
    assert.deepEqual(missingLines(r.text).map((l) => l.split(' | ')[0].trim()), ['Beta']);
    assert.equal(r.structured.missing, 1);
  });

  await test('a set with no printed total says numbered is not available instead of guessing', async () => {
    const r = await call({ set_id: 'nopt', goal: 'numbered' });
    assert.equal(r.isError, undefined, 'an honest answer, not a tool failure');
    assert.match(r.text, /^numbered: not available — No Printed Total has no printed set total in the catalog/m);
    assert.equal(missingLines(r.text).length, 0, 'no missing list without a boundary');
    assert.deepEqual(r.structured, { set: 'nopt', goal: 'numbered', printed_total: null, missing: null });
  });

  await test('the overview ranks by numbered completion and marks the set it cannot compute', async () => {
    const r = await call({ goal: 'numbered' });
    const lines = r.text.split('\n');
    assert.match(lines[0], /^Sets with progress, sorted by numbered completion/);
    assert.equal(lines[1], 'Pitch Black (me05) | complete 2/6 | master 2/9 | grandmaster 2/9 | numbered 1/3 (cards 1–3) | 33.3% numbered | series mega-evolution');
    assert.equal(lines[2], 'No Printed Total (nopt) | complete 1/2 | master 1/2 | grandmaster 1/2 | numbered n/a | series mega-evolution');
    assert.equal(lines[3], 'showing all 2');
    assert.match(lines[4], /^numbered n\/a = the catalog has no printed set total/);
    assert.deepEqual(r.structured, { total: 2, goal: 'numbered' });
  });

  await test('owning a secret rare never moves the numbered count', async () => {
    await own(delta.holo);
    const r = await call({ set_id: 'me05', goal: 'numbered' });
    assert.equal(r.structured.numbered_owned, 1);
    assert.equal(r.structured.missing, 2);
  });

  results.status = 'passed';
} catch (error) {
  results.status = 'failed';
  results.error = error.stack || error.message;
  process.exitCode = 1;
  console.error(error);
} finally {
  await pool?.end().catch(() => {});
  await db.end().catch(() => {});
  writeFileSync(process.env.DECKPAL_TEST_RESULT, JSON.stringify(results, null, 2) + '\n');
}
