/**
 * Every approved Deck-E write carries a key derived from its SIGNED tool call,
 * so a second approval-resume POST reaches the same keys and writes nothing.
 *
 * The API half (`writeOnce.ts`, the routes) is proved against real PostgreSQL
 * in `__integration__/idempotency.mjs`. This file proves the adapter half with
 * the real SDK and a fake API that dedupes by `Idempotency-Key` exactly as the
 * routes do: the key on the wire, its stability across resumes, its absence
 * everywhere a key does not belong.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { convertToModelMessages, streamText } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import { makeApi, type ToolDefinition } from '@deckpal/agent-tools';
import { approvedWriteKey, buildDataTools, REPLAYED_WRITE_NOTE } from '../adapters/aisdk.js';
import { IDEMPOTENCY_HEADER, keyedApi, writeRequestKey } from '../ctx.js';

const DECK = '00000000-0000-4000-8000-0000000000d1';
const INPUT = { deck_id: DECK, log: 'PTCGL battle log text', dry_run: false };
const SECRET = 'test-only-write-idempotency-secret';

type Seen = { method: string; path: string; key: string | null; dryRun: boolean };

/** A deckpal-api that honours `Idempotency-Key` the way `writeOnce` does. */
function fakeApi() {
  const seen: Seen[] = [];
  const stored = new Map<string, unknown>();
  let writes = 0;
  const oldFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const target = new URL(typeof url === 'string' ? url : url instanceof URL ? url : url.url);
    const path = target.pathname.replace(/^\/api/, '') + target.search;
    const method = init?.method ?? 'GET';
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    const key = headers[IDEMPOTENCY_HEADER] ?? null;
    seen.push({ method, path, key, dryRun: body.dryRun === true });
    const json = (value: unknown) =>
      new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
    if (method === 'GET' && path === '/decks') return json({ decks: [{ id: DECK, name: 'Toolbox', formatCode: 'standard' }] });
    if (method === 'GET' && path.startsWith(`/decks/${DECK}/logs?`)) {
      return json({ totals: { total: writes, wins: writes, losses: 0, ties: 0 } });
    }
    if (method === 'POST' && path === `/decks/${DECK}/logs`) {
      if (body.dryRun === true) {
        return json({ dryRun: true, preview: { deckName: 'Toolbox', version: 3 }, parsed: null, attachedToVersion: 3 });
      }
      if (key && stored.has(key)) return json({ ...(stored.get(key) as object), replayed: true });
      writes += 1;
      const out = {
        log: { id: writes, deckVersion: 3, result: 'win', opponent: 'Rival', opponentDeck: null, turns: 9, prizes: null, parsed: null },
        attachedToVersion: 3,
      };
      if (key) stored.set(key, out);
      return json({ ...out, ...(key ? { replayed: false } : {}) });
    }
    throw new Error(`unexpected ${method} ${path}`);
  }) as typeof fetch;
  return { seen, writes: () => writes, restore: () => { globalThis.fetch = oldFetch; } };
}

function build(extra: Record<string, unknown> = {}) {
  return buildDataTools({
    pool: { connect: async () => { throw new Error('no database in this test'); } } as never,
    userId: 'user-1',
    jwt: 'jwt',
    apiBase: 'https://example.test/api',
    include: (d: ToolDefinition) => d.name === 'add_battle_log',
    // Someone listening, so the approval card's dry run really runs.
    onApprovalPreview: () => {},
    ...extra,
  } as never) as Record<string, any>;
}

function mockModel(calls: Array<{ toolCallId: string; toolName: string; input: unknown }> = []) {
  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: 'stream-start', warnings: [] });
          for (const call of calls) {
            controller.enqueue({
              type: 'tool-call', toolCallId: call.toolCallId, toolName: call.toolName, input: JSON.stringify(call.input),
            });
          }
          controller.enqueue({
            type: 'finish',
            finishReason: { unified: calls.length ? 'tool-calls' : 'stop', raw: calls.length ? 'tool_calls' : 'stop' },
            usage: {
              inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
              outputTokens: { total: 1, text: 1, reasoning: 0 },
            },
          });
        },
      }),
    }),
  });
}

