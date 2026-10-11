/**
 * A follow-up leg after an approval resume, through ai@7 itself.
 *
 * The corrective leg and the paste backstop continue from the finished leg's
 * messages. On a leg that resumes an approval, the SDK executes the approved
 * write before step 0 and keeps its result outside `steps`; the old
 * construction dropped it, so the provider received a tool call with no result.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { convertToModelMessages, streamText, tool, type ModelMessage } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import { z } from 'zod';
import { followUpMessages } from '../legMessages.js';

type Prompt = Array<{ role: string; content: unknown }>;

/** A model that says one line and records the prompt it was sent. */
function textModel(line: string, prompts: Prompt[]) {
  return new MockLanguageModelV3({
    doStream: async (options) => {
      prompts.push(options.prompt as unknown as Prompt);
      return {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: 'stream-start', warnings: [] });
            controller.enqueue({ type: 'text-start', id: 't' });
            controller.enqueue({ type: 'text-delta', id: 't', delta: line });
            controller.enqueue({ type: 'text-end', id: 't' });
            controller.enqueue({
              type: 'finish',
              finishReason: { unified: 'stop', raw: 'end_turn' },
              usage: {
                inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
                outputTokens: { total: 1, text: 1, reasoning: 0 },
              },
            });
            controller.close();
          },
        }),
      };
    },
  });
}

/** Tool results for `toolCallId` anywhere in a prompt the provider received. */
const resultsFor = (prompt: Prompt, toolCallId: string) =>
  prompt.flatMap((message) => message.role === 'tool' && Array.isArray(message.content) ? message.content : [])
    .filter((part: { type?: string; toolCallId?: string }) => part.type === 'tool-result' && part.toolCallId === toolCallId);

async function resumedLeg() {
  let writes = 0;
  const tools = {
    add_battle_log: tool({
      inputSchema: z.object({ log: z.string() }),
      needsApproval: true,
      execute: async () => { writes += 1; return 'Logged the game to Gardevoir ex.'; },
    }),
  };
  const ui = [
    { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'log this game' }] },
    {
      id: 'a1',
      role: 'assistant',
      parts: [{
        type: 'tool-add_battle_log',
        toolCallId: 'call-1',
        state: 'approval-responded',
        input: { log: '@pasted' },
        approval: { id: 'approval-1', approved: true },
      }],
    },
  ];
  const prepared: ModelMessage[] = await convertToModelMessages(ui as never, { tools });
  // The leg the reader's approval resumed: the write runs before its step 0.
  const first = streamText({ model: textModel('Logged it — 3 prizes to 6.', []), tools, messages: prepared });
  await first.consumeStream();
  return { tools, prepared, first, writes: () => writes };
}

test('the approved write\'s result reaches a follow-up leg, and nothing runs twice', async () => {
  const { tools, prepared, first, writes } = await resumedLeg();
  assert.equal(writes(), 1);

  // THE DEFECT, as it was built in api/chat.mjs (and on main): the steps alone
  // do not hold the approved call's result, and the SDK sends the leg anyway.
  const stepsOnly = [...prepared, ...(await first.steps).flatMap((step) => step.response.messages)];
  const oldPrompts: Prompt[] = [];
  const oldLeg = streamText({ model: textModel('correction', oldPrompts), tools, messages: stepsOnly });
  await oldLeg.consumeStream();
  assert.equal(resultsFor(oldPrompts[0]!, 'call-1').length, 0, 'premise: the provider got the approved call with no result');

  // THE FIX: the SDK's own accumulation, initial response messages included.
  const messages = await followUpMessages(prepared, first);
  const prompts: Prompt[] = [];
  const corrective = streamText({ model: textModel('correction', prompts), tools, messages });
  await corrective.consumeStream();
  const results = resultsFor(prompts[0]!, 'call-1');
  assert.equal(results.length, 1, 'the corrective leg\'s prompt lacks the approved write\'s result');
  assert.match(JSON.stringify(results[0]), /Logged the game to Gardevoir ex\./);
  // Its call is there too, so the pair is whole.
  const calls = prompts[0]!.flatMap((message) => message.role === 'assistant' && Array.isArray(message.content) ? message.content : [])
    .filter((part: { type?: string; toolCallId?: string }) => part.type === 'tool-call' && part.toolCallId === 'call-1');
  assert.equal(calls.length, 1);

  assert.equal(writes(), 1, 'a follow-up leg must never execute the approved write again');
});

test('api/chat.mjs builds every follow-up leg from the SDK\'s accumulated response messages', () => {
  const src = readFileSync(fileURLToPath(new URL('../../../../../api/chat.mjs', import.meta.url)), 'utf8');
  const code = src.split('\n').filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join('\n');
  assert.match(src, /import \{ followUpMessages \} from '\.\.\/apps\/api\/dist\/decke\/legMessages\.js'/);
  assert.match(code, /messages: await followUpMessages\(preparedMessages, result\),/);
  // The step-only construction is gone everywhere, not just at one call site.
  assert.doesNotMatch(code, /step\.response\.messages/);
});
