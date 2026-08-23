/**
 * THE CREDIT SYSTEM WAS BUILT AND NOT WIRED, AND I SHIPPED IT THAT WAY.
 *
 * `credits.ts` landed with eleven passing tests, two migrations, a DEPLOYMENT.md
 * row and a DECISIONS.md entry, and the commit message said "switched off" —
 * which implies flipping the flag turns it on. Nothing imported the module.
 * `DECKE_CREDITS_ENABLED=true` would have changed precisely nothing, and the
 * owner would have granted himself credits and watched the old daily counter
 * keep running.
 *
 * That is the seventh built-and-never-wired defect in this pass, and the only
 * one written by the person who had just added wiring tests for the other six.
 * Passing unit tests around an unreferenced module is the most convincing form
 * this defect takes.
 *
 * These are SOURCE PINS. `api/chat.mjs` is a Vercel handler that reaches the
 * environment at module scope and cannot be imported here.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const CHAT = readFileSync(fileURLToPath(new URL('../../../../../api/chat.mjs', import.meta.url)), 'utf8');
const DEEP = readFileSync(fileURLToPath(new URL('../deep.ts', import.meta.url)), 'utf8');

test('the request path actually imports the credit module', () => {
  assert.match(CHAT, /from '\.\.\/apps\/api\/dist\/decke\/credits\.js'/, 'credits.ts is dead code again');
});

test('BOTH tiers go through one entry point, so they cannot diverge', () => {
  // The failure this shape prevents: the chat turn metered against credits and
  // the deep tier against the old daily counter, because two call sites were
  // changed on different days and both looked right in isolation.
  const calls = (CHAT.match(/meterTurn\(/g) ?? []).length;
  assert.ok(calls >= 3, `meterTurn appears ${calls} time(s) — a tier is metering on its own`);
  assert.equal(
    (CHAT.match(/creditsEnabled\(\)/g) ?? []).length,
    1,
    'the flag is read in more than one place, so half the system can be on',
  );
});

test('the deep tier is priced PER TOOL, not per call', () => {
  // A deck plan is ~$0.75 and an analysis call ~$0.036 — a 20x spread that a
  // single "one deep call" unit cannot express, and the reason the old meter
  // needed a separate counter for the tier at all.
  assert.match(CHAT, /credits: deepCost\(toolName\)/, 'every deep tool costs the same again');
  assert.match(DEEP, /opts\.charge\(spec\.name\)/, 'the tool name never reaches the pricing');
});

test('the refusal does not promise tomorrow when a balance will not come back', () => {
  // A daily cap resets; a spent balance does not. Telling somebody to wait when
  // what they need is a top-up wastes their day.
  assert.match(CHAT, /retryAfterDay: false/, 'a credit refusal still says "try again tomorrow"');
  assert.match(CHAT, /outOfCreditsText\(\)/);
  assert.match(DEEP, /meter\.credits\s*\n?\s*\?/, 'the deep refusal has one sentence for two systems');
});

test('the balance reaches the browser, on every response', () => {
  // A 429 for an empty balance is the turn where the number matters most, so a
  // header read only on the happy path would leave the panel unable to say how
  // much is left at the one moment somebody asks.
  assert.match(CHAT, /'x-decke-credits'/);
  assert.match(CHAT, /'x-decke-credits-low'/, 'the panel is left to invent its own "low"');
  assert.match(CHAT, /credits: \{ balance: meter\.balance, needed: meter\.needed \}/);
});

test('a failed-open meter reports NO balance rather than a made-up one', () => {
  // Accounting fails open, so a turn can be served with no idea what is left.
  // `-1` is the "not applicable" the client drops; a `0` there would put "out of
  // credits" in front of somebody who has plenty.
  assert.match(CHAT, /Number\.isFinite\(meter\.balance\) \? String\(meter\.balance\) : '-1'/);
  assert.match(CHAT, /balance: Number\.NaN/, 'the fail-open path invents a balance');
});

test('the spend is LOGGED, and the insert is awaited', () => {
  // It was fire-and-forget on a pooled client that the `finally` releases the
  // moment the function returns, so the insert went to a connection heading
  // back into the pool and never landed. Verified against production: after a
  // real turn the balance had moved to 1999 and the ledger held nothing but the
  // original grants. An audit trail that records only credits going IN is not an
  // audit trail.
  assert.match(CHAT, /await client\.query\(SPEND_LOG_SQL/, 'the spend log is not awaited and will not run');
  // Still caught, never rethrown: a broken audit table must not take down a turn
  // whose credits have already been taken.
  assert.match(CHAT, /SPEND_LOG_SQL[\s\S]{0,220}?\.catch\(/);
});

test('a driver error is logged through the allowlist, never raw', () => {
  // A `pg` connection failure's MESSAGE is built from the connection
  // parameters, so DSN fragments and "password authentication failed for user
  // …" end up in it — and these log lines fire exactly when the database is
  // unreachable, which is exactly when those details are in the error.
  //
  // Logging `err.code` instead is nearly right and not enough: `code` is
  // driver-supplied and nothing guarantees what a library puts there. CodeQL
  // flagged both credit log sites on the pull request for precisely that, while
  // leaving the older meter one alone — because the meter tested its value
  // against `^[A-Za-z0-9_]{1,32}$` first and the credit path had copied the
  // intent without the guard.
  assert.match(CHAT, /function errCode\(err\)/, 'the allowlist helper is gone')
  assert.match(CHAT, /\[A-Za-z0-9_\]\{1,32\}/, 'errCode no longer allowlists the shape')
  assert.match(CHAT, /'unrecognised'/, 'there is no fallback for a code that is not code-shaped')
  // And nothing bypasses it. `err.code`/`err.name` must not reach a log
  // directly — one implementation is the only way this stays true.
  const direct = CHAT.match(/console\.error\([^)]*(?:err|e)\?\.(?:code|name)/g) ?? []
  assert.deepEqual(direct, [], `a log site reads the driver error directly: ${direct.join(' | ')}`)
})
