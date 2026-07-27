import { Router } from 'express';
import type pg from 'pg';
import { cardImages, defaultUserId, q, q1, toMajor, withTx } from '../db.js';
import { asyncHandler, badRequest, notFound, oneOf, str, userCache } from '../http.js';

export const listsRouter: Router = Router();

/**
 * Lists (Phase 4). Three list kinds, straight from the live schema
 * (card_list.kind CHECK ∈ {dynamic, static, pokedex_binder}):
 *
 *   • dynamic        — an ordered set of card_variant references. Membership is the
 *                      stored references; OWNERSHIP is read through from the
 *                      collection at read time and never stored on the list, so the
 *                      progress cluster (owned/total, copies) auto-syncs with the
 *                      collection live. This mirrors pkmn.gg's Dynamic List
 *                      (BEHAVIOR-SPEC §6.2 [D] A9) and is exactly what the schema
 *                      encodes — there is no filter/query column on card_list, so a
 *                      dynamic list is a reference-set with read-through progress,
 *                      not a saved-filter. (Divergence from the task's "saved query"
 *                      phrasing, adopted because the DB has no filter column and the
 *                      [D] behaviour spec defines dynamic lists as reference-sets.)
 *   • static         — an ordered BAG of card_variant references; duplicates allowed,
 *                      each row carries its own static_quantity (≥1). No collection
 *                      tie, no progress. (BEHAVIOR-SPEC §6.3 [D] A10.)
 *   • pokedex_binder — one slot per dex species (list_item.dex_id). Read-through
 *                      "captured?" from the collection (owns ≥1 card of that species).
 *
 * Single default user, user_id threaded everywhere (matches collection.ts).
 * Parameterized queries only — list names/descriptions/notes are user text.
 * Writes go through withTx so the item write + position bookkeeping are atomic and
 * stay within the 2-connection pool budget.
 */

const KINDS = ['dynamic', 'static', 'pokedex_binder'] as const;
type Kind = (typeof KINDS)[number];
const VIS = ['private', 'public'] as const;

const NAME_MAX = 120;
const DESC_MAX = 2000;
const NOTE_MAX = 500;

function parseName(v: unknown): string {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) throw badRequest('name is required');
  if (s.length > NAME_MAX) throw badRequest(`name must be ≤ ${NAME_MAX} chars`);
  return s;
}
function parseOptText(v: unknown, max: number, field: string): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') throw badRequest(`${field} must be a string`);
  const s = v.trim();
  if (!s) return null;
  if (s.length > max) throw badRequest(`${field} must be ≤ ${max} chars`);
  return s;
}
function parseListId(v: string): string {
  // uuid PK; validate shape so a junk id is a clean 404-ish rather than a pg error.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) {
    throw notFound(`No list '${v}'`);
  }
  return v;
}

// ── Shapes ────────────────────────────────────────────────────────────────────

interface ListSummaryRow {
  id: string;
  kind: Kind;
  name: string;
  description: string | null;
  visibility: string;
  is_favorite: boolean;
  cover_render: string;
  pocket_size: number | null;
  created_at: string;
  updated_at: string;
  item_count: string;
  owned_count: string;
  owned_copies: string;
  market_minor: string | null;
  cover_serie: string | null;
  cover_setcode: string | null;
  cover_local: string | null;
}

function pct(owned: number, total: number): number {
  if (!owned || !total) return 0;
  return Math.round((owned / total) * 1000) / 10;
}

