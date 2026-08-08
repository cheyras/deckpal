import { Router } from 'express';
import type pg from 'pg';
import { cardImages, defaultUserId, q, recomputeSetProgress, withTx, type SetProgress } from '../db.js';
import { asyncHandler, badRequest, clampInt, notFound, str, userCache } from '../http.js';

export const collectionRouter: Router = Router();

/**
 * Collection write endpoints (Phase 3 · task 3). These are the ONLY writers in the
 * app; every other route is read-only. All under /deckscout/api/collection.
 *
 * A mutation, in ONE transaction (withTx): upsert collection_item to the new
 * quantity, append a collection_event for the non-zero delta, then recompute the
 * affected set's three user_set_progress rows (SCHEMA §9.3 — progress is
 * materialised, invalidated on collection mutation). Idempotent: setting the same
 * quantity writes no event and just returns current state. Parameterized only.
 *
 * The single default user owns the collection (no auth; nginx/Authelia is the ingress).
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

// ── Attribution (migration 018) ───────────────────────────────────────────────
// Every collection_event carries WHO wrote it (source) and an optional note.
// The shape mirrors the DB CHECK (collection_event_source_shape) exactly, so a
// bad value is rejected here as a 400 instead of surfacing as a 500 from Postgres.

const SOURCE_SHAPE = /^[a-z0-9][a-z0-9._-]{0,39}$/;

/** Writer attribution for an event; omitted → 'web' (the UI, matching the column default). */
function parseSource(v: unknown): string {
  if (v === undefined || v === null) return 'web';
  if (typeof v !== 'string' || !SOURCE_SHAPE.test(v)) {
    throw badRequest("source must match ^[a-z0-9][a-z0-9._-]{0,39}$ (e.g. 'web', 'rotom-mcp')");
  }
  return v;
}

/** Optional free-text note: trimmed, ≤500 chars, empty → null (never stored as ''). */
function parseNote(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') throw badRequest('note must be a string');
  const trimmed = v.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > 500) throw badRequest('note too long (max 500 chars)');
  return trimmed;
}

/**
 * Apply a new absolute quantity to (user, variant) and recompute set progress, all
 * in one transaction. `resolveQty` maps the current quantity to the target — this
 * lets set (absolute) and increment (relative) share every downstream step.
 */
async function applyQuantity(
  variantIdRaw: string,
  resolveQty: (current: number) => number,
  source: string,
  note: string | null,
): Promise<MutationResult> {
  const variantId = Number(variantIdRaw);
  if (!Number.isInteger(variantId) || variantId <= 0) throw badRequest('variantId must be a positive integer');
  const userId = await defaultUserId();

  return withTx(async (client: pg.PoolClient) => {
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
        `INSERT INTO collection_event (user_id, card_variant_id, delta, quantity_after, is_first_acquisition, source, note)
              VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [userId, variantId, delta, clamped, isFirstAcquisition, source, note],
      );
    }

    // Recompute the three progress rows for this (user, set) in the same tx.
    const progress = await recomputeSetProgress(client, userId, Number(v.set_id));

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

/**
 * PATCH /deckscout/api/collection/variants/:variantId  { quantity, source?, note? }
 * Set the absolute owned quantity for a variant. Idempotent.
 */
collectionRouter.patch(
  '/variants/:variantId',
  asyncHandler(async (req, res) => {
    const body = req.body ?? {};
    const quantity = parseQuantity(body.quantity);
    const result = await applyQuantity(String(req.params.variantId), () => quantity, parseSource(body.source), parseNote(body.note));
    userCache(res);
    res.json(result);
  }),
);

/**
 * POST /deckscout/api/collection/variants/:variantId/increment  { delta?, source?, note? }
 * Adjust the owned quantity by a signed delta (default +1). Floors at 0.
 */
collectionRouter.post(
  '/variants/:variantId/increment',
  asyncHandler(async (req, res) => {
    const body = req.body ?? {};
    const delta = parseDelta(body.delta);
    const result = await applyQuantity(String(req.params.variantId), (cur) => cur + delta, parseSource(body.source), parseNote(body.note));
    userCache(res);
    res.json(result);
  }),
);

/**
 * POST /deckscout/api/collection/cards/:cardId/have   { have, source?, note? }
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
    const userId = await defaultUserId();

    const result = await withTx(async (client: pg.PoolClient) => {
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
            `INSERT INTO collection_event (user_id, card_variant_id, delta, quantity_after, is_first_acquisition, source, note)
                  VALUES ($1, $2, 1, 1, $3, $4, $5)`,
            [userId, pv, Number(prior.rows[0]?.n ?? 0) === 0, source, note],
          );
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
            `INSERT INTO collection_event (user_id, card_variant_id, delta, quantity_after, is_first_acquisition, source, note)
                  VALUES ($1, $2, $3, 0, false, $4, $5)`,
            [userId, row.card_variant_id, -Number(row.quantity), source, note],
          );
        }
      }

      const progress = await recomputeSetProgress(client, userId, Number(card.set_id));
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
 * POST /deckscout/api/collection/reconcile — nightly consistency sweep: recompute
 * the three user_set_progress rows for EVERY set that has progress rows, from
 * the live catalog + collection (bumps recomputed_at AND reconciled_at). On a
 * quiet system this never changes derived values — it exists to heal any drift.
 * One withTx transaction per set, strictly sequential (connection budget: the
 * API owns 2 connections total). Internal: called by the deckscout-sync
 * `reconcile` cron over HTTP. Any request body is ignored.
 */
collectionRouter.post(
  '/reconcile',
  asyncHandler(async (_req, res) => {
    const userId = await defaultUserId();
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
 * GET /deckscout/api/collection/events — read the collection activity log, newest
 * first, each event resolved to human fields (card/set names, number, variant
 * label, images). Powers the stream overlay ("just added Charizard, Base Set,
 * #4") and an Activity view. Read-only, parameterized, shared pool.
 *
 *   ?limit=<n>     how many events (default 50, capped 1..200)
 *   ?since=<iso>   only events strictly newer than this timestamp (overlay polls
 *                  with the occurredAt of the last event it saw). Invalid → 400.
 *   ?source=<s>    only events written by this source (exact match, e.g.
 *                  'rotom-mcp'; same shape rule as writes). Invalid → 400.
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
      if (!SOURCE_SHAPE.test(sourceRaw)) throw badRequest("source must match ^[a-z0-9][a-z0-9._-]{0,39}$ (e.g. 'web', 'rotom-mcp')");
      sourceFilter = sourceRaw;
    }
    const userId = await defaultUserId();

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
