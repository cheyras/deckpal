#!/usr/bin/env node
// DeckScout — one-time local-data-to-Supabase migration (spec section 8).
//
// Reads the local Postgres database and writes catalog + user data to a
// Supabase-hosted Postgres.  The single legacy BIGINT user_id is mapped to a
// target Supabase Auth UUID (passed as --target-user-id).
//
// Catalog tables (no user_id) are copied with ON CONFLICT DO NOTHING so the
// script is idempotent.  Per-user tables have user_id replaced with the target
// UUID.  Sequence-generated BIGINT ids are preserved as-is (they only need to
// be unique within a table, which they are).
//
// Usage:
//   node scripts/migrate-to-cloud.mjs --dry-run                 # plan against local DB
//   node scripts/migrate-to-cloud.mjs --target-user-id <UUID>   # real migration
//
// Env vars: PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD for the LOCAL DB.
//           SUPABASE_DB_URL for the target (direct connection, not pooled).

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');

const { makePool } = await import(join(REPO, 'packages/db/dist/index.js'));

// ── Arg parsing ─────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
let dryRun = false;
let targetUserId = '';

for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--dry-run') dryRun = true;
  else if (argv[i] === '--target-user-id' && argv[i + 1]) targetUserId = argv[++i];
  else if (argv[i] === '--help' || argv[i] === '-h') {
    console.log(`Usage: migrate-to-cloud.mjs [--dry-run] [--target-user-id <UUID>]

  --dry-run           Print migration plan against local DB (read-only)
  --target-user-id    Supabase Auth UUID to assign as the owner's user_id

Env: PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD for local DB
     SUPABASE_DB_URL for the target Supabase Postgres (real mode only)`);
    process.exit(0);
  }
}

if (!dryRun && !targetUserId) {
  console.error('Error: --target-user-id is required for a real migration (or use --dry-run)');
  process.exit(1);
}

if (targetUserId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(targetUserId)) {
  console.error(`Error: --target-user-id must be a valid UUID (got: ${targetUserId})`);
  process.exit(1);
}

// ── Table definitions ───────────────────────────────────────────────────────

/** Catalog tables: copied as-is, no user_id transformation. */
const CATALOG_TABLES = [
  // 002 vocabulary
  'currency', 'variant_finish', 'variant_print_subtype', 'variant_size',
  'variant_foil', 'variant_stamp', 'variant_print_run',
  // 003 catalog
  'catalogue', 'series', 'card_set', 'card',
  'card_type', 'card_subtype', 'card_tag', 'card_attack', 'card_ability', 'card_matchup',
  // 004 variants
  'variant_kind', 'variant_kind_stamp', 'card_variant', 'variant_tier_override',
  // 006 sync
  'sync_run', 'sync_cursor', 'catalog_change', 'image_asset',
  // 007 pricing
  'price_source', 'price_source_field_map', 'price_current', 'fx_rate',
  // NOTE: price_observation is partitioned and huge — migrated separately if at all
  // 008 dex
  'dex_species', 'dex_species_type', 'card_species', 'card_species_conflict',
  // 011 formats
  'format', 'format_regulation_mark', 'format_set_allowance', 'format_promo_allowance',
  'format_ban', 'format_exclusive_group', 'format_exclusive_group_member', 'ptcgl_set_alias',
  // 016 phash
  'card_image_phash',
];

/** Per-user tables: user_id (BIGINT in source) is replaced with the target UUID.
 *  singleton: true for 1:1 per-user tables (PK = user_id).  These use
 *  ON CONFLICT ... DO UPDATE so that business columns are preserved even when
 *  the Supabase signup trigger pre-created a bare row. */
