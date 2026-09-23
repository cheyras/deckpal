import assert from 'node:assert/strict';
import { test } from 'node:test';
import { convertToModelMessages, streamText } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import type { ToolDefinition } from '@deckpal/agent-tools';
import { buildDataTools } from '../adapters/aisdk.js';
import { callKey } from '../repeat.js';

const INPUT = { items: [{ card_id: 'me05-001', delta: 1 }] };
const CARD = { id: 7, tcgdex_id: 'me05-001', name: 'Bulbasaur', local_id: '001', rarity: 'Common', category: 'Pokemon', set_tcgdex_id: 'me05', set_name: 'Mega Evolution', series_slug: 'mega-evolution', best_minor: 25 };

function fixture(options: { fail?: boolean; missing?: boolean } = {}) {
  let previews = 0;
  let requests = 0;
  let writes = 0;
  const applied = new Set<string>();
  const client = {
    escapeLiteral: (s: string) => `'${s}'`,
    query: async (sql: string) => {
      if (options.fail) throw new Error('adversarial preflight failure');
      if (sql.includes('c.tcgdex_id = ANY')) return { rows: options.missing ? [] : [CARD] };
      if (sql.includes('FROM card_variant cv')) return { rows: [{ card_id: 7, id: 70, variant_kind_code: 'normal', display_name: 'Normal', is_primary: true, owned_qty: 0 }] };
      return { rows: [] };
    },
    release: () => {},
  };
  const oldFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { dryRun?: boolean; idempotencyKey?: string; items?: Array<{ variantId: number }> };
    if (body.dryRun) previews += 1;
    else {
      requests += 1;
      const key = body.idempotencyKey ?? '';
      if (!applied.has(key)) { applied.add(key); writes += 1; }
    }
    return new Response(JSON.stringify({
      dryRun: body.dryRun === true,
      batchId: body.dryRun ? null : 'batch-1',
      replayed: !body.dryRun && requests > 1,
      applied: body.dryRun ? 0 : 1,
      wouldApply: body.dryRun ? 1 : undefined,
      unchanged: 0,
      items: [{ variantId: body.items?.[0]?.variantId ?? 70, cardId: 'me05-001', setId: 'me05', before: 0, after: 1, delta: 1, requestedDelta: 1, clamped: false }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const build = (extra: Record<string, unknown> = {}) => buildDataTools({
    pool: { connect: async () => client } as never,
    userId: 'u', jwt: 'j', apiBase: 'https://example.test/api',
    include: (d: ToolDefinition) => d.name === 'log_cards',
    conversationalLogging: true,
    ...extra,
  } as never) as Record<string, any>;
  return { build, counts: () => ({ previews, requests, writes }), restore: () => { globalThis.fetch = oldFetch; } };
}

function model(calls: Array<{ toolCallId: string; toolName: string; input: unknown }> = []) {
  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: new ReadableStream({
        start(c) {
          c.enqueue({ type: 'stream-start', warnings: [] });
          for (const x of calls) c.enqueue({ type: 'tool-call', toolCallId: x.toolCallId, toolName: x.toolName, input: JSON.stringify(x.input) });
          c.enqueue({
            type: 'finish',
            finishReason: { unified: calls.length ? 'tool-calls' : 'stop', raw: calls.length ? 'tool_calls' : 'stop' },
            usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } },
          });
        },
      }),
    }),
  });
}

