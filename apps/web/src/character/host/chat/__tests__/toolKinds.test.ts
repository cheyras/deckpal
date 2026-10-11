import assert from 'node:assert/strict'
import test from 'node:test'
import { activityIconFor, iconFor, kindOf, labelFor, motionFor } from '../toolKinds.js'
const registry = ['health', 'collection_summary', 'collection_log', 'collection_value', 'search_cards', 'get_card', 'set_progress', 'decks', 'save_deck', 'delete_deck', 'check_deck', 'deck_strategy', 'add_battle_log', 'battle_logs', 'deck_history', 'edit_battle_log', 'delete_battle_log', 'battle_digest', 'card_price_history', 'lists', 'edit_list', 'delete_list', 'log_cards', 'set_cart', 'mutation_history', 'revert']
test('every registry tool has a meaningful activity kind', () => { for (const name of registry) assert.notEqual(kindOf(name), 'other', name) })
test('labels are readable and switch tense when done', () => { const running = labelFor({ name: 'search_cards', phase: 'start', args: { name: 'Dragapult' } }); const done = labelFor({ name: 'search_cards', phase: 'ok', args: { name: 'Dragapult' } }); assert.equal(running, 'Looking up Dragapult'); assert.equal(done, 'Looked up Dragapult'); for (const label of [running, done]) assert.ok(!label.includes('_') && !label.includes('{')) })
test('a server status label wins', () => assert.equal(labelFor({ name: 'web_research', phase: 'start', label: 'Searching: tournament results' }), 'Searching: tournament results'))
test('a finished server status label changes tense', () => assert.equal(labelFor({ name: 'web_research', phase: 'ok', label: 'Searching: tournament results' }), 'Searched: tournament results'))
test('declined work is skipped without claiming it finished', () => assert.equal(labelFor({ name: 'save_deck', phase: 'declined' }), 'Skipped that change'))
test('set_cart is price work with its own running and finished labels', () => { assert.equal(kindOf('set_cart'), 'prices'); assert.equal(labelFor({ name: 'set_cart', phase: 'start' }), 'Building your cart'); assert.equal(labelFor({ name: 'set_cart', phase: 'ok' }), 'Built your cart') })
test('battle_digest reads like reading one game, not "Working on it"', () => { assert.equal(kindOf('battle_digest'), 'logs'); assert.equal(labelFor({ name: 'battle_digest', phase: 'start', args: { deck_id: 'Dragapult', log_id: 7 } }), 'Reading the game'); assert.equal(labelFor({ name: 'battle_digest', phase: 'ok' }), 'Read the game') })
test('a consult is thinking: the sparkle, and its own server label in either tense', () => {
  assert.equal(kindOf('consult'), 'other')
  assert.equal(iconFor(kindOf('consult')), 'sparkle')
  assert.equal(labelFor({ name: 'consult', phase: 'start', label: 'Thinking it through' }), 'Thinking it through')
  assert.equal(labelFor({ name: 'consult', phase: 'ok', label: 'Thought it through' }), 'Thought it through')
  // A failed consult keeps its running label on the error chip; it must still read as finished.
  assert.equal(labelFor({ name: 'consult', phase: 'error', label: 'Thinking it through' }), 'Thought it through')
  // A replayed chip without a label still says what happened.
  assert.equal(labelFor({ name: 'consult', phase: 'ok' }), 'Thought it through')
})
test('waiting for approval has its own static decision icon', () => {
  assert.equal(iconFor('collection'), 'cards')
  assert.equal(activityIconFor('collection', true), 'check-circle')
  assert.equal(activityIconFor('collection', false), 'cards')
  // ActivityLine deliberately applies this motion only when waiting is false.
  assert.equal(motionFor('collection'), 'da-rock')
})