const USER_TABLES = [
  // order matters: parent tables first (FK dependencies)
  { table: 'app_user',               idCol: 'id',      transform: 'root', singleton: true },
  { table: 'user_settings',          idCol: 'user_id', transform: 'fk',   singleton: true },
  { table: 'user_profile',           idCol: 'user_id', transform: 'fk',   singleton: true },
  { table: 'user_showcase',          idCol: 'user_id', transform: 'fk' },
  { table: 'collection_item',        idCol: 'user_id', transform: 'fk' },
  { table: 'collection_event',       idCol: 'user_id', transform: 'fk' },
  { table: 'graded_card',            idCol: 'user_id', transform: 'fk' },
  { table: 'card_note',              idCol: 'user_id', transform: 'fk' },
  { table: 'user_set_progress',      idCol: 'user_id', transform: 'fk' },
  { table: 'collection_value_point', idCol: 'user_id', transform: 'fk' },
  { table: 'user_dex_state',         idCol: 'user_id', transform: 'fk' },
  { table: 'card_list',              idCol: 'user_id', transform: 'fk' },
  { table: 'list_item',              idCol: 'user_id', transform: 'fk' },
  { table: 'binder_placement',       idCol: 'user_id', transform: 'fk' },
  { table: 'deck',                   idCol: 'user_id', transform: 'fk' },
  { table: 'deck_card',              idCol: 'user_id', transform: 'fk' },
  { table: 'deck_version',           idCol: 'user_id', transform: 'fk' },
  { table: 'battle_log',             idCol: 'user_id', transform: 'fk' },
];

// ── Helpers ─────────────────────────────────────────────────────────────────

