import { Router } from 'express';
import { q, q1 } from '../db.js';
import { asyncHandler, badRequest, notFound, oneOf, strList, userCache } from '../http.js';
import { currentUserId } from '../identity.js';
import { assertKnownRarities, FINISHES, GOALS, missingForGoal, type Goal } from '../missing.js';
import { buildCart, type CartInput } from '../tcgplayer/massentry.js';

/**
 * TCGplayer Mass Entry cart links.
 *
 *   GET  /sets/:setId/massentry   — everything still needed to finish a set
 *   GET  /lists/:listId/massentry — a saved list's own contents
 *   POST /massentry               — an explicit set of cards
 *
 * All three resolve to the same shape — a list of {productId, quantity} rows —
 * and hand it to buildCart() in ../tcgplayer/massentry.ts, which owns the line
 * grammar, the product-id contract and the URL chunking.
 *
 * The list and ad-hoc routes exist because the set route could only ever answer
 * "what is missing from this whole set at this goal". An agent that had built a
 * filtered list (say, missing cards EXCLUDING the Special Illustration Rares)
 * had no way to turn that list into a cart: set_cart re-derived from the set and
 * put the excluded cards straight back in. The list and the cart disagreeing was
 * a structural hole, not a mistake — these routes close it.
 *
 * Missing-for-goal math mirrors deckpal-mcp's set_progress (and therefore
 * recomputeSetProgress): complete = cards with no owned variant, master =
 * master_required_variant minus owned, grandmaster = every variant minus owned.
 */

export const massEntryRouter: Router = Router();
/** Mounted at '/' — carries its own full paths (see index.ts). */
export const cartRouter: Router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ADHOC_ITEMS = 500;

/** One row the cart builder needs, straight out of SQL. */
interface CartRow {
  name: string;
  local_id: string;
  set_tcgdex_id: string;
  variant_name: string | null;
  product_id: number | null;
  token: string | null;
  rarity: string | null;
  quantity?: number;
}

function toCartInputs(rows: readonly CartRow[]): CartInput[] {
  return rows.map((r) => ({
    quantity: r.quantity ?? 1,
    productId: r.product_id,
    token: r.token,
    name: r.name,
    number: r.local_id,
    setId: r.set_tcgdex_id,
    variant: r.variant_name,
  }));
}

/**
 * Shape one cart response. `context` names what was carted so the caller can
 * tell a set cart from a list cart without inspecting the request it sent.
 */
function cartPayload(context: Record<string, unknown>, rows: readonly CartRow[]): Record<string, unknown> {
  const build = buildCart(toCartInputs(rows));
  return {
    ...context,
    needed: {
      // `cards` is retained for compatibility with the previous shape: it has
      // always meant "distinct Mass Entry lines", not distinct cards.
      cards: build.needed.lines,
      items: build.needed.items,
      unlinkable: build.needed.unlinkable,
      exactLines: build.needed.exactLines,
      bestEffortLines: build.needed.bestEffortLines,
    },
    lines: [...build.exact.lines, ...build.bestEffort.lines],
    text: build.text,
    urls: build.urls,
    exactUrls: build.exact.urls,
    bestEffortUrls: build.bestEffort.urls,
    unlinkable: build.unlinkable,
    warnings: build.warnings,
    note: build.note,
  };
}

// ── Rarity filtering ─────────────────────────────────────────────────────────
// `card.rarity` is free text from TCGdex ("Special illustration rare"), and its
// casing does not match TCGplayer's ("Special Illustration Rare"), so every
// comparison is lower(). Values are always bound, never interpolated.

interface RarityFilter {
  include: string[] | null;
  exclude: string[] | null;
}

function rarityFilter(query: Record<string, unknown>): RarityFilter {
  const include = strList(query.rarity).map((s) => s.trim().toLowerCase()).filter(Boolean);
  const exclude = strList(query.rarity_exclude).map((s) => s.trim().toLowerCase()).filter(Boolean);
  return { include: include.length ? include : null, exclude: exclude.length ? exclude : null };
}

// ── GET /sets/:setId/massentry ───────────────────────────────────────────────

