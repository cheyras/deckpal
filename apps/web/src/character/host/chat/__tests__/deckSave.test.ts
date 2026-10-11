import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  deckSaveChoice, saveDeckFromWidget, saveDeckVersionFromWidget, savedLine, versionSaveError, widgetCards,
  type DeckVersionApi,
} from '../deckSave'

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

test('unresolved import lines are surfaced instead of silently dropped', async () => {
  const result = await saveDeckFromWidget(block, {
    importDeck: async () => ({
      deck: { id: 'unused' },
      import: { unresolvedLines: ['4 Missingmon XYZ 999', '2 Othermon ABC 123'] },
    }),
  })
  assert.deepEqual(result, {
    ok: false,
    message: "Couldn't save this deck. Unresolved lines: 4 Missingmon XYZ 999; 2 Othermon ABC 123",
  })
})

test('an API rejection includes the unresolved line names', async () => {
  const result = await saveDeckFromWidget(block, {
    importDeck: async () => { throw new Error('Unresolved deck lines: 4 Missingmon XYZ 999. Nothing was saved.') },
  })
  assert.match(result.ok ? '' : result.message, /4 Missingmon XYZ 999/)
})

// ── A revision of a deck the reader owns: save it as that deck's next version ──
//
// The audit: "make a v2 of my Dragapult deck" could only be saved as a NEW
// deck, so the version history and battle logs stayed on the old one.

const revision = {
  ...block,
  name: 'Dragapult ex v2',
  base: { id: 'deck-1', name: 'Dragapult ex' },
  versionNote: '  Cut Switch for Jet Energy  ',
  sections: [
    { cards: [{ id: 'sv6-130', quantity: 3 }, { id: 'sv5-125', quantity: 4 }] },
    { cards: [{ id: 'sv6-130', quantity: 1 }, { id: ' sv1-200 ', quantity: 2 }] },
  ],
}

test('a brand-new deck is offered only as a new deck, exactly as before', () => {
  assert.deepEqual(deckSaveChoice(block), { kind: 'new' })
  // Half a base is no base: the server sets both or neither.
  assert.deepEqual(deckSaveChoice({ base: { id: 'deck-1' } }), { kind: 'new' })
  assert.deepEqual(deckSaveChoice({ base: { id: '  ', name: 'Dragapult ex' } }), { kind: 'new' })
  assert.deepEqual(deckSaveChoice({ base: 'deck-1' }), { kind: 'new' })
})

test('a revision is offered as the next version of its deck, with his note to edit', () => {
  assert.deepEqual(deckSaveChoice(revision), {
    kind: 'version', base: { id: 'deck-1', name: 'Dragapult ex' }, note: 'Cut Switch for Jet Energy',
  })
  assert.equal((deckSaveChoice({ ...revision, versionNote: 'x'.repeat(600) }) as { note: string }).note.length, 500)
  assert.equal((deckSaveChoice({ ...revision, versionNote: undefined }) as { note: string }).note, '')
})

test('the shown list becomes one line per card, copies summed', () => {
  assert.deepEqual(widgetCards(revision), [
    { cardId: 'sv6-130', quantity: 4 },
    { cardId: 'sv5-125', quantity: 4 },
    { cardId: 'sv1-200', quantity: 2 },
  ])
})

test('a version save writes the list onto that deck through /decks/save, never a new deck', async () => {
  const calls: unknown[] = []
  const api: DeckVersionApi = {
    saveDeck: async (body) => { calls.push(body); return { deck: { id: 'deck-1', name: 'Dragapult ex', version: 3 }, bumped: true } },
  }
  const result = await saveDeckVersionFromWidget(revision, '  Cut Switch after two Gardevoir losses ', api)
  assert.deepEqual(calls, [{
    deckId: 'deck-1',
    cards: [{ cardId: 'sv6-130', quantity: 4 }, { cardId: 'sv5-125', quantity: 4 }, { cardId: 'sv1-200', quantity: 2 }],
    versionNote: 'Cut Switch after two Gardevoir losses',
    newVersion: true,
  }])
  // The deck's own name, not the list's: the reader saved onto "Dragapult ex".
  assert.deepEqual(result, { ok: true, id: 'deck-1', name: 'Dragapult ex', total: 60, version: { number: 3, changed: true } })
})

test('an empty note is left off rather than stored as nothing', async () => {
  const calls: Array<Record<string, unknown>> = []
  await saveDeckVersionFromWidget(revision, '   ', {
    saveDeck: async (body) => { calls.push(body); return { deck: { id: 'deck-1', name: 'Dragapult ex', version: 2 }, bumped: false } },
  })
  assert.equal('versionNote' in calls[0]!, false)
})

test('a list the deck already matches is reported as unchanged, not as a new version', async () => {
  const result = await saveDeckVersionFromWidget(revision, '', {
    saveDeck: async () => ({ deck: { id: 'deck-1', name: 'Dragapult ex', version: 2 }, bumped: false }),
  })
  assert.deepEqual(result.ok && result.version, { number: 2, changed: false })
  assert.equal(result.ok && savedLine(result), '“Dragapult ex” already matches this list · v2')
})

test('a version save without a base never reaches the API', async () => {
  let calls = 0
  const result = await saveDeckVersionFromWidget(block, 'note', { saveDeck: async () => { calls++; throw new Error('unreachable') } })
  assert.equal(calls, 0)
  assert.equal(result.ok, false)
})

test('a refused version save says why, in the API\'s own words when it wrote some', () => {
  const failure = (message: string, status: number) => Object.assign(new Error(message), { status })
  assert.equal(
    versionSaveError(failure('sv6-130 is in this deck as 2 printings, so changing its count would have to guess which one.', 400), 'Dragapult ex'),
    "Couldn't save this version. sv6-130 is in this deck as 2 printings, so changing its count would have to guess which one.",
  )
  assert.equal(versionSaveError(failure("No deck 'deck-1'", 404), 'Dragapult ex'),
    "Couldn't save this version — “Dragapult ex” isn't in your decks any more.")
  assert.equal(versionSaveError(failure('HTTP 500', 500), 'Dragapult ex'), "Couldn't save this version. Please try again.")
  assert.equal(versionSaveError(new TypeError('Failed to fetch'), 'Dragapult ex'), "Couldn't save this version. Please try again.")
})

test('the saved line names what happened', () => {
  assert.equal(savedLine({ id: 'd', name: 'Dragapult ex', total: 60 }), 'Saved “Dragapult ex” to your decks · 60 cards')
  assert.equal(savedLine({ id: 'd', name: 'Dragapult ex', total: 60, version: { number: 3, changed: true } }),
    'Saved v3 of “Dragapult ex” · 60 cards')
})
