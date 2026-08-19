import { Router } from 'express';
import type pg from 'pg';
import { commitRequestTx, q, q1, recomputeSetProgress, withTx } from '../db.js';
import { asyncHandler, badRequest, clampInt, notFound, str, userCache } from '../http.js';
import { currentUserId } from '../identity.js';
import { closeBatch, openBatch, recordEvents, type MutationEventInput } from '../mutations.js';

/**
 * The mutation log — read side and undo.
 *
 *   GET  /mutations              the history feed (batches, newest first)
 *   GET  /mutations/:batchId     one batch and every event in it
 *   POST /mutations/revert       undo a batch, an event, a time window, or an entity
 *
 * ## Why revert defaults to `inverse`
 *
 * Two strategies are available and they answer different questions.
 *
 *   `restore` puts the value back to the event's `before`. That is right when
 *   nothing else has touched the thing since — and wrong the moment something
 *   has, because it silently discards the later change.
 *
 *   `inverse` applies the opposite of what the event did (`-effective_delta`).
 *   That leaves unrelated later edits standing, which is what you want when you
 *   are undoing one of four duplicate batches and have legitimately bought more
 *   cards since.
 *
 * So `inverse` is the default for quantities and `restore` is the only sensible
 * meaning for a name, a strategy guide, or a deleted row — where "the opposite
 * of setting it to X" IS "set it back to what it was".
 *
 * ## Where an exact undo is impossible, and why we say so
 *
 * Collection quantities clamp to [0, 100000]. That clamp is not invertible:
 *
 *   qty 2 → event A sets it to 0 (effective −2) → event B asks for −1, which
 *   floors to an effective 0 and is therefore never recorded at all.
 *   Reverting A by inverse gives +2 → 2. The counterfactual history without A
 *   is 2 − 1 = 1. No strategy recovers that, because B's intent was destroyed
 *   at write time, not at revert time.
 *
 * Which is why `mutation_event` stores `requested_delta` AND `effective_delta`,
 * and why this planner refuses (outside a dry run) whenever:
 *
 *   • the original event clamped (`requested ≠ effective`) — its own history is
 *     already lossy;
 *   • the inverse would itself clamp — the undo cannot be applied in full;
 *   • a later event on the same entity asserted an absolute quantity — an
 *     inverse delta against an asserted count means something different from
 *     what the user asked for.
 *
 * A refusal is reported per item with the reason and the numbers, never
 * swallowed, and `force: true` is the caller's explicit "yes, apply the partial
 * undo anyway". Nothing is ever marked reverted when the applied change did not
 * equal the exact inverse.
 */

export const mutationsRouter: Router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SOURCE_SHAPE = /^[a-z0-9][a-z0-9._-]{0,39}$/;
const REVERT_MAX_EVENTS = 500;

// ── Row shapes ───────────────────────────────────────────────────────────────

interface BatchRow {
  id: string;
  source: string;
  tool: string;
  note: string | null;
  status: string;
  idempotency_key: string | null;
  reverts_batch_id: string | null;
  summary: unknown;
  started_at: string;
  finished_at: string | null;
  event_count: string;
  reverted_events: string;
}

interface EventRow {
  id: string;
  batch_id: string;
  entity_type: string;
  entity_id: string;
  operation: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  requested_delta: number | null;
  effective_delta: number | null;
  reverts_event_id: string | null;
  occurred_at: string;
  undone_by: string | null;
}

function shapeBatch(r: BatchRow): Record<string, unknown> {
  return {
    batchId: r.id,
    source: r.source,
    tool: r.tool,
    note: r.note,
    status: r.status,
    idempotencyKey: r.idempotency_key,
    revertsBatchId: r.reverts_batch_id,
    summary: r.summary,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    eventCount: Number(r.event_count),
    revertedEventCount: Number(r.reverted_events),
  };
}

function shapeEvent(r: EventRow): Record<string, unknown> {
  return {
    eventId: Number(r.id),
    batchId: r.batch_id,
    entityType: r.entity_type,
    entityId: r.entity_id,
    operation: r.operation,
    before: r.before,
    after: r.after,
    requestedDelta: r.requested_delta,
    effectiveDelta: r.effective_delta,
    // The original write clamped, so its own record is lossy and an exact undo
    // is not available. Surfaced on every read, not just at revert time.
    clamped: r.requested_delta !== null && r.requested_delta !== r.effective_delta,
    revertsEventId: r.reverts_event_id === null ? null : Number(r.reverts_event_id),
    undoneByEventId: r.undone_by === null ? null : Number(r.undone_by),
    occurredAt: r.occurred_at,
  };
}

