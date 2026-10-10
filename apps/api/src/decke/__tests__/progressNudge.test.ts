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
  assert.equal(SILENT_DATA_STEPS, 4);
  assert.equal(MAX_PROGRESS_NUDGES, 2);
  assert.equal(
    PROGRESS_NUDGE_TEXT,
    "The reader hasn't heard from you in a while — say in a sentence what you've found so far and what you're checking next, then continue.",
  );
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

test('four silent data steps in a row earn the nudge; three do not', () => {
  assert.equal(shouldNudge(silentData(3), 0), false);
  assert.equal(shouldNudge(silentData(4), 0), true);
  assert.equal(silentDataRun(silentData(4)), 4);
});

test('never before the first step', () => {
  assert.equal(shouldNudge([], 0), false);
});

test('never after a step that already spoke, even with a data call in it', () => {
  const steps = [...silentData(4), said('Found three losses to Gardevoir; checking your last list next.', 'deck_history')];
  assert.equal(shouldNudge(steps, 0), false);
});

test('a spoken line resets the run', () => {
  const steps = [...silentData(3), said('Got the logs — now the history.'), ...silentData(3)];
  assert.equal(silentDataRun(steps), 3);
  assert.equal(shouldNudge(steps, 0), false);
  assert.equal(shouldNudge([...steps, silent('decks')], 0), true);
});

test('only straight after a data step, so the nudge follows a tool result', () => {
  const steps = [...silentData(4), silent('express')];
  assert.equal(shouldNudge(steps, 0), false);
  // A silent face mid-run neither breaks nor extends it.
  assert.equal(silentDataRun([...silentData(2), silent('express'), ...silentData(2)]), 4);
  assert.equal(shouldNudge([...silentData(2), silent('express'), ...silentData(2)], 0), true);
});

test('at most two per request', () => {
  assert.equal(shouldNudge(silentData(4), 1), true);
  assert.equal(shouldNudge(silentData(12), 2), false);
});

test('an ignored nudge is not repeated on the very next step', () => {
  // Nudged when four steps had finished; step five was silent again.
  assert.equal(shouldNudge(silentData(5), 1, 4), false);
  assert.equal(shouldNudge(silentData(7), 1, 4), false);
  assert.equal(shouldNudge(silentData(8), 1, 4), true);
});

test('the request ledger fires at four and eight silent steps and then stops', () => {
  const nudges = createProgressNudges();
  const fired: number[] = [];
  for (let finished = 0; finished <= 20; finished += 1) {
    if (nudges.next(silentData(finished))) fired.push(finished);
  }
  assert.deepEqual(fired, [4, 8]);
  assert.equal(nudges.count, 2);
});

test('the ledger resumes counting when the model speaks after a nudge', () => {
  const nudges = createProgressNudges();
  const steps = silentData(4);
  assert.equal(nudges.next(steps), true);
  steps.push(said('Two of your three losses were to Gardevoir; checking the list.', 'decks'));
  for (let i = 0; i < 3; i += 1) {
    steps.push(silent('deck_history'));
    assert.equal(nudges.next(steps), false);
  }
  steps.push(silent('battle_logs'));
  assert.equal(nudges.next(steps), true);
  assert.equal(nudges.count, 2);
});

test('a retry is a new model call: its steps restart the run, not the count', () => {
  const nudges = createProgressNudges();
  assert.equal(nudges.next(silentData(4)), true);
  assert.equal(nudges.next(silentData(6)), false);
  // The Quick tier's Standard retry: prepareStep is handed zero steps again.
  assert.equal(nudges.next([]), false);
  assert.equal(nudges.next(silentData(4)), true, 'the retry kept the first call\'s landing point');
  assert.equal(nudges.next([]), false);
  assert.equal(nudges.next(silentData(4)), false, 'the per-request cap of two did not hold across the retry');
});
