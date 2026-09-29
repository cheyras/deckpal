import { Router, type Request, type RequestHandler } from 'express';
import type { Queryable } from '@deckpal/db';
import { backfillShared, loadIdentityTerms, type SharedBackfill } from '../decke/improvement.js';
import { redact } from '../decke/redact.js';
import { rlsStore, withTx } from '../db.js';
import { ApiError, asyncHandler, UUID_RE } from '../http.js';
import { currentUserId } from '../identity.js';
import { perUserRateLimit } from '../rateLimit.js';

type JsonObject = Record<string, unknown>;

export interface ImprovementRouteDeps {
  run<T>(req: Request, work: (db: Queryable) => Promise<T>): Promise<T>;
  backfill(db: Queryable, input: { userId: string; conversationId: string; backfill: SharedBackfill }): Promise<boolean>;
  terms(db: Queryable, userId: string): Promise<string[]>;
  clean(value: unknown, terms: readonly string[]): unknown;
}

const SOURCES = new Set(['decke_ask', 'feedback', 'reader']);
const EVENT_KINDS = new Set(['animation', 'browser_tool', 'notice', 'error', 'timing', 'approval_ui']);
const LIST_FILTERS = new Set(['from', 'to', 'build_sha', 'build_pr', 'vote', 'min_cost', 'max_cost', 'has_error', 'model', 'tool']);
const MAX_EVENTS_BYTES = 512 * 1024;
const MAX_INT = 2_147_483_647;

function invalid(message: string): ApiError {
  return new ApiError(400, 'invalid_improvement_payload', message);
}

function uuid(value: unknown, field = 'conversationId'): string {
  if (typeof value !== 'string' || !UUID_RE.test(value)) throw invalid(`${field} must be a uuid.`);
  return value;
}

function nonNegativeInt(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > MAX_INT) {
    throw invalid(`${field} must be a non-negative integer.`);
  }
  return value;
}

function bodyObject(value: unknown): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid('A JSON object is required.');
  return value as JsonObject;
}

function mapDatabaseError(error: unknown): never {
  const code = (error as { code?: string }).code;
  if (code?.startsWith('22')) throw new ApiError(400, 'invalid_improvement_payload', (error as Error).message);
  if (code === '42501') throw new ApiError(403, 'forbidden', 'You do not have permission to access Deck-E improvement data.');
  if (code === 'P0002') throw new ApiError(404, 'not_found', (error as Error).message);
  throw error;
}

async function defaultRun<T>(req: Request, work: (db: Queryable) => Promise<T>): Promise<T> {
  try {
    return await withTx(async (client) => {
      // The SQL contract accepts a browser session or an explicitly capable PAT.
      // Preserve the verified identity established by auth middleware and add the
      // token row id; a caller-supplied capability bit is intentionally absent.
      const existing = rlsStore.getStore()
        ? (await client.query<{ claims: string }>("SELECT current_setting('request.jwt.claims',true) AS claims")).rows[0]?.claims
        : undefined;
      const claims = existing ? JSON.parse(existing) as JsonObject : {};
      const userId = currentUserId(req);
      await client.query("SELECT set_config('request.jwt.claims',$1,true)", [JSON.stringify({
        ...claims,
        sub: userId,
        role: claims.role ?? 'local',
        deckpal_auth_kind: req.authKind ?? 'local',
        deckpal_server_request: true,
        ...(req.apiTokenId ? { deckpal_token_id: req.apiTokenId } : {}),
      })]);
      return await work(client);
    });
  } catch (error) {
    return mapDatabaseError(error);
  }
}

const defaultDeps: ImprovementRouteDeps = {
  run: defaultRun,
  backfill: backfillShared,
  terms: loadIdentityTerms,
  clean: redact,
};

async function call<T>(db: Queryable, sql: string, params: unknown[] = []): Promise<T> {
  const row = (await db.query<{ data: T }>(sql, params)).rows[0];
  if (!row) throw new Error('Missing database response');
  return row.data;
}

function publicConsent(result: JsonObject): JsonObject {
  // `answer` returns raw History rows for the trusted backfill helper. Neither
  // those rows nor the stable corpus pseudonym belongs in a browser response.
  return { status: result.status, source: result.source };
}

