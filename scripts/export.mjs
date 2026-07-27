#!/usr/bin/env node
// pokedex — user data export / portability (BRIEF §5).
//
// Exports the single user's own data (catalog stays global, never exported):
//   - collection.csv   one row per collection_item
//   - lists.csv        one row per list_item (all lists)
//   - decks.csv        one row per deck_card (all decks)
//   - deck-<name>.ptcgl.txt   each deck as PTCG Live text (reuses the API's
//                             serializePtcgl — the grammar is NOT reimplemented)
//   - pokedex-export.json     FULL JSON of everything user-owned
//
// Read-only, parameterised SQL, ONE connection (makePool(1)).
//
// Usage:  node scripts/export.mjs [--out DIR] [--user ID|username]
//         POKEDEX_EXPORT_DIR overrides the default (~/pokedex-exports/<ts>).
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');

// Reuse the workspace pool (clamped to 1 conn) and the deck serializer from
// their compiled outputs — both resolve `pg` via their own node_modules.
const { makePool } = await import(join(REPO, 'packages/db/dist/index.js'));
const { serializePtcgl } = await import(join(REPO, 'apps/api/dist/deck/ptcgl.js'));

// ── args ─────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
let outDir = process.env.POKEDEX_EXPORT_DIR ?? '';
let userArg = '';
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--out') outDir = argv[++i];
  else if (argv[i] === '--user') userArg = argv[++i];
}
if (!outDir) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  outDir = join(process.env.HOME ?? REPO, 'pokedex-exports', ts);
}
mkdirSync(outDir, { recursive: true });

// ── reverse PTCGL set-code map (tcgdex set id -> PTCGL code) ─────────────────
// Authority is the deck engine's vendored alias file (the DB alias table is
// empty). Prefer the 'main' printing when a tcgdex set has several codes.
const aliasFile = JSON.parse(
  readFileSync(join(REPO, 'apps/api/src/deck/data/ptcgl-set-alias.json'), 'utf8'),
);
const setToPtcgl = new Map();
for (const [code, a] of Object.entries(aliasFile.aliases)) {
  const prev = setToPtcgl.get(a.set);
  if (!prev || (a.kind === 'main' && prev.kind !== 'main')) setToPtcgl.set(a.set, { code, kind: a.kind });
}

