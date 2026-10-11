import assert from 'node:assert/strict'
import { test } from 'node:test'
import { simulateBattles, simulateBattlesInputSchema, simulateBattlesTool } from '../tools/simulate.js'

const cards = [{ name: 'Gwynn', quantity: 2 }]

test('simulate_battles schema: one subject, at most one compare list', () => {
  assert.ok(simulateBattlesInputSchema.safeParse({ deck_id: 'v4' }).success)
  assert.ok(simulateBattlesInputSchema.safeParse({ deck_id: 'v4', compare_with: 'v5' }).success)
  assert.ok(simulateBattlesInputSchema.safeParse({ deck_id: 'v4', compare_cards: cards, compare_name: 'v4 with 2 Gwynn' }).success)
  assert.ok(simulateBattlesInputSchema.safeParse({ cards, compare_ptcgl_text: 'Pokémon: 1' }).success)
  const two = simulateBattlesInputSchema.safeParse({ deck_id: 'v4', compare_with: 'v5', compare_cards: cards })
  assert.ok(!two.success)
  assert.match(JSON.stringify(two.error.issues), /at most one of compare_with, compare_cards or compare_ptcgl_text/)
  assert.ok(!simulateBattlesInputSchema.safeParse({ compare_with: 'v5' }).success, 'a compare list is not a subject')
})

test('simulate_battles descriptions teach the paired comparison', () => {
  const shape = simulateBattlesInputSchema.shape
  const describe = shape.compare_with.description ?? ''
  assert.match(describe, /check whether a change makes the deck better/)
  assert.match(describe, /SAME seeds/)
  assert.match(describe, /no clear difference at this n/)
  assert.match(shape.compare_cards.description ?? '', /WHOLE list/)
  assert.match(simulateBattlesTool.description, /compare_with/)
})

test('simulateBattles forwards the compare list to POST /decks/simulate', async () => {
  const calls: unknown[][] = []
  const ctx = { userId: 'u', db: {} as never, api: {
    base: 'test', get: async () => ({}),
    send: async (...args: unknown[]) => { calls.push(args); return { text: 'VERDICT: …', report: { kind: 'deckpal.simulation.comparison' } } },
  } } as never
  const out = await simulateBattles(ctx, { cards, compare_cards: cards, compare_name: 'v4 with 2 Gwynn', opponents: undefined })
  assert.equal(calls.length, 1)
  assert.equal(calls[0]![0], 'POST')
  assert.equal(calls[0]![1], '/decks/simulate')
  assert.deepEqual(calls[0]![2], { cards, compare_cards: cards, compare_name: 'v4 with 2 Gwynn' })
  assert.ok(JSON.stringify(out).includes('VERDICT'))
})

test('simulate_battles: the built-in meta pool is named in the schema and the description', () => {
  const opp = simulateBattlesInputSchema.shape.opponents.description ?? ''
  assert.match(opp, /'meta'/)
  assert.match(opp, /'meta:<archetype>'/)
  assert.match(opp, /as-of date/)
  assert.match(opp, /snapshot/)
  assert.match(simulateBattlesTool.description, /built-in Standard meta pool/)
  assert.equal(simulateBattlesTool.annotations?.readOnlyHint, true)
  assert.ok(simulateBattlesInputSchema.safeParse({ deck_id: 'v4', opponents: ['meta', 'meta:Dragapult', 'Gengar'] }).success)
})

test('simulateBattles passes meta and meta:<archetype> to the API as written, without a deck lookup', async () => {
  const calls: unknown[][] = []
  // A ctx whose database throws: a meta reference must never reach the deck resolver.
  const ctx = { userId: 'u', db: new Proxy({}, { get: () => { throw new Error('deck lookup') } }) as never, api: {
    base: 'test', get: async () => ({}),
    send: async (...args: unknown[]) => { calls.push(args); return { text: 'SIMULATED', report: {} } },
  } } as never
  await simulateBattles(ctx, { cards, opponents: ['meta', ' Meta : Dragapult Dusknoir'] })
  assert.deepEqual((calls[0]![2] as { opponents: string[] }).opponents, ['meta', ' Meta : Dragapult Dusknoir'])
})

