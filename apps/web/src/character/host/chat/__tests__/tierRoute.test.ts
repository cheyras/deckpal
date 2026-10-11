import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readTierRoute } from '../tierRoute.js'

const streamed = { tier: 'standard', pathways: ['deck_build'], effort: 'medium' }

test('readTierRoute keeps a well-formed data-decke-route payload', () => {
  assert.deepEqual(readTierRoute(streamed), streamed)
  assert.deepEqual(
    readTierRoute({ tier: 'quick', pathways: ['small_talk'], effort: 'low' }),
    { tier: 'quick', pathways: ['small_talk'], effort: 'low' },
  )
  assert.deepEqual(
    readTierRoute({ tier: 'standard', pathways: ['battle_review', 'deck_iterate'], effort: 'high' }),
    { tier: 'standard', pathways: ['battle_review', 'deck_iterate'], effort: 'high' },
  )
})

test('readTierRoute rebuilds rather than passes through', () => {
  const route = readTierRoute({ ...streamed, model: 'claude-opus-5-5', budget: 999 })
  assert.deepEqual(route, streamed)
  assert.deepEqual(Object.keys(route!).sort(), ['effort', 'pathways', 'tier'])
  // A copy: the stream's array is not the one sent back.
  const pathways = ['deck_build']
  assert.notEqual(readTierRoute({ ...streamed, pathways })!.pathways, pathways)
})

test('readTierRoute refuses anything off-contract', () => {
  for (const bad of [
    undefined,
    null,
    'standard',
    [],
    {},
    { ...streamed, tier: 'deep' },
    { ...streamed, tier: 'Standard' },
    { ...streamed, effort: 'max' },
    { ...streamed, effort: undefined },
    { ...streamed, pathways: 'deck_build' },
    { ...streamed, pathways: [1] },
    { ...streamed, pathways: ['Deck Build'] },
    { ...streamed, pathways: ['x'.repeat(41)] },
    // One or two distinct names, as the server's own echo schema requires.
    { ...streamed, pathways: [] },
    { ...streamed, pathways: ['deck_build', 'deck_build'] },
    { ...streamed, pathways: ['deck_build', 'deck_iterate', 'battle_review'] },
  ]) {
    assert.equal(readTierRoute(bad), null, JSON.stringify(bad))
  }
})
