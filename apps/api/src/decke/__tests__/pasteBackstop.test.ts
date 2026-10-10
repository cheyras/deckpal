import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  PASTE_BACKSTOP_LINE,
  pasteBackstopInstruction,
  pasteBackstopNeeded,
} from '../pasteBackstop.js';

const eligible = {
  pastedInLatestUserMessage: true,
  firstLegOfTurn: true,
  calledToolNames: [] as string[],
  approvalRequestedFor: [] as string[],
  declinedThisTurn: false,
  clientToolRan: false,
  correctiveChosen: false,
  turnTroubled: false,
};

test('an untouched paste on a healthy first leg needs the backstop', () => {
  assert.equal(pasteBackstopNeeded(eligible), true);
});

const blockers: Array<[string, Partial<typeof eligible>]> = [
  ['no paste', { pastedInLatestUserMessage: false }],
  ['continuation leg', { firstLegOfTurn: false }],
  ['battle tool called', { calledToolNames: ['add_battle_log'] }],
  ['battle approval requested', { approvalRequestedFor: ['add_battle_log'] }],
  ['reader declined', { declinedThisTurn: true }],
  ['client tool ran', { clientToolRan: true }],
  ['another correction won', { correctiveChosen: true }],
  ['turn was troubled', { turnTroubled: true }],
];

for (const [name, change] of blockers) {
  test(`does not fire when ${name}`, () => {
    assert.equal(pasteBackstopNeeded({ ...eligible, ...change }), false);
  });
}

test('unrelated calls and approval requests do not hide an unlogged paste', () => {
  assert.equal(pasteBackstopNeeded({
    ...eligible,
    calledToolNames: ['decks'],
    approvalRequestedFor: ['log_cards'],
  }), true);
});

test('the reader line and model instruction preserve consent and honesty', () => {
  assert.match(PASTE_BACKSTOP_LINE, /^\n\nLet me /);
  const instruction = pasteBackstopInstruction();
  assert.match(instruction, /add_battle_log/);
  assert.match(instruction, /log "@pasted"/);
  assert.match(instruction, /without deck_id/);
  assert.match(instruction, /dry_run: false/);
  assert.match(instruction, /approval card/i);
  assert.match(instruction, /do not describe .* logged/i);
});
