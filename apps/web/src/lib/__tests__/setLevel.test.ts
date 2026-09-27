// Pure unit test for the set/species "LVL" badge math in format.ts (QUAL-05).
//
// The bug: two web call sites derived a level from the DISPLAY percentage —
// rounded to one decimal, round-half-up, by design for display (trainerLevel.ts
// `pct()`) — instead of the server's own truncating-integer-math level. Rounding
// the fraction BEFORE the floor/25 step lets a raw percentage just below a
// 25/50/75/100 boundary round up across it: 1999/2000 owned (raw 99.95%) rounded
// to a displayed 100.0% and read as "MAX" a card early.
//
// `setLevelFromCounts` fixes this by truncating like the DB's generated
// `user_set_progress.set_level` column does (Postgres integer division), so it
// agrees with the server's `setLevel(pct(owned,total))` and with
// `set_level`/`complete_level` on the wire — never a rounded pct.
//
// Mirrors the `node --import tsx --test` convention used by the other lib tests
// (see rarity.test.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setLevelFromCounts, setLevelLabel } from '../format.js';

test('setLevelFromCounts — 0 owned or 0 total is level 0', () => {
  assert.equal(setLevelFromCounts(0, 2000), 0);
  assert.equal(setLevelFromCounts(500, 0), 0);
  assert.equal(setLevelFromCounts(0, 0), 0);
});

test('setLevelFromCounts — exact 25/50/75/100% boundaries', () => {
  assert.equal(setLevelFromCounts(500, 2000), 2); // exactly 25%
  assert.equal(setLevelFromCounts(1000, 2000), 3); // exactly 50%
  assert.equal(setLevelFromCounts(1500, 2000), 4); // exactly 75%
  assert.equal(setLevelFromCounts(2000, 2000), 5); // exactly 100% → MAX
});

test('setLevelFromCounts — QUAL-05 boundary: 1999/2000 is level 4, never MAX', () => {
  // raw 99.95%; the old pct-then-floor path rounded the DISPLAY pct to 100.0
  // and reported MAX with a card still missing. Truncating integer math (like
  // Postgres's integer division) keeps it at 4 until the 2000th card lands.
  assert.equal(setLevelFromCounts(1999, 2000), 4);
  assert.equal(setLevelLabel(setLevelFromCounts(1999, 2000)), '4');
});

test('setLevelFromCounts — QUAL-05 boundary: 499/2000 is level 1, not 2', () => {
  // raw 24.95%; the old path rounded the display pct to 25.0 and jumped to
  // LVL 2 one card early.
  assert.equal(setLevelFromCounts(499, 2000), 1);
  assert.equal(setLevelLabel(setLevelFromCounts(499, 2000)), '1');
});

test('setLevelFromCounts — one card below each higher boundary stays in the lower band', () => {
  assert.equal(setLevelFromCounts(1499, 2000), 3); // just under 75%
  assert.equal(setLevelFromCounts(999, 2000), 2); // just under 50%
  assert.equal(setLevelFromCounts(1, 2000), 1); // just above 0%
});

test('setLevelLabel — formats a level (0–5), 5 renders as MAX', () => {
  assert.equal(setLevelLabel(0), '0');
  assert.equal(setLevelLabel(1), '1');
  assert.equal(setLevelLabel(4), '4');
  assert.equal(setLevelLabel(5), 'MAX');
  // Clamped/overshoot input (should never happen, but the label must not lie).
  assert.equal(setLevelLabel(6), 'MAX');
});

test('setLevelFromCounts never exceeds MAX (5) regardless of a malformed owned > total', () => {
  assert.equal(setLevelFromCounts(2500, 2000), 5);
});
