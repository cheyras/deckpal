import { Router } from 'express';
import type pg from 'pg';
import { cardImages, q, q1, toMajor, withTx } from '../db.js';
import { asyncHandler, badRequest, notFound, oneOf, parseName, parseOptText, str, userCache, UUID_RE } from '../http.js';
import { currentUserId } from '../identity.js';
import { pct } from '../insights/trainerLevel.js';
import { evaluateRule, parseMissingSpec, parseRule, parseRuleItemId, resolveRuleSet, ruleFromDb, ruleItemId, type ListRule } from '../listRules.js';
import { missingForGoal, type MissingRow } from '../missing.js';
import { closeBatch, openBatch, OPS, parseSource, recordEvents, type MutationEventInput } from '../mutations.js';

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
 *                      (BEHAVIOR-SPEC §6.2 [D] A9).
 *
 *                      Since migration 050 a dynamic list MAY instead carry a saved
 *                      query (`card_list.rule`, the addMissing spec + exclusions —
 *                      see listRules.ts). A rule-backed "smart" list is re-evaluated
 *                      on every read: membership comes from missingForGoal at that
 *                      moment, stored list_item rows are ignored, and the moment you
 *                      own a card it leaves the list — which is the behaviour the
 *                      owner originally expected of "dynamic" ("I satisfied the
 *                      condition of owning Growlithe, he should not be on the list
 *                      anymore"). rule IS NULL (every pre-050 list) keeps the
 *                      reference-set behaviour above, untouched. On a smart list:
 *                      item add/bulk-add/reorder are refused (membership IS the
 *                      rule), and "remove" records an exclusion in the rule.
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

/** Ceiling for one bulk add. Comfortably inside the API's 30 s RLS hold. */
const BULK_MAX = 500;
const DESC_MAX = 2000;
const NOTE_MAX = 500;

function parseListId(v: string): string {
  // uuid PK; validate shape so a junk id is a clean 404-ish rather than a pg error.
  if (!UUID_RE.test(v)) {
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
  /** Up to COVER_MAX distinct cards for the index tile's mosaic, cover pick first. */
  covers: { serie: string; setcode: string; local: string }[] | null;
  rule: unknown;
  rule_evaluated_at: string | null;
}

/**
 * How many cards the index tile's cover mosaic will ever show. The owner's
 * spec verbatim: "a grid of the cards in the list … determine how many across
 * smartly … a maximum that will show." At the tile's 132px cover height, two
 * rows of four is the floor where a card is still recognisable as itself;
 * a third row or a fifth column is confetti. The web picks the grid shape
 * from however many of these it gets (1 → the old single cover).
 */
const COVER_MAX = 8;

/**
 * What a rule evaluation contributes to a summary. Everything a smart list's
 * tile shows comes from the evaluation, not from list_item (it has no rows):
 * itemCount is how many cards currently match, market is the cost to finish
 * them, covers feed the mosaic. progress is meaningless — by construction
 * every matching card is unowned — so it is null, like a static list.
 */
interface RuleSummaryOverride {
  itemCount: number;
  marketMinor: number | null;
  covers: { low: string; high: string }[];
}

function shapeSummary(r: ListSummaryRow, ruleEval?: RuleSummaryOverride) {
  const itemCount = ruleEval ? ruleEval.itemCount : Number(r.item_count);
  const ownedCount = Number(r.owned_count);
  const ownedCopies = Number(r.owned_copies);
  const rule = ruleFromDb(r.rule);
  return {
    id: r.id,
    kind: r.kind,
    name: r.name,
    description: r.description,
    visibility: r.visibility,
    isFavorite: r.is_favorite,
    coverRender: r.cover_render,
    pocketSize: r.pocket_size,
    rule,
    ruleEvaluatedAt: r.rule_evaluated_at,
    itemCount,
    // Dynamic + pokedex_binder carry progress; static does not (no collection
    // tie), and neither does a rule-backed list (owned is 0 by construction —
    // an owned card is no longer missing, so it is no longer a member).
    progress:
      r.kind === 'static' || rule
        ? null
        : { owned: ownedCount, total: itemCount, pct: pct(ownedCount, itemCount), copies: ownedCopies },
    marketValueUsd: ruleEval
      ? ruleEval.marketMinor != null
        ? toMajor(ruleEval.marketMinor, 'USD')
        : null
      : r.market_minor != null
        ? toMajor(Number(r.market_minor), 'USD')
        : null,
    coverImage: ruleEval
      ? (ruleEval.covers[0] ?? null)
      : r.cover_local && r.cover_serie && r.cover_setcode
        ? cardImages(r.cover_serie, r.cover_setcode, r.cover_local)
        : null,
    // The mosaic: distinct cards in list order (explicit cover pick first).
    // `coverImage` above stays as the first-tile shorthand so nothing that
    // only wants one image has to learn the array. A smart list's covers come
    // from its evaluation instead — there are no list_item rows to read.
    coverImages: ruleEval ? ruleEval.covers : (r.covers ?? []).map((c) => cardImages(c.serie, c.setcode, c.local)),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/**
 * Fetch one list's summary row (aggregates + cover) for a user. Shared by the index
 * and by mutation responses so a caller always gets the same shape back.
 */
async function summaryQuery(
  userId: string,
  listId?: string,
  opts: { deleted?: boolean } = {},
): Promise<ListSummaryRow[]> {
  // Soft delete (migration 038): deleted lists are invisible everywhere except
  // the recycle bin, which asks for them explicitly. Bound as a parameter
  // rather than interpolated so the predicate is visible in the SQL text — the
  // soft-delete source guard reads these queries, and so do people.
  const params: unknown[] = [userId, opts.deleted === true];
  let filter = '';
  if (listId) {
    params.push(listId);
    filter = `AND cl.id = $3`;
  }
  return q<ListSummaryRow>(
    `SELECT cl.id, cl.kind, cl.name, cl.description, cl.visibility, cl.is_favorite,
            cl.cover_render, cl.pocket_size, cl.created_at, cl.updated_at,
            COALESCE(agg.item_count, 0)   AS item_count,
            COALESCE(agg.owned_count, 0)  AS owned_count,
            COALESCE(agg.owned_copies, 0) AS owned_copies,
            agg.market_minor,
            cover.serie AS cover_serie, cover.setcode AS cover_setcode, cover.local_id AS cover_local,
            mosaic.covers, cl.rule, cl.rule_evaluated_at
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
  LEFT JOIN LATERAL (
         -- The mosaic's tiles: the first COVER_MAX DISTINCT CARDS in list
         -- order, with the explicit cover pick promoted to tile one. Distinct
         -- by card, not variant/item, because a static list legitimately holds
         -- four copies of one card and a cover showing the same art four times
         -- reads as a rendering bug, not a quantity.
         SELECT json_agg(json_build_object('serie', t.serie, 'setcode', t.setcode, 'local', t.local_id)
                         ORDER BY t.pick, t.position, t.added_at) AS covers
           FROM (
             SELECT d.*
               FROM (
                 SELECT DISTINCT ON (cv.card_id)
                        ser.tcgdex_id AS serie, cs.tcgdex_id AS setcode, c.local_id,
                        li3.position, li3.added_at,
                        (cv.id IS DISTINCT FROM cl.cover_card_variant_id) AS pick
                   FROM list_item li3
                   JOIN card_variant cv ON cv.id = li3.card_variant_id
                   JOIN card c ON c.id = cv.card_id
                   JOIN card_set cs ON cs.id = c.set_id
                   JOIN series ser ON ser.id = cs.series_id
                  WHERE li3.list_id = cl.id AND li3.card_variant_id IS NOT NULL
                  ORDER BY cv.card_id, li3.position, li3.added_at
               ) d
              ORDER BY d.pick, d.position, d.added_at
              LIMIT ${COVER_MAX}
           ) t
       ) mosaic ON true
      WHERE cl.user_id = $1
        AND (cl.deleted_at IS NOT NULL) = $2
        ${filter}
      ORDER BY cl.is_favorite DESC, cl.updated_at DESC`,
    params,
  );
}

/** Evaluate a smart list's rule into the override its summary renders from. */
async function ruleSummary(userId: string, rule: ListRule): Promise<RuleSummaryOverride> {
  const rows = await evaluateRule(userId, rule);
  let marketMinor: number | null = null;
  const seen = new Set<string>();
  const covers: { low: string; high: string }[] = [];
  for (const r of rows) {
    if (r.cheap_minor != null) marketMinor = (marketMinor ?? 0) + Number(r.cheap_minor);
    // Mosaic tiles: distinct by card, capped at 8 — same contract as the
    // list_item mosaic LATERAL above.
    if (covers.length < 8 && !seen.has(r.card_id)) {
      seen.add(r.card_id);
      covers.push(cardImages(r.serie_tcgdex_id, r.set_tcgdex_id, r.local_id));
    }
  }
  return { itemCount: rows.length, marketMinor, covers };
}

/**
 * Shape an index's worth of summaries, evaluating each smart list's rule.
 * Sequential on purpose: in RLS mode the request owns one pooled connection,
 * and a burst of parallel evaluations buys nothing but queueing. A rule whose
 * set has vanished degrades to the un-evaluated shape (count 0) rather than
 * failing the whole index — the detail page is where that error is surfaced.
 */
async function shapeSummaries(userId: string, rows: ListSummaryRow[]) {
  const out = [];
  for (const r of rows) {
    const rule = ruleFromDb(r.rule);
    if (!rule) {
      out.push(shapeSummary(r));
      continue;
    }
    try {
      out.push(shapeSummary(r, await ruleSummary(userId, rule)));
    } catch {
      out.push(shapeSummary(r));
    }
  }
  return out;
}

// ── GET /lists — index ──────────────────────────────────────────────────────
listsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const userId = currentUserId(req);
    // ?deleted=true is the recycle bin: soft-deleted lists, restorable until
    // purged. Everything else sees only live lists.
    const deleted = String(req.query.deleted ?? '') === 'true';
    const rows = await summaryQuery(userId, undefined, { deleted });
    userCache(res);
    res.json({ lists: await shapeSummaries(userId, rows), deleted });
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

/**
 * Resolve a rule evaluation into the same item shape the stored path serves —
 * the client renders both with the same components and cannot tell them apart
 * except by the synthetic `rule-<variantId>` item id (which is also how the
 * remove route knows a removal is an exclusion). Ownership is re-read here
 * rather than assumed zero: a card bought between evaluation and this query
 * deserves its true count, not the rule's assumption.
 */
async function shapeRuleItems(userId: string, evalRows: MissingRow[]) {
  if (!evalRows.length) return [];
  const ids = evalRows.map((r) => Number(r.card_variant_id));
  const rows = await q<ItemRow & { ord: string }>(
    `SELECT want.ord, NULL::uuid AS item_id, NULL::int AS position, NULL::smallint AS static_quantity, NULL::text AS note,
            cv.id AS variant_id, cv.variant_kind_code, cv.display_name AS variant_display,
            vk.display_name AS kind_display, cv.is_primary, t.tier,
            c.tcgdex_id AS card_id, c.local_id, c.number_sort, c.name, c.category, c.rarity, c.illustrator,
            ser.tcgdex_id AS serie, cs.tcgdex_id AS setcode, ser.slug AS series_slug,
            cs.slug AS set_slug, cs.name AS set_name,
            vc.variant_count,
            COALESCE(ci.quantity, 0) AS owned_qty,
            price.market_minor, price.currency_code,
            NULL::int AS dex_id, NULL::text AS species_name, NULL::text AS species_identifier,
            NULL::int AS species_generation, NULL::boolean AS species_owned
       FROM unnest($1::bigint[]) WITH ORDINALITY AS want(id, ord)
       JOIN card_variant cv ON cv.id = want.id
       JOIN variant_kind vk ON vk.code = cv.variant_kind_code
  LEFT JOIN variant_tier_resolved t ON t.card_variant_id = cv.id
       JOIN card c ON c.id = cv.card_id
       JOIN card_set cs ON cs.id = c.set_id
       JOIN series ser ON ser.id = cs.series_id
  LEFT JOIN collection_item ci ON ci.card_variant_id = cv.id AND ci.user_id = $2
  LEFT JOIN LATERAL (SELECT count(*) AS variant_count FROM card_variant cv2 WHERE cv2.card_id = cv.card_id) vc ON true
  LEFT JOIN LATERAL (
              SELECT pc.market_minor, pc.currency_code FROM price_current pc
               WHERE pc.card_variant_id = cv.id AND pc.source_code = 'tcgcsv' AND pc.currency_code = 'USD'
               LIMIT 1
            ) price ON true
      ORDER BY want.ord`,
    [ids, userId],
  );
  return rows.map((r, i) => {
    const ownedQty = Number(r.owned_qty);
    // Field-for-field the stored card-item shape in GET /lists/:id below.
    return {
      itemId: ruleItemId(r.variant_id!),
      position: i,
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
      seriesSlug: r.series_slug,
      setId: r.setcode,
      setName: r.set_name,
      images: r.serie && r.setcode && r.local_id ? cardImages(r.serie, r.setcode, r.local_id) : { low: '', high: '' },
      price: r.market_minor != null ? { market: toMajor(r.market_minor, r.currency_code ?? 'USD'), currency: (r.currency_code ?? 'USD').trim() } : null,
      note: null,
      staticQuantity: null,
      ownedQuantity: ownedQty,
      ownership: {
        totalQuantity: ownedQty,
        requiredCount: 1,
        ownedRequired: ownedQty >= 1 ? 1 : 0,
        have: ownedQty >= 1,
        need: ownedQty === 0,
        dupe: false,
      },
    };
  });
}

listsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const listId = parseListId(String(req.params.id));
    const userId = currentUserId(req);
    const summary = (await summaryQuery(userId, listId))[0];
    if (!summary) throw notFound(`No list '${listId}'`);

    // ── Smart list: membership is the rule, evaluated right now ─────────────
    // No list_item read at all — stored rows (if any survive from before the
    // rule was attached) are ignored while a rule is present.
    const rule = ruleFromDb(summary.rule);
    if (rule) {
      const evalRows = await evaluateRule(userId, rule);
      const items = await shapeRuleItems(userId, evalRows);
      // The editor lists what was excluded by hand, so "remove" is reversible
      // from the same surface that caused it.
      let excluded: { variantId: number; cardId: string; name: string; number: string }[] = [];
      if (rule.exclude.length) {
        const ex = await q<{ variant_id: string; card_id: string; name: string; local_id: string }>(
          `SELECT cv.id AS variant_id, c.tcgdex_id AS card_id, c.name, c.local_id
             FROM card_variant cv JOIN card c ON c.id = cv.card_id
            WHERE cv.id = ANY($1::bigint[])
            ORDER BY c.number_sort`,
          [rule.exclude],
        );
        excluded = ex.map((r) => ({ variantId: Number(r.variant_id), cardId: r.card_id, name: r.name, number: r.local_id }));
      }
      // Bookkeeping only — "evaluated just now" copy and freshness debugging.
      await q(`UPDATE card_list SET rule_evaluated_at = now() WHERE id = $1 AND user_id = $2`, [listId, userId]);
      let marketMinor: number | null = null;
      for (const r of evalRows) if (r.cheap_minor != null) marketMinor = (marketMinor ?? 0) + Number(r.cheap_minor);
      const seen = new Set<string>();
      const covers: { low: string; high: string }[] = [];
      for (const r of evalRows) {
        if (covers.length < 8 && !seen.has(r.card_id)) {
          seen.add(r.card_id);
          covers.push(cardImages(r.serie_tcgdex_id, r.set_tcgdex_id, r.local_id));
        }
      }
      userCache(res);
      res.json({
        list: shapeSummary(summary, { itemCount: evalRows.length, marketMinor, covers }),
        items,
        excluded,
      });
      return;
    }

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
          cardId: `dex-${r.dex_id}`,
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
        // `setId` is the SET's tcgdex id (`setcode`), never the series' (`serie`).
        // It was `r.serie` until 2026-08-29, which made every card link off every
        // list page resolve to `/series/<slug>/<seriesId>/<n>` — so CardDetail built
        // the id `base-60` for a card that is `base1-60` and rendered "No card
        // 'base-60'". The images line below is the reason it was invisible in
        // review: `cardImages()` takes serie AND setcode, so the art was always
        // right and only the click was wrong.
        seriesSlug: r.series_slug,
        setId: r.setcode,
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
    const userId = currentUserId(req);

    // A rule makes it a SMART list (migration 050): membership becomes the
    // saved query, re-evaluated on read. Parsed and resolved BEFORE the
    // transaction, following the bulk route's pattern — no pool re-entry
    // while holding the tx client.
    let rule: ListRule | null = null;
    if (body.rule !== undefined && body.rule !== null) {
      if (kind !== 'dynamic') throw badRequest('only a dynamic list can carry a rule');
      const parsed = parseRule(body.rule);
      const set = await resolveRuleSet(parsed.setId);
      rule = { ...parsed, setName: set.name };
    }

    const row = await withTx(async (client: pg.PoolClient) => {
      const batchId = await openBatch(client, { userId, source: parseSource(body.source), tool: 'list.create' });
      const ins = await client.query<{ id: string }>(
        `INSERT INTO card_list (user_id, kind, name, description, visibility, pocket_size, rule)
              VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb) RETURNING id`,
        [userId, kind, name, description, visibility, pocketSize, rule ? JSON.stringify(rule) : null],
      );
      const id = ins.rows[0]!.id;
      await recordEvents(client, batchId, userId, [
        { entityType: 'card_list', entityId: id, operation: OPS.listCreate, before: null, after: { name, kind, description, visibility, rule } },
      ]);
      await closeBatch(client, batchId, { listId: id, name, kind });
      return { id };
    });
    const summary = (await summaryQuery(userId, row.id))[0]!;
    userCache(res);
    const shaped = rule ? shapeSummary(summary, await ruleSummary(userId, rule)) : shapeSummary(summary);
    res.status(201).json({ list: shaped });
  }),
);

// ── PATCH /lists/:id — rename / edit / visibility / favorite / reorder ─────────
listsRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const listId = parseListId(String(req.params.id));
    const userId = currentUserId(req);
    const body = req.body ?? {};
    let order: string[] | undefined;
    if (body.itemOrder !== undefined) {
      if (!Array.isArray(body.itemOrder)
        || body.itemOrder.some((x: unknown) => typeof x !== 'string' || !UUID_RE.test(x))
        || new Set(body.itemOrder).size !== body.itemOrder.length) {
        throw badRequest('itemOrder must be an array of unique UUID strings');
      }
      order = body.itemOrder;
    }

    // Rule changes are parsed/resolved/evaluated BEFORE the transaction (the
    // bulk route's pattern — never re-enter the pool holding the tx client).
    // body.rule can be: absent (no change), an object (set/replace the rule),
    // or null (PIN the list: materialise the current evaluation into stored
    // list_item rows, then drop the rule — the list keeps its cards and goes
    // back to being an ordinary reference list).
    let nextRule: ListRule | null | undefined;
    let pinRows: MissingRow[] = [];
    if (body.rule !== undefined) {
      const cur = await q1<{ kind: Kind; rule: unknown }>(
        `SELECT kind, rule FROM card_list WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
        [listId, userId],
      );
      if (!cur) throw notFound(`No list '${listId}'`);
      if (cur.kind !== 'dynamic') throw badRequest('only a dynamic list can carry a rule');
      if (body.rule === null) {
        nextRule = null;
        const oldRule = ruleFromDb(cur.rule);
        if (oldRule) pinRows = await evaluateRule(userId, oldRule);
      } else {
        const parsed = parseRule(body.rule);
        const set = await resolveRuleSet(parsed.setId);
        nextRule = { ...parsed, setName: set.name };
      }
    }

    await withTx(async (client: pg.PoolClient) => {
      const existing = await client.query<{ id: string; kind: Kind; name: string; rule: unknown }>(
        `SELECT id, kind, name, rule FROM card_list WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL FOR UPDATE`,
        [listId, userId],
      );
      if (!existing.rows[0]) throw notFound(`No list '${listId}'`);
      const previousName = existing.rows[0].name;
      const previousRule = ruleFromDb(existing.rows[0].rule);

      if (nextRule !== undefined) {
        if (nextRule === null && previousRule && pinRows.length) {
          // Pin: keep the evaluation as real rows. Appended with the same
          // silent dedupe the item routes use, and existing rows are never
          // deleted — pinning must not be able to destroy anything.
          const posRow = await client.query<{ next: number }>(
            `SELECT COALESCE(max(position), -1) + 1 AS next FROM list_item WHERE list_id = $1`,
            [listId],
          );
          let position = posRow.rows[0]?.next ?? 0;
          const vals: string[] = [];
          const params: unknown[] = [listId, userId];
          for (const r of pinRows) {
            params.push(position++, Number(r.card_variant_id));
            vals.push(`($1, $2, 'dynamic', $${params.length - 1}, $${params.length})`);
          }
          await client.query(
            `INSERT INTO list_item (list_id, user_id, list_kind, position, card_variant_id)
                  VALUES ${vals.join(', ')}
             ON CONFLICT (list_id, card_variant_id) WHERE list_kind = 'dynamic' DO NOTHING`,
            params,
          );
        }
        await client.query(
          `UPDATE card_list SET rule = $3::jsonb, rule_evaluated_at = NULL, updated_at = now() WHERE id = $1 AND user_id = $2`,
          [listId, userId, nextRule ? JSON.stringify(nextRule) : null],
        );
        const batchId = await openBatch(client, { userId, source: parseSource(body.source), tool: 'list.rule.set' });
        await recordEvents(client, batchId, userId, [
          {
            entityType: 'card_list',
            entityId: listId,
            operation: OPS.listRuleSet,
            before: { rule: previousRule },
            after: { rule: nextRule, pinned: nextRule === null ? pinRows.length : undefined },
          },
        ]);
        await closeBatch(client, batchId, { listId, rule: nextRule ? 'set' : 'pinned' });
      }

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
        // A rename is the one PATCH field worth undoing on its own — the rest
        // (favourite, cover, pocket size) are presentation, and reverting them
        // would be noise in the history.
        if (body.name !== undefined && parseName(body.name) !== previousName) {
          const batchId = await openBatch(client, { userId, source: parseSource(body.source), tool: 'list.rename' });
          await recordEvents(client, batchId, userId, [
            {
              entityType: 'card_list',
              entityId: listId,
              operation: OPS.listRename,
              before: { name: previousName },
              after: { name: parseName(body.name) },
            },
          ]);
          await closeBatch(client, batchId, { listId, name: parseName(body.name) });
        }
      }

      // Reorder: itemOrder is the full ordered array of itemIds. Rewrite positions
      // 0..n-1. Two-phase (offset then final) to dodge the (list_id, position)
      // ordering churn without a unique-violation window.
      // A smart list has no custom order — membership and order are the
      // evaluator's — so a reorder against one is a caller bug, said plainly.
      if (order && (nextRule ?? previousRule)) {
        throw badRequest('a smart list is ordered by its rule — there is no custom order to save');
      }
      if (order) {
        if (order.length) {
          await client.query(
            `UPDATE list_item SET position = position + 1000000 WHERE list_id = $1 AND user_id = $2`,
            [listId, userId],
          );
          await client.query(
            `UPDATE list_item li
                SET position = o.ord - 1
               FROM unnest($3::uuid[]) WITH ORDINALITY AS o(id, ord)
              WHERE li.id = o.id AND li.list_id = $1 AND li.user_id = $2`,
            [listId, userId, order],
          );
          // Any items not named in itemOrder keep a high position (appended after).
        }
      }
      // Always bump updated_at when a reorder happened even if no column set.
      if (!sets.length && order) {
        await client.query(`UPDATE card_list SET updated_at = now() WHERE id = $1 AND user_id = $2`, [listId, userId]);
      }
    });

    const summary = (await summaryQuery(userId, listId))[0]!;
    userCache(res);
    res.json({ list: shapeSummary(summary) });
  }),
);

// ── DELETE /lists/:id — soft by default, ?purge=true to really destroy it ─────
//
// Until migration 038 this was a hard DELETE and the tool description said so:
// permanent, no undo. Now the row is marked deleted, disappears from every read,
// and can be restored — which is what makes "an agent deleted my list" a
// recoverable event rather than a support ticket.
//
// Purge is the deliberate exception. It is a real DELETE, it takes the list's
// items and binder placements with it through the existing cascades, and it is
// the one path in this API with no undo. It has to be asked for by name.
listsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const listId = parseListId(String(req.params.id));
    const userId = currentUserId(req);
    const purge = String(req.query.purge ?? '') === 'true';
    const source = parseSource((req.body ?? {}).source);

    const out = await withTx(async (client: pg.PoolClient) => {
      const cur = await client.query<{ id: string; name: string; kind: Kind; deleted_at: string | null }>(
        `SELECT id, name, kind, deleted_at FROM card_list WHERE id = $1 AND user_id = $2 FOR UPDATE`,
        [listId, userId],
      );
      const list = cur.rows[0];
      if (!list) throw notFound(`No list '${listId}'`);

      const batchId = await openBatch(client, { userId, source, tool: purge ? 'list.purge' : 'list.delete' });
      if (purge) {
        const items = await client.query<{ n: string }>(`SELECT count(*) AS n FROM list_item WHERE list_id = $1`, [listId]);
        // soft-delete-exempt: this IS the purge — the one deliberate hard delete.
        await client.query(`DELETE FROM card_list WHERE id = $1 AND user_id = $2`, [listId, userId]);
        await recordEvents(client, batchId, userId, [
          {
            entityType: 'card_list',
            entityId: listId,
            operation: OPS.listPurge,
            before: { name: list.name, kind: list.kind, itemCount: Number(items.rows[0]?.n ?? 0) },
            after: null,
          },
        ]);
        await closeBatch(client, batchId, { purged: listId });
        return { purged: listId, deleted: listId, restorable: false };
      }

      if (list.deleted_at) return { deleted: listId, restorable: true, alreadyDeleted: true };
      await client.query(`UPDATE card_list SET deleted_at = now() WHERE id = $1 AND user_id = $2`, [listId, userId]);
      await recordEvents(client, batchId, userId, [
        {
          entityType: 'card_list',
          entityId: listId,
          operation: OPS.listDelete,
          before: { name: list.name, kind: list.kind },
          after: null,
        },
      ]);
      await closeBatch(client, batchId, { deleted: listId });
      return { deleted: listId, restorable: true, batchId };
    });

    userCache(res);
    res.status(200).json(out);
  }),
);

// ── POST /lists/:id/restore — undelete ────────────────────────────────────────
listsRouter.post(
  '/:id/restore',
  asyncHandler(async (req, res) => {
    const listId = parseListId(String(req.params.id));
    const userId = currentUserId(req);
    const source = parseSource((req.body ?? {}).source);

    await withTx(async (client: pg.PoolClient) => {
      const cur = await client.query<{ id: string; name: string; kind: Kind; deleted_at: string | null }>(
        `SELECT id, name, kind, deleted_at FROM card_list WHERE id = $1 AND user_id = $2 FOR UPDATE`,
        [listId, userId],
      );
      const list = cur.rows[0];
      if (!list) throw notFound(`No list '${listId}'`);
      if (!list.deleted_at) return;
      const batchId = await openBatch(client, { userId, source, tool: 'list.restore' });
      await client.query(`UPDATE card_list SET deleted_at = NULL, updated_at = now() WHERE id = $1 AND user_id = $2`, [
        listId,
        userId,
      ]);
      await recordEvents(client, batchId, userId, [
        { entityType: 'card_list', entityId: listId, operation: OPS.listRestore, before: null, after: { name: list.name, kind: list.kind } },
      ]);
      await closeBatch(client, batchId, { restored: listId });
    });

    const summary = (await summaryQuery(userId, listId))[0];
    if (!summary) throw notFound(`No list '${listId}'`);
    userCache(res);
    res.json({ restored: listId, list: shapeSummary(summary) });
  }),
);

// ── POST /lists/:id/items — add a card/variant (or species for a binder) ──────
listsRouter.post(
  '/:id/items',
  asyncHandler(async (req, res) => {
    const listId = parseListId(String(req.params.id));
    const userId = currentUserId(req);
    const body = req.body ?? {};

    const result = await withTx(async (client: pg.PoolClient) => {
      const batchId = await openBatch(client, { userId, source: parseSource(body.source), tool: 'list.item.add' });
      const listRow = await client.query<{ id: string; kind: Kind; rule: unknown }>(
        `SELECT id, kind, rule FROM card_list WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL FOR UPDATE`,
        [listId, userId],
      );
      const list = listRow.rows[0];
      if (!list) throw notFound(`No list '${listId}'`);
      if (ruleFromDb(list.rule)) {
        throw badRequest('this is a smart list — membership is its rule. Edit the rule instead of adding items.');
      }

      // Next position = end of list, unless an explicit position is given.
      const posRow = await client.query<{ next: number }>(
        `SELECT COALESCE(max(position), -1) + 1 AS next FROM list_item WHERE list_id = $1`,
        [listId],
      );
      let position = posRow.rows[0]?.next ?? 0;
      if (body.position !== undefined) {
        const p = Number(body.position);
        if (!Number.isInteger(p) || p < 0) throw badRequest('position must be a non-negative integer');
        position = p;
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
      if (insertedId !== null) {
        await recordEvents(client, batchId, userId, [
          {
            entityType: 'list_item',
            entityId: insertedId,
            operation: OPS.listItemAdd,
            before: null,
            after: {
              listId,
              listKind: list.kind,
              position,
              cardVariantId: list.kind === 'pokedex_binder' ? null : Number(body.cardVariantId ?? body.variantId),
              dexId: list.kind === 'pokedex_binder' ? Number(body.dexId) : null,
            },
          },
        ]);
      }
      await closeBatch(client, batchId, { itemId: insertedId, listId });
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

// ══════════════════════════════════════════════════════════════════════════════
// POST /lists/:id/items/bulk — many items, one transaction, one batch
// ══════════════════════════════════════════════════════════════════════════════
//
// The per-item POST above is right for a click and wrong for building a list of
// what you are missing from a set. An agent asked to do exactly that had to:
// call set_progress (which already computed the answer), then call get_card
// once per card to turn a name+number into a variant id, then POST each item —
// roughly ninety round trips to do what the app had already worked out.
//
// So this takes either an explicit list of items OR a derivation
// (`addMissing`), resolves it server-side, and writes it in one statement.
// `addMissing` is the important half: "add everything missing for this goal in
// this set, minus these rarities" is the single most common list an agent is
// asked to build, and it now costs one call.
listsRouter.post(
  '/:id/items/bulk',
  asyncHandler(async (req, res) => {
    const listId = parseListId(String(req.params.id));
    const userId = currentUserId(req);
    const body = req.body ?? {};
    const dryRun = body.dryRun === true;
    const source = parseSource(body.source);

    const list = await q1<{ id: string; kind: Kind; name: string; rule: unknown }>(
      `SELECT id, kind, name, rule FROM card_list WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
      [listId, userId],
    );
    if (!list) throw notFound(`No list '${listId}'`);
    if (ruleFromDb(list.rule)) {
      throw badRequest('this is a smart list — membership is its rule. Edit the rule instead of adding items.');
    }

    // ── Resolve what to add ──────────────────────────────────────────────────
    interface Candidate {
      cardVariantId: number | null;
      dexId: number | null;
      quantity: number;
      note: string | null;
      label: string;
    }
    const candidates: Candidate[] = [];
    const unresolved: string[] = [];

    if (body.addMissing !== undefined && body.addMissing !== null) {
      if (list.kind === 'pokedex_binder') throw badRequest('addMissing builds card rows; a pokedex_binder takes species');
      // One parser for this spec and the smart-list rule (listRules.ts) — the
      // two vocabularies must never drift. One behaviour change rode in with
      // the extraction: an unknown goal is now a 400 instead of silently
      // becoming 'complete', which is what a filter with a typo deserves.
      const spec = parseMissingSpec(body.addMissing, 'addMissing');
      const set = await resolveRuleSet(spec.setId);

      const rows = await missingForGoal(userId, set.id, spec.goal, {
        finishes: spec.finishes,
        rarity: spec.rarity,
        rarityExclude: spec.rarityExclude,
        maxPriceUsd: spec.maxPriceUsd,
        pricedOnly: spec.pricedOnly,
      });
      for (const r of rows) {
        candidates.push({
          cardVariantId: Number(r.card_variant_id),
          dexId: null,
          quantity: 1,
          note: null,
          label: `${r.name} ${r.set_tcgdex_id} #${r.local_id}${r.variant_name ? ` (${r.variant_name})` : ''}`,
        });
      }
    }

    if (Array.isArray(body.items)) {
      if (body.items.length > BULK_MAX) throw badRequest(`items must be ${BULK_MAX} or fewer`);
      // Two batched lookups, whatever the item count.
      const wantVariants: number[] = [];
      const wantCards: string[] = [];
      for (const [i, raw] of (body.items as Array<Record<string, unknown>>).entries()) {
        if (raw === null || typeof raw !== 'object') throw badRequest(`items[${i}] must be an object`);
        const v = raw.cardVariantId ?? raw.variantId;
        if (v !== undefined && v !== null) wantVariants.push(Number(v));
        else if (typeof raw.cardId === 'string') wantCards.push(raw.cardId.trim());
      }
      const variantOk = new Set<number>();
      if (wantVariants.length) {
        const found = await q<{ id: string }>(`SELECT id FROM card_variant WHERE id = ANY($1::bigint[])`, [wantVariants]);
        for (const r of found) variantOk.add(Number(r.id));
      }
      const cardPrimary = new Map<string, number>();
      if (wantCards.length) {
        const found = await q<{ tcgdex_id: string; variant_id: string }>(
          `SELECT DISTINCT ON (c.tcgdex_id) c.tcgdex_id, cv.id AS variant_id
             FROM card c JOIN card_variant cv ON cv.card_id = c.id
            WHERE c.tcgdex_id = ANY($1::text[]) AND c.lang = 'en'
            ORDER BY c.tcgdex_id, cv.is_primary DESC, cv.sort_order`,
          [wantCards],
        );
        for (const r of found) cardPrimary.set(r.tcgdex_id, Number(r.variant_id));
      }
      for (const [i, raw] of (body.items as Array<Record<string, unknown>>).entries()) {
        const note = parseOptText(raw.note, NOTE_MAX, `items[${i}].note`);
        const qtyRaw = raw.quantity ?? 1;
        const quantity = typeof qtyRaw === 'number' ? qtyRaw : Number(qtyRaw);
        if (!Number.isInteger(quantity) || quantity < 1) throw badRequest(`items[${i}].quantity must be an integer >= 1`);
        if (raw.dexId !== undefined && raw.dexId !== null) {
          if (list.kind !== 'pokedex_binder') throw badRequest(`items[${i}] has dexId but this list is ${list.kind}`);
          candidates.push({ cardVariantId: null, dexId: Number(raw.dexId), quantity, note, label: `dex #${String(raw.dexId)}` });
          continue;
        }
        const v = raw.cardVariantId ?? raw.variantId;
        if (v !== undefined && v !== null) {
          const variantId = Number(v);
          if (!variantOk.has(variantId)) {
            unresolved.push(`variant ${variantId}`);
            continue;
          }
          candidates.push({ cardVariantId: variantId, dexId: null, quantity, note, label: `variant ${variantId}` });
          continue;
        }
        if (typeof raw.cardId === 'string') {
          const hit = cardPrimary.get(raw.cardId.trim());
          if (hit === undefined) {
            unresolved.push(`card '${raw.cardId}'`);
            continue;
          }
          candidates.push({ cardVariantId: hit, dexId: null, quantity, note, label: raw.cardId.trim() });
          continue;
        }
        throw badRequest(`items[${i}] needs cardVariantId, cardId, or dexId`);
      }
    }

    if (candidates.length === 0 && unresolved.length === 0 && !body.addMissing && !Array.isArray(body.items)) {
      throw badRequest('nothing to add — pass items and/or addMissing');
    }
    // Nothing resolvable is a RESULT, not an error: "add everything missing"
    // against a finished set is a legitimate no-op, and an items list where
    // every entry was bogus deserves the unresolved report rather than a 500
    // from an INSERT with an empty VALUES list.
    if (candidates.length === 0) {
      userCache(res);
      res.status(200).json({ listId, dryRun, added: 0, alreadyPresent: 0, unresolved, batchId: null });
      return;
    }
    if (candidates.length > BULK_MAX) {
      throw badRequest(`that resolves to ${candidates.length} items; the limit is ${BULK_MAX}. Narrow it with rarity/finish/price filters.`);
    }

    if (dryRun) {
      userCache(res);
      res.json({
        listId,
        dryRun: true,
        wouldAdd: candidates.length,
        unresolved,
        items: candidates.map((c) => ({ label: c.label, cardVariantId: c.cardVariantId, dexId: c.dexId, quantity: c.quantity })),
      });
      return;
    }

    const out = await withTx(async (client: pg.PoolClient) => {
      const batchId = await openBatch(client, { userId, source, tool: 'list.items.bulk', note: parseOptText(body.note, NOTE_MAX, 'note') });
      // Re-check under the lock: the list could have been deleted between the
      // resolution above and this transaction.
      const live = await client.query(
        `SELECT 1 FROM card_list WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL FOR UPDATE`,
        [listId, userId],
      );
      if (!live.rows[0]) throw notFound(`No list '${listId}'`);
      const posRow = await client.query<{ next: number }>(
        `SELECT COALESCE(max(position), -1) + 1 AS next FROM list_item WHERE list_id = $1`,
        [listId],
      );
      let position = posRow.rows[0]?.next ?? 0;

      const vals: string[] = [];
      const params: unknown[] = [listId, userId, list.kind];
      for (const c of candidates) {
        const b = params.length;
        vals.push(`($1, $2, $3, $${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5})`);
        params.push(
          position++,
          c.cardVariantId,
          c.dexId,
          list.kind === 'static' ? c.quantity : null,
          c.note,
        );
      }
      // Dedupe is the same silent ON CONFLICT the per-item route uses, so a
      // re-run of the same bulk add is a no-op rather than a duplicate row.
      const conflict =
        list.kind === 'static'
          ? '' // static lists are bags; duplicates are legal
          : list.kind === 'pokedex_binder'
            ? `ON CONFLICT (list_id, dex_id) WHERE list_kind = 'pokedex_binder' DO NOTHING`
            : `ON CONFLICT (list_id, card_variant_id) WHERE list_kind = 'dynamic' DO NOTHING`;
      const ins = await client.query<{ id: string; position: number; card_variant_id: string | null; dex_id: number | null }>(
        `INSERT INTO list_item (list_id, user_id, list_kind, position, card_variant_id, dex_id, static_quantity, note)
              VALUES ${vals.join(', ')}
         ${conflict}
         RETURNING id, position, card_variant_id, dex_id`,
        params,
      );

      await recordEvents(
        client,
        batchId,
        userId,
        ins.rows.map<MutationEventInput>((r) => ({
          entityType: 'list_item',
          entityId: r.id,
          operation: OPS.listItemAdd,
          before: null,
          after: {
            listId,
            listKind: list.kind,
            position: r.position,
            cardVariantId: r.card_variant_id === null ? null : Number(r.card_variant_id),
            dexId: r.dex_id,
          },
        })),
      );
      await client.query(`UPDATE card_list SET updated_at = now() WHERE id = $1 AND user_id = $2`, [listId, userId]);
      const payload = {
        listId,
        dryRun: false,
        batchId,
        added: ins.rows.length,
        alreadyPresent: candidates.length - ins.rows.length,
        unresolved,
      };
      await closeBatch(client, batchId, payload);
      return payload;
    });

    const summary = (await summaryQuery(userId, listId))[0]!;
    userCache(res);
    res.status(201).json({ ...out, list: shapeSummary(summary) });
  }),
);

