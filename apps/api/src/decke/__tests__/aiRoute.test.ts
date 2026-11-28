/**
 * Anthropic-direct with Gateway fallback (`aiRoute.ts`).
 *
 * No test here reaches a network. The direct road is the REAL
 * `@ai-sdk/anthropic` provider with its `fetch` replaced by a fixture that
 * answers in Anthropic's wire format (SSE for streams, JSON for generate,
 * Anthropic's error bodies for refusals), so request building, stream parsing
 * and error construction are the shipped code. The Gateway road is a
 * provider-level fixture model that emits what the Gateway client emits:
 * normalised usage plus `providerMetadata.gateway.cost`. The key is fake.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { APICallError, generateText, stepCountIs, streamText, tool, jsonSchema } from 'ai';
import type { Queryable } from '@deckpal/db';
import {
  DIRECT_COOLDOWN_MS,
  DIRECT_MODELS,
  aiRouteBootLine,
  aiRouteMode,
  aiRouteStatus,
  createModelProvider,
  directCostUsd,
  directRefusal,
  type RoutableModel,
} from '../aiRoute.js';
import { observeUsageModel, resetRouteColumnForTest, runAiUsage, type AiRequest } from '../usage.js';
import { extractUsage } from '../usageMetadata.js';
import { configuredModelIds, priceDrift } from '../modelCheck.js';

const FAKE_KEY = 'sk-ant-test-FAKE-NOT-A-REAL-KEY';
const SONNET = 'anthropic/claude-sonnet-5.5';
const HAIKU = 'anthropic/claude-haiku-5.5';

// ── Fixtures: Anthropic's wire format ───────────────────────────────────────

type RawUsage = { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number; [key: string]: number | undefined }

function sse(events: Record<string, unknown>[]): Response {
  const body = events.map((e) => `event: ${String(e.type)}\ndata: ${JSON.stringify(e)}\n\n`).join('');
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}
function textStream(model: string, text: string, usage: RawUsage): Response {
  return sse([
    { type: 'message_start', message: { id: 'msg_direct_fixture', type: 'message', role: 'assistant', model, content: [], stop_reason: null, usage: { ...usage, output_tokens: 1 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: usage.output_tokens } },
    { type: 'message_stop' },
  ]);
}
function toolStream(model: string, usage: RawUsage): Response {
  return sse([
    { type: 'message_start', message: { id: 'msg_tool_fixture', type: 'message', role: 'assistant', model, content: [], stop_reason: null, usage: { ...usage, output_tokens: 1 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_fixture', name: 'lookup_card', input: {} } },
    { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"name":"Pika' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: 'chu"}' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: usage.output_tokens } },
    { type: 'message_stop' },
  ]);
}
function messageJson(model: string, text: string, usage: RawUsage): Response {
  return Response.json({ id: 'msg_generate_fixture', type: 'message', role: 'assistant', model, content: [{ type: 'text', text }], stop_reason: 'end_turn', stop_sequence: null, usage });
}
function anthropicError(status: number, type: string, message: string, details?: Record<string, unknown>): Response {
  return Response.json({ type: 'error', error: { type, message, ...(details ? { details } : {}) }, request_id: 'req_fixture' }, { status });
}

/** Records every request; answers from a queue (last answer repeats). */
function anthropicFetch(...answers: (() => Response)[]) {
  const calls: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body ?? '{}')) });
    return (answers[Math.min(calls.length - 1, answers.length - 1)]!)();
  }) as typeof fetch;
  return { fetchImpl, calls };
}

// ── Fixtures: the Gateway road ──────────────────────────────────────────────

