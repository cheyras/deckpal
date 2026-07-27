import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  trainerLevel,
  trainerLevelProgress,
  setLevel,
  setLevelFromCounts,
  setLevelLabel,
  pct,
} from '../trainerLevel.js';

// ── Trainer Level: floor(unique / 10), level-0 start (AUTH-CAPTURES §13) ────────
test('trainerLevel — 276 unique → level 27 (the proven data point)', () => {
  assert.equal(trainerLevel(276), 27); // NOT 28 (1+floor) and NOT floor(677/10)=67
});

test('trainerLevel — boundaries and empties', () => {
  assert.equal(trainerLevel(0), 0);
  assert.equal(trainerLevel(4), 0); // the current live collection
  assert.equal(trainerLevel(9), 0);
  assert.equal(trainerLevel(10), 1);
  assert.equal(trainerLevel(19), 1);
  assert.equal(trainerLevel(20), 2);
  assert.equal(trainerLevel(-5), 0);
});

test('trainerLevelProgress — 276 → L27, 6 into level, 4 to next, ring 0.6', () => {
  const p = trainerLevelProgress(276);
  assert.equal(p.level, 27);
  assert.equal(p.intoLevel, 6); // 276 mod 10
  assert.equal(p.toNext, 4);
  assert.equal(p.nextLevelAt, 280);
  assert.equal(p.fraction, 0.6);
});

test('trainerLevelProgress — exact boundary (30 → L3, freshly leveled)', () => {
  const p = trainerLevelProgress(30);
  assert.equal(p.level, 3);
  assert.equal(p.intoLevel, 0);
  assert.equal(p.toNext, 10);
  assert.equal(p.fraction, 0);
});

// ── set LVL from percentage: 0 if 0 else 1+floor(pct/25) (AUTH-CAPTURES §10) ────
test('setLevel — the six authenticated (pct → LVL) data points', () => {
  assert.equal(setLevel(0), 0); // Perfect Order 0/124
  assert.equal(setLevel(6.4), 1); // Mega Evolution 12/188
  assert.equal(setLevel(14.2), 1); // Pitch Black 17/120
  assert.equal(setLevel(22.3), 1); // Base Set 2 29/130
  assert.equal(setLevel(26.2), 2); // Chaos Rising 32/122
  assert.equal(setLevel(62.5), 3); // ME: Energy 5/8
});

test('setLevel — prior data points and band edges', () => {
  assert.equal(setLevel(0.3), 1);
  assert.equal(setLevel(2.5), 1);
  assert.equal(setLevel(20.8), 1);
  assert.equal(setLevel(25), 2); // exactly at a milestone dot → next band
  assert.equal(setLevel(50), 3);
  assert.equal(setLevel(75), 4);
  assert.equal(setLevel(100), 5); // Max
  assert.equal(setLevel(100.0001), 5); // clamped, never 6
});

// ── set LVL straight from counts (mirrors the DB generated column) ─────────────
test('setLevelFromCounts — agrees with setLevel(pct(owned,total)) on AUTH points', () => {
  assert.equal(setLevelFromCounts(0, 124), 0);
  assert.equal(setLevelFromCounts(12, 188), 1);
  assert.equal(setLevelFromCounts(17, 120), 1);
  assert.equal(setLevelFromCounts(29, 130), 1);
  assert.equal(setLevelFromCounts(32, 122), 2);
  assert.equal(setLevelFromCounts(5, 8), 3);
  assert.equal(setLevelFromCounts(124, 124), 5); // 100% → Max
  assert.equal(setLevelFromCounts(0, 0), 0);
});

test('setLevelLabel — 5 is Max, others numeric', () => {
  assert.equal(setLevelLabel(0), '0');
  assert.equal(setLevelLabel(3), '3');
  assert.equal(setLevelLabel(5), 'Max');
});

test('pct — one-decimal round-half-up, matches pkmn.gg rendering', () => {
  assert.equal(pct(12, 188), 6.4);
  assert.equal(pct(17, 120), 14.2);
  assert.equal(pct(29, 130), 22.3);
  assert.equal(pct(32, 122), 26.2);
  assert.equal(pct(5, 8), 62.5);
  assert.equal(pct(0, 100), 0);
  assert.equal(pct(5, 0), 0);
});