// ── CSV helpers ──────────────────────────────────────────────────────────────
const csvCell = (v) => {
  if (v === null || v === undefined) return '';
  const s = v instanceof Date ? v.toISOString() : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = (headers, rows) =>
  [headers.join(','), ...rows.map((r) => headers.map((h) => csvCell(r[h])).join(','))].join('\n') + '\n';
const writeOut = (name, content) => {
  const p = join(outDir, name);
  writeFileSync(p, content);
  return p;
};

const pool = makePool(1);
const written = [];

try {
  // ── resolve the target user ────────────────────────────────────────────────
  let userRow;
  if (userArg && /^\d+$/.test(userArg)) {
    ({ rows: [userRow] } = await pool.query('SELECT * FROM app_user WHERE id=$1', [Number(userArg)]));
  } else if (userArg) {
    ({ rows: [userRow] } = await pool.query('SELECT * FROM app_user WHERE username=$1', [userArg]));
  } else {
    ({ rows: [userRow] } = await pool.query('SELECT * FROM app_user ORDER BY id LIMIT 1'));
  }
  if (!userRow) { console.error('No matching app_user.'); process.exit(1); }
  const uid = userRow.id;
  console.log(`Exporting user #${uid} (${userRow.username}) → ${outDir}`);

  const q = (sql) => pool.query(sql, [uid]);

  // ── collection.csv ───────────────────────────────────────────────────────
  const collection = (await pool.query(`
    SELECT ci.id, c.name AS card_name, s.tcgdex_id AS set_id, s.name AS set_name,
           c.local_id, cv.display_name AS variant, vtr.tier,
           ci.quantity, ci.condition, ci.first_added_at, ci.updated_at,
           ci.card_variant_id,
           (SELECT market_minor FROM price_current p WHERE p.card_variant_id=cv.id
              AND p.currency_code='USD' ORDER BY market_minor DESC NULLS LAST LIMIT 1) AS usd_market_minor,
           (SELECT market_minor FROM price_current p WHERE p.card_variant_id=cv.id
              AND p.currency_code='EUR' ORDER BY market_minor DESC NULLS LAST LIMIT 1) AS eur_market_minor
      FROM collection_item ci
      JOIN card_variant cv ON cv.id = ci.card_variant_id
      JOIN card c          ON c.id = cv.card_id
      JOIN card_set s      ON s.id = c.set_id
      LEFT JOIN variant_tier_resolved vtr ON vtr.card_variant_id = cv.id
     WHERE ci.user_id = $1
     ORDER BY s.tcgdex_id, c.local_id_numeric NULLS LAST, c.local_id, cv.sort_order`, [uid])).rows;
  written.push(writeOut('collection.csv', csv(
    ['card_name', 'set_id', 'set_name', 'local_id', 'variant', 'tier', 'quantity',
     'condition', 'usd_market_minor', 'eur_market_minor', 'first_added_at', 'updated_at'],
    collection)));

  // ── lists.csv (all lists, one row per item) ────────────────────────────────
  const listItems = (await pool.query(`
    SELECT cl.name AS list_name, cl.kind AS list_kind, cl.visibility, cl.description AS list_description,
           li.position, li.static_quantity, li.note, li.added_at,
           c.name AS card_name, s.tcgdex_id AS set_id, c.local_id, cv.display_name AS variant,
           d.name AS dex_species
      FROM list_item li
      JOIN card_list cl        ON cl.id = li.list_id
      LEFT JOIN card_variant cv ON cv.id = li.card_variant_id
      LEFT JOIN card c          ON c.id = cv.card_id
      LEFT JOIN card_set s      ON s.id = c.set_id
      LEFT JOIN dex_species d   ON d.id = li.dex_id
     WHERE li.user_id = $1
     ORDER BY cl.name, li.position`, [uid])).rows;
  written.push(writeOut('lists.csv', csv(
    ['list_name', 'list_kind', 'visibility', 'position', 'card_name', 'set_id', 'local_id',
     'variant', 'dex_species', 'static_quantity', 'note', 'added_at'],
    listItems)));

  // ── decks.csv (all decks, one row per card) ────────────────────────────────
  const deckCards = (await pool.query(`
    SELECT dk.name AS deck_name, dk.format_code, dk.glc_type,
           c.category, c.name AS card_name, s.tcgdex_id AS set_id, c.local_id, dc.quantity
      FROM deck_card dc
      JOIN deck dk    ON dk.id = dc.deck_id
      JOIN card c     ON c.id = dc.card_id
      JOIN card_set s ON s.id = c.set_id
     WHERE dc.user_id = $1
     ORDER BY dk.name,
              CASE c.category WHEN 'Pokemon' THEN 1 WHEN 'Trainer' THEN 2 ELSE 3 END,
              c.name`, [uid])).rows;
  written.push(writeOut('decks.csv', csv(
    ['deck_name', 'format_code', 'glc_type', 'category', 'card_name', 'set_id', 'local_id', 'quantity'],
    deckCards)));

  // ── per-deck PTCG Live text (reuse serializePtcgl) ─────────────────────────
  const decks = (await q('SELECT * FROM deck WHERE user_id=$1 ORDER BY name')).rows;
  const sectionOf = (cat) => (cat === 'Pokemon' ? 'pokemon' : cat === 'Trainer' ? 'trainer' : 'energy');
  const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'deck';
  for (const dk of decks) {
    const cards = (await pool.query(`
      SELECT c.category, c.name, c.local_id, s.tcgdex_id AS set_id, dc.quantity
        FROM deck_card dc
        JOIN card c     ON c.id = dc.card_id
        JOIN card_set s ON s.id = c.set_id
       WHERE dc.deck_id = $1
       ORDER BY CASE c.category WHEN 'Pokemon' THEN 1 WHEN 'Trainer' THEN 2 ELSE 3 END, c.name`,
      [dk.id])).rows;
    const lines = cards.map((r) => ({
      quantity: r.quantity,
      name: r.name,
      setCode: setToPtcgl.get(r.set_id)?.code ?? null,
      number: r.local_id,
      print: null,
      section: sectionOf(r.category),
    }));
    written.push(writeOut(`deck-${slug(dk.name)}-${dk.id.slice(0, 8)}.ptcgl.txt`, serializePtcgl(lines)));
  }

  // ── full JSON export (everything user-owned) ───────────────────────────────
  const one = async (sql) => (await pool.query(sql, [uid])).rows;
  const full = {
    exported_at: new Date().toISOString(),
    schema_note: 'pokedex user-owned data export. Catalog (sets/cards/variants/prices) is global and intentionally excluded.',
    app_user: userRow,
    user_settings: (await one('SELECT * FROM user_settings WHERE user_id=$1'))[0] ?? null,
    user_profile: (await one('SELECT * FROM user_profile WHERE user_id=$1'))[0] ?? null,
    user_showcase: await one('SELECT * FROM user_showcase WHERE user_id=$1 ORDER BY slot'),
    collection_item: collection,
    collection_event: await one('SELECT * FROM collection_event WHERE user_id=$1 ORDER BY occurred_at'),
    graded_card: await one('SELECT * FROM graded_card WHERE user_id=$1 ORDER BY id'),
    card_note: await one('SELECT * FROM card_note WHERE user_id=$1 ORDER BY id'),
    card_list: await one('SELECT * FROM card_list WHERE user_id=$1 ORDER BY created_at'),
    list_item: listItems,
    binder_placement: await one('SELECT * FROM binder_placement WHERE user_id=$1 ORDER BY card_list_id, slot_index'),
    deck: decks,
    deck_card: deckCards,
    user_dex_state: await one('SELECT * FROM user_dex_state WHERE user_id=$1 ORDER BY dex_id'),
    user_set_progress: await one('SELECT * FROM user_set_progress WHERE user_id=$1 ORDER BY set_id, goal'),
    collection_value_point: await one('SELECT * FROM collection_value_point WHERE user_id=$1 ORDER BY observed_on, currency_code'),
  };
  written.push(writeOut('pokedex-export.json', JSON.stringify(full, null, 2) + '\n'));

  // ── report ─────────────────────────────────────────────────────────────────
  console.log(`\nWrote ${written.length} file(s):`);
  for (const p of written) console.log('  ' + p);
  console.log(`\ncollection rows: ${collection.length} (owned qty>0: ${collection.filter((r) => r.quantity > 0).length})`);
  console.log(`list items: ${listItems.length}  ·  deck cards: ${deckCards.length}  ·  decks: ${decks.length}`);
} finally {
  await pool.end();
}
