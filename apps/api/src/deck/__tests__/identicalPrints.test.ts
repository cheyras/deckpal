import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canSatisfyByEquivalentPrint, identicalPrintGroup } from '../identicalPrints.js';

test('ordinary cards share only a non-null gameplay fingerprint', () => {
  const fp = 'a'.repeat(64);
  assert.equal(identicalPrintGroup(fp, false), fp);
  assert.equal(identicalPrintGroup(null, false), null);
});

test('promo-set cards never enter ordinary identical-print groups', () => {
  assert.equal(identicalPrintGroup('a'.repeat(64), true), null);
});

test('un-pinned equivalent ordinary printing can satisfy a deck slot', () => {
  assert.equal(canSatisfyByEquivalentPrint({
    pinnedExact: false, exactVariant: false, ownedVariantStamped: false,
    ownedCardPromo: false, targetCardPromo: false, sameGameplayGroup: true,
  }), true);
});

test('stamped and promo alternatives stay distinct from ordinary slots', () => {
  const common = {
    pinnedExact: false, exactVariant: false, targetCardPromo: false, sameGameplayGroup: true,
  };
  assert.equal(canSatisfyByEquivalentPrint({ ...common, ownedVariantStamped: true, ownedCardPromo: false }), false);
  assert.equal(canSatisfyByEquivalentPrint({ ...common, ownedVariantStamped: false, ownedCardPromo: true }), false);
  assert.equal(canSatisfyByEquivalentPrint({ ...common, ownedVariantStamped: false, ownedCardPromo: false, targetCardPromo: true }), false);
});

test('exact pin accepts only the selected variant', () => {
  const base = {
    pinnedExact: true, ownedVariantStamped: false, ownedCardPromo: false,
    targetCardPromo: false, sameGameplayGroup: true,
  };
  assert.equal(canSatisfyByEquivalentPrint({ ...base, exactVariant: true }), true);
  assert.equal(canSatisfyByEquivalentPrint({ ...base, exactVariant: false }), false);
});