export function listFilters(query: Record<string, unknown>): JsonObject {
  const filters: JsonObject = {};
  for (const [key, value] of Object.entries(query)) {
    if (key === 'cursor' || key === 'limit' || value === undefined || value === '') continue;
    if (!LIST_FILTERS.has(key) || typeof value !== 'string' || value.length > 160) throw invalid('Invalid improvement filter.');
    if ((key === 'from' || key === 'to') && !isUtcDay(value)) throw invalid(`${key} must be a YYYY-MM-DD UTC day.`);
    if (key === 'min_cost' || key === 'max_cost') {
      if (!/^\d+(?:\.\d{1,2})?$/.test(value)) {
        throw invalid(`${key} must be a non-negative USD amount with at most 2 decimal places.`);
      }
      const cost = Number(value);
      if (!Number.isFinite(cost)) throw invalid(`${key} must be a finite USD amount.`);
      filters[key] = cost;
      continue;
    }
    if (key === 'has_error' && value !== 'true' && value !== 'false') throw invalid('has_error must be true or false.');
    if (key === 'vote' && value !== '-1' && value !== '1') throw invalid('vote must be -1 or 1.');
    filters[key] = value;
  }
  return filters;
}

function isUtcDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

async function requireBackfill(
  deps: ImprovementRouteDeps,
  db: Queryable,
  input: { userId: string; conversationId: string; backfill: SharedBackfill },
): Promise<void> {
  // Throw inside deps.run so its transaction rolls the consent/feedback write
  // back instead of acknowledging an empty shared transcript.
  if (!await deps.backfill(db, input)) throw new Error('Deck-E improvement backfill failed');
}

function boundedLimit(value: unknown, fallback: number, max: number): number {
  if (value === undefined || value === '') return fallback;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) throw invalid('limit must be a positive integer.');
  const limit = Number(value);
  if (limit < 1 || limit > max) throw invalid(`limit must be between 1 and ${max}.`);
  return limit;
}

function scalar(value: unknown, field: string, max = 300): string | null {
  if (value === undefined || value === '') return null;
  if (typeof value !== 'string' || value.length > max) throw invalid(`Invalid ${field}.`);
  return value;
}

function markdownValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

export function renderImprovementMarkdown(detail: JsonObject): string {
  const conversation = bodyObject(detail.conversation);
  const turns = Array.isArray(detail.turns) ? detail.turns : [];
  const lines = [
    '# Deck-E shared conversation',
    '',
    `- Date (UTC): ${markdownValue(conversation.date)}`,
    `- Build: ${markdownValue(conversation.buildFirst)} → ${markdownValue(conversation.buildLast)}`,
    `- Cost: ${markdownValue(conversation.costUsd)} USD (${markdownValue(conversation.costCoverage)})`,
    '',
  ];
  for (const raw of turns) {
    const turn = bodyObject(raw);
    lines.push(`## Turn ${markdownValue(turn.seq)} (+${markdownValue(turn.offsetSeconds)} s)`, '', '**Reader**', '', markdownValue(turn.asked), '', '**Deck-E**', '', markdownValue(turn.answered), '');
    if (turn.feedback !== null && turn.feedback !== undefined) {
      lines.push(`Feedback: ${Number(turn.feedback) > 0 ? 'thumbs up' : 'thumbs down'}${turn.feedbackComment ? ` — ${markdownValue(turn.feedbackComment)}` : ''}`, '');
    }
    const legs = Array.isArray(turn.legs) ? turn.legs : [];
    for (const rawLeg of legs) {
      const leg = bodyObject(rawLeg);
      lines.push(`### Model leg ${markdownValue(leg.leg)}`, '', `Model: ${markdownValue(leg.modelId)}; status: ${markdownValue(leg.status)}; cost bucket: ${markdownValue(leg.costUsd)} USD`, '');
      const tools = Array.isArray(leg.tool_calls) ? leg.tool_calls : Array.isArray(leg.toolCalls) ? leg.toolCalls : [];
      if (tools.length) lines.push('Tool calls:', '```json', JSON.stringify(tools, null, 2), '```', '');
      if (leg.error) lines.push('Error:', '```json', JSON.stringify(leg.error, null, 2), '```', '');
    }
    const events = Array.isArray(turn.events) ? turn.events : [];
    if (events.length) lines.push('### Animation and browser timeline', '', '```json', JSON.stringify(events, null, 2), '```', '');
  }
  return lines.join('\n').trimEnd() + '\n';
}

