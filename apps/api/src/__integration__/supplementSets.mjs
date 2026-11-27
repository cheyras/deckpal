/**
 * The sets TCGdex has not published yet (apps/sync/src/catalog/supplements.ts), against a real
 * PostgreSQL 16 with every shipped migration applied. Invoked only by scripts/test-db-integration.mjs.
 *
 * What a pure test cannot tell us, and this does: the INSERT ... SELECT copies of the reprinted
 * card and its child rows satisfy every constraint, the new printing is a standard-tier primary
 * with its TCGplayer link, a second run writes nothing, and — the property the design rests on —
 * when the TCGdex import later publishes the set under another id, it re-keys these same rows in
 * place (same bigint ids, so anything a user logged stays attached) and the supplement then stands
 * down. The import is the real `importCatalog`, fed a three-file TCGdex fixture.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
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
assert.equal(process.env.PGDATABASE, 'deckpal_ci_supplement');
assert.equal(dirname(process.env.DECKPAL_TEST_RESULT), root);
assert.equal(existsSync(join(REPO, '.env')), false);
assert.equal(process.env.DATABASE_URL, undefined);

const config = { host: process.env.PGHOST, port: 55432, user: process.env.PGUSER, database: process.env.PGDATABASE, ssl: false };
const results = { name: 'catalog-supplement-sets', status: 'running', cases: [] };
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
  const { fillSupplementSets } = await import('../../../sync/src/catalog/supplements.ts');
  const { importCatalog } = await import('../../../sync/src/catalog/import.ts');

  // ── fixtures: the catalog as the TCGdex import leaves it ──────────────────
  const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
  const sv = (await one(`INSERT INTO series (catalogue_code, tcgdex_id, slug, name) VALUES ('en','sv','scarlet-violet','Scarlet & Violet') RETURNING id`)).id;
  await db.query(`INSERT INTO series (catalogue_code, tcgdex_id, slug, name) VALUES ('en','mc','mcdonald-s-collection','McDonald''s Collection')`);
  for (const [code, finish] of [['normal', 'normal'], ['reverse', 'reverse'], ['holo', 'holo']]) {
    await db.query(
      `INSERT INTO variant_kind (code, display_name, finish, size, tier_derived, tier_rule_version)
       VALUES ($1,$1,$2,'standard','standard',3) ON CONFLICT DO NOTHING`, [code, finish]);
  }
  const sfa = (await one(`INSERT INTO card_set (series_id, tcgdex_id, slug, name) VALUES ($1,'sv06.5','shrouded-fable','Shrouded Fable') RETURNING id`, [sv])).id;
  const svi = (await one(`INSERT INTO card_set (series_id, tcgdex_id, slug, name) VALUES ($1,'sv01','scarlet-violet','Scarlet & Violet') RETURNING id`, [sv])).id;
  const FP = 'f'.repeat(64);
  const mkSource = async (setId, tcgdexId, localId, name, hp, stage, mark, type, attacks) => {
    const id = (await one(
      `INSERT INTO card (set_id, tcgdex_id, local_id, local_id_numeric, number_sort, name, name_normalized, category,
                         rarity, illustrator, hp, stage, retreat, regulation_mark, legal_standard, legal_expanded,
                         playable_fingerprint, flavor_text)
       VALUES ($1,$2,$3,$4,$3,$5,lower($5),'Pokemon','Uncommon','Someone',$6,$7,2,$8,true,true,$9,'A flavour line.')
       RETURNING id`,
      [setId, tcgdexId, localId, Number(localId), name, hp, stage, mark, FP])).id;
    await db.query(`INSERT INTO card_type VALUES ($1, 0, $2)`, [id, type]);
    for (const [ord, a] of attacks.entries()) {
      await db.query(`INSERT INTO card_attack (card_id, ord, name, damage, effect, cost) VALUES ($1,$2,$3,$4,$5,$6)`,
        [id, ord, a.name, a.damage ?? null, a.effect ?? null, a.cost]);
    }
    await db.query(`INSERT INTO card_matchup VALUES ($1,'weakness',0,'Fire','×2')`, [id]);
    await db.query(`INSERT INTO card_text VALUES ($1, 1, $2, $3)`, [id, attacks.map((a) => a.name).join(' '), attacks.map((a) => a.name.toLowerCase())]);
    await db.query(`INSERT INTO card_variant (card_id, variant_kind_code, sort_order, is_primary) VALUES ($1,'normal',0,true)`, [id]);
    return id;
  };
  const decidueye = await mkSource(sfa, 'sv06.5-005', '005', 'Decidueye', 150, 'Stage2', 'H', 'Grass', [
    { name: 'Stock Up on Feathers', effect: 'Draw cards until you have 7 cards in your hand.', cost: 'Colorless' },
    { name: 'Power Shot', damage: '170', effect: 'Discard a Basic Grass Energy card from your hand.', cost: 'Grass' },
  ]);
  const lucario = await mkSource(svi, 'sv01-114', '114', 'Lucario', 130, 'Stage1', 'G', 'Fighting', [
    { name: 'Avenging Knuckle', damage: '30+', cost: 'Fighting' },
    { name: 'Accelerating Stab', damage: '120', cost: 'Fighting,Colorless,Colorless' },
  ]);

  const SET = {
    tcgdexId: '2026me', series: 'mc', name: "McDonald's Collection 2026", releasedOn: '2026-11-06', official: 15,
    tcgplayerGroupId: 24938, rarity: 'Promo',
    cards: [
      { localId: '1', name: 'Decidueye', hp: 150, finish: 'normal', productId: 730416, reprints: 'sv06.5-005' },
      { localId: '6', name: 'Lucario', hp: 130, finish: 'holo', productId: 730421, reprints: 'sv01-114' },
      { localId: '7', name: 'Hawlucha', hp: 70, finish: 'normal', productId: 730422, reprints: 'sv01-118' },
      { localId: '8', name: 'Tyranitar', hp: 999, finish: 'holo', productId: 730423, reprints: 'sv06.5-005' },
    ],
  };
  const sets = [SET];
  const inSet = async () => (await db.query(
    `SELECT c.id, c.tcgdex_id, c.local_id, c.name, c.hp, c.stage, c.regulation_mark, c.rarity, c.illustrator,
            c.flavor_text, c.legal_standard, c.playable_fingerprint, c.released_on::text AS released_on,
            cv.id AS variant_id, cv.variant_kind_code AS kind, cv.is_primary, cv.tcgplayer_product_id AS pid,
            cv.tcgplayer_printing AS printing, cv.display_name, cv.source, cv.id_source, t.tier
       FROM card c JOIN card_set s ON s.id = c.set_id
       JOIN card_variant cv ON cv.card_id = c.id
       JOIN variant_tier_resolved t ON t.card_variant_id = cv.id
      WHERE s.series_id = (SELECT id FROM series WHERE tcgdex_id = 'mc')
      ORDER BY c.number_sort, cv.sort_order`)).rows;

  await test('a dry run reports the set and writes nothing', async () => {
    const r = await fillSupplementSets(db, { dryRun: true, sets });
    assert.equal(r.sets[0].status, 'filled');
    assert.equal(r.sets[0].cardsAdded, 2);
    assert.equal((await db.query(`SELECT 1 FROM card_set WHERE tcgplayer_group_id = 24938`)).rowCount, 0);
  });

  let before;
  await test('each card is the card it reprints, in its own printing, with its TCGplayer link', async () => {
    const r = await fillSupplementSets(db, { sets });
    assert.deepEqual(r.sets[0], {
      tcgdexId: '2026me', status: 'filled', setCreated: true, cardsAdded: 2, variantsAdded: 2,
      refused: [
        { localId: '7', reprints: 'sv01-118', reason: 'no-source' },
        { localId: '8', reprints: 'sv06.5-005', reason: 'source-differs' },
      ],
    });
    const set = await one(`SELECT s.tcgdex_id, s.slug, s.name, s.card_count_official, s.released_on::text AS released, sr.tcgdex_id AS series
                             FROM card_set s JOIN series sr ON sr.id = s.series_id WHERE s.tcgplayer_group_id = 24938`);
    assert.deepEqual(set, { tcgdex_id: '2026me', slug: 'mcdonald-s-collection-2026', name: "McDonald's Collection 2026",
      card_count_official: 15, released: '2026-11-06', series: 'mc' });
    const rows = await inSet();
    assert.deepEqual(rows.map((x) => [x.tcgdex_id, x.local_id, x.name, x.hp, x.stage, x.regulation_mark, x.kind, x.is_primary, x.pid, x.printing, x.display_name, x.source, x.id_source, x.tier]), [
      ['2026me-1', '1', 'Decidueye', 150, 'Stage2', 'H', 'normal', true, 730416, 'Normal', 'Normal', 'tcgcsv', 'variant', 'standard'],
      ['2026me-6', '6', 'Lucario', 130, 'Stage1', 'G', 'holo', true, 730421, 'Holofoil', 'Holofoil', 'tcgcsv', 'variant', 'standard'],
    ]);
    const d = rows[0];
    assert.equal(d.rarity, 'Promo');
    assert.equal(d.illustrator, null, 'the art is this printing\'s own, not the reprinted card\'s');
    assert.equal(d.flavor_text, null);
    assert.equal(d.legal_standard, false, 'an upstream mirror; nothing upstream has asserted it');
    assert.equal(d.playable_fingerprint, FP, 'the reprint fingerprint travels with the text');
    assert.equal(d.released_on, '2026-11-06');
    const copied = async (table, cardId) => (await db.query(`SELECT * FROM ${table} WHERE card_id = $1 ORDER BY 2`, [cardId])).rows.map(({ card_id, ...r }) => r);
    for (const t of ['card_type', 'card_attack', 'card_matchup', 'card_text']) {
      assert.deepEqual(await copied(t, d.id), await copied(t, decidueye), t);
    }
    assert.deepEqual((await copied('card_attack', rows[1].id)).map((a) => a.name), ['Avenging Knuckle', 'Accelerating Stab']);
    assert.equal((await db.query(`SELECT 1 FROM card_variant WHERE card_id = ANY($1::bigint[]) AND source = 'tcgcsv'`, [[decidueye, lucario]])).rowCount, 0,
      'the reprinted cards are untouched');
    before = rows;
  });

  await test('running it again changes nothing (B8)', async () => {
    const r = await fillSupplementSets(db, { sets });
    assert.equal(r.sets[0].status, 'unchanged');
    assert.equal(r.sets[0].cardsAdded, 0);
    assert.deepEqual(await inSet(), before);
  });

  await test('when TCGdex publishes the set, its import re-keys these rows in place and the supplement stands down', async () => {
    const dir = join(root, 'tcgdex-supplement');
    mkdirSync(dir, { recursive: true });
    const set = { id: '2026mcd', name: "McDonald's Collection 2026", releaseDate: '2026-11-06',
      cardCount: { official: 15, total: 15 }, serie: { id: 'mc', name: "McDonald's Collection" } };
    const card = (localId, name, hp, type, variant, attacks) => ({
      id: `2026mcd-${localId}`, localId, name, category: 'Pokemon', hp, types: [type], stage: 'Stage1',
      illustrator: 'Upstream Artist', attacks, set: { id: '2026mcd' },
      variants_detailed: [{ type: variant, size: 'standard', variantId: `v-${localId}` }],
    });
    writeFileSync(join(dir, 'series.json'), JSON.stringify([{ id: 'mc', name: "McDonald's Collection" }]));
    writeFileSync(join(dir, 'sets.json'), JSON.stringify([set]));
    writeFileSync(join(dir, 'cards.json'), JSON.stringify([
      card('1', 'Decidueye', 150, 'Grass', 'normal', [{ name: 'Stock Up on Feathers', cost: ['Colorless'] }, { name: 'Power Shot', damage: 170, cost: ['Grass'] }]),
      card('6', 'Lucario', 130, 'Fighting', 'holo', [{ name: 'Avenging Knuckle', damage: '30+', cost: ['Fighting'] }]),
    ]));
    const summary = await importCatalog(dir);
    assert.equal(summary.renamedSets, 1);
    assert.equal(summary.renamedCards, 2);

    const after = await inSet();
    assert.deepEqual(after.map((x) => [x.id, x.variant_id]), before.map((x) => [x.id, x.variant_id]),
      'the same card and printing rows: whatever points at them still does');
    assert.deepEqual(after.map((x) => [x.tcgdex_id, x.kind, x.source]), [
      ['2026mcd-1', 'normal', 'tcgdex'], ['2026mcd-6', 'holo', 'tcgdex'],
    ]);
    assert.equal(after[0].illustrator, 'Upstream Artist');
    assert.equal((await db.query(`SELECT 1 FROM card_set WHERE series_id = (SELECT id FROM series WHERE tcgdex_id = 'mc')`)).rowCount, 1,
      'one set, not a TCGdex copy beside ours');

    const r = await fillSupplementSets(db, { sets });
    assert.equal(r.sets[0].status, 'superseded');
    assert.equal(r.sets[0].supersededBy, '2026mcd');
    assert.equal((await db.query(`SELECT 1 FROM card_set WHERE tcgdex_id = '2026me'`)).rowCount, 0, 'no second copy under the old id');
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
