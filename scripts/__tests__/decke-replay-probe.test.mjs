import assert from 'node:assert/strict'
import test from 'node:test'
import {
  deckTotal,
  hasFalseRefusal,
  hasTextDeckList,
  researchTopicsOverlap,
  scoreTranscript,
} from '../decke-replay-probe.mjs'

const sixty = Array.from({ length: 15 }, (_, i) => ({ card_id: `card-${i}`, quantity: 4 }))

test('research overlap and the scenario scorer detect a repeated topic', () => {
  assert.equal(
    researchTopicsOverlap(
      { query: 'current Dragapult ex tournament results', purpose: 'Dragapult tournament results' },
      { query: 'how is Dragapult ex doing in the meta?', purpose: 'Dragapult ex meta' },
    ),
    true,
  )
  assert.equal(researchTopicsOverlap({ query: 'Dragapult ex results' }, { query: 'Pitch Black card prices' }), false)
  const metrics = scoreTranscript([
    { tags: [], text: '', calls: [{ name: 'web_research', input: { query: 'Dragapult ex results' }, output: 'Dragapult is placing well.' }] },
    { tags: [], text: '', calls: [{ name: 'web_research', input: { query: 'current Dragapult tournament decks' } }] },
  ])
  assert.equal(metrics.web_research_calls, 2)
  assert.equal(metrics.repeat_research_calls, 1)
})

test('feedback-turn tools are counted instead of being hidden in the total', () => {
  const metrics = scoreTranscript([
    { tags: ['feedback'], text: 'Thanks.', calls: [{ name: 'express', input: {} }, { name: 'decks', input: {} }] },
    { tags: [], text: 'Okay.', calls: [{ name: 'collection_summary', input: {} }] },
  ])
  assert.equal(metrics.tool_calls, 3)
  assert.equal(metrics.feedback_tool_calls, 2)
})

test('a typed twelve-line deck list is detected, while prose and eleven lines are not', () => {
  const list = Array.from({ length: 12 }, (_, i) => `${i % 4 + 1}x Card ${i + 1}`).join('\n')
  const short = Array.from({ length: 11 }, (_, i) => `1 Card ${i + 1}`).join('\n')
  assert.equal(hasTextDeckList(list), true)
  assert.equal(hasTextDeckList(short), false)
  assert.equal(hasTextDeckList('I would use four Dreepy and three Drakloak.'), false)
})

test('false-refusal language counts only when no call was actually declined', () => {
  assert.equal(hasFalseRefusal("Research is blocked, so I can't research that."), true)
  assert.equal(hasFalseRefusal('You declined that write earlier.', true), false)
  assert.equal(scoreTranscript([{ tags: [], text: 'Research was refused.', calls: [], declined: false }]).false_refusals, 1)
})

test('showDeck totals quantities and the scorer requires exactly 60', () => {
  assert.equal(deckTotal({ input: { cards: sixty } }), 60)
  assert.equal(deckTotal({ input: { cards: [...sixty, { card_id: 'extra', quantity: 5 }] } }), 65)
  const metrics = scoreTranscript([{ tags: ['expects-deck'], text: '', calls: [
    { name: 'check_deck', input: { cards: sixty } },
    { name: 'showDeck', input: { cards: sixty } },
    { name: 'showDeck', input: { cards: [...sixty, { card_id: 'extra', quantity: 5 }] } },
  ] }])
  assert.equal(metrics.check_before_show, 1)
  assert.equal(metrics.show_deck_60, 1)
})
