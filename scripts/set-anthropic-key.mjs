#!/usr/bin/env node
/**
 * pnpm ai:set-anthropic-key — put the owner's Anthropic API key where DeckPal
 * reads it, without the key ever being shown, logged, or passed as an argument.
 *
 *   1. Prompts for the key with hidden input (nothing is echoed).
 *   2. Checks its shape (`sk-ant-…`, not an admin key or an OAuth token).
 *   3. Optionally checks it with Anthropic's free `GET /v1/models` — OK or
 *      failed, nothing else.
 *   4. Writes `ANTHROPIC_API_KEY=` into the repo's `.env` (creating or
 *      replacing that one line, leaving every other line and the file's mode
 *      alone; refuses if `.env` is not gitignored).
 *   5. Adds it to the linked Vercel project's Production environment with
 *      `vercel env add`, the value on STDIN. Offers to replace an existing
 *      value, and optionally adds Preview and Development too.
 *   6. Prints what it changed — file names and Vercel targets, never a value —
 *      and how to redeploy so Production picks it up.
 *
 * Run it yourself, in PowerShell, Windows Terminal or Git Bash:
 *
 *   pnpm ai:set-anthropic-key            # do it
 *   pnpm ai:set-anthropic-key --dry-run  # everything except the writes
 *
 * `--dry-run` still reads the key and runs the read-only checks (format, the
 * optional models call, `vercel whoami`, `vercel env ls`), then prints the
 * plan instead of writing `.env` or calling `vercel env add`.
 *
 * This is the only sanctioned way to set the key: agents must not run the
 * Vercel half (AGENTS.md B9), and the key must never be pasted into a chat.
 * What the key does once set: apps/api/src/decke/aiRoute.ts; DEPLOYMENT.md.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

export const VAR = 'ANTHROPIC_API_KEY';
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ── Pure helpers (tested in scripts/__tests__/set-anthropic-key.test.mjs) ────

/** `null` when the key looks usable, otherwise the reason it does not. */
export function keyProblem(key) {
  if (typeof key !== 'string' || key.length === 0) return 'no key was entered';
  if (/\s/.test(key)) return 'the key contains whitespace';
  if (!key.startsWith('sk-ant-')) return 'an Anthropic API key starts with "sk-ant-"';
  if (key.startsWith('sk-ant-admin')) return 'that is an Admin API key; DeckPal needs a regular API key';
  if (key.startsWith('sk-ant-oat')) return 'that is an OAuth token, not an API key';
  if (!/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(key)) return 'the key has unexpected characters or is too short';
  return null;
}

const LINE = new RegExp(`^[ \\t]*(?:export[ \\t]+)?${VAR}[ \\t]*=.*$`, 'gm');

/**
 * `content` with exactly one `ANTHROPIC_API_KEY=` line holding `key`: the first
 * existing line is replaced in place, any later duplicates are dropped, and if
 * there was none the line is appended. Every other line is untouched.
 */
export function upsertEnvLine(content, key) {
  const line = `${VAR}=${key}`;
  let seen = false;
  const next = content.replace(LINE, () => (seen ? '\u0000DROP\u0000' : ((seen = true), line)));
  if (seen) return { content: next.replace(/\u0000DROP\u0000\r?\n?/g, ''), action: 'updated' };
  const sep = content.length === 0 || content.endsWith('\n') ? '' : '\n';
  return { content: `${content}${sep}${line}\n`, action: 'created' };
}

/** Names in `vercel env ls` output. Only the first column is read. */
export function envNames(listing) {
  const names = new Set();
  for (const raw of String(listing).split(/\r?\n/)) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s+/.exec(raw);
    if (m) names.add(m[1]);
  }
  return names;
}

/** The exact `vercel` argument list for one target. The value is never in it. */
export function addArgs(target, replace) {
  return ['env', 'add', VAR, '--environment', target,
    // Development cannot hold Sensitive variables on Vercel.
    target === 'development' ? '--no-sensitive' : '--sensitive',
    ...(replace ? ['--force'] : []), '--yes'];
}

/** Replace every occurrence of `secret` in `text` — for any output we echo. */
export function redact(text, secret) {
  return secret ? String(text).split(secret).join('[redacted]') : String(text);
}

// ── Real IO ─────────────────────────────────────────────────────────────────

