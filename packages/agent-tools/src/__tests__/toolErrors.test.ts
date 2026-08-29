/**
 * A tool result is a message to a MODEL. It may not carry the database's
 * address.
 *
 * ── WHY THIS FILE EXISTS (issue #94) ────────────────────────────────────────
 *
 * `errText` was written for exactly one purpose: a `pg` error's message is
 * built from the connection parameters, so "password authentication failed for
 * user \"deckpal\"" and "connect ECONNREFUSED 10.1.2.3:5432" are what a tool's
 * catch sees precisely when the database is unreachable — the moment every
 * tool fails at once and the model is most likely to be asked what went wrong.
 * That text lands in a model's context and, over MCP, in a third-party model
 * provider's.
 *
 * The SQL-backed read tools routed their catches through it. `log_cards` did
 * not, and formatted `(err as Error).message` instead — while its `planBatch`
 * runs two queries (`resolveCardsBatch`, `variantsOfMany`) before the write
 * ever leaves the process. `edit_list` had the same shape: a file whose header
 * says "everything goes through deckpal-api via ctx.api", whose item planner
 * calls `resolveCardsBatch`.
 *
 * That is not a fact any reviewer can re-derive per pull request, so this file
 * pins it two ways:
 *
 *  1. **Behaviourally.** The real handlers run against a `ctx.db` that throws
 *     a real `pg` error shape, and the tool result is inspected. No database,
 *     no network — CI has neither (AGENTS.md B7).
 *  2. **By source guard.** No tool source may format a caught error itself.
 *     Same shape as `apps/api`'s `soft-delete.test.ts`: there is no type for
 *     "this string was redacted", so the rule is checked where it is written.
 *
 * `pnpm --filter @deckpal/agent-tools test:variants` runs it alongside the
 * others; CI runs that script on every push.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import type { Ctx } from '../ctx.js';
import type { ToolDefinition } from '../registry.js';
import { errText, redactEndpoints } from '../shared.js';
import { listTools } from '../tools/lists.js';
import { loggingTools } from '../tools/logging.js';
import { shoppingTools } from '../tools/shopping.js';

// ── The errors, in the shapes `pg` really produces ───────────────────────────

/** Wrong credentials. The message names the ROLE; the code is the diagnosis. */
const pgAuth = (): Error =>
  Object.assign(new Error('password authentication failed for user "deckpal_prod"'), { code: '28P01' });

/** The database is not there. The message names the HOST AND PORT. */
const pgRefused = (): Error =>
  Object.assign(new Error('connect ECONNREFUSED 10.1.2.3:5432'), { code: 'ECONNREFUSED' });

/**
 * A driver error with NO `code` — the case the code-reduction branch cannot
 * catch, and the reason `errText` scrubs its fallback instead of trusting it.
 * `pg` raises plenty of these as plain `Error`s (a pool that dies mid-connect,
 * a TLS refusal), and a wrapper that re-throws with the DSN in the text is one
 * dependency upgrade away.
 */
const pgDsn = (): Error => new Error('could not connect to postgres://deckpal:hunter2@db.internal.example:5432/deckpal');

/** Every substring that must never survive into a tool result. */
const SECRETS = ['password', 'hunter2', 'deckpal_prod', '10.1.2.3', 'db.internal.example', ':5432'];

function assertSaysNothingSecret(text: string, what: string): void {
  for (const secret of SECRETS) {
    assert.equal(
      text.toLowerCase().includes(secret.toLowerCase()),
      false,
      `${what} leaked ${JSON.stringify(secret)}:\n${text}`,
    );
  }
}

// ── A context whose every query fails, and whose API is never reached ────────

function ctxWhereTheDatabaseFails(err: Error): Ctx {
  return {
    userId: '00000000-0000-4000-8000-00000000dead',
    db: {
      query: (): Promise<never> => Promise.reject(err),
    },
    api: {
      base: 'http://127.0.0.1:3700/deckpal/api',
      // The list index the create path reads before it plans items. Answering
      // it keeps the failure where the test aims it: at the SQL.
      get: (): Promise<unknown> => Promise.resolve({ lists: [], decks: [] }),
      send: (): Promise<never> => Promise.reject(new Error('the test never gets this far')),
    },
  } as unknown as Ctx;
}

