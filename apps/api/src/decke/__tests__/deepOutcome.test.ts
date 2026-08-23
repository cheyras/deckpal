/**
 * "Perfect, let's build! I'm pulling together a 60-card list…" — after two
 * `plan_deck` calls that ran no model and produced no plan.
 *
 * Recorded 2026-08-23. The owner was watching a deck get described to him that
 * did not exist and could not exist, because the tool that makes decks had been
 * refused before it started. He said: *"he couldn't actually plan the deck, so
 * it wouldn't be a good deck."*
 *
 * The refusal was a polite, fluent, first-person sentence returned as a bare
 * string — the same type, and the same register, as a real answer. The chip
 * told the reader it had failed. Nothing told the model. These tests pin the
 * signal that now does.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NO_WORK, deepFailed, deepRefused, isNoWork } from '../deepOutcome.js';

test('both outcomes lead with the marker, before any prose', () => {
  // FIRST, not somewhere in the middle. A model that reads a fluent opening
  // clause has already begun composing an answer by the time a caveat arrives.
  assert.ok(deepRefused('out of credit').startsWith(NO_WORK));
  assert.ok(deepFailed('upstream timeout').startsWith(NO_WORK));
});

test('a refusal and a failure are told apart, because they need different sentences', () => {
  // A limit sends someone to the top-up. A fault sends them to support. Saying
  // the wrong one wastes their time in a way that feels like being lied to.
  assert.match(deepRefused('x'), /REFUSED/);
  assert.match(deepFailed('x'), /FAILED/);
  assert.doesNotMatch(deepRefused('x'), /FAILED/);
  assert.doesNotMatch(deepFailed('x'), /REFUSED/);
});

test('each carries its own reason through', () => {
  assert.match(deepRefused("today's 10 deep-thinking questions are spent"), /10 deep-thinking/);
  assert.match(deepFailed('the planner timed out after 210s'), /timed out after 210s/);
});

test('both forbid the exact continuation that was recorded', () => {
  for (const out of [deepRefused('x'), deepFailed('y')]) {
    assert.match(out, /NO result/i, 'it does not say there is no result')
    assert.match(out, /let's build/i, 'it does not name the continuation to avoid')
    assert.match(out, /do not list cards/i)
  }
});

test('a real deck plan does not contain the marker', () => {
  // The marker has to be something no answer could produce, or the guard eats
  // real work. Deck plans are long, contain brackets, counts and card codes.
  const plan = [
    '## Squirtle Squad Chaos (Standard)',
    '4x Squirtle [swsh4-25] — the whole point',
    '2x Blastoise ex [me05-009] — you own 1, need 1 more (~$14.20)',
    'Energy: 12x Water',
    'Note: [[not a marker]] and [NO_WORK] on its own is fine too',
  ].join('\n');
  assert.ok(!isNoWork(plan), 'a real plan was mistaken for a refusal');
  assert.ok(!plan.includes(NO_WORK));
});

test('isNoWork only fires on the LEADING marker', () => {
  // A plan that merely quotes the marker mid-text is still a plan. Anchoring at
  // the start is what makes the guard safe to act on.
  assert.ok(isNoWork(deepRefused('x')));
  assert.ok(!isNoWork(`Here is your deck. ${NO_WORK}`));
  assert.ok(!isNoWork(''));
  assert.ok(!isNoWork(undefined));
  assert.ok(!isNoWork(null));
  assert.ok(!isNoWork(42));
});

test('the marker is not something a human ever reads', () => {
  // It goes to the model. The reader gets the chip, built from the same event.
  // If this ever needs to be pretty, something is rendering the wrong string.
  assert.match(NO_WORK, /^\[\[[A-Z_]+\]\]$/);
});
