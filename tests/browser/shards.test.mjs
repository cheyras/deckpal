import assert from 'node:assert/strict'
import test from 'node:test'
import { browserSuites } from './core-suites.mjs'
import { browserSuites as deckeShowSuites } from './deckeShow.mjs'
import { browserSuites as errorBoundarySuites } from './errorBoundary.mjs'
import { browserSuites as standaloneProofSuites } from './standaloneProofs.mjs'
import { browserSuites as listTableSuites } from './listTableVirtualization.mjs'
import { browserSuites as bugReportSuites } from './bugReport.mjs'
import { browserSuites as profileOwnedCardsSuites } from './profileOwnedCardsSuite.mjs'
import { browserSuites as labelerFormatSuites } from './labelerFormats.mjs'
import { parseShard, shardSuites } from '../../scripts/browser-shards.mjs'

const names = [
  'typecheck', 'selfhost-catalog', 'selfhost-admin-journey', 'selfhost-admin-tables-1280', 'selfhost-admin-tables-390', 'selfhost-admin-access',
  'selfhost-feedback-primary-1280', 'selfhost-feedback-primary-390', 'selfhost-feedback-primary-428', 'selfhost-feedback-lifecycle', 'selfhost-queue', 'selfhost-a11y',
  'cloud-catalog', 'cloud-admin-journey', 'cloud-admin-tables-1280', 'cloud-admin-tables-390', 'cloud-admin-access',
  'cloud-feedback-primary-1280', 'cloud-feedback-primary-390', 'cloud-feedback-primary-428', 'cloud-feedback-lifecycle', 'cloud-a11y', 'cloud-writes', 'cloud-queue',
  'authreturn', 'chat', 'payment-history', 'decke-show', 'decke-chat-phone', 'error-boundary', 'list-table-virtualization', 'bug-report-selfhost', 'bug-report-cloud', 'profile-owned-cards',
  'payment-history-proof', 'scanner-voice-proof', 'cloud-labeler-formats',
]
const suites = [...browserSuites({}), ...deckeShowSuites({}), ...errorBoundarySuites({}), ...listTableSuites({}), ...bugReportSuites({}), ...profileOwnedCardsSuites({}), ...standaloneProofSuites({}), ...labelerFormatSuites({})]

test('all existing journeys remain named suites', () => {
  assert.deepEqual(suites.map(suite => suite.name), names)
})

test('eight shards cover every suite once, regardless of discovery order', () => {
  const assignment = shardSuites(suites, 8).map(shard => shard.map(suite => suite.name))
  assert.ok(assignment.every(shard => shard.length))
  assert.deepEqual(assignment.flat().sort(), [...names].sort())
  assert.deepEqual(assignment.find(shard => shard.includes('cloud-feedback-primary-428')), ['cloud-feedback-primary-428'])
  assert.deepEqual(assignment.find(shard => shard.includes('cloud-writes')), ['cloud-writes'])
  assert.deepEqual(shardSuites([...suites].reverse(), 8).map(shard => shard.map(suite => suite.name)), assignment)
})

test('one shard can run the entire suite despite the isolated visual case', () => {
  assert.deepEqual(shardSuites(suites, 1)[0].map(suite => suite.name), [...names].sort())
})

test('two shards keep every suite when a heavy suite outweighs the reserved visual case', () => {
  const assignment = shardSuites(suites, 2).map(shard => shard.map(suite => suite.name))
  assert.ok(assignment.every(shard => shard.length))
  assert.deepEqual(assignment.flat().sort(), [...names].sort())
})

test('shard argument rejects missing and out-of-range indexes', () => {
  assert.deepEqual(parseShard([]), null)
  assert.deepEqual(parseShard(['--shard', '1/1']), { index: 1, count: 1 })
  assert.deepEqual(parseShard(['--shard', '2/4']), { index: 2, count: 4 })
  for (const args of [['--shard'], ['--shard', '0/4'], ['--shard', '5/4'], ['--shard', '1/0'], ['--shard', 'a/4']]) {
    assert.throws(() => parseShard(args))
  }
})
