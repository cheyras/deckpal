import { createHash } from 'node:crypto';
import type pg from 'pg';
import { ApiError } from './http.js';

/**
 * The mutation log (migration 036) — the write side.
 *
 * Every mutating route opens a batch, records one event per thing it changed
 * with a `before` and an `after`, and closes the batch with the exact response
 * the caller is about to receive. Reads and reverts live in
 * `routes/mutations.ts`.
 *
 * ## Idempotency, and why it is bucketed
 *
 * `mutation_batch` has `UNIQUE (user_id, idempotency_key)`. A retry that
 * carries the same key collides on that index and gets the stored response
 * back instead of applying its writes a second time. That is the whole
 * mechanism, and it is what turns "the connector timed out, should I retry?"
 * from a data-corruption risk into a safe no-op.
 *
 * The subtlety is where the key comes from when the caller has none — which is
 * the common case, because a client whose *response* was lost never learned a
 * key to resend.
 *
 * Deriving it from the request content alone is wrong in both directions:
 *
 *   • Too sticky. "+1 Pikachu" logged today and again next month is two real
 *     acquisitions, not a retry. A content-forever key silently swallows the
 *     second — the same dishonesty this whole workstream exists to remove,
 *     inverted.
 *   • Too loose if the note is hashed in. An agent that rewrites its note on
 *     retry ("batch 1" → "batch 1 retry") produces a different key and double
 *     applies.
 *
 * So: the note is excluded, the content fingerprint is computed over the
 * *resolved, folded* operations (so `card_id` and `name` phrasings of the same
 * retry collapse to one value), and the stored key is
 * `<fingerprint>#<15-minute bucket>`. A lookup checks the current and previous
 * bucket, which makes a retry inside ~15–30 minutes a replay and the same
 * request next month a new batch. `request_fingerprint` is stored separately
 * *without* the bucket, so a batch that is allowed to apply can still be
 * flagged: "an identical batch was applied 2 days ago — is this a retry?"
 *
 * A caller-supplied key skips all of that and is honoured indefinitely: if you
 * name your own idempotency, it is yours to scope.
 */

// ── Attribution (migration 018) ──────────────────────────────────────────────
// Every event carries WHO wrote it. The shape mirrors the DB CHECK exactly, so
// a bad value is a 400 here rather than a 500 out of Postgres.

export const SOURCE_SHAPE = /^[a-z0-9][a-z0-9._-]{0,39}$/;

/** Writer attribution; omitted → 'web' (the UI, matching the column default). */
export function parseSource(v: unknown): string {
  if (v === undefined || v === null) return 'web';
  if (typeof v !== 'string' || !SOURCE_SHAPE.test(v)) {
    throw new ApiError(400, 'bad_request', "source must match ^[a-z0-9][a-z0-9._-]{0,39}$ (e.g. 'web', 'deckpal-mcp')");
  }
  return v;
}

/** Optional free-text note: trimmed, ≤500 chars, empty → null (never stored as ''). */
export function parseNote(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') throw new ApiError(400, 'bad_request', 'note must be a string');
  const trimmed = v.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > 500) throw new ApiError(400, 'bad_request', 'note too long (max 500 chars)');
  return trimmed;
}

// ── Vocabulary ───────────────────────────────────────────────────────────────

export type EntityType =
  | 'collection_item'
  | 'card_list'
  | 'list_item'
  | 'deck'
  | 'deck_card'
  | 'deck_strategy'
  | 'battle_log';

/** Everything that can appear in `mutation_event.operation`. */
export const OPS = {
  quantityDelta: 'quantity.delta',
  quantitySet: 'quantity.set',
  listCreate: 'list.create',
  listRename: 'list.rename',
  listItemAdd: 'list.item.add',
  listItemRemove: 'list.item.remove',
  listRuleSet: 'list.rule.set',
  listRuleExclude: 'list.rule.exclude',
  listDelete: 'list.delete',
  listRestore: 'list.restore',
  listPurge: 'list.purge',
  deckDelete: 'deck.delete',
  deckRestore: 'deck.restore',
  deckPurge: 'deck.purge',
  deckStrategySet: 'deck.strategy.set',
  deckCards: 'deck.cards',
  battleLogCreate: 'battle_log.create',
  battleLogEdit: 'battle_log.edit',
  battleLogDelete: 'battle_log.delete',
} as const;

