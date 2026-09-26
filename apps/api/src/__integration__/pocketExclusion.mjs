#!/usr/bin/env node
/**
 * UXC-02 regression test: Pokémon TCG Pocket must not surface anywhere a
 * human or an agent browses the catalog (DECISIONS 2026-08-10).
 *
 * A disposable, throwaway PostgreSQL cluster — never a client of an existing
 * server, never the shared `scripts/test-db-integration.mjs` cluster (this
 * test manages its own so it cannot collide with, or destabilise, that
 * shared multi-purpose runner). It applies the REAL migrations (via
 * `@deckpal/db`'s `migrateUp`, so this exercises the actual `browsable_card`
 * / `browsable_set` views from migration 072, not a hand-copied schema),
 * seeds one physical card and one Pokémon TCG Pocket card that share a dex
 * species and a printed name ("Charizard ex" in sv01 vs. in Pocket's A1 --
 * the exact shape of the audit's repro), then calls the ACTUAL fixed
 * functions -- not a re-implementation of their SQL -- and asserts the
 * Pocket half never appears:
 *
 *   - apps/api/src/insights/pokedex.ts: dexCompletion, dexCapturedCount,
 *     speciesGrid, speciesDetail (card_pool, the captured-species CTE, and
 *     the species card list all excluded Pocket independently before this
 *     fix -- UXC-02's three named trouble spots)
 *   - apps/api/src/insights/collectionValue.ts: topMovers (defense in depth;
 *     the fixture gives the Pocket variant BOTH an owner and a price so the
 *     exclusion is proven, not just a side effect of missing price data)
 *   - packages/agent-tools/src/resolve.ts: resolveCard (the choke point
 *     get_card, log_cards, add_cards and edit_list all route through)
 *   - packages/agent-tools/src/entities.ts: resolveSet (the set_id resolver
 *     search_cards, get_card and set_progress all route through)
 *   - packages/agent-tools/src/tools/catalog.ts: the search_cards and
 *     set_progress(all_sets) tool handlers end to end
 *
 * Run: node --import tsx apps/api/src/__integration__/pocketExclusion.mjs
 * (from the repo root, or via `pnpm --filter deckpal-api test:pocket-exclusion`).
 * Needs PostgreSQL 14+ initdb/pg_ctl/psql/postgres on PATH or TEST_PG_BINDIR.
 * Portable to macOS and Linux (unlike test-db-integration.mjs, which is
 * deliberately Linux-only for the shared CI cluster).
 *
 * Environment isolation (B7's intent, applied to this test's own cluster):
 * refuses to run at all if a repo-root `.env` exists, and — before `migrateUp`
 * or any fixed function is imported — overwrites every PG* var this repo's
 * tooling reads and clears SUPABASE_MODE/DATABASE_URL/DIRECT_URL/SUPABASE_*,
 * so a developer shell configured for cloud-mode local dev cannot change this
 * test's behaviour (caught in review: SUPABASE_MODE inherited from such a
 * shell made `migrateUp` attempt migration 021's Supabase-only RLS policies
 * against this plain cluster, which has no `auth.users`).
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { accessSync, constants, existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolvePath(HERE, '..', '..', '..', '..');

/**
 * Refuse to run at all if a repo-root `.env` exists, mirroring
 * `scripts/test-db-integration.mjs`'s `assertNoEnvFile()`. This test's own
 * connection details are always explicit (never read from `.env`), but
 * `@deckpal/db`'s `loadEnv()` -- called by both `migrateUp()` and the API
 * app's module-level pool -- fills any *other* var a `.env` sets that this
 * script has not already overwritten, and a `.env` pointed at a real
 * database is exactly the "no existing database or connection URL" case B7
 * exists to rule out. A clean checkout has none; refusing is cheap insurance.
 */
function assertNoRepoEnvFile() {
  if (existsSync(join(REPO, '.env'))) {
    throw new Error('Refusing to run pocketExclusion.mjs: a repo-root .env exists. Use a clean checkout; its contents were not read.');
  }
}