// ── GET /mutations — the history feed ────────────────────────────────────────

mutationsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const userId = currentUserId(req);
    const limit = clampInt(req.query.limit, 25, 1, 200);
    const page = clampInt(req.query.page, 1, 1, 10_000);

    const conds: string[] = ['b.user_id = $1'];
    const params: unknown[] = [userId];
    const p = (v: unknown): string => {
      params.push(v);
      return `$${params.length}`;
    };

    const since = str(req.query.since);
    if (since !== undefined) {
      const d = new Date(since);
      if (Number.isNaN(d.getTime())) throw badRequest('since must be an ISO-8601 timestamp');
      conds.push(`b.started_at >= ${p(d.toISOString())}::timestamptz`);
    }
    const until = str(req.query.until);
    if (until !== undefined) {
      const d = new Date(until);
      if (Number.isNaN(d.getTime())) throw badRequest('until must be an ISO-8601 timestamp');
      conds.push(`b.started_at <= ${p(d.toISOString())}::timestamptz`);
    }
    const source = str(req.query.source);
    if (source !== undefined) {
      if (!SOURCE_SHAPE.test(source)) throw badRequest("source must match ^[a-z0-9][a-z0-9._-]{0,39}$ (e.g. 'web', 'deckpal-mcp')");
      conds.push(`b.source = ${p(source)}`);
    }
    const tool = str(req.query.tool);
    if (tool !== undefined) conds.push(`b.tool = ${p(tool)}`);
    const key = str(req.query.idempotency_key);
    if (key !== undefined) conds.push(`b.idempotency_key = ${p(key)}`);
    const note = str(req.query.note);
    // Substring, because the note is how a haul is named ("Aug 2026 pack haul
    // batch 1") and naming it is how an operation is found again later.
    if (note !== undefined) conds.push(`b.note ILIKE ${p(`%${note}%`)}`);

    // Entity filter: "everything that ever touched this card / list / deck".
    const entityType = str(req.query.entity_type);
    const entityId = str(req.query.entity_id);
    if (entityId !== undefined) {
      conds.push(
        `EXISTS (SELECT 1 FROM mutation_event e
                  WHERE e.batch_id = b.id AND e.entity_id = ${p(entityId)}
                    ${entityType !== undefined ? `AND e.entity_type = ${p(entityType)}` : ''})`,
      );
    } else if (entityType !== undefined) {
      conds.push(`EXISTS (SELECT 1 FROM mutation_event e WHERE e.batch_id = b.id AND e.entity_type = ${p(entityType)})`);
    }

    const where = conds.join(' AND ');
    const totalRow = await q1<{ total: string }>(`SELECT count(*) AS total FROM mutation_batch b WHERE ${where}`, params);
    const total = Number(totalRow?.total ?? 0);

    const rows = await q<BatchRow>(
      `SELECT b.id, b.source, b.tool, b.note, b.status, b.idempotency_key, b.reverts_batch_id,
              b.summary, b.started_at, b.finished_at,
              (SELECT count(*) FROM mutation_event e WHERE e.batch_id = b.id) AS event_count,
              (SELECT count(*) FROM mutation_event e
                 JOIN mutation_event u ON u.reverts_event_id = e.id
                WHERE e.batch_id = b.id) AS reverted_events
         FROM mutation_batch b
        WHERE ${where}
        ORDER BY b.started_at DESC, b.id DESC
        LIMIT ${p(limit)} OFFSET ${p((page - 1) * limit)}`,
      params,
    );

    userCache(res);
    res.json({ total, page, pageSize: limit, batches: rows.map(shapeBatch) });
  }),
);

// ── GET /mutations/:batchId — one operation in full ──────────────────────────

