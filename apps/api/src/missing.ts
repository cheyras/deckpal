import { q } from './db.js';
import { badRequest } from './http.js';
import { RARITY_RANK } from './rarity.js';

/**
 * "What am I still missing from this set?" — one query, one definition, three
 * callers (the cart routes, the bulk list-add, and the MCP's set_progress).
 *
 * This used to be copy-pasted per route, which is how the cart and the list
 * could disagree about what "missing" meant. It is also the single most common
 * thing an agent is asked to compute, so it is worth having exactly one of.
 *
 * Goal semantics mirror `recomputeSetProgress` exactly, so the counts here
 * always reconcile with `user_set_progress`:
 *
 *   complete     one row per card with NO owned variant. Any printing finishes
 *                the card, so the row carries the CHEAPEST printing that
 *                TCGplayer actually sells — which is also the price
 *                `set_progress` quotes as the cost to finish.
 *   master       every standard-tier variant (`master_required_variant`) not owned.
 *   grandmaster  every variant not owned.
 *
 * ## Rarity, and why it is here
 *
 * `card_variant.tier` is 'standard' or 'special' and does NOT line up with the
 * game's printed rarities: an Illustration Rare and a Special Illustration Rare
 * are both `standard`. An agent asked for "everything missing except the
 * Special Illustration Rares" therefore could not express that as a filter and
 * had to read `rarity` off ~87 individual `get_card` calls. So rarity is a
 * first-class filter here, and it is matched case-insensitively because the
 * catalog's casing ("Special illustration rare") is not TCGplayer's
 * ("Special Illustration Rare") and neither is what a human types.
 */

export const GOALS = ['complete', 'master', 'grandmaster'] as const;
export type Goal = (typeof GOALS)[number];

export const FINISHES = ['normal', 'reverse', 'holo', 'lenticular', 'metal'] as const;

export interface MissingFilters {
  finishes?: string[] | null;
  /** Exact rarity names, case-insensitive. */
  rarity?: string[] | null;
  rarityExclude?: string[] | null;
  /** Only items whose cheapest USD market price is at or below this (dollars). Unpriced items are excluded. */
  maxPriceUsd?: number | null;
  /** Drop items with no USD price at all. */
  pricedOnly?: boolean;
}

export interface MissingRow {
  card_variant_id: string;
  card_id: string;
  card_tcgdex_id: string;
  name: string;
  local_id: string;
  set_tcgdex_id: string;
  /** The series' tcgdex id — with set_tcgdex_id + local_id this is the full
   *  cardImages() address, so a caller can render the row without a re-join
   *  (added for smart-list covers/items; harmless to the other callers). */
  serie_tcgdex_id: string;
  rarity: string | null;
  variant_kind_code: string | null;
  variant_name: string | null;
  tier: string | null;
  product_id: number | null;
  token: string | null;
  cheap_minor: number | null;
}

/** Case-insensitive rarity list, or null when the filter is absent. */
function lower(list: readonly string[] | null | undefined): string[] | null {
  if (!list || list.length === 0) return null;
  return list.map((s) => s.trim().toLowerCase()).filter(Boolean);
}

/**
 * Reject a rarity nobody has, loudly, instead of silently returning nothing.
 * The known vocabulary is the sort ladder's keys plus whatever the catalog
 * actually holds — the ladder is the documented list, so it is what we check
 * against, and an unknown value gets the ladder back as the suggestion.
 */
export function assertKnownRarities(names: readonly string[]): void {
  const known = new Set(Object.keys(RARITY_RANK).map((k) => k.toLowerCase()));
  const bad = names.filter((n) => !known.has(n.trim().toLowerCase()));
  if (bad.length > 0) {
    throw badRequest(
      `unknown rarity '${bad[0]}'. Known rarities: ${Object.keys(RARITY_RANK).join(', ')}. ` +
        'Rarity names come from the catalog and are matched case-insensitively.',
    );
  }
}

