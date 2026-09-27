/**
 * The import dialog's Edit button selects an unmatched line in the pasted text,
 * so the reader lands on exactly the characters to fix.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { decklistLineRange, reconcileDecklistLineIds } from '../decklistLines'

const LIST = 'Pokémon: 2\n  2 Latias ex SSP 76  \n4 Dreepy TWM 128\r\n2 Latias ex SSP 76\n'

test('selects the line itself, not the indentation around it', () => {
  const [start, end] = decklistLineRange(LIST, '2 Latias ex SSP 76')!
  assert.equal(LIST.slice(start, end), '2 Latias ex SSP 76')
  assert.equal(start, LIST.indexOf('2 Latias'), 'the first occurrence')
})

test('survives Windows line endings', () => {
  const [start, end] = decklistLineRange(LIST, '4 Dreepy TWM 128')!
  assert.equal(LIST.slice(start, end), '4 Dreepy TWM 128')
})

test('selects the requested physical occurrence when identical lines repeat', () => {
  const [start, end] = decklistLineRange(LIST, '2 Latias ex SSP 76', 3)!
  assert.equal(LIST.slice(start, end), '2 Latias ex SSP 76')
  assert.equal(start, LIST.lastIndexOf('2 Latias'))
  assert.equal(decklistLineRange(LIST, '2 Latias ex SSP 76', 2), null)
})

test('says so when the text no longer contains the line', () => {
  assert.equal(decklistLineRange(LIST, '1 Pikachu SVI 1'), null)
  assert.equal(decklistLineRange(LIST, '   '), null)
})

test('keeps the identity of an untouched line across edits and deletion above it', () => {
  let next = 2
  const allocate = () => `line-${next++}`
  const edited = reconcileDecklistLineIds('A\nB', 'A fixed\nB', ['line-0', 'line-1'], allocate)
  assert.equal(edited[1], 'line-1')
  assert.notEqual(edited[0], 'line-0')
  assert.deepEqual(reconcileDecklistLineIds('A fixed\nB', 'B', edited, allocate), ['line-1'])
})