mutationsRouter.get(
  '/:batchId',
  asyncHandler(async (req, res) => {
    const batchId = String(req.params.batchId);
    if (!UUID_RE.test(batchId)) throw notFound(`No batch '${batchId}'`);
    const userId = currentUserId(req);
    const batch = await q1<BatchRow>(
      `SELECT b.id, b.source, b.tool, b.note, b.status, b.idempotency_key, b.reverts_batch_id,
              b.summary, b.started_at, b.finished_at,
              (SELECT count(*) FROM mutation_event e WHERE e.batch_id = b.id) AS event_count,
              (SELECT count(*) FROM mutation_event e
                 JOIN mutation_event u ON u.reverts_event_id = e.id
                WHERE e.batch_id = b.id) AS reverted_events
         FROM mutation_batch b WHERE b.id = $1 AND b.user_id = $2`,
      [batchId, userId],
    );
    if (!batch) throw notFound(`No batch '${batchId}'`);
    // The stored response is only served here, never in the feed: it is the
    // whole payload the caller originally received, and it is what lets a
    // client that lost its response ask "what actually landed?" after the fact.
    const stored = await q1<{ response: unknown }>(`SELECT response FROM mutation_batch WHERE id = $1 AND user_id = $2`, [
      batchId,
      userId,
    ]);
    const events = await q<EventRow>(
      `SELECT e.id, e.batch_id, e.entity_type, e.entity_id, e.operation, e.before, e.after,
              e.requested_delta, e.effective_delta, e.reverts_event_id, e.occurred_at,
              (SELECT min(u.id) FROM mutation_event u WHERE u.reverts_event_id = e.id) AS undone_by
         FROM mutation_event e
        WHERE e.batch_id = $1 AND e.user_id = $2
        ORDER BY e.id`,
      [batchId, userId],
    );
    userCache(res);
    res.json({ batch: { ...shapeBatch(batch), response: stored?.response ?? null }, events: events.map(shapeEvent) });
  }),
);

// ── The undo planner ─────────────────────────────────────────────────────────

type Strategy = 'inverse' | 'restore';

interface PlanEntry {
  eventId: number;
  entityType: string;
  entityId: string;
  operation: string;
  /** Human sentence describing the undo. */
  action: string;
  /** Present for collection quantities. */
  from?: number;
  to?: number;
  delta?: number;
  /** Non-empty means this entry will NOT be applied unless `force`. */
  conflicts: string[];
  /** True when the applied change equals the exact inverse — the only case we mark reverted. */
  exact: boolean;
  skipped?: string;
}

interface RevertTarget {
  events: EventRow[];
  label: string;
  batchId: string | null;
}

