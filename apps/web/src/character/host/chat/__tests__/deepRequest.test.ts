/** The old paid sub-agent approval block is absent from write confirmations. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEEP_COST_NOTE, deepCost, deepCostLine, deepRequestLine, isShort } from '../deepRequest'

test('no tool receives the retired deep-request restatement', () => {
  assert.equal(deepRequestLine('web_research', { purpose: 'Dragapult results' }), null)
  assert.equal(deepRequestLine('deck_strategy', { deck_id: 'deck-9' }), null)
  assert.equal(deepRequestLine('log_cards', { items: [] }), null)
})

test('no approval receives a deep price quote', () => {
  const quote = { analysis: 4, planDeck: 75, chatTurn: 1, balance: 100 }
  assert.equal(deepCost('web_research', quote), null)
  assert.equal(deepCost('deck_strategy', quote), null)
  assert.equal(deepCost('log_cards', quote), null)
})

test('legacy card helpers remain safe while the presentation import exists', () => {
  assert.equal(deepCostLine(null), DEEP_COST_NOTE)
  assert.equal(deepCostLine({ credits: 4, balance: 2 }), 'This needs 4 credits and you have 2.')
  assert.equal(isShort({ credits: 4, balance: 2 }), true)
  assert.equal(isShort(null), false)
})
