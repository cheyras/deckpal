import { z } from 'zod';
import { q, q1 } from '../db.js';
import { defineTool, type ToolDefinition } from '../registry.js';
import { fail, ok } from '../result.js';
import { money, pagingFooter, row } from '../format.js';
import { describeCard, resolveCard } from '../resolve.js';
import { defaultGoal, errText, type Goal } from './collection.js';

/**
 * Catalog tools — SPEC §5 #3 search_cards, #4 get_card, #5 set_progress.
 * Direct SQL over card/card_set (lang='en'), name matching via
 * unaccent(...) ILIKE unaccent('%q%') — the same operator the REST API uses
 * (apps/api/src/routes/search.ts). "Best" price = MAX(market_minor) USD across
 * sources; "cheapest" (cost-to-complete) = MIN. NULL price = unpriced, never $0.
 */

const pageArg = z.number().int().min(1).default(1).describe('Page number, 1-based.');
const pageSizeArg = z
  .number()
  .int()
  .min(1)
  .max(200)
  .default(50)
  .describe('Rows per page (default 50, hard cap 200).');

const GOALS = ['complete', 'master', 'grandmaster'] as const;

// ── search_cards — SPEC §5 #3 ──────────────────────────────────────────────
interface SearchRow {
  name: string;
  tcgdex_id: string;
  rarity: string | null;
  owned_qty: number | null;
  best_minor: number | null;
  // The set's series slug — see SERIES_SLUG_NOTE below.
  series_slug: string;
}

/**
 * Why every set/card row now carries a series slug.
 *
 * DeckPal's web routes are `/series/<seriesSlug>/<setId>` for a set and
 * `/series/<seriesSlug>/<setId>/<number>` for a card. Until now NO tool
 * returned a series slug, and slugs are not derivable from the names anyone has
 * — 'Scarlet & Violet' is `scarlet-violet` but "McDonald's Collection" is
 * `mcdonald-s-collection`. So an agent handed a perfectly good search result had
 * no way to turn it into a link without a second lookup per card, which is the
 * same N+1 shape that made `log_cards` and `add_cards` slow enough to be
 * incidents.
 *
 * The slug is appended, never substituted: no existing cell moved or changed.
 * The join it comes from is `card_set.series_id`, which is `NOT NULL REFERENCES
 * series(id)` (migration 003), so adding it as an inner JOIN cannot change which
 * rows match or how many — including in the COUNT query that shares the same
 * FROM/WHERE fragment.
 */

