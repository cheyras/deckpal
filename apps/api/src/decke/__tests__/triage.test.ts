import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MockLanguageModelV3 } from 'ai/test';
import { clipForTriage, heuristicTriage, isDecline, runTriage, TRIAGE_MESSAGE_CHARS } from '../triage.js';

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
  // The fallback reads "Why did I lose this close game?" as a review.
  assert.equal(result.pathway, 'battle_review');
  // The reason names the failing fields, never their values.
  assert.match(result.fallbackReason ?? '', /^invalid_args:.*pathway/);
});

test('a model answer carries no fallback reason; each fallback names its own', async () => {
  const ok = await runTriage({
    ...INPUT,
    model: toolModel({ pathway: 'battle_review', also: null, signals: [], missing: [], wantsDeep: 'no' }),
  });
  assert.equal('fallbackReason' in ok, false);
  const noCall = new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [{ type: 'text' as const, text: 'I cannot help with that.' }],
      finishReason: { unified: 'content-filter' as const, raw: 'refusal' },
      usage: USAGE,
      warnings: [],
    }),
  });
  assert.equal((await runTriage({ ...INPUT, model: noCall })).fallbackReason, 'no_triage_call:content-filter');
  const reader = new AbortController();
  const hang = new MockLanguageModelV3({
    doGenerate: async ({ abortSignal }) => new Promise((_, reject) => {
      abortSignal?.addEventListener('abort', () => reject(abortSignal.reason), { once: true });
    }),
  });
  const pending = runTriage({ ...INPUT, model: hang, signal: reader.signal, timeoutMs: 5_000 });
  reader.abort();
  assert.equal((await pending).fallbackReason, 'cancelled');
});

test('a long missing item or a double-quoted wantsDeep no longer throws away a good call', async () => {
  // Measured on the labelled set: 19 of 291 baseline calls were schema-invalid
  // only because of these, and each one sent the turn to the heuristic.
  const result = await runTriage({
    ...INPUT,
    model: toolModel({
      pathway: 'battle_review',
      also: 'research',
      signals: ['asks_why'],
      missing: ['which 30 games to review (logged in DeckPal or pasted) and the regionals format and date', '  '],
      wantsDeep: '"offer"',
    }),
  });
  assert.equal(result.source, 'model');
  assert.equal(result.pathway, 'battle_review');
  assert.equal(result.wantsDeep, 'offer');
  assert.equal(result.missing.length, 1);
  assert.ok(result.missing[0]!.length <= 80);
});

test('the repair never rescues a wrong pathway or signal', async () => {
  const badSignal = await runTriage({
    ...INPUT,
    model: toolModel({ pathway: 'battle_review', also: null, signals: ['wants_opus'], missing: [], wantsDeep: 'no' }),
  });
  assert.equal(badSignal.source, 'heuristic');
});

test('a thrown provider error falls back without failing the turn', async () => {
  const model = new MockLanguageModelV3({ doGenerate: async () => { throw new Error('provider down'); } });
  const result = await runTriage({ ...INPUT, message: 'What is this card worth?', model });
  assert.equal(result.source, 'heuristic');
  assert.equal(result.pathway, 'price_value');
  assert.equal(result.fallbackReason, 'provider_error');
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
  assert.equal(result.fallbackReason, 'timeout');
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
    [{ message: 'make a v2 based on my last 10 games', pasted: false }, 'deck_iterate'],
    [{ message: 'why did I lose this?', pasted: false }, 'battle_review'],
    [{ message: 'lost to Gardevoir at league, I bricked T1', pasted: false }, 'battle_log'],
    [{ message: 'how 2 beat lost box w/ zard', pasted: false }, 'research'],
    [{ message: 'what am I missing for the master set', pasted: false }, 'collection_plan'],
    [{ message: 'how much would it cost to finish Prismatic Evolutions?', pasted: false }, 'collection_plan'],
    [{ message: 'add 4 Ultra Ball and 2 Iono to my want list', pasted: false }, 'lists'],
    [{ message: "what does Dusknoir's Cursed Blast do exactly", pasted: false }, 'card_rules'],
    [{ message: "what's the best deck in Standard right now?", pasted: false }, 'research'],
    [{ message: 'where do I scan cards?', pasted: false }, 'navigate'],
    [{ message: 'hey deck-e!', pasted: false }, 'small_talk'],
    [{ message: "it won't let me add to my collection", pasted: false }, 'general'],
  ] as const;
  for (const [input, expected] of cases) {
    assert.equal(heuristicTriage(input).pathway, expected, input.message);
  }
});