export interface MutationEventInput {
  entityType: EntityType;
  entityId: string;
  operation: string;
  before: unknown;
  after: unknown;
  requestedDelta?: number | null;
  effectiveDelta?: number | null;
  revertsEventId?: number | null;
}

export interface OpenBatchOptions {
  userId: string;
  source: string;
  tool: string;
  note?: string | null;
  /** Caller-supplied key — honoured indefinitely, never bucketed. */
  idempotencyKey?: string | null;
  /** Server-derived content hash, bucketed into the stored key. */
  fingerprint?: string | null;
  revertsBatchId?: string | null;
}

export interface StoredBatch {
  id: string;
  status: string;
  response: unknown;
  started_at: string;
  finished_at: string | null;
  note: string | null;
}

/** Thrown when a batch with this idempotency key already committed. */
export class ReplayError extends Error {
  constructor(public readonly batch: StoredBatch) {
    super('replay');
    this.name = 'ReplayError';
  }
}

// ── Fingerprinting ───────────────────────────────────────────────────────────

/** 15 minutes, in ms. Two buckets are checked, so the practical replay window is 15–30 min. */
export const BUCKET_MS = 15 * 60 * 1000;

/**
 * A stable hash of the *resolved, folded* operations. Sorting by the numeric
 * key means the same intent expressed in a different item order hashes the
 * same — which is what a retry looks like when an agent regenerates its list.
 */
export function fingerprintOps(userId: string, ops: ReadonlyArray<{ key: string | number; op: string; value: number }>): string {
  const canonical = [...ops]
    .map((o) => `${String(o.key)}:${o.op}:${o.value}`)
    .sort()
    .join('|');
  return createHash('sha256').update(`${userId}\u0000${canonical}`).digest('hex');
}

/** `<fingerprint>#<bucket>` — the value actually stored in `idempotency_key`. */
export function bucketedKey(fingerprint: string, atMs: number = Date.now()): string {
  return `${fingerprint}#${Math.floor(atMs / BUCKET_MS)}`;
}

/** The current and previous bucket keys, newest first. */
export function candidateKeys(fingerprint: string, atMs: number = Date.now()): string[] {
  return [bucketedKey(fingerprint, atMs), bucketedKey(fingerprint, atMs - BUCKET_MS)];
}

// ── Batch lifecycle ──────────────────────────────────────────────────────────

/**
 * Look for a committed batch under any of `keys`. Used *before* doing work so
 * the common replay costs one indexed SELECT rather than a full re-derivation
 * that then collides.
 */
export async function findCommittedBatch(
  client: pg.PoolClient,
  userId: string,
  keys: readonly string[],
): Promise<StoredBatch | null> {
  if (keys.length === 0) return null;
  const { rows } = await client.query<StoredBatch>(
    `SELECT id, status, response, started_at, finished_at, note
       FROM mutation_batch
      WHERE user_id = $1 AND idempotency_key = ANY($2::text[]) AND status = 'committed'
      ORDER BY started_at DESC
      LIMIT 1`,
    [userId, keys],
  );
  return rows[0] ?? null;
}

/**
 * The most recent committed batch with this content fingerprint, whatever its
 * bucket. Used only to WARN — "you applied this exact request 2 days ago" —
 * never to suppress a write.
 */
export async function findFingerprintEcho(
  client: pg.PoolClient,
  userId: string,
  fingerprint: string,
): Promise<StoredBatch | null> {
  const { rows } = await client.query<StoredBatch>(
    `SELECT id, status, response, started_at, finished_at, note
       FROM mutation_batch
      WHERE user_id = $1 AND request_fingerprint = $2 AND status = 'committed'
      ORDER BY started_at DESC
      LIMIT 1`,
    [userId, fingerprint],
  );
  return rows[0] ?? null;
}