async function loadRevertTarget(
  client: pg.PoolClient,
  userId: string,
  body: Record<string, unknown>,
): Promise<RevertTarget> {
  const sel = `SELECT e.id, e.batch_id, e.entity_type, e.entity_id, e.operation, e.before, e.after,
                      e.requested_delta, e.effective_delta, e.reverts_event_id, e.occurred_at,
                      (SELECT min(u.id) FROM mutation_event u WHERE u.reverts_event_id = e.id) AS undone_by
                 FROM mutation_event e WHERE e.user_id = $1`;

  if (typeof body.batchId === 'string') {
    const batchId = body.batchId;
    if (!UUID_RE.test(batchId)) throw notFound(`No batch '${batchId}'`);
    const batch = await client.query<{ id: string; note: string | null; tool: string }>(
      `SELECT id, note, tool FROM mutation_batch WHERE id = $1 AND user_id = $2`,
      [batchId, userId],
    );
    if (!batch.rows[0]) throw notFound(`No batch '${batchId}'`);
    const { rows } = await client.query<EventRow>(`${sel} AND e.batch_id = $2 ORDER BY e.id DESC`, [userId, batchId]);
    return { events: rows, label: `batch ${batchId}${batch.rows[0].note ? ` ("${batch.rows[0].note}")` : ''}`, batchId };
  }

  if (body.eventId !== undefined) {
    const eventId = Number(body.eventId);
    if (!Number.isInteger(eventId) || eventId <= 0) throw badRequest('eventId must be a positive integer');
    const { rows } = await client.query<EventRow>(`${sel} AND e.id = $2`, [userId, eventId]);
    if (rows.length === 0) throw notFound(`No event ${eventId}`);
    return { events: rows, label: `event ${eventId}`, batchId: null };
  }

  if (typeof body.since === 'string') {
    const since = new Date(body.since);
    if (Number.isNaN(since.getTime())) throw badRequest('since must be an ISO-8601 timestamp');
    const untilRaw = typeof body.until === 'string' ? new Date(body.until) : null;
    if (untilRaw && Number.isNaN(untilRaw.getTime())) throw badRequest('until must be an ISO-8601 timestamp');
    const params: unknown[] = [userId, since.toISOString()];
    let extra = 'AND e.occurred_at >= $2::timestamptz';
    if (untilRaw) {
      params.push(untilRaw.toISOString());
      extra += ` AND e.occurred_at <= $${params.length}::timestamptz`;
    }
    if (typeof body.source === 'string') {
      if (!SOURCE_SHAPE.test(body.source)) throw badRequest('source has the wrong shape');
      params.push(body.source);
      extra += ` AND e.batch_id IN (SELECT id FROM mutation_batch WHERE user_id = $1 AND source = $${params.length})`;
    }
    const { rows } = await client.query<EventRow>(`${sel} ${extra} ORDER BY e.id DESC LIMIT ${REVERT_MAX_EVENTS + 1}`, params);
    if (rows.length > REVERT_MAX_EVENTS) {
      throw badRequest(`that window covers more than ${REVERT_MAX_EVENTS} events — narrow it, or revert batch by batch`);
    }
    return { events: rows, label: `everything since ${since.toISOString()}`, batchId: null };
  }

  if (typeof body.entityType === 'string' && typeof body.entityId === 'string') {
    const at = typeof body.at === 'string' ? new Date(body.at) : null;
    if (at && Number.isNaN(at.getTime())) throw badRequest('at must be an ISO-8601 timestamp');
    const params: unknown[] = [userId, body.entityType, body.entityId];
    let extra = 'AND e.entity_type = $2 AND e.entity_id = $3';
    if (at) {
      params.push(at.toISOString());
      extra += ` AND e.occurred_at > $${params.length}::timestamptz`;
    }
    const { rows } = await client.query<EventRow>(`${sel} ${extra} ORDER BY e.id DESC LIMIT ${REVERT_MAX_EVENTS + 1}`, params);
    if (rows.length > REVERT_MAX_EVENTS) throw badRequest(`more than ${REVERT_MAX_EVENTS} events on that entity — narrow the window`);
    return {
      events: rows,
      label: at ? `${body.entityType} ${body.entityId} back to ${at.toISOString()}` : `every change to ${body.entityType} ${body.entityId}`,
      batchId: null,
    };
  }

  throw badRequest('pass one of: batchId, eventId, since (+until), or entityType+entityId (+at)');
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Undo plan for one collection-quantity event, given the live quantity. */
function planQuantity(e: EventRow, current: number, strategy: Strategy, laterAbsolute: boolean): PlanEntry {
  const before = num(e.before?.quantity) ?? 0;
  const after = num(e.after?.quantity) ?? 0;
  const effective = e.effective_delta ?? after - before;
  const requested = e.requested_delta ?? effective;
  const conflicts: string[] = [];

  let target: number;
  if (strategy === 'restore') {
    target = before;
    if (current !== after) {
      conflicts.push(
        `intervening change: quantity is ${current}, this event left it at ${after}. ` +
          `'restore' would discard that later change — 'inverse' would not.`,
      );
    }
  } else {
    target = current - effective;
  }
  const clamped = Math.max(0, Math.min(100000, target));
  const applied = clamped - current;

  if (requested !== effective) {
    conflicts.push(
      `the original change clamped (asked for ${requested}, applied ${effective}), so its own record is lossy and no undo is exact`,
    );
  }
  if (strategy === 'inverse' && clamped !== target) {
    conflicts.push(`the inverse would clamp: ${current} ${-effective >= 0 ? '+' : ''}${-effective} floors at 0`);
  }
  if (strategy === 'inverse' && laterAbsolute) {
    conflicts.push(
      'a later change set an absolute quantity on this card — subtracting from an asserted count is probably not what you mean; ' +
        "use strategy 'restore' or revert the later change first",
    );
  }

  const exact = conflicts.length === 0 && applied === (strategy === 'inverse' ? -effective : before - current);
  return {
    eventId: Number(e.id),
    entityType: e.entity_type,
    entityId: e.entity_id,
    operation: e.operation,
    action: `quantity ${current} → ${clamped}`,
    from: current,
    to: clamped,
    delta: applied,
    conflicts,
    exact,
  };
}

// ── POST /mutations/revert ───────────────────────────────────────────────────

mutationsRouter.post(
  '/revert',
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const userId = currentUserId(req);
    // dryRun defaults TRUE, like every other mutating surface in this app.
    const dryRun = body.dryRun !== false;
    const force = body.force === true;
    const strategy: Strategy = body.strategy === 'restore' ? 'restore' : 'inverse';
    const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 500) : null;
    const source = typeof body.source === 'string' && SOURCE_SHAPE.test(body.source) ? body.source : 'web';

    const outcome = await withTx(async (client: pg.PoolClient) => {
      const target = await loadRevertTarget(client, userId, body);
      if (target.events.length === 0) {
        return { dryRun, label: target.label, plan: [] as PlanEntry[], applied: 0, skipped: 0, conflicts: 0, batchId: null };
      }

      // Already-undone events are skipped by default: reverting a revert is a
      // real operation, but it should be asked for explicitly.
      const plan: PlanEntry[] = [];
      const collectionEvents: EventRow[] = [];
      for (const e of target.events) {
        if (e.undone_by !== null && !force) {
          plan.push({
            eventId: Number(e.id),
            entityType: e.entity_type,
            entityId: e.entity_id,
            operation: e.operation,
            action: 'already reverted',
            conflicts: [],
            exact: false,
            skipped: `already undone by event ${e.undone_by} — pass force:true to undo it again`,
          });
          continue;
        }
        if (e.entity_type === 'collection_item') {
          collectionEvents.push(e);
          continue;
        }
        plan.push(planStructural(e, strategy));
      }

      // Collection quantities need the live values, under lock, before the plan
      // can be honest about clamping — so they are planned in a second pass.
      if (collectionEvents.length > 0) {
        const variantIds = [...new Set(collectionEvents.map((e) => Number(e.entity_id)))].sort((a, b) => a - b);
        await client.query(
          `INSERT INTO collection_item (user_id, card_variant_id, quantity, updated_at)
           SELECT $1, v, 0, now() FROM unnest($2::bigint[]) AS t(v) ORDER BY v
           ON CONFLICT (user_id, card_variant_id) DO NOTHING`,
          [userId, variantIds],
        );
        const locked = await client.query<{ card_variant_id: string; quantity: number }>(
          `SELECT card_variant_id, quantity FROM collection_item
            WHERE user_id = $1 AND card_variant_id = ANY($2::bigint[])
            ORDER BY card_variant_id FOR UPDATE`,
          [userId, variantIds],
        );
        const live = new Map(locked.rows.map((r) => [Number(r.card_variant_id), Number(r.quantity)]));

        // "Did anything assert an absolute quantity on this card after the
        // event we are undoing?" — the case where an inverse delta means
        // something different from what the user asked for.
        const absolutes = await client.query<{ entity_id: string; max_id: string }>(
          `SELECT entity_id, max(id) AS max_id FROM mutation_event
            WHERE user_id = $1 AND entity_type = 'collection_item'
              AND operation = 'quantity.set' AND entity_id = ANY($2::text[])
            GROUP BY entity_id`,
          [userId, variantIds.map(String)],
        );
        const lastAbsolute = new Map(absolutes.rows.map((r) => [r.entity_id, Number(r.max_id)]));

        for (const e of collectionEvents) {
          const vid = Number(e.entity_id);
          const current = live.get(vid) ?? 0;
          const laterAbsolute = (lastAbsolute.get(e.entity_id) ?? -1) > Number(e.id);
          const entry = planQuantity(e, current, strategy, laterAbsolute);
          plan.push(entry);
          // Fold the planned change into `live` so several events on the SAME
          // card in one revert compose instead of each planning from the same
          // starting quantity.
          if (entry.conflicts.length === 0 || force) live.set(vid, entry.to ?? current);
        }
      }

      const actionable = plan.filter((p) => !p.skipped && (p.conflicts.length === 0 || force));
      const blocked = plan.filter((p) => !p.skipped && p.conflicts.length > 0 && !force);

      if (dryRun) {
        return {
          dryRun: true,
          label: target.label,
          strategy,
          plan,
          applied: 0,
          wouldApply: actionable.length,
          skipped: plan.filter((p) => p.skipped).length,
          conflicts: blocked.length,
          batchId: null,
        };
      }
      if (actionable.length === 0) {
        return {
          dryRun: false,
          label: target.label,
          strategy,
          plan,
          applied: 0,
          skipped: plan.filter((p) => p.skipped).length,
          conflicts: blocked.length,
          batchId: null,
        };
      }

      // ── Execute ──────────────────────────────────────────────────────────
      const batchId = await openBatch(client, {
        userId,
        source,
        tool: 'revert',
        note: note ?? `revert ${target.label}`,
        revertsBatchId: target.batchId,
      });

      const logged: MutationEventInput[] = [];
      const touchedSets = new Set<number>();

      const qtyEntries = actionable.filter((p) => p.entityType === 'collection_item' && p.delta !== 0);
      if (qtyEntries.length > 0) {
        const upd: string[] = [];
        const params: unknown[] = [userId];
        for (const p of qtyEntries) {
          const b = params.length;
          upd.push(`($${b + 1}::bigint, $${b + 2}::int)`);
          params.push(Number(p.entityId), p.to!);
        }
        await client.query(
          `UPDATE collection_item ci SET quantity = v.qty, updated_at = now()
             FROM (VALUES ${upd.join(', ')}) AS v(variant_id, qty)
            WHERE ci.user_id = $1 AND ci.card_variant_id = v.variant_id`,
          params,
        );
        const evVals: string[] = [];
        const evParams: unknown[] = [userId, source, note ?? `revert ${target.label}`, batchId];
        for (const p of qtyEntries) {
          const b = evParams.length;
          evVals.push(`($1, $${b + 1}, $${b + 2}, $${b + 3}, false, $2, $3, $4)`);
          evParams.push(Number(p.entityId), p.delta!, p.to!);
        }
        await client.query(
          `INSERT INTO collection_event
             (user_id, card_variant_id, delta, quantity_after, is_first_acquisition, source, note, batch_id)
           VALUES ${evVals.join(', ')}`,
          evParams,
        );
        for (const p of qtyEntries) {
          logged.push({
            entityType: 'collection_item',
            entityId: p.entityId,
            operation: 'quantity.delta',
            before: { quantity: p.from },
            after: { quantity: p.to },
            requestedDelta: p.delta,
            effectiveDelta: p.delta,
            // Only an EXACT undo claims to have reverted the original. A
            // partial one is recorded as an ordinary change, so the original
            // event keeps showing as outstanding — which is the truth.
            revertsEventId: p.exact ? p.eventId : null,
          });
        }
        const sets = await client.query<{ set_id: string }>(
          `SELECT DISTINCT c.set_id FROM card_variant cv JOIN card c ON c.id = cv.card_id
            WHERE cv.id = ANY($1::bigint[])`,
          [qtyEntries.map((p) => Number(p.entityId))],
        );
        for (const s of sets.rows) touchedSets.add(Number(s.set_id));
      }

      for (const p of actionable.filter((x) => x.entityType !== 'collection_item')) {
        const applied = await applyStructural(client, userId, p);
        if (applied) logged.push(applied);
      }

      await recordEvents(client, batchId, userId, logged);
      for (const setId of [...touchedSets].sort((a, b) => a - b)) {
        await recomputeSetProgress(client, userId, setId);
      }

      const payload = {
        dryRun: false,
        label: target.label,
        strategy,
        plan,
        applied: actionable.length,
        skipped: plan.filter((p) => p.skipped).length,
        conflicts: blocked.length,
        batchId,
      };
      await closeBatch(client, batchId, payload, { applied: actionable.length, reverts: target.batchId });
      return payload;
    });

    if (!dryRun) await commitRequestTx(userId);
    userCache(res);
    res.json(outcome);
  }),
);