function shapeSummary(r: ListSummaryRow) {
  const itemCount = Number(r.item_count);
  const ownedCount = Number(r.owned_count);
  const ownedCopies = Number(r.owned_copies);
  return {
    id: r.id,
    kind: r.kind,
    name: r.name,
    description: r.description,
    visibility: r.visibility,
    isFavorite: r.is_favorite,
    coverRender: r.cover_render,
    pocketSize: r.pocket_size,
    itemCount,
    // Dynamic + pokedex_binder carry progress; static does not (no collection tie).
    progress:
      r.kind === 'static'
        ? null
        : { owned: ownedCount, total: itemCount, pct: pct(ownedCount, itemCount), copies: ownedCopies },
    marketValueUsd: r.market_minor != null ? toMajor(Number(r.market_minor), 'USD') : null,
    coverImage: r.cover_local && r.cover_serie && r.cover_setcode ? cardImages(r.cover_serie, r.cover_setcode, r.cover_local) : null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/**
 * Fetch one list's summary row (aggregates + cover) for a user. Shared by the index
 * and by mutation responses so a caller always gets the same shape back.
 */
async function summaryQuery(userId: number, listId?: string): Promise<ListSummaryRow[]> {
  const params: unknown[] = [userId];
  let filter = '';
  if (listId) {
    params.push(listId);
    filter = `AND cl.id = $2`;
  }
  return q<ListSummaryRow>(
    `SELECT cl.id, cl.kind, cl.name, cl.description, cl.visibility, cl.is_favorite,
            cl.cover_render, cl.pocket_size, cl.created_at, cl.updated_at,
            COALESCE(agg.item_count, 0)   AS item_count,
            COALESCE(agg.owned_count, 0)  AS owned_count,
            COALESCE(agg.owned_copies, 0) AS owned_copies,
            agg.market_minor,
            cover.serie AS cover_serie, cover.setcode AS cover_setcode, cover.local_id AS cover_local
       FROM card_list cl
  LEFT JOIN LATERAL (
         SELECT count(*) AS item_count,
                count(*) FILTER (
                  WHERE (cl.kind = 'dynamic' AND COALESCE(ci.quantity, 0) >= 1)
                     OR (cl.kind = 'pokedex_binder' AND sp.owned)
                ) AS owned_count,
                COALESCE(sum(
                  CASE WHEN cl.kind = 'dynamic' THEN COALESCE(ci.quantity, 0)
                       WHEN cl.kind = 'static'  THEN li.static_quantity
                       ELSE 0 END
                ), 0) AS owned_copies,
                sum(pc.market_minor) FILTER (WHERE cl.kind <> 'pokedex_binder') AS market_minor
           FROM list_item li
      LEFT JOIN collection_item ci ON ci.card_variant_id = li.card_variant_id AND ci.user_id = cl.user_id
      LEFT JOIN LATERAL (
             SELECT pc.market_minor FROM price_current pc
              WHERE pc.card_variant_id = li.card_variant_id
                AND pc.source_code = 'tcgcsv' AND pc.currency_code = 'USD'
                AND pc.market_minor IS NOT NULL LIMIT 1
           ) pc ON true
      LEFT JOIN LATERAL (
             SELECT EXISTS (
                SELECT 1 FROM card_species csp
                  JOIN card_variant cv2 ON cv2.card_id = csp.card_id
                  JOIN collection_item ci2 ON ci2.card_variant_id = cv2.id AND ci2.user_id = cl.user_id AND ci2.quantity >= 1
                 WHERE csp.dex_id = li.dex_id
             ) AS owned
           ) sp ON true
          WHERE li.list_id = cl.id
       ) agg ON true
  LEFT JOIN LATERAL (
         SELECT ser.tcgdex_id AS serie, cs.tcgdex_id AS setcode, c.local_id
           FROM card_variant cv
           JOIN card c ON c.id = cv.card_id
           JOIN card_set cs ON cs.id = c.set_id
           JOIN series ser ON ser.id = cs.series_id
          WHERE cv.id = COALESCE(
                  cl.cover_card_variant_id,
                  (SELECT li2.card_variant_id FROM list_item li2
                    WHERE li2.list_id = cl.id AND li2.card_variant_id IS NOT NULL
                    ORDER BY li2.position, li2.added_at LIMIT 1)
                )
          LIMIT 1
       ) cover ON true
      WHERE cl.user_id = $1 ${filter}
      ORDER BY cl.is_favorite DESC, cl.updated_at DESC`,
    params,
  );
}

// ── GET /lists — index ──────────────────────────────────────────────────────
listsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const userId = await defaultUserId();
    const rows = await summaryQuery(userId);
    userCache(res);
    res.json({ lists: rows.map(shapeSummary) });
  }),
);

// ── GET /lists/:id — detail with resolved items ───────────────────────────────
interface ItemRow {
  item_id: string;
  position: number;
  static_quantity: number | null;
  note: string | null;
  variant_id: string | null;
  variant_kind_code: string | null;
  variant_display: string | null;
  kind_display: string | null;
  is_primary: boolean | null;
  tier: string | null;
  card_id: string | null;
  local_id: string | null;
  number_sort: string | null;
  name: string | null;
  category: string | null;
  rarity: string | null;
  illustrator: string | null;
  serie: string | null;
  setcode: string | null;
  series_slug: string | null;
  set_slug: string | null;
  set_name: string | null;
  variant_count: string | null;
  owned_qty: string;
  market_minor: number | null;
  currency_code: string | null;
  // pokedex_binder
  dex_id: number | null;
  species_name: string | null;
  species_identifier: string | null;
  species_generation: number | null;
  species_owned: boolean | null;
}

listsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const listId = parseListId(String(req.params.id));
    const userId = await defaultUserId();
    const summary = (await summaryQuery(userId, listId))[0];
    if (!summary) throw notFound(`No list '${listId}'`);

    const rows = await q<ItemRow>(
      `SELECT li.id AS item_id, li.position, li.static_quantity, li.note,
              cv.id AS variant_id, cv.variant_kind_code, cv.display_name AS variant_display,
              vk.display_name AS kind_display, cv.is_primary, t.tier,
              c.tcgdex_id AS card_id, c.local_id, c.number_sort, c.name, c.category, c.rarity, c.illustrator,
              ser.tcgdex_id AS serie, cs.tcgdex_id AS setcode, ser.slug AS series_slug,
              cs.slug AS set_slug, cs.name AS set_name,
              vc.variant_count,
              COALESCE(ci.quantity, 0) AS owned_qty,
              price.market_minor, price.currency_code,
              d.id AS dex_id, d.name AS species_name, d.identifier AS species_identifier,
              d.generation AS species_generation, sp.owned AS species_owned
         FROM list_item li
    LEFT JOIN card_variant cv ON cv.id = li.card_variant_id
    LEFT JOIN variant_kind vk ON vk.code = cv.variant_kind_code
    LEFT JOIN variant_tier_resolved t ON t.card_variant_id = cv.id
    LEFT JOIN card c ON c.id = cv.card_id
    LEFT JOIN card_set cs ON cs.id = c.set_id
    LEFT JOIN series ser ON ser.id = cs.series_id
    LEFT JOIN collection_item ci ON ci.card_variant_id = cv.id AND ci.user_id = $2
    LEFT JOIN LATERAL (SELECT count(*) AS variant_count FROM card_variant cv2 WHERE cv2.card_id = cv.card_id) vc ON true
    LEFT JOIN LATERAL (
                SELECT pc.market_minor, pc.currency_code FROM price_current pc
                 WHERE pc.card_variant_id = cv.id AND pc.source_code = 'tcgcsv' AND pc.currency_code = 'USD'
                 LIMIT 1
              ) price ON true
    LEFT JOIN dex_species d ON d.id = li.dex_id
    LEFT JOIN LATERAL (
                SELECT EXISTS (
                   SELECT 1 FROM card_species csp
                     JOIN card_variant cvx ON cvx.card_id = csp.card_id
                     JOIN collection_item cix ON cix.card_variant_id = cvx.id AND cix.user_id = $2 AND cix.quantity >= 1
                    WHERE csp.dex_id = li.dex_id
                ) AS owned
              ) sp ON true
        WHERE li.list_id = $1
        ORDER BY li.position, li.added_at`,
      [listId, userId],
    );

    // For pokedex_binder rows, resolve a representative card image (any card of the
    // species, prefer an owned one) so the binder slot has art.
    let repImages = new Map<number, { serie: string; setcode: string; local: string }>();
    const dexIds = rows.filter((r) => r.dex_id != null).map((r) => Number(r.dex_id));
    if (dexIds.length) {
      const reps = await q<{ dex_id: number; serie: string; setcode: string; local_id: string }>(
        `SELECT DISTINCT ON (csp.dex_id) csp.dex_id,
                ser.tcgdex_id AS serie, cs.tcgdex_id AS setcode, c.local_id
           FROM card_species csp
           JOIN card c ON c.id = csp.card_id
           JOIN card_set cs ON cs.id = c.set_id
           JOIN series ser ON ser.id = cs.series_id
          WHERE csp.dex_id = ANY($1)
          ORDER BY csp.dex_id, c.number_sort`,
        [dexIds],
      );
      repImages = new Map(reps.map((r) => [r.dex_id, { serie: r.serie, setcode: r.setcode, local: r.local_id }]));
    }

    const items = rows.map((r) => {
      if (r.dex_id != null) {
        const rep = repImages.get(Number(r.dex_id));
        const owned = !!r.species_owned;
        return {
          itemId: r.item_id,
          position: r.position,
          kind: 'species' as const,
          dexId: Number(r.dex_id),
          // Shaped as a CardRow so the same GridView/BinderView renders it.
          cardId: rep ? `dex-${r.dex_id}` : `dex-${r.dex_id}`,
          number: String(r.dex_id),
          numberSort: String(r.dex_id).padStart(4, '0'),
          name: r.species_name,
          category: 'Pokemon',
          rarity: null,
          artist: null,
          generation: r.species_generation,
          variantCount: 1,
          images: rep ? cardImages(rep.serie, rep.setcode, rep.local) : { low: '', high: '' },
          price: null,
          note: r.note,
          ownership: { totalQuantity: owned ? 1 : 0, requiredCount: 1, ownedRequired: owned ? 1 : 0, have: owned, need: !owned, dupe: false },
        };
      }
      const ownedQty = Number(r.owned_qty);
      const staticQty = r.static_quantity != null ? Number(r.static_quantity) : null;
      // Displayed qty: static uses its own row quantity; dynamic uses owned-from-collection.
      const displayQty = summary.kind === 'static' ? (staticQty ?? 1) : ownedQty;
      return {
        itemId: r.item_id,
        position: r.position,
        kind: 'card' as const,
        cardId: r.card_id!,
        variantId: r.variant_id != null ? Number(r.variant_id) : null,
        variant: {
          kind: r.variant_kind_code,
          displayName: r.variant_display ?? r.kind_display,
          tier: r.tier,
          isPrimary: r.is_primary,
        },
        number: r.local_id,
        numberSort: r.number_sort,
        name: r.name,
        category: r.category,
        rarity: r.rarity,
        artist: r.illustrator,
        variantCount: Number(r.variant_count ?? 1),
        // Per-item routing (a list spans many sets) — the tile links using these.
        seriesSlug: r.series_slug,
        setId: r.serie,
        setName: r.set_name,
        images: r.serie && r.setcode && r.local_id ? cardImages(r.serie, r.setcode, r.local_id) : { low: '', high: '' },
        price: r.market_minor != null ? { market: toMajor(r.market_minor, r.currency_code ?? 'USD'), currency: (r.currency_code ?? 'USD').trim() } : null,
        note: r.note,
        staticQuantity: staticQty,
        ownedQuantity: ownedQty,
        ownership: {
          totalQuantity: displayQty,
          requiredCount: 1,
          ownedRequired: ownedQty >= 1 ? 1 : 0,
          have: ownedQty >= 1,
          need: ownedQty === 0,
          dupe: displayQty >= 2,
        },
      };
    });

    userCache(res);
    res.json({ list: shapeSummary(summary), items });
  }),
);

