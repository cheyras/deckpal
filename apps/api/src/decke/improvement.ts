import { createHash } from 'node:crypto'
import type { Queryable } from '@deckpal/db'
import { redact, redactionTerms, type RedactionIdentity } from './redact.js'

const MAX_PAYLOAD_BYTES = 1_048_576

export interface LegRecord {
  userId: string
  conversationId: string
  seq: number
  requestId: string
  leg: number
  payload: Record<string, unknown>
}

interface BackfillTurn {
  seq: number
  asked: string
  answered: string
  tools: unknown[]
}

interface BackfillRequest {
  requestId: string
  seq: number
  leg: number
}

export interface SharedBackfill {
  turns?: BackfillTurn[]
  requests?: BackfillRequest[]
}

export interface CostSummary {
  costUsd: number | null
  costCoverage: 'complete' | 'partial' | 'unknown'
  costSource: 'provider_reported' | 'token_rate_estimate' | 'unknown'
}

interface PoolClientLike extends Queryable { release(): void }
interface PoolLike extends Queryable { connect(): Promise<PoolClientLike> }

export async function canAskToShare(
  db: Queryable,
  args: { userId: string; conversationId: string },
): Promise<boolean> {
  try {
    return await asWriter(db, args.userId, async (client) => {
      const { rows } = await client.query<{ data?: { allowed?: boolean } }>(
        'SELECT public.decke_improvement_can_ask($1,$2) AS data',
        [args.userId, args.conversationId],
      )
      return rows[0]?.data?.allowed === true
    })
  } catch {
    // P0002 is expected before the browser has persisted its first turn. It
    // and every other failure mean the same thing to this reply: not now.
    return false
  }
}

/** Identity is exposed only through the subject-checked database boundary. */
export async function loadIdentityTerms(db: Queryable, userId: string): Promise<string[]> {
  const { rows } = await db.query<{ terms: RedactionIdentity | null }>(
    'SELECT public.decke_improvement_identity_terms($1) AS terms',
    [userId],
  )
  const identity = rows[0]?.terms
  return redactionTerms({
    username: identity?.username ?? null,
    displayName: identity?.displayName ?? null,
    email: identity?.email ?? null,
  })
}

/** Preserve unknown provider prices; a missing cost is never converted to zero. */
export function summarizeCosts(
  operations: readonly { cost_usd?: string | number | null; cost_source?: string | null }[],
): CostSummary {
  const known = operations.filter((operation) => operation.cost_usd !== null && operation.cost_usd !== undefined)
  const values = known.map((operation) => Number(operation.cost_usd)).filter(Number.isFinite)
  const costUsd = values.length ? values.reduce((sum, value) => sum + value, 0) : null
  const costCoverage = values.length === 0
    ? 'unknown'
    : values.length === operations.length
      ? 'complete'
      : 'partial'
  const knownSources = new Set(known.map((operation) => operation.cost_source))
  const costSource = values.length === 0
    ? 'unknown'
    : knownSources.has('token_rate_estimate')
      ? 'token_rate_estimate'
      : 'provider_reported'
  return { costUsd, costCoverage, costSource }
}

/**
 * Persist one completed request leg when and only when its conversation is
 * currently shared. This boundary is deliberately fail-open for chat.
 */
export async function recordLeg(db: Queryable, record: LegRecord): Promise<boolean> {
  try {
    return await asWriter(db, record.userId, (client) => recordLegInner(client, record))
  } catch (error) {
    console.error('[deck-e] improvement leg unavailable', safeErrorCode(error))
    return false
  }
}

/** Redact the confidential grant response before either corpus writer sees it. */
export async function backfillShared(
  db: Queryable,
  args: { userId: string; conversationId: string; backfill: SharedBackfill },
): Promise<boolean> {
  try {
    return await asWriter(db, args.userId, async (client) => {
      const terms = await loadIdentityTerms(client, args.userId)
      const turns = redact(args.backfill.turns ?? [], terms)
      await client.query(
        'SELECT public.decke_improvement_record_backfill($1,$2,$3::jsonb) AS data',
        [args.userId, args.conversationId, JSON.stringify(turns)],
      )
      for (const request of args.backfill.requests ?? []) {
        await recordLegInner(client, {
          userId: args.userId,
          conversationId: args.conversationId,
          seq: request.seq,
          requestId: request.requestId,
          leg: request.leg,
          payload: backfillTranscript(request.seq, turns),
        })
      }
      return true
    })
  } catch (error) {
    console.error('[deck-e] improvement backfill unavailable', safeErrorCode(error))
    return false
  }
}