function executable(path) {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function discoverBinDir() {
  const explicit = process.env.TEST_PG_BINDIR;
  const candidates = explicit ? [explicit] : [];
  if (!explicit) {
    // Homebrew (macOS): both the generic opt symlink and versioned kegs.
    candidates.push('/opt/homebrew/opt/postgresql/bin', '/usr/local/opt/postgresql/bin');
    for (const cellar of ['/opt/homebrew/Cellar', '/usr/local/Cellar']) {
      if (!existsSync(cellar)) continue;
      for (const pkg of readdirSync(cellar).filter((d) => d.startsWith('postgresql'))) {
        const versions = existsSync(join(cellar, pkg)) ? readdirSync(join(cellar, pkg)) : [];
        for (const v of versions.sort().reverse()) candidates.push(join(cellar, pkg, v, 'bin'));
      }
    }
    // Debian/Ubuntu (Linux CI).
    if (existsSync('/usr/lib/postgresql')) {
      for (const v of readdirSync('/usr/lib/postgresql').sort((a, b) => Number(b) - Number(a))) {
        candidates.push(join('/usr/lib/postgresql', v, 'bin'));
      }
    }
    candidates.push('/usr/local/pgsql/bin');
  }
  const found = candidates.find((c) => ['initdb', 'pg_ctl', 'psql', 'postgres'].every((n) => executable(join(c, n))));
  if (!found) {
    throw new Error(
      'pocketExclusion.mjs needs PostgreSQL 14+ initdb/pg_ctl/psql/postgres. ' +
        'Set TEST_PG_BINDIR to their directory (e.g. the output of `pg_config --bindir`).',
    );
  }
  return realpathSync(found);
}

let activeChild;

function run(binary, args, opts = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(binary, args, { env: opts.env, stdio: ['ignore', 'pipe', 'pipe'] });
    activeChild = child;
    let output = '';
    child.stdout.on('data', (d) => (output += d));
    child.stderr.on('data', (d) => (output += d));
    child.once('error', (err) => {
      if (activeChild === child) activeChild = undefined;
      rejectRun(err);
    });
    child.once('close', (code) => {
      if (activeChild === child) activeChild = undefined;
      if (!(opts.accepted ?? [0]).includes(code)) {
        rejectRun(new Error(`${binary} ${args.join(' ')} failed (exit ${code}):\n${output.slice(-4000)}`));
      } else resolveRun({ code, output });
    });
  });
}

let scratch;
let bindir;
let pool;
let toolsCtx;
let cleaningUp = false;

/**
 * Cluster teardown reachable from both the normal `finally` and a signal —
 * every path that can leave a `bootCluster()` partway through (a failing
 * provisioning `psql` call, Ctrl-C) must still stop the server and remove the
 * temp directory. `stopCluster()` itself is safe to call before the server
 * ever started (it checks for `PG_VERSION` first) and safe to call twice.
 */
async function cleanupAndExit(code) {
  if (cleaningUp) return;
  cleaningUp = true;
  activeChild?.kill('SIGTERM');
  await pool?.end().catch(() => {});
  await stopCluster().catch((err) => console.error('[pocketExclusion] cleanup failed:', err.message));
  process.exit(code);
}
process.on('SIGINT', () => void cleanupAndExit(130));
process.on('SIGTERM', () => void cleanupAndExit(143));

