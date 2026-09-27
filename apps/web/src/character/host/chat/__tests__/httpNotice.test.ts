/**
 * What a refused turn says, and the one thing it offers to press (UXD-08).
 *
 * Measured before: a 500 said "Try that again in a moment" with no way to; a 429
 * said "Top up" with no Top up; a wallet on payment hold was told to top up on a
 * page where purchases are on hold.
 */
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { httpNotice } from '../httpNotice'

test('a server fault is an error with a retry, and says nothing was written', () => {
  for (const status of [500, 502, 504]) {
    const n = httpNotice(status, null)
    assert.equal(n.tone, 'error')
    assert.equal(n.action, 'retry')
    assert.match(n.detail ?? '', /Nothing was written/)
  }
})

test('out of credits names the price and the balance, and offers the top-up', () => {
  const n = httpNotice(429, { error: 'Out of AI credits.', retryAfterDay: false, credits: { balance: 0, needed: 1, held: false } })
  assert.equal(n.tone, 'limit')
  assert.equal(n.action, 'top-up')
  assert.equal(n.detail, 'A reply takes 1 credit and you have 0.')
})

test('a HELD wallet is sent to the wallet, never to a top-up', () => {
  // Held can be true with a short balance too (debt), so the flag decides —
  // not whether the balance covers the price.
  for (const credits of [{ balance: 40, needed: 1, held: true }, { balance: 0, needed: 1, held: true }]) {
    const n = httpNotice(429, { error: 'AI credits are on hold…', retryAfterDay: false, credits })
    assert.equal(n.action, 'wallet')
    assert.doesNotMatch(`${n.title} ${n.detail}`, /top up/i)
  }
})

test('the legacy daily cap offers nothing to buy', () => {
  const n = httpNotice(429, { error: "You've used today's questions.", retryAfterDay: true })
  assert.equal(n.tone, 'limit')
  assert.equal(n.action, undefined)
  assert.match(n.detail ?? '', /tomorrow/)
})

test('a 429 with an unreadable body still offers the top-up, without inventing numbers', () => {
  for (const body of [null, {}, { credits: { balance: 'x', needed: -1 } }, { credits: null }]) {
    const n = httpNotice(429, body as never)
    assert.equal(n.action, 'top-up')
    assert.doesNotMatch(n.detail ?? '', /\d/)
  }
})

test('refusals with no way forward offer none', () => {
  for (const status of [401, 403, 413, 503]) {
    assert.equal(httpNotice(status, null).action, undefined, String(status))
    assert.equal(httpNotice(status, null).tone, 'neutral', String(status))
  }
})
