import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateValue, type OwnedPriceRow } from '../collectionValue.js';

// ── value math: Σ qty × best price, per currency, currencies never mixed ────────
test('aggregateValue — sums qty × bestMinor within a currency', () => {
  const rows: OwnedPriceRow[] = [
    { currency: 'USD', qty: 2, bestMinor: 80043 }, // 2 × $800.43
    { currency: 'USD', qty: 1, bestMinor: 12000 }, // 1 × $120.00
  ];
  const [usd] = aggregateValue(rows);
  assert.equal(usd!.currency, 'USD');
  assert.equal(usd!.totalMinor, 2 * 80043 + 12000); // 172086
  assert.equal(usd!.total, 1720.86); // major units, 2 dp
  assert.equal(usd!.pricedVariants, 2);
  assert.equal(usd!.quantity, 3);
});

test('aggregateValue — USD and EUR stay separate rows, not summed', () => {
  const rows: OwnedPriceRow[] = [
    { currency: 'USD', qty: 1, bestMinor: 10000 },
    { currency: 'EUR', qty: 1, bestMinor: 9000 },
  ];
  const out = aggregateValue(rows);
  assert.equal(out.length, 2);
  const usd = out.find((r) => r.currency === 'USD')!;
  const eur = out.find((r) => r.currency === 'EUR')!;
  assert.equal(usd.total, 100.0);
  assert.equal(eur.total, 90.0);
});

test('aggregateValue — JPY has zero minor digits (÷1, not ÷100)', () => {
  const [jpy] = aggregateValue([{ currency: 'JPY', qty: 1, bestMinor: 5000 }]);
  assert.equal(jpy!.total, 5000); // ¥5000, not ¥50.00
});

test('aggregateValue — empty collection → no rows', () => {
  assert.deepEqual(aggregateValue([]), []);
});

test('aggregateValue — case/whitespace-normalised currency', () => {
  const out = aggregateValue([
    { currency: 'usd', qty: 1, bestMinor: 100 },
    { currency: ' USD ', qty: 1, bestMinor: 100 },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.currency, 'USD');
  assert.equal(out[0]!.totalMinor, 200);
});
