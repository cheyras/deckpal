// One-command dev: `pnpm dev` at the repo root.
//
// The web app alone is not a working app — it proxies /api to the API server
// and /deckscout/images to the image tier (see apps/web/vite.config.ts). Before
// this existed those had to be started by hand in separate terminals, which is
// how a fresh clone ends up looking like "the backend won't connect".
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

if (!existsSync(envPath)) {
  console.error(
    '\n  No .env at the repo root. Copy .env.example to .env and fill in your\n' +
      '  database credentials first — every service below needs it.\n',
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

// The image shim imports from apps/api/dist, so the API must be built at least
// once. Checking here turns a confusing runtime ESM error into a clear message.
const needsBuild = !existsSync(join(root, 'apps/api/dist/images/handler.js'));

const SERVICES = [
  { name: 'api  ', color: 36, cmd: 'pnpm', args: ['--filter', 'deckscout-api', 'dev'] },
  { name: 'web  ', color: 32, cmd: 'pnpm', args: ['--filter', 'deckscout-web', 'dev'] },
  { name: 'image', color: 35, cmd: 'node', args: ['scripts/dev-images-server.mjs'] },
];

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
  // real error drowned in their interleaved startup logs. @deckscout/storage
  // is in the list because the image handler resolves its dist/ at runtime —
  // tsc alone passes without it (its exports map serves types from src/).
  const BUILDS = ['@deckscout/db', '@deckscout/storage', 'deckscout-api'];
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
