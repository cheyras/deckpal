import { test } from 'node:test'
import assert from 'node:assert/strict'

import type { Quad } from '../../engine/contract'
import { suggestionRecord } from '../suggestion'
import type { QuadSuggestion } from '../types'

const corners: Quad = [[0.3, 0.2], [0.7, 0.2], [0.7, 0.8], [0.3, 0.8]]
const card: QuadSuggestion = {
  v: 1,
  id: 1790219626883,
  by: 'agent:claude-sonnet-5.5+lc050',
  createdAt: '2026-11-26T08:00:00.000Z',
  verdict: 'card',
  crop: null,
  corners,
  topLeftIndex: 0,
  confidence: 'high',
}

test('no suggestion, no record', () => {
  assert.equal(suggestionRecord(null, { corners, topLeftIndex: 0, face: 'front' }), undefined)
})

test('saving the suggestion unchanged is agreement', () => {
  const r = suggestionRecord(card, { corners, topLeftIndex: 0, face: 'front' })
  assert.deepEqual(r, { by: card.by, verdict: 'card', confidence: 'high', agreed: true })
})

test('a nudged corner, a moved top-left, a flipped face or another verdict is not', () => {
  const nudged = corners.map(([x, y], i) => (i === 2 ? [x + 3 / 416, y] : [x, y])) as Quad
  assert.equal(suggestionRecord(card, { corners: nudged, topLeftIndex: 0, face: 'front' })?.agreed, false)
  assert.equal(suggestionRecord(card, { corners, topLeftIndex: 1, face: 'front' })?.agreed, false)
  assert.equal(suggestionRecord(card, { corners, topLeftIndex: 0, face: 'back' })?.agreed, false)
  assert.equal(suggestionRecord(card, { invalidReason: 'too_blurry' })?.agreed, false)
})

test('a rejection agrees only with the same reason', () => {
  const reject: QuadSuggestion = { ...card, verdict: 'reject', invalidReason: 'multiple_no_clear_foreground', corners: undefined }
  assert.equal(suggestionRecord(reject, { invalidReason: 'multiple_no_clear_foreground' })?.agreed, true)
  assert.equal(suggestionRecord(reject, { invalidReason: 'not_a_card' })?.agreed, false)
  assert.equal(suggestionRecord(reject, { corners, topLeftIndex: 0, face: 'front' })?.agreed, false)
})
