/**
 * The import dialog's Edit button selects an unmatched line in the pasted text,
 * so the reader lands on exactly the characters to fix.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { decklistLineRange } from '../decklistLines'

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

test('says so when the text no longer contains the line', () => {
  assert.equal(decklistLineRange(LIST, '1 Pikachu SVI 1'), null)
  assert.equal(decklistLineRange(LIST, '   '), null)
})