/** The v4 usage the Gateway client hands back for an Anthropic model. */
function v4Usage(raw: RawUsage) {
  const cr = raw.cache_read_input_tokens ?? 0, cw = raw.cache_creation_input_tokens ?? 0;
  return {
    inputTokens: { total: raw.input_tokens + cr + cw, noCache: raw.input_tokens, cacheRead: cr, cacheWrite: cw },
    outputTokens: { total: raw.output_tokens, text: undefined, reasoning: undefined },
    raw: { ...raw },
  };
}
function gatewayFixture(opts: { usage: RawUsage; cost: string; text?: string; fail?: Error }) {
  const calls: { modelId: string; options: unknown; kind: 'stream' | 'generate' }[] = [];
  const factory = (modelId: string): RoutableModel => ({
    specificationVersion: 'v4',
    provider: 'gateway',
    modelId,
    supportedUrls: {},
    async doGenerate(options: unknown) {
      calls.push({ modelId, options, kind: 'generate' });
      if (opts.fail) throw opts.fail;
      return {
        content: [{ type: 'text', text: opts.text ?? 'via gateway' }],
        finishReason: { unified: 'stop', raw: 'end_turn' },
        usage: v4Usage(opts.usage),
        providerMetadata: { gateway: { cost: opts.cost, generationId: 'gen_gateway_fixture' } },
        response: { id: 'gen_gateway_fixture' },
        warnings: [],
      };
    },
    async doStream(options: unknown) {
      calls.push({ modelId, options, kind: 'stream' });
      if (opts.fail) throw opts.fail;
      const text = opts.text ?? 'via gateway';
      return {
        stream: new ReadableStream({
          start(c) {
            c.enqueue({ type: 'stream-start', warnings: [] });
            c.enqueue({ type: 'text-start', id: 't' });
            c.enqueue({ type: 'text-delta', id: 't', delta: text });
            c.enqueue({ type: 'text-end', id: 't' });
            c.enqueue({ type: 'finish', finishReason: { unified: 'stop', raw: 'end_turn' }, usage: v4Usage(opts.usage),
              providerMetadata: { gateway: { cost: opts.cost, generationId: 'gen_gateway_fixture' } } });
            c.close();
          },
        }),
      };
    },
  } as unknown as RoutableModel);
  return { factory, calls };
}

function provider(fetchImpl: typeof fetch, gateway: (id: string) => RoutableModel, extra: { now?: () => number } = {}) {
  const logs: string[] = [];
  const p = createModelProvider({ gatewayKey: 'gw-test', anthropicKey: FAKE_KEY, anthropicFetch: fetchImpl, gateway, log: (l) => logs.push(l), ...extra });
  return { p, logs };
}

async function drain(model: RoutableModel, prompt = 'Hello') {
  const result = streamText({ model, prompt, maxRetries: 0, onError: () => {} });
  let text = '';
  const errors: unknown[] = [];
  for await (const part of result.fullStream) {
    if (part.type === 'text-delta') text += part.text;
    if (part.type === 'error') errors.push(part.error);
  }
  const metadata = errors.length ? undefined : await result.providerMetadata;
  return { text, errors, metadata };
}

const USAGE: RawUsage = { input_tokens: 1200, output_tokens: 42, cache_read_input_tokens: 800, cache_creation_input_tokens: 100 };
// What the Gateway charges for USAGE on Sonnet 5.5, worked by hand from its
// published rates: 1200×$0.000002 + 800×$0.0000001 + 100×$0.0000025 + 42×$0.00001.
const SONNET_COST = '0.00315';

// ── Mode ────────────────────────────────────────────────────────────────────

test('no ANTHROPIC_API_KEY: the provider IS the Gateway provider, untouched', () => {
  const gw = gatewayFixture({ usage: USAGE, cost: SONNET_COST });
  const p = createModelProvider({ gatewayKey: 'gw', anthropicKey: null, gateway: gw.factory });
  assert.equal(p, gw.factory, 'no wrapper exists to change behaviour');
  assert.equal(aiRouteMode({}).mode, 'gateway-only');
  assert.equal(aiRouteStatus({}), 'gateway-only');
  assert.equal(aiRouteStatus({ ANTHROPIC_API_KEY: '   ' }), 'gateway-only');
});

test('a key without the sk-ant- prefix is ignored and said so; the key never appears in any line', () => {
  for (const env of [{ ANTHROPIC_API_KEY: FAKE_KEY }, { ANTHROPIC_API_KEY: 'not-a-key-SECRET' }, {}]) {
    const line = aiRouteBootLine(env);
    assert.ok(line.startsWith('[ai-route] mode: '));
    assert.equal(line.includes(env.ANTHROPIC_API_KEY ?? '\u0000'), false);
  }
  assert.equal(aiRouteStatus({ ANTHROPIC_API_KEY: 'not-a-key-SECRET' }), 'gateway-only-malformed-key');
  assert.equal(aiRouteStatus({ ANTHROPIC_API_KEY: FAKE_KEY }), 'anthropic-direct');
  assert.match(aiRouteBootLine({ ANTHROPIC_API_KEY: 'x' }), /IGNORED/);
});