async function drain(result: ReturnType<typeof streamText>): Promise<Record<string, unknown>[]> {
  const parts: Record<string, unknown>[] = [];
  const reader = result.fullStream.getReader();
  try {
    for (;;) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const quiet = new Promise<'quiet'>((resolve) => { timer = setTimeout(() => resolve('quiet'), 500); });
      const next = await Promise.race([reader.read(), quiet]);
      clearTimeout(timer);
      if (next === 'quiet' || next.done) return parts;
      parts.push(next.value as unknown as Record<string, unknown>);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

/** Issue one held call through the real SDK and return what an approval resume needs. */
async function hold(toolCallId: string) {
  const issued = await drain(streamText({
    model: mockModel([{ toolCallId, toolName: 'add_battle_log', input: INPUT }]),
    messages: [{ role: 'user', content: 'log this game' }],
    tools: build(),
    experimental_toolApprovalSecret: SECRET,
  }));
  const request = issued.find((p) => p.type === 'tool-approval-request') as
    { approvalId: string; signature: string } | undefined;
  assert.ok(request, 'the approved-write call was not held');
  return (input: unknown = INPUT) => convertToModelMessages([
    { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'log this game' }] },
    {
      id: 'a1', role: 'assistant', parts: [{
        type: 'tool-add_battle_log', toolCallId, input, state: 'approval-responded',
        approval: { id: request.approvalId, approved: true, signature: request.signature },
      }],
    },
  ] as never);
}

const writesTo = (seen: Seen[]) => seen.filter((s) => s.method === 'POST' && s.path === `/decks/${DECK}/logs` && !s.dryRun);
const toolOutput = (parts: Record<string, unknown>[]) =>
  String((parts.find((p) => p.type === 'tool-result') as { output?: unknown } | undefined)?.output ?? '');

test('a replayed approval of the same signed call writes once and says it was a replay', async () => {
  const api = fakeApi();
  try {
    const resume = await hold('signed-1');
    assert.equal(writesTo(api.seen).length, 0, 'nothing may write before approval');
    // The preview the approval card is built from carries no key.
    assert.ok(api.seen.some((s) => s.dryRun && s.key === null));

    const first = await drain(streamText({
      model: mockModel(), messages: await resume(), tools: build({ conversationId: 'original' }),
      experimental_toolApprovalSecret: SECRET,
    }));
    assert.equal(api.writes(), 1);
    assert.doesNotMatch(toolOutput(first), /REPLAYED/);

    // The same approval resumed again with an unsigned field changed: a new
    // request key, the same signed call, the same write key.
    const second = await drain(streamText({
      model: mockModel(), messages: await resume(), tools: build({ conversationId: 'changed' }),
      experimental_toolApprovalSecret: SECRET,
    }));
    assert.equal(api.writes(), 1, 'a replayed approval wrote a second battle log');
    const [a, b] = writesTo(api.seen);
    assert.ok(a?.key && a.key.startsWith('decke-call:'), 'the approved write carried no Idempotency-Key');
    assert.equal(b?.key, a.key, 'the resumed write carried a different key');
    assert.equal(a.key, writeRequestKey(approvedWriteKey('user-1', 'add_battle_log', 'signed-1', INPUT), 'POST', `/decks/${DECK}/logs`, 0));
    assert.match(toolOutput(second), new RegExp(REPLAYED_WRITE_NOTE.slice(0, 40)));

    // A tampered resume never reaches the write at all (the SDK's signature check).
    const tampered = await drain(streamText({
      model: mockModel(), messages: await resume({ ...INPUT, log: 'another game' }), tools: build(),
      experimental_toolApprovalSecret: SECRET, onError: () => {},
    }));
    assert.ok(tampered.some((p) => p.type === 'error'));
    assert.equal(api.writes(), 1);
  } finally { api.restore(); }
});