function tool(defs: readonly ToolDefinition[], name: string): ToolDefinition {
  const def = defs.find((d) => d.name === name);
  if (!def) throw new Error(`${name} is not registered`);
  return def;
}

// ── 1. The behaviour, through the real handlers ──────────────────────────────

test('log_cards never repeats a driver error into its tool result', async () => {
  // Every item here is valid, so `planBatch` gets past its own per-item checks
  // and reaches `resolveCardsBatch` — which is the SQL the issue is about.
  const args = { items: [{ card_id: 'me05-84', delta: 1 }], dry_run: true };

  for (const [what, err] of [
    ['auth failure', pgAuth()],
    ['connection refused', pgRefused()],
    ['a DSN in a codeless error', pgDsn()],
  ] as const) {
    const res = await tool(loggingTools, 'log_cards').handler(args, ctxWhereTheDatabaseFails(err));
    assert.equal(res.isError, true, `${what} should fail the call`);
    assert.match(res.text, /log_cards failed/, 'the tool still says which tool failed');
    assertSaysNothingSecret(res.text, `log_cards on ${what}`);
  }
});

test('log_cards still says the SQLSTATE, because that is what is diagnostic', async () => {
  const res = await tool(loggingTools, 'log_cards').handler(
    { items: [{ card_id: 'me05-84', delta: 1 }], dry_run: true },
    ctxWhereTheDatabaseFails(pgAuth()),
  );
  assert.match(res.text, /28P01/, 'a code is safe to say and is the whole diagnosis');
});

test('edit_list — the sibling planner — is guarded too', async () => {
  // `add_cards` is resolved by the same `resolveCardsBatch`, in a file whose
  // header says everything goes through the REST API.
  const res = await tool(listTools, 'edit_list').handler(
    {
      mode: 'create',
      name: 'test list',
      kind: 'dynamic',
      add_cards: [{ card_id: 'me05-84' }],
      restore: false,
      dry_run: true,
    },
    ctxWhereTheDatabaseFails(pgDsn()),
  );
  assert.equal(res.isError, true);
  assert.match(res.text, /edit_list failed/);
  assertSaysNothingSecret(res.text, 'edit_list');
});

// ── set_cart: resolution bypass fix ──────────────────────────────────────────
//
// `set_cart` passed set_id and list_id RAW to the API while every sibling tool
// resolved them — so 'sv3.5', 'PAL' or a list NAME failed in the one shopping
// tool. These tests pin that both now go through the same resolvers.

/** A minimal CartResponse the mock API can return. */
function cartResponse(source: 'set' | 'list'): unknown {
  return {
    source,
    set: source === 'set' ? { setId: 'sv02', name: 'Paldea Evolved' } : undefined,
    list: source === 'list' ? { id: 'list-uuid-42', name: 'Shopping List', kind: 'static' } : undefined,
    goal: 'complete',
    finishes: null,
    rarity: null,
    rarityExclude: null,
    needed: { cards: 0, items: 0, unlinkable: 0, exactLines: 0, bestEffortLines: 0 },
    lines: [],
    text: '',
    urls: [],
    exactUrls: [],
    bestEffortUrls: [],
    unlinkable: [],
    warnings: [],
    note: '',
  };
}

test('set_cart resolves a printed set code before calling the API', async () => {
  const apiPaths: string[] = [];
  const ctx = {
    userId: '00000000-0000-4000-8000-00000000dead',
    db: {
      query: async (_sql: string, params: unknown[]) => {
        // resolveSet: WHERE lower(cs.tcgdex_id) = ANY($1). Return sv02 when the
        // alias added it as a candidate.
        const ids = params[0] as string[];
        if (ids.includes('sv02')) {
          return {
            rows: [{ id: '201', tcgdex_id: 'sv02', name: 'Paldea Evolved', series_slug: 'sv', released_on: '2023-03-31' }],
          };
        }
        return { rows: [] };
      },
    },
    api: {
      base: 'http://127.0.0.1:3700/deckpal/api',
      get: async (path: string) => {
        apiPaths.push(path);
        if (path.startsWith('/sets/sv02/massentry')) return cartResponse('set');
        return {};
      },
      send: async () => cartResponse('set'),
    },
  } as unknown as Ctx;

  const res = await tool(shoppingTools, 'set_cart').handler({ set_id: 'PAL' }, ctx);
  assert.equal(res.isError, undefined, 'should succeed');
  assert.ok(apiPaths.some((p) => p.startsWith('/sets/sv02/massentry')), 'used the resolved set id');
  assert.ok(!apiPaths.some((p) => p.includes('/sets/PAL')), 'did not pass the raw code to the API');
});

