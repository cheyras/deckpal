import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DEEP_HOLD_MULTIPLIER,
  DEEP_THINK_TOOL,
  deepApprovedThisTurn,
  estimateCredits,
} from '../deepThink.js'

const user = (text: string) => ({ role: 'user', parts: [{ type: 'text', text }] })
const deep = (state: string, approval?: { approved: boolean }) => ({
  role: 'assistant',
  parts: [{
    type: `tool-${DEEP_THINK_TOOL}`,
    toolCallId: 'deep-1',
    input: { why: 'Worth a real matchup read.', plan: 'Replay the turns and compare lines.' },
    state,
    ...(approval ? { approval: { id: 'approval-1', ...approval } } : {}),
  }],
})

test('only an approved Deep Think replay after the latest user message routes deep', () => {
  assert.equal(deepApprovedThisTurn([
    user('Review my season'),
    deep('approval-responded', { approved: true }),
  ]), true)
  assert.equal(deepApprovedThisTurn([
    user('Review my season'),
    deep('output-available', { approved: true }),
  ]), true)
})

test('declines, other tools and unapproved output do not count', () => {
  assert.equal(deepApprovedThisTurn([
    user('Review my season'),
    deep('approval-responded', { approved: false }),
  ]), false)
  assert.equal(deepApprovedThisTurn([
    user('Review my season'),
    { role: 'assistant', parts: [{ type: 'tool-save_deck', state: 'approval-responded', approval: { approved: true } }] },
  ]), false)
  assert.equal(deepApprovedThisTurn([
    user('Review my season'),
    deep('output-available'),
  ]), false)
})

test('an approval from a previous turn does not keep later turns on Deep Think', () => {
  assert.equal(deepApprovedThisTurn([
    user('Review my season'),
    deep('output-available', { approved: true }),
    user('Thanks — what is this card worth?'),
    { role: 'assistant', parts: [{ type: 'tool-get_card', state: 'output-available' }] },
  ]), false)
  assert.equal(deepApprovedThisTurn(null), false)
  assert.equal(deepApprovedThisTurn([{ role: 'assistant', parts: [] }]), false)
})

test('credit estimates are server-owned pathway bands and mixed work uses the larger band', () => {
  assert.deepEqual(estimateCredits(['battle_log']), { low: 40, high: 120 })
  assert.deepEqual(estimateCredits(['battle_review']), { low: 40, high: 120 })
  assert.deepEqual(estimateCredits(['deck_build']), { low: 60, high: 180 })
  assert.deepEqual(estimateCredits(['battle_review', 'deck_build']), { low: 60, high: 180 })
  assert.deepEqual(estimateCredits([]), { low: 40, high: 120 })
  assert.equal(DEEP_HOLD_MULTIPLIER, 8)
})