export function createDeckeImprovementRouter(
  deps: ImprovementRouteDeps = defaultDeps,
  telemetryLimit: RequestHandler = perUserRateLimit('decke-telemetry', 120, 60_000),
): Router {
  const router = Router();
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'private, no-store'); next(); });

  router.post('/improvement/consent', asyncHandler(async (req, res) => {
    const body = bodyObject(req.body);
    const conversationId = uuid(body.conversationId);
    if (typeof body.share !== 'boolean') throw invalid('share must be a boolean.');
    if (typeof body.source !== 'string' || !SOURCES.has(body.source)) throw invalid('Invalid consent source.');
    const userId = currentUserId(req);
    const result = await deps.run(req, async (db) => {
      const answer = await call<JsonObject>(db, 'SELECT public.decke_improvement_answer($1,$2,$3,$4) AS data', [userId, conversationId, body.share, body.source]);
      if (body.share) await requireBackfill(deps, db, { userId, conversationId, backfill: (answer.backfill ?? {}) as SharedBackfill });
      return answer;
    });
    res.json(publicConsent(result));
  }));

  router.delete('/improvement/consent/:conversationId', asyncHandler(async (req, res) => {
    const conversationId = uuid(req.params.conversationId);
    const userId = currentUserId(req);
    res.json(await deps.run(req, (db) => call(db, 'SELECT public.decke_improvement_revoke($1,$2) AS data', [userId, conversationId])));
  }));

  router.get('/improvement/mine', asyncHandler(async (req, res) => {
    const userId = currentUserId(req);
    res.json(await deps.run(req, (db) => call(db, 'SELECT public.decke_improvement_list_mine($1) AS data', [userId])));
  }));

  router.post('/telemetry', telemetryLimit, asyncHandler(async (req, res) => {
    const body = bodyObject(req.body);
    const conversationId = uuid(body.conversationId);
    const seq = nonNegativeInt(body.seq, 'seq');
    const batch = nonNegativeInt(body.batch, 'batch');
    if (!Array.isArray(body.events) || body.events.length < 1 || body.events.length > 200) throw invalid('events must contain between 1 and 200 items.');
    const rawEvents = body.events;
    const byteLength = Buffer.byteLength(JSON.stringify(rawEvents), 'utf8');
    if (byteLength > MAX_EVENTS_BYTES) throw new ApiError(413, 'payload_too_large', 'Telemetry events exceed 512 KiB.');
    for (const raw of rawEvents) {
      const event = bodyObject(raw);
      if (typeof event.kind !== 'string' || !EVENT_KINDS.has(event.kind)) throw invalid('Invalid telemetry event kind.');
      if (typeof event.at !== 'string' || !Object.hasOwn(event, 'payload')) throw invalid('Each telemetry event needs at and payload.');
    }
    const userId = currentUserId(req);
    const result = await deps.run(req, async (db) => {
      const terms = await deps.terms(db, userId);
      const events = rawEvents.map((raw) => {
        const event = raw as JsonObject;
        return { kind: event.kind, at: event.at, payload: deps.clean(event.payload, terms) };
      });
      return call<JsonObject>(db, 'SELECT public.decke_improvement_record_events($1,$2,$3,$4,$5::jsonb) AS data', [userId, conversationId, seq, batch, JSON.stringify(events)]);
    });
    res.status(202).json({ recorded: result.recorded === true });
  }));

  // The reader's own votes for one conversation, for their read-only History
  // transcript. Served here rather than joined into /decke/history so personal
  // History does not depend on the improvement schema; RLS limits the rows to
  // the caller's own feedback.
  router.get('/feedback/:conversationId', asyncHandler(async (req, res) => {
    const conversationId = uuid(req.params.conversationId);
    const userId = currentUserId(req);
    const rows = await deps.run(req, async (db) => (await db.query<{ seq: number; vote: number | null; comment: string | null }>(
      'SELECT seq,vote,comment FROM public.decke_turn_feedback WHERE user_id=$1 AND conversation_id=$2 ORDER BY seq',
      [userId, conversationId],
    )).rows);
    res.json({
      items: rows.map((row) => ({
        seq: Number(row.seq),
        vote: row.vote === null ? null : Number(row.vote),
        comment: row.comment ?? null,
      })),
    });
  }));

  router.put('/feedback', asyncHandler(async (req, res) => {
    const body = bodyObject(req.body);
    const conversationId = uuid(body.conversationId);
    const seq = nonNegativeInt(body.seq, 'seq');
    if (body.vote !== null && body.vote !== 1 && body.vote !== -1) throw invalid('vote must be 1, -1, or null.');
    if (body.comment !== undefined && typeof body.comment !== 'string') throw invalid('comment must be a string.');
    if (typeof body.comment === 'string' && body.comment.length > 500) throw invalid('comment must be at most 500 characters.');
    if (body.share !== undefined && typeof body.share !== 'boolean') throw invalid('share must be a boolean.');
    const share = body.share === true;
    const userId = currentUserId(req);
    const result = await deps.run(req, async (db) => {
      // record_feedback can grant consent itself, but its SQL-internal answer
      // deliberately cannot run the API redaction/backfill pass. Grant here so
      // the trusted helper sees the raw rows before feedback is copied.
      if (share) {
        const answer = await call<JsonObject>(db, 'SELECT public.decke_improvement_answer($1,$2,true,\'feedback\') AS data', [userId, conversationId]);
        await requireBackfill(deps, db, { userId, conversationId, backfill: (answer.backfill ?? {}) as SharedBackfill });
      }
      return call<JsonObject>(db, 'SELECT public.decke_improvement_record_feedback($1,$2,$3,$4,$5,$6) AS data', [userId, conversationId, seq, body.vote, body.comment ?? null, share]);
    });
    res.json(result);
  }));

  return router;
}

