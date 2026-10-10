/**
 * `runConsult` — Deck-E's one-question call to a stronger colleague.
 *
 * Mock model only (`MockLanguageModelV3`): nothing here reaches the Gateway.
 * What is pinned is the CALL — the part a refactor can quietly change while
 * every behaviour test keeps passing:
 *
 *  - the system line the owner's spec gives, verbatim in substance;
 *  - the brief and the question both reach the model, question last;
 *  - Anthropic options with `effort` TOP-LEVEL and adaptive thinking — nested
 *    inside `thinking`, `effort` is stripped by the provider schema and the
 *    call silently runs at the model default;
 *  - NO tools: the colleague can only read what it was handed;
 *  - the reader's abort reaches the call; and
 *  - an empty answer is an error, never an empty "analysis".
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MockLanguageModelV3 } from 'ai/test';
import {
  CONSULT_MAX_OUTPUT_TOKENS, CONSULT_SYSTEM, EmptyConsultError, runConsult,
} from '../consult.js';

const USAGE = {
  inputTokens: { total: 900, noCache: 900, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 400, text: 300, reasoning: 100 },
};

function textModel(text: string) {
  return new MockLanguageModelV3({
    doGenerate: async () => ({
      content: text ? [{ type: 'text' as const, text }] : [],
      finishReason: { unified: 'stop' as const, raw: 'end_turn' },
      usage: USAGE,
      warnings: [],
    }),
  });
}

const BRIEF = 'Digest: lost 4-6, turn 7 Dragapult ex took two prizes on Fezandipiti ex. Reader: "I benched Fez too early."';
const QUESTION = 'What decided this game, and what is the one lesson?';

/** Every text the model was shown, flattened, by role. */
function shown(model: MockLanguageModelV3, role: 'system' | 'user'): string {
  const prompt = model.doGenerateCalls[0]!.prompt as Array<{ role: string; content: unknown }>;
  return prompt
    .filter((m) => m.role === role)
    .map((m) => typeof m.content === 'string'
      ? m.content
      : (m.content as Array<{ type: string; text?: string }>).map((p) => p.text ?? '').join(''))
    .join('\n');
}

test('one call: the system line, then the brief and the question, and the analysis back', async () => {
  const model = textModel('  The game turned on turn 7.\n- Bench Fezandipiti ex later.  ');
  const out = await runConsult({ question: QUESTION, brief: BRIEF, model });

  assert.equal(out, 'The game turned on turn 7.\n- Bench Fezandipiti ex later.');
  assert.equal(model.doGenerateCalls.length, 1);
  assert.equal(shown(model, 'system'), CONSULT_SYSTEM);
  const user = shown(model, 'user');
  assert.ok(user.includes(BRIEF), 'the brief never reached the colleague');
  assert.ok(user.includes(QUESTION), 'the question never reached the colleague');
  assert.ok(user.indexOf(BRIEF) < user.indexOf(QUESTION), 'the question is what it reads last');
});

test('the system line is the owner\'s: grounded, bounded, and honest about gaps', () => {
  assert.match(CONSULT_SYSTEM, /^You are Deck-E's deeper-thinking colleague\./);
  assert.match(CONSULT_SYSTEM, /≤ 400 words/);
  assert.match(CONSULT_SYSTEM, /ground every claim in the brief/);
  assert.match(CONSULT_SYSTEM, /say what the brief cannot tell you/);
  assert.match(CONSULT_SYSTEM, /never invent cards, card text, prices or events/);
});

test('Standard-tier thinking: effort TOP-LEVEL, adaptive thinking, and no tools', async () => {
  const model = textModel('Analysis.');
  await runConsult({ question: QUESTION, brief: BRIEF, model });
  const call = model.doGenerateCalls[0]!;
  assert.deepEqual(call.providerOptions?.anthropic, { effort: 'medium', thinking: { type: 'adaptive' } });
  assert.equal(
    (call.providerOptions?.anthropic as { thinking?: { effort?: unknown } }).thinking?.effort,
    undefined,
    'effort nested inside thinking is stripped by the provider schema',
  );
  assert.ok(!call.tools || call.tools.length === 0, 'the colleague must not be able to act');
  assert.equal(call.maxOutputTokens, CONSULT_MAX_OUTPUT_TOKENS);
});

test('the caller\'s ceiling and the reader\'s abort both reach the call', async () => {
  const model = textModel('Analysis.');
  const controller = new AbortController();
  await runConsult({ question: QUESTION, brief: BRIEF, model, signal: controller.signal, maxOutputTokens: 3_000 });
  const call = model.doGenerateCalls[0]!;
  assert.equal(call.maxOutputTokens, 3_000);
  assert.ok(call.abortSignal, 'the reader stopping the turn must stop the consult');
});

test('an answer with no text is an error, never an empty analysis', async () => {
  await assert.rejects(
    runConsult({ question: QUESTION, brief: BRIEF, model: textModel('   ') }),
    (err: unknown) => err instanceof EmptyConsultError && /no analysis/.test(err.message),
  );
});

test('a provider failure propagates for the tool to report', async () => {
  const model = new MockLanguageModelV3({
    doGenerate: async () => {
      throw Object.assign(new Error('upstream exploded'), { statusCode: 500 });
    },
  });
  await assert.rejects(
    runConsult({ question: QUESTION, brief: BRIEF, model }),
    /upstream exploded/,
  );
});