test('set_cart resolves a list NAME before calling the API', async () => {
  const apiPaths: string[] = [];
  const ctx = {
    userId: '00000000-0000-4000-8000-00000000dead',
    db: { query: async () => ({ rows: [] }) },
    api: {
      base: 'http://127.0.0.1:3700/deckpal/api',
      get: async (path: string) => {
        apiPaths.push(path);
        if (path === '/lists') return { lists: [{ id: 'list-uuid-42', name: 'Shopping List' }] };
        if (path.startsWith('/lists/list-uuid-42/massentry')) return cartResponse('list');
        return {};
      },
      send: async () => cartResponse('list'),
    },
  } as unknown as Ctx;

  const res = await tool(shoppingTools, 'set_cart').handler({ list_id: 'Shopping List' }, ctx);
  assert.equal(res.isError, undefined, 'should succeed');
  assert.ok(apiPaths.some((p) => p.startsWith('/lists/list-uuid-42/massentry')), 'used the resolved list id');
  assert.ok(!apiPaths.some((p) => p.includes('Shopping%20List')), 'did not pass the raw name to the API');
});

test('set_cart with an unresolvable set_id fails with a resolution message, not a raw API error', async () => {
  const ctx = {
    userId: '00000000-0000-4000-8000-00000000dead',
    db: { query: async () => ({ rows: [] }) },
    api: {
      base: 'http://127.0.0.1:3700/deckpal/api',
      get: async (): Promise<never> => Promise.reject(new Error('the API was never reached')),
      send: async (): Promise<never> => Promise.reject(new Error('the API was never reached')),
    },
  } as unknown as Ctx;

  const res = await tool(shoppingTools, 'set_cart').handler({ set_id: 'ZZZZZ' }, ctx);
  assert.equal(res.isError, true);
  assert.match(res.text, /No set matches/);
  assert.ok(!/set_cart failed/.test(res.text), 'must not reach the catch block');
});

// ── 2. `errText` itself ──────────────────────────────────────────────────────

test('errText reduces a coded driver error to its code', () => {
  const out = errText(pgAuth());
  assert.equal(out, 'the database refused that (28P01)');
  assertSaysNothingSecret(out, 'errText');
});

test('errText scrubs an address out of a driver error that has NO code', () => {
  // The gap the code-reduction branch cannot cover. What survives is the part
  // that describes the fault; what goes is the part that locates the box.
  const out = errText(pgDsn());
  assertSaysNothingSecret(out, 'errText');
  assert.match(out, /could not connect to/, 'the sentence still says what happened');

  const bare = errText(new Error('connect ETIMEDOUT 192.168.1.50:6543'));
  assertSaysNothingSecret(bare, 'errText');
  assert.equal(bare.includes('192.168.1.50'), false);
  assert.match(bare, /ETIMEDOUT/, 'the syscall name is not an address');
});

test('errText keeps OUR OWN messages verbatim — the tool layer speaks in them', () => {
  // The reason this is not `safeToolError`'s "it failed". A tool's own text is
  // written to be read, and reducing all of it would cost the model every
  // recovery instruction these tools carry.
  for (const mine of [
    'no response within 25s',
    "More than one deck matches 'slow'. Say which by passing its id:",
    "No list 'binder' — call `lists` to see them with their ids.",
    'ran out of time before this chunk was sent',
  ]) {
    assert.equal(errText(new Error(mine)), mine);
  }
});

test('errText keeps the statement-timeout hint, which is the one actionable driver error', () => {
  const timeout = Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' });
  assert.match(errText(timeout), /narrow it/);
});

test('errText survives a non-Error', () => {
  assert.equal(errText('plain string'), 'plain string');
  assert.equal(errText(null), 'null');
});

// ── 3. The source guard ──────────────────────────────────────────────────────

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, '..');

/**
 * `shared.ts` is where `errText` is DEFINED — it is the one file that has to
 * read a caught error's message. Everything else formats through it.
 */
const EXEMPT = new Set(['shared.ts']);

/**
 * The ways a caught error reaches a string. Deliberately narrow: this matches
 * the error variable, not every `.message` in the package (`picked.message`,
 * `vres.message` and the API envelope's `error?.message` are our own text and
 * are none of this rule's business).
 */
