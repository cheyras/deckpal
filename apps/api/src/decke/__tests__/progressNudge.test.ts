import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MAX_PROGRESS_NUDGES,
  PROGRESS_NUDGE_TEXT,
  SILENT_DATA_STEPS,
  createProgressNudges,
  isDataStep,
  progressNudgeMessage,
  shouldNudge,
  silentDataRun,
} from '../progressNudge.js';

const calls = (...toolNames: string[]) => toolNames.map((toolName) => ({ toolName }));
const silent = (...toolNames: string[]) => ({ text: '', toolCalls: calls(...toolNames) });
const said = (text: string, ...toolNames: string[]) => ({ text, toolCalls: calls(...toolNames) });
const silentData = (n: number) => Array.from({ length: n }, () => silent('battle_logs'));

test('the thresholds are the ones the replay probe grades against', () => {
  // The probe's SILENT_RUN_LIMIT is this number and a long turn is one more;
  // `scripts/__tests__/decke-replay-probe.test.mjs` pins its side to this module.
  assert.equal(SILENT_DATA_STEPS, 3);
  assert.equal(MAX_PROGRESS_NUDGES, 2);
  assert.equal(
    PROGRESS_NUDGE_TEXT,
    "The reader hasn't heard from you in a while. In one short line, tell them what you've found so far. Only if you're not done, add what you're checking next, then continue.",
  );
  // It may land on the step that was going to answer: never ask for a next
  // check unconditionally.
  assert.match(PROGRESS_NUDGE_TEXT, /Only if you're not done/);
  // And a line alone ends the loop: he has to be told to carry on.
  assert.match(PROGRESS_NUDGE_TEXT, /then continue\.$/);
  assert.deepEqual(progressNudgeMessage(), { role: 'system', content: PROGRESS_NUDGE_TEXT });
  assert.notEqual(progressNudgeMessage(), progressNudgeMessage(), 'each nudge must be a fresh object');
});

test('a data step is any tool beyond express and showScreen', () => {
  assert.equal(isDataStep(silent('decks')), true);
  assert.equal(isDataStep(silent('express', 'decks')), true);
  assert.equal(isDataStep(silent('express')), false);
  assert.equal(isDataStep(silent('showScreen')), false);
  assert.equal(isDataStep({ text: 'Done.' }), false);
});

test('three silent data steps in a row earn the nudge; two do not', () => {
  assert.equal(shouldNudge(silentData(2), 0), false);
  assert.equal(shouldNudge(silentData(3), 0), true);
  assert.equal(silentDataRun(silentData(3)), 3);
});

test('never before the first step', () => {
  assert.equal(shouldNudge([], 0), false);
});

test('never after a step that already spoke, even with a data call in it', () => {
  const steps = [...silentData(3), said('Found three losses to Gardevoir; checking your last list next.', 'deck_history')];
  assert.equal(shouldNudge(steps, 0), false);
});

test('a spoken line resets the run', () => {
  const steps = [...silentData(2), said('Got the logs — now the history.'), ...silentData(2)];
  assert.equal(silentDataRun(steps), 2);
  assert.equal(shouldNudge(steps, 0), false);
  assert.equal(shouldNudge([...steps, silent('decks')], 0), true);
});

test('only straight after a data step, so the nudge follows a tool result', () => {
  const steps = [...silentData(3), silent('express')];
  assert.equal(shouldNudge(steps, 0), false);
  // A silent face mid-run neither breaks nor extends it.
  assert.equal(silentDataRun([...silentData(2), silent('express'), ...silentData(1)]), 3);
  assert.equal(shouldNudge([...silentData(2), silent('express'), ...silentData(1)], 0), true);
});

test('at most two per request', () => {
  assert.equal(shouldNudge(silentData(3), 1), true);
  assert.equal(shouldNudge(silentData(12), 2), false);
});

test('an ignored nudge is not repeated on the very next step', () => {
  // Nudged when three steps had finished; step four was silent again.
  assert.equal(shouldNudge(silentData(4), 1, 3), false);
  assert.equal(shouldNudge(silentData(5), 1, 3), false);
  assert.equal(shouldNudge(silentData(6), 1, 3), true);
});

test('the request ledger fires at three and six silent steps and then stops', () => {
  const nudges = createProgressNudges();
  const fired: number[] = [];
  for (let finished = 0; finished <= 20; finished += 1) {
    if (nudges.next(silentData(finished))) fired.push(finished);
  }
  assert.deepEqual(fired, [3, 6]);
  assert.equal(nudges.count, 2);
  // Where they landed: the index the next step had, for the stop rule.
  assert.deepEqual(nudges.landings, [3, 6]);
});

test('the ledger resumes counting when the model speaks after a nudge', () => {
  const nudges = createProgressNudges();
  const steps = silentData(3);
  assert.equal(nudges.next(steps), true);
  steps.push(said('Two of your three losses were to Gardevoir; checking the list.', 'decks'));
  for (let i = 0; i < 2; i += 1) {
    steps.push(silent('deck_history'));
    assert.equal(nudges.next(steps), false);
  }
  steps.push(silent('battle_logs'));
  assert.equal(nudges.next(steps), true);
  assert.equal(nudges.count, 2);
  assert.deepEqual(nudges.landings, [3, 7]);
});

test('a retry is a new model call: its steps restart the run and the landings, not the count', () => {
  const nudges = createProgressNudges();
  assert.equal(nudges.next(silentData(3)), true);
  assert.equal(nudges.next(silentData(5)), false);
  assert.deepEqual(nudges.landings, [3]);
  // The Quick tier's Standard retry: prepareStep is handed zero steps again.
  assert.equal(nudges.next([]), false);
  assert.deepEqual(nudges.landings, [], 'a landing from the first call would exempt the wrong step of the retry');
  assert.equal(nudges.next(silentData(3)), true, 'the retry kept the first call\'s landing point');
  assert.equal(nudges.next([]), false);
  assert.equal(nudges.next(silentData(3)), false, 'the per-request cap of two did not hold across the retry');
});

test('landings cannot be changed from outside the ledger', () => {
  const nudges = createProgressNudges();
  nudges.next(silentData(3));
  (nudges.landings as number[]).push(99);
  assert.deepEqual(nudges.landings, [3]);
});
