// One-command dev: `pnpm dev` at the repo root.
//
// The web app is never a working app on its own — it proxies /api and
// /deckpal/images to a backend (see apps/web/vite.config.ts). What changed in
// 2026-08 is WHICH backend it gets by default: the live deployment, rather than
// a local API that a fresh clone has to stand up a database for first. Starting
// those services by hand in separate terminals is how a clone used to end up
// looking like "the backend won't connect"; needing Postgres, migrations and a
// warmed image cache before you could see a single card was the rest of it.
//
// Dependency-free on purpose (no concurrently/npm-run-all): the repo already
// keeps its tooling footprint deliberately small, and this is 60 lines of
// child_process.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = join(root, '.env');

// Two modes (AGENTS.md B12):
//
//   pnpm dev            → the web app alone, proxied to the LIVE deployment.
//                         Real accounts, real data, real images. No .env, no
//                         database, no migrations — a fresh clone just runs.
//   pnpm dev --local    → the old full stack: local API + local image tier
//                         against your own Postgres. For API/schema work.
//
// A flag rather than an inline environment variable, because
// `DECKPAL_DEV_BACKEND=local pnpm dev` is not a thing you can type on Windows
// cmd, and this repo takes fresh-clone friction seriously.
const wantsLocal =
  process.argv.includes('--local') ||
  process.env.DECKPAL_DEV_BACKEND === 'local' ||
  // A worktree lane running its own API on its own port is, definitionally,
  // working locally. Silently proxying it to production would mean its API
  // changes are never exercised (roadmap/ORCHESTRATION.md port table).
  !!process.env.DECKPAL_DEV_API_PORT;

if (wantsLocal && !existsSync(envPath)) {
  console.error(
    '\n  No .env at the repo root, and --local needs one: it starts a database-\n' +
      '  backed API. Copy .env.example to .env and fill it in — or just run\n' +
      '  `pnpm dev`, which needs no setup at all and talks to the live backend.\n',
  );
  process.exit(1);
}

// Load .env and hand it to every child.
//
// The API and web dev server each call loadEnv() themselves, but the image
// shim reads process.env directly — so without this it starts fine and then
// 500s every single image with "SUPABASE_URL ... required", which looks like a
// broken image tier rather than a missing variable. Doing it once here means
// no service can be started without its environment, which is the whole point
// of a clone-and-run script. Mirrors packages/db/src/env.ts, deliberately: a
// dev orchestrator must not import from a package that has to be built first.
function readDotEnv() {
  const out = {};
  if (!existsSync(envPath)) return out;
  for (const raw of readFileSync(envPath, 'utf-8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[line.slice(0, eq).trim()] = val;
  }
  return out;
}

// Real shell variables win, same precedence as packages/db/src/env.ts.
const childEnv = { ...readDotEnv(), ...process.env };
if (wantsLocal) childEnv.DECKPAL_DEV_BACKEND = 'local';

// The image shim imports from apps/api/dist, so the API must be built at least
// once. Checking here turns a confusing runtime ESM error into a clear message.
// Irrelevant in live mode — nothing local is started, so nothing needs building.
const needsBuild = wantsLocal && !existsSync(join(root, 'apps/api/dist/images/handler.js'));

const WEB = { name: 'web  ', color: 32, cmd: 'pnpm', args: ['--filter', 'deckpal-web', 'dev'] };

// Live mode runs the web dev server ONLY. The API and image tier it would
// otherwise start are already running — in production — and the Vite proxy
// points at them (apps/web/vite.config.ts). This is what removes the setup
// cliff: no Postgres, no migrations, no image cache, no .env.
const SERVICES = wantsLocal
  ? [
      { name: 'api  ', color: 36, cmd: 'pnpm', args: ['--filter', 'deckpal-api', 'dev'] },
      WEB,
      { name: 'image', color: 35, cmd: 'node', args: ['scripts/dev-images-server.mjs'] },
    ]
  : [WEB];

const children = [];
let shuttingDown = false;

function start({ name, color, cmd, args }) {
  const child = spawn(cmd, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: childEnv });
  const tag = `\x1b[${color}m${name}\x1b[0m │ `;
  const pipe = (stream) => {
    stream.setEncoding('utf8');
    let buf = '';
    stream.on('data', (chunk) => {
      buf += chunk;
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) console.log(tag + line);
    });
  };
  pipe(child.stdout);
  pipe(child.stderr);
  child.on('exit', (code) => {
    if (shuttingDown) return;
    console.log(`${tag}exited with code ${code} — shutting the rest down`);
    shutdown(code ?? 1);
  });
  children.push(child);
}

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) c.kill('SIGTERM');
  setTimeout(() => process.exit(code), 300);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

if (needsBuild) {
  console.log('Building the API once (the image shim imports from apps/api/dist)…');
  // In dependency order, checking every exit code: on a fresh clone a failed
  // (or skipped) build used to let all three services start anyway, and the
  // real error drowned in their interleaved startup logs. @deckpal/storage
  // is in the list because the image handler resolves its dist/ at runtime —
  // tsc alone passes without it (its exports map serves types from src/).
  const BUILDS = ['@deckpal/db', '@deckpal/storage', 'deckpal-api'];
  const buildNext = (i) => {
    if (i >= BUILDS.length) return SERVICES.forEach(start);
    const build = spawn('pnpm', ['--filter', BUILDS[i], 'build'], { cwd: root, stdio: 'inherit', env: childEnv });
    build.on('exit', (code) => {
      if (code !== 0) {
        console.error(`\n  Build of ${BUILDS[i]} failed (exit ${code}) — not starting services.\n`);
        process.exit(code ?? 1);
      }
      buildNext(i + 1);
    });
  };
  buildNext(0);
} else {
  SERVICES.forEach(start);
}