/** Hidden single-line input. Never echoes; refuses rather than echo. */
function readSecret(prompt) {
  return new Promise((resolve, reject) => {
    const { stdin, stdout } = process;
    stdout.write(prompt);
    if (stdin.isTTY) {
      let value = '';
      stdin.setRawMode(true);
      stdin.resume();
      stdin.setEncoding('utf8');
      const done = (err) => {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener('data', onData);
        stdout.write('\n');
        if (err) reject(err); else resolve(value);
      };
      const onData = (chunk) => {
        for (const ch of chunk) {
          if (ch === '\r' || ch === '\n') return done();
          if (ch === '\u0003') return done(new Error('cancelled'));
          if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
          else if (ch >= ' ') value += ch;
        }
      };
      stdin.on('data', onData);
      return;
    }
    // Git Bash's mintty is not a Windows console, so Node sees no TTY. The
    // POSIX terminal under it still honours `stty -echo`.
    const off = spawnSync('stty', ['-echo'], { stdio: ['inherit', 'ignore', 'ignore'] });
    if (off.status !== 0) {
      stdout.write('\n');
      reject(new Error('cannot hide input here (no terminal), so nothing was read. Run it from PowerShell or ' +
        'Windows Terminal; in Git Bash\'s own window, `winpty node scripts/set-anthropic-key.mjs` gives it a console.'));
      return;
    }
    const rl = createInterface({ input: stdin, terminal: false });
    rl.once('line', (line) => {
      rl.close();
      spawnSync('stty', ['echo'], { stdio: ['inherit', 'ignore', 'ignore'] });
      stdout.write('\n');
      resolve(line.trim());
    });
  });
}

function ask(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => { rl.close(); resolve(answer.trim()); });
  });
}

function vercelBin() {
  if (process.env.DECKPAL_VERCEL_BIN) return process.env.DECKPAL_VERCEL_BIN;
  return 'vercel';
}

