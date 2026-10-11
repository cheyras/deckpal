import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { convertToModelMessages, streamText, tool } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import { z } from 'zod';
import {
  answeringAsk,
  carriedFromHistory,
  continuationFloor,
  decideTier,
  effortFor,
  quickRefusalRetry,
  raisedToStandard,
  resumesApproval,
} from '../tiers.js';
import type { Triage, TriageSignal } from '../triage.js';

function triage(
  pathway: Triage['pathway'],
  options: { also?: Triage['also']; signals?: TriageSignal[]; wantsDeep?: Triage['wantsDeep'] } = {},
): Triage {
  return {
    pathway,
    also: options.also ?? null,
    signals: options.signals ?? [],
    missing: [],
    wantsDeep: options.wantsDeep ?? 'no',
    source: 'model',
  };
}

const clear = { guardFired: false, toolErrors: 0 };

test('pathway floors and quick effort are code decisions', () => {
  assert.deepEqual(decideTier({ triage: triage('navigate'), carried: clear, deepApproved: false }), {
    tier: 'quick', pathways: ['navigate'], effort: 'low', reasons: ['floor:navigate'],
  });
  const build = decideTier({ triage: triage('deck_build'), carried: clear, deepApproved: false });
  assert.equal(build.tier, 'standard');
  assert.equal(build.effort, 'medium');
  assert.ok(build.reasons.includes('floor:deck_build'));
});

test('also uses the higher floor and higher quick effort, without duplicates or general', () => {
  const mixed = decideTier({
    triage: triage('general', { also: 'deck_build' }),
    carried: clear,
    deepApproved: false,
  });
  assert.deepEqual(mixed.pathways, ['deck_build']);
  assert.equal(mixed.tier, 'standard');
  const quick = decideTier({
    triage: triage('navigate', { also: 'price_value' }),
    carried: clear,
    deepApproved: false,
  });
  assert.equal(quick.tier, 'quick');
  assert.equal(quick.effort, 'medium');
  assert.deepEqual(
    decideTier({ triage: triage('navigate', { also: 'navigate' }), carried: clear, deepApproved: false }).pathways,
    ['navigate'],
  );
});

test('each escalation rule raises a quick pathway to Standard', () => {
  const cases = [
    [triage('navigate', { signals: ['dissatisfied'] }), clear, 'signal:dissatisfied'],
    [triage('navigate', { signals: ['correction'] }), clear, 'signal:correction'],
    [triage('navigate'), { guardFired: true, toolErrors: 0 }, 'carried:guard'],
    [triage('navigate'), { guardFired: false, toolErrors: 2 }, 'carried:tool_errors'],
    [triage('navigate', { wantsDeep: 'offer' }), clear, 'deep:offer'],
    [triage('navigate', { wantsDeep: 'requested' }), clear, 'deep:requested'],
  ] as const;
  for (const [classified, carried, reason] of cases) {
    const decision = decideTier({ triage: classified, carried, deepApproved: false });
    assert.equal(decision.tier, 'standard', reason);
    assert.equal(decision.effort, 'medium', reason);
    assert.ok(decision.reasons.includes(reason), reason);
  }
});

test('reader-approved deep work wins and runs high effort', () => {
  const decision = decideTier({ triage: triage('small_talk'), carried: clear, deepApproved: true });
  assert.equal(decision.tier, 'deep');
  assert.equal(decision.effort, 'high');
  assert.ok(decision.reasons.includes('approved:deep'));
});

test('carried state reads only the assistant turn before the latest user', () => {
  const messages = [
    { role: 'assistant', parts: [{ type: 'text', text: 'I kept hitting walls there.' }] },
    { role: 'user', parts: [{ type: 'text', text: 'first' }] },
    { role: 'assistant', parts: [
      { type: 'text', text: 'I looked things up and then never actually answered you.' },
      { type: 'tool-search_cards', state: 'output-error' },
      { type: 'dynamic-tool', toolName: 'battle_logs', state: 'output-error' },
      { type: 'tool-ok', state: 'output-available' },
    ] },
    { role: 'user', parts: [{ type: 'text', text: 'try again' }] },
  ];
  assert.deepEqual(carriedFromHistory(messages), { guardFired: true, toolErrors: 2 });
  assert.deepEqual(carriedFromHistory([{ role: 'user', parts: [] }]), { guardFired: false, toolErrors: 0 });
});

test('ask-card answers carry a valid about pathway', () => {
  const base = [
    { role: 'assistant', parts: [{ type: 'tool-ask_user', state: 'input-available', input: { about: 'deck_build' } }] },
    { role: 'user', parts: [{ type: 'text', text: 'Standard' }] },
  ];
  assert.deepEqual(answeringAsk(base), { about: 'deck_build' });
  assert.deepEqual(answeringAsk([
    { role: 'assistant', parts: [{ type: 'tool-ask_user', input: { about: 'bogus' } }] },
    { role: 'user', parts: [] },
  ]), {});
  assert.equal(answeringAsk([{ role: 'assistant', parts: [] }, { role: 'user', parts: [] }]), null);
});

