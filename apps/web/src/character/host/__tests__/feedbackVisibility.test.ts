import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ReplyFeedback, TranscriptFeedback } from '../chat/Feedback'

const save = async () => undefined

test('a finished latest reply is rateable while approval is pending', () => {
  const html = renderToStaticMarkup(createElement(ReplyFeedback, {
    seq: 4, busy: true, latest: true, approvalPending: true, onSave: save,
  }))
  assert.match(html, /aria-label="Good reply"/)
  assert.match(html, /aria-label="Bad reply"/)
})

test('a synthetic reply without a seq has no feedback control', () => {
  const html = renderToStaticMarkup(createElement(ReplyFeedback, {
    busy: false, latest: true, approvalPending: false, onSave: save,
  }))
  assert.equal(html, '')
})

test('History renders the same control with the saved vote selected', () => {
  const html = renderToStaticMarkup(createElement(TranscriptFeedback, {
    conversationId: 'conversation-1', seq: 2, initialVote: 1, onSave: async () => undefined,
  }))
  assert.match(html, /aria-label="Good reply"/)
  assert.match(html, /aria-label="Good reply" aria-pressed="true"/)
  assert.match(html, /aria-label="Bad reply" aria-pressed="false"/)
})
