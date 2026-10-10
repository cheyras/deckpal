import assert from 'node:assert/strict'
import { test } from 'node:test'
import { alreadyDeclinedMessage, declineCallKey, declinedCalls, researchRanInConversation } from '../declined.js'
import { callKey } from '../repeat.js'

const denied = (name: string, input: unknown, reason = 'the reader declined') => ({
  type: `tool-${name}`,
  toolCallId: `call-${name}`,
  input,
  state: 'output-denied',
  approval: { id: `approval-${name}`, approved: false, reason },
})
const msg = (parts: unknown[]) => ({ role: 'assistant', parts })

test('an exact declined write survives later turns; different arguments remain askable', () => {
  const original = { deck_id: 'd1', markdown: '# First' }
  const declined = declinedCalls([
    msg([denied('deck_strategy', original)]),
    { role: 'user', parts: [{ type: 'text', text: 'Let us discuss the matchup instead.' }] },
    msg([{ type: 'text', text: 'Sure.' }]),
    { role: 'user', parts: [{ type: 'text', text: 'Now update it.' }] },
  ])
  assert.ok(declined.has(callKey('deck_strategy', original)))
  assert.ok(!declined.has(callKey('deck_strategy', { deck_id: 'd1', markdown: '# Different' })))
})

test('argument order cannot bypass an exact decline', () => {
  const declined = declinedCalls([msg([denied('save_deck', { name: 'Mill', format: 'standard' })])])
  assert.ok(declined.has(callKey('save_deck', { format: 'standard', name: 'Mill' })))
})

// 2026-10-10 (#291 review): `@pasted` + deck is the same argument list for
// every game, so one declined card used to refuse every later paste for that
// deck. The key names the game the call carried instead.
const game = (winner: string) => [
  'Setup',
  `${winner} chose heads for the opening coin flip.`,
  `${winner} won the coin toss.`,
  `${winner} decided to go first.`,
  `${winner} drew 7 cards for the opening hand.`,
  'Opponent drew 7 cards for the opening hand.',
  `${winner}'s Turn`,
  `${winner} drew a card.`,
  `${winner} played a very long uniquely named Basic Pokémon to the Active Spot.`,
  `${winner} attached Basic Psychic Energy to that Pokémon in the Active Spot.`,
  `${winner} ended their turn.`,
  `All Prize cards taken. ${winner} wins.`,
].join('\n')
const user = (text: string) => ({ role: 'user', parts: [{ type: 'text', text }] })

test('a pasted-game decline follows the substituted game, not the @pasted sentinel', () => {
  const gameA = game('GameAPlayer')
  const gameB = game('GameBPlayer')
  const input = { log: '@pasted', deck_id: 'd1', dry_run: false }
  // The real order: A pasted, A's card declined, B pasted. B is the NEWEST
  // paste, so a replay that looked at the whole conversation would hash B; the
  // decline must be read against the paste that preceded the declined call.
  const declined = declinedCalls([
    user(`log this one\n${gameA}`),
    msg([denied('add_battle_log', input)]),
    user(`ok then, this one instead\n${gameB}`),
  ])

  assert.ok(declined.has(declineCallKey('add_battle_log', input, gameA)), 'the same game stays declined')
  assert.ok(!declined.has(declineCallKey('add_battle_log', input, gameB)), 'a different game remains askable')
  assert.ok(!declined.has(callKey('add_battle_log', input)), 'the bare sentinel key would block every game')
  // Game A re-proposed without the sentinel is still game A: as a truncated
  // prefix the adapter would expand, or re-typed in full.
  const prefix = gameA.slice(0, 220)
  assert.ok(declined.has(declineCallKey('add_battle_log', { ...input, log: prefix }, gameA)))
  assert.ok(declined.has(declineCallKey('add_battle_log', { ...input, log: gameA }, null)))
  // Other arguments still matter: the same game for a different deck is a
  // different change.
  assert.ok(!declined.has(declineCallKey('add_battle_log', { ...input, deck_id: 'd2' }, gameA)))
})

test('a sentinel declined with no paste in view stays keyed on the sentinel', () => {
  const input = { log: '@pasted', deck_id: 'd1', dry_run: false }
  const declined = declinedCalls([msg([denied('add_battle_log', input)])])
  assert.ok(declined.has(callKey('add_battle_log', input)))
  assert.equal(declineCallKey('add_battle_log', input, null), callKey('add_battle_log', input))
  // And every other tool keeps the historical exact key.
  assert.equal(declineCallKey('save_deck', { name: 'x' }, game('Z')), callKey('save_deck', { name: 'x' }))
})

test('approved, abandoned and non-tool parts are not declines', () => {
  const approved = { ...denied('deck_strategy', { deck_id: 'd1' }), state: 'output-available', approval: { id: 'a', approved: true } }
  const declined = declinedCalls([
    msg([
      approved,
      denied('save_deck', { name: 'x' }, 'the reader did not answer'),
      { type: 'text', text: 'no', approval: { approved: false }, input: {} },
    ]),
  ])
  assert.equal(declined.size, 0)
})

test('no research call is suppressed unless that exact call was declined', () => {
  const old = { query: 'Dragapult', topic: 'competitive', purpose: 'Dragapult results' }
  const next = { query: 'Gardevoir', topic: 'competitive', purpose: 'Gardevoir results' }
  const declined = declinedCalls([msg([denied('web_research', old)])])
  assert.ok(declined.has(callKey('web_research', old)))
  assert.ok(!declined.has(callKey('web_research', next)))
})

test('spoken refusals are not inferred from reader prose', () => {
  const declined = declinedCalls([
    { role: 'user', parts: [{ type: 'text', text: 'stop researching and do not save a guide' }] },
  ])
  assert.equal(declined.size, 0)
})

test('research provenance recognises current and legacy replayed output parts', () => {
  const available = (name: string) => msg([{ type: `tool-${name}`, state: 'output-available', input: {}, output: 'findings' }])
  assert.equal(researchRanInConversation([available('web_research')]), true)
  assert.equal(researchRanInConversation([available('research_meta')]), true)
  assert.equal(researchRanInConversation([available('get_card')]), false)
  assert.equal(researchRanInConversation([msg([denied('web_research', {})])]), false)
})

test('the refusal message is exact, factual and asks for no redo', () => {
  const message = alreadyDeclinedMessage('deck_strategy')
  assert.match(message, /^\[\[NO_WORK\]\]/)
  assert.match(message, /exact deck_strategy change/)
  assert.match(message, /nothing changed/i)
  assert.match(message, /Do not ask again for the same change/)
  assert.match(message, /Carry on with what they said next/)
  assert.doesNotMatch(message, /research|guide|different arguments|work around/i)
})

test('malformed history is ignored', () => {
  for (const value of [null, undefined, 'nope', {}, { parts: 'bad' }]) {
    assert.doesNotThrow(() => declinedCalls(value))
    assert.equal(declinedCalls(value).size, 0)
  }
})
