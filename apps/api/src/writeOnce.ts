import type pg from 'pg';
import { withTx } from './db.js';
import { ApiError } from './http.js';
import { findCommittedBatch, loadBatchResponse, openBatch, ReplayError } from './mutations.js';

/**
 * At most once per key: the API half of making every approved Deck-E write
 * idempotent by its signed tool call.
 *
 * ## The gap this closes
 *
 * A held write runs when the browser resumes the turn with the reader's signed
 * approval. If that POST arrives twice — a retry after a network blip, a reload
 * mid-turn, the same approval with one body field changed — the request key
 * (`chatChargeReference`) only stops the byte-identical one, and the SDK runs
 * the tool again. Until this, only `log_cards` was protected (its call key rides
 * in the body); a second run of `add_battle_log` added a second log, a revert
 * made one more deck version, a static list's bulk add doubled its rows.
 *
 * ## The mechanism is the mutation log's own
 *
 * `mutation_batch` already has `UNIQUE (user_id, idempotency_key)` and keeps
 * the response it gave (migration 036). That is what `/collection/batch` has
 * always replayed from, and it generalises: a keyed write opens its batch WITH
 * the key as the first statement of its transaction, the route's events land in
 * that batch, and the batch is closed with the transaction's own return value.
 * The key therefore commits exactly when the write does. A concurrent duplicate
 * blocks on the unique index and then replays; a failed write takes its key
 * with it, so a retry is free to run.
 *
 * Every path that commits closes the keyed batch, including the ones that
 * change nothing ("already deleted", "nothing to restore"). That is deliberate:
 * a replay of an approved restore must not undo a delete the reader made after
 * it, so "it did nothing the first time" has to be remembered too.
 *
 * ## Where the key comes from, and what happens without one
 *
 * The `Idempotency-Key` header. Deck-E's adapter derives one per write request
 * from the signed call id (`approvedWriteKey`, `keyedApi`); nothing else in this
 * codebase sends it. A request WITHOUT the header runs exactly the code it ran
 * before this existed: the same transaction, the same unkeyed batches (or none),
 * the same response body. That is the MCP server, the web app and any script.
 *
 * A key is honoured indefinitely and is never bucketed or reinterpreted: it
 * names one approved call, and that call's write happens once.
 */

export const IDEMPOTENCY_HEADER = 'Idempotency-Key';
const KEY_MAX = 200;

/**
 * The request's per-call write key, or null when it sent none.
 *
 * Over-long is a 400 rather than a truncation, for the same reason as
 * `/collection/batch`'s body key: two keys sharing a prefix must not collide
 * and have the loser told its write was a replay.
 */
export function requestWriteKey(req: { get(name: string): string | undefined }): string | null {
  const raw = req.get(IDEMPOTENCY_HEADER);
  if (raw === undefined) return null;
  const key = raw.trim();
  if (!key) return null;
  if (key.length > KEY_MAX) {
    throw new ApiError(400, 'bad_request', `${IDEMPOTENCY_HEADER} must be ${KEY_MAX} characters or fewer`);
  }
  return key;
}

export interface Once<T> {
  /**
   * What the write transaction returned. On a keyed request this is the
   * JSON round-trip of it, on the fresh run and on a replay alike, so the
   * route builds its response from the same shape either way.
   */
  value: T;
  replayed: boolean;
}

/**
 * Run one write transaction, at most once per key.
 *
 * `work` gets the transaction's client and, when keyed, the id of the batch
 * that holds the key. A route that opens its own batch must use that one
 * instead (`keyedBatchId ?? await openBatch(…)`), so its events land beside
 * the key and there is never a second keyed batch to collide with. A route
 * that opens none may record its events into it.
 *
 * Without a key this is `withTx(client => work(client, null))`, nothing more.
 */
export async function writeOnce<T>(
  userId: string,
  key: string | null,
  batch: { source: string; tool: string; note?: string | null },
  work: (client: pg.PoolClient, keyedBatchId: string | null) => Promise<T>,
): Promise<Once<T>> {
  if (key === null) return { value: await withTx((client) => work(client, null)), replayed: false };

  // The common replay costs one indexed read, before any of the work.
  const prior = await withTx((client) => findCommittedBatch(client, userId, [key]));
  if (prior) return { value: prior.response as T, replayed: true };

  try {
    const value = await withTx(async (client) => {
      // FIRST write of the transaction: claim the key before anything changes.
      const batchId = await openBatch(client, { userId, ...batch, idempotencyKey: key });
      const out = await work(client, batchId);
      const stored = JSON.parse(JSON.stringify(out ?? null)) as T;
      // `summary` is the route's, if it wrote one; only the response and the
      // status are ours.
      await client.query(
        `UPDATE mutation_batch
            SET status = 'committed', response = $2::jsonb, finished_at = COALESCE(finished_at, now())
          WHERE id = $1`,
        [batchId, JSON.stringify(stored)],
      );
      return stored;
    });
    return { value, replayed: false };
  } catch (err) {
    if (!(err instanceof ReplayError)) throw err;
    // A concurrent run with this key committed while we waited on the index.
    const stored = await withTx((client) => loadBatchResponse(client, userId, [key]));
    return { value: stored.response as T, replayed: true };
  }
}

/**
 * `{ replayed }` for a keyed response, and nothing for an unkeyed one, so a
 * request without the header gets a body byte-identical to before.
 */
export function replayField(key: string | null, once: { replayed: boolean }): { replayed?: boolean } {
  return key === null ? {} : { replayed: once.replayed };
}
