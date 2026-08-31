import assert from 'node:assert/strict'
import test from 'node:test'

import { familyPriceInputSchema } from '../../routes/familyPrices.js'

const valid = {
  cardVariantId: 42,
  amountMinor: 1200,
  currencyCode: 'jpy',
  sourceName: 'Cardrush',
  sourceUrl: 'https://example.test/card/42',
  condition: 'NM',
  observedOn: '2026-08-31',
}

test('manual price input normalises currency and keeps integer minor units', () => {
  const parsed = familyPriceInputSchema.parse(valid)
  assert.equal(parsed.currencyCode, 'JPY')
  assert.equal(parsed.amountMinor, 1200)
})

test('manual price input rejects zero, decimals, invalid URLs and conditions', () => {
  assert.equal(familyPriceInputSchema.safeParse({ ...valid, amountMinor: 0 }).success, false)
  assert.equal(familyPriceInputSchema.safeParse({ ...valid, amountMinor: 12.5 }).success, false)
  assert.equal(familyPriceInputSchema.safeParse({ ...valid, sourceUrl: 'not a url' }).success, false)
  assert.equal(familyPriceInputSchema.safeParse({ ...valid, condition: 'Mint-ish' }).success, false)
})

test('manual price sources accept only web URLs', () => {
  assert.equal(familyPriceInputSchema.safeParse({ ...valid, sourceUrl: 'javascript:alert(1)' }).success, false)
  assert.equal(familyPriceInputSchema.safeParse({ ...valid, sourceUrl: 'data:text/html,unsafe' }).success, false)
  assert.equal(familyPriceInputSchema.safeParse({ ...valid, sourceUrl: 'http://example.test/card/42' }).success, true)
})
