/**
 * The paste channel's WRITE half — the AI SDK adapter substituting the reader's
 * pasted log into an `add_battle_log` call.
 *
 * What is asserted here is the half that is wrong SILENTLY if it is wrong at
 * all: a `@pasted` (or truncated-prefix) `log` is replaced with the real paste
 * BEFORE the handler runs, so a 1,200-token model never re-types a 3,000-token
 * log; and when the sentinel is used with no paste, the handler is never called
 * with the literal string "@pasted".
 *
 * Two layers, because the seam is the thing under test and the wiring is the
 * thing that can come unplugged:
 *   • `applyPastedLog` — the pure substitution, exercised with a STUB
 *     `add_battle_log` whose handler records its args. "Reaches the handler"
 *     means the value the handler receives is the full paste, not `@pasted`.
 *   • `buildDataTools` + `execute` — the wiring, exercised with a `fetch` stub
 *     so the real `add_battle_log` handler runs end-to-end against the
 *     deck-agnostic `/decks/log-preview` branch and the request body carries
 *     the substituted `log`.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from 'zod';
import { defineTool, ok, type Ctx, type ToolDefinition } from '@deckpal/agent-tools';
import {
  PASTED_LOG_SENTINEL,
  NO_PASTE_FOUND_MESSAGE,
  applyPastedLog,
  buildDataTools,
} from '../adapters/aisdk.js';

const OPTS = {
  pool: null as never,
  userId: 'u1',
  jwt: 'jwt',
  apiBase: 'https://example.test/api',
};

/** A realistic pasted log (~600 chars) for the substitution to carry. */
const PASTE = [
  'Setup',
  'PlayerA chose heads for the opening coin flip.',
  'PlayerA won the coin toss.',
  'PlayerA decided to go first.',
  'PlayerA drew 7 cards for the opening hand.',
  'PlayerB drew 7 cards for the opening hand.',
  "PlayerB's Turn",
  'PlayerB drew a card.',
  'PlayerB played Dreepy to the Active Spot.',
  'PlayerB attached Basic Psychic Energy to Dreepy in the Active Spot.',
  'PlayerB ended their turn.',
  "PlayerA's Turn",
  'PlayerA drew a card.',
  'PlayerA played Shuppet to the Bench.',
  'PlayerA ended their turn.',
  'All Prize cards taken. PlayerA wins.',
].join('\n');
assert.ok(PASTE.length >= 200, 'fixture: PASTE must be >= 200 chars for the prefix test');