const searchCardsTool = defineTool({
  name: 'search_cards',
  title: 'Search the card catalog',
  description:
    'Search cards across the whole catalog by name (accent-insensitive substring) with ' +
    'optional filters: set, category, rarity, Standard legality, owned-only, and minimum ' +
    'USD market value. Each row shows owned quantity and best USD market price. When multiple ' +
    'printings of the same card name appear (e.g. a regular and a Special Illustration Rare), ' +
    'they sort cheapest first within that name group. When building or pricing a deck, prefer ' +
    'the cheapest printing of a named card unless the user specifically asked for a particular ' +
    'rarity, parallel, or set. Use this to find cards or list slices of the collection; for ' +
    'full detail on ONE card (variants, tiers, per-source prices) use get_card instead, and ' +
    'for set completion use set_progress.',
  inputSchema: z.object({
    query: z.string().optional().describe("Card-name substring, accent/case-insensitive, e.g. 'charizard'."),
    set_id: z.string().optional().describe("Limit to one set by TCGdex set id, e.g. 'me05' or 'sv3pt5'."),
    category: z.enum(['Pokemon', 'Trainer', 'Energy']).optional().describe('Limit to one card category.'),
    rarity: z.string().optional().describe("Exact rarity name, case-insensitive, e.g. 'Double Rare'."),
    owned_only: z.boolean().default(false).describe('true → only cards you own at least one copy of (any variant).'),
    standard_legal: z.boolean().optional().describe('Filter on Standard-format legality (card.legal_standard).'),
    min_value_usd: z
      .number()
      .min(0)
      .optional()
      .describe('Only cards whose best USD market price is at least this many dollars (unpriced cards excluded).'),
    page: pageArg,
    page_size: pageSizeArg,
  }),
  annotations: { readOnlyHint: true, idempotentHint: true },
  handler: async (args, ctx) => {
    try {
      const conds: string[] = [`c.lang = 'en'`];
      const params: unknown[] = [ctx.userId]; // $1 feeds the owned CTE
      const p = (v: unknown): string => {
        params.push(v);
        return `$${params.length}`;
      };

      const query = args.query?.trim();
      if (query) conds.push(`unaccent(c.name) ILIKE unaccent(${p(`%${query}%`)})`);
      if (args.set_id) conds.push(`cs.tcgdex_id = ${p(args.set_id.trim())}`);
      if (args.category) conds.push(`c.category = ${p(args.category)}`);
      if (args.rarity) conds.push(`lower(c.rarity) = lower(${p(args.rarity.trim())})`);
      if (args.standard_legal !== undefined) conds.push(`c.legal_standard = ${p(args.standard_legal)}`);
      if (args.owned_only) conds.push(`COALESCE(o.qty, 0) > 0`);
      if (args.min_value_usd !== undefined) conds.push(`b.best_minor >= ${p(Math.round(args.min_value_usd * 100))}`);

      const fromWhere = `
        FROM card c
        JOIN card_set cs ON cs.id = c.set_id
        JOIN series se    ON se.id = cs.series_id
        LEFT JOIN owned o ON o.card_id = c.id
        LEFT JOIN best b  ON b.card_id = c.id
       WHERE ${conds.join(' AND ')}`;
      const ctes = `
        WITH owned AS (
          SELECT cv.card_id, sum(ci.quantity)::int AS qty
            FROM collection_item ci
            JOIN card_variant cv ON cv.id = ci.card_variant_id
           WHERE ci.user_id = $1 AND ci.quantity > 0
           GROUP BY cv.card_id),
        best AS (
          SELECT cv.card_id, max(pc.market_minor)::int AS best_minor
            FROM price_current pc
            JOIN card_variant cv ON cv.id = pc.card_variant_id
           WHERE pc.currency_code = 'USD' AND pc.market_minor IS NOT NULL
           GROUP BY cv.card_id)`;

      // Count first, with exactly the filter params bound so far.
      const totalRow = await q1<{ total: string }>(ctx.db, `${ctes} SELECT count(*) AS total ${fromWhere}`, params);
      const total = Number(totalRow?.total ?? 0);

      // Page query appends its own params (exact-match ranking, limit, offset).
      // Same-name rows (multiple printings of the same card) sort cheapest first
      // so an agent picking a card for a deck naturally lands on the cheap one;
      // genuinely different names keep the existing relevance/recency order (issue #31).
      const orderBy = query
        ? `ORDER BY (lower(unaccent(c.name)) = lower(unaccent(${p(query)}))) DESC, length(c.name), lower(c.name), b.best_minor ASC NULLS LAST, cs.tcgdex_id, c.number_sort`
        : `ORDER BY c.released_on DESC NULLS LAST, lower(c.name), b.best_minor ASC NULLS LAST, cs.tcgdex_id, c.number_sort`;
      const rows = await q<SearchRow>(
        ctx.db,
        `${ctes}
         SELECT c.name, c.tcgdex_id, c.rarity, o.qty AS owned_qty, b.best_minor, se.slug AS series_slug
         ${fromWhere}
         ${orderBy}
         LIMIT ${p(args.page_size)} OFFSET ${p((args.page - 1) * args.page_size)}`,
        params,
      );

      if (total === 0) return ok('No cards match. Loosen the query or drop a filter.');
      const lines = rows.map((r) =>
        row(
          r.name,
          r.tcgdex_id,
          r.rarity,
          r.owned_qty !== null && Number(r.owned_qty) > 0 ? `owned x${r.owned_qty}` : null,
          money(r.best_minor),
          `series ${r.series_slug}`,
        ),
      );
      if (lines.length === 0) lines.push('(page past the end)');
      return ok([...lines, pagingFooter(args.page, args.page_size, total)].join('\n'), {
        total,
        page: args.page,
        pageSize: args.page_size,
      });
    } catch (err) {
      return fail(`search_cards failed: ${errText(err)}`);
    }
  },
});

