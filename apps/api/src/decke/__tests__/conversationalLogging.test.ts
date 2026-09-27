import assert from 'node:assert/strict';
import { test } from 'node:test';
import { convertToModelMessages, stepCountIs, streamText, tool } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import { allTools, type ToolDefinition } from '@deckpal/agent-tools';
import { callKey } from '../repeat.js';
import { buildDataTools, correctiveApplyTools, dataToolSummary, requiresApproval } from '../adapters/aisdk.js';
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
    assert.match(tools.log_cards.description, /^REQUEST APPROVAL /);
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

test('real SDK holds signed exposed input; approve writes once, decline/tamper/replay do not add mutations', async (t) => {
  const f = fixture();
  const secret = 'test-only-approval-secret';
  const boundary = Math.ceil(Date.now() / (15 * 60_000)) * (15 * 60_000);
  let now = boundary - 1_000;
  t.mock.method(Date, 'now', () => now);
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
    // key makes the second request return the original result, even when the
    // approval crosses the derived key's 15-minute bucket boundary.
    now = boundary + 1_000;
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

test('corrective list, deck and battle-log calls sign apply intent and wait for approval', async () => {
  const examples = {
    edit_list: { name: 'Chase Cards' },
    save_deck: { name: 'Budget Gardevoir', cards: [] },
    add_battle_log: { deck_id: '00000000-0000-4000-8000-000000000001', log: 'PTCGL battle log' },
  } as const;
  const secret = 'test-only-corrective-approval-secret';
  for (const [name, input] of Object.entries(examples)) {
    const def = allTools().find((d) => d.name === name)!;
    let writes = 0;
    const ordinary = { [name]: tool({
      inputSchema: def.inputSchema!,
      needsApproval: (args: unknown) => requiresApproval(def, args),
      execute: async (args: unknown) => {
        if ((args as { dry_run?: boolean }).dry_run === false) writes++;
        return 'done';
      },
    }) };
    const corrected = correctiveApplyTools(ordinary, name);
    assert.equal(def.inputSchema!.safeParse(input).data?.dry_run, true, `${name} no longer defaults to preview`);
    const schema = corrected[name]!.inputSchema as typeof def.inputSchema;
    assert.equal(schema!.safeParse(input).data?.dry_run, false);
    assert.equal(schema!.safeParse({ ...input, dry_run: true }).success, false);
    const issued = await drain(streamText({
      model: mockModel([{ toolCallId: 'fix-1', toolName: name, input }]),
      messages: [{ role: 'user', content: 'please do it' }],
      tools: corrected as Record<string, any>,
      experimental_toolApprovalSecret: secret,
    }));
    const request = issued.find((p) => p.type === 'tool-approval-request');
    const call = issued.find((p) => p.type === 'tool-call');
    assert.ok(request && call, `${name} did not raise the signed card`);
    assert.equal((call.input as { dry_run?: boolean }).dry_run, false, `${name} signed a preview`);
    assert.equal(typeof request.signature, 'string');
    assert.equal(writes, 0, `${name} wrote before approval`);
    const replay = await convertToModelMessages([
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'please do it' }] },
      { id: 'a1', role: 'assistant', parts: [{
        type: `tool-${name}`, toolCallId: 'fix-1', input: call.input,
        state: 'approval-responded',
        approval: { id: request.approvalId, approved: true, signature: request.signature },
      }] },
    ] as never);
    await drain(streamText({ model: mockModel(), messages: replay, tools: ordinary as Record<string, any>,
      experimental_toolApprovalSecret: secret }));
    assert.equal(writes, 1, `${name} did not apply after the signed approval replay`);
  }
});

// ── THE REFLEX READ FORCES THE QUESTION, NEVER THE ANSWER ───────────────────
//
// `api/chat.mjs` pins step one's `toolChoice` to `log_cards` when Jev reads a
// plain collection change. This drives that exact `prepareStep` shape through
// the real SDK: the model is told it must call log_cards, the call is held
// for a signed approval, and nothing is written until someone approves it.