async function drain(result: ReturnType<typeof streamText>) {
  const out: Record<string, any>[] = [];
  const reader = result.fullStream.getReader();
  try {
    for (;;) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const quiet = new Promise<'quiet'>((resolve) => { timer = setTimeout(() => resolve('quiet'), 500); });
      const next = await Promise.race([reader.read(), quiet]);
      clearTimeout(timer);
      if (next === 'quiet' || next.done) return out;
      out.push(next.value as Record<string, any>);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

test('normalization is strict at the SDK boundary and both intents remain server-owned', async () => {
  const f = fixture();
  try {
    const tools = f.build();
    assert.equal(tools.log_cards.inputSchema.safeParse({ ...INPUT, dry_run: false }).success, false);
    assert.equal(tools.preview_card_changes.inputSchema.safeParse({ ...INPUT, forged: 1 }).success, false);
    const preview = await tools.preview_card_changes.execute({ ...INPUT, dry_run: false }, { toolCallId: 'p' });
    assert.match(preview, /DRY RUN/);
    assert.deepEqual(f.counts(), { previews: 1, requests: 0, writes: 0 });
  } finally { f.restore(); }
});

test('failed, unresolved, and empty APPLY preflights cannot fall through when approval is false', async () => {
  for (const [label, options, input] of [
    ['failed', { fail: true }, INPUT],
    ['unresolved', { missing: true }, INPUT],
    ['empty', {}, { items: [] }],
  ] as const) {
    const f = fixture(options);
    try {
      const tool = f.build().log_cards;
      assert.equal(await tool.needsApproval(input, { toolCallId: label }), false);
      await tool.execute(input, { toolCallId: label });
      assert.equal(f.counts().requests, 0, `${label} preflight reached mutation endpoint`);
    } finally { f.restore(); }
  }
});

test('decline matching accepts new exposed and legacy normalized shapes without preview work', async () => {
  for (const declinedInput of [INPUT, { ...INPUT, dry_run: false }]) {
    const f = fixture();
    try {
      const tool = f.build({ declined: new Set([callKey('log_cards', declinedInput)]) }).log_cards;
      assert.equal(await tool.needsApproval(INPUT, { toolCallId: 'd' }), false);
      assert.match(await tool.execute(INPUT, { toolCallId: 'd' }), /already said no/i);
      assert.deepEqual(f.counts(), { previews: 0, requests: 0, writes: 0 });
    } finally { f.restore(); }
  }
});

test('installed AI SDK signs exposed input; approve executes once and tamper fails closed', async () => {
  const f = fixture();
  const secret = 'adversarial-secret';
  try {
    const opened = await drain(streamText({ model: model([{ toolCallId: 'c1', toolName: 'log_cards', input: INPUT }]), messages: [{ role: 'user', content: 'add it' }], tools: f.build(), experimental_toolApprovalSecret: secret }));
    const request = opened.find((x) => x.type === 'tool-approval-request');
    assert.ok(request && typeof request.signature === 'string');
    assert.deepEqual(opened.find((x) => x.type === 'tool-call')?.input, INPUT);
    const replay = async (input: unknown, signature: string) => convertToModelMessages([{ id: 'u', role: 'user', parts: [{ type: 'text', text: 'add it' }] }, { id: 'a', role: 'assistant', parts: [{ type: 'tool-log_cards', toolCallId: 'c1', input, state: 'approval-responded', approval: { id: request.approvalId, approved: true, signature } }] }] as never);
    await drain(streamText({ model: model(), messages: await replay(INPUT, request.signature), tools: f.build(), experimental_toolApprovalSecret: secret }));
    assert.equal(f.counts().writes, 1);
    const bad = await drain(streamText({ model: model(), messages: await replay({ items: [{ card_id: 'me05-001', delta: 2 }] }, request.signature), tools: f.build(), experimental_toolApprovalSecret: secret, onError: () => {} }));
    assert.ok(bad.some((x) => x.type === 'error'));
    assert.equal(f.counts().writes, 1);
  } finally { f.restore(); }
});

test('legacy signed approval containing dry_run:false remains replayable after schema split', async () => {
  const f = fixture();
  const secret = 'legacy-secret';
  const legacy = { ...INPUT, dry_run: false };
  try {
    const opened = await drain(streamText({ model: model([{ toolCallId: 'old', toolName: 'log_cards', input: legacy }]), messages: [{ role: 'user', content: 'add it' }], tools: f.build({ conversationalLogging: false }), experimental_toolApprovalSecret: secret }));
    const request = opened.find((x) => x.type === 'tool-approval-request');
    assert.ok(request && typeof request.signature === 'string');
    const messages = await convertToModelMessages([{ id: 'u', role: 'user', parts: [{ type: 'text', text: 'add it' }] }, { id: 'a', role: 'assistant', parts: [{ type: 'tool-log_cards', toolCallId: 'old', input: legacy, state: 'approval-responded', approval: { id: request.approvalId, approved: true, signature: request.signature } }] }] as never);
    const replayed = await drain(streamText({ model: model(), messages, tools: f.build(), experimental_toolApprovalSecret: secret, onError: () => {} }));
    assert.equal(replayed.some((x) => x.type === 'error'), false, 'deployment invalidated an already signed legacy approval');
    assert.equal(f.counts().writes, 1, JSON.stringify(replayed));
  } finally { f.restore(); }
});

test('preflight memoization is call-id scoped, concurrent, and request-local', async () => {
  const f = fixture();
  try {
    const a = f.build().log_cards;
    await Promise.all([a.onInputAvailable({ input: INPUT, toolCallId: 'same' }), a.needsApproval(INPUT, { toolCallId: 'same' })]);
    assert.equal(f.counts().previews, 1);
    await a.needsApproval(INPUT, { toolCallId: 'other' });
    assert.equal(f.counts().previews, 2);
    await f.build().log_cards.needsApproval(INPUT, { toolCallId: 'same' });
    assert.equal(f.counts().previews, 3);
  } finally { f.restore(); }
});
