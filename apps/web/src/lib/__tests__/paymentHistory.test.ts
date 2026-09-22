import assert from 'node:assert/strict'
import { test } from 'node:test'
import { formatMinorAmount, paymentStatusText } from '../paymentHistory.js'

test('formats currency minor units using the currency exponent', () => {
  assert.equal(formatMinorAmount(1234, 'USD', 'en-US'), '$12.34')
  assert.equal(formatMinorAmount(1234, 'JPY', 'en-US'), '¥1,234')
})
test('applies Stripe ISK and UGX API scaling without discarding defensive fractions', () => {
  for (const currency of ['ISK', 'UGX']) {
    const whole = formatMinorAmount(500, currency, 'en-US')
    const fractional = formatMinorAmount(1234, currency, 'en-US')
    assert.match(whole, /5/)
    assert.doesNotMatch(whole, /500/)
    assert.match(fractional, /12\.34/)
    assert.doesNotMatch(fractional, /1,234/)
  }
})
test('unknown and invalid currencies fall back without throwing', () => {
  assert.doesNotThrow(() => formatMinorAmount(500, 'NOPE'))
  assert.match(formatMinorAmount(500, 'NOPE'), /currency units/)
  assert.match(formatMinorAmount(500, 'XXX'), /XXX/)
})
test('status copy distinguishes settlement from authorization and attempts', () => {
  assert.equal(paymentStatusText({ status: 'authorized', refundedMinor: 0, disputed: false }), 'Authorized, not captured')
  assert.equal(paymentStatusText({ status: 'failed', refundedMinor: 0, disputed: false }), 'Failed attempt')
  assert.equal(paymentStatusText({ status: 'paid', refundedMinor: 200, disputed: true }), 'Paid · 200 refunded · Disputed')
})