async function bootCluster() {
  bindir = discoverBinDir();
  // `/tmp` directly, not `os.tmpdir()`: on macOS the latter is a long
  // per-session path under /private/var/folders/..., and a Unix-domain
  // socket path is capped at ~103 bytes -- exactly the failure
  // scripts/test-db-integration.mjs avoids by using the same `/tmp` root.
  scratch = realpathSync(mkdtempSync(join('/tmp', 'deckpal-pocket-test-')));
  const data = join(scratch, 'data');
  const socket = join(scratch, 'socket');
  mkdirSync(socket, { recursive: true });
  // An ALLOWLIST, not `{...process.env, ...}` — deliberately not the same
  // shape as the isolation block later in main(), which only overwrites the
  // handful of vars this repo's own code reads. `psql` here is real libpq,
  // and libpq honours several connection-target env vars this script never
  // sets and has no reason to allow through: `PGHOSTADDR` in particular
  // takes precedence over `-h`/`PGHOST` for the actual TCP target, so an
  // inherited one would silently redirect these `CREATE ROLE`/`CREATE
  // DATABASE` calls to a real, unrelated server (caught in review). C locale
  // (LANG/LC_ALL) sidesteps a real failure mode on macOS Homebrew builds:
  // "postmaster became multithreaded during startup" when they're unset or
  // non-C, per the same fix scripts/test-db-integration.mjs applies.
  const env = {
    PATH: `${bindir}:/usr/bin:/bin`,
    LANG: 'C', LC_ALL: 'C', HOME: scratch, TMPDIR: scratch, TZ: 'UTC',
  };
  await run(join(bindir, 'initdb'), ['-D', data, '-U', 'deckpal_pocket_admin', '--auth=trust', '--no-locale', '--encoding=UTF8'], { env });
  await run(join(bindir, 'pg_ctl'), [
    '-D', data, '-l', join(scratch, 'postgres.log'), '-w', '-t', '30', 'start',
    '-o', `-c listen_addresses='' -c unix_socket_directories='${socket}' -c port=55491 -c fsync=off -c timezone=UTC`,
  ], { env });
  // Every libpq connection-target var explicitly named and pinned, not just
  // `-h`/`-p`/`-U`/`-d`: PGHOSTADDR/PGSERVICE/PGSSLMODE/etc. are all absent
  // from `env` above already, but naming the ones a stray shell is most
  // likely to carry (PGHOST/PGPORT/PGHOSTADDR) as empty makes the refusal to
  // inherit them explicit rather than relying on the allowlist's silence.
  const psqlEnv = { ...env, PGHOST: '', PGPORT: '', PGHOSTADDR: '', PGSSLMODE: 'disable', PGPASSWORD: '' };
  const psql = (sql) =>
    run(join(bindir, 'psql'), ['-h', socket, '-p', '55491', '-U', 'deckpal_pocket_admin', '-d', 'postgres', '-X', '-v', 'ON_ERROR_STOP=1', '-c', sql], {
      env: psqlEnv,
    });
  // The role is named `pokedex`, matching what several migrations assume is
  // the connecting role (e.g. 007_pricing.sql REVOKEs privileges from it),
  // and SUPERUSER because migration 051 does `CREATE EXTENSION vector`,
  // which plain CREATEDB privilege cannot do. Both are fine on a cluster
  // that lives for the length of this script and nowhere else.
  await psql('CREATE ROLE pokedex LOGIN SUPERUSER;');
  await psql('CREATE DATABASE deckpal OWNER pokedex;');
  return { host: socket, port: 55491, user: 'pokedex', database: 'deckpal' };
}

/**
 * Stop the server and only then remove its files — CONFIRMING shutdown
 * first, never assuming it from a swallowed error. The earlier version
 * `.catch(() => {})`'d the stop command and deleted the data directory
 * unconditionally, so a stop that failed for a real reason (not just
 * "already stopped", which is `pg_ctl`'s documented exit code 3) could
 * delete a running server's files out from under it. Caught in review.
 */
async function stopCluster() {
  if (!scratch) return;
  const data = join(scratch, 'data');
  if (existsSync(join(data, 'PG_VERSION'))) {
    const status = await run(join(bindir, 'pg_ctl'), ['-D', data, 'status'], { accepted: [0, 3] });
    if (status.code === 0) {
      await run(join(bindir, 'pg_ctl'), ['-D', data, '-m', 'immediate', '-w', '-t', '15', 'stop'], { accepted: [0, 3] });
      const stopped = await run(join(bindir, 'pg_ctl'), ['-D', data, 'status'], { accepted: [0, 3] });
      if (stopped.code !== 3) {
        console.error(`[pocketExclusion] could not confirm shutdown of the cluster at ${data} -- leaving its files in place for diagnosis rather than deleting them under a server that may still be running.`);
        return;
      }
    }
  }
  rmSync(scratch, { recursive: true, force: true });
}

