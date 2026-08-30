import assert from 'node:assert/strict'
import test from 'node:test'

import { rankCatalogRows } from './card-catalog.mts'

test('collector number and set disambiguate cards with the same name', () => {
  const rows = [
    { tcgdex_id: 'a-1', local_id: '025', name: 'Pikachu', rarity: null, card_set: { tcgdex_id: 'a', name: 'Other', series: { tcgdex_id: 'sv' } } },
    { tcgdex_id: 'b-25', local_id: '025', name: 'Pikachu', rarity: 'Rare', card_set: { tcgdex_id: 'b', name: '151', series: { tcgdex_id: 'sv' } } },
    { tcgdex_id: 'b-7', local_id: '007', name: 'Pikachu', rarity: null, card_set: { tcgdex_id: 'b', name: '151', series: { tcgdex_id: 'sv' } } },
  ]
  const matches = rankCatalogRows(rows, { name: 'Pikachu', setName: '151', collectorNumber: '025/165', language: 'en', confidence: 0.9 })
  assert.equal(matches[0]?.cardId, 'b-25')
  assert.equal(matches[0]?.images.low, '/deckpal/images/en/sv/b/025/low.webp')
})