export async function missingForGoal(
  userId: string,
  setId: string | number,
  goal: Goal,
  filters: MissingFilters = {},
): Promise<MissingRow[]> {
  const rarity = lower(filters.rarity);
  const rarityExclude = lower(filters.rarityExclude);
  const finishes = filters.finishes && filters.finishes.length ? filters.finishes : null;
  const maxMinor = filters.maxPriceUsd == null ? null : Math.round(filters.maxPriceUsd * 100);
  const pricedOnly = filters.pricedOnly === true || maxMinor !== null;

  // The price used everywhere: cheapest USD market quote for the variant.
  const cheapest = `
    LEFT JOIN LATERAL (
      SELECT min(pc.market_minor) AS cheap_minor
        FROM price_current pc
       WHERE pc.card_variant_id = cv.id AND pc.currency_code = 'USD' AND pc.market_minor IS NOT NULL
    ) price ON true`;

  const priceFilter = `
      AND ($6::boolean IS NOT TRUE OR price.cheap_minor IS NOT NULL)
      AND ($7::int IS NULL OR price.cheap_minor <= $7)`;

  if (goal === 'complete') {
    // DISTINCT ON picks one printing per card: linkable first, then cheapest.
    return q<MissingRow>(
      `WITH missing AS (
         SELECT c.id, c.tcgdex_id, c.name, c.local_id, c.number_sort, c.rarity
           FROM card c
          WHERE c.set_id = $1
            AND NOT EXISTS (
              SELECT 1 FROM collection_item ci
                JOIN card_variant cv2 ON cv2.id = ci.card_variant_id
               WHERE cv2.card_id = c.id AND ci.user_id = $2 AND ci.quantity > 0)
            AND ($3::text[] IS NULL OR lower(c.rarity) = ANY($3))
            AND ($4::text[] IS NULL OR c.rarity IS NULL OR NOT (lower(c.rarity) = ANY($4)))
       ),
       picked AS (
         SELECT DISTINCT ON (cv.card_id)
                cv.id AS card_variant_id, cv.card_id, cv.variant_kind_code,
                COALESCE(cv.display_name, vk.display_name) AS variant_name,
                vtr.tier, cv.tcgplayer_product_id AS product_id, cv.tcgplayer_mass_entry AS token,
                price.cheap_minor
           FROM card_variant cv
           JOIN variant_kind vk ON vk.code = cv.variant_kind_code
           JOIN variant_tier_resolved vtr ON vtr.card_variant_id = cv.id
           ${cheapest}
          WHERE cv.card_id IN (SELECT id FROM missing)
            AND ($5::text[] IS NULL OR vk.finish = ANY($5))
            ${priceFilter}
          ORDER BY cv.card_id, (cv.tcgplayer_product_id IS NULL), price.cheap_minor ASC NULLS LAST, cv.sort_order
       )
       SELECT p.card_variant_id, m.id AS card_id, m.tcgdex_id AS card_tcgdex_id, m.name, m.local_id,
              cs.tcgdex_id AS set_tcgdex_id, ser.tcgdex_id AS serie_tcgdex_id,
              m.rarity, p.variant_kind_code, p.variant_name, p.tier,
              p.product_id, p.token, p.cheap_minor
         FROM missing m
         JOIN picked p ON p.card_id = m.id
         JOIN card_set cs ON cs.id = $1
         JOIN series ser ON ser.id = cs.series_id
        ORDER BY m.number_sort`,
      [setId, userId, rarity, rarityExclude, finishes, pricedOnly, maxMinor],
    );
  }

  const reqSql =
    goal === 'master'
      ? `SELECT mrv.card_variant_id FROM master_required_variant mrv
           JOIN card c ON c.id = mrv.card_id WHERE c.set_id = $1`
      : `SELECT cv.id AS card_variant_id FROM card_variant cv
           JOIN card c ON c.id = cv.card_id WHERE c.set_id = $1`;

  return q<MissingRow>(
    `WITH req AS (${reqSql}),
     missing AS (
       SELECT req.card_variant_id FROM req
        WHERE NOT EXISTS (
          SELECT 1 FROM collection_item ci
           WHERE ci.card_variant_id = req.card_variant_id AND ci.user_id = $2 AND ci.quantity > 0))
     SELECT cv.id AS card_variant_id, c.id AS card_id, c.tcgdex_id AS card_tcgdex_id, c.name, c.local_id,
            cs.tcgdex_id AS set_tcgdex_id, ser.tcgdex_id AS serie_tcgdex_id, c.rarity, cv.variant_kind_code,
            COALESCE(cv.display_name, vk.display_name) AS variant_name, vtr.tier,
            cv.tcgplayer_product_id AS product_id, cv.tcgplayer_mass_entry AS token,
            price.cheap_minor
       FROM missing m
       JOIN card_variant cv ON cv.id = m.card_variant_id
       JOIN variant_kind vk ON vk.code = cv.variant_kind_code
       JOIN variant_tier_resolved vtr ON vtr.card_variant_id = cv.id
       JOIN card c      ON c.id = cv.card_id
       JOIN card_set cs ON cs.id = c.set_id
       JOIN series ser  ON ser.id = cs.series_id
       ${cheapest}
      WHERE ($5::text[] IS NULL OR vk.finish = ANY($5))
        AND ($3::text[] IS NULL OR lower(c.rarity) = ANY($3))
        AND ($4::text[] IS NULL OR c.rarity IS NULL OR NOT (lower(c.rarity) = ANY($4)))
        ${priceFilter}
      ORDER BY c.number_sort, cv.sort_order`,
    [setId, userId, rarity, rarityExclude, finishes, pricedOnly, maxMinor],
  );
}
