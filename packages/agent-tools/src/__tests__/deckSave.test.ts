import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Api } from '../api.js'
import type { Ctx } from '../ctx.js'
import { allTools } from '../index.js'

const saveDeck = allTools().find((tool) => tool.name === 'save_deck')!

const detail = (replayed = false) => ({
  replayed,
  deck: {
    id: 'deck-atomic', name: 'Sparks', formatCode: 'standard', version: 1,
    totalCount: 4, valueUsd: null, legal: false, updatedAt: '2026-09-29', strategyMd: null,
  },
  counts: { total: 4, pokemon: 4, trainer: 0, energy: 0, distinctNames: 1 },
  cards: [],
  validation: {
    format: 'standard', legal: false,
    counts: { total: 4, pokemon: 4, trainer: 0, energy: 0, unresolved: 0 },
    violations: [{ code: 'DECK_SIZE', severity: 'error', message: 'needs 60 cards' }], warnings: [],
  },
})

function context(send: Api['send'], gets: string[] = []): Ctx {
  return {
    userId: 'user-1', db: { query: async () => ({ rows: [] }) },
    api: {
      base: 'https://example.test/api',
      get: async (path: string) => { gets.push(path); return { decks: [] } },
      send,
    },
  } as unknown as Ctx
}

test('save_deck create sends the complete deck in one atomic request and reports legality', async () => {
  const calls: Array<{ method: string; path: string; body: unknown }> = []
  const gets: string[] = []
  const result = await saveDeck.handler({
    mode: 'create', name: 'Sparks', cards: [{ card_id: 'sv01-1', quantity: 4 }], dry_run: false,
  }, context((async (method, path, body) => {
    calls.push({ method, path, body })
    return detail()
  }) as Api['send'], gets))

  assert.equal(result.isError, undefined)
  assert.equal(calls.length, 1)
  assert.deepEqual(gets, [])
  assert.equal(calls[0]?.method, 'POST')
  assert.equal(calls[0]?.path, '/decks/save')
  assert.deepEqual((calls[0]?.body as { cards: unknown }).cards, [{ cardId: 'sv01-1', quantity: 4 }])
  assert.match(result.text, /NOT format-legal/)
})

test('unresolved ids fail the one request and the tool names every bad id', async () => {
  let writes = 0
  const result = await saveDeck.handler({
    mode: 'create', name: 'Broken',
    cards: [{ card_id: 'bad-1', quantity: 2 }, { card_id: 'bad-2', quantity: 2 }],
    dry_run: false,
  }, context((async () => {
    writes++
    throw new Error('Unresolved card ids: bad-1, bad-2. Nothing was saved.')
  }) as Api['send']))

  assert.equal(writes, 1)
  assert.equal(result.isError, true)
  assert.match(result.text, /bad-1, bad-2/)
  assert.match(result.text, /Nothing was saved/)
})

test('repeating an identical create reuses its deterministic key and returns the same deck', async () => {
  const keys: string[] = []
  const resultFor = async () => saveDeck.handler({
    mode: 'create', name: 'Sparks', cards: [{ card_id: 'sv01-1', quantity: 4 }], dry_run: false,
  }, context((async (_method, path, body) => {
    assert.equal(path, '/decks/save')
    const key = (body as { idempotencyKey: string }).idempotencyKey
    keys.push(key)
    return detail(keys.length > 1)
  }) as Api['send']))

  const first = await resultFor()
  const retry = await resultFor()
  assert.equal(keys.length, 2)
  assert.equal(keys[0], keys[1])
  assert.match(first.text, /id deck-atomic/)
  assert.match(retry.text, /already saved.*id deck-atomic/i)
})

test('a pasted decklist save sends a stable retry key, so a repeated call replays instead of importing a twin', async () => {
  const bodies: Array<Record<string, unknown>> = []
  const importResult = {
    ...detail(), import: { resolvedEntries: 1, distinctCards: 1, totalCards: 4, unresolved: [], unresolvedLines: [], warnings: [] },
  }
  const send = (async (_method: string, path: string, body: unknown) => {
    if (path === '/decks/import') bodies.push(body as Record<string, unknown>)
    return importResult
  }) as Api['send']
  const args = { mode: 'create', name: 'Sparks', ptcgl_text: 'Pokémon: 4\n4 Pikachu SVI 1', dry_run: false }
  await saveDeck.handler(args, context(send))
  await saveDeck.handler(args, context(send))
  assert.equal(bodies.length, 2)
  assert.equal(typeof bodies[0]!.idempotencyKey, 'string')
  assert.equal(bodies[0]!.idempotencyKey, bodies[1]!.idempotencyKey)
  const other = { ...args, ptcgl_text: 'Pokémon: 4\n4 Raichu SVI 2' }
  await saveDeck.handler(other, context(send))
  assert.notEqual(bodies[2]!.idempotencyKey, bodies[0]!.idempotencyKey, 'a different list is a different save')
})