export function createDeckeImprovementAdminRouter(deps: ImprovementRouteDeps = defaultDeps): Router {
  const router = Router();
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'private, no-store'); next(); });

  router.get('/search', asyncHandler(async (req, res) => {
    const query = scalar(req.query.q, 'q', 100);
    if (!query || query.trim().length < 2) throw invalid('q must contain between 2 and 100 characters.');
    const limit = boundedLimit(req.query.limit, 25, 50);
    res.json(await deps.run(req, (db) => call(db, 'SELECT public.decke_improvement_search($1,$2) AS data', [query.trim(), limit])));
  }));

  router.get('/:id', asyncHandler(async (req, res) => {
    const id = uuid(req.params.id, 'id');
    const format = scalar(req.query.format, 'format', 20);
    if (format !== null && format !== 'markdown') throw invalid('format must be markdown.');
    const detail = await deps.run(req, (db) => call<JsonObject>(db, 'SELECT public.decke_improvement_detail($1) AS data', [id]));
    if (format === 'markdown') {
      res.type('text/markdown').send(renderImprovementMarkdown(detail));
      return;
    }
    res.json(detail);
  }));

  router.get('/', asyncHandler(async (req, res) => {
    const filters = listFilters(req.query);
    const cursor = scalar(req.query.cursor, 'cursor', 300);
    const limit = boundedLimit(req.query.limit, 50, 100);
    const result = await deps.run(req, (db) => call<{ items: unknown[]; nextCursor: string | null }>(db, 'SELECT public.decke_improvement_list($1::jsonb,$2,$3) AS data', [JSON.stringify(filters), cursor, limit]));
    if (req.accepts(['json', 'application/x-ndjson']) === 'application/x-ndjson') {
      res.type('application/x-ndjson');
      for (const item of result.items) res.write(JSON.stringify(item) + '\n');
      res.end(JSON.stringify({ nextCursor: result.nextCursor }) + '\n');
      return;
    }
    res.json(result);
  }));

  return router;
}

export const deckeImprovementRouter = createDeckeImprovementRouter();
export const deckeImprovementAdminRouter = createDeckeImprovementAdminRouter();