test('non-Anthropic models are the Gateway model itself even with a key set', () => {
  const gw = gatewayFixture({ usage: USAGE, cost: '0' });
  const { p } = provider(anthropicFetch(() => { throw new Error('must not be called'); }).fetchImpl, gw.factory);
  for (const id of ['google/gemini-2.5-flash', 'openai/gpt-5-mini', 'perplexity/sonar', 'typesafe-ai/jev']) {
    const m = p(id);
    assert.equal(m.provider, 'gateway');
    assert.equal(m.modelId, id);
    assert.equal(Object.keys(m).includes('doStream'), true);
  }
});

test('every Anthropic model DeckPal is configured to call has a direct row (so none silently stays on the Gateway)', () => {
  const anthropic = configuredModelIds().filter((id) => id.startsWith('anthropic/'));
  assert.ok(anthropic.length >= 5);
  for (const id of anthropic) assert.ok(DIRECT_MODELS[id], `${id} has no DIRECT_MODELS row`);
});

// ── Direct road ─────────────────────────────────────────────────────────────

test('direct stream: real Anthropic provider, owner key, Anthropic model id, Gateway identity on the model', async () => {
  const a = anthropicFetch(() => textStream('claude-sonnet-5-5', 'Hi from Anthropic', USAGE));
  const gw = gatewayFixture({ usage: USAGE, cost: SONNET_COST });
  const { p } = provider(a.fetchImpl, gw.factory);
  const model = p(SONNET);
  assert.equal(model.provider, 'gateway');
  assert.equal(model.modelId, SONNET);
  const out = await drain(model);
  assert.equal(out.text, 'Hi from Anthropic');
  assert.equal(gw.calls.length, 0);
  assert.equal(a.calls.length, 1);
  assert.match(a.calls[0]!.url, /^https:\/\/api\.anthropic\.com\/v1\/messages$/);
  assert.equal(a.calls[0]!.headers.get('x-api-key'), FAKE_KEY);
  assert.equal(a.calls[0]!.body.model, 'claude-sonnet-5-5');
  assert.equal(a.calls[0]!.body.stream, true);
  assert.deepEqual(out.metadata?.deckpal, { cost: SONNET_COST, generationId: 'msg_direct_fixture', route: 'direct' });
});

test('direct stream carries Anthropic provider options (adaptive thinking, effort, cache control) and tool calls', async () => {
  const a = anthropicFetch(() => toolStream('claude-sonnet-5-5', USAGE), () => textStream('claude-sonnet-5-5', 'Done', USAGE));
  const gw = gatewayFixture({ usage: USAGE, cost: SONNET_COST });
  const { p } = provider(a.fetchImpl, gw.factory);
  const seen: unknown[] = [];
  const result = streamText({
    model: p(SONNET),
    maxRetries: 0,
    stopWhen: stepCountIs(3),
    // The shape api/chat.mjs sends: cached `instructions`, plus a
    // mid-conversation system message (the progress nudge) on Anthropic.
    instructions: [{ role: 'system', content: 'Core prompt', providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } } }],
    allowSystemInMessages: true,
    messages: [
      { role: 'user', content: 'Find Pikachu' },
      { role: 'system', content: 'NUDGE_SENTINEL' },
    ],
    providerOptions: { gateway: { models: ['google/gemini-2.5-flash'] }, anthropic: { effort: 'medium', thinking: { type: 'adaptive' } } },
    tools: {
      lookup_card: tool({
        description: 'Look up a card',
        inputSchema: jsonSchema<{ name: string }>({ type: 'object', properties: { name: { type: 'string' } }, required: ['name'] }),
        execute: async (input) => { seen.push(input); return { found: true }; },
      }),
    },
  });
  let text = '';
  for await (const part of result.fullStream) if (part.type === 'text-delta') text += part.text;
  assert.deepEqual(seen, [{ name: 'Pikachu' }], 'tool input streamed and parsed on the direct road');
  assert.equal(text, 'Done');
  assert.equal(a.calls.length, 2, 'the tool loop stayed on the direct road');
  const first = a.calls[0]!.body as { thinking?: unknown; system?: { cache_control?: unknown }[]; tools?: { name: string }[]; output_config?: { effort?: string } };
  assert.deepEqual(first.thinking, { type: 'adaptive' });
  assert.equal(first.output_config?.effort, 'medium');
  assert.deepEqual(first.system?.[0]?.cache_control, { type: 'ephemeral' });
  assert.equal(first.tools?.[0]?.name, 'lookup_card');
  assert.match(JSON.stringify(a.calls[0]!.body), /NUDGE_SENTINEL/, 'the mid-conversation system message reaches Anthropic');
  assert.equal(JSON.stringify(a.calls[0]!.body).includes('gemini'), false, 'Gateway-only options never reach Anthropic');
  assert.equal(gw.calls.length, 0);
});

