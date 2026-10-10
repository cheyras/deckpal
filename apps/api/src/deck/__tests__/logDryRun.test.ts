import assert from 'node:assert/strict';
import { test } from 'node:test';
import { prepareBattleLog } from '../battlelog.js';

/**
 * Route-mode harness for the pure preparation seam. The production route calls
 * this function once and only branches AFTER it returns; spelling the two
 * modes out here records the invariant that preview and insert see identical
 * owner gates and parsed fields without needing a database fixture.
 */
function prepareAs(_mode: 'dry-run' | 'insert', log: string, names: string[]) {
  return prepareBattleLog(log, names);
}

const VALID_LOG = [
  'Setup',
  'Alice drew 7 cards for the opening hand.',
  'Bob drew 7 cards for the opening hand.',
  "Alice's Turn",
  'Alice played Pikachu to the Active Spot.',
  "Bob's Turn",
  'Bob played Charmander to the Active Spot.',
  'Alice took 2 Prize cards.',
  'All Prize cards taken. Alice wins.',
].join('\n');

test('dry run and insert refuse an unidentified owner with the identical message', () => {
  const messages = (['dry-run', 'insert'] as const).map((mode) => {
    try {
      prepareAs(mode, VALID_LOG, ['Snorlax']);
      assert.fail(`${mode} unexpectedly accepted an unidentified owner`);
    } catch (err) {
      return (err as Error).message;
    }
  });

  assert.equal(
    messages[0],
    'could not determine which player is the deck owner — pass playerName (your exact screen name in the log) or an explicit result',
  );
  assert.equal(messages[1], messages[0]);
});

test('dry run and insert receive the same deck-specific parsed and merged fields', () => {
  const dry = prepareAs('dry-run', VALID_LOG, ['Pikachu']);
  const insert = prepareAs('insert', VALID_LOG, ['Pikachu']);

  assert.deepEqual(dry, insert);
  assert.equal(dry.result, 'win');
  assert.equal(dry.opponent, 'Bob');
  assert.equal(dry.parsed.confidence, 'high');
  assert.equal(dry.parsed.totalTurns, 2);
  assert.deepEqual(dry.parsed.prizesTaken, { me: 2, opponent: 0 });
});