test('a different signed call with identical input is a new write', async () => {
  const api = fakeApi();
  try {
    for (const id of ['call-a', 'call-b']) {
      const resume = await hold(id);
      await drain(streamText({ model: mockModel(), messages: await resume(), tools: build(), experimental_toolApprovalSecret: SECRET }));
    }
    assert.equal(api.writes(), 2, 'two approvals are two consents');
    const [a, b] = writesTo(api.seen);
    assert.notEqual(a?.key, b?.key);
  } finally { api.restore(); }
});

test('only a call held and signed here is keyed: upstream approvals and the MCP client send no key', async () => {
  const api = fakeApi();
  try {
    const tools = build({ approvals: 'upstream' });
    await tools.add_battle_log.execute(INPUT, { toolCallId: 'sub-agent-1' });
    assert.equal(api.writes(), 1);
    assert.equal(writesTo(api.seen)[0]?.key, null);

    // The MCP server's client: makeApi with no write key.
    await makeApi('https://example.test/api', 'token').send('POST', `/decks/${DECK}/logs`, { rawLog: 'x' });
    assert.equal(writesTo(api.seen)[1]?.key, null);
  } finally { api.restore(); }
});

test('approvedWriteKey is bound to user, call and signed input, and to nothing else', () => {
  const base = approvedWriteKey('user-1', 'add_battle_log', 'call-1', INPUT);
  assert.match(base, /^[0-9a-f]{64}$/);
  assert.equal(approvedWriteKey('user-1', 'add_battle_log', 'call-1', { dry_run: false, log: INPUT.log, deck_id: DECK }), base,
    'key order in the input changed the key');
  assert.notEqual(approvedWriteKey('user-2', 'add_battle_log', 'call-1', INPUT), base);
  assert.notEqual(approvedWriteKey('user-1', 'add_battle_log', 'call-2', INPUT), base);
  assert.notEqual(approvedWriteKey('user-1', 'add_battle_log', 'call-1', { ...INPUT, log: 'other' }), base);
  assert.notEqual(approvedWriteKey('user-1', 'edit_list', 'call-1', INPUT), base);
});

test('keyedApi: one key per write request, none for previews or reads, untouched without a write key', async () => {
  const calls: Array<{ method: string; path: string; headers?: Record<string, string> }> = [];
  const inner = {
    base: 'b',
    get: async (path: string) => { calls.push({ method: 'GET', path }); return {}; },
    send: async (method: string, path: string, _body?: unknown, headers?: Record<string, string>) => {
      calls.push({ method, path, headers });
      if (path === '/replayed') return { replayed: true };
      return path.endsWith('/bulk') ? { replayed: false } : {};
    },
  };
  assert.equal(keyedApi(inner as never, undefined), inner, 'no write key must mean the same client');

  const outcomes: boolean[] = [];
  const api = keyedApi(inner as never, 'wk', (replayed) => { outcomes.push(replayed); });
  await api.get('/lists/L');
  await api.send('POST', '/lists/L/items/bulk', { addMissing: {}, dryRun: true });
  await api.send('POST', '/lists/L/items/bulk', { items: [] });
  await api.send('POST', '/lists/L/items/bulk', { items: [1] });
  await api.send('DELETE', '/lists/L/items/A');
  await api.send('DELETE', '/lists/L/items/B');
  await api.send('POST', '/replayed', {});
  const key = (i: number) => calls[i]?.headers?.[IDEMPOTENCY_HEADER];
  assert.equal(calls[0]?.headers, undefined, 'a read was keyed');
  assert.equal(key(1), undefined, 'a preview was keyed');
  assert.equal(key(2), writeRequestKey('wk', 'POST', '/lists/L/items/bulk', 0), 'a preview shifted the numbering');
  assert.equal(key(3), writeRequestKey('wk', 'POST', '/lists/L/items/bulk', 1));
  assert.equal(key(4), writeRequestKey('wk', 'DELETE', '/lists/L/items/A', 0));
  assert.equal(key(5), writeRequestKey('wk', 'DELETE', '/lists/L/items/B', 0));
  assert.equal(new Set([2, 3, 4, 5].map(key)).size, 4);
  assert.ok((key(2) ?? '').length <= 200, 'the API refuses keys over 200 characters');
  // The preview's answer and the bodies with no `replayed` count as neither.
  assert.deepEqual(outcomes, [false, false, true]);
});

