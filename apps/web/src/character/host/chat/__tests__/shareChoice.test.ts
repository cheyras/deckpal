import assert from 'node:assert/strict'
import test from 'node:test'
import { shareChoiceReducer } from '../ShareChoice.js'

test('a share choice can only be answered once', () => {
  let state = shareChoiceReducer('open', { type: 'choose', share: true })
  assert.equal(state, 'sharing')
  assert.equal(shareChoiceReducer(state, { type: 'choose', share: false }), 'sharing')
  state = shareChoiceReducer(state, { type: 'settled', share: true })
  assert.equal(state, 'shared')
  assert.equal(shareChoiceReducer(state, { type: 'choose', share: false }), 'shared')
})
