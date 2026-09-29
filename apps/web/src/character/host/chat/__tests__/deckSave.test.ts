import assert from 'node:assert/strict'
import { test } from 'node:test'
import { saveDeckFromWidget } from '../deckSave'

const block = {
  name: 'Dragapult ex', format: 'standard', total: 60,
  ptcgl: 'Pokémon: 7\n3 Dragapult ex TWM 130\n4 Dreepy TWM 128',
  sections: [{ cards: [{ id: 'sv6-130', quantity: 3 }, { id: 'sv5-125', quantity: 4 }] }],
}

test('saves a widget deck through the transactional import and returns its id', async () => {
  const calls: unknown[] = []
  const result = await saveDeckFromWidget(block, {
    importDeck: async (body) => { calls.push(['import', body]); return { deck: { id: 'deck-9' } } },
  })
  assert.deepEqual(calls, [
    ['import', { text: block.ptcgl, name: 'Dragapult ex', formatCode: 'standard' }],
  ])
  assert.deepEqual(result, { ok: true, id: 'deck-9', name: 'Dragapult ex', total: 60 })
})

test('a failed transactional import creates no fallback deck and reports failure', async () => {
  let importCalls = 0
  const result = await saveDeckFromWidget(block, {
    importDeck: async () => { importCalls++; throw new Error('HTTP 500') },
  })
  assert.equal(importCalls, 1)
  assert.deepEqual(result, { ok: false, message: "Couldn't save this deck. Please try again." })
})
