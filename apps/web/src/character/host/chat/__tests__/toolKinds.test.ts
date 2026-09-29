import assert from 'node:assert/strict'
import test from 'node:test'
import { kindOf, labelFor } from '../toolKinds.js'
const registry = ['health', 'collection_summary', 'collection_log', 'collection_value', 'search_cards', 'get_card', 'set_progress', 'decks', 'save_deck', 'delete_deck', 'check_deck', 'deck_strategy', 'add_battle_log', 'battle_logs', 'deck_history', 'edit_battle_log', 'delete_battle_log', 'lists', 'edit_list', 'delete_list', 'log_cards', 'set_cart', 'mutation_history', 'revert']
test('every registry tool has a meaningful activity kind', () => { for (const name of registry) assert.notEqual(kindOf(name), 'other', name) })
test('labels are readable and switch tense when done', () => { const running = labelFor({ name: 'search_cards', phase: 'start', args: { name: 'Dragapult' } }); const done = labelFor({ name: 'search_cards', phase: 'ok', args: { name: 'Dragapult' } }); assert.equal(running, 'Looking up Dragapult'); assert.equal(done, 'Looked up Dragapult'); for (const label of [running, done]) assert.ok(!label.includes('_') && !label.includes('{')) })
test('a server status label wins', () => assert.equal(labelFor({ name: 'web_research', phase: 'start', label: 'Searching: tournament results' }), 'Searching: tournament results'))
test('a finished server status label changes tense', () => assert.equal(labelFor({ name: 'web_research', phase: 'ok', label: 'Searching: tournament results' }), 'Searched: tournament results'))
