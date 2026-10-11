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
