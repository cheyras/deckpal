import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { decimalCreditCount, formatCreditDecimal, meteredPolicyValid, parseCreditHeader, walletViewModel } from '../creditMath'

test('credit decimals show no invented precision or trailing zeroes', () => {
  assert.equal(formatCreditDecimal(0), '0')
  assert.equal(formatCreditDecimal(0.0001), '0.0001')
  assert.equal(formatCreditDecimal(12.5), '12.5')
  assert.equal(formatCreditDecimal(1234.56789), '1234.5679')
  assert.equal(decimalCreditCount(-0.125), '-0.125 credits')
})

test('credit headers accept decimal balances but retain charging-off sentinel semantics', () => {
  assert.equal(parseCreditHeader('0.0001'), 0.0001)
  assert.equal(parseCreditHeader('-1'), -1)
  assert.equal(parseCreditHeader(' 12.5 '), 12.5)
  assert.equal(parseCreditHeader('1e3'), null)
  assert.equal(parseCreditHeader('not-a-number'), null)
})

test('wallet view model keeps flat prices and gives metered holds their actual-cost explanation', () => {
  assert.deepEqual(walletViewModel({ mode: 'flat' }), { mode: 'flat', usageTitle: 'Usage prices', usageDetail: '', heldDetail: null })
  const metered = walletViewModel({ mode: 'metered', holdCredits: 25, heldCredits: 0.125 })
  assert.match(metered.usageDetail, /actually costs/)
  assert.match(metered.usageDetail, /25 credits/)
  assert.equal(metered.heldDetail, '0.125 credits currently set aside for an active reply.')
})

test('metered admin policy requires a whole-credit minimum no larger than its hold', () => {
  const valid = { legHoldCredits: '25', legHoldMinCredits: '3', denomination: '0.01', markup: '25', lowBalance: '5' }
  assert.equal(meteredPolicyValid(valid), true)
  assert.equal(meteredPolicyValid({ ...valid, legHoldMinCredits: '0' }), false)
  assert.equal(meteredPolicyValid({ ...valid, legHoldMinCredits: '26' }), false)
  assert.equal(meteredPolicyValid({ ...valid, legHoldCredits: '10001' }), false)
})
