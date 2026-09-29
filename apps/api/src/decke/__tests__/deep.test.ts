import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MockLanguageModelV3 } from 'ai/test';
import type { GatewayProvider } from '@ai-sdk/gateway';
import { buildDeepTools, DECKE_DEEP_BUDGET_VAR } from '../deep.js';
import { DEEP_TOOLS } from '../tools.js';

const CTX = {
  pool: null as never,
  userId: 'u1',
  jwt: 'jwt',
  apiBase: 'https://example.test/api',
};
const USAGE = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};
const finish = (reason: 'stop' | 'length' = 'stop') => ({
  type: 'finish' as const,
  finishReason: { unified: reason, raw: reason },
  usage: USAGE,
});

function gateway(chunks: unknown[]): GatewayProvider {
  const model = new MockLanguageModelV3({
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(chunk);
          controller.close();
        },
      }) as never,
    }),
  });
  return (() => model) as unknown as GatewayProvider;
}

type Event = {
  phase: string;
  label?: string;
  summary?: string;
  sources?: Array<{ url: string; title: string; host: string }>;
};
type Runnable = {
  inputSchema?: { safeParse: (input: unknown) => { success: boolean } };
  needsApproval?: (input: unknown) => boolean | Promise<boolean>;
  execute: (input: Record<string, unknown>, options: { toolCallId: string }) => Promise<string>;
};

function tools(chunks: unknown[], events: Event[] = []): Record<string, Runnable> {
  return buildDeepTools({
    ctx: CTX,
    gateway: gateway(chunks),
    charge: async () => ({ allowed: true }),
    onEvent: (event) => events.push(event as Event),
  }) as unknown as Record<string, Runnable>;
}

test('Deck-E exposes only web_research and it never asks for approval', async () => {
  const built = tools([]);
  assert.deepEqual(Object.keys(built), ['web_research']);
  assert.deepEqual([...DEEP_TOOLS], Object.keys(built));
  assert.equal(
    await built.web_research!.needsApproval?.({ query: 'current meta', topic: 'competitive', purpose: 'Current meta' }),
    false,
  );
  assert.equal(built.web_research!.inputSchema?.safeParse({ query: 'current meta', topic: 'competitive' }).success, false);
  assert.equal(built.web_research!.inputSchema?.safeParse({ query: 'current meta', topic: 'competitive', purpose: '  ' }).success, false);
});

test('purpose becomes a bounded label on every event and is derived when omitted', async () => {
  const events: Event[] = [];
  const built = tools([
    { type: 'stream-start', warnings: [] },
    { type: 'text-start', id: '0' },
    { type: 'text-delta', id: '0', delta: 'Dragapult ex leads current results.' },
    { type: 'text-end', id: '0' },
    finish(),
  ], events);
  await built.web_research!.execute(
    { query: '  Dragapult ex tournament results this season  ', topic: 'competitive' },
    { toolCallId: 'r1' },
  );
  assert.ok(events.length > 1);
  for (const event of events) {
    assert.equal(event.label, 'Searching: Dragapult ex tournament results this season');
    assert.ok((event.label?.length ?? 0) <= 70);
  }
});

test('sources accumulate, dedupe and cap at 12 on chip events only', async () => {
  const events: Event[] = [];
  const sources = Array.from({ length: 14 }, (_, i) => ({
    type: 'source',
    sourceType: 'url',
    id: `s${i}`,
    url: `https://source${i}.example/article`,
    title: i === 0 ? 'Tournament report' : undefined,
  }));
  sources.splice(2, 0, { ...sources[0]!, id: 'duplicate' });
  sources.splice(3, 0, {
    type: 'source', sourceType: 'url', id: 'http', url: 'http://unsafe.example/x', title: 'No',
  });
  const built = tools([
    { type: 'stream-start', warnings: [] },
    ...sources,
    { type: 'text-start', id: '0' },
    {
      type: 'text-delta', id: '0',
      delta: 'The field is led by Dragapult ex (https://source0.example/article).',
    },
    { type: 'text-end', id: '0' },
    finish(),
  ], events);
  const output = await built.web_research!.execute(
    { query: 'current Standard field', topic: 'competitive', purpose: 'Current Standard field' },
    { toolCallId: 'r2' },
  );
  const terminal = events.at(-1)!;
  assert.equal(terminal.phase, 'ok');
  assert.equal(terminal.sources?.length, 12);
  assert.equal(new Set(terminal.sources?.map((source) => source.url)).size, 12);
  assert.deepEqual(
    terminal.sources?.map((source) => source.url),
    Array.from({ length: 12 }, (_, i) => `https://source${i}.example/article`),
  );
  assert.deepEqual(terminal.sources?.[0], {
    url: 'https://source0.example/article', title: 'Tournament report', host: 'source0.example',
  });
  assert.ok(events.some((event) => event.phase === 'progress' && event.sources?.length === 1));
  assert.deepEqual(output.match(/https?:\/\/[^\s)]+/g) ?? [], [], 'full URL leaked to model text');
  assert.match(output, /Dragapult ex \(source0\.example\)/);
  assert.match(output, /\[1\] source0\.example/);
});

