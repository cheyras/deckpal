/**
 * Not asking twice for something they already said no to.
 *
 * The shapes here are the replayed parts `approval.ts`'s `approvalReplayPart`
 * actually produces, not an approximation of them.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { alreadyDeclinedMessage, declinedCalls, researchRanInConversation } from '../declined.js';
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
    msg([part('plan_deck', { idea: 'mill', format: 'standard' }, false, 'the reader declined')]),
  ]);
  assert.ok(declined.has(callKey('plan_deck', { idea: 'mill', format: 'standard' })));
  // Different arguments are a different question and must still be askable.
  assert.ok(!declined.has(callKey('plan_deck', { idea: 'control', format: 'expanded' })));
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
  const m = alreadyDeclinedMessage('plan_deck');
  assert.match(m, /plan_deck/);
  assert.match(m, /has not run/);
  assert.match(m, /Nothing changed/);
  assert.match(m, /Do not ask a third time/);
  // A refusal is not a problem to solve — the prompt says so, and this is that
  // rule with something behind it.
  assert.match(m, /do not work around it/i);
  // Marked and tailed like a deep refusal, so it cannot be narrated as work that
  // happened — see `deepOutcome.ts` for the incident that marker exists for.
  assert.match(m, /\[\[NO_WORK\]\]/);
  // TRUTHFUL: a bare re-call with the same arguments will not ask. The old
  // message promised "call it again and it will ask", which the exact
  // (tool, args) decline makes provably false — the same call is suppressed.
  assert.match(m, /will not ask/);
  assert.match(m, /different arguments bring a dialog back/);
  assert.doesNotMatch(m, /If they tell you to go ahead/);
});

test('the ABANDONED wording matches the client that emits it, exactly', async () => {
  // `approval.ts` (apps/web) composes the string and `declined.ts` (apps/api)
  // recognises it, and they are in different packages with no shared module
  // between them. If either side is reworded on its own, an abandoned panel
  // starts reading as a permanent refusal — a tool would silently stop working
  // because somebody's phone locked mid-turn, and nothing would fail loudly.
  const fs = await import('node:fs');
  const url = await import('node:url');
  const here = url.fileURLToPath(new URL('.', import.meta.url));
  const client = fs.readFileSync(
    `${here}../../../../../apps/web/src/character/host/approval.ts`,
    'utf8',
  );
  const m = client.match(/export const ABANDONED_REASON = '([^']+)'/);
  assert.ok(m, 'approval.ts no longer declares ABANDONED_REASON as a plain literal');

  // The server's copy is private; drive it through the public behaviour instead
  // of exporting it just for a test.
  const abandoned = declinedCalls([msg([part('research_meta', { q: 1 }, false, m![1]!)])]);
  assert.equal(abandoned.size, 0, `"${m![1]}" must be read as abandoned, not declined`);

  const declined = declinedCalls([msg([part('research_meta', { q: 1 }, false, 'the reader declined')])]);
  assert.equal(declined.size, 1, 'a real decline must still be recorded');
});

// ═══════════════════════════════════════════════════════════════════════════
// SUGGEST-ONCE ETIQUETTE — the two guide tools, declined by NAME
// ═══════════════════════════════════════════════════════════════════════════
//
// The owner: "ask maybe once, and if the user seems uninterested, stop
// persistently asking." The ledger above keys on (tool, args), so a reworded
// guide re-offer asks again. The two guide tools — `deck_strategy` (when it
// writes) and `write_strategy_guide` — are the same act at two boundaries, and
// a decline of EITHER suppresses further calls to BOTH, by name, regardless of
// arguments. A read-only `deck_strategy` call (no markdown) is NOT suppressed.

test('a declined write_strategy_guide suppresses further deck_strategy writes regardless of args', () => {
  // The symmetry of the act: declining the writer suppresses the storage tool
  // too, because a reworded deck_strategy write is the same guide save.
  const declined = declinedCalls([
    msg([part('write_strategy_guide', { deck: 'Toolbox Slowking' }, false, 'the reader declined')]),
  ]);
  assert.ok(
    declined.has(callKey('deck_strategy', { deck_id: 'd1', markdown: '# New Guide\n\nA reworded one.' })),
    'a write_strategy_guide decline did not suppress a deck_strategy write',
  );
});

test('a declined deck_strategy WRITE suppresses further write_strategy_guide calls regardless of args', () => {
  // And the reverse: declining the storage shape suppresses the writer shape.
  const declined = declinedCalls([
    msg([part('deck_strategy', { deck_id: 'd1', markdown: '# Old Guide' }, false, 'the reader declined')]),
  ]);
  assert.ok(
    declined.has(callKey('write_strategy_guide', { deck: 'Toolbox Slowking', focus: 'sideboarding' })),
    'a deck_strategy write decline did not suppress a write_strategy_guide call',
  );
});

test('a declined deck_strategy READ does NOT suppress guide calls', () => {
  // "a read-only deck_strategy call (no markdown arg) is NOT suppressed — only
  // the write shape is." A read is a different question.
  const declined = declinedCalls([
    msg([part('deck_strategy', { deck_id: 'd1' }, false, 'the reader declined')]),
  ]);
  assert.ok(
    !declined.has(callKey('write_strategy_guide', { deck: 'd1' })),
    'a read decline suppressed a write_strategy_guide call',
  );
  assert.ok(
    !declined.has(callKey('deck_strategy', { deck_id: 'd1', markdown: '# Guide' })),
    'a read decline suppressed a deck_strategy write',
  );
  // The exact read call IS still suppressed by (tool, args) — that is unchanged.
  assert.ok(
    declined.has(callKey('deck_strategy', { deck_id: 'd1' })),
    'the exact read call was not suppressed by its own (tool, args) decline',
  );
});

test('reworded guide args are still suppressed by the name-level decline', () => {
  // The measured complaint: the model rewords the guide and calls
  // deck_strategy again with different markdown. Different args, same act —
  // suppressed by name.
  const declined = declinedCalls([
    msg([part('deck_strategy', { deck_id: 'd1', markdown: '# Guide v1' }, false, 'the reader declined')]),
  ]);
  assert.ok(
    declined.has(callKey('deck_strategy', { deck_id: 'd1', markdown: '# Guide v2 — completely reworded' })),
    'a reworded deck_strategy write was not suppressed by the name-level decline',
  );
});

test('other tools are unaffected by a guide decline', () => {
  // Only the two guide tools suppress by name. Everything else keeps exact
  // (tool, args) semantics.
  const declined = declinedCalls([
    msg([part('write_strategy_guide', { deck: 'd1' }, false, 'the reader declined')]),
  ]);
  assert.ok(
    !declined.has(callKey('research_meta', { query: 'what is winning Standard?' })),
    'a guide decline suppressed an unrelated tool',
  );
  assert.ok(
    !declined.has(callKey('plan_deck', { idea: 'a mill deck' })),
    'a guide decline suppressed an unrelated tool',
  );
});

test('a read-shape deck_strategy call is NOT suppressed by a guide decline', () => {
  // The other half of "only the write shape is": a write_strategy_guide decline
  // suppresses deck_strategy writes but NOT reads.
  const declined = declinedCalls([
    msg([part('write_strategy_guide', { deck: 'd1' }, false, 'the reader declined')]),
  ]);
  assert.ok(
    !declined.has(callKey('deck_strategy', { deck_id: 'd1' })),
    'a read-shape deck_strategy call was suppressed by a guide decline',
  );
});

test('the guide refusal message acknowledges the earlier no and forbids work-arounds', () => {
  // The doctrine: acknowledge the earlier no, drop the subject unless the
  // reader raises it, forbid work-arounds. The guide message names the act,
  // not the exact tool call — because rewording is not a new question.
  for (const tool of ['write_strategy_guide', 'deck_strategy'] as const) {
    const m = alreadyDeclinedMessage(tool);
    assert.match(m, /already said no/);
    assert.match(m, /has not run/);
    assert.match(m, /do not work around it/i);
    assert.match(m, /Drop the subject/);
    assert.match(m, /\[\[NO_WORK\]\]/);
    // TRUTHFUL about an irreversible name-level decline: only the reader
    // raising it themselves brings the dialog back; a bare re-call will not
    // ask. The old "call it again and it will ask" was the provable lie this
    // closes — the same name-level predicate refuses the re-call.
    assert.match(m, /reader raising.*themselves brings the dialog back/i);
    assert.match(m, /bare re-call will not ask/);
    assert.doesNotMatch(m, /If they tell you to go ahead/);
    // It does NOT say "this exact" — the whole point of the name-level
    // suppression is that rewording is not a new question.
    assert.doesNotMatch(m, /this exact/);
  }
});

test('a non-guide, non-research tool keeps the exact-call refusal message', () => {
  // The existing doctrine for every other tool: name the exact call. The guide
  // and research_meta rewordings do not change this.
  const m = alreadyDeclinedMessage('plan_deck');
  assert.match(m, /this exact plan_deck call/);
});

// ═══════════════════════════════════════════════════════════════════════════
// RESEARCH_META — declined by NAME, same mechanism as the guide pair but
// keyed to research_meta alone. A research decline does NOT suppress guides,
// and a guide decline does NOT suppress research_meta.
// ═══════════════════════════════════════════════════════════════════════════
//
// The other half of the measured complaint: "You asked to do meta research. I
// said no because you'd already done it." A reworded research_meta is the same
// act — a declined research_meta suppresses further research_meta calls of ANY
// shape, not just the exact one.

test('a declined research_meta suppresses further research_meta calls regardless of args', () => {
  const declined = declinedCalls([
    msg([part('research_meta', { query: 'dhelmise meta' }, false, 'the reader declined')]),
  ]);
  assert.ok(
    declined.has(callKey('research_meta', { query: 'something completely different' })),
    'a research_meta decline did not suppress a reworded research_meta call',
  );
});

test('a research_meta decline does NOT suppress guide tools', () => {
  // The two name-level suppressions are independent: a research_meta decline
  // must not suppress a guide write, and vice versa.
  const declined = declinedCalls([
    msg([part('research_meta', { query: 'x' }, false, 'the reader declined')]),
  ]);
  assert.ok(
    !declined.has(callKey('write_strategy_guide', { deck: 'd1' })),
    'a research_meta decline suppressed a guide call',
  );
  assert.ok(
    !declined.has(callKey('deck_strategy', { deck_id: 'd1', markdown: '# Guide' })),
    'a research_meta decline suppressed a guide write',
  );
});

test('the research_meta refusal message acknowledges the earlier no and forbids work-arounds', () => {
  const m = alreadyDeclinedMessage('research_meta');
  assert.match(m, /already said no/);
  assert.match(m, /has not run/);
  assert.match(m, /do not work around it/i);
  assert.match(m, /Drop the subject/);
  assert.match(m, /\[\[NO_WORK\]\]/);
  // TRUTHFUL about an irreversible name-level decline, same as the guide.
  assert.match(m, /reader raising.*themselves brings the dialog back/i);
  assert.match(m, /bare re-call will not ask/);
  assert.doesNotMatch(m, /If they tell you to go ahead/);
  // It does NOT say "this exact" — the whole point of the name-level
  // suppression is that rewording is not a new question.
  assert.doesNotMatch(m, /this exact/);
});

// ═══════════════════════════════════════════════════════════════════════════
// A CHANGED MIND IS THE READER'S SENTENCE — the latestUserText bypass
// ═══════════════════════════════════════════════════════════════════════════
//
// The name-level decline is irreversible for the conversation — the same
// predicate that refused the first reworded call refuses the next, which is
// why "call it again and it will ask" was a provable lie. The one way back is
// the reader's OWN sentence: when their latest message re-opens the family
// (matched on token boundaries the way `printingSaid.ts` matches a printing),
// a reworded call asks again — the approval dialog is the real check, so a
// wrong bypass just shows a dialog the reader dismisses again. The bypass is
// NAME-LEVEL only; an exact (tool, args) decline still suppresses the exact
// call.

test('a reworded guide call is suppressed by name unless the reader re-opens it', () => {
  // No latestUserText → the name-level suppression stands for the conversation.
  const declined = declinedCalls([
    msg([part('write_strategy_guide', { deck: 'Toolbox Slowking' }, false, 'the reader declined')]),
  ]);
  assert.ok(
    declined.has(callKey('write_strategy_guide', { deck: 'Toolbox Slowking', focus: 'sideboarding' })),
    'a reworded guide call was not suppressed by the name-level decline',
  );
});

test('guide re-opening vocabulary in the reader latest message re-opens the guide family', () => {
  const messages = [
    msg([part('write_strategy_guide', { deck: 'Toolbox Slowking' }, false, 'the reader declined')]),
  ];
  // Any one of the family's words, on token boundaries, re-opens it.
  for (const text of [
    'yes write up the strategy guide',
    'go ahead and save it',
    'a guide for that deck',
  ]) {
    const declined = declinedCalls(messages, text);
    assert.ok(
      !declined.has(callKey('write_strategy_guide', { deck: 'Toolbox Slowking', focus: 'sideboarding' })),
      `re-opening vocab "${text}" did not re-open the guide family`,
    );
  }
  // The exact call they declined is STILL suppressed — the bypass is name-level
  // only, never the exact (tool, args) decline.
  const reopened = declinedCalls(messages, 'yes write up the strategy guide');
  assert.ok(
    reopened.has(callKey('write_strategy_guide', { deck: 'Toolbox Slowking' })),
    'the exact declined call was re-opened — the bypass must be name-level only',
  );
  // And a latestUserText that names no guide word does NOT re-open it.
  const untouched = declinedCalls(messages, 'just talk to me about something else');
  assert.ok(
    untouched.has(callKey('write_strategy_guide', { deck: 'Toolbox Slowking', focus: 'sideboarding' })),
    'a non-matching latestUserText re-opened the guide family',
  );
});

test('research re-opening vocabulary re-opens the research_meta family', () => {
  const messages = [msg([part('research_meta', { query: 'dhelmise meta' }, false, 'the reader declined')])];
  for (const text of ['look it up — the current lists', 'research the meta again', 'show me the meta']) {
    const declined = declinedCalls(messages, text);
    assert.ok(
      !declined.has(callKey('research_meta', { query: 'something else' })),
      `re-opening vocab "${text}" did not re-open the research family`,
    );
  }
  // The exact research call is still suppressed even when re-opened.
  const reopened = declinedCalls(messages, 'look it up — the current lists');
  assert.ok(
    reopened.has(callKey('research_meta', { query: 'dhelmise meta' })),
    'the exact declined research call was re-opened — the bypass must be name-level only',
  );
});

test('re-opening vocab is per family — research vocab does not re-open guides', () => {
  // The two name-level families are independent: a research_meta decline must
  // not be re-opened by guide vocabulary, and vice versa.
  const guideMessages = [
    msg([part('write_strategy_guide', { deck: 'd1' }, false, 'the reader declined')]),
  ];
  // 'meta' / 'look it up' / 'current lists' re-open research, NOT guides.
  const declined = declinedCalls(guideMessages, 'look it up — the current meta lists');
  assert.ok(
    declined.has(callKey('write_strategy_guide', { deck: 'd1', focus: 'sideboarding' })),
    'research re-opening vocab leaked into the guide family',
  );
});

test('re-opening vocab is per family — guide vocab does not re-open research', () => {
  const researchMessages = [
    msg([part('research_meta', { query: 'x' }, false, 'the reader declined')]),
  ];
  // 'strategy' / 'guide' re-open guides, NOT research.
  const declined = declinedCalls(researchMessages, 'write up the strategy guide');
  assert.ok(
    declined.has(callKey('research_meta', { query: 'something else' })),
    'guide re-opening vocab leaked into the research family',
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// researchRanInConversation — provenance for the no_research evidence bar
// ═══════════════════════════════════════════════════════════════════════════
//
// `findings` content is the model's own text and unverifiable; whether research
// actually ran is not. This scans the replayed history the same way
// `declinedCalls` scans for declines, and answers true when a research_meta or
// get_card call ran to a result — approved (`approval.approved === true`) or
// returned a read result (`state: 'output-available'`).

test('researchRanInConversation is true when a research_meta was approved and ran', () => {
  const messages = [msg([part('research_meta', { query: 'what is winning Standard?' }, true)])];
  assert.equal(researchRanInConversation(messages), true);
});

test('researchRanInConversation is true when a get_card read returned a result', () => {
  const messages = [
    {
      role: 'assistant',
      parts: [
        {
          type: 'tool-get_card',
          toolCallId: 'c1',
          state: 'output-available',
          input: { slug: 'swsh4-162' },
          output: { name: 'Crobat V' },
        },
      ],
    },
  ];
  assert.equal(researchRanInConversation(messages), true);
});

test('researchRanInConversation is false when research was only declined', () => {
  // A decline is not a completion — the call did not run.
  const messages = [msg([part('research_meta', { query: 'x' }, false, 'the reader declined')])];
  assert.equal(researchRanInConversation(messages), false);
  // And an abandoned panel is not a completion either.
  const abandoned = [msg([part('research_meta', { query: 'x' }, false, 'the reader did not answer')])];
  assert.equal(researchRanInConversation(abandoned), false);
});

test('researchRanInConversation is false when nothing ran', () => {
  assert.equal(researchRanInConversation([]), false);
  assert.equal(researchRanInConversation(null), false);
  assert.equal(
    researchRanInConversation([{ role: 'user', parts: [{ type: 'text', text: 'hi' }] }]),
    false,
  );
  // An unrelated tool that ran does not count.
  assert.equal(
    researchRanInConversation([
      {
        role: 'assistant',
        parts: [{ type: 'tool-plan_deck', toolCallId: 'c1', state: 'output-available', input: {}, output: {} }],
      },
    ]),
    false,
  );
});