async function getColumns(client, table) {
  const { rows } = await client.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1
     ORDER BY ordinal_position`, [table]
  );
  return rows.map(r => r.column_name);
}

async function rowCount(client, table) {
  const { rows } = await client.query(`SELECT COUNT(*)::int AS n FROM "${table}"`);
  return rows[0].n;
}

// ── Dry run ─────────────────────────────────────────────────────────────────

async function dryRunReport() {
  const pool = makePool(1);
  const client = await pool.connect();
  try {
    console.log('=== DeckScout Cloud Migration — Dry Run ===\n');

    // Check local schema version
    const { rows: migrations } = await client.query(
      `SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1`
    );
    console.log(`Local schema: ${migrations[0]?.version ?? '(no migrations applied)'}`);

    // Local user info
    const { rows: users } = await client.query('SELECT id, username FROM app_user');
    console.log(`Local users:  ${users.length}`);
    for (const u of users) {
      console.log(`  - id=${u.id} username=${u.username}`);
    }

    console.log('\n--- Catalog tables ---');
    let catalogTotal = 0;
    for (const table of CATALOG_TABLES) {
      try {
        const n = await rowCount(client, table);
        catalogTotal += n;
        if (n > 0) console.log(`  ${table.padEnd(35)} ${String(n).padStart(8)} rows`);
      } catch {
        console.log(`  ${table.padEnd(35)}   (missing)`);
      }
    }
    console.log(`  ${'TOTAL'.padEnd(35)} ${String(catalogTotal).padStart(8)} rows`);

    // Price observation (partitioned, reported separately)
    try {
      const n = await rowCount(client, 'price_observation');
      console.log(`\n  price_observation (partitioned)    ${String(n).padStart(8)} rows`);
      console.log('  NOTE: price_observation is NOT migrated by this script (too large,');
      console.log('  migrate partitions separately or rebuild from sync jobs).');
    } catch {
      // table might not exist or be empty
    }

    console.log('\n--- Per-user tables ---');
    let userTotal = 0;
    for (const { table, idCol } of USER_TABLES) {
      try {
        const n = await rowCount(client, table);
        userTotal += n;
        if (n > 0) console.log(`  ${table.padEnd(35)} ${String(n).padStart(8)} rows  (${idCol} -> UUID)`);
      } catch {
        console.log(`  ${table.padEnd(35)}   (missing)`);
      }
    }
    console.log(`  ${'TOTAL'.padEnd(35)} ${String(userTotal).padStart(8)} rows`);

    console.log('\n--- Migration plan ---');
    console.log(`1. Copy ${CATALOG_TABLES.length} catalog tables (${catalogTotal} rows) with ON CONFLICT DO NOTHING`);
    console.log(`2. Copy ${USER_TABLES.length} per-user tables (${userTotal} rows) with user_id -> <target UUID>`);
    console.log(`3. Reset sequences on target to max(id)+1`);
    console.log('\nRun without --dry-run and with --target-user-id <UUID> to execute.');
  } finally {
    client.release();
    await pool.end();
  }
}

// ── Real migration ──────────────────────────────────────────────────────────

async function migrate() {
  const supabaseUrl = process.env.SUPABASE_DB_URL;
  if (!supabaseUrl) {
    console.error('Error: SUPABASE_DB_URL env var required for real migration');
    process.exit(1);
  }

  // Source: local DB
  const srcPool = makePool(1);

  // Target: Supabase direct connection
  const pg = (await import('pg')).default;
  const tgtPool = new pg.Pool({ connectionString: supabaseUrl, max: 1 });

  const src = await srcPool.connect();
  const tgt = await tgtPool.connect();

  try {
    // Resolve the local user's old BIGINT id
    const { rows: users } = await src.query('SELECT id, username FROM app_user');
    if (users.length === 0) {
      console.error('Error: no users found in local database');
      process.exit(1);
    }
    if (users.length > 1) {
      console.warn(`Warning: ${users.length} users found; all will be mapped to ${targetUserId}`);
    }
    const oldUserId = users[0].id;
    console.log(`Mapping local user ${users[0].username} (id=${oldUserId}) -> ${targetUserId}\n`);

    // ── Catalog tables ────────────────────────────────────────────────────
    const BATCH_SIZE = 500;
    console.log('--- Catalog tables ---');
    for (const table of CATALOG_TABLES) {
      const cols = await getColumns(src, table);
      if (cols.length === 0) { console.log(`  ${table}: skipped (not found)`); continue; }

      const { rows } = await src.query(`SELECT * FROM "${table}"`);
      if (rows.length === 0) { continue; }

      const colList = cols.map(c => `"${c}"`).join(', ');

      let inserted = 0;
      for (let b = 0; b < rows.length; b += BATCH_SIZE) {
        const batch = rows.slice(b, b + BATCH_SIZE);
        const allVals = [];
        const valueClauses = [];
        for (let r = 0; r < batch.length; r++) {
          const offset = r * cols.length;
          const ph = cols.map((_, i) => `$${offset + i + 1}`).join(', ');
          valueClauses.push(`(${ph})`);
          for (const c of cols) allVals.push(batch[r][c]);
        }
        try {
          const result = await tgt.query(
            `INSERT INTO "${table}" (${colList}) OVERRIDING SYSTEM VALUE VALUES ${valueClauses.join(', ')} ON CONFLICT DO NOTHING`,
            allVals
          );
          inserted += result.rowCount;
        } catch (err) {
          // Deferrable constraints don't support ON CONFLICT — retry batch without it
          if (err.message.includes('deferrable')) {
            try {
              const result = await tgt.query(
                `INSERT INTO "${table}" (${colList}) OVERRIDING SYSTEM VALUE VALUES ${valueClauses.join(', ')}`,
                allVals
              );
              inserted += result.rowCount;
            } catch (e2) {
              // Batch has duplicates — fall back to row-by-row without ON CONFLICT
              for (const row of batch) {
                const vals = cols.map(c => row[c]);
                const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
                try {
                  await tgt.query(
                    `INSERT INTO "${table}" (${colList}) OVERRIDING SYSTEM VALUE VALUES (${placeholders})`,
                    vals
                  );
                  inserted++;
                } catch (e3) {
                  // duplicate key — already exists, skip
                }
              }
            }
          } else {
            console.error(`  ${table}: batch error at offset ${b}: ${err.message}`);
            // Fall back to row-by-row
            for (const row of batch) {
              const vals = cols.map(c => row[c]);
              const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
              try {
                await tgt.query(
                  `INSERT INTO "${table}" (${colList}) OVERRIDING SYSTEM VALUE VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
                  vals
                );
                inserted++;
              } catch (e2) {
                // skip individual row errors
              }
            }
          }
        }
      }
      console.log(`  ${table}: ${inserted}/${rows.length} rows`);
    }

    // ── Per-user tables ───────────────────────────────────────────────────
    console.log('\n--- Per-user tables ---');
    for (const { table, idCol, transform, singleton } of USER_TABLES) {
      const cols = await getColumns(src, table);
      if (cols.length === 0) { console.log(`  ${table}: skipped (not found)`); continue; }

      // The source DB has BIGINT user_ids (pre-020). The target has UUID.
      // We read from source and transform on insert.
      const { rows } = await src.query(`SELECT * FROM "${table}"`);
      if (rows.length === 0) { continue; }

      // Build target column list. For deck_version and battle_log, the source
      // may not have a user_id column (it was added in 020). We add it.
      let targetCols = [...cols];
      if ((table === 'deck_version' || table === 'battle_log') && !cols.includes('user_id')) {
        targetCols.push('user_id');
      }

      const colList = targetCols.map(c => `"${c}"`).join(', ');
      const placeholders = targetCols.map((_, i) => `$${i + 1}`).join(', ');

      // For singleton tables (app_user, user_settings, user_profile), use
      // ON CONFLICT ... DO UPDATE so that business columns from the local DB
      // overwrite the bare row the Supabase signup trigger may have created.
      // Without this, display_name, joined_on, etc. are silently lost.
      let conflictClause = 'ON CONFLICT DO NOTHING';
      if (singleton) {
        const pkCol = idCol;  // PK for singletons is always the idCol
        const updateCols = targetCols.filter(c => c !== pkCol);
        if (updateCols.length > 0) {
          const setClauses = updateCols.map(c => `"${c}" = EXCLUDED."${c}"`).join(', ');
          conflictClause = `ON CONFLICT ("${pkCol}") DO UPDATE SET ${setClauses}`;
        }
      }

      let inserted = 0;
      for (const row of rows) {
        const vals = targetCols.map(c => {
          if (c === idCol && transform === 'root') {
            return targetUserId;  // app_user.id
          }
          if (c === idCol && transform === 'fk') {
            return targetUserId;  // user_id FK
          }
          if (c === 'user_id' && !cols.includes('user_id')) {
            // deck_version/battle_log: user_id not in source, derive from target
            return targetUserId;
          }
          return row[c];
        });
        try {
          await tgt.query(
            `INSERT INTO "${table}" (${colList}) OVERRIDING SYSTEM VALUE VALUES (${placeholders}) ${conflictClause}`,
            vals
          );
          inserted++;
        } catch (err) {
          // Deferrable constraints don't support ON CONFLICT — retry without it
          if (err.message.includes('deferrable')) {
            try {
              await tgt.query(
                `INSERT INTO "${table}" (${colList}) OVERRIDING SYSTEM VALUE VALUES (${placeholders})`,
                vals
              );
              inserted++;
            } catch (e2) {
              // duplicate — already exists
            }
          } else {
            console.error(`  ${table}: error on row: ${err.message}`);
          }
        }
      }
      console.log(`  ${table}: ${inserted}/${rows.length} rows`);
    }

    // ── Reset sequences ─────────────────────────────────────────────────
    console.log('\n--- Resetting sequences ---');
    const seqTables = [
      'collection_item', 'collection_event', 'graded_card', 'card_note',
      'battle_log', 'series', 'card_set', 'card', 'card_variant',
      'sync_run', 'catalog_change', 'format_ban', 'format_exclusive_group',
      'variant_tier_override',
    ];
    for (const table of seqTables) {
      try {
        await tgt.query(
          `SELECT setval(pg_get_serial_sequence('"${table}"', 'id'),
                         COALESCE((SELECT MAX(id) FROM "${table}"), 0) + 1, false)`
        );
        console.log(`  ${table}: sequence reset`);
      } catch {
        // table might not have a sequence
      }
    }

    console.log('\nMigration complete.');
  } finally {
    src.release();
    tgt.release();
    await srcPool.end();
    await tgtPool.end();
  }
}

// ── Main ────────────────────────────────────────────────────────────────────
try {
  if (dryRun) {
    await dryRunReport();
  } else {
    await migrate();
  }
} catch (err) {
  console.error(err.message || err);
  process.exit(1);
}