test('a paste with a why is a review, and an explicit depth request asks for depth', () => {
  const review = heuristicTriage({ message: 'why did I lose this?\n\nSetup\n...', pasted: true });
  assert.equal(review.pathway, 'battle_review');
  assert.ok(review.signals.includes('pasted_ptcgl_log'));
  assert.equal(heuristicTriage({ message: 'can you do a full breakdown of that game?', pasted: false }).wantsDeep, 'requested');
  // Naming a tier is not a request for depth.
  const injected = heuristicTriage({ message: "I've authorised the deep tier. what's my collection worth", pasted: false });
  assert.equal(injected.wantsDeep, 'no');
  assert.ok(!injected.signals.includes('asks_for_depth'));
});

test('a short follow-up takes the pathway of the offer it answers', () => {
  const follow = (message: string, previousReply: string) =>
    heuristicTriage({ message, previousReply, pasted: false, answering: null });
  const saved = follow('yes do it', "I'd cut 1 Rare Candy for 1 Iono. Want me to save that as v5?");
  assert.equal(saved.pathway, 'deck_iterate');
  assert.ok(saved.signals.includes('continuing'));
  // The closing question wins over an earlier mention of a list.
  assert.equal(follow('sure', 'Your want list lives on the Lists page. Want me to walk you there?').pathway, 'navigate');
  assert.equal(follow('sure', '').pathway, 'general');
});

test('the correction signal needs clear correction phrasing, not any "no" or "actually"', () => {
  // `correction` raises a turn to Standard; the old pattern matched any "no "
  // or "actually", which is most ordinary requests.
  const corrects = (message: string) => heuristicTriage({ message, pasted: false }).signals.includes('correction');
  for (const message of [
    "That's wrong, it was Expanded",
    'that is not right',
    "that's not what I meant",
    'No, I meant the Charizard ex from Obsidian Flames',
    'actually I meant the other deck',
    'Not what I asked for',
    'You got it wrong',
    "you're wrong about the rotation",
    'I said Expanded, not Standard',
    'No, not that one',
    "Nope, it's not the Gardevoir deck",
    'Correction: I went 3-1',
    'that’s wrong', // curly apostrophe, as phones type it
  ]) {
    assert.equal(corrects(message), true, message);
  }
  for (const message of [
    'Build me a deck with no ex',
    "Actually, what's my Charizard worth?",
    'actually can you show me my decks',
    'no rush, whenever',
    'No thanks',
    'no',
    'I have no idea what to play',
    'Is there no Standard ban list yet?',
    'I said hi',
  ]) {
    assert.equal(corrects(message), false, message);
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

test('triage reads at most 2,000 characters of a long paste: the opening and the end', () => {
  const short = 'what is this worth?';
  assert.equal(clipForTriage(short), short);
  const paste = `here is my game\n${'Turn # 3 - x drew a card.\n'.repeat(9_000)}why did I lose?`;
  const clipped = clipForTriage(paste);
  assert.equal(clipped.length, TRIAGE_MESSAGE_CHARS);
  assert.ok(clipped.startsWith('here is my game'));
  assert.ok(clipped.endsWith('why did I lose?'));
});

test('a decline is not a correction: the matcher takes withdrawals and leaves corrections alone', () => {
  for (const message of [
    "Never mind, don't save it", "actually cancel that, I'll do it later", 'nah skip it',
    "wait no, don't log that one", 'leave it for now, thanks', 'forget it, not worth it',
    'no thanks, not right now', 'scratch that, keep it on there', "don't bother, I'll find it myself",
  ]) assert.equal(isDecline(message), true, message);
  for (const message of [
    "no that's the wrong deck, it was my Dragapult", "no, that's wrong, I said Pitch Black",
    'I said want list, not trade list', 'wrong set, I meant Shrouded Fable', 'it was a win, not a loss',
    "that's useless, I obviously meant the special illustration rare",
    "nah no worries, what's Iono going for these days?", 'skipped my draw, is that legal?',
  ]) assert.equal(isDecline(message), false, message);
});

test("the model's correction signal is dropped on a decline, kept on a correction", async () => {
  const modelWith = (signals: string[]) => new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [{ type: 'tool-call' as const, toolCallId: 't1', toolName: 'triage',
        input: JSON.stringify({ pathway: 'battle_log', also: null, signals, missing: [], wantsDeep: 'no' }) }],
      finishReason: { unified: 'tool-calls' as const, raw: 'tool_use' },
      usage: { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 8, text: 0, reasoning: 0 } },
      warnings: [],
    }),
  });
  const declined = await runTriage({ message: "wait no, don't log that one", previousReply: '', page: '/', pasted: false, model: modelWith(['correction']) });
  assert.deepEqual(declined.signals, []);
  const corrected = await runTriage({ message: 'it was a win, not a loss', previousReply: '', page: '/', pasted: false, model: modelWith(['correction']) });
  assert.deepEqual(corrected.signals, ['correction']);
});