async function seedFixture(client) {
  const q = (text, params) => client.query(text, params);

  const physicalSeries = (
    await q(
      `INSERT INTO series (catalogue_code, tcgdex_id, slug, name, first_release_on, sort_order)
       VALUES ('en', 'sv01', 'scarlet-violet', 'Scarlet & Violet', '2023-03-31', 10) RETURNING id`,
    )
  ).rows[0].id;
  // Pocket's series carries catalogue_code = 'en' too -- the real importer
  // never distinguishes it (apps/sync/src/catalog/import.ts's `CATALOGUE =
  // 'en'` constant), which is the actual mechanism behind UXC-02 and exactly
  // why `catalogue.is_enabled` cannot be the exclusion predicate.
  const pocketSeries = (
    await q(
      `INSERT INTO series (catalogue_code, tcgdex_id, slug, name, first_release_on, sort_order)
       VALUES ('en', 'tcgp', 'pokemon-tcg-pocket', 'Pokémon TCG Pocket', '2024-10-30', 0) RETURNING id`,
    )
  ).rows[0].id;

  const physicalSet = (
    await q(
      `INSERT INTO card_set (series_id, tcgdex_id, slug, name, released_on, card_count_official, card_count_total, is_promo)
       VALUES ($1, 'sv01', 'sv01', 'Scarlet & Violet Base Set', '2023-03-31', 198, 258, false) RETURNING id`,
      [physicalSeries],
    )
  ).rows[0].id;
  const pocketSet = (
    await q(
      `INSERT INTO card_set (series_id, tcgdex_id, slug, name, released_on, card_count_official, card_count_total, is_promo)
       VALUES ($1, 'A1', 'A1', 'Genetic Apex', '2024-10-30', 226, 286, false) RETURNING id`,
      [pocketSeries],
    )
  ).rows[0].id;

  // Same printed name in both games, per the audit's own repro shape.
  const physicalCard = (
    await q(
      `INSERT INTO card (set_id, tcgdex_id, lang, local_id, local_id_numeric, number_sort, name, name_normalized, category, rarity)
       VALUES ($1, 'sv01-6', 'en', '006', 6, 'A000006', 'Charizard ex', 'charizard ex', 'Pokemon', 'Double Rare') RETURNING id`,
      [physicalSet],
    )
  ).rows[0].id;
  const pocketCard = (
    await q(
      `INSERT INTO card (set_id, tcgdex_id, lang, local_id, local_id_numeric, number_sort, name, name_normalized, category, rarity)
       VALUES ($1, 'A1-036', 'en', '036', 36, 'A000036', 'Charizard ex', 'charizard ex', 'Pokemon', 'Immersive') RETURNING id`,
      [pocketSet],
    )
  ).rows[0].id;
  // A SECOND Pocket card the user never owns -- the control for the
  // owned-exception below. It must never resolve by id, unlike pocketCard.
  const pocketCardNeverOwned = (
    await q(
      `INSERT INTO card (set_id, tcgdex_id, lang, local_id, local_id_numeric, number_sort, name, name_normalized, category, rarity)
       VALUES ($1, 'A1-037', 'en', '037', 37, 'A000037', 'Blastoise ex', 'blastoise ex', 'Pokemon', 'Immersive') RETURNING id`,
      [pocketSet],
    )
  ).rows[0].id;

  await q(
    `INSERT INTO variant_kind (code, display_name, finish, size, print_run_code, tier_derived, tier_rule_version)
     VALUES ('normal', 'Normal', 'normal', 'standard', 'base', 'standard', 1) ON CONFLICT DO NOTHING`,
  );
  const physicalVariant = (
    await q(`INSERT INTO card_variant (card_id, variant_kind_code, sort_order, is_primary) VALUES ($1, 'normal', 1, true) RETURNING id`, [physicalCard])
  ).rows[0].id;
  const pocketVariant = (
    await q(`INSERT INTO card_variant (card_id, variant_kind_code, sort_order, is_primary) VALUES ($1, 'normal', 1, true) RETURNING id`, [pocketCard])
  ).rows[0].id;

  // dex_species is populated by the (not-run-here) sync importer; a fresh
  // migrated DB has none, so this is the only dex row -- both cards feature
  // the same species (Charizard, #6), matching UXC-02's "cardPool inflated,
  // species LVL blocked" complaint.
  await q(`INSERT INTO dex_species (id, identifier, name, generation, dex_order) VALUES (6, 'charizard', 'Charizard', 1, 6) ON CONFLICT DO NOTHING`);
  await q(`INSERT INTO card_species (card_id, dex_id, ord, source) VALUES ($1, 6, 0, 'tcgdex')`, [physicalCard]);
  await q(`INSERT INTO card_species (card_id, dex_id, ord, source) VALUES ($1, 6, 0, 'tcgdex')`, [pocketCard]);

  // A priced quote on the Pocket variant, so topMovers' exclusion is proven
  // rather than a side effect of Pocket simply having no price feed.
  await q(
    `INSERT INTO price_current (card_variant_id, source_code, currency_code, market_minor, avg30_minor) VALUES ($1, 'tcgcsv', 'USD', 10000, 9000)`,
    [pocketVariant],
  );

  // The seed migration's default user (013_seed.sql) -- reused rather than
  // creating a second one, since nothing here needs isolation from it.
  const userId = (await q(`SELECT id FROM app_user WHERE username = 'cheyras'`)).rows[0].id;

  // The edge case this fix must also cover: the user ALREADY owns the Pocket
  // printing (e.g. added through the bug before this PR). Owning it must not
  // count as having captured Charizard, and it must not appear as a mover.
  await q(`INSERT INTO collection_item (user_id, card_variant_id, quantity) VALUES ($1, $2, 1)`, [userId, pocketVariant]);

  return {
    userId,
    physicalCardId: 'sv01-6',
    pocketCardId: 'A1-036',
    pocketCardNeverOwnedId: 'A1-037',
    pocketVariantId: pocketVariant,
  };
}