// ── DELETE /lists/:id/items/:itemId ───────────────────────────────────────────
listsRouter.delete(
  '/:id/items/:itemId',
  asyncHandler(async (req, res) => {
    const listId = parseListId(String(req.params.id));
    const itemId = String(req.params.itemId);
    const userId = currentUserId(req);

    // ── Smart list: "remove" is an exclusion, not a delete ──────────────────
    // A rule-evaluated item has no row to delete, and deleting one would be
    // futile anyway — the rule would put the card straight back on the next
    // read. So the synthetic `rule-<variantId>` id routes here: the variant
    // joins the rule's exclude set, undoable (list.rule.exclude) and listed
    // in the rule editor for un-excluding.
    const excludeVariantId = parseRuleItemId(itemId);
    if (excludeVariantId !== null) {
      await withTx(async (client: pg.PoolClient) => {
        const cur = await client.query<{ rule: unknown }>(
          `SELECT rule FROM card_list WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL FOR UPDATE`,
          [listId, userId],
        );
        if (!cur.rows[0]) throw notFound(`No list '${listId}'`);
        const rule = ruleFromDb(cur.rows[0].rule);
        if (!rule) throw badRequest(`item '${itemId}' names a rule result, but this list has no rule`);
        if (rule.exclude.includes(excludeVariantId)) return; // already excluded — idempotent
        const nextExclude = [...rule.exclude, excludeVariantId];
        const batchId = await openBatch(client, { userId, source: parseSource((req.body ?? {}).source), tool: 'list.rule.exclude' });
        await client.query(
          `UPDATE card_list SET rule = jsonb_set(rule, '{exclude}', $3::jsonb), updated_at = now()
            WHERE id = $1 AND user_id = $2`,
          [listId, userId, JSON.stringify(nextExclude)],
        );
        await recordEvents(client, batchId, userId, [
          {
            entityType: 'card_list',
            entityId: listId,
            operation: OPS.listRuleExclude,
            before: { exclude: rule.exclude },
            after: { exclude: nextExclude, cardVariantId: excludeVariantId },
          },
        ]);
        await closeBatch(client, batchId, { excluded: excludeVariantId, listId });
      });
      const summary = (await summaryQuery(userId, listId))[0];
      const ruleNow = summary ? ruleFromDb(summary.rule) : null;
      userCache(res);
      res.status(200).json({
        deleted: itemId,
        excludedVariantId: excludeVariantId,
        list: summary ? shapeSummary(summary, ruleNow ? await ruleSummary(userId, ruleNow) : undefined) : null,
      });
      return;
    }

    if (!/^[0-9a-f-]{36}$/i.test(itemId)) throw notFound(`No item '${itemId}'`);
    // The whole row is snapshotted before it goes, so an undo can put it back
    // exactly — same id, same position, same note.
    const del = await withTx(async (client: pg.PoolClient) => {
      const batchId = await openBatch(client, { userId, source: parseSource((req.body ?? {}).source), tool: 'list.item.remove' });
      // The parent must still be live: an agent holding a stale id must not be
      // able to gut a list the user believes is deleted (and then restore a
      // hollowed-out list).
      const parent = await client.query(
        `SELECT 1 FROM card_list WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL FOR UPDATE`,
        [listId, userId],
      );
      if (!parent.rows[0]) throw notFound(`No list '${listId}'`);
      const gone = await client.query<{
        id: string;
        list_id: string;
        list_kind: string;
        position: number;
        card_variant_id: string | null;
        dex_id: number | null;
        static_quantity: number | null;
        note: string | null;
      }>(
        `DELETE FROM list_item WHERE id = $1 AND list_id = $2 AND user_id = $3
         RETURNING id, list_id, list_kind, position, card_variant_id, dex_id, static_quantity, note`,
        [itemId, listId, userId],
      );
      const row = gone.rows[0];
      if (!row) return null;
      await recordEvents(client, batchId, userId, [
        {
          entityType: 'list_item',
          entityId: row.id,
          operation: OPS.listItemRemove,
          before: {
            listId: row.list_id,
            listKind: row.list_kind,
            position: row.position,
            cardVariantId: row.card_variant_id === null ? null : Number(row.card_variant_id),
            dexId: row.dex_id,
            staticQuantity: row.static_quantity,
            note: row.note,
          },
          after: null,
        },
      ]);
      await client.query(`UPDATE card_list SET updated_at = now() WHERE id = $1 AND user_id = $2`, [listId, userId]);
      await closeBatch(client, batchId, { removed: row.id, listId });
      return row;
    });
    if (!del) throw notFound(`No item '${itemId}' in list '${listId}'`);
    const summary = (await summaryQuery(userId, listId))[0];
    userCache(res);
    res.status(200).json({ deleted: itemId, list: summary ? shapeSummary(summary) : null });
  }),
);
