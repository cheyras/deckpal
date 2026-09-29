import assert from 'node:assert/strict'
import test from 'node:test'
import { shareChoiceReducer, shareChoiceValue } from '../ShareChoice.js'
import { improvementConsentRequest, submitImprovementConsent } from '../improvementConsent.js'

test('a share choice can only be answered once', () => {
  let state = shareChoiceReducer('open', { type: 'choose', share: true })
  assert.equal(state, 'sharing')
  assert.equal(shareChoiceReducer(state, { type: 'choose', share: false }), 'sharing')
  state = shareChoiceReducer(state, { type: 'settled', share: true })
  assert.equal(state, 'shared')
  assert.equal(shareChoiceReducer(state, { type: 'choose', share: false }), 'shared')
})

test('sharing all chats follows the same one-answer guard', () => {
  let state = shareChoiceReducer('open', { type: 'choose', share: true })
  assert.equal(state, 'sharing')
  state = shareChoiceReducer(state, { type: 'settled', share: true })
  assert.equal(state, 'shared')
  assert.equal(shareChoiceReducer(state, { type: 'choose', share: true }), 'shared')
})

test('the Share all choice reaches the consent request and refreshes Profile settings', async () => {
  const sent: unknown[] = []
  let refreshes = 0
  const [share, shareAll] = shareChoiceValue('all')
  await submitImprovementConsent({
    conversationId: 'conversation',
    share,
    shareAll,
    send: async (request) => { sent.push(request) },
    refreshSettings: async () => { refreshes++ },
  })
  assert.deepEqual(sent, [{ conversationId: 'conversation', share: true, shareAll: true, source: 'decke_ask' }])
  assert.equal(refreshes, 1)
})

test('the consent request never sends the route-invalid shareAll false combination', () => {
  assert.deepEqual(improvementConsentRequest('conversation', true, false), {
    conversationId: 'conversation', share: true, source: 'decke_ask',
  })
  assert.deepEqual(improvementConsentRequest('conversation', false, true), {
    conversationId: 'conversation', share: false, source: 'decke_ask',
  })
})
