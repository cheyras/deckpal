import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MockLanguageModelV3 } from 'ai/test';
import { heuristicTriage, runTriage } from '../triage.js';

const USAGE = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 8, text: 0, reasoning: 0 },
};

function toolModel(input: unknown) {
  return new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [{
        type: 'tool-call' as const,
        toolCallId: 'triage-1',
        toolName: 'triage',
        input: JSON.stringify(input),
      }],
      finishReason: { unified: 'tool-calls' as const, raw: 'tool_use' },
      usage: USAGE,
      warnings: [],
    }),
  });
}

const INPUT = {
  message: 'Why did I lose this close game?',
  previousReply: '',
  page: '/decks/abc',
  pasted: false,
};

test('a valid forced triage tool call becomes a model result', async () => {
  const model = toolModel({
    pathway: 'battle_review',
    also: null,
    signals: ['close_game', 'asks_why'],
    missing: ['opponent_deck'],
    wantsDeep: 'no',
  });
  const result = await runTriage({ ...INPUT, model });
  assert.deepEqual(result, {
    pathway: 'battle_review',
    also: null,
    signals: ['close_game', 'asks_why'],
    missing: ['opponent_deck'],
    wantsDeep: 'no',
    source: 'model',
  });
  const call = model.doGenerateCalls[0]!;
  assert.deepEqual(call.toolChoice, { type: 'tool', toolName: 'triage' });
  assert.deepEqual(call.providerOptions?.anthropic, {
    thinking: { type: 'disabled' },
    effort: 'low',
  });
  assert.equal(call.maxOutputTokens, 400);
});

test('invalid tool args fall back without failing the turn', async () => {
  const result = await runTriage({ ...INPUT, model: toolModel({ pathway: 'not-a-pathway' }) });
  assert.equal(result.source, 'heuristic');
  assert.equal(result.pathway, 'general');
});

test('a thrown provider error falls back without failing the turn', async () => {
  const model = new MockLanguageModelV3({ doGenerate: async () => { throw new Error('provider down'); } });
  const result = await runTriage({ ...INPUT, message: 'What is this card worth?', model });
  assert.equal(result.source, 'heuristic');
  assert.equal(result.pathway, 'price_value');
});

test('the hard timeout aborts triage and falls back', async () => {
  const model = new MockLanguageModelV3({
    doGenerate: async ({ abortSignal }) => new Promise((_, reject) => {
      abortSignal?.addEventListener('abort', () => reject(abortSignal.reason), { once: true });
    }),
  });
  const started = Date.now();
  const result = await runTriage({ ...INPUT, message: 'hello', model, timeoutMs: 15 });
  assert.equal(result.pathway, 'small_talk');
  assert.equal(result.source, 'heuristic');
  assert.ok(Date.now() - started < 1_000, 'timeout did not bound the classifier');
});

test('the deterministic heuristic covers its routing table', () => {
  const cases = [
    [{ message: 'Setup\nTurn # 1 - I drew a card', pasted: true }, 'battle_log'],
    [{ message: 'Build me a Standard deck', pasted: false }, 'deck_build'],
    [{ message: 'What is this Charizard worth?', pasted: false }, 'price_value'],
    [{ message: 'Take me to my decks', pasted: false }, 'navigate'],
    [{ message: 'thanks!', pasted: false }, 'small_talk'],
    [{ message: 'Tell me something useful', pasted: false }, 'general'],
  ] as const;
  for (const [input, expected] of cases) {
    assert.equal(heuristicTriage(input).pathway, expected, input.message);
  }
});

test('heuristic triage preserves the ask-card pathway', () => {
  const result = heuristicTriage({
    message: '$50 and Standard',
    pasted: false,
    answering: { about: 'deck_build' },
  });
  assert.equal(result.pathway, 'deck_build');
  assert.ok(result.signals.includes('answering_questions'));
  assert.ok(result.signals.includes('budget_mentioned'));
});
