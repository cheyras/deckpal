import assert from 'node:assert/strict'
import { test } from 'node:test'
import pg from 'pg'
import type { Queryable } from '@deckpal/db'
import { autoShareAndRecordLeg, backfillShared, loadIdentityTerms, recordLeg, summarizeCosts } from '../improvement.js'

const record = {
  userId: 'user-1',
  conversationId: '00000000-0000-4000-8000-000000000001',
  seq: 2,
  requestId: '00000000-0000-4000-8000-000000000002',
  leg: 0,
  payload: {
    asked: 'Hi Ash',
    answered: 'Hi ASH',
    tool_calls: [{ id: 'call-1', name: 'lookup', phase: 'ok', args: { owner: 'Ash' }, output: { nested: ['ash@example.com'] } }],
  },
}

function fixture(options: {
  shared?: boolean
  writerFails?: boolean
  autoShare?: { status: string; reason?: string; backfill?: unknown }
  autoShareFails?: boolean
  identity?: { username: string | null; displayName: string | null; email: string | null }
} = {}) {
  const calls: Array<{ sql: string; params: unknown[] }> = []
  const db = { query: async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params })
    if (sql.includes('decke_improvement_auto_share')) {
      if (options.autoShareFails) throw Object.assign(new Error('down'), { code: '57P01' })
      return { rows: [{ data: options.autoShare ?? { status: 'skipped', reason: 'off' } }] }
    }
    if (sql.includes('decke_improvement_is_shared')) return { rows: [{ shared: options.shared !== false }] }
    if (sql.includes('decke_improvement_identity_terms')) return { rows: [{ terms: options.identity ?? {
      username: 'Ash', displayName: 'Ash Ketchum', email: 'ash@example.com',
    } }] }
    if (sql.includes('decke_improvement_request_telemetry')) return { rows: [{ data: {
      leg_no: 0, model_id: 'mixed', provider: 'mixed',
      started_at: '2026-09-28T18:00:00.000Z', finished_at: '2026-09-28T18:00:01.000Z', latency_ms: 1000,
      input_tokens: 15, output_tokens: 4, cache_read_tokens: null, cache_write_tokens: null, reasoning_tokens: 1,
      cost_usd: 0.01, cost_source: 'provider_reported', cost_coverage: 'partial',
      status: 'completed', build_sha: 'abc', build_pr: 123,
    } }] }
    if (sql.includes('decke_improvement_record_leg')) {
      if (options.writerFails) throw Object.assign(new Error('down'), { code: '57P01' })
      return { rows: [{ data: { recorded: true } }] }
    }
    return { rows: [] }
  } } as unknown as Queryable
  return { db, calls }
}

test('unknown operation cost makes coverage partial while preserving the known sum', () => {
  assert.deepEqual(summarizeCosts([
    { cost_usd: '0.004', cost_source: 'provider_reported' },
    { cost_usd: null, cost_source: 'unknown' },
  ]), { costUsd: 0.004, costCoverage: 'partial', costSource: 'provider_reported' })
  assert.deepEqual(summarizeCosts([{ cost_usd: null, cost_source: 'unknown' }]), {
    costUsd: null, costCoverage: 'unknown', costSource: 'unknown',
  })
})

test('auto-share redacts its backfill before recording the current leg', async () => {
  const { db, calls } = fixture({ autoShare: {
    status: 'shared',
    backfill: { turns: [{ seq: 0, asked: 'Ash asks', answered: 'ok', tools: [] }], requests: [] },
  } })
  assert.equal(await autoShareAndRecordLeg(db, record), true)
  const auto = calls.findIndex(({ sql }) => sql.includes('decke_improvement_auto_share'))
  const backfill = calls.findIndex(({ sql }) => sql.includes('decke_improvement_record_backfill'))
  const leg = calls.findIndex(({ sql }) => sql.includes('decke_improvement_record_leg'))
  assert.ok(auto >= 0 && auto < backfill && backfill < leg)
  assert.match(String(calls[backfill]!.params[2]), /\[redacted\] asks/)
})

test('auto-share honors a prior decision and remains fail-open for chat', async () => {
  const decided = fixture({ shared: false, autoShare: { status: 'skipped', reason: 'decided' } })
  assert.equal(await autoShareAndRecordLeg(decided.db, record), false)
  assert.equal(decided.calls.some(({ sql }) => sql.includes('decke_improvement_record_backfill')), false)
  assert.equal(decided.calls.some(({ sql }) => sql.includes('decke_improvement_record_leg')), false)

  const failed = fixture({ autoShareFails: true })
  assert.equal(await autoShareAndRecordLeg(failed.db, record), false)
})

