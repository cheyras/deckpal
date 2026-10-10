import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { answeringAsk, carriedFromHistory, decideTier } from '../tiers.js';
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