async function recordLegInner(db: Queryable, record: LegRecord): Promise<boolean> {
  if (!await isShared(db, record.userId, record.conversationId)) return false
  const terms = await loadIdentityTerms(db, record.userId)
  const telemetry = await requestTelemetry(db, record.userId, record.requestId)
  const actualLeg = typeof telemetry.leg_no === 'number' ? telemetry.leg_no : record.leg
  const { leg_no: _legNo, ...fields } = telemetry
  const payload = boundPayload(redact({ ...record.payload, ...fields }, terms))
  const { rows } = await db.query<{ data?: { recorded?: boolean } }>(
    'SELECT public.decke_improvement_record_leg($1,$2,$3,$4,$5,$6::jsonb) AS data',
    [record.userId, record.conversationId, record.seq, record.requestId, actualLeg, JSON.stringify(payload)],
  )
  return rows[0]?.data?.recorded === true
}

async function asWriter<T>(db: Queryable, userId: string, work: (client: Queryable) => Promise<T>): Promise<T> {
  const candidate = db as Partial<PoolLike & PoolClientLike>
  // A checked-out PoolClient also exposes connect() through pg.Client. Its
  // release method is the reliable signal that the caller owns its transaction.
  if (typeof candidate.release === 'function' || typeof candidate.connect !== 'function') return work(db)
  const pool = db as PoolLike
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query("SELECT set_config('request.jwt.claims',$1,true)", [JSON.stringify({
      sub: userId,
      role: 'authenticated',
      deckpal_auth_kind: 'jwt',
      deckpal_server_request: true,
    })])
    const result = await work(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

async function isShared(db: Queryable, userId: string, conversationId: string): Promise<boolean> {
  const { rows } = await db.query<{ shared: boolean }>(
    'SELECT public.decke_improvement_is_shared($1,$2) AS shared',
    [userId, conversationId],
  )
  return rows[0]?.shared === true
}

async function requestTelemetry(db: Queryable, userId: string, requestId: string): Promise<Record<string, unknown>> {
  const { rows } = await db.query<{ data: Record<string, unknown> | null }>(
    'SELECT public.decke_improvement_request_telemetry($1,$2) AS data',
    [userId, requestId],
  )
  const telemetry = rows[0]?.data
  if (!telemetry) throw new Error('request_unavailable')
  return telemetry
}

function backfillTranscript(seq: number, turns: BackfillTurn[]): Record<string, unknown> {
  const turn = turns.find((candidate) => candidate.seq === seq)
  return {
    asked: turn?.asked ?? '',
    answered: turn?.answered ?? '',
    tool_calls: [],
  }
}

function boundPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const encoded = JSON.stringify(payload)
  if (Buffer.byteLength(encoded) <= MAX_PAYLOAD_BYTES) return payload
  const toolCalls = Array.isArray(payload.tool_calls) ? payload.tool_calls : []
  const bounded = {
    ...payload,
    tool_calls: toolCalls.map((call) => {
      if (!call || typeof call !== 'object') return call
      const item = call as Record<string, unknown>
      return { ...item, output: truncation(item.output) }
    }),
    payload_truncation: {
      original_bytes: Buffer.byteLength(encoded),
      sha256: createHash('sha256').update(encoded).digest('hex'),
    },
  }
  if (Buffer.byteLength(JSON.stringify(bounded)) <= MAX_PAYLOAD_BYTES) return bounded
  return {
    ...bounded,
    asked: truncation(payload.asked),
    answered: truncation(payload.answered),
    error: truncation(payload.error),
  }
}

function truncation(value: unknown): Record<string, unknown> {
  const encoded = JSON.stringify(value)
  return {
    truncated: true,
    original_bytes: Buffer.byteLength(encoded),
    sha256: createHash('sha256').update(encoded).digest('hex'),
  }
}

function safeErrorCode(error: unknown): string {
  if (!error || typeof error !== 'object') return 'unknown'
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(code) ? code : 'error'
}
