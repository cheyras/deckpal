import assert from 'node:assert/strict'
import { test } from 'node:test'
import { saveDeckFromWidget } from '../deckSave'

const block = {
  name: 'Dragapult ex', format: 'standard', total: 60,
  sections: [{ cards: [{ id: 'sv6-130', quantity: 3 }, { id: 'sv5-125', quantity: 4 }] }],
}

test('saves a widget deck through the deck builder create and card endpoints', async () => {
  const calls: unknown[] = []
  const result = await saveDeckFromWidget(block, {
    createDeck: async (body) => { calls.push(['create', body]); return { deck: { id: 'deck-9' } } },
    addDeckCard: async (deckId, cardId, quantity) => { calls.push(['card', deckId, cardId, quantity]) },
  })
  assert.deepEqual(calls, [
    ['create', { name: 'Dragapult ex', formatCode: 'standard' }],
    ['card', 'deck-9', 'sv6-130', 3], ['card', 'deck-9', 'sv5-125', 4],
  ])
  assert.deepEqual(result, { ok: true, id: 'deck-9', name: 'Dragapult ex', total: 60 })
})

test('maps API failures to a human retry message', async () => {
  const result = await saveDeckFromWidget(block, {
    createDeck: async () => { throw new Error('HTTP 500') },
    addDeckCard: async () => undefined,
  })
  assert.deepEqual(result, { ok: false, message: "Couldn't save this deck. Please try again." })
})