massEntryRouter.get(
  '/:setId/massentry',
  asyncHandler(async (req, res) => {
    const set = await q1<{ id: string; tcgdex_id: string; name: string }>(
      `SELECT cs.id, cs.tcgdex_id, cs.name
         FROM card_set cs
         JOIN series ser ON ser.id = cs.series_id
        WHERE cs.tcgdex_id = $1
        ORDER BY (ser.catalogue_code = 'en') DESC
        LIMIT 1`,
      [String(req.params.setId)],
    );
    if (!set) throw notFound(`No set '${String(req.params.setId)}'`);
    const userId = currentUserId(req);

    const goal = oneOf<Goal>(req.query.goal, GOALS, 'complete');
    const rawFinishes = strList(req.query.finish).map((f) => f.toLowerCase());
    const unknown = rawFinishes.filter((f) => !(FINISHES as readonly string[]).includes(f));
    if (unknown.length) throw badRequest(`Unknown finish '${unknown[0]}' — expected one of: ${FINISHES.join(', ')}`);
    // A full selection is the same as no filter; normalize so responses agree.
    const finishes = rawFinishes.length && rawFinishes.length < FINISHES.length ? [...new Set(rawFinishes)] : null;
    const rarity = rarityFilter(req.query as Record<string, unknown>);

    if (rarity.include) assertKnownRarities(rarity.include);
    if (rarity.exclude) assertKnownRarities(rarity.exclude);
    const missing = await missingForGoal(userId, set.id, goal, {
      finishes,
      rarity: rarity.include,
      rarityExclude: rarity.exclude,
    });
    const rows: CartRow[] = missing.map((m) => ({
      name: m.name,
      local_id: m.local_id,
      set_tcgdex_id: m.set_tcgdex_id,
      variant_name: goal === 'complete' ? null : m.variant_name,
      product_id: m.product_id,
      token: m.token,
      rarity: m.rarity,
    }));

    userCache(res);
    res.json(
      cartPayload(
        {
          source: 'set',
          set: { setId: set.tcgdex_id, name: set.name },
          goal,
          finishes, // null = all finishes
          rarity: rarity.include,
          rarityExclude: rarity.exclude,
        },
        rows,
      ),
    );
  }),
);


// ── GET /lists/:listId/massentry ─────────────────────────────────────────────

