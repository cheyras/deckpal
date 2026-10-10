import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Ctx } from '../ctx.js'
import { allTools } from '../index.js'
import { DRAW_ONLY_CAVEAT, deckOddsInputSchema, deckOddsTool, renderDeckOdds, type DeckOddsCardLine, type DeckOddsResult } from '../tools/deckOdds.js'

const DECK_ID = '6f1c1d2e-3a4b-4c5d-8e9f-0a1b2c3d4e5f'

const base: Omit<DeckOddsResult, 'queries' | 'per_card'> = {
  deck: { name: "Hide 'n' Sneak", size: 60, basics: 16, distinct_names: 24 },
  method: 'Monte Carlo, draw-only', trials: 50_000, trials_requested: 50_000, seed: 60,
  mulligan: { simulated: 0.1009, exact: 0.09922, avg_per_game: 0.11266 },
  avg_basics_in_hand: 2.0678, per_card_turn: 2, max_margin95: 0.00438, warnings: [],
}
const withQueries: DeckOddsResult = {
  ...base,
  per_card: null,
  queries: [
    { label: 'Shuppet + (Buddy-Buddy Poffin or Ultra Ball)', zone: 'hand', by_turn: 0, successes: 13_511, p: 0.27022, margin95: 0.00389, exact: null },
    { label: 'Shuppet', zone: 'seen', by_turn: 2, successes: 26_108, p: 0.52216, margin95: 0.00438, exact: 0.52508 },
    { label: '4+ Ultra Ball', zone: 'prized', by_turn: 0, successes: 2, p: 0.00004, margin95: 0.00006, exact: 0.0000314 },
  ],
}

function stubCtx(answer: unknown = withQueries) {
  const calls: Array<{ method: string; path: string; body?: unknown }> = []
  const ctx = {
    userId: 'u', db: {} as never,
    api: {
      base: 'test',
      get: async (path: string) => {
        calls.push({ method: 'GET', path })
        return { decks: [{ id: DECK_ID, name: "Hide 'n' Sneak", formatCode: 'standard' }] }
      },
      send: async (method: string, path: string, body?: unknown) => {
        calls.push({ method, path, body })
        if (answer instanceof Error) throw answer
        return answer
      },
    },
  } as unknown as Ctx
  return { ctx, calls }
}

test('deck_odds is a read, registered right after check_deck, reaching both front-ends', () => {
  const names = allTools().map((t) => t.name)
  assert.equal(names[names.indexOf('check_deck') + 1], 'deck_odds')
  assert.equal(deckOddsTool.annotations.readOnlyHint, true)
  assert.equal(deckOddsTool.annotations.idempotentHint, true)
})

test('input: exactly one deck form, bounded queries, prized takes no turn', () => {
  const ok = (v: unknown) => deckOddsInputSchema.safeParse(v).success
  assert.equal(ok({}), false)
  assert.equal(ok({ deck_id: 'x', cards: [{ name: 'Pikachu', quantity: 1 }] }), false)
  assert.equal(ok({ deck_id: 'Hide n Sneak' }), true)
  assert.equal(ok({ cards: [{ name: 'Pikachu', quantity: 4 }] }), true)
  assert.equal(ok({ ptcgl_text: '4 Pikachu SVI 1' }), true)
  assert.equal(ok({ deck_id: 'x', queries: [{ all_of: [{}] }] }), false, 'a group needs a name or kind')
  assert.equal(ok({ deck_id: 'x', queries: [{ all_of: [{ kinds: ['trainer'] }] }] }), false)
  assert.equal(ok({ deck_id: 'x', queries: [{ all_of: [{ cards: ['Rare Candy'], count: 2 }], prized: true }] }), true)
  assert.equal(ok({ deck_id: 'x', queries: [{ all_of: [{ cards: ['Rare Candy'] }], prized: true, by_turn: 2 }] }), false)
  assert.equal(ok({ deck_id: 'x', queries: Array.from({ length: 13 }, () => ({ all_of: [{ kinds: ['basic'] }] })) }), false)
  assert.equal(ok({ deck_id: 'x', trials: 999 }), false)
  assert.equal(ok({ deck_id: 'x', trials: 200_001 }), false)
  const parsed = deckOddsInputSchema.parse({ deck_id: 'x', queries: [{ all_of: [{ cards: ['Shuppet'] }] }] })
  assert.equal(parsed.trials, 50_000)
  assert.deepEqual(parsed.queries, [{ all_of: [{ cards: ['Shuppet'], count: 1 }], by_turn: 0, prized: false }])
})

test('a deck NAME is resolved to its id first, and the read goes to POST /decks/odds', async () => {
  const { ctx, calls } = stubCtx()
  const input = deckOddsInputSchema.parse({ deck_id: 'hide n sneak', queries: [{ all_of: [{ cards: ['Shuppet'] }] }], seed: 9 })
  const res = await deckOddsTool.handler(input, ctx)
  assert.ok(!res.isError, res.text)
  assert.deepEqual(calls[0], { method: 'GET', path: '/decks' })
  assert.deepEqual(calls[1], {
    method: 'POST', path: '/decks/odds',
    body: { queries: input.queries, trials: 50_000, seed: 9, deck_id: DECK_ID },
  })
  assert.match(res.text, new RegExp(`as deck ${DECK_ID}`), 'the resolution is said back so the next call can use the id')
  assert.match(res.text, /^Deck odds: Hide 'n' Sneak \(60 cards, 16 Basic Pokémon\)$/m)
  assert.deepEqual(res.structured, withQueries as unknown as Record<string, unknown>)
})