// ── get_card — SPEC §5 #4 ──────────────────────────────────────────────────
interface CardCoreRow {
  category: string;
  rarity: string | null;
  hp: number | null;
  regulation_mark: string | null;
  legal_standard: boolean;
  legal_expanded: boolean;
  released_on: string | null;
  illustrator: string | null;
}
interface VariantRow {
  id: string;
  variant_kind_code: string;
  display_name: string | null;
  is_primary: boolean;
  tcgplayer_url: string | null;
  tier: string;
  owned_qty: number;
}
interface PriceRow {
  card_variant_id: string;
  source_code: string;
  currency_code: string;
  market_minor: number | null;
}

const getCardTool = defineTool({
  name: 'get_card',
  title: 'Card detail (variants, tiers, prices)',
  description:
    'Full detail for ONE card: identity, rarity, HP, regulation mark, legality, set and ' +
    'collector number, then every printing variant with its kind, completion tier, owned ' +
    'quantity, per-source market prices, and TCGplayer link. Identify the card by TCGdex ' +
    "card_id (e.g. 'me05-084') or by name plus optional set_id/number — an ambiguous name " +
    'returns the candidate list rather than guessing. For browsing many cards use ' +
    'search_cards instead.',
  inputSchema: z.object({
    card_id: z.string().optional().describe("TCGdex card id, e.g. 'me05-084'. Wins over name if both given."),
    name: z.string().optional().describe('Card name (exact or substring, accent-insensitive).'),
    set_id: z.string().optional().describe("Narrow a name lookup to one set, e.g. 'me05'."),
    number: z.string().optional().describe("Narrow a name lookup to a collector number, e.g. '084'."),
  }),
  annotations: { readOnlyHint: true, idempotentHint: true },
  handler: async (args, ctx) => {
    try {
      const res = await resolveCard(ctx, args);
      if (res.status === 'not_found') return fail(res.message);
      if (res.status === 'ambiguous') {
        return ok(
          [
            `Ambiguous — ${res.total >= 9 ? '9+' : res.total} cards match. Candidates:`,
            ...res.candidates.map(describeCard),
            'Repeat with the exact card_id, or add set_id/number to the name.',
          ].join('\n'),
        );
      }
      const card = res.card;

      const core = await q1<CardCoreRow>(
        ctx.db,
        `SELECT category, rarity, hp, regulation_mark, legal_standard, legal_expanded,
                released_on::text AS released_on, illustrator
           FROM card WHERE id = $1`,
        [card.id],
      );
      const variants = await q<VariantRow>(
        ctx.db,
        `SELECT cv.id, cv.variant_kind_code, cv.display_name, cv.is_primary, cv.tcgplayer_url,
                vtr.tier, COALESCE(ci.quantity, 0) AS owned_qty
           FROM card_variant cv
           JOIN variant_tier_resolved vtr ON vtr.card_variant_id = cv.id
           LEFT JOIN collection_item ci ON ci.card_variant_id = cv.id AND ci.user_id = $2
          WHERE cv.card_id = $1
          ORDER BY cv.sort_order`,
        [card.id, ctx.userId],
      );
      const prices = await q<PriceRow>(
        ctx.db,
        `SELECT pc.card_variant_id, pc.source_code, pc.currency_code, pc.market_minor
           FROM price_current pc
           JOIN card_variant cv ON cv.id = pc.card_variant_id
          WHERE cv.card_id = $1
          ORDER BY pc.source_code`,
        [card.id],
      );
      const priceByVariant = new Map<string, string[]>();
      for (const pr of prices) {
        if (pr.market_minor === null) continue;
        const arr = priceByVariant.get(pr.card_variant_id) ?? [];
        arr.push(`${pr.source_code} ${money(pr.market_minor, pr.currency_code.trim())}`);
        priceByVariant.set(pr.card_variant_id, arr);
      }

      // The trailing `series <slug>` cell completes the card's address: the
      // card route is /series/<seriesSlug>/<setId>/<number>, and nothing else
      // in this line supplies the slug (SERIES_SLUG_NOTE above).
      const lines: string[] = [
        `${card.name} | ${card.tcgdexId} | ${card.setName} #${card.localId} (${card.setTcgdexId}) | series ${card.seriesSlug}`,
      ];
      if (core) {
        lines.push(
          row(
            core.category,
            core.rarity,
            core.hp !== null ? `HP ${core.hp}` : null,
            core.regulation_mark ? `reg ${core.regulation_mark}` : null,
            `standard: ${core.legal_standard ? 'yes' : 'no'}`,
            `expanded: ${core.legal_expanded ? 'yes' : 'no'}`,
            core.released_on ? `released ${core.released_on}` : null,
            core.illustrator ? `illus. ${core.illustrator}` : null,
          ),
        );
      }
      lines.push(`variants (${variants.length}):`);
      for (const v of variants) {
        lines.push(
          '  ' +
            row(
              v.variant_kind_code,
              v.display_name !== null && v.display_name !== v.variant_kind_code ? v.display_name : null,
              `tier ${v.tier}`,
              `variant_id ${v.id}`,
              v.is_primary ? 'primary' : null,
              Number(v.owned_qty) > 0 ? `owned x${v.owned_qty}` : 'not owned',
              priceByVariant.get(v.id)?.join(' · ') ?? 'unpriced',
              v.tcgplayer_url,
            ),
        );
      }
      return ok(lines.join('\n'), { cardId: card.tcgdexId, variantCount: variants.length });
    } catch (err) {
      return fail(`get_card failed: ${errText(err)}`);
    }
  },
});

