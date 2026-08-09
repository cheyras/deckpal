import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

/**
 * A tiny, boring, forward-only migration runner.
 *
 * Why not an ORM / migration framework? research/SCHEMA.md (2,985 lines) is
 * hand-written, authoritative SQL with partitioning, generated columns, partial
 * unique indexes, views and CHECK constraints an ORM would fight or silently
 * paper over. Plain numbered `.sql` files keep that SQL the source of truth.
 *
 * Contract:
 *  - files are `NNN_name.sql`, applied in filename order.
 *  - each file runs inside ONE transaction; a failure rolls the whole file back.
 *  - applied files are recorded in `schema_migrations` with a sha256 checksum.
 *  - re-running is a no-op; a checksum change on an already-applied file is a
 *    hard error (edit-in-place of shipped migrations is forbidden — add a new one).
 *  - a migration whose first line is `-- @supabase-only` is skipped unless
 *    the env var `SUPABASE_MODE` is truthy. This lets self-host deployments
 *    run plain Postgres without Supabase-specific DDL (RLS policies, auth.users
 *    FK, etc.).
 */

export interface MigrationResult {
  version: string;
  applied: boolean;
  checksum: string;
}

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

interface Migration {
  version: string;
  file: string;
  sql: string;
  checksum: string;
  supabaseOnly: boolean;
}

function listMigrations(): Migration[] {
  return readdirSync(migrationsDir)
    .filter((f) => /^\d+.*\.sql$/.test(f))
    .sort()
    .map((file) => {
      const sql = readFileSync(join(migrationsDir, file), 'utf-8');
      const supabaseOnly = sql.startsWith('-- @supabase-only');
      return { version: file.replace(/\.sql$/, ''), file, sql, checksum: sha256(sql), supabaseOnly };
    });
}

async function ensureTable(client: pg.PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    TEXT PRIMARY KEY,
      checksum   TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

export async function migrateUp(pool: pg.Pool): Promise<MigrationResult[]> {
  const migrations = listMigrations();
  const supabaseMode = !!process.env.SUPABASE_MODE;
  const results: MigrationResult[] = [];
  const client = await pool.connect();
  try {
    await ensureTable(client);
    const { rows } = await client.query<{ version: string; checksum: string }>(
      'SELECT version, checksum FROM schema_migrations',
    );
    const applied = new Map(rows.map((r) => [r.version, r.checksum]));

    for (const m of migrations) {
      const prior = applied.get(m.version);
      if (prior !== undefined) {
        if (prior !== m.checksum) {
          throw new Error(
            `checksum mismatch for already-applied migration ${m.version}: ` +
              `stored ${prior.slice(0, 12)} vs file ${m.checksum.slice(0, 12)}. ` +
              `Shipped migrations are immutable — add a new migration instead of editing.`,
          );
        }
        results.push({ version: m.version, applied: false, checksum: m.checksum });
        continue;
      }
      // Skip Supabase-only migrations on plain Postgres.
      if (m.supabaseOnly && !supabaseMode) {
        results.push({ version: m.version, applied: false, checksum: m.checksum });
        continue;
      }
      // ── Supabase preflight: clean orphaned app_user rows before 021 ────
      // Migration 013 seeds an app_user row (the self-host default user).
      // Migration 020 converts its id from BIGINT to a random UUID. On a
      // fresh Supabase project that UUID has no matching auth.users entry, so
      // 021's FK `app_user(id) REFERENCES auth.users(id)` would fail.
      // Fix: delete any app_user rows whose id is not in auth.users.  The
      // CASCADE on user_settings/user_profile cleans up the 1:1 children.
      // This is safe on re-run (no-op when no orphans exist).
      if (supabaseMode && m.version === '021_rls_policies') {
        const { rowCount } = await client.query(`
          DELETE FROM app_user
           WHERE id NOT IN (SELECT id FROM auth.users)
        `);
        if (rowCount && rowCount > 0) {
          console.log(
            `  preflight: removed ${rowCount} orphaned app_user row(s) with no auth.users entry`,
          );
        }
      }

      await client.query('BEGIN');
      try {
        await client.query(m.sql);
        await client.query(
          'INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)',
          [m.version, m.checksum],
        );
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`migration ${m.version} failed: ${(err as Error).message}`);
      }
      results.push({ version: m.version, applied: true, checksum: m.checksum });
    }
    return results;
  } finally {
    client.release();
  }
}

export async function migrationStatus(
  pool: pg.Pool,
): Promise<{ version: string; applied: boolean }[]> {
  const migrations = listMigrations();
  const client = await pool.connect();
  try {
    await ensureTable(client);
    const { rows } = await client.query<{ version: string }>(
      'SELECT version FROM schema_migrations',
    );
    const applied = new Set(rows.map((r) => r.version));
    return migrations.map((m) => ({ version: m.version, applied: applied.has(m.version) }));
  } finally {
    client.release();
  }
}
