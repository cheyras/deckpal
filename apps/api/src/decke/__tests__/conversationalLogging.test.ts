import assert from 'node:assert/strict';
import { test } from 'node:test';
import { convertToModelMessages, streamText } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import { allTools, type ToolDefinition } from '@deckpal/agent-tools';
import { callKey } from '../repeat.js';
import { buildDataTools, dataToolSummary } from '../adapters/aisdk.js';
import { openingTools } from '../focus.js';

const CARD = {
  id: 7,
  tcgdex_id: 'me05-001',
  name: 'Bulbasaur',
  local_id: '001',
  rarity: 'Common',
  category: 'Pokemon',
  set_tcgdex_id: 'me05',
  set_name: 'Mega Evolution',
  series_slug: 'mega-evolution',
  best_minor: 25,
};

type FixtureOptions = { missing?: boolean; variants?: number; fail?: boolean };

function fixture(options: FixtureOptions = {}) {
  let previews = 0;
  let writeRequests = 0;
  let writes = 0;
  const applied = new Set<string>();
  const client = {
    escapeLiteral: (s: string) => `'${s}'`,
    query: async (sql: string) => {
      if (options.fail) throw new Error('fixture preflight failed');
      if (sql.includes('c.tcgdex_id = ANY')) {
        return { rows: options.missing ? [] : [CARD] };
      }
      if (sql.includes('FROM card_variant cv')) {
        const count = options.variants ?? 1;
        return {
          rows: Array.from({ length: count }, (_, i) => ({
            card_id: 7,
            id: 70 + i,
            variant_kind_code: i === 0 ? 'normal' : 'reverse',
            display_name: i === 0 ? 'Normal' : 'Reverse Holo',
            is_primary: i === 0,
            owned_qty: count > 1 ? 1 : 0,
          })),
        };
      }
      return { rows: [] };
    },
    release: () => {},
  };
  const pool = { connect: async () => client } as never;
  const oldFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as {
      dryRun?: boolean;
      idempotencyKey?: string;
      items?: Array<{ variantId: number; delta?: number; quantity?: number }>;
    };
    if (body.dryRun) previews += 1;
    else {
      writeRequests += 1;
      const key = body.idempotencyKey ?? '';
      if (!applied.has(key)) {
        applied.add(key);
        writes += 1;
      }
    }
    const it = body.items?.[0] ?? { variantId: 70, delta: 1 };
    return new Response(JSON.stringify({
      dryRun: body.dryRun === true,
      batchId: body.dryRun ? null : 'batch-1',
      replayed: !body.dryRun && writeRequests > 1,
      applied: body.dryRun ? 0 : 1,
      wouldApply: body.dryRun ? 1 : undefined,
      unchanged: 0,
      items: [{
        variantId: it.variantId,
        cardId: 'me05-001',
        setId: 'me05',
        before: 0,
        after: 1,
        delta: 1,
        requestedDelta: 1,
        clamped: false,
      }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const restore = () => { globalThis.fetch = oldFetch; };
  const build = (extra: Record<string, unknown> = {}) => buildDataTools({
    pool,
    userId: 'u1',
    jwt: 'jwt',
    apiBase: 'https://example.test/api',
    include: (d: ToolDefinition) => d.name === 'log_cards',
    conversationalLogging: true,
    ...extra,
  } as never) as Record<string, any>;
  return { build, restore, counts: () => ({ previews, writeRequests, writes }) };
}

const INPUT = { items: [{ card_id: 'me05-001', delta: 1 }] };

function mockModel(calls: Array<{ toolCallId: string; toolName: string; input: unknown }> = []) {
  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: 'stream-start', warnings: [] });
          for (const call of calls) {
            controller.enqueue({
              type: 'tool-call',
              toolCallId: call.toolCallId,
              toolName: call.toolName,
              input: JSON.stringify(call.input),
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
      const quiet = new Promise<'quiet'>((resolve) => {
        timer = setTimeout(() => resolve('quiet'), 500);
      });
      const next = await Promise.race([reader.read(), quiet]);
      clearTimeout(timer);
      if (next === 'quiet' || next.done) return parts;
      parts.push(next.value as unknown as Record<string, unknown>);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

test('conversation advertises no dry_run while APPLY runtime accepts only current or legacy false', async () => {
  const f = fixture();
  try {
    const tools = f.build();
    assert.deepEqual(Object.keys(tools), ['log_cards', 'preview_card_changes']);
    for (const name of Object.keys(tools)) {
      assert.equal('dry_run' in tools[name].inputSchema.shape, false, `${name} leaked dry_run`);
    }
    assert.match(tools.log_cards.description, /^APPLY /);
    assert.match(tools.preview_card_changes.description, /^PREVIEW /);
    assert.equal(tools.log_cards.inputSchema.safeParse({ ...INPUT, dry_run: false }).success, false);
    const advertised = await tools.log_cards.inputSchema.jsonSchema;
    assert.equal(JSON.stringify(advertised).includes('dry_run'), false);
    assert.equal(advertised.additionalProperties, false);
    const validate = tools.log_cards.inputSchema.validate;
    assert.equal((await validate(INPUT)).success, true, 'current APPLY input rejected');
    assert.equal((await validate({ ...INPUT, dry_run: false })).success, true, 'legacy false rejected');
    assert.equal((await validate({ ...INPUT, dry_run: true })).success, false, 'legacy true accepted');
    assert.equal((await validate({ ...INPUT, forged_extra: 1 })).success, false, 'unknown key accepted');

    const ordinary = buildDataTools({
      pool: null as never, userId: 'u', jwt: 'j', apiBase: 'x', include: (d) => d.name === 'log_cards',
    }) as Record<string, any>;
    assert.deepEqual(Object.keys(ordinary), ['log_cards']);
    assert.equal('dry_run' in ordinary.log_cards.inputSchema.shape, true);
    assert.equal('dry_run' in allTools().find((d) => d.name === 'log_cards')!.inputSchema!.shape, true);
    assert.equal(dataToolSummary({ include: (d) => d.name === 'log_cards' }).length, 1);
    assert.deepEqual(
      dataToolSummary({ include: (d) => d.name === 'log_cards', conversationalLogging: true }).map((x) => x.name),
      ['log_cards', 'preview_card_changes'],
    );
    assert.deepEqual(openingTools(tools), ['log_cards', 'preview_card_changes']);
  } finally { f.restore(); }
});

test('APPLY preflights before approval, then an approved execution writes exactly once', async () => {
  const f = fixture();
  try {
    const tool = f.build().log_cards;
    assert.equal(await tool.needsApproval(INPUT, { toolCallId: 'apply-1' }), true);
    assert.deepEqual(f.counts(), { previews: 1, writeRequests: 0, writes: 0 });
    const out = await tool.execute(INPUT, { toolCallId: 'apply-1' });
    assert.match(out, /applied 1/i);
    assert.deepEqual(f.counts(), { previews: 1, writeRequests: 1, writes: 1 });
  } finally { f.restore(); }
});

test('preview alias is never approval-eligible and forces dry_run:true even when false is injected', async () => {
  const f = fixture();
  try {
    const tool = f.build().preview_card_changes;
    assert.equal(tool.needsApproval, false);
    const out = await tool.execute({ ...INPUT, dry_run: false }, { toolCallId: 'preview-1' });
    assert.match(out, /DRY RUN/);
    assert.deepEqual(f.counts(), { previews: 1, writeRequests: 0, writes: 0 });
  } finally { f.restore(); }
});

test('invalid, unresolvable, skipped-only, and errored preflights never approve or write', async (t) => {
  const cases: Array<[string, FixtureOptions, unknown]> = [
    ['invalid', {}, { items: [] }],
    ['unresolvable', { missing: true }, INPUT],
    ['skipped-only', {}, { items: [{ card_id: 'me05-001', delta: 0 }] }],
    ['errored', { fail: true }, INPUT],
  ];
  for (const [name, options, input] of cases) {
    await t.test(name, async () => {
      const f = fixture(options);
      try {
        const tool = f.build().log_cards;
        assert.equal(await tool.needsApproval(input, { toolCallId: name }), false);
        const out = await tool.execute(input, { toolCallId: name });
        assert.equal(typeof out, 'string');
        assert.equal(f.counts().writeRequests, 0, `${name} reached the write endpoint`);
      } finally { f.restore(); }
    });
  }
});

test('candidate-bearing printing ambiguity preserves the existing picker exception', async () => {
  const f = fixture({ variants: 2 });
  const previews: any[] = [];
  try {
    const tool = f.build({ onApprovalPreview: (p: unknown) => previews.push(p) }).log_cards;
    const input = { items: [{ card_id: 'me05-001', quantity: 2 }] };
    await tool.onInputAvailable({ input, toolCallId: 'ambiguous-1' });
    assert.equal(await tool.needsApproval(input, { toolCallId: 'ambiguous-1' }), true);
    assert.equal(previews[0].editable, true);
    assert.equal(previews[0].rows[0].certainty, 'ambiguous');
    assert.equal(previews[0].rows[0].candidates.length, 2);
    assert.equal(f.counts().writeRequests, 0);
  } finally { f.restore(); }
});

test('declined APPLY calls do not preflight, approve, or execute', async () => {
  const f = fixture();
  try {
    const tool = f.build({ declined: new Set([callKey('log_cards', INPUT)]) }).log_cards;
    assert.equal(await tool.needsApproval(INPUT, { toolCallId: 'declined-1' }), false);
    const out = await tool.execute(INPUT, { toolCallId: 'declined-1' });
    assert.match(out, /already said no/i);
    assert.deepEqual(f.counts(), { previews: 0, writeRequests: 0, writes: 0 });
  } finally { f.restore(); }
});

test('preflight promise is request-local and keyed by toolCallId plus exposed arguments', async () => {
  const f = fixture();
  try {
    const a = f.build().log_cards;
    await Promise.all([
      a.onInputAvailable({ input: INPUT, toolCallId: 'same' }),
      a.needsApproval(INPUT, { toolCallId: 'same' }),
    ]);
    assert.equal(f.counts().previews, 1, 'racing SDK hooks did not share one promise');
    await a.needsApproval(INPUT, { toolCallId: 'different' });
    assert.equal(f.counts().previews, 2, 'a different call id reused stale preview evidence');
    const b = f.build().log_cards;
    await b.needsApproval(INPUT, { toolCallId: 'same' });
    assert.equal(f.counts().previews, 3, 'a new request inherited another request cache');
  } finally { f.restore(); }
});

test('real SDK holds signed exposed input; approve writes once, decline/tamper/replay do not add mutations', async () => {
  const f = fixture();
  const secret = 'test-only-approval-secret';
  try {
    const issued = await drain(streamText({
      model: mockModel([{ toolCallId: 'signed-1', toolName: 'log_cards', input: INPUT }]),
      messages: [{ role: 'user', content: 'add one Bulbasaur' }],
      tools: f.build(),
      experimental_toolApprovalSecret: secret,
    }));
    const request = issued.find((p) => p.type === 'tool-approval-request');
    assert.ok(request, 'the valid opening call was not held');
    assert.equal(typeof request.signature, 'string');
    const call = issued.find((p) => p.type === 'tool-call');
    assert.deepEqual(call?.input, INPUT, 'server normalization changed the signed SDK input');
    assert.equal('dry_run' in (call?.input as Record<string, unknown>), false);
    assert.deepEqual(f.counts(), { previews: 1, writeRequests: 0, writes: 0 });

    const replayMessages = async (approved: boolean, input: unknown = INPUT, signature = request.signature) =>
      convertToModelMessages([
        { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'add one Bulbasaur' }] },
        {
          id: 'a1', role: 'assistant', parts: [{
            type: 'tool-log_cards',
            toolCallId: 'signed-1',
            input,
            state: 'approval-responded',
            approval: { id: request.approvalId, approved, signature },
          }],
        },
      ] as never);

    await drain(streamText({
      model: mockModel(),
      messages: await replayMessages(true),
      tools: f.build(),
      experimental_toolApprovalSecret: secret,
    }));
    assert.deepEqual(f.counts(), { previews: 2, writeRequests: 1, writes: 1 });

    // Stateless replay can reach the idempotent endpoint again, but its stable
    // key makes the second request return the original result, not mutate.
    await drain(streamText({
      model: mockModel(), messages: await replayMessages(true), tools: f.build(),
      experimental_toolApprovalSecret: secret,
    }));
    assert.deepEqual(f.counts(), { previews: 3, writeRequests: 2, writes: 1 });

    await drain(streamText({
      model: mockModel(), messages: await replayMessages(false), tools: f.build(),
      experimental_toolApprovalSecret: secret,
    }));
    assert.equal(f.counts().writes, 1, 'decline mutated');

    for (const tamperedInput of [
      { items: [{ card_id: 'me05-001', delta: 2 }] },
      { ...INPUT, dry_run: false },
      { ...INPUT, forged_extra: 'bypass' },
    ]) {
      const tampered = await drain(streamText({
        model: mockModel(),
        messages: await replayMessages(true, tamperedInput),
        tools: f.build(),
        experimental_toolApprovalSecret: secret,
        onError: () => {},
      }));
      assert.ok(tampered.some((p) => p.type === 'error'), 'tampered approval did not fail closed');
      assert.equal(f.counts().writes, 1, 'tampered signed input mutated');
    }

    const legacyFixture = fixture();
    try {
      const legacy = { ...INPUT, dry_run: false };
      const legacyIssued = await drain(streamText({
        model: mockModel([{ toolCallId: 'legacy-1', toolName: 'log_cards', input: legacy }]),
        messages: [{ role: 'user', content: 'add one Bulbasaur' }],
        tools: legacyFixture.build({ conversationalLogging: false }),
        experimental_toolApprovalSecret: secret,
      }));
      const legacyRequest = legacyIssued.find((p) => p.type === 'tool-approval-request');
      assert.ok(legacyRequest && typeof legacyRequest.signature === 'string');
      const legacyReplay = async (input: unknown) => convertToModelMessages([
        { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'add one Bulbasaur' }] },
        {
          id: 'a2', role: 'assistant', parts: [{
            type: 'tool-log_cards', toolCallId: 'legacy-1', input, state: 'approval-responded',
            approval: {
              id: legacyRequest.approvalId,
              approved: true,
              signature: legacyRequest.signature,
            },
          }],
        },
      ] as never);
      const legacyApproved = await drain(streamText({
        model: mockModel(), messages: await legacyReplay(legacy), tools: legacyFixture.build(),
        experimental_toolApprovalSecret: secret, onError: () => {},
      }));
      assert.equal(legacyApproved.some((p) => p.type === 'error'), false);
      assert.equal(legacyFixture.counts().writes, 1, 'valid signed legacy false did not apply');

      const tamperedLegacy = await drain(streamText({
        model: mockModel(),
        messages: await legacyReplay({ items: [{ card_id: 'me05-001', delta: 2 }], dry_run: false }),
        tools: legacyFixture.build(), experimental_toolApprovalSecret: secret, onError: () => {},
      }));
      assert.ok(tamperedLegacy.some((p) => p.type === 'error'), 'tampered legacy approval passed HMAC');
      assert.equal(legacyFixture.counts().writes, 1, 'tampered legacy signed input mutated');
    } finally { legacyFixture.restore(); }
  } finally { f.restore(); }
});