// ── set_progress — SPEC §5 #5 ──────────────────────────────────────────────
interface OverviewRow {
  set_tid: string;
  set_name: string;
  /** For the `/series/<seriesSlug>/<setId>` route — see SERIES_SLUG_NOTE above. */
  series_slug: string;
  c_owned: number | null;
  c_total: number | null;
  m_owned: number | null;
  m_total: number | null;
  g_owned: number | null;
  g_total: number | null;
}
interface GoalRow {
  goal: Goal;
  owned_required: number;
  total_required: number;
  total_quantity: number;
}
interface MissingRow {
  name: string;
  local_id: string;
  variant_kind_code: string | null;
  // Rarity is on every missing row now. It used to be absent, which meant an
  // agent asked for "everything missing except the Special Illustration
  // Rares" had to call get_card once per card to find out which was which —
  // ~87 calls to filter a list this tool had already computed. Variant `tier`
  // does not substitute: an Illustration Rare and a Special Illustration Rare
  // are both tier 'standard'.
  rarity: string | null;
  cheap_minor: number | null;
}
interface MissingAggRow {
  missing: string;
  cost_minor: string | null;
  priced: string;
  unpriced: string;
}

const pctTxt = (owned: number, total: number): string =>
  total > 0 ? `${((owned / total) * 100).toFixed(1)}%` : '—';