test('a resumed call whose earlier run applied only part of it says PARTLY REPLAYED, not REPLAYED', async () => {
  const LIST = '00000000-0000-4000-8000-0000000000a1';
  const ITEM = '00000000-0000-4000-8000-0000000000b1';
  const oldFetch = globalThis.fetch;
  const keys: string[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(url)).pathname.replace(/^\/api/, '');
    const method = init?.method ?? 'GET';
    const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200 });
    const summary = { id: LIST, name: 'Old name', kind: 'dynamic', itemCount: 1 };
    if (method === 'GET' && path === '/lists') return json({ lists: [summary] });
    if (method === 'GET') {
      return json({ list: summary, items: [{ itemId: ITEM, kind: 'card', cardId: 'sv01-025', name: 'Pikachu' }] });
    }
    keys.push(((init?.headers ?? {}) as Record<string, string>)[IDEMPOTENCY_HEADER] ?? '');
    // The rename landed on the earlier run; the remove did not.
    return method === 'PATCH' ? json({ list: summary, replayed: true }) : json({ deleted: ITEM, replayed: false });
  }) as typeof fetch;
  try {
    const tools = build({ include: (d: ToolDefinition) => d.name === 'edit_list' });
    const text = String(await tools.edit_list.execute(
      { mode: 'edit', list_id: LIST, name: 'New name', remove_item_ids: [ITEM], dry_run: false },
      { toolCallId: 'partial-1' },
    ));
    assert.equal(keys.length, 2);
    assert.ok(keys.every((k) => k.startsWith('decke-call:')));
    assert.match(text, /^PARTLY REPLAYED/m, text);
    assert.doesNotMatch(text, /^REPLAYED/m);
  } finally { globalThis.fetch = oldFetch; }
});

test('log_cards keeps its body key and gets no header', async () => {
  const seen: Array<{ headers: Record<string, string>; body: { idempotencyKey?: string } }> = [];
  const oldFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    seen.push({ headers: (init?.headers ?? {}) as Record<string, string>, body: JSON.parse(String(init?.body ?? '{}')) });
    return new Response(JSON.stringify({
      applied: 1, unchanged: 0, batchId: 'b1',
      items: [{ variantId: 70, cardId: 'me05-001', setId: 'me05', before: 0, after: 1, delta: 1, requestedDelta: 1, clamped: false }],
    }), { status: 200 });
  }) as typeof fetch;
  try {
    // The card and its one printing, as the resolver reads them.
    const client = {
      escapeLiteral: (s: string) => `'${s}'`,
      release: () => {},
      query: async (sql: string) => {
        if (sql.includes('c.tcgdex_id = ANY')) {
          return { rows: [{ id: 7, tcgdex_id: 'me05-001', name: 'Bulbasaur', local_id: '001', rarity: 'Common', category: 'Pokemon',
            set_tcgdex_id: 'me05', set_name: 'Mega Evolution', series_slug: 'mega-evolution', best_minor: 25 }] };
        }
        if (sql.includes('FROM card_variant cv')) {
          return { rows: [{ card_id: 7, id: 70, variant_kind_code: 'normal', display_name: 'Normal', is_primary: true, owned_qty: 0 }] };
        }
        return { rows: [] };
      },
    };
    const tools = buildDataTools({
      pool: { connect: async () => client } as never,
      userId: 'user-1', jwt: 'jwt', apiBase: 'https://example.test/api',
      include: (d: ToolDefinition) => d.name === 'log_cards',
    } as never) as Record<string, any>;
    await tools.log_cards.execute({ items: [{ card_id: 'me05-001', delta: 1 }], dry_run: false }, { toolCallId: 'log-1' });
    const writes = seen.filter((s) => s.body.idempotencyKey !== undefined);
    assert.equal(writes.length, 1, 'the approved log_cards write never reached the API');
    assert.match(writes[0]!.body.idempotencyKey!, /^decke:[0-9a-f]{64}#0$/);
    assert.ok(seen.every((s) => s.headers[IDEMPOTENCY_HEADER] === undefined));
  } finally { globalThis.fetch = oldFetch; }
});
