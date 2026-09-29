import assert from 'node:assert/strict'
import test from 'node:test'
import { feedbackReducer, initialFeedbackState } from '../feedbackState.js'

test('a vote opens feedback and pressing it again clears the vote', () => {
  const voted = feedbackReducer(initialFeedbackState(), { type: 'vote', vote: 1 })
  assert.equal(voted.vote, 1)
  assert.equal(voted.open, true)
  assert.deepEqual(feedbackReducer(voted, { type: 'vote', vote: 1 }), initialFeedbackState())
})

test('comment is bounded and sharing starts unticked', () => {
  let state = feedbackReducer(initialFeedbackState(), { type: 'vote', vote: -1 })
  assert.equal(state.share, false)
  state = feedbackReducer(state, { type: 'comment', comment: 'x'.repeat(600) })
  state = feedbackReducer(state, { type: 'share', share: true })
  assert.equal(state.comment.length, 500)
  assert.equal(state.share, true)
})

test('a failed optimistic save restores the exact editable state', () => {
  let state = feedbackReducer(initialFeedbackState(), { type: 'vote', vote: 1 })
  state = feedbackReducer(state, { type: 'comment', comment: 'Useful detail' })
  state = feedbackReducer(state, { type: 'share', share: true })
  const previous = state
  const saving = feedbackReducer(state, { type: 'saving' })
  assert.equal(saving.thanked, true)
  const reverted = feedbackReducer(saving, { type: 'failed', previous })
  assert.equal(reverted.vote, 1)
  assert.equal(reverted.comment, 'Useful detail')
  assert.equal(reverted.share, true)
  assert.equal(reverted.open, true)
  assert.ok(reverted.error)
})
