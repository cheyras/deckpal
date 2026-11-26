/**
 * The Play! Pokémon Prize Pack fill (apps/sync/src/prices/prizePack.ts) and the price pass for its
 * group (tcgcsv.ts `writeProductGroupPrices`) against a real PostgreSQL 16 with every shipped
 * migration applied. Invoked only by scripts/test-db-integration.mjs.
 *
 * What the pure test cannot tell us, and this does: the vocabulary rows a new stamped kind needs
 * are created in an order the foreign keys accept, the `unnest` INSERT binds its arrays as the
 * right types and satisfies card_variant's CHECKs and UNIQUEs, the new rows derive tier `special`
 * through `variant_tier_resolved`, a second run writes nothing, and a stamped printing is priced
 * by product id even when its printing name disagrees with TCGplayer's. The network is the only
 * thing replaced: the group's products and prices are handed in as fixtures.
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
assert.equal(process.env.PGDATABASE, 'deckpal_ci_prizepack');
assert.equal(dirname(process.env.DECKPAL_TEST_RESULT), root);
assert.equal(existsSync(join(REPO, '.env')), false);
assert.equal(process.env.DATABASE_URL, undefined);

const config = { host: process.env.PGHOST, port: 55432, user: process.env.PGUSER, database: process.env.PGDATABASE, ssl: false };
const results = { name: 'tcgcsv-prize-pack', status: 'running', cases: [] };
async function test(name, fn) {
  await fn();
  results.cases.push({ name, status: 'passed' });
  console.log('PASS ' + name);
}

const db = new pg.Client(config);
await db.connect();
try {
  const { migrateUp } = await import('../../../../packages/db/src/migrate.ts');
  const pool = new pg.Pool({ ...config, max: 1 });
  try { await migrateUp(pool); } finally { await pool.end(); }
  const { fillPrizePack, PRIZE_PACK_STAMP } = await import('../../../sync/src/prices/prizePack.ts');
  const { writeProductGroupPrices } = await import('../../../sync/src/prices/tcgcsv.ts');
  const { ensureObservationPartition } = await import('../../../sync/src/prices/db.ts');

  // ── fixtures: the catalog as the TCGdex import leaves it ──────────────────
  const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
  const series = (await one(`INSERT INTO series (catalogue_code, tcgdex_id, slug, name) VALUES ('en','sv','scarlet-violet','Scarlet & Violet') RETURNING id`)).id;
  const older = (await one(`INSERT INTO series (catalogue_code, tcgdex_id, slug, name) VALUES ('en','xy','xy','XY') RETURNING id`)).id;
  const mkSet = async (seriesId, tcgdexId, official) =>
    (await one(
      `INSERT INTO card_set (series_id, tcgdex_id, slug, name, card_count_official)
       VALUES ($1,$2,$2,$2,$3) RETURNING id`, [seriesId, tcgdexId, official])).id;
  for (const [code, finish] of [['normal', 'normal'], ['reverse', 'reverse'], ['holo', 'holo']]) {
    await db.query(
      `INSERT INTO variant_kind (code, display_name, finish, size, tier_derived, tier_rule_version)
       VALUES ($1,$1,$2,'standard','standard',3) ON CONFLICT DO NOTHING`, [code, finish]);
  }
  // A stamped kind TCGdex already uses on another card, as the importer would have written it.
  await db.query(`INSERT INTO variant_stamp (code, label) VALUES ($1, 'Player Rewards Program') ON CONFLICT DO NOTHING`, [PRIZE_PACK_STAMP]);
  await db.query(
    `INSERT INTO variant_kind (code, display_name, finish, size, foil, tier_derived, tier_rule_version)
     VALUES ('reverse-foil-cosmos-stamp-player-rewards-program', 'Cosmos Reverse Holofoil Player Rewards Program Stamp',
             'reverse', 'standard', 'cosmos', 'special', 3)`);
  await db.query(`INSERT INTO variant_kind_stamp VALUES ('reverse-foil-cosmos-stamp-player-rewards-program', $1)`, [PRIZE_PACK_STAMP]);

  let n = 0;
  const mkCard = async (setId, localId, name, kinds) => {
    n++;
    const card = (await one(
      `INSERT INTO card (set_id, tcgdex_id, local_id, local_id_numeric, number_sort, name, name_normalized, category)
       VALUES ($1,$2,$3,$4,$3,$5,lower($5),'Trainer') RETURNING id`,
      [setId, `fx-${n}`, localId, /^\d+$/.test(localId) ? Number(localId) : null, name])).id;
    const ids = [];
    for (const [order, k] of kinds.entries()) {
      const pid = typeof k === 'object' ? k.pid : null;
      const kind = typeof k === 'object' ? k.kind : k;
      ids.push((await one(
        `INSERT INTO card_variant (card_id, variant_kind_code, sort_order, is_primary,
                                   tcgplayer_product_id, tcgplayer_printing, id_source, id_confidence)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [card, kind, order, order === 0, pid ?? null, pid ? k.printing : null, pid ? 'variant' : 'none', pid ? 100 : 0])).id);
    }
    return { card, ids };
  };

  const sv01 = await mkSet(series, 'sv01', 198);
  const mee = await mkSet(series, 'mee', 8);
  const sv02 = await mkSet(series, 'sv02', 193);
  const xy1 = await mkSet(older, 'xy1', 198); // same printed size as sv01, outside the Prize Pack eras
  const nest = await mkCard(sv01, '181', 'Nest Ball', ['normal', 'reverse']);
  const water = await mkCard(mee, '003', 'Water Energy', ['normal', 'reverse']);
  const jet = await mkCard(sv02, '190', 'Jet Energy', ['normal',
    { kind: 'reverse-foil-cosmos-stamp-player-rewards-program', pid: 703814, printing: 'Reverse Holofoil' }]);
  const xyNest = await mkCard(xy1, '181', 'Nest Ball', ['normal']);

  const product = (productId, name, number) => ({
    productId, name, url: `https://www.tcgplayer.com/product/${productId}`,
    extendedData: number == null ? [] : [{ name: 'Number', value: number }],
  });
  const price = (productId, subTypeName, marketPrice) =>
    ({ productId, subTypeName, marketPrice, lowPrice: null, midPrice: null, highPrice: null, directLowPrice: null });
  const DATA = {
    products: [
      product(515500, 'Nest Ball - 181/198', '181/198'),
      product(703878, 'Nest Ball - 181/198 (Cosmos Holo)', '181/198'),
      product(677424, 'Basic Water Energy - MEE 003', '003'),
      product(703866, 'Basic Water Energy - MEE 003 (Cosmos Holo)', '003'),
      product(703814, 'Jet Energy - 190/193 (Cosmos Holo)', '190/193'),
      product(476140, 'Water Energy (Prize Pack Series 1)', null),
    ],
    prices: [
      price(515500, 'Normal', 0.25), price(703878, 'Holofoil', 1.1), price(677424, 'Normal', 0.11),
      price(703866, 'Holofoil', 0.7), price(703814, 'Holofoil', 2.5), price(476140, 'Normal', 0.3),
    ],
  };
  const seams = { loadData: async () => DATA };
  const stamped = async (cardId) => (await db.query(
    `SELECT cv.variant_kind_code AS kind, cv.tcgplayer_product_id AS pid, cv.tcgplayer_printing AS printing,
            cv.source, cv.is_primary, cv.sort_order, cv.display_name, cv.provenance, t.tier
       FROM card_variant cv JOIN variant_tier_resolved t ON t.card_variant_id = cv.id
      WHERE cv.card_id = $1 AND cv.variant_kind_code LIKE '%stamp%' ORDER BY cv.sort_order`, [cardId])).rows;

  await test('a dry run plans and writes nothing', async () => {
    const r = await fillPrizePack(db, { ...seams, dryRun: true });
    assert.equal(r.added, 4);
    assert.equal((await db.query(`SELECT 1 FROM card_variant WHERE source = 'tcgcsv'`)).rowCount, 0);
  });

  await test('the stamped printings land on the cards they reprint, as secondary printings', async () => {
    const r = await fillPrizePack(db, seams);
    assert.equal(r.added, 4);
    assert.deepEqual(r.addedBySet, { sv01: 2, mee: 2 });
    assert.equal(r.covered, 1, 'Jet Energy already had its cosmos stamp from TCGdex');
    assert.deepEqual(r.skipped, { 'no-number': 1 });
    const w = await stamped(water.card);
    assert.deepEqual(w.map((x) => [x.kind, x.pid, x.printing, x.source, x.is_primary, x.sort_order, x.tier]), [
      ['normal-stamp-player-rewards-program', 677424, 'Normal', 'tcgcsv', false, 2, 'special'],
      ['holo-foil-cosmos-stamp-player-rewards-program', 703866, 'Holofoil', 'tcgcsv', false, 3, 'special'],
    ]);
    assert.equal(w[0].display_name, 'Normal Play! Pokémon Stamp');
    assert.equal(w[0].provenance, 'Found in Play! Pokémon Prize Packs');
    assert.equal((await stamped(nest.card)).length, 2);
    assert.equal((await stamped(xyNest.card)).length, 0, 'an XY card with the same number and set size is not a Prize Pack card');
    const primaries = await db.query(`SELECT count(*)::int AS n FROM card_variant WHERE card_id = $1 AND is_primary`, [water.card]);
    assert.equal(primaries.rows[0].n, 1, 'the card keeps its one primary printing');
    const kind = await one(`SELECT tier_derived, foil FROM variant_kind WHERE code = 'holo-foil-cosmos-stamp-player-rewards-program'`);
    assert.deepEqual(kind, { tier_derived: 'special', foil: 'cosmos' });
  });

  await test('running it again changes nothing (B8)', async () => {
    const before = (await db.query(`SELECT * FROM card_variant ORDER BY id`)).rows.map(({ last_synced_at, ...r }) => r);
    const r = await fillPrizePack(db, seams);
    assert.equal(r.added, 0);
    assert.equal(r.linked, 0);
    assert.equal(r.covered, 5);
    const after = (await db.query(`SELECT * FROM card_variant ORDER BY id`)).rows.map(({ last_synced_at, ...r }) => r);
    assert.deepEqual(after, before);
  });

  await test('a stamped printing with no product id gets one, and only that', async () => {
    await db.query(
      `UPDATE card_variant SET tcgplayer_product_id = NULL, tcgplayer_printing = NULL, id_source = 'none', id_confidence = 0
        WHERE card_id = $1 AND variant_kind_code = 'normal-stamp-player-rewards-program'`, [nest.card]);
    const r = await fillPrizePack(db, seams);
    assert.equal(r.added, 0);
    assert.equal(r.linked, 1);
    assert.equal((await stamped(nest.card))[0].pid, 515500);
  });

  await test('the group is priced by product id, across sets, whatever the printing is called', async () => {
    const at = new Date('2026-11-26T20:05:00Z');
    await ensureObservationPartition(db, at);
    await db.query('BEGIN');
    const r = await writeProductGroupPrices(db, DATA.prices, at, null);
    await db.query('COMMIT');
    assert.equal(r.matched, 5, 'four new printings plus Jet Energy, which TCGdex filed as "Reverse Holofoil"');
    assert.equal(r.unmatched, 1, 'the unnumbered series energy has no printing');
    const jetPrice = await one(
      `SELECT pc.market_minor FROM price_current pc WHERE pc.card_variant_id = $1`, [jet.ids[1]]);
    assert.equal(Number(jetPrice.market_minor), 250);
    const waterPrice = await one(
      `SELECT pc.market_minor FROM price_current pc JOIN card_variant cv ON cv.id = pc.card_variant_id
        WHERE cv.card_id = $1 AND cv.variant_kind_code = 'normal-stamp-player-rewards-program'`, [water.card]);
    assert.equal(Number(waterPrice.market_minor), 11);
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