test('recordLeg redacts nested tool output and writes partial cost coverage', async () => {
  const { db, calls } = fixture()
  assert.equal(await recordLeg(db, record), true)
  const writer = calls.find((call) => call.sql.includes('decke_improvement_record_leg'))
  assert.ok(writer)
  const payload = JSON.parse(String(writer.params[5]))
  assert.equal(payload.asked, 'Hi [redacted]')
  assert.deepEqual(payload.tool_calls[0].output, { nested: ['[redacted]'] })
  assert.equal(payload.cost_usd, 0.01)
  assert.equal(payload.cost_coverage, 'partial')
})

test('unshared chats stop at the cheap check without loading identity', async () => {
  const { db, calls } = fixture({ shared: false })
  assert.equal(await recordLeg(db, record), false)
  assert.equal(calls.length, 1)
  assert.match(calls[0]!.sql, /decke_improvement_is_shared/)
})

test('a failing corpus writer never throws into chat', async () => {
  const { db } = fixture({ writerFails: true })
  assert.equal(await recordLeg(db, record), false)
})

test('identity terms map named sorted fields and retain email local parts', async () => {
  const { db, calls } = fixture({ identity: {
    displayName: 'John Smith', email: 'jsmith@example.invalid', username: 'José',
  } })
  assert.deepEqual(await loadIdentityTerms(db, record.userId), ['jsmith@example.invalid', 'John Smith', 'jsmith', 'José'])
  assert.equal(calls.length, 1)
  assert.match(calls[0]!.sql, /decke_improvement_identity_terms/)
  assert.doesNotMatch(calls[0]!.sql, /auth\.users|app_user/)
})

test('identity terms tolerate nullable and duplicate named fields', async () => {
  const { db } = fixture({ identity: { displayName: 'Ash', email: null, username: 'Ash' } })
  assert.deepEqual(await loadIdentityTerms(db, record.userId), ['Ash'])
})

test('recordLeg uses only subject-checked metadata helpers', async () => {
  const { db, calls } = fixture()
  assert.equal(await recordLeg(db, record), true)
  const sql = calls.map((call) => call.sql).join('\n')
  assert.match(sql, /decke_improvement_is_shared/)
  assert.match(sql, /decke_improvement_request_telemetry/)
  assert.doesNotMatch(sql, /decke_improvement_shared_owner|FROM public\.decke_ai_request|FROM public\.decke_ai_operation/)
  const telemetry = calls.find((call) => call.sql.includes('decke_improvement_request_telemetry'))
  assert.deepEqual(telemetry?.params, [record.userId, record.requestId])
})

test('backfill reuses a checked-out pg client without reconnecting or opening a transaction', async () => {
  const client = new pg.Client()
  const calls: Array<{ sql: string; params: unknown[] }> = []
  let reconnects = 0
  Object.defineProperties(client, {
    connect: { value: async () => { reconnects++; throw new Error('already connected') } },
    release: { value: () => undefined },
    query: { value: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params })
      if (sql.includes('decke_improvement_identity_terms')) {
        return { rows: [{ terms: { username: 'Ash', displayName: 'Ash Ketchum', email: 'ash@example.com' } }] }
      }
      if (sql.includes('decke_improvement_record_backfill')) return { rows: [{ data: { recorded: true } }] }
      if (sql.includes('decke_improvement_is_shared')) return { rows: [{ shared: true }] }
      if (sql.includes('decke_improvement_request_telemetry')) return { rows: [{ data: { leg_no: 0, cost_usd: null, cost_coverage: 'unknown' } }] }
      if (sql.includes('decke_improvement_record_leg')) return { rows: [{ data: { recorded: true } }] }
      throw new Error(`Unexpected SQL: ${sql}`)
    } },
  })

  assert.equal(await backfillShared(client as unknown as Queryable, {
    userId: record.userId,
    conversationId: record.conversationId,
    backfill: {
      turns: [{ seq: 0, asked: 'Ash asks', answered: 'ok', tools: [] }],
      requests: [{ requestId: record.requestId, seq: 0, leg: 0 }],
    },
  }), true)
  assert.equal(reconnects, 0)
  assert.equal(calls.some(({ sql }) => sql === 'BEGIN' || sql === 'COMMIT'), false)
  const writer = calls.find(({ sql }) => sql.includes('decke_improvement_record_backfill'))
  assert.ok(writer)
  assert.match(String(writer.params[2]), /\[redacted\] asks/)
  const sql = calls.map((call) => call.sql).join('\n')
  assert.match(sql, /decke_improvement_is_shared/)
  assert.match(sql, /decke_improvement_request_telemetry/)
  assert.doesNotMatch(sql, /decke_improvement_shared_owner|FROM public\.decke_ai_request|FROM public\.decke_ai_operation/)
})
