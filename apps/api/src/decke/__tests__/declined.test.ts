/**
 * Not asking twice for something they already said no to.
 *
 * The shapes here are the replayed parts `approval.ts`'s `approvalReplayPart`
 * actually produces, not an approximation of them.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { alreadyDeclinedMessage, declinedCalls } from '../declined.js';
import { callKey } from '../repeat.js';

/** What the browser replays for one answered approval. */
const part = (name: string, input: unknown, approved: boolean, reason?: string) => ({
  type: `tool-${name}`,
  toolCallId: 'c1',
  input,
  state: 'approval-responded',
  approval: { id: 'a1', approved, ...(reason === undefined ? {} : { reason }) },
});

const msg = (parts: unknown[]) => ({ role: 'assistant', parts });

test('a declined call is remembered, keyed by tool AND arguments', () => {
  const declined = declinedCalls([
    msg([part('research_meta', { query: 'dhelmise meta' }, false, 'the reader declined')]),
  ]);
  assert.ok(declined.has(callKey('research_meta', { query: 'dhelmise meta' })));
  // Different arguments are a different question and must still be askable.
  assert.ok(!declined.has(callKey('research_meta', { query: 'something else' })));
});

test('an APPROVED call is not remembered as a refusal', () => {
  const declined = declinedCalls([msg([part('deck_strategy', { deck_id: 'd1' }, true)])]);
  assert.equal(declined.size, 0);
});

test('an ABANDONED panel is not a refusal', () => {
  // `approval.ts` sends approved:false for "the reader did not answer" too —
  // a closed panel, or a turn somebody walked away from. Treating that as a
  // decision would disable a tool because a phone locked.
  const declined = declinedCalls([
    msg([part('research_meta', { query: 'x' }, false, 'the reader did not answer')]),
  ]);
  assert.equal(declined.size, 0);
});

test('a decline with no reason still counts', () => {
  // The default path sends `reason: 'the reader declined'`, but a denial that
  // arrives without one is still a denial — only the ABANDONED wording is the
  // exception.
  const declined = declinedCalls([msg([part('deck_strategy', { deck_id: 'd1' }, false)])]);
  assert.equal(declined.size, 1);
});

test('the whole conversation is scanned, not just the last turn', () => {
  // The measured complaint spans three separate turns — a per-turn set would
  // have caught none of it.
  const declined = declinedCalls([
    msg([part('deck_strategy', { deck_id: 'd1' }, false, 'the reader declined')]),
    { role: 'user', parts: [{ type: 'text', text: 'no, just talk to me' }] },
    msg([{ type: 'text', text: 'alright' }]),
    { role: 'user', parts: [{ type: 'text', text: 'anything else?' }] },
  ]);
  assert.ok(declined.has(callKey('deck_strategy', { deck_id: 'd1' })));
});

test('argument ORDER does not let a repeat slip past', () => {
  const declined = declinedCalls([
    msg([part('plan_deck', { idea: 'mill', format: 'standard' }, false, 'the reader declined')]),
  ]);
  assert.ok(declined.has(callKey('plan_deck', { format: 'standard', idea: 'mill' })));
});

test('junk in the history is ignored rather than thrown on', () => {
  // The messages are client-supplied and replayed verbatim; a malformed part
  // must not take the whole turn down before the model is even called.
  for (const bad of [null, undefined, 'nope', 42, {}, { parts: 'no' }, { parts: [null, 1, 'x'] }]) {
    assert.doesNotThrow(() => declinedCalls([bad]));
  }
  assert.equal(declinedCalls(null).size, 0);
  assert.equal(declinedCalls('nope').size, 0);
  assert.equal(declinedCalls([{ parts: [{ type: 'text', text: 'hi' }] }]).size, 0);
});

test('a non-tool part carrying an approval-shaped object is ignored', () => {
  const declined = declinedCalls([
    msg([{ type: 'text', text: 'hi', approval: { approved: false }, input: {} }]),
  ]);
  assert.equal(declined.size, 0);
});

test('the refusal message tells him not to ask again, and how it can be undone', () => {
  const m = alreadyDeclinedMessage('research_meta');
  assert.match(m, /research_meta/);
  assert.match(m, /has not run/);
  assert.match(m, /Nothing changed/);
  assert.match(m, /Do not ask a third time/);
  // A refusal is not a problem to solve — the prompt says so, and this is that
  // rule with something behind it.
  assert.match(m, /do not work around it/i);
  // But a changed mind must still work.
  assert.match(m, /If they tell you to go ahead/);
});
