/** The old paid sub-agent approval block is absent from write confirmations. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEEP_COST_NOTE, deepCost, deepCostLine, deepRequestLine, isShort } from '../deepRequest'

test('the compatibility helper never restates approval input', () => {
  assert.equal(deepRequestLine('web_research', { purpose: 'Dragapult results' }), null)
  assert.equal(deepRequestLine('deep_think', { why: 'A season review', plan: 'Compare games' }), null)
  assert.equal(deepRequestLine('log_cards', { items: [] }), null)
})

test('wallet quote compatibility never invents a Deep Think estimate', () => {
  const quote = { balance: 100 }
  assert.equal(deepCost('web_research', quote), null)
  assert.equal(deepCost('deep_think', quote), null)
  assert.equal(deepCost('log_cards', quote), null)
})

test('legacy card helpers remain safe while the presentation import exists', () => {
  assert.equal(deepCostLine(null), DEEP_COST_NOTE)
  assert.equal(deepCostLine({ credits: 4, balance: 2 }), 'This needs 4 credits and you have 2.')
  assert.equal(isShort({ credits: 4, balance: 2 }), true)
  assert.equal(isShort(null), false)
})