test('a reflex-forced first step raises the signed consent card and writes nothing', async () => {
  const f = fixture();
  try {
    const choices: unknown[] = [];
    const inner = mockModel([{ toolCallId: 'forced-1', toolName: 'log_cards', input: INPUT }]);
    const model = new MockLanguageModelV3({
      doStream: async (options) => {
        choices.push(options.toolChoice);
        return inner.doStream(options);
      },
    });
    const parts = await drain(streamText({
      model,
      messages: [{ role: 'user', content: 'add one Bulbasaur' }],
      tools: f.build(),
      prepareStep: ({ stepNumber }) =>
        stepNumber === 0 ? { toolChoice: { type: 'tool' as const, toolName: 'log_cards' as const } } : {},
      experimental_toolApprovalSecret: 'test-only-approval-secret',
    }));
    assert.deepEqual(choices[0], { type: 'tool', toolName: 'log_cards' }, 'the forced choice never reached the model');
    const request = parts.find((p) => p.type === 'tool-approval-request');
    assert.ok(request, 'the forced call was not held for consent');
    assert.equal(typeof request.signature, 'string', 'the consent must be signed');
    assert.deepEqual(f.counts(), { previews: 1, writeRequests: 0, writes: 0 }, 'forcing the call wrote something');
  } finally { f.restore(); }
});

// ── THE AUDIT'S CORRECTIVE LEG ASKS, IT NEVER WRITES ────────────────────────
//
// `api/chat.mjs` runs this exact sequence when the after-turn audit finds a
// claimed collection change no tool made: the turn's reply, then one more step
// over the same history with its choice pinned to `log_cards` and the same
// approval secret. Driven through the real SDK: the correction raises a signed
// consent request and nothing is written until someone approves it.

test('a corrective leg after a phantom claim raises the signed card and writes nothing', async () => {
  const f = fixture();
  const secret = 'test-only-approval-secret';
  try {
    const tools = f.build();
    const said = new MockLanguageModelV3({
      doStream: async () => ({
        stream: new ReadableStream({
          start(c) {
            c.enqueue({ type: 'stream-start', warnings: [] });
            c.enqueue({ type: 'text-start', id: '0' });
            c.enqueue({ type: 'text-delta', id: '0', delta: "Done! I've added the Bulbasaur to your collection." });
            c.enqueue({ type: 'text-end', id: '0' });
            c.enqueue({
              type: 'finish',
              finishReason: { unified: 'stop', raw: 'stop' },
              usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } },
            });
            c.close();
          },
        }),
      }),
    });
    const history = [{ role: 'user' as const, content: 'add one Bulbasaur' }];
    const turn = streamText({ model: said, messages: history, tools, experimental_toolApprovalSecret: secret });
    await drain(turn);
    assert.deepEqual(f.counts(), { previews: 0, writeRequests: 0, writes: 0 }, 'the phantom turn did nothing, as claimed');

    // A stream that CLOSES, unlike `mockModel`'s, because chat.mjs reads the
    // leg's `steps` to decide whether the card went up, and a step that never
    // ends never resolves.
    const choices: unknown[] = [];
    const correcting = new MockLanguageModelV3({
      doStream: async (options) => {
        choices.push(options.toolChoice);
        return {
          stream: new ReadableStream({
            start(c) {
              c.enqueue({ type: 'stream-start', warnings: [] });
              c.enqueue({ type: 'tool-call', toolCallId: 'corrective-1', toolName: 'log_cards', input: JSON.stringify(INPUT) });
              c.enqueue({
                type: 'finish',
                finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
                usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } },
              });
              c.close();
            },
          }),
        };
      },
    });
    const leg = streamText({
      model: correcting,
      messages: [...history, ...(await turn.response).messages],
      tools,
      toolChoice: { type: 'tool', toolName: 'log_cards' },
      stopWhen: stepCountIs(1),
      experimental_toolApprovalSecret: secret,
    });
    const parts = await drain(leg);
    assert.deepEqual(choices, [{ type: 'tool', toolName: 'log_cards' }], 'the correction was not pinned to the card');
    const request = parts.find((p) => p.type === 'tool-approval-request');
    assert.ok(request, 'the correction did not raise the consent card');
    assert.equal(typeof request.signature, 'string');
    assert.ok((await leg.steps).some((s) => s.content.some((c) => c.type === 'tool-approval-request')),
      'api/chat.mjs reads the card from the leg\'s steps to decide whether to say it failed');
    assert.deepEqual(f.counts(), { previews: 1, writeRequests: 0, writes: 0 }, 'the correction wrote something');
  } finally { f.restore(); }
});
