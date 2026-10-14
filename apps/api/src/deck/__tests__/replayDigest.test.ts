/**
 * replayDigest (deck/replayDigest.ts): the digest route's simulator half. Side 0 is the reader whenever the digest named
 * them; an unknown reader gets the replay without a review assessment; a non-log is null, never an error.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { digestBattleLog } from '../battlelog.js';
import { replayDigest } from '../replayDigest.js';

const CODED = readFileSync(fileURLToPath(new URL('./fixtures/battle-log-cardcodes.txt', import.meta.url)), 'utf8');

test("the reader is side 0, the replay covers the game, and the review is assessed from the reader's side", () => {
  const digest = digestBattleLog(CODED, [], { playerName: 'PlayerA' });
  assert.equal(digest.players.me, 'PlayerA');
  const r = replayDigest(CODED, digest, { storedResult: digest.result, notes: 'I misplayed turn 5' })!;
  assert.ok(r, 'a real log gives a replay');
  assert.equal(r.me, 0);
  assert.equal(r.players[0], 'PlayerA');
  assert.ok(r.turns.length > 0 && r.attacks.length > 0);
  assert.ok(r.assessment, 'assessed');
  assert.ok(r.assessment!.reasons.some((x) => /notes/.test(x)), "the reader's notes count");
  assert.ok(r.ms >= 0);
  // From the other player's side, the sides swap with it.
  const theirs = replayDigest(CODED, digestBattleLog(CODED, [], { playerName: 'PlayerB' }))!;
  assert.equal(theirs.me, 0);
  assert.equal(theirs.players[0], 'PlayerB');
});

test('an unidentified reader gets the replay without an assessment; a non-log gets null', () => {
  const r = replayDigest(CODED, { players: { me: null, opponent: null }, finalPrizes: null, leadChanged: false, result: null })!;
  assert.ok(r);
  assert.equal(r.me, null);
  assert.equal(r.assessment, null);
  assert.equal(replayDigest('not a log', { players: { me: null, opponent: null }, finalPrizes: null, leadChanged: false, result: null }), null);
});