const RAW_ERROR_PATTERNS: readonly RegExp[] = [
  /\(\s*(?:err|e|error|ex)\s+as\s+Error\s*\)\s*\.\s*message/,
  /\b(?:err|e|error|ex)\.message\b/,
  /\bString\(\s*(?:err|e|error|ex)\s*\)/,
];

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules' || entry === 'dist') continue;
      sources(p, out);
    } else if (entry.endsWith('.ts') && !EXEMPT.has(entry)) {
      out.push(p);
    }
  }
  return out;
}

test('no tool source formats a caught error itself — every catch goes through errText', () => {
  const offenders: string[] = [];
  for (const file of sources(SRC)) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      // An escape hatch that has to be written down, like the soft-delete
      // guard's: a genuine exception is a decision, not an omission.
      if (line.includes('tool-error-exempt:')) return;
      if (RAW_ERROR_PATTERNS.some((re) => re.test(line))) {
        offenders.push(`${relative(SRC, file)}:${i + 1}: ${line.trim()}`);
      }
    });
  }
  assert.deepEqual(
    offenders,
    [],
    'a tool result feeds a model — format caught errors with errText(err) from ../shared.js:\n' + offenders.join('\n'),
  );
});

test('the source guard can actually fail', () => {
  // A guard that cannot go red is worse than no guard. These are the exact
  // spellings the leak was written in.
  for (const line of [
    'return fail(`log_cards failed: ${(err as Error).message}`);',
    'return fail(`decks failed: ${err.message}`);',
    'lines.push(`FAILED: ${String(err)}`);',
  ]) {
    assert.ok(
      RAW_ERROR_PATTERNS.some((re) => re.test(line)),
      `the guard should catch: ${line}`,
    );
  }
  // And that it does not fire on our own vocabulary.
  for (const line of [
    'if (!picked.ok) return fail(picked.message);',
    'const message = envelope.error?.message ?? `deckpal-api ${method} ${path}`;',
    'for (const w of res.import.warnings) lines.push(`  warning: ${w.message}`);',
  ]) {
    assert.equal(
      RAW_ERROR_PATTERNS.some((re) => re.test(line)),
      false,
      `the guard should NOT fire on: ${line}`,
    );
  }
});

// ── redactEndpoints: the same guarantee, for a LOG rather than a tool result ──
//
// `apps/mcp` prints caught `pg` errors to the server console. That is a
// different audience from a model — an operator who needs the message — but not
// a different rule: AGENTS.md says secrets are never logged, and in cloud those
// lines land in Vercel's dashboard.

test('redactEndpoints strips a DSN but keeps the message an operator needs', () => {
  const out = redactEndpoints(
    new Error('could not connect to postgres://deckpal:hunter2@db.internal.example:5432/deckpal'),
  );
  assert.ok(!out.includes('hunter2'), `password survived: ${out}`);
  assert.ok(!out.includes('db.internal.example'), `host survived: ${out}`);
  assert.match(out, /could not connect to/, 'the operator-facing half was thrown away');
});

test('redactEndpoints strips a bare host:port and a for-user clause', () => {
  const conn = redactEndpoints(new Error('connect ECONNREFUSED 10.1.2.3:5432'));
  assert.ok(!conn.includes('10.1.2.3'), `address survived: ${conn}`);
  assert.match(conn, /ECONNREFUSED/, 'the errno an operator acts on was thrown away');

  const auth = redactEndpoints(new Error('password authentication failed for user "deckpal_prod"'));
  assert.ok(!auth.includes('deckpal_prod'), `role name survived: ${auth}`);
  assert.match(auth, /password authentication failed/);
});

test('redactEndpoints is NOT the lossy tool-result form', () => {
  // The distinction is the point: a model gets a SQLSTATE, a log keeps prose.
  const err = Object.assign(new Error('relation "card" does not exist'), { code: '42P01' });
  assert.equal(errText(err), 'the database refused that (42P01)');
  assert.match(redactEndpoints(err), /relation "card" does not exist/);
});

test('redactEndpoints accepts a non-Error the way a catch actually sees one', () => {
  assert.equal(redactEndpoints('plain string'), 'plain string');
  assert.match(redactEndpoints({ toString: () => 'weird' }), /weird|object/);
});
