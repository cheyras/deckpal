import { Router } from 'express';
import { cardImages, defaultUserId, q, q1, toMajor } from '../db.js';
import { asyncHandler, clampInt, notFound, oneOf, str, strList, userCache } from '../http.js';
import { raritySortSql } from '../rarity.js';

export const setsRouter: Router = Router();

const SORT_COLUMNS = {
  number: 'c.number_sort',
  name: 'c.name',
  price: 'price_minor',
  rarity: raritySortSql('c.rarity'),
  artist: 'c.illustrator',
} as const;
type SortKey = keyof typeof SORT_COLUMNS;
const GOALS = ['complete', 'master', 'grandmaster'] as const;
type Goal = (typeof GOALS)[number];
const OWN = ['all', 'have', 'need', 'dupes'] as const;
type Own = (typeof OWN)[number];

interface SetRow {
  id: string;
  tcgdex_id: string;
  slug: string;
  name: string;
  released_on: string | null;
  card_count_official: number | null;
  card_count_total: number | null;
  is_promo: boolean;
  logo_url: string | null;
  symbol_url: string | null;
  background_url: string | null;
  series_slug: string;
  series_name: string;
  series_tcgdex_id: string;
}

interface ProgressRow {
  goal: Goal;
  owned_required: number;
  total_required: number;
  total_quantity: number;
  set_level: number | null;
}

interface CardListRow {
  id: string;
  tcgdex_id: string;
  local_id: string;
  number_sort: string;
  name: string;
  category: string;
  rarity: string | null;
  illustrator: string | null;
  serie: string;
  setcode: string;
  variant_count: string;
  price_minor: number | null;
  price_currency: string | null;
  sum_qty: string | null;
  req_count: string;
  owned_req: string;
  dupe_req: string;
  total_rows: string;
}

function pct(owned: number, total: number): number {
  if (!owned || !total) return 0;
  return Math.round((owned / total) * 1000) / 10;
}

/** Builds the SQL boolean for the active ownership tab, given the goal. */
function ownPredicate(goal: Goal): { have: string; need: string; dupe: string } {
  if (goal === 'complete') {
    return {
      have: 'COALESCE(a.sum_qty,0) >= 1',
      need: 'COALESCE(a.sum_qty,0) = 0',
      dupe: 'COALESCE(a.sum_qty,0) >= 2',
    };
  }
  // master / grandmaster: (card,variant) pair fractions
  return {
    have: 'a.req_count > 0 AND a.owned_req = a.req_count',
    need: 'a.req_count > 0 AND a.owned_req < a.req_count',
    dupe: 'a.dupe_req >= 1',
  };
}

/**
 * GET /pokedex/api/sets/:setId — set detail.
 * :setId is the set's tcgdex_id (e.g. 'sv03.5', 'base1').
 * Query: own=all|have|need|dupes, sort=number|name|price|rarity|artist,
 *        dir=asc|desc, variant=<kind code> (repeatable), goal=complete|master|
 *        grandmaster, q=<text>, page, pageSize. Every filter/sort lives in the
 *        URL by design (ROUTE-MAP §3).
 */
