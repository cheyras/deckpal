import { Router } from 'express';
import type pg from 'pg';
import { cardImages, commitRequestTx, q, recomputeSetProgress, withTx, type SetProgress } from '../db.js';
import { asyncHandler, badRequest, clampInt, notFound, str, userCache } from '../http.js';
import { currentUserId } from '../identity.js';
import {
  candidateKeys,
  closeBatch,
  fingerprintOps,
  findCommittedBatch,
  findFingerprintEcho,
  loadBatchResponse,
  openBatch,
  OPS,
  parseNote,
  parseSource,
  recordEvents,
  ReplayError,
  type MutationEventInput,
} from '../mutations.js';

export const collectionRouter: Router = Router();

/**
 * Collection write endpoints (Phase 3 · task 3). These are the ONLY writers in the
 * app; every other route is read-only. All under /deckpal/api/collection.
 *
 * A mutation, in ONE transaction (withTx): upsert collection_item to the new
 * quantity, append a collection_event for the non-zero delta, then recompute the
 * affected set's three user_set_progress rows (SCHEMA §9.3 — progress is
 * materialised, invalidated on collection mutation). Idempotent: setting the same
 * quantity writes no event and just returns current state. Parameterized only.
 *
 * The single default user owns the collection (no auth in self-host; reverse proxy is the ingress).
 */

interface VariantLookup {
  id: string;
  card_id: string;
  card_tcgdex_id: string;
  set_id: string;
  set_tcgdex_id: string;
}

interface CardVariantQty {
  variant_id: string;
  quantity: number;
}

interface MutationResult {
  variantId: number;
  quantity: number;
  delta: number;
  isFirstAcquisition: boolean;
  card: {
    cardId: string;
    variants: { variantId: number; quantity: number }[];
    ownership: { totalQuantity: number; have: boolean; need: boolean; dupe: boolean };
  };
  setId: string;
  progress: SetProgress;
}

/** Clamp/validate a requested quantity: a non-negative integer, capped defensively. */
function parseQuantity(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isInteger(n)) throw badRequest('quantity must be an integer');
  if (n < 0) throw badRequest('quantity must be >= 0');
  if (n > 100000) throw badRequest('quantity too large');
  return n;
}

/** Signed delta for increment/decrement; defaults to +1. */
function parseDelta(v: unknown): number {
  if (v === undefined || v === null) return 1;
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isInteger(n)) throw badRequest('delta must be an integer');
  if (n === 0) throw badRequest('delta must be non-zero');
  if (Math.abs(n) > 100000) throw badRequest('delta too large');
  return n;
}

// Attribution (migration 018) — `parseSource` / `parseNote` live in
// ../mutations.ts now, because every mutating route needs them, not just this one.

const SOURCE_SHAPE = /^[a-z0-9][a-z0-9._-]{0,39}$/;

/**
 * Apply a new absolute quantity to (user, variant) and recompute set progress, all
 * in one transaction. `resolveQty` maps the current quantity to the target — this
 * lets set (absolute) and increment (relative) share every downstream step.
 */
