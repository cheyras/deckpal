import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import type { DeckImportFix } from '../api'
import { confirmedDecklistText } from '../deckImportFixes'

function fix(lineIndex: number, original: string, replacement: string): DeckImportFix {
  return { lineIndex, original, replacement, card: { id: 'card', name: 'Iono', set: 'PAL', number: '185' }, reason: 'Matched card', confidence: 'suggested' }
}

test('applies only the confirmed physical occurrence of duplicate lines', () => {
  const text = 'Pokémon: 2\n  2 Iono PAL 999  \n2 Iono PAL 999\n'
  const fixes = [fix(1, '2 Iono PAL 999', '2 Iono PAL 185'), fix(2, '2 Iono PAL 999', '2 Iono PAL 185')]
  assert.equal(confirmedDecklistText(text, fixes, new Set([1])), 'Pokémon: 2\n  2 Iono PAL 999  \n2 Iono PAL 185\n')
  assert.equal(confirmedDecklistText(text, fixes, new Set()), 'Pokémon: 2\n  2 Iono PAL 185  \n2 Iono PAL 185\n')
})

test('rejects a stale, duplicated, or forged line index', () => {
  const text = '2 Iono PAL 999\n2 Iono PAL 999'
  assert.equal(confirmedDecklistText(text, [fix(0, '2 Boss PAL 999', '2 Boss PAL 185')], new Set()), null)
  assert.equal(confirmedDecklistText(text, [fix(0, '2 Iono PAL 999', '2 Iono PAL 185\n2 Iono PAL 185')], new Set()), null)
  assert.equal(confirmedDecklistText(text, [fix(2, '2 Iono PAL 999', '2 Iono PAL 185')], new Set()), null)
  assert.equal(confirmedDecklistText(text, [fix(0, '2 Iono PAL 999', '2 Iono PAL 185'), fix(0, '2 Iono PAL 999', '2 Iono PAL 185')], new Set()), null)
})
