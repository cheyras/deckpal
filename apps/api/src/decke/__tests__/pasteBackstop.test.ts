import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  PASTE_BACKSTOP_LINE,
  pasteBackstopInstruction,
  pasteBackstopNeeded,
  pastedBeforeAnsweredAsk,
} from '../pasteBackstop.js';

const eligible = {
  pastedInLatestUserMessage: true,
  pastedBeforeAnsweredAsk: false,
  firstLegOfTurn: true,
  calledToolNames: [] as string[],
  anyApprovalPending: false,
  clientToolRan: false,
  correctiveChosen: false,
  turnTroubled: false,
  askedReader: false,
};

test('an untouched paste on a healthy first leg needs the backstop', () => {
  assert.equal(pasteBackstopNeeded(eligible), true);
});

const blockers: Array<[string, Partial<typeof eligible>]> = [
  ['no paste', { pastedInLatestUserMessage: false }],
  ['continuation leg', { firstLegOfTurn: false }],
  ['battle tool called', { calledToolNames: ['add_battle_log'] }],
  ['any approval is pending', { anyApprovalPending: true }],
  ['client tool ran', { clientToolRan: true }],
  ['another correction won', { correctiveChosen: true }],
  ['turn was troubled', { turnTroubled: true }],
  // S4: "which deck was this?" is on screen; a card for a guessed log must not
  // dock above it.
  ['the turn showed a valid ask card', { askedReader: true }],
];

for (const [name, change] of blockers) {
  test(`does not fire when ${name}`, () => {
    assert.equal(pasteBackstopNeeded({ ...eligible, ...change }), false);
  });
}

test('a pending approval for another write blocks the backstop', () => {
  assert.equal(pasteBackstopNeeded({
    ...eligible,
    calledToolNames: ['decks'],
    anyApprovalPending: true,
  }), false);
});

test('the reader line and model instruction preserve consent and honesty', () => {
  assert.match(PASTE_BACKSTOP_LINE, /^\n\nLet me /);
  for (const instruction of [pasteBackstopInstruction(), pasteBackstopInstruction({ afterAsk: true })]) {
    assert.match(instruction, /add_battle_log/);
    assert.match(instruction, /log "@pasted"/);
    assert.match(instruction, /without deck_id/);
    assert.match(instruction, /dry_run: false/);
    assert.match(instruction, /approval card/i);
    assert.match(instruction, /do not describe .* logged/i);
  }
  assert.match(pasteBackstopInstruction(), /in their latest message/);
  assert.match(pasteBackstopInstruction({ afterAsk: true }), /previous message.*asked them.*latest message answers/);
});

// ── S-a: AN ASK DEFERS THE BACKSTOP; IT DOES NOT CANCEL IT ──────────────────

const LOG = [
  'Setup',
  'PlayerA chose heads for the opening coin flip.',
  'PlayerA won the coin toss.',
  'PlayerA decided to go first.',
  'PlayerA drew 7 cards for the opening hand.',
  'PlayerB drew 7 cards for the opening hand.',
  "PlayerB's Turn",
  'PlayerB drew a card.',
  'PlayerB played Dreepy to the Active Spot.',
  'PlayerB attached Basic Psychic Energy to Dreepy in the Active Spot.',
  'PlayerB ended their turn.',
  "PlayerA's Turn",
  'PlayerA drew a card.',
  'PlayerA played Shuppet to the Bench.',
  'PlayerA ended their turn.',
  'All Prize cards taken. PlayerA wins.',
].join('\n');
const user = (text: string) => ({ role: 'user', parts: [{ type: 'text', text }] });
const ask = { type: 'tool-ask_user', toolCallId: 'ask-1', state: 'output-available', input: { about: 'battle_log', questions: [] }, output: {} };
const pasteThenAsk = (assistantParts: unknown[], answer = 'Deck — Gardevoir ex') => [
  user(`Log this game please\n\n${LOG}`),
  { role: 'assistant', parts: assistantParts },
  user(answer),
];

test('the leg answering an ask raised over a paste may run the backstop', () => {
  const messages = pasteThenAsk([{ type: 'text', text: 'Which deck were you on?' }, ask]);
  assert.equal(pastedBeforeAnsweredAsk(messages), true);
  // And the gate takes it in place of a paste in the latest message.
  assert.equal(pasteBackstopNeeded({ ...eligible, pastedInLatestUserMessage: false, pastedBeforeAnsweredAsk: true }), true);
  // Every other blocker still applies — including the answer leg asking again.
  assert.equal(pasteBackstopNeeded({ ...eligible, pastedInLatestUserMessage: false, pastedBeforeAnsweredAsk: true, askedReader: true }), false);
  assert.equal(pasteBackstopNeeded({ ...eligible, pastedInLatestUserMessage: false, pastedBeforeAnsweredAsk: true, calledToolNames: ['add_battle_log'] }), false);
});

test('only an answered ask over an unlogged paste in the message right before it counts', () => {
  // The ask turn already raised (or the reader declined) the log card.
  assert.equal(pastedBeforeAnsweredAsk(pasteThenAsk([ask, { type: 'tool-add_battle_log', toolCallId: 'log-1', state: 'output-available', input: {}, output: 'held' }])), false);
  // No ask: the reader simply wrote again.
  assert.equal(pastedBeforeAnsweredAsk(pasteThenAsk([{ type: 'text', text: 'Nice game.' }])), false);
  // An ask, but over a message with no paste.
  assert.equal(pastedBeforeAnsweredAsk([user('Build me a deck'), { role: 'assistant', parts: [ask] }, user('Standard')]), false);
  // A paste two turns back does not count: the reader has moved on.
  assert.equal(pastedBeforeAnsweredAsk([
    user(`Log this\n\n${LOG}`),
    { role: 'assistant', parts: [{ type: 'text', text: 'Logged.' }] },
    user('Build me a deck'),
    { role: 'assistant', parts: [ask] },
    user('Standard'),
  ]), false);
  assert.equal(pastedBeforeAnsweredAsk([user(LOG)]), false);
  assert.equal(pastedBeforeAnsweredAsk(null), false);
});
