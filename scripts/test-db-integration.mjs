#!/usr/bin/env node
/**
 * A disposable PostgreSQL boundary test, never a client of an existing server.
 * TEST_PG_BINDIR and optional TEST_PG_LIBRARY_PATH locate test binaries;
 * TEST_ARTIFACT_DIR selects evidence output.
 * No connection URL is accepted. Source-root .env causes a refusal before any
 * application import because @deckpal/db/loadEnv resolves that path itself.
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import {
  accessSync, appendFileSync, chmodSync, constants, existsSync, lstatSync,
  mkdirSync, mkdtempSync, readFileSync, realpathSync, readdirSync, rmSync, writeFileSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ARTIFACTS = process.env.TEST_ARTIFACT_DIR
  ? resolve(process.env.TEST_ARTIFACT_DIR)
  : mkdtempSync('/tmp/deckpal-db-results-');
mkdirSync(ARTIFACTS, { recursive: true });
const LOG = join(ARTIFACTS, 'integration.log');
writeFileSync(LOG, '');
const result = {
  status: 'running',
  scope: 'Real PostgreSQL, production Express series/prices routes, shared history tool and default chat adapter. Focused fixture schema; not full migrations, RLS or production infrastructure.',
  isolation: {
    externalTargetAccepted: false,
    inheritedConnectionEnvironmentIgnored: Object.keys(process.env)
      .filter((key) => /^(PG|SUPABASE|DATABASE_URL$|DIRECT_URL$)/i.test(key)).sort(),
    envFileLoaded: false,
    listenAddresses: '',
    socketOnly: true,
    dataDirectory: null,
    socketDirectory: null,
    temporaryRoot: null,
    clusterStopped: false,
    temporaryRootRemoved: false,
  },
  cases: [],
};
let scratch;
let data;
let socket;
let bindir;
let pgLibrary;
let cleanEnv;
let activeChild;
let activeStartup = false;
let signal;
let cleaning = false;
const marker = randomUUID();

function log(message) {
  appendFileSync(LOG, message + '\n');
  console.log(message);
}
function assertNoEnvFile() {
  try {
    lstatSync(join(REPO, '.env'));
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  throw new Error('Refusing database integration: repo-root .env exists. Use a clean checkout without .env; its contents were not read.');
}
function executable(path) {
  try { accessSync(path, constants.X_OK); return true; } catch { return false; }
}
function discoverBinaries() {
  const explicit = process.env.TEST_PG_BINDIR;
  if (explicit && !isAbsolute(explicit)) throw new Error('TEST_PG_BINDIR must be an absolute binary directory, not a connection target.');
  const candidates = explicit ? [explicit] : [];
  if (!explicit) {
    const system = '/usr/lib/postgresql';
    if (existsSync(system)) {
      for (const version of readdirSync(system).sort((a, b) => Number(b) - Number(a))) {
        candidates.push(join(system, version, 'bin'));
      }
    }
    candidates.push('/usr/local/pgsql/bin');
    for (const config of ['/usr/bin/pg_config', '/usr/local/bin/pg_config']) {
      if (!executable(config)) continue;
      const found = spawnSync(config, ['--bindir'], {
        env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' }, encoding: 'utf8', timeout: 5000,
      });
      if (found.status === 0 && isAbsolute(found.stdout.trim())) candidates.push(found.stdout.trim());
    }
  }
  const found = candidates.find((candidate) =>
    ['initdb', 'pg_ctl', 'psql', 'postgres'].every((name) => executable(join(candidate, name))));
  if (!found) throw new Error(
    'PostgreSQL integration cannot run: initdb, pg_ctl and psql are required. Provision PostgreSQL 16 binaries and set TEST_PG_BINDIR to their directory. Missing binaries are a failure, never a skipped pass.',
  );
  return realpathSync(found);
}
function run(binary, args, options = {}) {
  if (signal && !cleaning) throw new Error('Interrupted by ' + signal);
  const accepted = options.accepted ?? [0];
  const timeoutMs = options.timeoutMs ?? 90_000;
  log('> ' + binary + ' ' + args.join(' '));
  return new Promise((resolveRun, rejectRun) => {
    let output = '';
    let timedOut = false;
    const child = spawn(binary, args, {
      cwd: scratch,
      env: { ...cleanEnv, ...(dirname(binary) === bindir && pgLibrary ? { LD_LIBRARY_PATH: pgLibrary } : {}), ...options.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    activeChild = child;
    activeStartup = binary === join(bindir, 'pg_ctl') && args.includes('start');
    const collect = (chunk) => {
      const text = chunk.toString();
      output += text;
      appendFileSync(LOG, text);
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    let force;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      force = setTimeout(() => child.kill('SIGKILL'), 5000);
      force.unref();
    }, timeoutMs);
    const done = () => {
      clearTimeout(timer);
      if (force) clearTimeout(force);
      if (activeChild === child) { activeChild = undefined; activeStartup = false; }
    };
    child.once('error', (error) => { done(); rejectRun(error); });
    child.once('close', (code) => {
      done();
      if (timedOut || (signal && !cleaning) || !accepted.includes(code)) {
        rejectRun(new Error(
          `${binary} failed (exit ${code}${timedOut ? ', timeout' : ''}${signal ? ', ' + signal : ''}):\n${output.slice(-8000)}`,
        ));
      } else resolveRun({ code, output });
    });
  });
}
function verifyOwnedRoot() {
  assert.ok(scratch && data && socket, 'cleanup needs a recorded owned cluster');
  assert.equal(realpathSync(scratch), scratch, 'temporary root changed');
  assert.equal(dirname(scratch), '/tmp', 'temporary root must be a direct child of /tmp');
  assert.match(scratch, /^\/tmp\/deckpal-db-[^/]+$/);
  assert.equal(readFileSync(join(scratch, '.deckpal-ci-owner'), 'utf8'), marker, 'ownership marker changed');
  for (const path of [data, socket]) {
    assert.equal(dirname(path), scratch);
    if (existsSync(path)) {
      assert.equal(realpathSync(path), path, 'owned cluster paths cannot be symlinks');
    }
  }
}
function onSignal(name) {
  signal = name;
  // Let pg_ctl finish its bounded startup wait before cleanup checks/stops the
  // server; interrupting that wait can race a postmaster still starting.
  if (!cleaning && !activeStartup) activeChild?.kill('SIGTERM');
}
const interrupt = () => onSignal('SIGINT');
const terminate = () => onSignal('SIGTERM');
process.on('SIGINT', interrupt);
process.on('SIGTERM', terminate);

try {
  if (process.argv.length !== 2) throw new Error('No arguments or external database URLs are accepted; this runner always creates its own cluster.');
  if (process.platform !== 'linux') throw new Error('Disposable PostgreSQL integration requires Linux and Unix sockets.');
  if (process.getuid?.() === 0) throw new Error('Run disposable PostgreSQL integration as a non-root user; initdb must not run as root.');
  assertNoEnvFile();
  bindir = discoverBinaries();
  if (process.env.TEST_PG_LIBRARY_PATH) {
    if (!isAbsolute(process.env.TEST_PG_LIBRARY_PATH)) throw new Error('TEST_PG_LIBRARY_PATH must be an absolute directory.');
    pgLibrary = realpathSync(process.env.TEST_PG_LIBRARY_PATH);
  }
  scratch = realpathSync(mkdtempSync('/tmp/deckpal-db-'));
  chmodSync(scratch, 0o700);
  data = join(scratch, 'data');
  socket = join(scratch, 'socket');
  mkdirSync(socket, { mode: 0o700 });
  writeFileSync(join(scratch, '.deckpal-ci-owner'), marker, { mode: 0o600 });
  Object.assign(result.isolation, {
    dataDirectory: data, socketDirectory: socket, temporaryRoot: scratch,
    binaryDirectory: bindir, role: 'deckpal_ci_fixture', database: 'deckpal_ci_test',
  });
  // An allowlist, not a blacklist: no inherited PG*, Supabase, DATABASE_URL,
  // NODE_OPTIONS, dotenv loader, service/pass file or credential can participate.
  cleanEnv = {
    PATH: '/usr/bin:/bin',
    LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8',
    HOME: scratch, TMPDIR: scratch,
    TZ: 'UTC',
    PGHOST: socket, PGPORT: '55432',
    PGDATABASE: 'postgres', PGUSER: 'deckpal_ci_admin',
    PGPASSWORD: '', PGSSLMODE: 'disable',
    PGCONNECT_TIMEOUT: '5', PGAPPNAME: 'deckpal-disposable-integration',
  };
  const version = await run(join(bindir, 'postgres'), ['--version']);
  result.postgresVersion = version.output.trim();
  await run(join(bindir, 'initdb'), ['-D', data, '-U', 'deckpal_ci_admin', '--auth=trust', '--no-locale', '--encoding=UTF8']);
  await run(join(bindir, 'pg_ctl'), [
    '-D', data, '-l', join(scratch, 'postgres.log'), '-w', '-t', '30', 'start',
    '-o', `-c listen_addresses='' -c unix_socket_directories='${socket}' -c unix_socket_permissions=0700 -c port=55432 -c timezone=UTC -c max_connections=10 -c fsync=off`,
  ]);
  await run(join(bindir, 'psql'), ['-X', '-v', 'ON_ERROR_STOP=1', '-c', 'CREATE ROLE deckpal_ci_fixture LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE; GRANT pg_read_all_settings TO deckpal_ci_fixture;']);
  await run(join(bindir, 'psql'), ['-X', '-v', 'ON_ERROR_STOP=1', '-c', 'CREATE DATABASE deckpal_ci_test OWNER deckpal_ci_fixture;']);

  for (const timezone of ['UTC', 'America/Denver']) {
    assertNoEnvFile();
    const caseFile = join(scratch, timezone.replace('/', '-') + '.json');
    await run(process.execPath, [
      '--import', join(REPO, 'node_modules', 'tsx', 'dist', 'loader.mjs'),
      join(REPO, 'apps', 'api', 'src', '__integration__', 'routes.mjs'),
    ], {
      timeoutMs: 120_000,
      env: {
        PGUSER: 'deckpal_ci_fixture', PGDATABASE: 'deckpal_ci_test', TZ: timezone,
        DECKPAL_TEST_ROOT: scratch, DECKPAL_TEST_MARKER: marker,
        DECKPAL_TEST_RESULT: caseFile,
      },
    });
    const evidence = JSON.parse(readFileSync(caseFile, 'utf8'));
    assert.equal(evidence.timezone, timezone);
    assert.equal(evidence.status, 'passed');
    result.cases.push(evidence);
  }
  result.status = 'passed';
} catch (error) {
  result.status = 'failed';
  result.error = error.message;
  log('FAIL: ' + error.message);
  process.exitCode = 1;
} finally {
  cleaning = true;
  if (scratch) {
    try {
      verifyOwnedRoot();
      if (existsSync(join(data, 'PG_VERSION'))) {
        const status = await run(join(bindir, 'pg_ctl'), ['-D', data, 'status'], { accepted: [0, 3] });
        if (status.code === 0) {
          await run(join(bindir, 'pg_ctl'), ['-D', data, '-m', 'immediate', '-w', '-t', '15', 'stop'], { timeoutMs: 25_000 });
        }
        const stopped = await run(join(bindir, 'pg_ctl'), ['-D', data, 'status'], { accepted: [3] });
        assert.equal(stopped.code, 3, 'owned PostgreSQL cluster must be stopped before removing files');
      }
      result.isolation.clusterStopped = true;
      if (existsSync(join(scratch, 'postgres.log'))) {
        writeFileSync(join(ARTIFACTS, 'postgres.log'), readFileSync(join(scratch, 'postgres.log')));
      }
      verifyOwnedRoot();
      rmSync(scratch, { recursive: true, force: false });
      result.isolation.temporaryRootRemoved = !existsSync(scratch);
      assert.equal(result.isolation.temporaryRootRemoved, true);
    } catch (error) {
      result.status = 'failed';
      result.cleanupError = error.message;
      process.exitCode = 1;
      log('Cleanup failed; preserved owned directory for diagnosis: ' + error.message);
    }
  }
  process.off('SIGINT', interrupt);
  process.off('SIGTERM', terminate);
  writeFileSync(join(ARTIFACTS, 'integration-results.json'), JSON.stringify(result, null, 2) + '\n');
  log('Database integration ' + result.status + ': ' + join(ARTIFACTS, 'integration-results.json'));
}
