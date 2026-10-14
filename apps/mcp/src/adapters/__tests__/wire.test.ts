/**
 * What a client is shown, checked against the MCP spec rather than against
 * DeckPal's own vocabulary (2026-10-12). Read back through the real SDK over
 * an in-memory transport — the tools/list and tools/call a client sees.
 *
 *  - ANNOTATIONS. The spec's defaults are `destructiveHint: true` and
 *    `openWorldHint: true` when omitted (schema 2025-11-25), and no tool set
 *    `openWorldHint`, so every DeckPal tool was advertised as open-world. The
 *    adapter now states every hint explicitly, with the spec's meaning of
 *    `destructiveHint` ("may do anything but add"), while the definitions keep
 *    DeckPal's narrower one, which Deck-E's approval rule reads.
 *  - SCHEMAS. zod's `$schema` line is dropped from every advertised schema
 *    (2020-12 is MCP's default dialect); validation is still zod's, so defaults
 *    and strictness still apply — checked by calling tools, not by reading.
 *  - THE PREVIEW INVARIANT. Every write previews unless told otherwise, with
 *    one exception that says so in its description.
 *
 * Reads @deckpal/agent-tools' dist; build it first.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allTools, type Ctx } from '@deckpal/agent-tools';
import { connectInMemory } from '../../audit/connect.js';
import { listTools } from '../../audit/surface.js';
import { RESULT_TEXT_MAX, toCallToolResult } from '../mcp.js';

test('every advertised tool is closed-world and carries its title for old and new clients', async () => {
  const { tools } = await listTools({ deckeImprovementRead: true });
  assert.equal(tools.length, 33);
  for (const t of tools) {
    assert.equal(t.annotations?.openWorldHint, false, `${t.name}: openWorldHint must be stated (the spec default is true)`);
    assert.ok(t.title, `${t.name}: top-level title`);
    assert.equal(t.annotations?.title, t.title, `${t.name}: annotations.title mirrors the title for clients before 2025-06-18`);
  }
});

test("writes state destructiveHint explicitly, in the spec's meaning; only add_battle_log is additive", async () => {
  const { tools } = await listTools();
  const writes = tools.filter((t) => t.annotations?.readOnlyHint === false);
  assert.equal(writes.length, 11);
  for (const t of writes) {
    assert.equal(typeof t.annotations?.destructiveHint, 'boolean', `${t.name}: destructiveHint stated, never left to the default`);
    assert.equal(typeof t.annotations?.idempotentHint, 'boolean', `${t.name}: idempotentHint stated`);
  }
  assert.deepEqual(writes.filter((t) => !t.annotations?.destructiveHint).map((t) => t.name), ['add_battle_log']);
  const idem = (n: string) => writes.find((t) => t.name === n)!.annotations?.idempotentHint;
  assert.equal(idem('log_cards'), false, 'a repeat outside the derived key window is a second card');
  assert.equal(idem('add_battle_log'), false);
  assert.equal(idem('revert'), false);
});

test('reads advertise neither destructiveHint nor idempotentHint-as-write (meaningless when readOnlyHint is true)', async () => {
  const { tools } = await listTools();
  for (const t of tools.filter((x) => x.annotations?.readOnlyHint === true)) {
    assert.equal(t.annotations?.destructiveHint, undefined, t.name);
  }
});

test("the definitions keep DeckPal's narrower destructiveHint, which Deck-E's approval rule reads", () => {
  // apps/api/src/decke/adapters/aisdk.ts requiresApproval: destructiveHint →
  // ask even before a preview. Widening this set would add approval cards to
  // Deck-E previews of save_deck, edit_list, log_cards….
  assert.deepEqual(
    allTools().filter((d) => d.annotations.destructiveHint).map((d) => d.name).sort(),
    ['delete_battle_log', 'delete_deck', 'delete_list', 'revert'],
  );
});

test('no advertised schema carries a $schema line', async () => {
  const { tools } = await listTools({ deckeImprovementRead: true });
  for (const t of tools) assert.equal(JSON.stringify(t.inputSchema ?? {}).includes('$schema'), false, t.name);
});

test('every write previews by default, except deck_strategy, which says it writes at once', () => {
  for (const def of allTools().filter((d) => !d.annotations.readOnlyHint)) {
    const shape = (def.inputSchema as unknown as { shape: Record<string, { parse: (v: unknown) => unknown }> }).shape;
    if (def.name === 'deck_strategy') {
      assert.equal('dry_run' in shape, false);
      assert.match(def.description, /NO dry run: a call with markdown writes at once/);
      continue;
    }
    assert.ok('dry_run' in shape, `${def.name} has no dry_run`);
    assert.equal(shape.dry_run!.parse(undefined), true, `${def.name}: dry_run must default to true`);
  }
});

// ── Through tools/call ──────────────────────────────────────────────────────

/** A ctx whose API records what it was sent and answers a revert plan. */
function revertCtx(): { ctx: Ctx; bodies: unknown[] } {
  const bodies: unknown[] = [];
  const api = {
    base: 'https://test/api',
    get: async () => ({}),
    send: async (_m: string, _p: string, body: unknown) => {
      bodies.push(body);
      return { dryRun: true, label: 'since x', strategy: 'inverse', plan: [], applied: 0, skipped: 0, conflicts: 0, batchId: null };
    },
  };
  return { ctx: { db: { query: async () => ({ rows: [] }) }, userId: 'u1', api } as unknown as Ctx, bodies };
}

test('with $schema gone, zod still validates: defaults are applied before the handler runs', async () => {
  const { ctx, bodies } = revertCtx();
  const conn = await connectInMemory(ctx);
  try {
    const reply = await conn.request('tools/call', { name: 'revert', arguments: { since: '2026-10-01T00:00:00Z' } });
    assert.equal(reply.error, undefined);
    assert.equal((reply.result as { isError?: boolean }).isError, undefined);
    assert.equal(bodies.length, 1);
    assert.equal((bodies[0] as { dryRun: boolean }).dryRun, true, 'dry_run defaulted to true on the way in');
    assert.equal((bodies[0] as { strategy: string }).strategy, 'inverse');
  } finally {
    await conn.close();
  }
});

test("revert refuses mutation_history's `source` instead of silently undoing every source", async () => {
  const { ctx, bodies } = revertCtx();
  const conn = await connectInMemory(ctx);
  try {
    const reply = await conn.request('tools/call', { name: 'revert', arguments: { since: '2026-10-01T00:00:00Z', source: 'deckpal-mcp' } });
    const failed = reply.error !== undefined || (reply.result as { isError?: boolean }).isError === true;
    assert.ok(failed, 'an unknown argument is an error');
    assert.equal(bodies.length, 0, 'nothing reached the API');
    const text = JSON.stringify(reply);
    assert.match(text, /source/, 'the error names the argument it refused');
  } finally {
    await conn.close();
  }
});

test('a result past the backstop is cut, visibly, with a way forward', () => {
  const long = toCallToolResult({ text: 'x'.repeat(RESULT_TEXT_MAX + 5_000) });
  const text = (long.content[0] as { text: string }).text;
  assert.ok(text.length <= RESULT_TEXT_MAX);
  assert.match(text, /deckpal-mcp cut this result at 100,000 of 105,000 characters\. Ask for less/);
  const short = toCallToolResult({ text: 'fine' });
  assert.equal((short.content[0] as { text: string }).text, 'fine');
});