/** A stub `add_battle_log` whose handler records the args it is called with. */
function recordingAddBattleLog(): { def: ToolDefinition; calls: unknown[] } {
  const calls: unknown[] = [];
  const def: ToolDefinition = defineTool({
    name: 'add_battle_log',
    title: 'Add a battle log to a deck',
    description: 'x',
    inputSchema: z.object({
      log: z.string(),
      deck_id: z.string().optional(),
      dry_run: z.boolean().default(false),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    handler: async (args: unknown) => {
      calls.push(args);
      return ok('ran');
    },
  });
  return { def, calls };
}

/** A no-op `Ctx` for the stub handler, which never touches the database or API. */
const NULL_CTX = null as unknown as Ctx;

// ═════════════════════════════════════════════════════════════════════════════
// THE PURE SEAM — applyPastedLog
// ═════════════════════════════════════════════════════════════════════════════

test('a @pasted sentinel substitutes the full paste and reaches the handler', async () => {
  const { def, calls } = recordingAddBattleLog();
  const input = { log: PASTED_LOG_SENTINEL, deck_id: 'd1', dry_run: false };
  const r = applyPastedLog(def, input, PASTE);
  assert.equal(r.kind, 'ok', 'a sentinel with a paste must not fail');
  if (r.kind !== 'ok') return; // narrow for TS
  assert.equal((r.value as { log: string }).log, PASTE, 'the substituted log was not the full paste');
  // The stub handler records its args — the value that reaches it is the paste.
  await def.handler(r.value, NULL_CTX);
  assert.equal(calls.length, 1, 'the handler was called exactly once');
  assert.equal((calls[0] as { log: string }).log, PASTE, 'the handler received the full paste, not @pasted');
  // And the other arguments ride through untouched.
  assert.equal((calls[0] as { deck_id: string }).deck_id, 'd1');
});

test('a truncated PREFIX (>= 200 chars, whitespace-normalized) substitutes the full paste', () => {
  const { def } = recordingAddBattleLog();
  // A clean line-aligned prefix, >= 200 chars, that matches after normalization.
  const prefix = PASTE.split('\n').slice(0, 10).join('\n');
  assert.ok(prefix.length >= 200, 'fixture: prefix must be >= 200 chars');
  const input = { log: prefix, deck_id: 'd1', dry_run: false };
  const r = applyPastedLog(def, input, PASTE);
  assert.equal(r.kind, 'ok');
  if (r.kind !== 'ok') return;
  assert.equal((r.value as { log: string }).log, PASTE, 'the prefix was not expanded to the full paste');
  // A prefix that does NOT match the paste (different text) is left alone — the
  // parser downstream gates on quality, and using the model's (truncated) log is
  // the best available answer when the paste is not its source.
  const other = applyPastedLog(def, { log: ' '.repeat(250) + 'not a prefix of the paste', dry_run: false }, PASTE);
  assert.equal(other.kind, 'ok');
  if (other.kind !== 'ok') return;
  assert.notEqual((other.value as { log: string }).log, PASTE, 'a non-matching long string was wrongly substituted');
});

test('a prefix shorter than 200 chars is NOT substituted — a coincidence is not a prefix', () => {
  const { def } = recordingAddBattleLog();
  const short = PASTE.split('\n').slice(0, 2).join('\n'); // "Setup\nPlayerA chose …" — < 200 chars
  assert.ok(short.length < 200, 'fixture: this must be < 200 chars');
  const r = applyPastedLog(def, { log: short, dry_run: false }, PASTE);
  assert.equal(r.kind, 'ok');
  if (r.kind !== 'ok') return;
  assert.equal((r.value as { log: string }).log, short, 'a short prefix was substituted when it must not be');
});

test('a @pasted sentinel with NO paste returns the fail result and never calls the handler', async () => {
  const { def, calls } = recordingAddBattleLog();
  const r = applyPastedLog(def, { log: PASTED_LOG_SENTINEL, deck_id: 'd1', dry_run: false }, null);
  assert.equal(r.kind, 'fail', 'a sentinel with no paste must fail, not pass "@pasted" through');
  if (r.kind !== 'fail') return;
  assert.equal(r.message, NO_PASTE_FOUND_MESSAGE);
  assert.match(r.message, /No pasted battle log/, 'the fail message says no paste was found');
  assert.match(r.message, /@pasted/, 'the fail message tells the model how to retry');
  assert.equal(calls.length, 0, 'the handler must not be called on a fail');
});

test('other tools are untouched — only add_battle_log carries a paste-referencing log', () => {
  const other: ToolDefinition = defineTool({
    name: 'search_cards',
    title: 'Search cards',
    description: 'x',
    inputSchema: z.object({ q: z.string() }),
    annotations: { readOnlyHint: true },
    handler: async () => ok('ran'),
  });
  const input = { log: PASTED_LOG_SENTINEL, q: 'dragon' };
  const r = applyPastedLog(other, input, PASTE);
  assert.equal(r.kind, 'ok');
  if (r.kind !== 'ok') return;
  assert.strictEqual(r.value, input, 'a non-add_battle_log call passed through unchanged');
});

test('a non-string `log` is left alone (the model sent something unexpected)', () => {
  const { def } = recordingAddBattleLog();
  const r = applyPastedLog(def, { log: undefined, deck_id: 'd1' }, PASTE);
  assert.equal(r.kind, 'ok');
  if (r.kind !== 'ok') return;
  assert.strictEqual((r.value as { log: unknown }).log, undefined);
});

// ═════════════════════════════════════════════════════════════════════════════
// THE WIRING — execute threads the substitution into the real handler
// ═════════════════════════════════════════════════════════════════════════════

/** A fake `/decks/log-preview` response for the real handler's no-deck_id branch. */
const LOG_PREVIEW_BODY = JSON.stringify({
  parsed: {
    result: null,
    opponent: null,
    turns: null,
    prizes: null,
    confidence: 'low',
    myPokemon: [],
    opponentDeckGuess: null,
  },
  candidates: [],
});

/** Stub `fetch` for the self-hop the real handler makes to deckpal-api. */
function fetchStub(calls: Array<{ body: string | undefined }>): typeof fetch {
  return (async (_url: unknown, init?: RequestInit) => {
    calls.push({ body: typeof init?.body === 'string' ? init.body : undefined });
    return new Response(LOG_PREVIEW_BODY, {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
}

test('execute substitutes @pasted into the real add_battle_log handler (the fetch carries the full paste)', async () => {
  const orig = globalThis.fetch;
  const calls: Array<{ body: string | undefined }> = [];
  globalThis.fetch = fetchStub(calls);
  try {
    const tools = buildDataTools({ ...OPTS, include: () => true, pastedLog: () => PASTE });
    const tool = (
      tools as unknown as Record<
        string,
        { execute: (a: unknown, c: { toolCallId: string }) => Promise<string> }
      >
    ).add_battle_log!;
    assert.ok(tool, 'add_battle_log was not built');
    assert.equal(typeof tool.execute, 'function', 'execute is not callable on the built tool');
    // No deck_id → the read branch hits /decks/log-preview carrying the log.
    await tool.execute({ log: PASTED_LOG_SENTINEL }, { toolCallId: 'c1' });
    assert.equal(calls.length, 1, 'the handler made exactly one self-hop');
    assert.equal(
      JSON.parse(calls[0]?.body ?? '{}').log,
      PASTE,
      'the request body carried the substituted paste, not the literal @pasted',
    );
  } finally {
    globalThis.fetch = orig;
  }
});

test('execute returns the fail result for @pasted with no paste and NEVER calls the handler', async () => {
  const orig = globalThis.fetch;
  const calls: Array<{ body: string | undefined }> = [];
  globalThis.fetch = fetchStub(calls);
  try {
    const tools = buildDataTools({ ...OPTS, include: () => true, pastedLog: () => null });
    const tool = (
      tools as unknown as Record<
        string,
        { execute: (a: unknown, c: { toolCallId: string }) => Promise<string> }
      >
    ).add_battle_log!;
    // deck_id + dry_run:false → a held write; the sentinel with no paste fails
    // before the handler runs, so no self-hop and the fail message is returned.
    const out = await tool.execute({ log: PASTED_LOG_SENTINEL, deck_id: 'd1', dry_run: false }, { toolCallId: 'c2' });
    assert.equal(calls.length, 0, 'the handler was called when it must not be');
    assert.equal(out, NO_PASTE_FOUND_MESSAGE, 'execute did not return the fail message');
  } finally {
    globalThis.fetch = orig;
  }
});
