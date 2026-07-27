import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32, expandLibrary, drawOpeningHand, simulateMulliganRate, hypergeometricMulligan } from '../testhand.js';
import { mkCard } from './fixtures.js';

function library(basicCount: number) {
  const basic = mkCard({ name: 'Basic Mon', category: 'Pokemon', stage: 'Basic', hp: 60, types: ['Colorless'] });
  const filler = mkCard({ name: 'Fire Energy', category: 'Energy', energyType: 'Normal' });
  return expandLibrary([
    { card: basic, quantity: basicCount },
    { card: filler, quantity: 60 - basicCount },
  ]);
}

test('hypergeometric matches the textbook formula', () => {
  // P(no basic in 7) for 12 basics in 60 = ∏(48-i)/(60-i), i=0..6 ≈ 0.1906
  assert.ok(Math.abs(hypergeometricMulligan(60, 12) - 0.19065) < 0.001);
  assert.equal(hypergeometricMulligan(60, 0), 1);      // no basics -> always mulligan
  assert.equal(hypergeometricMulligan(60, 60), 0);     // all basics -> never
});

test('simulated mulligan rate converges to the hypergeometric expectation (10k seeded draws)', () => {
  for (const b of [8, 12, 16]) {
    const stats = simulateMulliganRate(library(b), 10_000, mulberry32(0xC0FFEE + b));
    assert.ok(
      Math.abs(stats.mulliganRate - stats.hypergeometric) < 0.02,
      `B=${b}: sim ${stats.mulliganRate.toFixed(4)} vs hyper ${stats.hypergeometric.toFixed(4)}`,
    );
  }
});

test('drawOpeningHand always keeps a hand with a Basic (unless impossible) and deals 6 prizes', () => {
  const rng = mulberry32(42);
  const res = drawOpeningHand(library(12), rng);
  assert.equal(res.hand.length, 7);
  assert.equal(res.prizes.length, 6);
  assert.ok(res.hand.some((c) => c.isBasicPokemon), 'kept hand has a Basic');
});

test('determinism: same seed -> same result', () => {
  const a = simulateMulliganRate(library(10), 2000, mulberry32(7));
  const b = simulateMulliganRate(library(10), 2000, mulberry32(7));
  assert.equal(a.mulliganHands, b.mulliganHands);
});

test('a no-basic deck mulligans out to the 8-cap', () => {
  const res = drawOpeningHand(library(0), mulberry32(1));
  assert.equal(res.mulligans, 8);
});