const setProgressTool = defineTool({
  name: 'set_progress',
  title: 'Set completion progress',
  description:
    'Completion progress toward the three goals (complete = one of any variant per card, ' +
    'master = every standard-tier variant, grandmaster = every variant). Without set_id: ' +
    'every set with any progress, sorted by completion of the requested goal. With set_id: ' +
    "that set's three goal lines plus the paged list of missing cards/variants for the " +
    'requested goal with the cheapest USD price each, and the total cost to finish (unpriced ' +
    'items counted separately, never $0). Goal defaults to your default goal setting. Not ' +
    'for whole-collection stats — use collection_summary.',
  inputSchema: z.object({
    set_id: z.string().optional().describe("TCGdex set id for per-set detail, e.g. 'me05'. Omit for the all-sets overview."),
    goal: z
      .enum(GOALS)
      .optional()
      .describe('Which goal to rank by / list missing cards for. Defaults to user_settings.default_goal.'),
    rarity: z
      .array(z.string())
      .optional()
      .describe(
        "With set_id: list ONLY these rarities, e.g. ['Illustration rare']. Exact names, case-insensitive; " +
          'the rarity of every missing row is shown in the output so you can see the vocabulary.',
      ),
    rarity_exclude: z
      .array(z.string())
      .optional()
      .describe(
        "With set_id: leave these rarities OUT, e.g. ['Special illustration rare']. Rarity is NOT variant tier — " +
          "an Illustration Rare and a Special Illustration Rare are both tier 'standard', so a tier filter cannot " +
          'express this.',
      ),
    page: pageArg,
    page_size: pageSizeArg,
  }),
  annotations: { readOnlyHint: true, idempotentHint: true },
  handler: async (args, ctx) => {
    try {
      const goal: Goal = args.goal ?? (await defaultGoal(ctx));
      const offset = (args.page - 1) * args.page_size;

      // Rarity filters. Bound as $5/$6 for every branch of the query below,
      // never interpolated; `rarityWhere` emits the predicate that reads
      // them. Matching is lower() on both sides because the catalog's casing
      // ("Special illustration rare") is neither TCGplayer's nor what a
      // person types.
      const rarityIn = args.rarity?.length ? args.rarity.map((s) => s.trim().toLowerCase()) : null;
      const rarityOut = args.rarity_exclude?.length ? args.rarity_exclude.map((s) => s.trim().toLowerCase()) : null;
      // $3/$4 in BOTH queries below (the count and the page share one CTE, so
      // the numbering has to agree); paging binds $5/$6.
      const rarityWhere = (col: string): string =>
        `AND ($3::text[] IS NULL OR lower(${col}) = ANY($3))
         AND ($4::text[] IS NULL OR ${col} IS NULL OR NOT (lower(${col}) = ANY($4)))`;

      if (!args.set_id) {
        // Overview: one line per set with any progress, sorted by goal pct
        // desc. `goal` is a closed zod enum, so interpolating it into the
        // ORDER BY FILTER clauses is allow-list-safe (house rule).
        const having = `HAVING max(p.owned_required) > 0`;
        const totalRow = await q1<{ total: string }>(
          ctx.db,
          `SELECT count(*) AS total FROM (
             SELECT p.set_id FROM user_set_progress p
              WHERE p.user_id = $1 GROUP BY p.set_id ${having}) s`,
          [ctx.userId],
        );
        const total = Number(totalRow?.total ?? 0);
        const rows = await q<OverviewRow>(
          ctx.db,
          `SELECT cs.tcgdex_id AS set_tid, cs.name AS set_name, se.slug AS series_slug,
                  max(p.owned_required) FILTER (WHERE p.goal = 'complete')    AS c_owned,
                  max(p.total_required) FILTER (WHERE p.goal = 'complete')    AS c_total,
                  max(p.owned_required) FILTER (WHERE p.goal = 'master')      AS m_owned,
                  max(p.total_required) FILTER (WHERE p.goal = 'master')      AS m_total,
                  max(p.owned_required) FILTER (WHERE p.goal = 'grandmaster') AS g_owned,
                  max(p.total_required) FILTER (WHERE p.goal = 'grandmaster') AS g_total
             FROM user_set_progress p
             JOIN card_set cs ON cs.id = p.set_id
             JOIN series se   ON se.id = cs.series_id
            WHERE p.user_id = $1
            GROUP BY cs.id, cs.tcgdex_id, cs.name, se.slug
            ${having}
            ORDER BY (max(p.owned_required) FILTER (WHERE p.goal = $4))::float
                     / NULLIF(max(p.total_required) FILTER (WHERE p.goal = $4), 0)
                     DESC NULLS LAST, cs.tcgdex_id
            LIMIT $2 OFFSET $3`,
          [ctx.userId, args.page_size, offset, goal],
        );
        if (total === 0) return ok('No sets have any progress yet.');
        const lines = rows.map((r) => {
          const gOwned = { complete: r.c_owned, master: r.m_owned, grandmaster: r.g_owned }[goal] ?? 0;
          const gTotal = { complete: r.c_total, master: r.m_total, grandmaster: r.g_total }[goal] ?? 0;
          return row(
            `${r.set_name} (${r.set_tid})`,
            `complete ${r.c_owned ?? 0}/${r.c_total ?? 0}`,
            `master ${r.m_owned ?? 0}/${r.m_total ?? 0}`,
            `grandmaster ${r.g_owned ?? 0}/${r.g_total ?? 0}`,
            `${pctTxt(Number(gOwned), Number(gTotal))} ${goal}`,
            `series ${r.series_slug}`,
          );
        });
        return ok(
          [`Sets with progress, sorted by ${goal} completion:`, ...lines, pagingFooter(args.page, args.page_size, total)].join('\n'),
          { total, goal },
        );
      }

      // Per-set detail.
      // The `series` join was already here, for the language tie-break in the
      // ORDER BY; it now also yields the slug the set route needs.
      const set = await q1<{ id: string; name: string; tid: string; released_on: string | null; series_slug: string }>(
        ctx.db,
        `SELECT cs.id, cs.name, cs.tcgdex_id AS tid, cs.released_on::text AS released_on, s.slug AS series_slug
           FROM card_set cs
           JOIN series s ON s.id = cs.series_id
          WHERE cs.tcgdex_id = $1
          ORDER BY (s.catalogue_code = 'en') DESC
          LIMIT 1`,
        [args.set_id.trim()],
      );
      // SAY HOW TO RECOVER, not just what was wrong.
      //
      // Observed against the live preview: asked "what is in Pitch Black?",
      // Deck-E guessed `set_id: 'pb'`, then searched `search_cards` twice for
      // "Pitch Black" (which matches CARD names, not set names, so both came
      // back empty), then called this tool with no `set_id` at all before
      // finally arriving at `me05`. Four wasted calls, each re-billing the
      // whole prompt, to answer a question about a set whose name he was told.
      //
      // Nothing in the old message pointed anywhere useful — it named the
      // FORMAT of an id to someone who has a NAME and no way to turn one into
      // the other. The recovery already exists; it was simply never mentioned.
      if (!set) {
        return fail(
          `No set with id '${args.set_id}'. Set ids are TCGdex ids like 'me05', 'sv3pt5'. ` +
            `If you have a set NAME rather than an id, call set_progress with NO set_id — ` +
            `that lists every set with its id, and you can match the name there. ` +
            `search_cards will not help: it matches card names, not set names.`,
        );
      }
      const setId = Number(set.id);

      const goalRows = await q<GoalRow>(
        ctx.db,
        `SELECT goal, owned_required, total_required, total_quantity
           FROM user_set_progress WHERE user_id = $1 AND set_id = $2`,
        [ctx.userId, setId],
      );
      const byGoal = new Map(goalRows.map((g) => [g.goal, g]));

      // Missing required items for the goal. complete = card-level (no owned
      // variant); master = master_required_variant minus owned; grandmaster =
      // ALL variants minus owned (mirrors recomputeSetProgress: grand_total
      // counts every variant, so the numbers reconcile with user_set_progress).
      const notOwnedVariant = `NOT EXISTS (
        SELECT 1 FROM collection_item ci
         WHERE ci.card_variant_id = req.card_variant_id AND ci.user_id = $2 AND ci.quantity > 0)`;
      let missingCore: string;
      if (goal === 'complete') {
        missingCore = `
          missing AS (
            SELECT c.id AS card_id, c.name, c.local_id, c.number_sort, c.rarity
              FROM card c
             WHERE c.set_id = $1
               AND NOT EXISTS (
                 SELECT 1 FROM collection_item ci
                 JOIN card_variant cv ON cv.id = ci.card_variant_id
                WHERE cv.card_id = c.id AND ci.user_id = $2 AND ci.quantity > 0)
               ${rarityWhere('c.rarity')}),
          cheapest AS (
            SELECT DISTINCT ON (cv.card_id) cv.card_id, cv.variant_kind_code, pc.market_minor AS cheap_minor
              FROM card_variant cv
              JOIN price_current pc ON pc.card_variant_id = cv.id
             WHERE pc.currency_code = 'USD' AND pc.market_minor IS NOT NULL
               AND cv.card_id IN (SELECT card_id FROM missing)
             ORDER BY cv.card_id, pc.market_minor ASC),
          rows AS (
            SELECT m.name, m.local_id, m.number_sort, m.rarity, ch.variant_kind_code, ch.cheap_minor, NULL::smallint AS vsort
              FROM missing m LEFT JOIN cheapest ch ON ch.card_id = m.card_id)`;
      } else {
        const reqSql =
          goal === 'master'
            ? `SELECT mrv.card_variant_id FROM master_required_variant mrv
                 JOIN card c ON c.id = mrv.card_id WHERE c.set_id = $1`
            : `SELECT cv.id AS card_variant_id FROM card_variant cv
                 JOIN card c ON c.id = cv.card_id WHERE c.set_id = $1`;
        missingCore = `
          req AS (${reqSql}),
          missing AS (SELECT req.card_variant_id FROM req WHERE ${notOwnedVariant}),
          cheapest AS (
            SELECT card_variant_id, min(market_minor) AS cheap_minor
              FROM price_current
             WHERE currency_code = 'USD' AND market_minor IS NOT NULL
               AND card_variant_id IN (SELECT card_variant_id FROM missing)
             GROUP BY card_variant_id),
          rows AS (
            SELECT c.name, c.local_id, c.number_sort, c.rarity, cv.variant_kind_code, ch.cheap_minor, cv.sort_order AS vsort
              FROM missing m
              JOIN card_variant cv ON cv.id = m.card_variant_id
              JOIN card c          ON c.id = cv.card_id
              LEFT JOIN cheapest ch ON ch.card_variant_id = m.card_variant_id
             WHERE true ${rarityWhere('c.rarity')})`;
      }

      const agg = await q1<MissingAggRow>(
        ctx.db,
        `WITH ${missingCore}
         SELECT count(*) AS missing, sum(cheap_minor)::bigint AS cost_minor,
                count(cheap_minor) AS priced, count(*) FILTER (WHERE cheap_minor IS NULL) AS unpriced
           FROM rows`,
        [setId, ctx.userId, rarityIn, rarityOut],
      );
      const missingRows = await q<MissingRow>(
        ctx.db,
        `WITH ${missingCore}
         SELECT name, local_id, variant_kind_code, rarity, cheap_minor
           FROM rows ORDER BY number_sort, vsort NULLS FIRST
          LIMIT $5 OFFSET $6`,
        [setId, ctx.userId, rarityIn, rarityOut, args.page_size, offset],
      );

      const lines: string[] = [
        `${set.name} (${set.tid})${set.released_on ? ` — released ${set.released_on}` : ''} · series ${set.series_slug}`,
      ];
      if (goalRows.length > 0) {
        lines.push(
          GOALS.map((g) => {
            const r = byGoal.get(g);
            return r
              ? `${g} ${r.owned_required}/${r.total_required} (${pctTxt(Number(r.owned_required), Number(r.total_required))})`
              : `${g} —`;
          }).join(' · ') + ` · ${byGoal.get(goal)?.total_quantity ?? 0} copies held (${goal})`,
        );
      } else {
        lines.push('no progress rows yet (set untouched — counts below are computed live)');
      }

      const missingTotal = Number(agg?.missing ?? 0);
      if (missingTotal === 0) {
        lines.push(`missing for '${goal}': none — goal complete`);
      } else {
        lines.push(`missing for '${goal}' (${missingTotal}) — name | number | variant kind | rarity | cheapest USD:`);
        for (const m of missingRows) {
          lines.push('  ' + row(m.name, m.local_id, m.variant_kind_code ?? 'any', m.rarity, money(m.cheap_minor)));
        }
        lines.push(pagingFooter(args.page, args.page_size, missingTotal));
        const cost = agg?.cost_minor === null || agg?.cost_minor === undefined ? null : Number(agg.cost_minor);
        const unpriced = Number(agg?.unpriced ?? 0);
        lines.push(
          `cost to finish '${goal}': ${money(cost)} (Σ cheapest USD market over ${Number(agg?.priced ?? 0)} priced missing` +
            `${unpriced > 0 ? `; ${unpriced} missing items unpriced and NOT included` : ''})`,
        );
      }
      return ok(lines.join('\n'), { set: set.tid, goal, missing: missingTotal });
    } catch (err) {
      return fail(`set_progress failed: ${errText(err)}`);
    }
  },
});

export const catalogTools: ToolDefinition[] = [
  searchCardsTool,
  getCardTool,
  setProgressTool,
];