function runVercel(args, input) {
  const env = { ...process.env };
  // The npm global bin is not always on PATH in a fresh shell (CLAUDE.local.md).
  if (process.platform === 'win32' && process.env.APPDATA) env.PATH = `${env.PATH};${path.join(process.env.APPDATA, 'npm')}`;
  const r = spawnSync(vercelBin(), args, {
    cwd: REPO, env, input: input ?? '', encoding: 'utf8',
    // `vercel` is a .cmd shim on Windows. The arguments are fixed tokens; the
    // value only ever travels on stdin.
    shell: process.platform === 'win32',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? (r.error ? String(r.error.message) : '') };
}

async function checkWithAnthropic(key, fetchImpl = fetch) {
  try {
    const res = await fetchImpl('https://api.anthropic.com/v1/models?limit=1', {
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      signal: AbortSignal.timeout(15_000),
    });
    return res.ok ? { ok: true } : { ok: false, why: `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, why: err?.name === 'TimeoutError' ? 'timed out' : 'network error' };
  }
}

function gitIgnored(file) {
  const r = spawnSync('git', ['check-ignore', '-q', file], { cwd: REPO });
  return r.status === 0;
}

function writeEnv(file, key) {
  const exists = existsSync(file);
  const before = exists ? readFileSync(file, 'utf8') : '';
  const { content, action } = upsertEnvLine(before, key);
  if (exists) {
    const mode = statSync(file).mode;
    writeFileSync(file, content);          // same inode: mode and ownership kept
    if (process.platform !== 'win32') chmodSync(file, mode & 0o7777);
  } else {
    writeFileSync(file, content, { mode: 0o600 });
  }
  return action;
}

export const realIo = {
  readSecret, ask, runVercel, checkWithAnthropic, gitIgnored, writeEnv,
  log: (line) => console.log(line),
  repo: REPO,
  exists: (p) => existsSync(p),
};

// ── The flow ────────────────────────────────────────────────────────────────

const yes = (answer, dflt) => (answer === '' ? dflt : /^y(es)?$/i.test(answer));

export async function main(argv = process.argv.slice(2), io = realIo) {
  const dryRun = argv.includes('--dry-run');
  const changed = [];
  const say = (line) => io.log(line);
  say(`DeckPal — set ${VAR}${dryRun ? ' (dry run: nothing will be written)' : ''}`);
  say('Paste the key and press Enter. Nothing will be shown while you type or paste.');

  const key = await io.readSecret('Anthropic API key: ');
  const problem = keyProblem(key);
  if (problem) { say(`Not saved: ${problem}.`); return 1; }
  say('Format: OK (sk-ant-…).');
  const safe = (text) => redact(text, key);

  if (yes(await io.ask('Check it with Anthropic now? It lists models, which is free. [Y/n] '), true)) {
    const check = await io.checkWithAnthropic(key);
    say(check.ok ? 'Anthropic check: OK.' : `Anthropic check: FAILED (${check.why}).`);
    if (!check.ok && !yes(await io.ask('Save it anyway? [y/N] '), false)) { say('Nothing changed.'); return 1; }
  }

  // ── .env ──
  const envFile = path.join(io.repo, '.env');
  if (!io.gitIgnored('.env')) {
    say('Refusing to write .env: git does not ignore it here, so the key could be committed. Nothing changed.');
    return 1;
  }
  if (dryRun) say(`Would ${io.exists(envFile) ? 'update' : 'create'} the ${VAR} line in .env.`);
  else {
    const action = io.writeEnv(envFile, key);
    changed.push(`.env — ${VAR} line ${action} (other lines untouched)`);
  }

  // ── Vercel ──
  if (!io.exists(path.join(io.repo, '.vercel', 'project.json'))) {
    say('Vercel: this checkout is not linked (no .vercel/project.json). Run `vercel link --yes --scope deck-pal`, then run this again to set Vercel.');
  } else if (io.runVercel(['whoami']).status !== 0) {
    say('Vercel: not logged in. Run `vercel login` in your own terminal, then run this again to set Vercel.');
  } else {
    const targets = ['production'];
    if (yes(await io.ask('Also add it to Preview? [y/N] '), false)) targets.push('preview');
    if (yes(await io.ask('Also add it to Development (`vercel dev` / `vercel env pull`)? [y/N] '), false)) targets.push('development');
    for (const target of targets) {
      const listing = io.runVercel(['env', 'ls', '--environment', target]);
      if (listing.status !== 0) { say(`Vercel ${target}: could not list variables (${safe(listing.stderr).trim().split('\n').pop()}). Skipped.`); continue; }
      const exists = envNames(listing.stdout).has(VAR);
      if (exists && !yes(await io.ask(`Vercel ${target} already has ${VAR}. Replace it? [y/N] `), false)) {
        say(`Vercel ${target}: kept the existing value.`);
        continue;
      }
      const args = addArgs(target, exists);
      if (dryRun) { say(`Would run: vercel ${args.join(' ')}   (value on stdin)`); continue; }
      const r = io.runVercel(args, key);
      if (r.status === 0) changed.push(`Vercel ${target} — ${VAR} ${exists ? 'replaced' : 'added'}`);
      else say(`Vercel ${target}: FAILED — ${safe(r.stderr || r.stdout).trim().split('\n').slice(-2).join(' ')}`);
    }
  }

  // ── Report ──
  say('');
  if (dryRun) { say('Dry run complete. Nothing was written.'); return 0; }
  if (changed.length === 0) say('Nothing changed.');
  else { say('Changed:'); for (const c of changed) say(`  - ${c}`); }
  if (changed.some((c) => c.startsWith('Vercel production'))) {
    say('');
    say('Production only reads environment variables at deploy time, so redeploy for it to take effect:');
    say('  vercel ls --prod                                  # copy the newest Production URL');
    say('  vercel redeploy <that-url> --environment production');
    say('  (or: Vercel dashboard → deckpal → Deployments → latest Production → ⋯ → Redeploy)');
    say('Then check: GET https://deckpal.app/api/health should report "aiRoute": "anthropic-direct".');
  }
  if (changed.some((c) => c.startsWith('.env'))) {
    say('');
    say(`Note: a shell that loads .env (set -a && . ./.env) now has ${VAR} set, and Claude Code and every`);
    say('Anthropic SDK in that shell will bill this key instead of any signed-in profile.');
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => { process.exitCode = code; }, (err) => {
    console.error(`set-anthropic-key: ${err?.message ?? 'failed'}`);
    process.exitCode = 1;
  });
}