// ── S6: A PASTE ALWAYS BRINGS THE battle_log GUIDANCE ───────────────────────

test('a pasted log adds battle_log beside the triage primary, at most two', () => {
  const pasted = (t: Triage) => decideTier({ triage: t, carried: clear, deepApproved: false, pastedLog: true });
  // Triage read "why did I lose?" as a review only; the @pasted rule lives in battle_log.
  const review = pasted(triage('battle_review'));
  assert.deepEqual(review.pathways, ['battle_review', 'battle_log']);
  assert.equal(review.tier, 'standard', 'the review floor still holds');
  assert.ok(review.reasons.includes('paste:battle_log'));
  // A second triaged pathway gives way: battle_log plus the PRIMARY.
  assert.deepEqual(pasted(triage('deck_iterate', { also: 'price_value' })).pathways, ['deck_iterate', 'battle_log']);
  // `general` is not a primary worth keeping.
  assert.deepEqual(pasted(triage('general')).pathways, ['battle_log']);
  // Already there: unchanged, no duplicate, no reason.
  const logged = pasted(triage('battle_log', { also: 'battle_review' }));
  assert.deepEqual(logged.pathways, ['battle_log', 'battle_review']);
  assert.ok(!logged.reasons.includes('paste:battle_log'));
  // On Quick, effort follows the added pathway (small talk is low, logging medium).
  const chat = pasted(triage('small_talk'));
  assert.deepEqual([chat.tier, chat.effort, chat.pathways], ['quick', 'medium', ['small_talk', 'battle_log']]);
  // Deep keeps it too.
  assert.deepEqual(
    decideTier({ triage: triage('general'), carried: clear, deepApproved: true, pastedLog: true }).pathways,
    ['battle_log'],
  );
  // No paste, no change.
  assert.deepEqual(decideTier({ triage: triage('battle_review'), carried: clear, deepApproved: false }).pathways, ['battle_review']);
});

test('a continuation with no usable echo is re-triaged but never below Standard', () => {
  const quick = decideTier({ triage: triage('price_value'), carried: clear, deepApproved: false });
  const floored = continuationFloor(quick);
  assert.deepEqual([floored.tier, floored.effort], ['standard', 'medium']);
  assert.deepEqual(floored.pathways, ['price_value'], 'the pathway is still the triage\'s');
  assert.ok(floored.reasons.includes('continuation:no_echo'));
  const standard = decideTier({ triage: triage('deck_build'), carried: clear, deepApproved: false });
  assert.equal(continuationFloor(standard), standard, 'Standard is left exactly as decided');
});

test('a Quick refusal retries on Standard only when no data tool was invoked', () => {
  const isDataTool = (name: string) => !['express', 'showScreen', 'ask_user', 'goTo'].includes(name);
  const retry = (o: Partial<Parameters<typeof quickRefusalRetry>[0]>) => quickRefusalRetry({
    tier: 'quick', finishReason: 'content-filter', steps: [], isDataTool, resumingApproval: false, ...o,
  });
  // The progress line that killed the old "no text anywhere" condition is fine now.
  assert.equal(retry({ steps: [{ toolCalls: [] }] }), true);
  assert.equal(retry({ steps: [{ toolCalls: [{ toolName: 'express' }] }] }), true);
  // A read (or a write held on its card) would be REPEATED by the retry.
  assert.equal(retry({ steps: [{ toolCalls: [{ toolName: 'search_cards' }] }] }), false);
  assert.equal(retry({ steps: [{ toolCalls: [{ toolName: 'log_cards' }] }] }), false);
  // A call that failed its schema never ran.
  assert.equal(retry({ steps: [{ toolCalls: [{ toolName: 'search_cards', invalid: true }] }] }), true);
  // Only a refusal, and only on Quick.
  assert.equal(retry({ finishReason: 'stop' }), false);
  assert.equal(retry({ finishReason: 'tool-calls' }), false);
  assert.equal(retry({ tier: 'standard' }), false);
  // B1: never on a leg resuming an approval, even with no tool in any step.
  assert.equal(retry({ resumingApproval: true }), false);
});

// ── B1: THE APPROVED WRITE RUNS BEFORE STEP 0, SO A RETRY RUNS IT AGAIN ──────

