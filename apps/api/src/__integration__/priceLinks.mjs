/**
 * The TCGCSV link pass (apps/sync/src/prices/linkTcgcsv.ts) against a real PostgreSQL 16 with every
 * shipped migration applied. Invoked only by scripts/test-db-integration.mjs.
 *
 * What a fake database cannot tell us, and this does: the `unnest` UPDATE binds its six arrays as
 * the right types, `card_variant`'s `(id_source = 'none') = (no ids)` CHECK still holds after a
 * link, and the "IS NULL" guards really do leave an upstream-supplied id alone. The network is the
 * only thing replaced — the two TCGCSV reads are handed in as fixtures.
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
assert.equal(process.env.PGDATABASE, 'deckpal_ci_pricelinks');
assert.equal(dirname(process.env.DECKPAL_TEST_RESULT), root);
assert.equal(existsSync(join(REPO, '.env')), false);
assert.equal(process.env.DATABASE_URL, undefined);

const config = { host: process.env.PGHOST, port: 55432, user: process.env.PGUSER, database: process.env.PGDATABASE, ssl: false };
const results = { name: 'tcgcsv-price-links', status: 'running', cases: [] };
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
  const { linkTcgcsvProducts } = await import('../../../sync/src/prices/linkTcgcsv.ts');
  const { writeSetPrices } = await import('../../../sync/src/prices/tcgcsv.ts');
  const { ensureObservationPartition } = await import('../../../sync/src/prices/db.ts');

  // ── fixtures ──────────────────────────────────────────────────────────────
  const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
  const series = (await one(`INSERT INTO series (catalogue_code, tcgdex_id, slug, name) VALUES ('en','sv','scarlet-violet','Scarlet & Violet') RETURNING id`)).id;
  const mkSet = async (tcgdexId, name, abbreviation, group) =>
    (await one(
      `INSERT INTO card_set (series_id, tcgdex_id, slug, name, abbreviation, tcgplayer_group_id)
       VALUES ($1,$2,$2,$3,$4,$5) RETURNING id`, [series, tcgdexId, name, abbreviation, group])).id;
  // Kinds the catalog importer would have created; the vocabulary rows they reference come from 013.
  for (const [code, finish] of [['normal', 'normal'], ['holo', 'holo'], ['reverse', 'reverse'], ['holo-stamp-prerelease', 'holo']]) {
    await db.query(
      `INSERT INTO variant_kind (code, display_name, finish, size, tier_derived, tier_rule_version)
       VALUES ($1,$1,$2,'standard','standard',3) ON CONFLICT DO NOTHING`, [code, finish]);
  }
  let n = 0;
  const mkCard = async (setId, localId, name, variants) => {
    n++;
    const card = (await one(
      `INSERT INTO card (set_id, tcgdex_id, local_id, local_id_numeric, number_sort, name, name_normalized, category)
       VALUES ($1,$2,$3,$4,$3,$5,lower($5),'Pokemon') RETURNING id`,
      [setId, `fx-${n}`, localId, /^\d+$/.test(localId) ? Number(localId) : null, name])).id;
    const ids = [];
    let order = 0;
    for (const v of variants) {
      const hasId = v.pid != null || v.cm != null;
      ids.push((await one(
        `INSERT INTO card_variant (card_id, variant_kind_code, sort_order, is_primary,
                                   tcgplayer_product_id, tcgplayer_printing, cardmarket_product_id, id_source, id_confidence)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [card, v.kind, order, order === 0, v.pid ?? null, v.printing ?? null, v.cm ?? null,
          hasId ? (v.src ?? 'variant') : 'none', hasId ? 100 : 0])).id);
      order++;
    }
    return ids;
  };

  // svp: TCGdex gave NO group and NO product ids — the Pikachu-with-Grey-Felt-Hat shape.
  const svp = await mkSet('svp', 'SVP Black Star Promos', 'SVP', null);
  const [felt] = await mkCard(svp, '085', 'Pikachu with Grey Felt Hat', [{ kind: 'normal' }]);
  const [pawmot] = await mkCard(svp, '006', 'Pawmot', [{ kind: 'normal' }]);
  const [tinka] = await mkCard(svp, '025', 'Tinkatink', [{ kind: 'normal' }]);
  const [pika] = await mkCard(svp, '027', 'Pikachu', [{ kind: 'normal' }]);

  // sv99: TCGdex gave the group and SOME ids.
  const sv99 = await mkSet('sv99', 'Fixture Set', 'FIX', 999);
  const [owned] = await mkCard(sv99, '001', 'Foo', [{ kind: 'normal', pid: 5000, printing: 'Normal' }]);
  const [barN, barR] = await mkCard(sv99, '002', 'Bar', [{ kind: 'normal' }, { kind: 'reverse' }]);
  const [bazN, bazSpecial] = await mkCard(sv99, '003', 'Baz', [{ kind: 'normal' }, { kind: 'holo-stamp-prerelease' }]);
  const [qux] = await mkCard(sv99, '004', 'Qux', [{ kind: 'normal', cm: 77, src: 'card' }]);

  // zzz: a group shares its abbreviation but is a different set — must be REFUSED, not assigned.
  const zzz = await mkSet('zzz', 'Unrelated Set', 'ZZZ', null);
  const [stranger] = await mkCard(zzz, '001', 'Totally Different', [{ kind: 'normal' }]);

  const product = (productId, name, number, url) => ({
    productId, name, url: url ?? `https://www.tcgplayer.com/product/${productId}`,
    extendedData: number == null ? [] : [{ name: 'Number', value: number }],
  });
  const price = (productId, subTypeName, marketPrice = 1) =>
    ({ productId, subTypeName, marketPrice, lowPrice: null, midPrice: null, highPrice: null, directLowPrice: null });
  const GROUPS = [
    { groupId: 22872, name: 'SV: Scarlet & Violet Promo Cards', abbreviation: 'SVP' },
    { groupId: 999, name: 'SV99: Fixture Set', abbreviation: 'FIX' },
    { groupId: 31337, name: 'ZZZ: A Different Expansion', abbreviation: 'ZZZ' },
  ];
  const DATA = {
    22872: {
      products: [
        product(518861, 'Pikachu with Grey Felt Hat', '085'),
        product(1001, 'Pawmot - 006 (Prerelease)', '006'),
        product(1002, 'Pawmot - 006 (Prerelease) [Staff]', '006'),
        product(1003, 'Tinkatink - 025 (Cosmos Holo)', '025'),
        product(1004, 'Pikachu - 027', '027'),
        product(1005, 'Booster Box', null), // sealed: no Number, must never match a card
      ],
      prices: [
        price(518861, 'Normal', 1031.27), price(1001, 'Normal'), price(1002, 'Normal'),
        price(1003, 'Holofoil'), price(1004, 'Normal'), price(1005, 'Normal'),
      ],
    },
    999: {
      products: [
        product(5000, 'Foo - 001/100', '001/100'),
        product(6000, 'Bar - 002/100', '002/100'),
        product(7000, 'Baz - 003/100', '003/100'),
        product(8000, 'Qux - 004/100', '004/100'),
      ],
      prices: [
        price(5000, 'Normal'), price(6000, 'Normal'), price(6000, 'Reverse Holofoil'),
        price(7000, 'Normal'), price(7000, 'Holofoil'), price(8000, 'Normal'),
      ],
    },
    31337: {
      products: [product(9000, 'Some Other Card - 001/50', '001/50'), product(9001, 'Another - 002/50', '002/50'), product(9002, 'Third - 003/50', '003/50')],
      prices: [price(9000, 'Normal'), price(9001, 'Normal'), price(9002, 'Normal')],
    },
  };
  const calls = { groups: 0, data: [] };
  const seams = {
    loadGroups: async () => { calls.groups++; return GROUPS; },
    loadGroupData: async (g) => { calls.data.push(g); return DATA[g]; },
  };
  const variant = async (id) => one(
    `SELECT tcgplayer_product_id pid, tcgplayer_printing printing, tcgplayer_url url, id_source, id_confidence conf
       FROM card_variant WHERE id = $1`, [id]);
  const group = async (id) => (await one(`SELECT tcgplayer_group_id g FROM card_set WHERE id = $1`, [id])).g;

  await test('a dry run reports what it would do and writes nothing', async () => {
    const r = await linkTcgcsvProducts(db, { ...seams, dryRun: true });
    assert.equal(r.dryRun, true);
    assert.ok(r.variantsLinked >= 4, 'it plans links');
    assert.equal(await group(svp), null);
    assert.equal((await variant(felt)).pid, null);
    assert.equal((await variant(barN)).pid, null);
  });

  await test('Pikachu with Grey Felt Hat gets its group and product, with provenance', async () => {
    const r = await linkTcgcsvProducts(db, seams);
    assert.equal(r.dryRun, false);
    assert.equal(await group(svp), 22872, 'the set is assigned the group whose cards agree with it');
    const v = await variant(felt);
    assert.equal(v.pid, 518861);
    assert.equal(v.printing, 'Normal');
    assert.equal(v.id_source, 'number_match');
    assert.equal(v.conf, 100);
    assert.equal(v.url, 'https://www.tcgplayer.com/product/518861');
  });

  await test('a stamped-only product is refused; a lone finish descriptor is accepted at lower confidence', async () => {
    const p = await variant(pawmot);
    assert.equal(p.pid, null, 'Prerelease / Staff products are different cards, not this one');
    assert.equal(p.id_source, 'none');
    const t = await variant(tinka);
    assert.equal(t.pid, 1003);
    assert.equal(t.printing, 'Holofoil', "TCGplayer's printing name wins over the catalog's finish when it is the card's only variant");
    assert.equal(t.conf, 80);
    assert.equal((await variant(pika)).pid, 1004);
  });

  await test('an upstream id is never overwritten, and siblings and printings link correctly', async () => {
    assert.equal(await group(sv99), 999, 'a group TCGdex supplied is kept');
    const o = await variant(owned);
    assert.deepEqual([o.pid, o.printing, o.id_source], [5000, 'Normal', 'variant']);
    const bn = await variant(barN), br = await variant(barR);
    assert.deepEqual([bn.pid, bn.printing, br.pid, br.printing], [6000, 'Normal', 6000, 'Reverse Holofoil']);
    const bz = await variant(bazN), sp = await variant(bazSpecial);
    assert.equal(bz.pid, 7000);
    assert.equal(sp.pid, null, 'a stamped variant is not guessed from number+name');
    const q = await variant(qux);
    assert.equal(q.pid, 8000);
    assert.equal(q.id_source, 'card', 'an existing id_source (here from the Cardmarket id) is preserved');
  });

  await test('the existing price writer now prices the linked card (the whole point)', async () => {
    const at = new Date('2026-10-01T20:05:00Z');
    await ensureObservationPartition(db, at);
    const r = await writeSetPrices(db, svp, DATA[22872].prices, at, null);
    assert.ok(r.matched >= 3, 'the linked variants join to price rows');
    const cur = await one(`SELECT market_minor FROM price_current WHERE card_variant_id = $1 AND source_code = 'tcgcsv'`, [felt]);
    assert.equal(Number(cur.market_minor), 103127, '$1,031.27 as minor units');
    const unlinked = await db.query(`SELECT 1 FROM price_current WHERE card_variant_id = $1`, [pawmot]);
    assert.equal(unlinked.rowCount, 0, 'a refused card stays honestly unpriced');
  });

  await test('a candidate group that does not agree with the set is refused', async () => {
    assert.equal(await group(zzz), null);
    assert.equal((await variant(stranger)).pid, null);
  });

  await test('the schema CHECK still holds for every row, and no (product, printing) has two owners', async () => {
    const bad = await db.query(
      `SELECT id FROM card_variant WHERE (id_source = 'none') <> (tcgplayer_product_id IS NULL AND cardmarket_product_id IS NULL)`);
    assert.equal(bad.rowCount, 0);
    const dup = await db.query(
      `SELECT tcgplayer_product_id, tcgplayer_printing FROM card_variant
        WHERE tcgplayer_product_id IS NOT NULL GROUP BY 1,2 HAVING count(*) > 1`);
    assert.equal(dup.rowCount, 0);
  });

  await test('running it again changes nothing (B8)', async () => {
    const before = (await db.query(`SELECT id, tcgplayer_product_id, tcgplayer_printing, id_source, id_confidence FROM card_variant ORDER BY id`)).rows;
    const r = await linkTcgcsvProducts(db, seams);
    assert.equal(r.variantsLinked, 0);
    assert.equal(r.groupsAssigned, 0);
    const after = (await db.query(`SELECT id, tcgplayer_product_id, tcgplayer_printing, id_source, id_confidence FROM card_variant ORDER BY id`)).rows;
    assert.deepEqual(after, before);
  });

  await test('restricting to a set id only touches that set', async () => {
    await db.query(`UPDATE card_variant SET tcgplayer_product_id = NULL, tcgplayer_printing = NULL, id_source = 'none', id_confidence = 0 WHERE id = ANY($1)`, [[felt, barN]]);
    const r = await linkTcgcsvProducts(db, { ...seams, sets: ['svp'] });
    assert.equal(r.perSet.length, 1);
    assert.equal((await variant(felt)).pid, 518861);
    assert.equal((await variant(barN)).pid, null, 'sv99 was not in scope');
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
