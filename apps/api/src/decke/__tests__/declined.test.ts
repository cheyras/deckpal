import assert from 'node:assert/strict'
import { test } from 'node:test'
import { alreadyDeclinedMessage, declinedCalls, researchRanInConversation } from '../declined.js'
import { callKey } from '../repeat.js'

const denied = (name: string, input: unknown, reason = 'the reader declined') => ({
  type: `tool-${name}`,
  toolCallId: `call-${name}`,
  input,
  state: 'output-denied',
  approval: { id: `approval-${name}`, approved: false, reason },
})
const msg = (parts: unknown[]) => ({ role: 'assistant', parts })

test('an exact declined write survives later turns; different arguments remain askable', () => {
  const original = { deck_id: 'd1', markdown: '# First' }
  const declined = declinedCalls([
    msg([denied('deck_strategy', original)]),
    { role: 'user', parts: [{ type: 'text', text: 'Let us discuss the matchup instead.' }] },
    msg([{ type: 'text', text: 'Sure.' }]),
    { role: 'user', parts: [{ type: 'text', text: 'Now update it.' }] },
  ])
  assert.ok(declined.has(callKey('deck_strategy', original)))
  assert.ok(!declined.has(callKey('deck_strategy', { deck_id: 'd1', markdown: '# Different' })))
})

test('argument order cannot bypass an exact decline', () => {
  const declined = declinedCalls([msg([denied('save_deck', { name: 'Mill', format: 'standard' })])])
  assert.ok(declined.has(callKey('save_deck', { format: 'standard', name: 'Mill' })))
})

test('approved, abandoned and non-tool parts are not declines', () => {
  const approved = { ...denied('deck_strategy', { deck_id: 'd1' }), state: 'output-available', approval: { id: 'a', approved: true } }
  const declined = declinedCalls([
    msg([
      approved,
      denied('save_deck', { name: 'x' }, 'the reader did not answer'),
      { type: 'text', text: 'no', approval: { approved: false }, input: {} },
    ]),
  ])
  assert.equal(declined.size, 0)
})

test('no research call is suppressed unless that exact call was declined', () => {
  const old = { query: 'Dragapult', topic: 'competitive', purpose: 'Dragapult results' }
  const next = { query: 'Gardevoir', topic: 'competitive', purpose: 'Gardevoir results' }
  const declined = declinedCalls([msg([denied('web_research', old)])])
  assert.ok(declined.has(callKey('web_research', old)))
  assert.ok(!declined.has(callKey('web_research', next)))
})

test('spoken refusals are not inferred from reader prose', () => {
  const declined = declinedCalls([
    { role: 'user', parts: [{ type: 'text', text: 'stop researching and do not save a guide' }] },
  ])
  assert.equal(declined.size, 0)
})

test('research provenance recognises current and legacy replayed output parts', () => {
  const available = (name: string) => msg([{ type: `tool-${name}`, state: 'output-available', input: {}, output: 'findings' }])
  assert.equal(researchRanInConversation([available('web_research')]), true)
  assert.equal(researchRanInConversation([available('research_meta')]), true)
  assert.equal(researchRanInConversation([available('get_card')]), false)
  assert.equal(researchRanInConversation([msg([denied('web_research', {})])]), false)
})

test('the refusal message is exact, factual and asks for no redo', () => {
  const message = alreadyDeclinedMessage('deck_strategy')
  assert.match(message, /^\[\[NO_WORK\]\]/)
  assert.match(message, /exact deck_strategy change/)
  assert.match(message, /nothing changed/i)
  assert.match(message, /Do not ask again for the same change/)
  assert.match(message, /Carry on with what they said next/)
  assert.doesNotMatch(message, /research|guide|different arguments|work around/i)
})

test('malformed history is ignored', () => {
  for (const value of [null, undefined, 'nope', {}, { parts: 'bad' }]) {
    assert.doesNotThrow(() => declinedCalls(value))
    assert.equal(declinedCalls(value).size, 0)
  }
})
