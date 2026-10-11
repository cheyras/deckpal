import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateText, hasToolCall, stepCountIs, type Tool } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import { COSMETIC_TOOLS, askPendingInstruction, askedThisStep, askedThisTurn, lastLookupIndex, spokeAndSettled, textAfterLastLookup } from '../stopRule.js';
import { buildTools } from '../tools.js';

const USAGE = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 8, text: 0, reasoning: 0 },
};

const calls = (...toolNames: string[]) => toolNames.map((toolName) => ({ toolName }));

test('the cosmetic set contains only the two server-side settling gestures', () => {
  assert.deepEqual([...COSMETIC_TOOLS], ['express', 'showScreen']);
});

test('lookup then answer text and express settles', () => {
  assert.equal(spokeAndSettled([
    { toolCalls: calls('search_cards') },
    { text: 'I found it.', toolCalls: calls('express') },
  ]), true);
});

test('interim text before a later data call does not settle on a silent express', () => {
  assert.equal(spokeAndSettled([
    { text: 'Found these; now checking prices.' },
    { toolCalls: calls('card_prices') },
    { toolCalls: calls('express') },
  ]), false);
});

test('interim text plus data call then text and showScreen settles', () => {
  assert.equal(spokeAndSettled([
    { text: 'Found these; now checking prices.', toolCalls: calls('card_prices') },
    { text: 'Here are the prices.', toolCalls: calls('showScreen') },
  ]), true);
});

test('lookup then text and showScreen settles', () => {
  assert.equal(spokeAndSettled([
    { toolCalls: calls('decks') },
    { text: 'Here is your deck.', toolCalls: calls('showScreen') },
  ]), true);
});

test('cosmetic gesture without text anywhere does not settle', () => {
  assert.equal(spokeAndSettled([{ toolCalls: calls('express') }]), false);
});

test('a final data-tool call never settles', () => {
  assert.equal(spokeAndSettled([
    { text: 'Checking that now.' },
    { text: 'Still checking.', toolCalls: calls('battle_logs') },
  ]), false);
});

// ── ASK_USER STOPS THE TURN ONLY WHEN THE CARD IS REAL ──────────────────────

test('only a schema-valid ask_user call counts as asking', () => {
  assert.equal(askedThisStep([{ toolCalls: [{ toolName: 'ask_user' }] }]), true);
  assert.equal(askedThisStep([{ toolCalls: [{ toolName: 'ask_user', invalid: true }] }]), false);
  assert.equal(askedThisStep([{ toolCalls: calls('search_cards') }]), false);
  // The stop condition reads the LAST step; the after-turn check reads them all.
  const earlier = [{ toolCalls: [{ toolName: 'ask_user' }] }, { toolCalls: calls('express') }];
  assert.equal(askedThisStep(earlier), false);
  assert.equal(askedThisTurn(earlier), true);
  assert.equal(askedThisTurn([{ toolCalls: [{ toolName: 'ask_user', invalid: true }] }]), false);
  assert.equal(askedThisTurn([]), false);
});