setsRouter.get(
  '/:setId',
  asyncHandler(async (req, res) => {
    const setTcgdexId = req.params.setId;
    const set = await q1<SetRow>(
      `SELECT cs.id, cs.tcgdex_id, cs.slug, cs.name, cs.released_on,
              cs.card_count_official, cs.card_count_total, cs.is_promo,
              cs.logo_url, cs.symbol_url, cs.background_url,
              ser.slug AS series_slug, ser.name AS series_name, ser.tcgdex_id AS series_tcgdex_id
         FROM card_set cs
         JOIN series ser ON ser.id = cs.series_id
        WHERE cs.tcgdex_id = $1`,
      [setTcgdexId],
    );
    if (!set) throw notFound(`No set '${setTcgdexId}'`);
    const userId = await defaultUserId();

    const goal = oneOf<Goal>(req.query.goal, GOALS, 'complete');
    const own = oneOf<Own>(req.query.own, OWN, 'all');
    const sort = oneOf<SortKey>(req.query.sort, Object.keys(SORT_COLUMNS) as SortKey[], 'number');
    const dir = oneOf(req.query.dir, ['asc', 'desc'] as const, 'asc');
    const variantCodes = strList(req.query.variant);
    const search = str(req.query.q);
    const pageSize = clampInt(req.query.pageSize, 60, 1, 250);
    const page = clampInt(req.query.page, 1, 1, 100000);
    const offset = (page - 1) * pageSize;

    // Progress: the three goals, straight from user_set_progress (authoritative;
    // Master/Grandmaster are pair fractions — do NOT recompute a card fraction).
    const progressRows = await q<ProgressRow>(
      `SELECT goal, owned_required, total_required, total_quantity, set_level
         FROM user_set_progress WHERE user_id = $1 AND set_id = $2`,
      [userId, set.id],
    );
    const byGoal = new Map(progressRows.map((p) => [p.goal, p]));
    const goalOut = (g: Goal) => {
      const p = byGoal.get(g);
      return {
        owned: p?.owned_required ?? 0,
        total: p?.total_required ?? 0,
        pct: pct(p?.owned_required ?? 0, p?.total_required ?? 0),
        totalQuantity: p?.total_quantity ?? 0,
        ...(g === 'complete' ? { setLevel: p?.set_level ?? 0 } : {}),
      };
    };

    // Header aggregates: set market value + most expensive card (primary variant,
    // TCGplayer/tcgcsv USD market). NULL prices simply don't contribute.
    const agg = await q1<{ sum_minor: string | null; max_minor: number | null; max_card: string | null; max_name: string | null; max_number: string | null }>(
      `SELECT sum(pc.market_minor)::bigint AS sum_minor,
              max(pc.market_minor) AS max_minor,
              (array_agg(c.tcgdex_id ORDER BY pc.market_minor DESC))[1] AS max_card,
              (array_agg(c.name      ORDER BY pc.market_minor DESC))[1] AS max_name,
              (array_agg(c.local_id  ORDER BY pc.market_minor DESC))[1] AS max_number
         FROM card c
         JOIN card_variant cv ON cv.card_id = c.id AND cv.is_primary
         JOIN price_current pc ON pc.card_variant_id = cv.id
          AND pc.source_code = 'tcgcsv' AND pc.currency_code = 'USD' AND pc.market_minor IS NOT NULL
        WHERE c.set_id = $1`,
      [set.id],
    );

    // Card list. All request values are bound params; sort/dir/goal come from
    // closed allow-lists mapped above, never interpolated from raw input.
    const pred = ownPredicate(goal);
    const ownFilterSql =
      own === 'have' ? `AND (${pred.have})` : own === 'need' ? `AND (${pred.need})` : own === 'dupes' ? `AND (${pred.dupe})` : '';
    const orderSql = `ORDER BY ${SORT_COLUMNS[sort]} ${dir === 'desc' ? 'DESC' : 'ASC'} NULLS LAST, c.number_sort ASC`;

    // Params are appended in order and referenced by their live index — no value
    // from the request is ever concatenated into SQL.
    const params: unknown[] = [
      set.id, // $1
      userId, // $2
      variantCodes.length ? variantCodes : null, // $3
      goal, // $4 (drives the counted CASE)
    ];
    let searchSql = '';
    if (search) {
      params.push(`%${search}%`);
      // Accent-insensitive name match: unaccent() folds diacritics on both sides
      // so "Poke" matches "Pokémon" (é ↔ e). local_id/number_sort are ASCII.
      searchSql = `AND (unaccent(c.name) ILIKE unaccent($${params.length}) OR c.local_id ILIKE $${params.length} OR c.number_sort ILIKE $${params.length})`;
    }
    params.push(pageSize);
    const limitIdx = params.length;
    params.push(offset);
    const offsetIdx = params.length;

    const rows = await q<CardListRow>(
      `WITH counted AS (
         SELECT c.id AS card_id, cv.id AS variant_id,
                COALESCE(ci.quantity,0) AS qty,
                CASE WHEN $4 = 'master' THEN (mrv.card_variant_id IS NOT NULL) ELSE true END AS counts
           FROM card c
           JOIN card_variant cv ON cv.card_id = c.id
      LEFT JOIN master_required_variant mrv ON mrv.card_variant_id = cv.id
      LEFT JOIN collection_item ci ON ci.card_variant_id = cv.id AND ci.user_id = $2
          WHERE c.set_id = $1
            AND ($3::text[] IS NULL OR cv.variant_kind_code = ANY($3))
       ),
       a AS (
         SELECT card_id,
                SUM(qty) FILTER (WHERE counts)               AS sum_qty,
                COUNT(*) FILTER (WHERE counts)               AS req_count,
                COUNT(*) FILTER (WHERE counts AND qty >= 1)  AS owned_req,
                COUNT(*) FILTER (WHERE counts AND qty >= 2)  AS dupe_req
           FROM counted GROUP BY card_id
       )
       SELECT c.id, c.tcgdex_id, c.local_id, c.number_sort, c.name, c.category,
              c.rarity, c.illustrator,
              ser.tcgdex_id AS serie, cs.tcgdex_id AS setcode,
              vc.variant_count,
              price.market_minor AS price_minor, price.currency_code AS price_currency,
              a.sum_qty, a.req_count, a.owned_req, a.dupe_req,
              count(*) OVER() AS total_rows
         FROM a
         JOIN card c   ON c.id = a.card_id
         JOIN card_set cs ON cs.id = c.set_id
         JOIN series ser ON ser.id = cs.series_id
    LEFT JOIN LATERAL (SELECT count(*) AS variant_count FROM card_variant cv2 WHERE cv2.card_id = c.id) vc ON true
    LEFT JOIN LATERAL (
                SELECT pc.market_minor, pc.currency_code
                  FROM card_variant cvp
                  JOIN price_current pc ON pc.card_variant_id = cvp.id
                   AND pc.source_code = 'tcgcsv' AND pc.currency_code = 'USD'
                 WHERE cvp.card_id = c.id AND cvp.is_primary
                 LIMIT 1
              ) price ON true
        WHERE true ${ownFilterSql} ${searchSql}
        ${orderSql}
        LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params,
    );

    const total = set.card_count_total ?? 0;
    const official = set.card_count_official ?? total;
    const totalRows = rows.length ? Number(rows[0]!.total_rows) : 0;

    userCache(res);
    res.json({
      set: {
        setId: set.tcgdex_id,
        slug: set.slug,
        name: set.name,
        series: { slug: set.series_slug, name: set.series_name, tcgdexId: set.series_tcgdex_id },
        releasedOn: set.released_on,
        isPromo: set.is_promo,
        printedCount: official,
        secretCount: Math.max(0, total - official),
        cardCountTotal: total,
        images: { logoUrl: set.logo_url, symbolUrl: set.symbol_url, backgroundUrl: set.background_url },
        marketValueUsd: toMajor(agg?.sum_minor ? Number(agg.sum_minor) : null, 'USD'),
        mostExpensiveCard: agg?.max_card
          ? { cardId: agg.max_card, name: agg.max_name, number: agg.max_number, marketUsd: toMajor(agg.max_minor, 'USD') }
          : null,
      },
      progress: { complete: goalOut('complete'), master: goalOut('master'), grandmaster: goalOut('grandmaster') },
      query: { goal, own, sort, dir, variant: variantCodes, q: search ?? null, page, pageSize },
      pagination: { page, pageSize, total: totalRows, pageCount: Math.ceil(totalRows / pageSize) },
      cards: rows.map((r) => {
        const sumQty = Number(r.sum_qty ?? 0);
        const reqCount = Number(r.req_count);
        const ownedReq = Number(r.owned_req);
        const dupeReq = Number(r.dupe_req);
        const have = goal === 'complete' ? sumQty >= 1 : reqCount > 0 && ownedReq === reqCount;
        return {
          cardId: r.tcgdex_id,
          number: r.local_id,
          numberSort: r.number_sort,
          name: r.name,
          category: r.category,
          rarity: r.rarity,
          artist: r.illustrator,
          variantCount: Number(r.variant_count),
          images: cardImages(r.serie, r.setcode, r.local_id),
          price: r.price_minor !== null ? { market: toMajor(r.price_minor, r.price_currency ?? 'USD'), currency: (r.price_currency ?? 'USD').trim() } : null,
          ownership: {
            totalQuantity: sumQty,
            requiredCount: reqCount,
            ownedRequired: ownedReq,
            have,
            need: !have && (goal === 'complete' ? sumQty === 0 : reqCount > 0),
            dupe: goal === 'complete' ? sumQty >= 2 : dupeReq >= 1,
          },
        };
      }),
    });
  }),
);
