import assert from 'node:assert/strict'
import test from 'node:test'
import { activitySummary, currentStep, sourceFavicons } from '../activityState.js'
const step = (id: string, phase: 'start' | 'ok' | 'error' | 'partial' | 'declined') => ({ id, name: 'search_cards', phase })
test('newest running step is current, otherwise newest completed step', () => { assert.equal(currentStep([step('one', 'start'), step('two', 'ok')])?.id, 'one'); assert.equal(currentStep([step('one', 'ok'), step('two', 'ok')])?.id, 'two') })
test('summaries disclose both normal work and failures', () => { assert.equal(activitySummary([step('one', 'ok'), step('two', 'ok')], 12), 'Looked at 2 things · 12s'); assert.equal(activitySummary([step('one', 'error')], 12), "1 step didn't work · 12s") })
test('declined steps are not counted as things Deck-E looked at', () => assert.equal(activitySummary([step('skip', 'declined'), step('read', 'ok')], 7), 'Looked at 1 thing · 7s'))
test('favicon display caps at three and reports the remainder', () => { const sources = ['a.com', 'b.com', 'c.com', 'd.com'].map((host) => ({ host, url: `https://${host}`, title: host })); assert.deepEqual(sourceFavicons(sources), { urls: ['https://icons.duckduckgo.com/ip3/a.com.ico', 'https://icons.duckduckgo.com/ip3/b.com.ico', 'https://icons.duckduckgo.com/ip3/c.com.ico'], more: 1 }) })