const STOP_MODEL = () => new MockLanguageModelV3({
  doStream: async () => ({
    stream: new ReadableStream({
      start(controller) {
        controller.enqueue({ type: 'stream-start', warnings: [] });
        controller.enqueue({
          type: 'finish',
          finishReason: { unified: 'content-filter', raw: 'refusal' },
          usage: {
            inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 1, text: 1, reasoning: 0 },
          },
        });
        controller.close();
      },
    }),
  }),
});

test('a leg resuming an approval is read from the same model messages the SDK executes from', async () => {
  let writes = 0;
  const tools = {
    add_battle_log: tool({
      inputSchema: z.object({ log: z.string() }),
      needsApproval: true,
      execute: async () => { writes += 1; return 'logged'; },
    }),
  };
  const user = { id: 'u1', role: 'user' as const, parts: [{ type: 'text' as const, text: 'log this game' }] };
  const approved = {
    id: 'a1',
    role: 'assistant' as const,
    parts: [{
      type: 'tool-add_battle_log' as const,
      toolCallId: 'call-1',
      state: 'approval-responded' as const,
      input: { log: '@pasted' },
      approval: { id: 'approval-1', approved: true },
    }],
  };
  const resumed = await convertToModelMessages([user, approved] as never, { tools });
  assert.equal(resumesApproval(resumed), true);

  // THE PREMISE, through ai@7 itself: a Quick leg that refuses has already run
  // the write (outside its steps), and a retry over the same messages runs it again.
  for (const _ of [0, 1]) {
    const leg = streamText({ model: STOP_MODEL(), tools, messages: resumed });
    await leg.consumeStream();
    assert.deepEqual((await leg.steps).flatMap((step) => step.toolCalls), [], 'the write is in no step');
  }
  assert.equal(writes, 2, 'premise: each streamText over a resumed approval executes the write');

  // Not a resume: a first leg, and a leg resumed from a browser tool.
  assert.equal(resumesApproval(await convertToModelMessages([user] as never)), false);
  const browser = {
    id: 'a2',
    role: 'assistant' as const,
    parts: [{ type: 'tool-goTo' as const, toolCallId: 'call-2', state: 'output-available' as const, input: { route: '/decks' }, output: { ok: true } }],
  };
  assert.equal(resumesApproval(await convertToModelMessages([user, browser] as never)), false);
  // A denial is a response too; refusing the retry there costs nothing.
  const denied = { ...approved, parts: [{ ...approved.parts[0]!, approval: { id: 'approval-1', approved: false } }] };
  assert.equal(resumesApproval(await convertToModelMessages([user, denied] as never, { tools })), true);
});

test('effort is one rule, and raising to Standard re-derives it', () => {
  assert.equal(effortFor('quick', ['navigate']), 'low');
  assert.equal(effortFor('quick', ['navigate', 'price_value']), 'medium');
  assert.equal(effortFor('quick', []), 'medium', 'no pathway is general');
  assert.equal(effortFor('standard', ['small_talk']), 'medium');
  assert.equal(effortFor('deep', ['small_talk']), 'high');
  const quick = decideTier({ triage: triage('navigate'), carried: clear, deepApproved: false });
  const raised = raisedToStandard(quick, 'retry:refusal');
  assert.deepEqual([raised.tier, raised.effort, raised.pathways], ['standard', 'medium', ['navigate']]);
  assert.deepEqual(raised.reasons, ['floor:navigate', 'retry:refusal']);
  const deep = decideTier({ triage: triage('navigate'), carried: clear, deepApproved: true });
  assert.equal(raisedToStandard(deep, 'x'), deep, 'Deep is never lowered');
});

test('every carried guard substring is pinned to the reader-facing server note', () => {
  const src = readFileSync(fileURLToPath(new URL('../../../../../api/chat.mjs', import.meta.url)), 'utf8');
  for (const note of [
    'I got cut off mid-sentence',
    'I kept hitting walls',
    'never actually answered you',
    'I never actually ran it',
    'I never ran anything',
  ]) {
    assert.ok(src.includes(note), `api/chat.mjs no longer contains carried guard note: ${note}`);
  }
});

test('small talk never escalates on a signal; the same signal on a job still does', () => {
  const vent = decideTier({ triage: triage('small_talk', { signals: ['dissatisfied'] }), carried: clear, deepApproved: false });
  assert.equal(vent.tier, 'quick');
  assert.ok(!vent.reasons.includes('signal:dissatisfied'));
  const complaint = decideTier({ triage: triage('price_value', { signals: ['dissatisfied'] }), carried: clear, deepApproved: false });
  assert.equal(complaint.tier, 'standard');
  assert.ok(complaint.reasons.includes('signal:dissatisfied'));
  // Small talk beside a real job is not "small talk alone".
  const mixed = decideTier({ triage: triage('small_talk', { also: 'lists', signals: ['correction'] }), carried: clear, deepApproved: false });
  assert.equal(mixed.tier, 'standard');
});