test('direct generate: generateText on the direct road prices the call and records the route', async () => {
  const a = anthropicFetch(() => messageJson('claude-sonnet-5-5', 'Fixed lines', USAGE));
  const gw = gatewayFixture({ usage: USAGE, cost: SONNET_COST });
  const { p } = provider(a.fetchImpl, gw.factory);
  const result = await generateText({ model: p(SONNET), prompt: 'fix', maxRetries: 0 });
  assert.equal(result.text, 'Fixed lines');
  assert.equal(gw.calls.length, 0);
  assert.deepEqual(result.providerMetadata?.deckpal, { cost: SONNET_COST, generationId: 'msg_generate_fixture', route: 'direct' });
});

// ── Fallback triggers ───────────────────────────────────────────────────────

const CREDIT_LOW = () => anthropicError(400, 'invalid_request_error', 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.');
const USAGE_LIMIT = () => anthropicError(400, 'invalid_request_error', 'You have reached your specified API usage limits. You will regain access on 2026-12-01 at 00:00 UTC.');
const BILLING = () => anthropicError(402, 'billing_error', 'There is a problem with your billing.');
const SPEND_CAP = () => anthropicError(429, 'rate_limit_error', 'You have reached your monthly spend limit.', { error_code: 'enforced_spend_limit_reached' });
const SPEND_CAP_CODE_ONLY = () => anthropicError(429, 'rate_limit_error', 'Request blocked.', { error_code: 'enforced_spend_limit_reached' });
const AUTH = () => anthropicError(401, 'authentication_error', 'invalid x-api-key');

for (const [name, answer, reason] of [
  ['400 credit balance too low', CREDIT_LOW, 'credit_balance'],
  ['400 usage limits reached', USAGE_LIMIT, 'usage_limit'],
  ['402 billing_error', BILLING, 'billing'],
  ['429 enforced_spend_limit_reached', SPEND_CAP, 'spend_limit'],
  ['429 spend cap by error_code alone', SPEND_CAP_CODE_ONLY, 'spend_limit'],
  ['401 rejected key', AUTH, 'auth'],
] as const) {
  test(`fallback trigger — ${name}: the same request is served by the Gateway`, async () => {
    const a = anthropicFetch(answer);
    const gw = gatewayFixture({ usage: USAGE, cost: SONNET_COST, text: 'served by gateway' });
    const { p, logs } = provider(a.fetchImpl, gw.factory);
    const out = await drain(p(SONNET), 'PROMPT_SENTINEL');
    assert.deepEqual(out.errors, []);
    assert.equal(out.text, 'served by gateway');
    assert.equal(a.calls.length, 1, 'one direct attempt, never retried on the direct road');
    assert.equal(gw.calls.length, 1);
    assert.equal(gw.calls[0]!.modelId, SONNET, 'same model on the Gateway');
    assert.match(JSON.stringify(gw.calls[0]!.options), /PROMPT_SENTINEL/, 'same prompt on the Gateway');
    assert.equal((out.metadata?.deckpal as { route?: string })?.route, 'gateway_fallback');
    assert.equal(logs.length, 1);
    assert.ok(logs[0]!.includes(reason === 'auth' ? 'REJECTED' : reason));
    assert.equal(logs.join('').includes(FAKE_KEY), false, 'the key is never logged');
  });
}

for (const [name, answer] of [
  ['400 ordinary bad request', () => anthropicError(400, 'invalid_request_error', 'messages: roles must alternate between "user" and "assistant"')],
  ['403 permission', () => anthropicError(403, 'permission_error', 'Not allowed')],
  ['404 model', () => anthropicError(404, 'not_found_error', 'model: claude-nope')],
  ['413 too large', () => anthropicError(413, 'request_too_large', 'Request exceeds the maximum size')],
  ['429 plain rate limit', () => anthropicError(429, 'rate_limit_error', 'Number of request tokens has exceeded your per-minute rate limit')],
  ['500 api_error', () => anthropicError(500, 'api_error', 'Internal server error')],
  ['529 overloaded', () => anthropicError(529, 'overloaded_error', 'Overloaded')],
  ['500 that mentions credit (5xx never matches by message)', () => anthropicError(500, 'api_error', 'credit balance is too low')],
] as const) {
  test(`NOT a fallback trigger — ${name}: the error is the answer, the Gateway is never called`, async () => {
    const a = anthropicFetch(answer);
    const gw = gatewayFixture({ usage: USAGE, cost: SONNET_COST });
    const { p, logs } = provider(a.fetchImpl, gw.factory);
    const out = await drain(p(SONNET));
    assert.equal(out.errors.length, 1);
    assert.equal(gw.calls.length, 0);
    assert.equal(logs.length, 0);
  });
}

test('NOT a fallback trigger — a network failure or an abort', async () => {
  const gw = gatewayFixture({ usage: USAGE, cost: SONNET_COST });
  const { p } = provider((async () => { throw new TypeError('fetch failed'); }) as typeof fetch, gw.factory);
  const out = await drain(p(SONNET));
  assert.equal(out.errors.length, 1);
  assert.equal(gw.calls.length, 0);
  assert.equal(directRefusal(new DOMException('Cancelled', 'AbortError')), null);
});

test('a refusal (stop_reason) is not an error and never falls back', async () => {
  const refusal = () => sse([
    { type: 'message_start', message: { id: 'msg_r', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content: [], stop_reason: null, usage: { input_tokens: 10, output_tokens: 1 } } },
    { type: 'message_delta', delta: { stop_reason: 'refusal', stop_sequence: null }, usage: { output_tokens: 3 } },
    { type: 'message_stop' },
  ]);
  const gw = gatewayFixture({ usage: USAGE, cost: SONNET_COST });
  const { p } = provider(anthropicFetch(refusal).fetchImpl, gw.factory);
  const out = await drain(p(SONNET));
  assert.deepEqual(out.errors, []);
  assert.equal(gw.calls.length, 0);
  assert.equal((out.metadata?.deckpal as { route?: string })?.route, 'direct');
});

test('in-stream billing error BEFORE any output falls back; nothing from the direct stream reaches the reader', async () => {
  const early = () => sse([
    { type: 'message_start', message: { id: 'msg_e', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content: [], stop_reason: null, usage: { input_tokens: 10, output_tokens: 1 } } },
    { type: 'error', error: { type: 'billing_error', message: 'Your credit balance is too low to access the Anthropic API.' } },
  ]);
  const gw = gatewayFixture({ usage: USAGE, cost: SONNET_COST, text: 'gateway answer' });
  const { p } = provider(anthropicFetch(early).fetchImpl, gw.factory);
  const out = await drain(p(SONNET));
  assert.deepEqual(out.errors, []);
  assert.equal(out.text, 'gateway answer');
  assert.equal(gw.calls.length, 1);
});

test('an error AFTER output has started is never spliced onto a Gateway stream', async () => {
  const late = () => sse([
    { type: 'message_start', message: { id: 'msg_l', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content: [], stop_reason: null, usage: { input_tokens: 10, output_tokens: 1 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Partial ' } },
    { type: 'error', error: { type: 'billing_error', message: 'Your credit balance is too low.' } },
  ]);
  const gw = gatewayFixture({ usage: USAGE, cost: SONNET_COST, text: 'MUST NOT APPEAR' });
  const { p } = provider(anthropicFetch(late).fetchImpl, gw.factory);
  const out = await drain(p(SONNET));
  assert.equal(out.text, 'Partial ');
  assert.equal(out.errors.length, 1, 'the direct stream ends in its own error');
  assert.equal(gw.calls.length, 0);
});

test('generate fallback: a credit refusal on doGenerate is served by the Gateway', async () => {
  const gw = gatewayFixture({ usage: USAGE, cost: SONNET_COST, text: 'gateway generate' });
  const { p } = provider(anthropicFetch(CREDIT_LOW).fetchImpl, gw.factory);
  const result = await generateText({ model: p(SONNET), prompt: 'x', maxRetries: 0 });
  assert.equal(result.text, 'gateway generate');
  assert.equal(gw.calls[0]!.kind, 'generate');
  assert.equal((result.providerMetadata?.deckpal as { route?: string })?.route, 'gateway_fallback');
  assert.equal(result.providerMetadata?.gateway?.cost, SONNET_COST);
});

test('after a credit refusal the direct road cools down, then is tried again', async () => {
  let clock = 1_000;
  const a = anthropicFetch(CREDIT_LOW, CREDIT_LOW, () => textStream('claude-sonnet-5-5', 'back', USAGE));
  const gw = gatewayFixture({ usage: USAGE, cost: SONNET_COST });
  const { p } = provider(a.fetchImpl, gw.factory, { now: () => clock });
  await drain(p(SONNET));
  assert.equal(a.calls.length, 1);
  clock += DIRECT_COOLDOWN_MS - 1;
  const cooled = await drain(p(SONNET));
  assert.equal(a.calls.length, 1, 'no direct attempt while cooling');
  assert.equal((cooled.metadata?.deckpal as { route?: string })?.route, 'gateway_fallback');
  clock += 2;
  await drain(p(SONNET));
  assert.equal(a.calls.length, 2, 'tried again after the cooldown');
});

// ── Classifier, directly ────────────────────────────────────────────────────

test('directRefusal on hand-built SDK errors', () => {
  const callError = (statusCode: number, body: unknown) => new APICallError({
    message: 'x', url: 'https://api.anthropic.com/v1/messages', requestBodyValues: {}, statusCode, responseBody: JSON.stringify(body),
  });
  assert.equal(directRefusal(callError(402, { type: 'error', error: { type: 'billing_error', message: 'pay' } })), 'billing');
  assert.equal(directRefusal(callError(400, { type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low' } })), 'credit_balance');
  assert.equal(directRefusal(callError(429, { type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } })), null);
  assert.equal(directRefusal(callError(503, { type: 'error', error: { type: 'billing_error', message: 'x' } })), null, 'never on a 5xx');
  // In-stream shape: the provider's stream error object.
  assert.equal(directRefusal({ type: 'billing_error', message: 'x', data: { type: 'billing_error', message: 'x' } }), 'billing');
  assert.equal(directRefusal({ type: 'overloaded_error', statusCode: 529, message: 'x', data: { type: 'overloaded_error' } }), null);
  assert.equal(directRefusal(new Error('boom')), null);
  assert.equal(directRefusal(null), null);
});

// ── Cost ────────────────────────────────────────────────────────────────────

test('direct cost is exact decimal arithmetic at the Gateway rates', () => {
  assert.equal(directCostUsd(SONNET, v4Usage(USAGE)), SONNET_COST);
  // Haiku 5.5 below and above its 100k prompt band (the Gateway's tier starts at 100001).
  assert.equal(directCostUsd(HAIKU, v4Usage({ input_tokens: 5000, output_tokens: 200 })), '0.0006');
  assert.equal(directCostUsd(HAIKU, v4Usage({ input_tokens: 100_000, output_tokens: 0 })), '0.01');
  assert.equal(directCostUsd(HAIKU, v4Usage({ input_tokens: 100_001, output_tokens: 0 })), '0.0500005');
  assert.equal(directCostUsd(HAIKU, v4Usage({ input_tokens: 150_000, output_tokens: 1000 })), '0.0775');
  // Cache tokens count toward the band.
  assert.equal(directCostUsd(HAIKU, v4Usage({ input_tokens: 1, output_tokens: 0, cache_read_input_tokens: 100_000 })), '0.0050005');
  // A sub-micro-dollar amount floats would get wrong: 7 × $0.0000001375 is not a binary fraction.
  assert.equal(directCostUsd('anthropic/claude-opus-5.5', v4Usage({ input_tokens: 3, output_tokens: 7, cache_read_input_tokens: 11 })), '0.0001542');
  assert.equal(directCostUsd('anthropic/claude-opus-5.5', v4Usage({ input_tokens: 0, output_tokens: 0 })), '0');
  // Honest unknowns.
  assert.equal(directCostUsd('anthropic/claude-unknown', v4Usage(USAGE)), null);
  assert.equal(directCostUsd(SONNET, { inputTokens: {}, outputTokens: {} }), null);
});

test('the rate table matches the Gateway price list it was copied from; drift is reported', () => {
  const rows = [
    { id: 'anthropic/claude-haiku-4.5', pricing: { input: '0.000001', output: '0.000005', input_cache_read: '0.0000001', input_cache_write: '0.00000125' } },
    { id: HAIKU, pricing: { input: '0.0000001', output: '0.0000005', input_cache_read: '0.00000001', input_cache_write: '0.000000125',
      input_tiers: [{ cost: '0.0000001', min: 0, max: 100001 }, { cost: '0.0000005', min: 100001 }],
      output_tiers: [{ cost: '0.0000005', min: 0, max: 100001 }, { cost: '0.0000025', min: 100001 }],
      input_cache_read_tiers: [{ cost: '0.00000001', min: 0, max: 100001 }, { cost: '0.00000005', min: 100001 }],
      input_cache_write_tiers: [{ cost: '0.000000125', min: 0, max: 100001 }, { cost: '0.000000625', min: 100001 }] } },
    { id: 'anthropic/claude-opus-5', pricing: { input: '0.000005', output: '0.000025', input_cache_read: '0.0000005', input_cache_write: '0.00000625' } },
    { id: 'anthropic/claude-opus-5.5', pricing: { input: '0.000004', output: '0.00002', input_cache_read: '0.0000002', input_cache_write: '0.000005' } },
    { id: 'anthropic/claude-sonnet-5', pricing: { input: '0.000002', output: '0.00001', input_cache_read: '0.0000002', input_cache_write: '0.0000025' } },
    { id: SONNET, pricing: { input: '0.000002', output: '0.00001', input_cache_read: '0.0000001', input_cache_write: '0.0000025' } },
    { id: 'openai/gpt-5-mini', pricing: { input: '1', output: '1' } },
  ];
  assert.deepEqual(priceDrift(rows), []);
  const cut = rows.map((r) => (r.id === SONNET ? { ...r, pricing: { ...r.pricing, output: '0.000008' } } : r));
  assert.deepEqual(priceDrift(cut), [SONNET]);
  const newBand = rows.map((r) => (r.id === SONNET ? { ...r, pricing: { ...r.pricing, input_tiers: [{ cost: '0.000002', min: 0 }, { cost: '0.000004', min: 200001 }] } } : r));
  assert.deepEqual(priceDrift(newBand), [SONNET], 'a new long-context band the table does not know is drift');
});

// ── Metering parity ─────────────────────────────────────────────────────────

function meterFixture(opts: { noRouteColumn?: boolean } = {}) {
  const records: { sql: string; args: unknown[] }[] = [];
  const db = { query: async (sql: string, args: unknown[] = []) => {
    if (opts.noRouteColumn && sql.includes('route=$12')) throw Object.assign(new Error('column "route" does not exist'), { code: '42703' });
    records.push({ sql, args });
    return { rows: [{ data: { id: '00000000-0000-4000-8000-000000000099' } }] };
  } } as unknown as Queryable;
  const request: AiRequest = { id: '00000000-0000-4000-8000-000000000099', db, pending: new Set(), failed: false, metered: false, meteredStarted: false, capReached: false };
  return { records, request };
}

/** Run one metered streamText call and return the rows it wrote. */
async function meteredRun(model: RoutableModel, opts: { noRouteColumn?: boolean } = {}) {
  const f = meterFixture(opts);
  await runAiUsage(f.request, async () => {
    const result = streamText({ model: observeUsageModel(model), prompt: 'Same request', maxRetries: 0, onError: () => {} });
    for await (const _ of result.fullStream) { /* drain */ }
  });
  await Promise.allSettled([...f.request.pending]);
  const begin = f.records.find((r) => r.sql.startsWith('SELECT public.decke_usage_operation_begin'))!;
  const finish = f.records.find((r) => r.sql.startsWith('UPDATE public.decke_ai_operation'))!;
  return { begin, finish, records: f.records };
}

for (const [label, gatewayId, anthropicId, usage, gatewayCost] of [
  ['Sonnet 5.5 with cache read + write', SONNET, 'claude-sonnet-5-5', USAGE, SONNET_COST],
  ['Haiku 5.5, short prompt', HAIKU, 'claude-haiku-5-5', { input_tokens: 5000, output_tokens: 200 }, '0.0006'],
  ['Haiku 5.5, long-context band', HAIKU, 'claude-haiku-5-5', { input_tokens: 150_000, output_tokens: 1000 }, '0.0775'],
  ['Opus 5.5 with cache read', 'anthropic/claude-opus-5.5', 'claude-opus-5-5', { input_tokens: 2000, output_tokens: 900, cache_read_input_tokens: 40_000 }, '0.034'],
] as const) {
  test(`metering parity — ${label}: the same request writes the same meter row on all three roads`, async () => {
    resetRouteColumnForTest();
    const gwOnly = gatewayFixture({ usage, cost: gatewayCost });
    const viaGateway = await meteredRun(createModelProvider({ gatewayKey: 'gw', anthropicKey: null, gateway: gwOnly.factory })(gatewayId));

    const direct = await meteredRun(provider(anthropicFetch(() => textStream(anthropicId, 'ok', usage)).fetchImpl,
      gatewayFixture({ usage, cost: gatewayCost }).factory).p(gatewayId));

    const fellBack = await meteredRun(provider(anthropicFetch(CREDIT_LOW).fetchImpl,
      gatewayFixture({ usage, cost: gatewayCost }).factory).p(gatewayId));

    // Begin row: everything but the random operation id — category, tool,
    // model_id, provider, operation key, credit spend.
    assert.deepEqual(direct.begin.args.slice(1), viaGateway.begin.args.slice(1));
    assert.deepEqual(fellBack.begin.args.slice(1), viaGateway.begin.args.slice(1));
    assert.equal(viaGateway.begin.args[4], gatewayId, 'model_id is the Gateway id on every road');
    assert.equal(direct.begin.args[5], 'gateway', 'provider is the Gateway on every road');

    // Finish row: status, the five token counts, cost_usd, cost_source, error.
    // Index 9 is the provider's own generation id; index 11 is the route.
    const meter = (r: typeof direct) => [...r.finish.args.slice(1, 9), r.finish.args[10]];
    assert.deepEqual(meter(direct), meter(viaGateway));
    assert.deepEqual(meter(fellBack), meter(viaGateway));
    assert.equal(viaGateway.finish.args[7], gatewayCost);
    assert.equal(viaGateway.finish.args[8], 'provider_reported');
    assert.deepEqual([viaGateway.finish.args[11], direct.finish.args[11], fellBack.finish.args[11]], ['gateway', 'direct', 'gateway_fallback']);
    assert.match(String(direct.finish.args[9]), /^msg_/);
    assert.equal(viaGateway.finish.args[9], 'gen_gateway_fixture');
  });
}

test('metering parity for the import fix (generateText → extractUsage → settlement values)', async () => {
  const usage = { input_tokens: 900, output_tokens: 120 };
  const cost = '0.003'; // 900×0.000002 + 120×0.00001
  const viaGateway = await generateText({ model: gatewayFixture({ usage, cost }).factory(SONNET), prompt: 'x', maxRetries: 0 });
  const direct = await generateText({
    model: provider(anthropicFetch(() => messageJson('claude-sonnet-5-5', 'ok', usage)).fetchImpl, gatewayFixture({ usage, cost }).factory).p(SONNET),
    prompt: 'x', maxRetries: 0,
  });
  const a = extractUsage(viaGateway.usage, viaGateway.providerMetadata);
  const b = extractUsage(direct.usage, direct.providerMetadata);
  assert.deepEqual(b.tokens, a.tokens);
  assert.deepEqual(b.cost, a.cost);
  assert.equal(a.cost.usd, cost);
  assert.deepEqual([a.route, b.route], ['gateway', 'direct']);
});

test('a database without migration 092 still meters every call, and says so once', async () => {
  resetRouteColumnForTest();
  const warn = console.warn;
  const warned: string[] = [];
  console.warn = (line: string) => { warned.push(String(line)); };
  try {
    const first = await meteredRun(provider(anthropicFetch(() => textStream('claude-sonnet-5-5', 'ok', USAGE)).fetchImpl,
      gatewayFixture({ usage: USAGE, cost: SONNET_COST }).factory).p(SONNET), { noRouteColumn: true });
    assert.equal(first.finish.args.length, 11, 'the pre-092 UPDATE');
    assert.equal(first.finish.args[7], SONNET_COST);
    const second = await meteredRun(provider(anthropicFetch(() => textStream('claude-sonnet-5-5', 'ok', USAGE)).fetchImpl,
      gatewayFixture({ usage: USAGE, cost: SONNET_COST }).factory).p(SONNET), { noRouteColumn: true });
    assert.equal(second.finish.args.length, 11);
    assert.equal(warned.filter((l) => l.includes('migration 092')).length, 1);
  } finally {
    console.warn = warn;
    resetRouteColumnForTest();
  }
});