async function main() {
  assertNoRepoEnvFile();
  const results = [];
  const check = async (name, fn) => {
    try {
      await fn();
      results.push({ name, ok: true });
      console.log(`ok - ${name}`);
    } catch (err) {
      results.push({ name, ok: false, error: err.message });
      console.error(`FAIL - ${name}\n  ${err.message}`);
    }
  };

  try {
    // `bootCluster()` runs INSIDE this try, not before it: `initdb` can
    // succeed and `pg_ctl start` can bring a real postmaster up before either
    // provisioning `psql` call (CREATE ROLE / CREATE DATABASE) fails, and a
    // throw at that point must still reach `stopCluster()` in `finally` below
    // — caught in review, where it previously ran ahead of the try block and
    // could leave the server and its temp directory behind on that failure.
    const conn = await bootCluster();

    // Isolate the whole process's environment from whatever the invoking
    // shell has configured -- BEFORE anything reads it. This matters twice
    // over: `migrateUp()` below reads `SUPABASE_MODE` to decide which
    // migrations to skip (a developer shell configured for cloud-mode local
    // dev, e.g. `set -a && . ./.env && set +a`, would otherwise leave it set,
    // and migration 021's RLS policies reference `auth.users`, which this
    // plain disposable cluster does not have -- caught in review), and the
    // API app's own module-level pool (apps/api/src/db.ts) reads PG* at
    // import time. Every value is OVERWRITTEN (not defaulted), and every
    // connection-shaped var this repo's own tooling reads is cleared, so an
    // inherited value can never leak into either the migration run or the
    // fixed functions under test -- the same isolation property
    // scripts/test-db-integration.mjs enforces for its own shared cluster,
    // applied here to this test's own disposable one (see the file header
    // for why this test does not share that cluster).
    for (const key of ['SUPABASE_MODE', 'DATABASE_URL', 'DIRECT_URL', 'SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'SUPABASE_ANON_KEY']) {
      delete process.env[key];
    }
    process.env.PGHOST = conn.host;
    process.env.PGPORT = String(conn.port);
    process.env.PGUSER = conn.user;
    process.env.PGDATABASE = conn.database;
    process.env.PGPASSWORD = '';
    process.env.PGSSLMODE = 'disable';

    pool = new pg.Pool(conn);
    const { migrateUp } = await import(pathToFileURL(join(REPO, 'packages/db/src/migrate.ts')));
    const migrations = await migrateUp(pool);
    const failed = migrations.filter((m) => !m.applied && !m.skipped);
    assert.equal(failed.length, 0, `every migration must be applied or a deliberate supabase-only skip, unexpected: ${JSON.stringify(failed)}`);

    const fixture = await seedFixture(pool);

    const { dexCompletion, speciesGrid, speciesDetail, dexCapturedCount } = await import(
      pathToFileURL(join(REPO, 'apps/api/src/insights/pokedex.ts'))
    );
    const { topMovers } = await import(pathToFileURL(join(REPO, 'apps/api/src/insights/collectionValue.ts')));
    const { resolveCard, resolveCardsBatch } = await import(pathToFileURL(join(REPO, 'packages/agent-tools/src/resolve.ts')));
    const { resolveSet } = await import(pathToFileURL(join(REPO, 'packages/agent-tools/src/entities.ts')));
    const { catalogTools } = await import(pathToFileURL(join(REPO, 'packages/agent-tools/src/tools/catalog.ts')));
    const [searchCardsTool, , setProgressTool] = catalogTools;

    toolsCtx = { db: pool, api: {}, userId: fixture.userId };

    await check('dexCapturedCount ignores an owned Pocket-only capture', async () => {
      assert.equal(await dexCapturedCount(fixture.userId), 0);
    });

    await check('dexCompletion: captured 0, total 1 (Pocket card_species row excluded from the total too)', async () => {
      const completion = await dexCompletion(fixture.userId);
      assert.equal(completion.captured, 0);
      assert.equal(completion.total, 1);
    });

    await check('speciesGrid: cardPool counts only the physical printing', async () => {
      const grid = await speciesGrid(fixture.userId, { page: 1, pageSize: 10 });
      const row = grid.species.find((s) => s.speciesId === 6);
      assert.ok(row, 'Charizard row must be present');
      assert.equal(row.cardPool, 1);
      assert.equal(row.uniqueOwned, 0);
      assert.equal(row.captured, false);
    });

    await check('speciesDetail: card_pool and the card list both exclude Pocket', async () => {
      const detail = await speciesDetail(fixture.userId, '6');
      assert.equal(detail.species.cardPool, 1);
      assert.equal(detail.cards.length, 1);
      assert.equal(detail.cards[0].cardId, fixture.physicalCardId);
    });

    await check('resolveCard: a Pocket card the user has never owned does not resolve', async () => {
      const res = await resolveCard(toolsCtx, { card_id: fixture.pocketCardNeverOwnedId });
      assert.equal(res.status, 'not_found');
    });

    // The Astra-flagged case: a Pocket card the user ALREADY owns (this
    // fixture's pocketVariant, qty 1) must still resolve by its EXACT id —
    // otherwise log_cards/edit_list have no way to zero it out or remove it,
    // and a user who got one before this fix shipped is stuck with it
    // forever. It must NOT resolve by name (that would be discoverable
    // browsing), and once its owned quantity reaches zero it must stop
    // resolving at all, so this is cleanup-only, never re-acquisition.
    await check('resolveCard: an OWNED Pocket card resolves by exact id, for cleanup', async () => {
      const res = await resolveCard(toolsCtx, { card_id: fixture.pocketCardId });
      assert.equal(res.status, 'ok');
      assert.equal(res.card.tcgdexId, fixture.pocketCardId);
    });

    await check('resolveCardsBatch: the same owned-exception applies in the batch path log_cards uses', async () => {
      const { resolved, fallback } = await resolveCardsBatch(toolsCtx, [{ card_id: fixture.pocketCardId }, { card_id: fixture.pocketCardNeverOwnedId }]);
      assert.equal(resolved.get(0)?.tcgdexId, fixture.pocketCardId, 'the owned Pocket card resolves');
      assert.equal(resolved.has(1), false, 'the never-owned Pocket card does not');
      assert.equal(fallback.get(1)?.status, 'not_found');
    });

    await check('resolveCard: a name shared with a Pocket card resolves uniquely to the physical one, even though the Pocket printing is owned', async () => {
      const res = await resolveCard(toolsCtx, { name: 'Charizard ex' });
      assert.equal(res.status, 'ok');
      assert.equal(res.card.tcgdexId, fixture.physicalCardId, 'name resolution stays browsable-only even for an owned Pocket card');
    });

    await check('resolveSet: the Pocket set id does not resolve, the physical one does', async () => {
      const pocket = await resolveSet(toolsCtx, 'A1');
      assert.equal(pocket.kind, 'not-found');
      const physical = await resolveSet(toolsCtx, 'sv01');
      assert.equal(physical.kind, 'found');
    });

    await check('search_cards tool: excludes the Pocket card from a shared-name search', async () => {
      const res = await searchCardsTool.handler({ query: 'Charizard ex', page: 1, page_size: 20 }, toolsCtx);
      assert.ok(!res.isError);
      assert.ok(res.text.includes(fixture.physicalCardId));
      assert.ok(!res.text.includes(fixture.pocketCardId));
    });

    await check('set_progress(all_sets) tool: excludes the Pocket set from "every set in the catalog"', async () => {
      const res = await setProgressTool.handler({ all_sets: true, goal: 'complete', page: 1, page_size: 50 }, toolsCtx);
      assert.ok(!res.isError);
      assert.ok(res.text.includes('sv01'));
      assert.ok(!res.text.includes('Genetic Apex') && !res.text.includes('(A1)'));
    });

    await check('topMovers: excludes an owned AND priced Pocket variant', async () => {
      const movers = await topMovers(fixture.userId, 'USD');
      assert.deepEqual(movers, []);
    });

    // LAST: mutates the fixture (zeroes the owned Pocket variant), so every
    // check above that depends on it still being owned (topMovers, the
    // owned-exception checks) must run first.
    //
    // Proves the retry-safety fix directly: gated on the collection_item ROW
    // existing (not on quantity > 0), so resolution returns the SAME result
    // before and after the quantity that a log_cards batch would zero it to.
    // A quantity-gated version resolved this one way pre-write and a
    // DIFFERENT way (dropped) on an identical retry post-write, which
    // changed log_cards' resolved-item fingerprint and let an unrelated item
    // in the same batch be silently re-applied (caught in review, Astra).
    await check('resolveCard: resolution is STABLE across the write a log_cards retry would replay (retry safety)', async () => {
      const before = await resolveCard(toolsCtx, { card_id: fixture.pocketCardId });
      assert.equal(before.status, 'ok', 'resolves while owned, same as the earlier cleanup check');
      await pool.query('UPDATE collection_item SET quantity = 0 WHERE card_variant_id = $1', [fixture.pocketVariantId]);
      const after = await resolveCard(toolsCtx, { card_id: fixture.pocketCardId });
      assert.equal(after.status, 'ok', 'must resolve the SAME way post-write, or a retried batch computes a different idempotency key');
      assert.equal(after.card.tcgdexId, before.card.tcgdexId);
    });

    // Astra's exact repro shape: a mixed batch (a Pocket-card decrement +
    // a physical-card increment), resolved twice -- once as the "first
    // call" would see it, once as an identical retry would see it after the
    // first call's write already landed. Both resolutions must produce the
    // SAME two-item set, or log_cards' resolved-item fingerprint changes
    // between the original call and its retry and the physical card's
    // increment gets silently re-applied.
    await check('resolveCardsBatch: a mixed batch resolves identically pre- and post-write (Astra\'s repro)', async () => {
      const refs = [{ card_id: fixture.pocketCardId }, { card_id: fixture.physicalCardId }];
      const first = await resolveCardsBatch(toolsCtx, refs);
      const firstIds = [...first.resolved.values()].map((c) => c.tcgdexId).sort();
      // Quantity is already 0 from the previous check, so this simulates the
      // retry directly rather than re-deriving a second write.
      const retry = await resolveCardsBatch(toolsCtx, refs);
      const retryIds = [...retry.resolved.values()].map((c) => c.tcgdexId).sort();
      assert.deepEqual(retryIds, firstIds, 'the retry must resolve the same items the original call did');
      assert.deepEqual(firstIds, [fixture.physicalCardId, fixture.pocketCardId].sort());
    });
  } finally {
    await pool?.end().catch(() => {});
    await stopCluster();
  }

  const failedCount = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failedCount}/${results.length} checks passed.`);
  if (failedCount > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
