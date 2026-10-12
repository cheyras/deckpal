#!/usr/bin/env node
/**
 * pnpm mcp:audit — what the MCP tool surface costs a model, measured.
 *
 *   pnpm mcp:audit                 tools/list: every tool's description, schema
 *                                  and entry size, and the per-turn total.
 *   pnpm mcp:audit --responses     also seeds a disposable PostgreSQL cluster,
 *                                  starts the real API and MCP server against
 *                                  it, calls every read tool and prints what
 *                                  each result costs (apps/mcp/audit/).
 *   --json <path>                  write the numbers as JSON as well.
 *
 * --responses needs Linux and PostgreSQL 16 binaries with pgvector, found the
 * same way scripts/test-db-integration.mjs finds them (TEST_PG_BINDIR, and
 * TEST_PG_LIBRARY_PATH for relocated libraries). It never connects to an
 * existing database: it creates its own cluster on a private socket under
 * /tmp and removes it afterwards. On Windows, run it inside WSL.
 *
 * Build @deckpal/db, @deckpal/agent-tools, @deckpal/matching and @deckpal/sim
 * first; the server and the API load their dist/.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const responses = args.includes('--responses');
const jsonAt = args.includes('--json') ? args[args.indexOf('--json') + 1] : undefined;

const { measureSurface, renderSurface } = await import(pathToFileURL(join(REPO, 'apps/mcp/src/audit/surface.ts')).href);

const report = { surface: {} };
for (const [label, options] of [['full', {}], ['read-only connection', { readOnly: true }]]) {
  const surface = await measureSurface(options);
  report.surface[label] = surface;
  console.log(`\n== tools/list — ${label} ==\n`);
  console.log(label === 'full' ? renderSurface(surface) : renderSurface(surface).split('\n').slice(-3).join('\n'));
}

if (responses) {
  report.responses = runResponses();
}
if (jsonAt) writeFileSync(jsonAt, JSON.stringify(report, null, 2) + '\n');
if (report.responses && report.responses.status !== 'passed') process.exitCode = 1;

/** The response half, on a cluster this script owns for its lifetime. */
function runResponses() {
  if (process.platform !== 'linux') {
    console.error('\n--responses needs Linux and PostgreSQL 16 binaries; on Windows run `pnpm mcp:audit --responses` inside WSL.');
    process.exitCode = 1;
    return { status: 'skipped' };
  }
  if (existsSync(join(REPO, '.env'))) throw new Error('Refusing --responses: a repo-root .env exists, and the audit must not read it.');
  const bindir = process.env.TEST_PG_BINDIR ?? '/usr/lib/postgresql/16/bin';
  for (const bin of ['initdb', 'pg_ctl', 'psql']) {
    if (!existsSync(join(bindir, bin))) throw new Error(`--responses needs ${bin} in ${bindir} (set TEST_PG_BINDIR).`);
  }
  const library = process.env.TEST_PG_LIBRARY_PATH;
  const root = realpathSync(mkdtempSync('/tmp/deckpal-db-'));
  chmodSync(root, 0o700);
  const marker = randomUUID();
  writeFileSync(join(root, '.deckpal-ci-owner'), marker, { mode: 0o600 });
  const socket = join(root, 'socket');
  mkdirSync(socket, { mode: 0o700 });
  const data = join(root, 'data');
  const env = {
    PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', HOME: root, TMPDIR: root, TZ: 'UTC',
    PGHOST: socket, PGPORT: '55432', PGSSLMODE: 'disable', PGCONNECT_TIMEOUT: '5',
    ...(library ? { LD_LIBRARY_PATH: library } : {}),
    ...(process.env.ESBUILD_BINARY_PATH ? { ESBUILD_BINARY_PATH: process.env.ESBUILD_BINARY_PATH } : {}),
  };
  const run = (bin, argv, extra = {}) => {
    const r = spawnSync(join(bindir, bin), argv, { env: { ...env, ...extra }, encoding: 'utf8', timeout: 90_000 });
    if (r.status !== 0) throw new Error(`${bin} ${argv.join(' ')} failed:\n${r.stdout}${r.stderr}`);
  };
  const sql = (statement, database = 'postgres') =>
    run('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-d', database, '-c', statement], { PGUSER: 'deckpal_ci_admin' });
  const resultFile = join(root, 'result.json');
  try {
    run('initdb', ['-D', data, '-U', 'deckpal_ci_admin', '--auth=trust', '--no-locale', '--encoding=UTF8']);
    run('pg_ctl', ['-D', data, '-l', join(root, 'postgres.log'), '-w', '-t', '30', 'start', '-o',
      `-c listen_addresses='' -c unix_socket_directories='${socket}' -c unix_socket_permissions=0700 -c port=55432 -c timezone=UTC -c max_connections=20 -c fsync=off`]);
    sql('CREATE ROLE deckpal_ci_fixture LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE; GRANT pg_read_all_settings TO deckpal_ci_fixture;');
    sql('CREATE ROLE pokedex NOLOGIN; CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS; GRANT anon,authenticated,service_role TO deckpal_ci_fixture;');
    sql('CREATE DATABASE deckpal_mcp_audit OWNER deckpal_ci_fixture');
    sql('CREATE EXTENSION vector', 'deckpal_mcp_audit');
    const child = spawnSync(process.execPath, ['--import', join(REPO, 'node_modules/tsx/dist/loader.mjs'), join(REPO, 'apps/mcp/audit/responses.mjs')], {
      cwd: REPO,
      env: { ...env, PGUSER: 'deckpal_ci_fixture', PGDATABASE: 'deckpal_mcp_audit', DECKPAL_TEST_ROOT: root, DECKPAL_TEST_MARKER: marker, DECKPAL_TEST_RESULT: resultFile },
      stdio: 'inherit',
      timeout: 600_000,
    });
    if (child.status !== 0) console.error(`responses audit exited ${child.status}`);
    return existsSync(resultFile) ? JSON.parse(readFileSync(resultFile, 'utf8')) : { status: 'failed' };
  } finally {
    spawnSync(join(bindir, 'pg_ctl'), ['-D', data, '-m', 'immediate', '-w', '-t', '15', 'stop'], { env, encoding: 'utf8' });
    rmSync(root, { recursive: true, force: true });
  }
}