test('terminal summary is the first findings sentence, never the untrusted-content frame', async () => {
  const events: Event[] = [];
  const built = tools([
    { type: 'stream-start', warnings: [] },
    { type: 'text-start', id: '0' },
    { type: 'text-delta', id: '0', delta: 'Dragapult ex won the latest event. A second detail follows.' },
    { type: 'text-end', id: '0' },
    finish(),
  ], events);
  const output = await built.web_research!.execute(
    { query: 'latest event', topic: 'competitive', purpose: 'Latest event' },
    { toolCallId: 'r3' },
  );
  assert.match(output, /^The following was fetched from the open web/);
  assert.equal(events.at(-1)?.summary, 'Dragapult ex won the latest event.');
  assert.equal(events.at(-1)?.summary?.includes('fetched from the open web'), false);
});

test('a provider failure gets a failure summary, not the successful empty-search summary', async () => {
  const events: Event[] = [];
  const built = tools([
    { type: 'stream-start', warnings: [] },
    { type: 'error', error: new Error('research service unavailable') },
    finish(),
  ], events);
  const output = await built.web_research!.execute(
    { query: 'latest event', topic: 'competitive', purpose: 'Latest event' },
    { toolCallId: 'r-fail' },
  );
  assert.match(output, /^\[\[NO_WORK\]\] Web research failed/);
  assert.equal(events.at(-1)?.phase, 'error');
  assert.match(events.at(-1)?.summary ?? '', /^Web research failed —/);
  assert.doesNotMatch(events.at(-1)?.summary ?? '', /returned no findings/);
});

test('a successful empty search alone says it returned no findings', async () => {
  const events: Event[] = [];
  const built = tools([{ type: 'stream-start', warnings: [] }, finish()], events);
  const output = await built.web_research!.execute(
    { query: 'obscure result', topic: 'general', purpose: 'Obscure result' },
    { toolCallId: 'r-empty' },
  );
  assert.equal(events.at(-1)?.phase, 'ok');
  assert.equal(events.at(-1)?.summary, 'Web research returned no findings');
  assert.match(output, /^The following was fetched from the open web/);
});

test('a timeout is partial and plainly marks the returned research incomplete', async () => {
  const previous = process.env[DECKE_DEEP_BUDGET_VAR];
  process.env[DECKE_DEEP_BUDGET_VAR] = '20';
  const events: Event[] = [];
  let sent = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const model = new MockLanguageModelV3({
    doStream: async () => ({
      stream: new ReadableStream({
        pull(controller) {
          return new Promise<void>((resolve) => {
            timer = setTimeout(() => {
              if (!sent) {
                controller.enqueue({ type: 'stream-start', warnings: [] });
                controller.enqueue({ type: 'text-start', id: '0' });
                controller.enqueue({ type: 'text-delta', id: '0', delta: 'One useful finding.' });
                sent = true;
              } else controller.enqueue({ type: 'text-delta', id: '0', delta: '.' });
              resolve();
            }, 5);
          });
        },
        cancel() {
          if (timer) clearTimeout(timer);
        },
      }) as never,
    }),
  });
  try {
    const built = buildDeepTools({
      ctx: CTX,
      gateway: (() => model) as unknown as GatewayProvider,
      charge: async () => ({ allowed: true }),
      heartbeatMs: 5,
      onEvent: (event) => events.push(event as Event),
    }) as unknown as Record<string, Runnable>;
    const output = await built.web_research!.execute(
      { query: 'latest event', topic: 'competitive', purpose: 'Latest event' },
      { toolCallId: 'r4' },
    );
    assert.equal(events.at(-1)?.phase, 'partial');
    assert.match(
      output,
      /Research ran out of time; what came back is below and may be incomplete\.\n\nOne useful finding/,
    );
  } finally {
    if (previous == null) delete process.env[DECKE_DEEP_BUDGET_VAR];
    else process.env[DECKE_DEEP_BUDGET_VAR] = previous;
  }
});
