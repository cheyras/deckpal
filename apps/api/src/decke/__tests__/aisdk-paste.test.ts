/**
 * The paste channel's WRITE half — the AI SDK adapter substituting the reader's
 * pasted log into an `add_battle_log` call.
 *
 * What is asserted here is the half that is wrong SILENTLY if it is wrong at
 * all: a `@pasted` (or truncated-prefix) `log` is replaced with the real paste
 * BEFORE the handler runs, so the model never spends its 8,000-token output
 * budget re-typing a roughly 3,000-token
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
import { declinedCalls } from '../declined.js';
import { extractPastedLog, pastedLogCount } from '../pastedLog.js';

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

test('@pasted with no paste raises no approval request', async () => {
  const tools = buildDataTools({ ...OPTS, include: () => true, pastedLog: () => null });
  const tool = (
    tools as unknown as Record<
      string,
      { needsApproval: (a: unknown, c: { toolCallId: string }) => Promise<boolean> }
    >
  ).add_battle_log!;

  const needs = await tool.needsApproval(
    { log: PASTED_LOG_SENTINEL, deck_id: 'd1', dry_run: false },
    { toolCallId: 'approval-no-paste' },
  );
  assert.equal(needs, false, 'a call that execute must refuse cannot raise a consent card');
});

test('@pasted with a paste still raises approval for the real write', async () => {
  const tools = buildDataTools({ ...OPTS, include: () => true, pastedLog: () => PASTE });
  const tool = (
    tools as unknown as Record<
      string,
      { needsApproval: (a: unknown, c: { toolCallId: string }) => Promise<boolean> }
    >
  ).add_battle_log!;

  const needs = await tool.needsApproval(
    { log: PASTED_LOG_SENTINEL, deck_id: 'd1', dry_run: false },
    { toolCallId: 'approval-with-paste' },
  );
  assert.equal(needs, true, 'substitution makes the write runnable, so consent is still required');
});

// ═════════════════════════════════════════════════════════════════════════════
// A DECLINE NAMES THE GAME (2026-10-10, review of #291)
// ═════════════════════════════════════════════════════════════════════════════
//
// Wired exactly as `api/chat.mjs` wires it: `declinedCalls(messages)` from the
// replayed history, `pastedLog: () => extractPastedLog(messages)`. Before the
// fix, `@pasted` + deck was one key for every game, so after the reader said no
// to game A's card, game B pasted later was refused as "already declined".

type HeldTool = {
  needsApproval: (a: unknown, c: { toolCallId: string }) => Promise<boolean>;
  execute: (a: unknown, c: { toolCallId: string }) => Promise<string>;
  onInputAvailable: (o: { input: unknown; toolCallId: string }) => Promise<void>;
};
const addBattleLog = (tools: unknown): HeldTool =>
  (tools as Record<string, HeldTool>).add_battle_log!;
const user = (text: string) => ({ role: 'user', parts: [{ type: 'text', text }] });

test('declining pasted game A refuses A again but leaves a later pasted game B askable', async () => {
  const input = { log: PASTED_LOG_SENTINEL, deck_id: 'd1', dry_run: false };
  const gameB = PASTE.replaceAll('PlayerA', 'DifferentPlayer');
  const declinedA = {
    role: 'assistant',
    parts: [{
      type: 'tool-add_battle_log',
      toolCallId: 'call-a',
      input,
      state: 'output-denied',
      approval: { id: 'approval-a', approved: false, reason: 'the reader declined' },
    }],
  };
  const build = (messages: unknown[]) => addBattleLog(buildDataTools({
    ...OPTS,
    include: () => true,
    declined: declinedCalls(messages),
    pastedLog: () => extractPastedLog(messages),
  }));

  // B pasted after A was declined: same sentinel, same deck, different game.
  const thenB = build([user(`log this\n${PASTE}`), declinedA, user(`ok, this one\n${gameB}`)]);
  assert.equal(
    await thenB.needsApproval(input, { toolCallId: 'b' }),
    true,
    'game B was refused as "already declined" because game A was',
  );

  // No new paste: `@pasted` still means game A, which they already refused —
  // by sentinel or by a truncated prefix the adapter would expand to it.
  const againA = build([user(`log this\n${PASTE}`), declinedA, user('actually, log it after all')]);
  assert.equal(await againA.needsApproval(input, { toolCallId: 'a2' }), false);
  assert.match(await againA.execute(input, { toolCallId: 'a2' }), /reader said no to this exact/i);
  const prefix = { ...input, log: PASTE.split('\n').slice(0, 10).join('\n') };
  assert.match(await againA.execute(prefix, { toolCallId: 'a3' }), /reader said no to this exact/i);
});

// ═════════════════════════════════════════════════════════════════════════════
// A PASTE THAT HELD SEVERAL GAMES SAYS SO (2026-10-10, review of #291)
// ═════════════════════════════════════════════════════════════════════════════

const MODEL_NOTICE = /^This message held 2 games; only the last was carried — ask the reader to paste the others one at a time\.$/m;

test('a multi-game paste is disclosed on the tool result, end to end from the message', async () => {
  const orig = globalThis.fetch;
  const calls: Array<{ body: string | undefined }> = [];
  globalThis.fetch = fetchStub(calls);
  try {
    const older = PASTE.replaceAll('PlayerA', 'OlderA');
    const messages = [user(`Game 1:\n${older}\n\nGame 2:\n${PASTE}`)];
    const add = addBattleLog(buildDataTools({
      ...OPTS,
      include: () => true,
      pastedLog: () => extractPastedLog(messages),
      pastedLogCount: () => pastedLogCount(messages),
    }));
    const result = await add.execute({ log: PASTED_LOG_SENTINEL }, { toolCallId: 'multi' });
    assert.equal(JSON.parse(calls[0]?.body ?? '{}').log, PASTE, 'the LAST game is the one carried');
    assert.match(result, MODEL_NOTICE, 'the model was not told the first game was left behind');
    // Last, not first: the chip summarises the first line, which stays the tool's.
    assert.doesNotMatch(result.split('\n')[0]!, /games/);
  } finally {
    globalThis.fetch = orig;
  }
});

test('the notice is only for a call that carried the paste, and only above one game', async () => {
  const orig = globalThis.fetch;
  const calls: Array<{ body: string | undefined }> = [];
  globalThis.fetch = fetchStub(calls);
  try {
    const one = addBattleLog(buildDataTools({
      ...OPTS, include: () => true, pastedLog: () => PASTE, pastedLogCount: () => 1,
    }));
    assert.doesNotMatch(await one.execute({ log: PASTED_LOG_SENTINEL }, { toolCallId: 'one' }), /games/);
    // The model typed its own log, not the paste: nothing was carried, so the
    // paste's other games are not this call's business.
    const typed = addBattleLog(buildDataTools({
      ...OPTS, include: () => true, pastedLog: () => PASTE, pastedLogCount: () => 2,
    }));
    const own = PASTE.replaceAll('PlayerA', 'TypedA');
    assert.doesNotMatch(await typed.execute({ log: own }, { toolCallId: 'typed' }), /games/);
    assert.equal(JSON.parse(calls.at(-1)?.body ?? '{}').log, own);
  } finally {
    globalThis.fetch = orig;
  }
});

test('the approval card says it in the reader\'s words, under the game it would log', async () => {
  const orig = globalThis.fetch;
  const deck = {
    id: 'deck-1',
    name: 'Slowking Toolbox',
    formatCode: 'standard',
    version: 3,
    totalCount: 60,
    valueUsd: 42,
    legal: true,
    updatedAt: '2026-09-01T00:00:00Z',
    record: { wins: 2, losses: 1, ties: 0 },
  };
  const bodies: unknown[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (typeof init?.body === 'string') bodies.push(JSON.parse(init.body));
    if (url.pathname.endsWith('/decks')) return Response.json({ decks: [deck] });
    // The write route asked to prepare, not insert — the dry run the card shows.
    return Response.json({
      dryRun: true,
      attachedToVersion: 3,
      preview: {
        result: 'win', opponent: 'PlayerB', turns: 2, prizes: { me: 6, opponent: 0 },
        confidence: 'high', myPokemon: ['Shuppet'], opponentDeckGuess: null,
        deckName: 'Slowking Toolbox', version: 3, notes: null, playedAt: '2026-10-10T00:00:00Z',
      },
    });
  }) as typeof fetch;
  try {
    const previews: Array<{ summary: string }> = [];
    const add = addBattleLog(buildDataTools({
      ...OPTS,
      include: () => true,
      pastedLog: () => PASTE,
      pastedLogCount: () => 2,
      onApprovalPreview: (preview) => previews.push(preview),
    }));
    await add.onInputAvailable({
      input: { log: PASTED_LOG_SENTINEL, deck_id: 'Slowking Toolbox', dry_run: false },
      toolCallId: 'card',
    });
    assert.equal(previews.length, 1, 'no card preview was emitted');
    const [what, games, ...rest] = previews[0]!.summary.split('\n');
    assert.match(what!, /^Would attach to 'Slowking Toolbox' \(v3\): WIN vs PlayerB/, 'the card lost the game it would log');
    assert.equal(games, 'Your message held 2 games; only the last one is logged here. Paste the others one at a time.');
    assert.deepEqual(rest, []);
    assert.doesNotMatch(previews[0]!.summary, /ask the reader/, 'a model instruction leaked onto the reader\'s card');
    assert.ok(bodies.some((b) => (b as { rawLog?: string; dryRun?: boolean }).rawLog === PASTE && (b as { dryRun?: boolean }).dryRun === true));
  } finally {
    globalThis.fetch = orig;
  }
});
