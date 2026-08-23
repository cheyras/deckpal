/**
 * Four optional fields, one row. The interesting cases are all the ones where
 * something is missing — a stray separator or an orphan "×1" is exactly the
 * kind of small wrongness that makes a generated panel read as generated.
 */
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { cardRowAnnounce, cardRowSubtitle, quantityLabel } from '../cardRowText'

test('the subtitle joins only what it was given', () => {
  assert.equal(cardRowSubtitle({ setName: 'Base Set', variantName: 'Reverse Holo' }), 'Base Set · Reverse Holo')
  assert.equal(cardRowSubtitle({ setName: 'Base Set' }), 'Base Set')
  assert.equal(cardRowSubtitle({ variantName: 'Reverse Holo' }), 'Reverse Holo')
  assert.equal(cardRowSubtitle({}), '')
  // Blank strings are missing fields, not empty fragments to separate.
  assert.equal(cardRowSubtitle({ setName: '  ', variantName: 'Holofoil' }), 'Holofoil')
  assert.equal(cardRowSubtitle({ setName: ' Base Set ', variantName: '' }), 'Base Set')
})

test('a count appears only when there is more than one', () => {
  assert.equal(quantityLabel(3), '×3')
  assert.equal(quantityLabel(1), '')
  assert.equal(quantityLabel(0), '')
  assert.equal(quantityLabel(undefined), '')
})

test('the spoken row is a sentence, not a list of fragments', () => {
  assert.equal(
    cardRowAnnounce({ cardId: 'base1-4', name: 'Charizard', setName: 'Base Set', variantName: 'Holofoil', quantity: 3 }),
    'Charizard — Base Set · Holofoil, 3 copies',
  )
  assert.equal(cardRowAnnounce({ cardId: 'base1-4', name: 'Charizard' }), 'Charizard')
  assert.equal(cardRowAnnounce({ cardId: 'base1-4', name: 'Charizard', quantity: 1 }), 'Charizard')
})

test('a card with no name falls back to its id rather than announcing nothing', () => {
  assert.equal(cardRowAnnounce({ cardId: 'me05-12', name: '   ' }), 'me05-12')
})
