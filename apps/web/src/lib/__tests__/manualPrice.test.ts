import assert from 'node:assert/strict'
import test from 'node:test'

import { formatMinor, priceAge } from '../manualPrice'

test('formats JPY without decimals and USD from cents', () => {
  assert.match(formatMinor(1200, 'JPY', 'en-US'), /¥1,200/)
  assert.equal(formatMinor(1299, 'USD', 'en-US'), '$12.99')
})

test('classifies manual price age', () => {
  const today = new Date('2026-08-31T12:00:00Z')
  assert.equal(priceAge('2026-08-24', today).state, 'fresh')
  assert.equal(priceAge('2026-08-15', today).state, 'aging')
  assert.equal(priceAge('2026-07-01', today).state, 'stale')
})