cartRouter.get(
  '/lists/:listId/massentry',
  asyncHandler(async (req, res) => {
    const listId = String(req.params.listId);
    if (!UUID_RE.test(listId)) throw notFound(`No list '${listId}'`);
    const userId = currentUserId(req);
    const list = await q1<{ id: string; name: string; kind: string }>(
      `SELECT id, name, kind FROM card_list WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
      [listId, userId],
    );
    if (!list) throw notFound(`No list '${listId}'`);
    if (list.kind === 'pokedex_binder') {
      throw badRequest('A pokedex_binder list tracks species, not printings — there is nothing to buy from it.');
    }

    // `owned_only: false` (default) carts the whole list; true carts only the
    // rows the user does not already own, which is what "buy what I still need
    // from this list" means for a dynamic list.
    const ownedOnly = String(req.query.missing_only ?? '') === 'true';

    const rows = await q<CartRow>(
      `SELECT c.name, c.local_id, cs.tcgdex_id AS set_tcgdex_id, c.rarity,
              COALESCE(cv.display_name, vk.display_name) AS variant_name,
              cv.tcgplayer_product_id AS product_id,
              cv.tcgplayer_mass_entry AS token,
              GREATEST(
                COALESCE(li.static_quantity, 1)
                  - CASE WHEN $3::boolean THEN COALESCE(ci.quantity, 0) ELSE 0 END,
                0)::int AS quantity
         FROM list_item li
         JOIN card_variant cv ON cv.id = li.card_variant_id
         JOIN variant_kind vk ON vk.code = cv.variant_kind_code
         JOIN card c          ON c.id = cv.card_id
         JOIN card_set cs     ON cs.id = c.set_id
    LEFT JOIN collection_item ci ON ci.card_variant_id = cv.id AND ci.user_id = $2
        WHERE li.list_id = $1 AND li.card_variant_id IS NOT NULL
        ORDER BY li.position`,
      [listId, userId, ownedOnly],
    );

    userCache(res);
    res.json(
      cartPayload({ source: 'list', list: { id: list.id, name: list.name, kind: list.kind }, missingOnly: ownedOnly }, rows),
    );
  }),
);

// ── POST /massentry — an explicit set of cards ───────────────────────────────

interface AdhocItem {
  variantId?: unknown;
  cardVariantId?: unknown;
  cardId?: unknown;
  quantity?: unknown;
}

cartRouter.post(
  '/massentry',
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as { items?: unknown };
    if (!Array.isArray(body.items) || body.items.length === 0) {
      throw badRequest('items must be a non-empty array of { variantId | cardId, quantity? }');
    }
    if (body.items.length > MAX_ADHOC_ITEMS) {
      throw badRequest(`items must be ${MAX_ADHOC_ITEMS} or fewer (got ${body.items.length})`);
    }

    const variantIds: number[] = [];
    const cardIds: string[] = [];
    const wanted: Array<{ variantId?: number; cardId?: string; quantity: number }> = [];
    for (const [i, raw] of (body.items as AdhocItem[]).entries()) {
      if (raw === null || typeof raw !== 'object') throw badRequest(`items[${i}] must be an object`);
      const qtyRaw = raw.quantity ?? 1;
      const quantity = typeof qtyRaw === 'number' ? qtyRaw : Number(qtyRaw);
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
        throw badRequest(`items[${i}].quantity must be an integer 1–100`);
      }
      const vRaw = raw.variantId ?? raw.cardVariantId;
      if (vRaw !== undefined && vRaw !== null) {
        const variantId = typeof vRaw === 'number' ? vRaw : Number(vRaw);
        if (!Number.isInteger(variantId) || variantId <= 0) throw badRequest(`items[${i}].variantId must be a positive integer`);
        variantIds.push(variantId);
        wanted.push({ variantId, quantity });
        continue;
      }
      if (typeof raw.cardId === 'string' && raw.cardId.trim()) {
        const cardId = raw.cardId.trim();
        cardIds.push(cardId);
        wanted.push({ cardId, quantity });
        continue;
      }
      throw badRequest(`items[${i}] needs variantId or cardId`);
    }

    // Two lookups, whatever the item count — never one per item.
    const byVariant = new Map<number, CartRow>();
    if (variantIds.length > 0) {
      const rows = await q<CartRow & { variant_id: string }>(
        `SELECT cv.id AS variant_id, c.name, c.local_id, cs.tcgdex_id AS set_tcgdex_id, c.rarity,
                COALESCE(cv.display_name, vk.display_name) AS variant_name,
                cv.tcgplayer_product_id AS product_id, cv.tcgplayer_mass_entry AS token
           FROM card_variant cv
           JOIN variant_kind vk ON vk.code = cv.variant_kind_code
           JOIN card c          ON c.id = cv.card_id
           JOIN card_set cs     ON cs.id = c.set_id
          WHERE cv.id = ANY($1::bigint[])`,
        [variantIds],
      );
      for (const r of rows) byVariant.set(Number(r.variant_id), r);
    }
    // A card id resolves to its cheapest linkable printing, same rule the
    // set route's `complete` goal uses, so "buy this card" means "buy the
    // cheapest printing of it that TCGplayer actually sells".
    const byCard = new Map<string, CartRow>();
    if (cardIds.length > 0) {
      const rows = await q<CartRow & { tcgdex_id: string }>(
        `SELECT DISTINCT ON (c.tcgdex_id)
                c.tcgdex_id, c.name, c.local_id, cs.tcgdex_id AS set_tcgdex_id, c.rarity,
                COALESCE(cv.display_name, vk.display_name) AS variant_name,
                cv.tcgplayer_product_id AS product_id, cv.tcgplayer_mass_entry AS token
           FROM card c
           JOIN card_variant cv ON cv.card_id = c.id
           JOIN variant_kind vk ON vk.code = cv.variant_kind_code
           JOIN card_set cs     ON cs.id = c.set_id
      LEFT JOIN price_current pc
                ON pc.card_variant_id = cv.id AND pc.currency_code = 'USD' AND pc.market_minor IS NOT NULL
          WHERE c.tcgdex_id = ANY($1::text[]) AND c.lang = 'en'
          ORDER BY c.tcgdex_id,
                   (cv.tcgplayer_product_id IS NULL),
                   pc.market_minor ASC NULLS LAST,
                   cv.sort_order`,
        [cardIds],
      );
      for (const r of rows) byCard.set(r.tcgdex_id, r);
    }

    const rows: CartRow[] = [];
    const unresolved: string[] = [];
    for (const w of wanted) {
      const hit = w.variantId !== undefined ? byVariant.get(w.variantId) : byCard.get(w.cardId!);
      if (!hit) {
        unresolved.push(w.variantId !== undefined ? `variant ${w.variantId}` : `card '${w.cardId!}'`);
        continue;
      }
      rows.push({ ...hit, quantity: w.quantity });
    }

    const payload = cartPayload({ source: 'items', requested: wanted.length }, rows);
    if (unresolved.length > 0) {
      (payload.warnings as string[]).push(
        `${unresolved.length} item(s) do not exist in the catalog and were skipped: ${unresolved.slice(0, 10).join(', ')}` +
          (unresolved.length > 10 ? ', …' : ''),
      );
      payload.unresolved = unresolved;
    }
    userCache(res);
    res.json(payload);
  }),
);