test('an unsaved list goes as cards, with no deck lookup and no queries key when none were asked', async () => {
  const { ctx, calls } = stubCtx({ ...base, queries: [], per_card: [] })
  const cards = [{ name: 'Shuppet', quantity: 4 }]
  const res = await deckOddsTool.handler(deckOddsInputSchema.parse({ cards }), ctx)
  assert.ok(!res.isError, res.text)
  assert.deepEqual(calls, [{ method: 'POST', path: '/decks/odds', body: { trials: 50_000, cards } }])
})

test('format travels with an unsaved list, so names resolve the way check_deck resolves them', async () => {
  const { ctx, calls } = stubCtx({ ...base, queries: [], per_card: [] })
  const cards = [{ name: 'Shuppet', quantity: 4 }]
  await deckOddsTool.handler(deckOddsInputSchema.parse({ cards, format: 'expanded' }), ctx)
  assert.deepEqual(calls, [{ method: 'POST', path: '/decks/odds', body: { trials: 50_000, cards, format: 'expanded' } }])
})

test('an API refusal comes back as a failure carrying its sentence', async () => {
  const { ctx } = stubCtx(new Error("Not in this deck: 'Rare Candy'. Use the deck's own card names: Banette, Shuppet."))
  const res = await deckOddsTool.handler(deckOddsInputSchema.parse({ cards: [{ name: 'Shuppet', quantity: 4 }] }), ctx)
  assert.equal(res.isError, true)
  assert.match(res.text, /^deck_odds failed: Not in this deck: 'Rare Candy'\. Use the deck's own card names: Banette, Shuppet\.$/)
})

test('rendering a query answer: method, sample, seed, both mulligan figures, margins, exact values, caveat', () => {
  const text = renderDeckOdds(withQueries)
  assert.match(text, /^Method: Monte Carlo, draw-only\. 50,000 shuffled games, seed 60\./m)
  assert.match(text, /^Mulligan: 10\.1% of first hands \(exact 9\.9%\), 0\.11 redraws per game\. The kept hand holds 2\.1 Basics on average\.$/m)
  assert.match(text, /^ {2}1\. Shuppet \+ \(Buddy-Buddy Poffin or Ultra Ball\), opening hand: 27\.0% ±0\.4$/m)
  assert.match(text, /^ {2}2\. Shuppet, by your turn 2: 52\.2% ±0\.4 \(exact 52\.5%\)$/m)
  assert.match(text, /^ {2}3\. 4\+ Ultra Ball, prized: <0\.1% \(2 of 50,000 games; exact 0\.0031%\)$/m,
    'a tiny simulated rate shows its count, not a fake precision; the noiseless exact value keeps its digits')
  assert.ok(text.endsWith(DRAW_ONLY_CAVEAT))
  assert.match(DRAW_ONLY_CAVEAT, /does not play them.*Ultra Ball, Buddy-Buddy Poffin, Supporters.*inside a group/)
})

test('a label that already names its zone is not told it twice', () => {
  const q = withQueries.queries[1]!
  const text = renderDeckOdds({ ...withQueries, queries: [
    { ...q, label: 'Shuppet or a way to fetch one, opening hand', zone: 'hand', by_turn: 0 },
    { ...q, label: 'Turn-two Shuppet' },
  ] })
  assert.match(text, /^ {2}1\. Shuppet or a way to fetch one, opening hand: 52\.2%/m)
  assert.match(text, /^ {2}2\. Turn-two Shuppet, by your turn 2: 52\.2%/m)
})

test('rendering the default report stays compact even for sixty singletons', () => {
  const per_card: DeckOddsCardLine[] = Array.from({ length: 60 }, (_, i) => ({
    name: `A Fairly Long Card Name Number ${i}`, copies: 1, opening: 0.1167, by_turn: 0.15, prized_any: 0.1, prized_all: null,
  }))
  per_card[0] = { name: 'Shuppet', copies: 4, opening: 0.441, by_turn: 0.522, prized_any: 0.3456, prized_all: 0.00002 }
  const text = renderDeckOdds({ ...base, queries: [], per_card, warnings: ['This list has 59 cards, not 60.'] })
  assert.match(text, /^Per card, % of games with at least one copy: opening hand \/ seen by your turn 2 \/ prized, then \/ every copy prized \(exact\) for multiples \(each simulated value ±0\.4 or better at 95%\):$/m)
  assert.match(text, /^ {2}4 Shuppet: 44\.1 \/ 52\.2 \/ 34\.6 \/ 0\.0020$/m, 'every copy prized is exact, so a tiny value keeps its digits')
  assert.match(text, /^ {2}1 A Fairly Long Card Name Number 1: 11\.7 \/ 15\.0 \/ 10\.0$/m)
  assert.match(text, /^Note: This list has 59 cards, not 60\.$/m)
  assert.ok(text.length < 5_000, `Deck-E clamps a tool result at 6,000 chars; this was ${text.length}`)
})
