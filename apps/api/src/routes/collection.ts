import { Router } from 'express';
import type pg from 'pg';
import { defaultUserId, recomputeSetProgress, withTx, type SetProgress } from '../db.js';
import { asyncHandler, badRequest, notFound, userCache } from '../http.js';

export const collectionRouter: Router = Router();

/**
 * Collection write endpoints (Phase 3 · task 3). These are the ONLY writers in the
 * app; every other route is read-only. All under /pokedex/api/collection.
 *
 * A mutation, in ONE transaction (withTx): upsert collection_item to the new
 * quantity, append a collection_event for the non-zero delta, then recompute the
 * affected set's three user_set_progress rows (SCHEMA §9.3 — progress is
 * materialised, invalidated on collection mutation). Idempotent: setting the same
 * quantity writes no event and just returns current state. Parameterized only.
 *
 * The single default user owns the collection (no auth; nginx/the SSO gate is the ingress).
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

/**
 * Apply a new absolute quantity to (user, variant) and recompute set progress, all
 * in one transaction. `resolveQty` maps the current quantity to the target — this
 * lets set (absolute) and increment (relative) share every downstream step.
 */
async function applyQuantity(
  variantIdRaw: string,
  resolveQty: (current: number) => number,
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
        `INSERT INTO collection_event (user_id, card_variant_id, delta, quantity_after, is_first_acquisition)
              VALUES ($1, $2, $3, $4, $5)`,
        [userId, variantId, delta, clamped, isFirstAcquisition],
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
 * PATCH /pokedex/api/collection/variants/:variantId  { quantity }
 * Set the absolute owned quantity for a variant. Idempotent.
 */
collectionRouter.patch(
  '/variants/:variantId',
  asyncHandler(async (req, res) => {
    const quantity = parseQuantity((req.body ?? {}).quantity);
    const result = await applyQuantity(String(req.params.variantId), () => quantity);
    userCache(res);
    res.json(result);
  }),
);

/**
 * POST /pokedex/api/collection/variants/:variantId/increment  { delta? }
 * Adjust the owned quantity by a signed delta (default +1). Floors at 0.
 */
collectionRouter.post(
  '/variants/:variantId/increment',
  asyncHandler(async (req, res) => {
    const delta = parseDelta((req.body ?? {}).delta);
    const result = await applyQuantity(String(req.params.variantId), (cur) => cur + delta);
    userCache(res);
    res.json(result);
  }),
);

/**
 * POST /pokedex/api/collection/cards/:cardId/have   { have }
 * Tile-level Have/Need toggle. have:true owns the primary variant (sets it to 1 if
 * currently 0; leaves an existing higher quantity untouched). have:false zeroes
 * EVERY variant of the card (Need = own nothing). One transaction, one recompute.
 */
collectionRouter.post(
  '/cards/:cardId/have',
  asyncHandler(async (req, res) => {
    const have = Boolean((req.body ?? {}).have);
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
            `INSERT INTO collection_event (user_id, card_variant_id, delta, quantity_after, is_first_acquisition)
                  VALUES ($1, $2, 1, 1, $3)`,
            [userId, pv, Number(prior.rows[0]?.n ?? 0) === 0],
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
            `INSERT INTO collection_event (user_id, card_variant_id, delta, quantity_after, is_first_acquisition)
                  VALUES ($1, $2, $3, 0, false)`,
            [userId, row.card_variant_id, -Number(row.quantity)],
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