// ── Non-quantity undo ────────────────────────────────────────────────────────
//
// Everything that is not a number is a `restore`: the opposite of "the name was
// set to X" is "put the old name back", and the opposite of "the list was
// deleted" is "undelete it". `strategy` is therefore only consulted for the
// conflict wording, not for the action.

function planStructural(e: EventRow, _strategy: Strategy): PlanEntry {
  const base = {
    eventId: Number(e.id),
    entityType: e.entity_type,
    entityId: e.entity_id,
    operation: e.operation,
    conflicts: [] as string[],
    exact: true,
  };
  switch (e.operation) {
    case 'list.create':
      return { ...base, action: `delete the list it created ("${String(e.after?.name ?? '')}")` };
    case 'list.delete':
      return { ...base, action: `restore the deleted list ("${String(e.before?.name ?? '')}")` };
    case 'list.restore':
      return { ...base, action: 'delete the list again' };
    case 'list.rename':
      return { ...base, action: `rename back to "${String(e.before?.name ?? '')}"` };
    case 'list.item.add':
      return { ...base, action: 'remove the added item' };
    case 'list.item.remove':
      return { ...base, action: 'put the removed item back' };
    case 'deck.delete':
      return { ...base, action: `restore the deleted deck ("${String(e.before?.name ?? '')}")` };
    case 'deck.restore':
      return { ...base, action: 'delete the deck again' };
    case 'deck.strategy.set':
      return { ...base, action: 'restore the previous strategy guide' };
    case 'list.purge':
    case 'deck.purge':
      return {
        ...base,
        exact: false,
        action: 'cannot be undone',
        skipped: 'a purge is a real DELETE — the rows are gone. This is the one deliberate no-undo path (see SECURITY.md).',
      };
    case 'deck.cards':
      return {
        ...base,
        exact: false,
        action: 'use the deck version history',
        skipped: `deck card lists are versioned — revert with POST /decks/${e.entity_id}/revert (deck_history in the MCP), which is exact`,
      };
    default:
      return { ...base, exact: false, action: 'unsupported', skipped: `no undo is defined for '${e.operation}'` };
  }
}

