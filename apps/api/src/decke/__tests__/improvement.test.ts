import assert from 'node:assert/strict'
import { test } from 'node:test'
import pg from 'pg'
import type { Queryable } from '@deckpal/db'
import { backfillShared, loadIdentityTerms, recordLeg, summarizeCosts } from '../improvement.js'

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

function fixture(options: { shared?: boolean; writerFails?: boolean } = {}) {
  const calls: Array<{ sql: string; params: unknown[] }> = []
  const db = { query: async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params })
    if (sql.includes('shared_owner')) return { rows: [{ owner: options.shared === false ? null : 'owner' }] }
    if (sql.includes('decke_improvement_identity_terms')) return { rows: [{ terms: ['Ash', 'Ash Ketchum', 'ash@example.com'] }] }
    if (sql.includes('FROM public.decke_ai_request r WHERE r.id')) return { rows: [{
      started_at: '2026-09-28T18:00:00.000Z', finished_at: '2026-09-28T18:00:01.000Z',
      status: 'completed', build_sha: 'abc', build_pr: 123, leg_no: 0,
    }] }
    if (sql.includes('FROM public.decke_ai_operation')) return { rows: [
      { model_id: 'model', provider: 'gateway', input_tokens: 10, output_tokens: 4, cache_read_tokens: null, cache_write_tokens: null, reasoning_tokens: 1, cost_usd: '0.01', cost_source: 'provider_reported' },
      { model_id: 'typesafe-ai/jev', provider: 'typesafe-ai', input_tokens: 5, output_tokens: 0, cache_read_tokens: null, cache_write_tokens: null, reasoning_tokens: null, cost_usd: null, cost_source: 'unknown' },
    ] }
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
  assert.match(calls[0]!.sql, /shared_owner/)
})

test('a failing corpus writer never throws into chat', async () => {
  const { db } = fixture({ writerFails: true })
  assert.equal(await recordLeg(db, record), false)
})

test('identity terms come through the subject-checked helper without direct auth reads', async () => {
  const { db, calls } = fixture()
  assert.deepEqual(await loadIdentityTerms(db, record.userId), ['ash@example.com', 'Ash Ketchum', 'Ash'])
  assert.equal(calls.length, 1)
  assert.match(calls[0]!.sql, /decke_improvement_identity_terms/)
  assert.doesNotMatch(calls[0]!.sql, /auth\.users|app_user/)
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
        return { rows: [{ terms: ['Ash', 'Ash Ketchum', 'ash@example.com'] }] }
      }
      if (sql.includes('decke_improvement_record_backfill')) return { rows: [{ data: { recorded: true } }] }
      throw new Error(`Unexpected SQL: ${sql}`)
    } },
  })

  assert.equal(await backfillShared(client as unknown as Queryable, {
    userId: record.userId,
    conversationId: record.conversationId,
    backfill: { turns: [{ seq: 0, asked: 'Ash asks', answered: 'ok', tools: [] }], requests: [] },
  }), true)
  assert.equal(reconnects, 0)
  assert.equal(calls.some(({ sql }) => sql === 'BEGIN' || sql === 'COMMIT'), false)
  const writer = calls.find(({ sql }) => sql.includes('decke_improvement_record_backfill'))
  assert.ok(writer)
  assert.match(String(writer.params[2]), /\[redacted\] asks/)
})