test('in the real SDK a malformed ask no longer ends the turn; the corrected ask does', async () => {
  // THE REVIEW FINDING (S1), reproduced through ai@7 itself rather than a
  // hand-built step: the 13-character header fails `ask_user`'s schema, the SDK
  // keeps the call in `toolCalls` with `invalid: true`, and `hasToolCall`
  // stopped on it. `askedThisStep` lets the model see the error and ask again.
  const ask = (header: string) => JSON.stringify({
    questions: [{ header, question: 'Which format?', options: [{ label: 'Standard' }, { label: 'Expanded' }] }],
  });
  const responses = [ask('thirteen char'), ask('Format')];
  const model = new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [{ type: 'tool-call' as const, toolCallId: `ask-${responses.length}`, toolName: 'ask_user', input: responses.shift()! }],
      finishReason: { unified: 'tool-calls' as const, raw: 'tool_use' },
      usage: USAGE,
      warnings: [],
    }),
  });
  const tools = { ask_user: (buildTools({ write: () => {} }) as Record<string, Tool>).ask_user! };

  const sdkHelper = await generateText({ model, tools, prompt: 'build me a deck', stopWhen: [stepCountIs(5), hasToolCall('ask_user')] });
  assert.equal(sdkHelper.steps.length, 1, 'premise: hasToolCall stops on the INVALID call');
  assert.equal((sdkHelper.steps[0]!.toolCalls[0] as { invalid?: boolean }).invalid, true, 'premise: ai@7 marks it `invalid`');

  responses.splice(0, responses.length, ask('thirteen char'), ask('Format'));
  const ours = await generateText({ model, tools, prompt: 'build me a deck', stopWhen: [stepCountIs(5), ({ steps }) => askedThisStep(steps)] });
  assert.equal(ours.steps.length, 2, 'the loop continued past the invalid ask and stopped on the valid one');
  assert.equal(askedThisTurn(ours.steps), true);
});

test('a leg after an open ask is told it may not act on answers it has not been given (S-b)', () => {
  const note = askPendingInstruction();
  assert.match(note, /have not answered/);
  assert.match(note, /one short line/i);
  assert.match(note, /then stop/i);
  assert.match(note, /Do not assume their answers/);
});

// ── THE LINE THAT ANSWERED A PROGRESS NUDGE (review, 2026-10-10) ────────────

const lookups = (n: number) => Array.from({ length: n }, () => ({ toolCalls: calls('battle_logs') }));
const nudgedLine = { text: 'Two losses to Dragapult so far — checking your list next.', toolCalls: calls('express') };

test('the blocker: a nudged progress line plus a face no longer ends the turn', () => {
  const steps = [...lookups(3), nudgedLine];
  // The defect, pinned so its shape stays visible: without the landing the
  // rule settles, and that line is the whole reply.
  assert.equal(spokeAndSettled(steps), true);
  // The nudge landed before step 3, so step 3's words are progress, not the answer.
  assert.equal(spokeAndSettled(steps, [3]), false);
});

test('a nudged line followed by a silent face still does not settle', () => {
  assert.equal(spokeAndSettled([...lookups(3), nudgedLine, { toolCalls: calls('express') }], [3]), false);
});

test('words he says after the nudged line settle as usual', () => {
  assert.equal(spokeAndSettled([
    ...lookups(3),
    nudgedLine,
    { text: 'Cut one Iono for a second Counter Catcher.', toolCalls: calls('showScreen') },
  ], [3]), true);
});

test('a landing elsewhere does not mute the real answer', () => {
  // Nudged before step 3, which then looked something up: the answer in step 4 counts.
  assert.equal(spokeAndSettled([
    ...lookups(3),
    { text: 'Found the losses; now the list.', toolCalls: calls('decks') },
    { text: 'Here is the change.', toolCalls: calls('express') },
  ], [3]), true);
});

test('textAfterLastLookup is only what was said after the last lookup', () => {
  assert.equal(lastLookupIndex([{ toolCalls: calls('decks') }, { toolCalls: calls('express') }]), 0);
  assert.equal(lastLookupIndex([{ text: 'Hi.' }]), -1);
  // Text in a step that also looked something up came BEFORE that result.
  assert.equal(textAfterLastLookup([
    { text: 'Found these; now checking prices.', toolCalls: calls('card_prices') },
  ]), '');
  assert.equal(textAfterLastLookup([
    { text: 'Found these; now checking prices.', toolCalls: calls('card_prices') },
    { text: 'Here are the prices.', toolCalls: calls('express') },
    { text: '   ' },
    { text: 'Anything else?' },
  ]), 'Here are the prices.\nAnything else?');
  assert.equal(textAfterLastLookup([{ text: 'Just chatting.' }]), 'Just chatting.');
  assert.equal(textAfterLastLookup([...lookups(2), nudgedLine], [2]), '');
});
