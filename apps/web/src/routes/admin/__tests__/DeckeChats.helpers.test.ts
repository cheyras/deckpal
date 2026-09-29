import assert from 'node:assert/strict'
import test from 'node:test'
import { costLabel, eventLabel, tokenLabel, turnOffset } from '../DeckeChats.helpers.ts'

// Copied from decke_improvement_detail's public JSON shape: token buckets are
// nested and events retain their ordinal ordering rather than timestamps.
const sqlDetailFixture = {
  conversation: { id: '7f133e80-6db3-4e85-975a-758fe2f2d3fd', date: '2026-09-28', buildFirst: 'first', buildLast: 'last', costUsd: '0.01', costCoverage: 'partial', hasError: false },
  turns: [{ seq: 0, offsetSeconds: 10, tokens: { input: 1200, output: null, cacheRead: 200, cacheWrite: null, reasoning: 100 }, events: [
    { ordinal: 2, batch: 1, batchOrdinal: 1, legId: null, kind: 'browser_tool', payload: { action: 'search' } },
    { ordinal: 7, batch: 2, batchOrdinal: 1, legId: '2b9d6d7b-9d55-4cc6-bd76-f1a50f5ad238', kind: 'animation', payload: { name: 'think' } },
  ] }],
} as const

test('labels SQL cost and nested token buckets without inventing flat token fields', () => {
  assert.equal(costLabel(sqlDetailFixture.conversation.costUsd, sqlDetailFixture.conversation.costCoverage), '$0.01 USD (partial)')
  assert.equal(tokenLabel(sqlDetailFixture.turns[0].tokens), 'input 1200 · cache read 200 · reasoning 100')
})

test('uses reader-provided turn offsets and preserves event ordinal metadata', () => {
  assert.equal(turnOffset(sqlDetailFixture.turns[0].offsetSeconds), '+10s')
  assert.equal(eventLabel(sqlDetailFixture.turns[0].events[0]), 'Event 2 · batch 1.1')
  assert.equal(eventLabel(sqlDetailFixture.turns[0].events[1]), 'Event 7 · batch 2.1 · leg 2b9d6d7b-9d55-4cc6-bd76-f1a50f5ad238')
  assert.deepEqual(sqlDetailFixture.turns[0].events.map(event => event.ordinal), [2, 7])
})