/** Apply one non-quantity undo. Returns the event to log, or null when nothing happened. */
async function applyStructural(
  client: pg.PoolClient,
  userId: string,
  p: PlanEntry,
): Promise<MutationEventInput | null> {
  const ev = await client.query<EventRow>(
    `SELECT id, batch_id, entity_type, entity_id, operation, before, after, requested_delta, effective_delta,
            reverts_event_id, occurred_at, NULL::bigint AS undone_by
       FROM mutation_event WHERE id = $1 AND user_id = $2`,
    [p.eventId, userId],
  );
  const e = ev.rows[0];
  if (!e) return null;
  const log = (before: unknown, after: unknown, operation: string): MutationEventInput => ({
    entityType: e.entity_type as MutationEventInput['entityType'],
    entityId: e.entity_id,
    operation,
    before,
    after,
    revertsEventId: p.exact ? p.eventId : null,
  });

  switch (e.operation) {
    case 'list.create':
      await client.query(`UPDATE card_list SET deleted_at = now() WHERE id = $1 AND user_id = $2`, [e.entity_id, userId]);
      return log(e.after, null, 'list.delete');
    case 'list.delete':
      await client.query(`UPDATE card_list SET deleted_at = NULL, updated_at = now() WHERE id = $1 AND user_id = $2`, [
        e.entity_id,
        userId,
      ]);
      return log(null, e.before, 'list.restore');
    case 'list.restore':
      await client.query(`UPDATE card_list SET deleted_at = now() WHERE id = $1 AND user_id = $2`, [e.entity_id, userId]);
      return log(e.after, null, 'list.delete');
    case 'list.rename': {
      const name = String(e.before?.name ?? '');
      if (!name) return null;
      await client.query(`UPDATE card_list SET name = $3, updated_at = now() WHERE id = $1 AND user_id = $2`, [
        e.entity_id,
        userId,
        name,
      ]);
      return log(e.after, e.before, 'list.rename');
    }
    case 'list.item.add':
      await client.query(`DELETE FROM list_item WHERE id = $1 AND user_id = $2`, [e.entity_id, userId]);
      return log(e.after, null, 'list.item.remove');
    case 'list.item.remove': {
      const b = e.before ?? {};
      await client.query(
        `INSERT INTO list_item (id, list_id, user_id, list_kind, position, card_variant_id, dex_id, static_quantity, note)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT DO NOTHING`,
        [
          e.entity_id,
          b.listId ?? null,
          userId,
          b.listKind ?? null,
          b.position ?? 0,
          b.cardVariantId ?? null,
          b.dexId ?? null,
          b.staticQuantity ?? null,
          b.note ?? null,
        ],
      );
      return log(null, e.before, 'list.item.add');
    }
    case 'deck.delete':
      await client.query(`UPDATE deck SET deleted_at = NULL, updated_at = now() WHERE id = $1 AND user_id = $2`, [
        e.entity_id,
        userId,
      ]);
      return log(null, e.before, 'deck.restore');
    case 'deck.restore':
      await client.query(`UPDATE deck SET deleted_at = now() WHERE id = $1 AND user_id = $2`, [e.entity_id, userId]);
      return log(e.after, null, 'deck.delete');
    case 'deck.strategy.set': {
      const md = e.before?.strategyMd ?? null;
      await client.query(`UPDATE deck SET strategy_md = $3, updated_at = now() WHERE id = $1 AND user_id = $2`, [
        e.entity_id,
        userId,
        md,
      ]);
      return log(e.after, e.before, 'deck.strategy.set');
    }
    default:
      return null;
  }
}