test('simulateBattles: a spaced meta reference never queries the deck index, even with a colliding saved name', async () => {
  const gets: unknown[] = []
  const calls: unknown[][] = []
  const ctx = { userId: 'u', db: {} as never, api: {
    base: 'test',
    get: async (...a: unknown[]) => { gets.push(a); return { decks: [{ id: '00000000-0000-4000-8000-000000000001', name: 'Meta Dragapult' }] } },
    send: async (...args: unknown[]) => { calls.push(args); return { text: 'SIMULATED', report: {} } },
  } } as never
  await simulateBattles(ctx, { cards, opponents: ['meta : Dragapult', 'META\t:Slowking', 'meta'] })
  assert.equal(gets.length, 0, 'the deck index was not read')
  assert.deepEqual((calls[0]![2] as { opponents: string[] }).opponents, ['meta : Dragapult', 'META\t:Slowking', 'meta'])
})

test('simulateBattles: an ambiguous saved name is reported, not handed to the pool; an absent one is', async () => {
  const calls: unknown[][] = []
  const decks = [
    { id: '00000000-0000-4000-8000-000000000001', name: 'N s Zoroark' },
    { id: '00000000-0000-4000-8000-000000000002', name: 'N-s Zoroark' },
  ]
  const ctx = { userId: 'u', db: {} as never, api: {
    base: 'test',
    get: async () => ({ decks }),
    send: async (...args: unknown[]) => { calls.push(args); return { text: 'SIMULATED', report: {} } },
  } } as never
  const amb = await simulateBattles(ctx, { cards, opponents: ["N's Zoroark"] })
  assert.equal(calls.length, 0, 'nothing was sent to the API')
  assert.match(JSON.stringify(amb), /Opponent/)
  assert.match(JSON.stringify(amb), /00000000-0000-4000-8000-000000000001/)
  await simulateBattles(ctx, { cards, opponents: ['Slowking'] })
  assert.deepEqual((calls[0]![2] as { opponents: string[] }).opponents, ['Slowking'], 'a name no saved deck matches is left to the pool')
})

test('simulate_battles teaches continuing a run: the token input, the same-inputs rule, when to stop', () => {
  const shape = simulateBattlesInputSchema.shape
  const token = shape.continue_token.description ?? ''
  assert.match(token, /SAME inputs/)
  assert.match(token, /CUMULATIVE/)
  assert.match(token, /deck edited since is refused/)
  assert.match(token, /at most 12 calls/)
  assert.match(token, /stop once the verdict is clear/)
  assert.match(simulateBattlesTool.description, /continue_token/)
  assert.match(simulateBattlesTool.description, /a few times at most/)
  assert.match(shape.games.description ?? '', /games to add/)
  assert.equal(simulateBattlesTool.annotations?.readOnlyHint, true, 'still read-only: continuing adds games, not records')
  assert.ok(simulateBattlesInputSchema.safeParse({ deck_id: 'v4', continue_token: 'sc1.abcdefgh.ijklmnopqrstuvwxyzABCD' }).success)
  assert.ok(!simulateBattlesInputSchema.safeParse({ continue_token: 'sc1.abcdefgh.ijklmnopqrstuvwxyzABCD' }).success, 'the inputs are repeated with the token, not replaced by it')
})

test('simulateBattles forwards continue_token with the repeated inputs', async () => {
  const calls: unknown[][] = []
  const ctx = { userId: 'u', db: {} as never, api: {
    base: 'test', get: async () => ({}),
    send: async (...args: unknown[]) => { calls.push(args); return { text: 'Cumulative over 2 calls', report: {} } },
  } } as never
  await simulateBattles(ctx, { cards, opponents: ['meta'], games: 20, continue_token: 'sc1.abcdefgh.ijklmnopqrstuvwxyzABCD' })
  assert.deepEqual(calls[0]![2], { cards, opponents: ['meta'], games: 20, continue_token: 'sc1.abcdefgh.ijklmnopqrstuvwxyzABCD' })
})