/**
 * Insert the batch row — the FIRST statement of the writing transaction, so the
 * unique index engages before anything is changed.
 *
 * A concurrent duplicate blocks here on the index rather than racing ahead, and
 * when the winner commits the loser's insert raises 23505 with nothing of its
 * own written. That is why this must run inside the same transaction as the
 * work: a rollback takes the key with it, so a failed batch never blocks a
 * retry.
 *
 * @throws ReplayError when the key already belongs to a committed batch.
 */
export async function openBatch(client: pg.PoolClient, o: OpenBatchOptions): Promise<string> {
  const key = o.idempotencyKey ?? (o.fingerprint ? bucketedKey(o.fingerprint) : null);
  try {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO mutation_batch (user_id, source, tool, note, idempotency_key, request_fingerprint, status, reverts_batch_id)
            VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7)
         RETURNING id`,
      [o.userId, o.source, o.tool, o.note ?? null, key, o.fingerprint ?? null, o.revertsBatchId ?? null],
    );
    return rows[0]!.id;
  } catch (err) {
    if ((err as { code?: string }).code !== '23505') throw err;
    // The winner committed while we waited. Its response is the truth; ours
    // never happened. The caller's savepoint unwinds around this throw.
    throw new ReplayError({ id: '', status: 'committed', response: null, started_at: '', finished_at: null, note: null });
  }
}

/** Append this batch's events. One statement regardless of count. */
export async function recordEvents(
  client: pg.PoolClient,
  batchId: string,
  userId: string,
  events: readonly MutationEventInput[],
): Promise<void> {
  if (events.length === 0) return;
  const values: string[] = [];
  const params: unknown[] = [batchId, userId];
  for (const e of events) {
    const base = params.length;
    values.push(
      `($1, $2, $${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}::jsonb, $${base + 5}::jsonb, $${base + 6}, $${base + 7}, $${base + 8})`,
    );
    params.push(
      e.entityType,
      e.entityId,
      e.operation,
      e.before === undefined ? null : JSON.stringify(e.before),
      e.after === undefined ? null : JSON.stringify(e.after),
      e.requestedDelta ?? null,
      e.effectiveDelta ?? null,
      e.revertsEventId ?? null,
    );
  }
  await client.query(
    `INSERT INTO mutation_event
       (batch_id, user_id, entity_type, entity_id, operation, before, after, requested_delta, effective_delta, reverts_event_id)
     VALUES ${values.join(', ')}`,
    params,
  );
}

/**
 * Mark the batch committed and store the response the caller is about to get.
 * Storing the RESPONSE, not just the inputs, is what makes a replay
 * indistinguishable from the original success.
 */
export async function closeBatch(
  client: pg.PoolClient,
  batchId: string,
  response: unknown,
  summary?: unknown,
): Promise<void> {
  await client.query(
    `UPDATE mutation_batch
        SET status = 'committed', response = $2::jsonb, summary = $3::jsonb, finished_at = now()
      WHERE id = $1`,
    [batchId, JSON.stringify(response ?? null), JSON.stringify(summary ?? null)],
  );
}

/**
 * Read back a committed batch's stored response — the second half of the replay
 * path, run after the writing savepoint has unwound.
 */
export async function loadBatchResponse(
  client: pg.PoolClient,
  userId: string,
  keys: readonly string[],
): Promise<StoredBatch> {
  const found = await findCommittedBatch(client, userId, keys);
  if (!found) {
    // The winner rolled back between our 23505 and this read, or is still in
    // flight. Either way the caller should try again rather than be told
    // something happened that may not have.
    throw new ApiError(
      409,
      'batch_in_flight',
      'An identical batch is being applied right now. Retry in a moment — the idempotency key makes that safe.',
    );
  }
  return found;
}
