import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { prepareBattleLog } from '../battlelog.js';

/**
 * Pure preparation evidence lives here; whether the route writes is pinned by
 * the live-DB cases in deck-versioning.test.ts. The old `prepareAs(mode, ...)`
 * helper ignored mode, so running it twice only proved a pure function was
 * deterministic while pretending to exercise both HTTP branches.
 */
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

test('preparation refuses a log whose deck owner cannot be identified', () => {
  assert.throws(
    () => prepareBattleLog(VALID_LOG, ['Snorlax']),
    {
      message:
        'could not determine which player is the deck owner — pass playerName (your exact screen name in the log) or an explicit result',
    },
  );
});

test('preparation returns the deck-specific parsed and merged fields', () => {
  const prepared = prepareBattleLog(VALID_LOG, ['Pikachu']);

  assert.equal(prepared.result, 'win');
  assert.equal(prepared.opponent, 'Bob');
  assert.equal(prepared.parsed.confidence, 'high');
  assert.equal(prepared.parsed.totalTurns, 2);
  assert.deepEqual(prepared.parsed.prizesTaken, { me: 2, opponent: 0 });
});

test('an omitted playedAt reaches the INSERT as null for database-precision now()', () => {
  // Source pin for the route boundary; deck-versioning.test.ts proves the
  // stored played_at and created_at are equal in PostgreSQL. Resolving now()
  // through Date.toISOString() first truncates microseconds and made the game
  // appear older than the row that records it (2026-10-10).
  const source = readFileSync(
    fileURLToPath(new URL('../../routes/decks.ts', import.meta.url)),
    'utf8',
  );
  const routePath = source.indexOf("  '/:id/logs',");
  const route = source.slice(
    source.lastIndexOf('decksRouter.post(', routePath),
    source.indexOf('// POST /decks/log-preview', routePath),
  );
  assert.match(route, /COALESCE\(\$10::timestamptz, now\(\)\)/);
  assert.match(route, /JSON\.stringify\(prepared\.parsed\), source, playedAt, userId/);
  assert.doesNotMatch(route, /JSON\.stringify\(prepared\.parsed\), source, resolvedPlayedAt, userId/);
});
