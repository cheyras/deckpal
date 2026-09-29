import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkDeck, checkDeckInputSchema, renderDeckCheck, type DeckCheckResult } from '../tools/deckCheck.js'

const result: DeckCheckResult = {
  format: 'standard', total: 60, legal: false,
  issues: ['Deck contains 61 cards; exactly 60 are required.'],
  evolution_gaps: ['Charizard (Stage 2) has no Charmeleon and no Rare Candy'],
  lines: [
    { card_id: 'sv03-125', name: 'Charizard', supertype: 'Pokémon', quantity: 2, owned: 1, unit_price_usd: 3, resolved: true },
    { card_id: 'sv01-191', name: 'Rare Candy', supertype: 'Trainer', quantity: 4, owned: 4, unit_price_usd: .2, resolved: true },
  ],
  owned: 5, missing_cost_usd: 3, ptcgl: 'Pokémon: 1\n2 Charizard OBF 125\n',
}

test('checkDeck sends the exact read endpoint and returns structured data', async () => {
  const calls: unknown[] = []
  const ctx = { userId: 'u', db: {} as never, api: {
    base: 'test', get: async () => ({}),
    send: async (...args: unknown[]) => { calls.push(args); return result },
  } }
  assert.deepEqual(await checkDeck(ctx, { cards: [{ card_id: 'sv03-125', quantity: 2 }] }), result)
  assert.deepEqual(calls, [['POST', '/decks/check', { cards: [{ card_id: 'sv03-125', quantity: 2 }] }]])
})

test('rendering groups lines and includes issues, evolution gaps and cost', () => {
  const text = renderDeckCheck(result)
  assert.match(text, /^Checked 60 cards \(standard\): NOT LEGAL — 1 issue/m)
  assert.match(text, /Pokémon:\n  2× Charizard \(sv03-125\) — own 1/)
  assert.match(text, /Trainer:\n  4× Rare Candy/)
  assert.match(text, /Issues:\n  - Deck contains/)
  assert.match(text, /Evolution gaps:\n  - Charizard/)
  assert.match(text, /You own 5\/60; missing costs about \$3\.00\./)
})

test('input requires exactly one list form and exactly one card reference', () => {
  assert.equal(checkDeckInputSchema.safeParse({}).success, false)
  assert.equal(checkDeckInputSchema.safeParse({ cards: [], ptcgl_text: 'x' }).success, false)
  assert.equal(checkDeckInputSchema.safeParse({ cards: [{ name: 'Pikachu', card_id: 'x', quantity: 1 }] }).success, false)
  assert.equal(checkDeckInputSchema.safeParse({ cards: [{ name: 'Pikachu', quantity: 61 }] }).success, false)
  assert.equal(checkDeckInputSchema.safeParse({ ptcgl_text: '1 Pikachu SVI 1' }).success, true)
  assert.equal(checkDeckInputSchema.safeParse({ format: 'x'.repeat(25), ptcgl_text: 'x' }).success, false)
  assert.equal(checkDeckInputSchema.safeParse({ ptcgl_text: 'x'.repeat(8_001) }).success, false)
  assert.equal(checkDeckInputSchema.safeParse({ cards: [{ name: 'x'.repeat(81), quantity: 1 }] }).success, false)
  assert.equal(checkDeckInputSchema.safeParse({ cards: [{ card_id: 'x'.repeat(41), quantity: 1 }] }).success, false)
  assert.equal(checkDeckInputSchema.safeParse({ cards: [{ name: 'Pikachu', quantity: Number.MAX_SAFE_INTEGER + 1 }] }).success, false)
})