// ── POST /lists — create ──────────────────────────────────────────────────────
listsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = req.body ?? {};
    const name = parseName(body.name);
    const kind = oneOf<Kind>(body.kind, KINDS, 'dynamic');
    if (str(body.kind) && !KINDS.includes(str(body.kind) as Kind)) throw badRequest('kind must be dynamic|static|pokedex_binder');
    const description = parseOptText(body.description, DESC_MAX, 'description');
    const visibility = oneOf(body.visibility, VIS, 'private');
    // A pokedex_binder gets a default pocket size so the binder view has a layout.
    const pocketSize = kind === 'pokedex_binder' ? 9 : null;
    const userId = await defaultUserId();

    const row = await q1<{ id: string }>(
      `INSERT INTO card_list (user_id, kind, name, description, visibility, pocket_size)
            VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [userId, kind, name, description, visibility, pocketSize],
    );
    const summary = (await summaryQuery(userId, row!.id))[0]!;
    userCache(res);
    res.status(201).json({ list: shapeSummary(summary) });
  }),
);

// ── PATCH /lists/:id — rename / edit / visibility / favorite / reorder ─────────
listsRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const listId = parseListId(String(req.params.id));
    const userId = await defaultUserId();
    const body = req.body ?? {};

    await withTx(async (client: pg.PoolClient) => {
      const existing = await client.query<{ id: string; kind: Kind }>(
        `SELECT id, kind FROM card_list WHERE id = $1 AND user_id = $2 FOR UPDATE`,
        [listId, userId],
      );
      if (!existing.rows[0]) throw notFound(`No list '${listId}'`);

      const sets: string[] = [];
      const params: unknown[] = [listId, userId];
      const push = (frag: string, val: unknown) => {
        params.push(val);
        sets.push(`${frag} = $${params.length}`);
      };
      if (body.name !== undefined) push('name', parseName(body.name));
      if (body.description !== undefined) push('description', parseOptText(body.description, DESC_MAX, 'description'));
      if (body.visibility !== undefined) push('visibility', oneOf(body.visibility, VIS, 'private'));
      if (body.isFavorite !== undefined) push('is_favorite', Boolean(body.isFavorite));
      if (body.coverRender !== undefined) push('cover_render', oneOf(body.coverRender, ['full', 'art'] as const, 'full'));
      if (body.pocketSize !== undefined) {
        const ps = Number(body.pocketSize);
        if (![4, 9, 12, 16].includes(ps)) throw badRequest('pocketSize must be 4|9|12|16');
        push('pocket_size', ps);
      }
      if (body.coverCardVariantId !== undefined) {
        const cv = body.coverCardVariantId === null ? null : Number(body.coverCardVariantId);
        if (cv !== null && (!Number.isInteger(cv) || cv <= 0)) throw badRequest('coverCardVariantId must be a positive integer or null');
        push('cover_card_variant_id', cv);
      }

      if (sets.length) {
        await client.query(
          `UPDATE card_list SET ${sets.join(', ')}, updated_at = now() WHERE id = $1 AND user_id = $2`,
          params,
        );
      }

      // Reorder: itemOrder is the full ordered array of itemIds. Rewrite positions
      // 0..n-1. Two-phase (offset then final) to dodge the (list_id, position)
      // ordering churn without a unique-violation window.
      if (Array.isArray(body.itemOrder)) {
        const order: string[] = body.itemOrder.filter((x: unknown): x is string => typeof x === 'string');
        if (order.length) {
          await client.query(
            `UPDATE list_item SET position = position + 1000000 WHERE list_id = $1 AND user_id = $2`,
            [listId, userId],
          );
          for (let i = 0; i < order.length; i++) {
            await client.query(
              `UPDATE list_item SET position = $3 WHERE id = $4 AND list_id = $1 AND user_id = $2`,
              [listId, userId, i, order[i]],
            );
          }
          // Any items not named in itemOrder keep a high position (appended after).
        }
      }
      // Always bump updated_at when a reorder happened even if no column set.
      if (!sets.length && Array.isArray(body.itemOrder)) {
        await client.query(`UPDATE card_list SET updated_at = now() WHERE id = $1 AND user_id = $2`, [listId, userId]);
      }
    });

    const summary = (await summaryQuery(userId, listId))[0]!;
    userCache(res);
    res.json({ list: shapeSummary(summary) });
  }),
);

// ── DELETE /lists/:id ─────────────────────────────────────────────────────────
listsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const listId = parseListId(String(req.params.id));
    const userId = await defaultUserId();
    const del = await q1<{ id: string }>(
      `DELETE FROM card_list WHERE id = $1 AND user_id = $2 RETURNING id`,
      [listId, userId],
    );
    if (!del) throw notFound(`No list '${listId}'`);
    userCache(res);
    res.status(200).json({ deleted: listId });
  }),
);

// ── POST /lists/:id/items — add a card/variant (or species for a binder) ──────
listsRouter.post(
  '/:id/items',
  asyncHandler(async (req, res) => {
    const listId = parseListId(String(req.params.id));
    const userId = await defaultUserId();
    const body = req.body ?? {};

    const result = await withTx(async (client: pg.PoolClient) => {
      const listRow = await client.query<{ id: string; kind: Kind }>(
        `SELECT id, kind FROM card_list WHERE id = $1 AND user_id = $2 FOR UPDATE`,
        [listId, userId],
      );
      const list = listRow.rows[0];
      if (!list) throw notFound(`No list '${listId}'`);

      // Next position = end of list, unless an explicit position is given.
      const posRow = await client.query<{ next: number }>(
        `SELECT COALESCE(max(position), -1) + 1 AS next FROM list_item WHERE list_id = $1`,
        [listId],
      );
      let position = posRow.rows[0]?.next ?? 0;
      if (body.position !== undefined) {
        const p = Number(body.position);
        if (Number.isInteger(p) && p >= 0) position = p;
      }

      let insertedId: string | null = null;

      if (list.kind === 'pokedex_binder') {
        const dexId = Number(body.dexId);
        if (!Number.isInteger(dexId) || dexId <= 0) throw badRequest('dexId (positive integer) is required for a pokedex_binder');
        const sp = await client.query(`SELECT 1 FROM dex_species WHERE id = $1`, [dexId]);
        if (!sp.rows[0]) throw notFound(`No species '${dexId}'`);
        const note = parseOptText(body.note, NOTE_MAX, 'note');
        // (list_id, dex_id) is unique for a binder — dedupe silently.
        const ins = await client.query<{ id: string }>(
          `INSERT INTO list_item (list_id, user_id, list_kind, position, dex_id, note)
                VALUES ($1, $2, 'pokedex_binder', $3, $4, $5)
           ON CONFLICT (list_id, dex_id) WHERE list_kind = 'pokedex_binder' DO NOTHING
           RETURNING id`,
          [listId, userId, position, dexId, note],
        );
        insertedId = ins.rows[0]?.id ?? null;
      } else {
        const variantId = Number(body.cardVariantId ?? body.variantId);
        if (!Number.isInteger(variantId) || variantId <= 0) throw badRequest('cardVariantId (positive integer) is required');
        const vr = await client.query(`SELECT 1 FROM card_variant WHERE id = $1`, [variantId]);
        if (!vr.rows[0]) throw notFound(`No variant '${variantId}'`);
        const note = parseOptText(body.note, NOTE_MAX, 'note');

        if (list.kind === 'static') {
          let sq = 1;
          if (body.staticQuantity !== undefined) {
            sq = Number(body.staticQuantity);
            if (!Number.isInteger(sq) || sq < 1) throw badRequest('staticQuantity must be an integer ≥ 1');
          }
          // Static allows duplicates — always insert a fresh row.
          const ins = await client.query<{ id: string }>(
            `INSERT INTO list_item (list_id, user_id, list_kind, position, card_variant_id, static_quantity, note)
                  VALUES ($1, $2, 'static', $3, $4, $5, $6) RETURNING id`,
            [listId, userId, position, variantId, sq, note],
          );
          insertedId = ins.rows[0]?.id ?? null;
        } else {
          // dynamic — (list_id, card_variant_id) unique; dedupe silently.
          const ins = await client.query<{ id: string }>(
            `INSERT INTO list_item (list_id, user_id, list_kind, position, card_variant_id, note)
                  VALUES ($1, $2, 'dynamic', $3, $4, $5)
             ON CONFLICT (list_id, card_variant_id) WHERE list_kind = 'dynamic' DO NOTHING
             RETURNING id`,
            [listId, userId, position, variantId, note],
          );
          insertedId = ins.rows[0]?.id ?? null;
        }
      }

      await client.query(`UPDATE card_list SET updated_at = now() WHERE id = $1`, [listId]);
      return { insertedId, alreadyPresent: insertedId === null };
    });

    const summary = (await summaryQuery(userId, listId))[0]!;
    userCache(res);
    res.status(result.alreadyPresent ? 200 : 201).json({
      itemId: result.insertedId,
      alreadyPresent: result.alreadyPresent,
      list: shapeSummary(summary),
    });
  }),
);

// ── DELETE /lists/:id/items/:itemId ───────────────────────────────────────────
listsRouter.delete(
  '/:id/items/:itemId',
  asyncHandler(async (req, res) => {
    const listId = parseListId(String(req.params.id));
    const itemId = String(req.params.itemId);
    if (!/^[0-9a-f-]{36}$/i.test(itemId)) throw notFound(`No item '${itemId}'`);
    const userId = await defaultUserId();
    const del = await q1<{ id: string }>(
      `DELETE FROM list_item WHERE id = $1 AND list_id = $2 AND user_id = $3 RETURNING id`,
      [itemId, listId, userId],
    );
    if (!del) throw notFound(`No item '${itemId}' in list '${listId}'`);
    await q(`UPDATE card_list SET updated_at = now() WHERE id = $1 AND user_id = $2`, [listId, userId]);
    const summary = (await summaryQuery(userId, listId))[0];
    userCache(res);
    res.status(200).json({ deleted: itemId, list: summary ? shapeSummary(summary) : null });
  }),
);