async function applyQuantity(
  userId: string,
  variantIdRaw: string,
  resolveQty: (current: number) => number,
  source: string,
  note: string | null,
  tool: string,
): Promise<MutationResult> {
  const variantId = Number(variantIdRaw);
  if (!Number.isInteger(variantId) || variantId <= 0) throw badRequest('variantId must be a positive integer');

  return withTx(async (client: pg.PoolClient) => {
    // Single-variant writes are logged too, so a stepper click in the web UI is
    // just as revertible as an agent's batch. No idempotency key: a stepper is
    // a human deciding to press again, not a retry of a lost response.
    const batchId = await openBatch(client, { userId, source, tool, note });
    // Validate the variant exists and resolve its card + set (for the recompute).
    const look = await client.query<VariantLookup>(
      `SELECT cv.id, cv.card_id, c.tcgdex_id AS card_tcgdex_id, c.set_id, cs.tcgdex_id AS set_tcgdex_id
         FROM card_variant cv
         JOIN card c ON c.id = cv.card_id
         JOIN card_set cs ON cs.id = c.set_id
        WHERE cv.id = $1`,
      [variantId],
    );
    const v = look.rows[0];
    if (!v) throw notFound(`No variant '${variantIdRaw}'`);

    // Lock the existing collection_item row (if any) so concurrent writers serialize.
    const existing = await client.query<{ quantity: number }>(
      `SELECT quantity FROM collection_item WHERE user_id = $1 AND card_variant_id = $2 FOR UPDATE`,
      [userId, variantId],
    );
    const current = existing.rows[0]?.quantity ?? 0;
    const target = resolveQty(current);
    const clamped = Math.max(0, Math.min(100000, target));
    const delta = clamped - current;

    let isFirstAcquisition = false;
    if (delta !== 0) {
      // Upsert the item to the new absolute quantity (qty-0 rows are kept per §9.1).
      await client.query(
        `INSERT INTO collection_item (user_id, card_variant_id, quantity, updated_at)
              VALUES ($1, $2, $3, now())
         ON CONFLICT (user_id, card_variant_id)
           DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = now()`,
        [userId, variantId, clamped],
      );
      // First acquisition = first time this (user,variant) ever reaches a positive qty.
      if (clamped > 0) {
        const prior = await client.query<{ n: string }>(
          `SELECT count(*) AS n FROM collection_event
            WHERE user_id = $1 AND card_variant_id = $2 AND quantity_after > 0`,
          [userId, variantId],
        );
        isFirstAcquisition = Number(prior.rows[0]?.n ?? 0) === 0;
      }
      // Append the activity log (delta <> 0 enforced above and by the CHECK).
      await client.query(
        `INSERT INTO collection_event (user_id, card_variant_id, delta, quantity_after, is_first_acquisition, source, note, batch_id)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [userId, variantId, delta, clamped, isFirstAcquisition, source, note, batchId],
      );
      await recordEvents(client, batchId, userId, [
        {
          entityType: 'collection_item',
          entityId: String(variantId),
          operation: tool === 'collection.set' ? OPS.quantitySet : OPS.quantityDelta,
          before: { quantity: current },
          after: { quantity: clamped },
          requestedDelta: target - current,
          effectiveDelta: delta,
        },
      ]);
    }

    // Recompute the three progress rows for this (user, set) in the same tx.
    const progress = await recomputeSetProgress(client, userId, Number(v.set_id));
    await closeBatch(client, batchId, { variantId, quantity: clamped, delta }, { applied: delta === 0 ? 0 : 1 });

    // Return the whole card's per-variant quantities + card-level (complete) ownership,
    // so the client can reconcile both the stepper and the tile without a refetch.
    const cardVariants = await client.query<CardVariantQty>(
      `SELECT cv.id AS variant_id, COALESCE(ci.quantity, 0) AS quantity
         FROM card_variant cv
    LEFT JOIN collection_item ci ON ci.card_variant_id = cv.id AND ci.user_id = $1
        WHERE cv.card_id = $2
        ORDER BY cv.sort_order`,
      [userId, v.card_id],
    );
    const totalQuantity = cardVariants.rows.reduce((s, r) => s + Number(r.quantity), 0);

    return {
      variantId,
      quantity: clamped,
      delta,
      isFirstAcquisition,
      card: {
        cardId: v.card_tcgdex_id,
        variants: cardVariants.rows.map((r) => ({ variantId: Number(r.variant_id), quantity: Number(r.quantity) })),
        ownership: {
          totalQuantity,
          have: totalQuantity >= 1,
          need: totalQuantity === 0,
          dupe: totalQuantity >= 2,
        },
      },
      setId: v.set_tcgdex_id,
      progress,
    };
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// POST /deckpal/api/collection/batch — MANY variants, ONE transaction
// ══════════════════════════════════════════════════════════════════════════════
//
// This endpoint exists because the per-variant endpoints above are the right
// shape for a stepper click and the wrong shape for a pack-opening haul.
//
// deckpal-mcp's `log_cards` used to call them in a loop: one HTTPS round trip
// per item, each opening its own transaction and recomputing the whole set's
// progress. Measured in production on 2026-08-19: **0.65 s per item**, flat. A
// 99-item batch therefore needs ~65 s, and the MCP serverless function's wall
// clock is 60 s. What the caller saw was a dead stream; what the database saw
// was 87–99 committed writes. The agent retried — reasonably, because the error
// said "the server isn't responding" — and quantities inflated up to 4x.
//
// So the cost has to go, not the timeout. Same 99 items here:
//
//   • one resolution query instead of 2N,
//   • one placeholder INSERT, one locking SELECT, one UPDATE, one
//     first-acquisition query, one event INSERT — regardless of item count,
//   • one `recomputeSetProgress` per DISTINCT SET rather than per item.
//
// ~25 round trips instead of ~1200, i.e. ~1–2 s for a full batch. The advertised
// cap becomes something the budget can actually deliver rather than a number
// that happened to sit 10% past the cliff.
//
// Everything lands in ONE transaction, so there is no such thing as a partially
// applied batch, and the response is only sent after an explicit COMMIT (see
// commitRequestTx) — this endpoint of all endpoints must not report success for
// a write that has not durably landed.
//
// Idempotency (migration 036): the batch row is inserted FIRST, so a duplicate
// key collides before anything changes and gets the original response back.

/** Hard ceilings. Both are about staying inside the API's own 30 s RLS hold. */
const BATCH_MAX_ITEMS = 250;
/** Distinct sets, not items, drive the cost: one full-set CTE recompute each. */
const BATCH_MAX_SETS = 40;

export interface BatchItemInput {
  variantId: number;
  delta?: number;
  quantity?: number;
}

/** What a folded item resolves to: either a signed delta or an absolute target. */
export interface FoldedOp {
  variantId: number;
  mode: 'delta' | 'set';
  /** Signed change (mode 'delta') or the change applied after the set (mode 'set'). */
  delta: number;
  /** Absolute target before `delta` is applied (mode 'set' only). */
  target?: number;
  /** Input indices that merged into this op, for the folding report. */
  from: number[];
}

function parseBatchItems(raw: unknown): BatchItemInput[] {
  if (!Array.isArray(raw) || raw.length === 0) throw badRequest('items must be a non-empty array');
  if (raw.length > BATCH_MAX_ITEMS) throw badRequest(`items must be ${BATCH_MAX_ITEMS} or fewer (got ${raw.length})`);
  return raw.map((r, i) => {
    if (r === null || typeof r !== 'object') throw badRequest(`items[${i}] must be an object`);
    const o = r as Record<string, unknown>;
    const vRaw = o.variantId ?? o.cardVariantId;
    const variantId = typeof vRaw === 'number' ? vRaw : Number(vRaw);
    if (!Number.isInteger(variantId) || variantId <= 0) throw badRequest(`items[${i}].variantId must be a positive integer`);
    const hasDelta = o.delta !== undefined && o.delta !== null;
    const hasQuantity = o.quantity !== undefined && o.quantity !== null;
    if (hasDelta === hasQuantity) throw badRequest(`items[${i}] needs exactly one of delta or quantity`);
    if (hasDelta) return { variantId, delta: parseDelta(o.delta) };
    return { variantId, quantity: parseQuantity(o.quantity) };
  });
}

/**
 * Merge repeated variants into one operation, in input order.
 *
 * Order matters and is defined: deltas accumulate; an absolute `quantity`
 * discards everything before it for that variant and becomes the new base; a
 * delta after an absolute adjusts that base. This is exactly what applying the
 * items one at a time would have done, which is the point — folding must be an
 * optimisation, never a semantic change.
 */
export function foldItems(items: readonly BatchItemInput[]): {
  ops: FoldedOp[];
  folded: Array<{ variantId: number; from: number[] }>;
} {
  const byVariant = new Map<number, FoldedOp>();
  const order: number[] = [];
  items.forEach((it, i) => {
    let op = byVariant.get(it.variantId);
    if (!op) {
      op = { variantId: it.variantId, mode: 'delta', delta: 0, from: [] };
      byVariant.set(it.variantId, op);
      order.push(it.variantId);
    }
    op.from.push(i);
    if (it.quantity !== undefined) {
      op.mode = 'set';
      op.target = it.quantity;
      op.delta = 0;
    } else {
      op.delta += it.delta!;
    }
  });
  const ops = order.map((v) => byVariant.get(v)!);
  return { ops, folded: ops.filter((o) => o.from.length > 1).map((o) => ({ variantId: o.variantId, from: o.from })) };
}

interface BatchVariantRow {
  id: string;
  card_id: string;
  card_tcgdex_id: string;
  set_id: string;
  set_tcgdex_id: string;
}

collectionRouter.post(
  '/batch',
  asyncHandler(async (req, res) => {
    const body = req.body ?? {};
    const userId = currentUserId(req);
    const source = parseSource(body.source);
    const note = parseNote(body.note);
    const dryRun = body.dryRun === true;
    const items = parseBatchItems(body.items);
    const { ops, folded } = foldItems(items);

    // Truncating would let two distinct keys sharing a 200-char prefix collide,
    // and the loser would be told its write was a replay. Reject instead.
    let callerKey: string | null = null;
    if (typeof body.idempotencyKey === 'string' && body.idempotencyKey.trim()) {
      const trimmed = body.idempotencyKey.trim() as string;
      if (trimmed.length > 200) throw badRequest('idempotencyKey must be 200 characters or fewer');
      callerKey = trimmed;
    }

    // The fingerprint is over the FOLDED ops — so the same intent expressed as
    // two `+1`s or one `+2`, or with the items in a different order, hashes the
    // same. The note is deliberately not part of it (see mutations.ts).
    // A folded 'set' op carries BOTH a target and any delta applied after it
    // ("set to 5, then +1" = 6), so both go into the fingerprint. Hashing only
    // the target would make `[{quantity:5},{delta:1}]` and `[{quantity:5}]`
    // collide on one idempotency key — two different requests, one of which
    // would then be silently swallowed as a replay.
    const fingerprint = fingerprintOps(
      userId,
      ops.map((o) => ({
        key: o.variantId,
        op: o.mode === 'set' ? `set:${o.target!}` : 'delta',
        value: o.delta,
      })),
    );
    // A caller that scopes its own key still deserves the "you applied this
    // exact batch two days ago" echo, so it may send the unbucketed content
    // hash alongside. Ours is used when it does not.
    const clientFingerprint =
      typeof body.requestFingerprint === 'string' && body.requestFingerprint.trim()
        ? body.requestFingerprint.trim().slice(0, 200)
        : null;
    const echoFingerprint = clientFingerprint ?? fingerprint;
    const keys = callerKey ? [callerKey] : candidateKeys(fingerprint);

    // Cheap replay check before any work. A dry run never participates in
    // idempotency at all: it writes nothing, so it has nothing to replay.
    if (!dryRun) {
      const replay = await withTx((client) => findCommittedBatch(client, userId, keys));
      if (replay) {
        userCache(res);
        res.json({ ...(replay.response as Record<string, unknown>), replayed: true, batchId: replay.id });
        return;
      }
    }

    const result = await (async (): Promise<Record<string, unknown>> => {
      try {
        return await withTx(async (client: pg.PoolClient) => {
          // FIRST statement: claim the idempotency key. A concurrent duplicate
          // blocks on the unique index here, before anything has changed, and
          // when we commit it raises 23505 with nothing of its own written.
          const batchId = dryRun
            ? null
            : await openBatch(client, {
                userId,
                source,
                tool: 'collection.batch',
                note,
                idempotencyKey: callerKey,
                fingerprint: echoFingerprint,
              });

          // ── Resolve every variant in one query ─────────────────────────────
          const variantIds = ops.map((o) => o.variantId);
          const look = await client.query<BatchVariantRow>(
            `SELECT cv.id, cv.card_id, c.tcgdex_id AS card_tcgdex_id, c.set_id, cs.tcgdex_id AS set_tcgdex_id
               FROM card_variant cv
               JOIN card c      ON c.id = cv.card_id
               JOIN card_set cs ON cs.id = c.set_id
              WHERE cv.id = ANY($1::bigint[])`,
            [variantIds],
          );
          const meta = new Map(look.rows.map((r) => [Number(r.id), r]));
          const missing = variantIds.filter((v) => !meta.has(v));
          if (missing.length > 0) {
            throw notFound(`No variant ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ` (+${missing.length - 5} more)` : ''}`);
          }

          const setIds = [...new Set(ops.map((o) => Number(meta.get(o.variantId)!.set_id)))].sort((a, b) => a - b);
          if (setIds.length > BATCH_MAX_SETS) {
            throw badRequest(
              `batch touches ${setIds.length} sets; the limit is ${BATCH_MAX_SETS} — each set costs a full progress recompute. Split the batch.`,
            );
          }

          // ── Materialise + lock ─────────────────────────────────────────────
          // Postgres cannot lock a row that does not exist, and "I just pulled
          // this card" is precisely the case where it does not: two concurrent
          // batches would both read 0 and both write 1, losing a delta. So
          // every target row is materialised at quantity 0 first (a no-op for
          // rows that already exist), and only then locked — after which every
          // read is under a lock and nothing can be missed.
          //
          // Both statements order by card_variant_id so two overlapping batches
          // take their locks in the same sequence and cannot deadlock.
          //
          // A DRY RUN does NEITHER. It must not create rows (an unlogged,
          // unrevertable side effect in the release whose whole point is that
          // everything is logged) and it must not hold locks on up to 250 rows
          // for a preview. A plain read, with a missing row meaning zero, is
          // exactly as accurate for a preview and touches nothing.
          const sortedIds = [...variantIds].sort((a, b) => a - b);
          if (!dryRun) {
            await client.query(
              `INSERT INTO collection_item (user_id, card_variant_id, quantity, updated_at)
               SELECT $1, v, 0, now() FROM unnest($2::bigint[]) AS t(v) ORDER BY v
               ON CONFLICT (user_id, card_variant_id) DO NOTHING`,
              [userId, sortedIds],
            );
          }
          const locked = await client.query<{ card_variant_id: string; quantity: number }>(
            `SELECT card_variant_id, quantity
               FROM collection_item
              WHERE user_id = $1 AND card_variant_id = ANY($2::bigint[])
              ORDER BY card_variant_id
                ${dryRun ? '' : 'FOR UPDATE'}`,
            [userId, sortedIds],
          );
          const current = new Map(locked.rows.map((r) => [Number(r.card_variant_id), Number(r.quantity)]));

          // ── Compute ────────────────────────────────────────────────────────
          interface Change {
            op: FoldedOp;
            before: number;
            after: number;
            requested: number;
            effective: number;
          }
          const changes: Change[] = ops.map((op) => {
            const before = current.get(op.variantId) ?? 0;
            const base = op.mode === 'set' ? op.target! : before;
            const target = base + op.delta;
            const after = Math.max(0, Math.min(100000, target));
            return { op, before, after, requested: target - before, effective: after - before };
          });
          const moved = changes.filter((c) => c.effective !== 0);

          if (dryRun) {
            return {
              dryRun: true,
              batchId: null,
              applied: 0,
              wouldApply: moved.length,
              unchanged: changes.length - moved.length,
              items: changes.map((c) => shapeChange(c.op.variantId, c, meta)),
              folded,
            };
          }

          // ── Write ──────────────────────────────────────────────────────────
          if (moved.length > 0) {
            const upd: string[] = [];
            const updParams: unknown[] = [userId];
            for (const c of moved) {
              const b = updParams.length;
              upd.push(`($${b + 1}::bigint, $${b + 2}::int)`);
              updParams.push(c.op.variantId, c.after);
            }
            await client.query(
              `UPDATE collection_item ci
                  SET quantity = v.qty, updated_at = now()
                 FROM (VALUES ${upd.join(', ')}) AS v(variant_id, qty)
                WHERE ci.user_id = $1 AND ci.card_variant_id = v.variant_id`,
              updParams,
            );

            // First acquisition = this (user, variant) has never had a positive
            // quantity before. One query for the whole batch.
            const gained = moved.filter((c) => c.after > 0).map((c) => c.op.variantId);
            const priorRows = gained.length
              ? await client.query<{ card_variant_id: string }>(
                  `SELECT DISTINCT card_variant_id FROM collection_event
                    WHERE user_id = $1 AND card_variant_id = ANY($2::bigint[]) AND quantity_after > 0`,
                  [userId, gained],
                )
              : { rows: [] as Array<{ card_variant_id: string }> };
            const seen = new Set(priorRows.rows.map((r) => Number(r.card_variant_id)));
            const firstAcq = new Map(moved.map((c) => [c.op.variantId, c.after > 0 && !seen.has(c.op.variantId)]));

            const evVals: string[] = [];
            const evParams: unknown[] = [userId, source, note, batchId];
            for (const c of moved) {
              const b = evParams.length;
              evVals.push(`($1, $${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $2, $3, $4)`);
              evParams.push(c.op.variantId, c.effective, c.after, firstAcq.get(c.op.variantId) ?? false);
            }
            await client.query(
              `INSERT INTO collection_event
                 (user_id, card_variant_id, delta, quantity_after, is_first_acquisition, source, note, batch_id)
               VALUES ${evVals.join(', ')}`,
              evParams,
            );

            const events: MutationEventInput[] = moved.map((c) => ({
              entityType: 'collection_item',
              entityId: String(c.op.variantId),
              operation: c.op.mode === 'set' ? OPS.quantitySet : OPS.quantityDelta,
              before: { quantity: c.before },
              after: { quantity: c.after },
              requestedDelta: c.requested,
              effectiveDelta: c.effective,
            }));
            await recordEvents(client, batchId!, userId, events);
          }

          // ── Recompute progress once per distinct set ───────────────────────
          const progress: Record<string, SetProgress> = {};
          const setTid = new Map(look.rows.map((r) => [Number(r.set_id), r.set_tcgdex_id]));
          for (const setId of setIds) {
            progress[setTid.get(setId)!] = await recomputeSetProgress(client, userId, setId);
          }

          const payload: Record<string, unknown> = {
            dryRun: false,
            batchId,
            replayed: false,
            applied: moved.length,
            unchanged: changes.length - moved.length,
            items: changes.map((c) => shapeChange(c.op.variantId, c, meta)),
            progress,
            folded,
          };

          // An identical request that is NOT a replay (outside the idempotency
          // window) still deserves to be flagged rather than silently doubled.
          const echo = await findFingerprintEcho(client, userId, echoFingerprint);
          if (echo) {
            payload.duplicateOf = { batchId: echo.id, at: echo.finished_at ?? echo.started_at, note: echo.note };
          }

          await closeBatch(client, batchId!, payload, {
            items: items.length,
            ops: ops.length,
            applied: moved.length,
            sets: setIds.length,
          });
          return payload;
        });
      } catch (err) {
        if (!(err instanceof ReplayError)) throw err;
        // The concurrent winner committed. Its response is the truth.
        const stored = await withTx((client) => loadBatchResponse(client, userId, keys));
        return { ...(stored.response as Record<string, unknown>), replayed: true, batchId: stored.id };
      }
    })();

    // Durably committed BEFORE the response is written — see commitRequestTx.
    if (!dryRun) await commitRequestTx(userId);
    userCache(res);
    res.json(result);
  }),
);

/** Per-item row in the batch response — the same before/after the log stores. */
function shapeChange(
  variantId: number,
  c: { before: number; after: number; requested: number; effective: number },
  meta: Map<number, BatchVariantRow>,
): Record<string, unknown> {
  const m = meta.get(variantId);
  return {
    variantId,
    cardId: m?.card_tcgdex_id ?? null,
    setId: m?.set_tcgdex_id ?? null,
    before: c.before,
    after: c.after,
    delta: c.effective,
    requestedDelta: c.requested,
    // Non-zero only when the [0, 100000] clamp bit. Surfaced because a revert
    // of a clamped change cannot be exact, and the caller should know now.
    clamped: c.requested !== c.effective,
  };
}

/**
 * PATCH /deckpal/api/collection/variants/:variantId  { quantity, source?, note? }
 * Set the absolute owned quantity for a variant. Idempotent.
 */
collectionRouter.patch(
  '/variants/:variantId',
  asyncHandler(async (req, res) => {
    const body = req.body ?? {};
    const quantity = parseQuantity(body.quantity);
    const result = await applyQuantity(currentUserId(req), String(req.params.variantId), () => quantity, parseSource(body.source), parseNote(body.note), 'collection.set');
    userCache(res);
    res.json(result);
  }),
);

/**
 * POST /deckpal/api/collection/variants/:variantId/increment  { delta?, source?, note? }
 * Adjust the owned quantity by a signed delta (default +1). Floors at 0.
 */
collectionRouter.post(
  '/variants/:variantId/increment',
  asyncHandler(async (req, res) => {
    const body = req.body ?? {};
    const delta = parseDelta(body.delta);
    const result = await applyQuantity(currentUserId(req), String(req.params.variantId), (cur) => cur + delta, parseSource(body.source), parseNote(body.note), 'collection.increment');
    userCache(res);
    res.json(result);
  }),
);

/**
 * POST /deckpal/api/collection/cards/:cardId/have   { have, source?, note? }
 * Tile-level Have/Need toggle. have:true owns the primary variant (sets it to 1 if
 * currently 0; leaves an existing higher quantity untouched). have:false zeroes
 * EVERY variant of the card (Need = own nothing). One transaction, one recompute.
 * have:false may write several events (one per zeroed variant) — each carries the
 * same source/note attribution.
 */
collectionRouter.post(
  '/cards/:cardId/have',
  asyncHandler(async (req, res) => {
    const body = req.body ?? {};
    if (typeof body.have !== 'boolean') throw badRequest('have must be a boolean');
    const have = body.have;
    const source = parseSource(body.source);
    const note = parseNote(body.note);
    const cardTcgdexId = String(req.params.cardId);
    const userId = currentUserId(req);

    const result = await withTx(async (client: pg.PoolClient) => {
      const batchId = await openBatch(client, { userId, source, tool: have ? 'collection.have' : 'collection.need', note });
      const logged: MutationEventInput[] = [];
      const cardRow = await client.query<{ id: string; set_id: string; set_tcgdex_id: string; primary_variant: string | null }>(
        `SELECT c.id, c.set_id, cs.tcgdex_id AS set_tcgdex_id,
                (SELECT cv.id FROM card_variant cv WHERE cv.card_id = c.id AND cv.is_primary LIMIT 1) AS primary_variant
           FROM card c JOIN card_set cs ON cs.id = c.set_id
          WHERE c.tcgdex_id = $1`,
        [cardTcgdexId],
      );
      const card = cardRow.rows[0];
      if (!card) throw notFound(`No card '${cardTcgdexId}'`);

      if (have) {
        // Own the primary variant: set to 1 only if currently 0 (don't clobber a higher qty).
        const pv = card.primary_variant;
        if (!pv) throw badRequest('card has no primary variant to mark have');
        const cur = await client.query<{ quantity: number }>(
          `SELECT quantity FROM collection_item WHERE user_id = $1 AND card_variant_id = $2 FOR UPDATE`,
          [userId, pv],
        );
        const current = cur.rows[0]?.quantity ?? 0;
        if (current === 0) {
          await client.query(
            `INSERT INTO collection_item (user_id, card_variant_id, quantity, updated_at)
                  VALUES ($1, $2, 1, now())
             ON CONFLICT (user_id, card_variant_id) DO UPDATE SET quantity = 1, updated_at = now()`,
            [userId, pv],
          );
          const prior = await client.query<{ n: string }>(
            `SELECT count(*) AS n FROM collection_event WHERE user_id = $1 AND card_variant_id = $2 AND quantity_after > 0`,
            [userId, pv],
          );
          await client.query(
            `INSERT INTO collection_event (user_id, card_variant_id, delta, quantity_after, is_first_acquisition, source, note, batch_id)
                  VALUES ($1, $2, 1, 1, $3, $4, $5, $6)`,
            [userId, pv, Number(prior.rows[0]?.n ?? 0) === 0, source, note, batchId],
          );
          logged.push({
            entityType: 'collection_item',
            entityId: String(pv),
            operation: OPS.quantityDelta,
            before: { quantity: 0 },
            after: { quantity: 1 },
            requestedDelta: 1,
            effectiveDelta: 1,
          });
        }
      } else {
        // Need: zero every owned variant of the card, logging each non-zero delta.
        const owned = await client.query<{ card_variant_id: string; quantity: number }>(
          `SELECT card_variant_id, quantity FROM collection_item
            WHERE user_id = $1 AND quantity > 0
              AND card_variant_id IN (SELECT id FROM card_variant WHERE card_id = $2)
            FOR UPDATE`,
          [userId, card.id],
        );
        for (const row of owned.rows) {
          await client.query(
            `UPDATE collection_item SET quantity = 0, updated_at = now()
              WHERE user_id = $1 AND card_variant_id = $2`,
            [userId, row.card_variant_id],
          );
          await client.query(
            `INSERT INTO collection_event (user_id, card_variant_id, delta, quantity_after, is_first_acquisition, source, note, batch_id)
                  VALUES ($1, $2, $3, 0, false, $4, $5, $6)`,
            [userId, row.card_variant_id, -Number(row.quantity), source, note, batchId],
          );
          logged.push({
            entityType: 'collection_item',
            entityId: String(row.card_variant_id),
            operation: OPS.quantityDelta,
            before: { quantity: Number(row.quantity) },
            after: { quantity: 0 },
            requestedDelta: -Number(row.quantity),
            effectiveDelta: -Number(row.quantity),
          });
        }
      }

      await recordEvents(client, batchId, userId, logged);
      const progress = await recomputeSetProgress(client, userId, Number(card.set_id));
      await closeBatch(client, batchId, { cardId: cardTcgdexId, have }, { applied: logged.length });
      const cardVariants = await client.query<CardVariantQty>(
        `SELECT cv.id AS variant_id, COALESCE(ci.quantity, 0) AS quantity
           FROM card_variant cv
      LEFT JOIN collection_item ci ON ci.card_variant_id = cv.id AND ci.user_id = $1
          WHERE cv.card_id = $2 ORDER BY cv.sort_order`,
        [userId, card.id],
      );
      const totalQuantity = cardVariants.rows.reduce((s, r) => s + Number(r.quantity), 0);
      return {
        cardId: cardTcgdexId,
        setId: card.set_tcgdex_id,
        card: {
          cardId: cardTcgdexId,
          variants: cardVariants.rows.map((r) => ({ variantId: Number(r.variant_id), quantity: Number(r.quantity) })),
          ownership: { totalQuantity, have: totalQuantity >= 1, need: totalQuantity === 0, dupe: totalQuantity >= 2 },
        },
        progress,
      };
    });

    userCache(res);
    res.json(result);
  }),
);

/**
 * POST /deckpal/api/collection/reconcile — nightly consistency sweep: recompute
 * the three user_set_progress rows for EVERY set that has progress rows, from
 * the live catalog + collection (bumps recomputed_at AND reconciled_at). On a
 * quiet system this never changes derived values — it exists to heal any drift.
 * One withTx transaction per set, strictly sequential (connection budget: the
 * API owns 2 connections total). Internal: called by the deckpal-sync
 * `reconcile` cron over HTTP. Any request body is ignored.
 */
collectionRouter.post(
  '/reconcile',
  asyncHandler(async (req, res) => {
    const userId = currentUserId(req);
    const started = Date.now();
    const rows = await q<{ set_id: string }>(
      `SELECT DISTINCT set_id FROM user_set_progress WHERE user_id = $1 ORDER BY set_id`,
      [userId],
    );
    for (const r of rows) {
      await withTx((client: pg.PoolClient) => recomputeSetProgress(client, userId, Number(r.set_id)));
    }
    userCache(res);
    res.json({ sets: rows.length, ms: Date.now() - started });
  }),
);

interface EventRow {
  id: string;
  occurred_at: string;
  delta: number;
  quantity_after: number;
  is_first_acquisition: boolean;
  source: string;
  note: string | null;
  card_variant_id: string;
  card_tcgdex_id: string;
  card_name: string;
  local_id: string;
  set_tcgdex_id: string;
  set_name: string;
  series_tcgdex_id: string;
  variant_display_name: string | null;
  variant_kind_display: string;
}

/**
 * Derive a human "kind" from the append-only event row. The table stores only a
 * signed `delta` and the resulting `quantity_after` (+ is_first_acquisition), NOT
 * a categorical kind — so we infer it:
 *   • delta > 0, first acquisition   → 'added'           (0 → n for the first time)
 *   • delta > 0, not first           → 'quantity-increased'
 *   • delta < 0, quantity_after = 0  → 'removed'         (n → 0)
 *   • delta < 0, quantity_after > 0  → 'quantity-decreased'
 */
function eventKind(delta: number, quantityAfter: number, isFirst: boolean): string {
  if (delta > 0) return isFirst ? 'added' : 'quantity-increased';
  return quantityAfter === 0 ? 'removed' : 'quantity-decreased';
}

/**
 * GET /deckpal/api/collection/events — read the collection activity log, newest
 * first, each event resolved to human fields (card/set names, number, variant
 * label, images). Powers the stream overlay ("just added Charizard, Base Set,
 * #4") and an Activity view. Read-only, parameterized, shared pool.
 *
 *   ?limit=<n>     how many events (default 50, capped 1..200)
 *   ?since=<iso>   only events strictly newer than this timestamp (overlay polls
 *                  with the occurredAt of the last event it saw). Invalid → 400.
 *   ?source=<s>    only events written by this source (exact match, e.g.
 *                  'deckpal-mcp'; same shape rule as writes). Invalid → 400.
 *
 * Uses the (user_id, occurred_at DESC) feed index; id DESC is a stable tiebreak
 * for events sharing an occurred_at. Empty collection returns { events: [] }.
 */
collectionRouter.get(
  '/events',
  asyncHandler(async (req, res) => {
    const limit = clampInt(req.query.limit, 50, 1, 200);
    const sinceRaw = str(req.query.since);
    let since: string | null = null;
    if (sinceRaw !== undefined) {
      const d = new Date(sinceRaw);
      if (Number.isNaN(d.getTime())) throw badRequest('since must be an ISO-8601 timestamp');
      since = d.toISOString();
    }
    const sourceRaw = str(req.query.source);
    let sourceFilter: string | null = null;
    if (sourceRaw !== undefined) {
      if (!SOURCE_SHAPE.test(sourceRaw)) throw badRequest("source must match ^[a-z0-9][a-z0-9._-]{0,39}$ (e.g. 'web', 'deckpal-mcp')");
      sourceFilter = sourceRaw;
    }
    const userId = currentUserId(req);

    const rows = await q<EventRow>(
      `SELECT ce.id, ce.occurred_at, ce.delta, ce.quantity_after, ce.is_first_acquisition,
              ce.source, ce.note, ce.card_variant_id,
              c.tcgdex_id AS card_tcgdex_id, c.name AS card_name, c.local_id,
              cs.tcgdex_id AS set_tcgdex_id, cs.name AS set_name,
              ser.tcgdex_id AS series_tcgdex_id,
              cv.display_name AS variant_display_name, vk.display_name AS variant_kind_display
         FROM collection_event ce
         JOIN card_variant cv ON cv.id = ce.card_variant_id
         JOIN variant_kind vk ON vk.code = cv.variant_kind_code
         JOIN card c ON c.id = cv.card_id
         JOIN card_set cs ON cs.id = c.set_id
         JOIN series ser ON ser.id = cs.series_id
        WHERE ce.user_id = $1
          AND ($2::timestamptz IS NULL OR ce.occurred_at > $2::timestamptz)
          AND ($4::text IS NULL OR ce.source = $4::text)
        ORDER BY ce.occurred_at DESC, ce.id DESC
        LIMIT $3`,
      [userId, since, limit, sourceFilter],
    );

    userCache(res);
    res.json({
      events: rows.map((r) => ({
        eventId: Number(r.id),
        occurredAt: r.occurred_at,
        kind: eventKind(r.delta, r.quantity_after, r.is_first_acquisition),
        cardId: r.card_tcgdex_id,
        cardName: r.card_name,
        setId: r.set_tcgdex_id,
        setName: r.set_name,
        number: r.local_id,
        variantId: Number(r.card_variant_id),
        variantName: r.variant_display_name ?? r.variant_kind_display,
        quantityDelta: r.delta,
        newQuantity: r.quantity_after,
        isFirstAcquisition: r.is_first_acquisition,
        source: r.source,
        note: r.note,
        images: cardImages(r.series_tcgdex_id, r.set_tcgdex_id, r.local_id),
      })),
    });
  }),
);
