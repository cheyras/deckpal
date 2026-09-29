import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DECK_COMPACT_CARDS, deckDisclosure, deckHeader, nextSaveState, ownershipMark, visibleIssues } from '../deckWidgetState'

test('deck disclosure uses the real total and expands every section', () => {
  const sections = [
    { cards: Array.from({ length: 20 }) },
    { cards: Array.from({ length: 30 }) },
    { cards: Array.from({ length: 10 }) },
  ]
  assert.deepEqual(deckDisclosure(sections, 60, false), {
    compactable: true,
    compact: true,
    sectionLimit: 1,
    cardLimit: DECK_COMPACT_CARDS,
    label: 'Show all 60 cards',
  })
  assert.deepEqual(deckDisclosure(sections, 60, true), {
    compactable: true,
    compact: false,
    sectionLimit: 3,
    cardLimit: Number.POSITIVE_INFINITY,
    label: 'Show less',
  })
})

test('deck header makes legality, count and missing cost readable', () => {
  assert.deepEqual(deckHeader({ total: 60, legal: true, owned: 41, missingCostUsd: 12.4 }), {
    count: '60/60', countTone: 'good', legality: 'Legal', legalityTone: 'good', ownership: 'You own 41/60 · ~$12.40 to finish',
  })
  assert.equal(deckHeader({ total: 57, legal: false, owned: 20, missingCostUsd: null }).legality, 'Not legal')
  assert.equal(deckHeader({ total: 60, legal: null, owned: 60, missingCostUsd: null }).legality, 'Unchecked')
  assert.equal(deckHeader({ total: 57, legal: false, owned: 20, missingCostUsd: null }).countTone, 'warn')
})

test('ownership marks distinguish complete, partial and missing lines', () => {
  assert.deepEqual(ownershipMark(4, 4), { kind: 'owned', text: '✓', label: 'owned' })
  assert.deepEqual(ownershipMark(2, 4), { kind: 'partial', text: '2/4', label: '2 of 4 owned' })
  assert.deepEqual(ownershipMark(0, 2), { kind: 'missing', text: 'need 2', label: 'missing' })
})

test('issues show the first three until opened', () => {
  assert.deepEqual(visibleIssues(['one', 'two', 'three', 'four']), { visible: ['one', 'two', 'three'], hidden: 1 })
  assert.deepEqual(visibleIssues(['one']), { visible: ['one'], hidden: 0 })
})

test('save state ignores a double-tap and returns to idle after an error', () => {
  assert.equal(nextSaveState('idle', 'start'), 'saving')
  assert.equal(nextSaveState('saving', 'start'), 'saving')
  assert.equal(nextSaveState('saving', 'failure'), 'error')
  assert.equal(nextSaveState('error', 'retry'), 'idle')
  assert.equal(nextSaveState('saving', 'success'), 'saved')
  assert.equal(nextSaveState('saved', 'start'), 'saved')
})
