import { Router } from 'express';
import { cardImages, dbHandle, q, q1, shapePrice, tcgplayerUrl, toMajor, type PriceRow } from '../db.js';
import { asyncHandler, notFound, oneOf, userCache } from '../http.js';
import { optionalUserId } from '../identity.js';
import { cardLegality, formatConfig, loadByTcgdexId, buildReprintOracle } from '../deck/index.js';

export const cardsRouter: Router = Router();

/**
 * The windows the price chart offers, mirroring the Insights value chart's
 * (`insights/collectionValue.ts`). Two range vocabularies in one app would be a
 * small betrayal of the reader every time they moved between the two charts.
 */
const PRICE_RANGES = ['30d', '3m', '6m', '1y', '18m', '2y'] as const;
type PriceRange = (typeof PRICE_RANGES)[number];
const PRICE_RANGE_INTERVAL: Record<PriceRange, string> = {
  '30d': '30 days',
  '3m': '3 months',
  '6m': '6 months',
  '1y': '1 year',
  '18m': '18 months',
  '2y': '2 years',
};

interface CardRow {
  id: string;
  tcgdex_id: string;
  local_id: string;
  number_sort: string;
  name: string;
  category: string;
  rarity: string | null;
  illustrator: string | null;
  hp: number | null;
  stage: string | null;
  suffix: string | null;
  evolve_from: string | null;
  trainer_type: string | null;
  energy_type: string | null;
  retreat: number | null;
  effect: string | null;
  regulation_mark: string | null;
  legal_standard: boolean;
  legal_expanded: boolean;
  is_ace_spec: boolean;
  is_radiant: boolean;
  is_prism_star: boolean;
  has_rule_box: boolean;
  released_on: string | null;
  set_tcgdex_id: string;
  set_name: string;
  set_slug: string;
  set_symbol_url: string | null;
  set_logo_url: string | null;
  card_count_official: number | null;
  series_slug: string;
  series_name: string;
  series_tcgdex_id: string;
}

interface VariantRow {
  id: string;
  variant_kind_code: string;
  display_name: string | null;
  kind_display: string;
  provenance: string | null;
  sort_order: number;
  is_primary: boolean;
  is_synthesized: boolean;
  source: string;
  fill_confidence: number | null;
  tier: string;
  tier_source: string;
  tcgplayer_url: string | null;
  tcgplayer_product_id: number | null;
  tcgplayer_printing: string | null;
  quantity: number;
}

/**
 * GET /deckpal/api/cards/:cardId — card detail.
 * :cardId is the card tcgdex_id (e.g. 'base1-4' for Charizard).
 * Returns all variants (composed display name, resolved tier, per-variant prices
 * across every source/currency with priced_at, TCGplayer buy URL), dex species
 * links, attacks/abilities/weaknesses, and image refs at both resolutions.
 */
cardsRouter.get(
  '/:cardId',
  asyncHandler(async (req, res) => {
    const cardTcgdexId = req.params.cardId;
    const card = await q1<CardRow>(
      `SELECT c.id, c.tcgdex_id, c.local_id, c.number_sort, c.name, c.category, c.rarity,
              c.illustrator, c.hp, c.stage, c.suffix, c.evolve_from, c.trainer_type,
              c.energy_type, c.retreat, c.effect, c.regulation_mark,
              c.legal_standard, c.legal_expanded, c.is_ace_spec, c.is_radiant,
              c.is_prism_star, c.has_rule_box, c.released_on,
              cs.tcgdex_id AS set_tcgdex_id, cs.name AS set_name, cs.slug AS set_slug,
              cs.symbol_url AS set_symbol_url, cs.logo_url AS set_logo_url,
              cs.card_count_official,
              ser.slug AS series_slug, ser.name AS series_name, ser.tcgdex_id AS series_tcgdex_id
         FROM card c
         JOIN card_set cs ON cs.id = c.set_id
         JOIN series ser ON ser.id = cs.series_id
        WHERE c.tcgdex_id = $1`,
      [cardTcgdexId],
    );
    if (!card) throw notFound(`No card '${cardTcgdexId}'`);
    const cardId = card.id;
    // null when nobody is signed in (public catalog). Bound as SQL NULL below:
    // `ci.user_id = NULL` is UNKNOWN, so the collection LEFT JOIN matches no row
    // for any user, and `quantity` is omitted from every variant.
    const userId = optionalUserId(req);

    // These nine result sets used to be a `Promise.all` of nine `q()` calls. That
    // read like nine parallel queries but never was one: in SUPABASE_MODE every
    // q() runs on the single per-request RLS PoolClient, and node-postgres
    // serialises queries on one connection. So it was nine *sequential* round
    // trips to a database in another AWS region (~90 ms each, measured) — the
    // dominant cost of this endpoint, and the set page fetches it once per tile.
    //
    // Folding them into one statement of independent scalar subqueries keeps each
    // sub-plan exactly as it was (same indexes, same filters) and costs one round
    // trip instead of nine. Ordering is explicit inside each json_agg rather than
    // inherited from a subquery's output order. BIGINT ids are cast to text so the
    // JSON shape matches what the pg driver returned before (json_agg would
    // otherwise emit them as numbers), and priced_at is formatted to the exact
    // ISO-8601 spelling JSON.stringify produced for the driver's Date objects.
    const bundle = await q1<{
      variants: VariantRow[];
      prices: (PriceRow & { card_variant_id: string })[];
      attacks: { ord: number; name: string; damage: string | null; effect: string | null; cost: string[] | null }[];
      abilities: { ord: number; kind: string; name: string; effect: string | null }[];
      matchups: { kind: string; ord: number; type: string; value: string }[];
      types: { slot: number; type: string }[];
      subtypes: { ord: number; subtype: string }[];
      tags: { ord: number; tag: string }[];
      species: { id: number; identifier: string; name: string; generation: number; ord: number }[];
    }>(
      `SELECT
         COALESCE((SELECT json_agg(v ORDER BY v.sort_order) FROM (
             SELECT cv.id::text AS id, cv.variant_kind_code, cv.display_name,
                    vk.display_name AS kind_display,
                    cv.provenance, cv.sort_order, cv.is_primary, cv.is_synthesized, cv.source,
                    cv.fill_confidence, t.tier, t.tier_source,
                    cv.tcgplayer_url, cv.tcgplayer_product_id, cv.tcgplayer_printing,
                    COALESCE(ci.quantity, 0) AS quantity
               FROM card_variant cv
               JOIN variant_kind vk ON vk.code = cv.variant_kind_code
               JOIN variant_tier_resolved t ON t.card_variant_id = cv.id
          LEFT JOIN collection_item ci ON ci.card_variant_id = cv.id AND ci.user_id = $2
              WHERE cv.card_id = $1
           ) v), '[]'::json) AS variants,
         COALESCE((SELECT json_agg(p ORDER BY p.priority, p.currency_code) FROM (
             SELECT pc.card_variant_id::text AS card_variant_id, pc.source_code,
                    ps.label AS source_label, ps.marketplace, ps.priority,
                    pc.currency_code, pc.market_minor, pc.low_minor, pc.mid_minor, pc.high_minor,
                    pc.direct_low_minor, pc.trend_minor, pc.avg1_minor, pc.avg7_minor, pc.avg30_minor,
                    to_char(pc.priced_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS priced_at,
                    pc.is_fallback
               FROM price_current pc
               JOIN card_variant cv ON cv.id = pc.card_variant_id
               JOIN price_source ps ON ps.code = pc.source_code
              WHERE cv.card_id = $1
           ) p), '[]'::json) AS prices,
         COALESCE((SELECT json_agg(a ORDER BY a.ord) FROM (
             SELECT ord, name, damage, effect, cost FROM card_attack WHERE card_id = $1
           ) a), '[]'::json) AS attacks,
         COALESCE((SELECT json_agg(b ORDER BY b.ord) FROM (
             SELECT ord, kind, name, effect FROM card_ability WHERE card_id = $1
           ) b), '[]'::json) AS abilities,
         COALESCE((SELECT json_agg(m ORDER BY m.kind, m.ord) FROM (
             SELECT kind, ord, type, value FROM card_matchup WHERE card_id = $1
           ) m), '[]'::json) AS matchups,
         COALESCE((SELECT json_agg(ty ORDER BY ty.slot) FROM (
             SELECT slot, type FROM card_type WHERE card_id = $1
           ) ty), '[]'::json) AS types,
         COALESCE((SELECT json_agg(st ORDER BY st.ord) FROM (
             SELECT ord, subtype FROM card_subtype WHERE card_id = $1
           ) st), '[]'::json) AS subtypes,
         COALESCE((SELECT json_agg(tg ORDER BY tg.ord) FROM (
             SELECT ord, tag FROM card_tag WHERE card_id = $1
           ) tg), '[]'::json) AS tags,
         COALESCE((SELECT json_agg(sp ORDER BY sp.ord) FROM (
             SELECT d.id, d.identifier, d.name, d.generation, csp.ord
               FROM card_species csp JOIN dex_species d ON d.id = csp.dex_id
              WHERE csp.card_id = $1
           ) sp), '[]'::json) AS species`,
      [cardId, userId],
    );
    const variants = bundle?.variants ?? [];
    const priceRows = bundle?.prices ?? [];
    const attacks = bundle?.attacks ?? [];
    const abilities = bundle?.abilities ?? [];
    const matchups = bundle?.matchups ?? [];
    const types = bundle?.types ?? [];
    const subtypes = bundle?.subtypes ?? [];
    const tags = bundle?.tags ?? [];
    const species = bundle?.species ?? [];

    const pricesByVariant = new Map<string, PriceRow[]>();
    for (const p of priceRows) {
      const arr = pricesByVariant.get(p.card_variant_id) ?? [];
      arr.push(p);
      pricesByVariant.set(p.card_variant_id, arr);
    }

    const total = card.card_count_official ?? undefined;
    userCache(res);
    res.json({
      card: {
        cardId: card.tcgdex_id,
        number: card.local_id,
        numberSort: card.number_sort,
        printedTotal: total ?? null,
        name: card.name,
        category: card.category,
        rarity: card.rarity,
        artist: card.illustrator,
        hp: card.hp,
        stage: card.stage,
        suffix: card.suffix,
        evolvesFrom: card.evolve_from,
        trainerType: card.trainer_type,
        energyType: card.energy_type,
        retreat: card.retreat,
        effect: card.effect,
        regulationMark: card.regulation_mark,
        releasedOn: card.released_on,
        legal: { standard: card.legal_standard, expanded: card.legal_expanded },
        flags: { aceSpec: card.is_ace_spec, radiant: card.is_radiant, prismStar: card.is_prism_star, ruleBox: card.has_rule_box },
        set: {
          setId: card.set_tcgdex_id,
          name: card.set_name,
          slug: card.set_slug,
          logoUrl: card.set_logo_url,
          symbolUrl: card.set_symbol_url,
        },
        series: { slug: card.series_slug, name: card.series_name, tcgdexId: card.series_tcgdex_id },
        images: cardImages(card.series_tcgdex_id, card.set_tcgdex_id, card.local_id),
        types: types.map((t) => t.type),
        subtypes: subtypes.map((s) => s.subtype),
        tags: tags.map((t) => t.tag),
        attacks: attacks.map((a) => ({ name: a.name, cost: a.cost, damage: a.damage, effect: a.effect })),
        abilities: abilities.map((a) => ({ kind: a.kind, name: a.name, effect: a.effect })),
        weaknesses: matchups.filter((m) => m.kind === 'weakness').map((m) => ({ type: m.type, value: m.value })),
        resistances: matchups.filter((m) => m.kind === 'resistance').map((m) => ({ type: m.type, value: m.value })),
        species: species.map((s) => ({ speciesId: s.id, slug: s.identifier, name: s.name, generation: s.generation })),
      },
      variants: variants.map((v) => ({
        variantId: Number(v.id),
        kind: v.variant_kind_code,
        // Composed display name is stored on the row; fall back to the kind label.
        displayName: v.display_name ?? v.kind_display,
        provenance: v.provenance,
        tier: v.tier, // 'standard' (counts toward Master) | 'special' (Grandmaster-only)
        tierSource: v.tier_source,
        isPrimary: v.is_primary,
        isSynthesized: v.is_synthesized,
        source: v.source, // 'tcgdex' | 'tcgcsv' (cross-filled reverse holos count for real)
        fillConfidence: v.fill_confidence,
        // Owned quantity for the caller (0 if unowned) — absent when there is no
        // caller. The rest of the variant is catalog and is served either way.
        ...(userId === null ? {} : { quantity: Number(v.quantity) }),
        buyUrl: tcgplayerUrl(v.tcgplayer_url, v.tcgplayer_product_id, v.tcgplayer_printing),
        // Every price carries currency + priced_at; a missing price is null, never 0.
        prices: (pricesByVariant.get(v.id) ?? []).map(shapePrice),
      })),
    });
  }),
);

/**
 * GET /deckpal/api/cards/:cardId/legality — per-format eligibility for one card.
 *
 * Its own endpoint, fetched only when the card modal's TCG tab is opened, rather
 * than a field on the card payload. `GET /cards/:cardId` is on a hot path (the
 * table view opens one per row for its variant counters), and this adds a
 * catalogue round trip for the reprint oracle that the other 95% of card reads
 * would pay for nothing.
 *
 * Public: legality is a property of the card, not of anyone's collection.
 */
cardsRouter.get(
  '/:cardId/legality',
  asyncHandler(async (req, res) => {
    const cardTcgdexId = String(req.params.cardId);
    const facts = await loadByTcgdexId(dbHandle(), cardTcgdexId);
    if (!facts) throw notFound(`No card '${cardTcgdexId}'`);

    // The reprint oracle (§2.1.5) is what stops a rotated-out printing being
    // reported as illegal when a fingerprint-identical legal reprint exists.
    // Standard is the only format whose pool is mark-based, so it is the only
    // one that needs it; `buildReprintOracle` self-shortcuts when the card
    // already carries a legal mark.
    const legalMarks = formatConfig('standard').legal_marks;
    const oracle = await buildReprintOracle(dbHandle(), [facts], legalMarks);

    userCache(res);
    res.json(cardLegality(facts, { isInFormatByReprint: oracle }));
  }),
);

/**
 * GET /deckpal/api/cards/:cardId/prices?range=30d|3m|6m|1y|18m|2y&currency=USD
 * — observed market price over time, one series per variant, at whatever GRAIN
 * that stretch of history still exists in.
 *
 * The card modal's Price tab read "Price history — coming soon" for as long as
 * it existed, and the data was there the whole time: `price_observation` is
 * append-only, partitioned by month, and carries the SOURCE's own stamp rather
 * than ingest time (`007_pricing.sql:49`). What was missing was a reader.
 *
 * ── THREE TIERS, ONE POINT SHAPE ───────────────────────────────────────────
 * Daily rows forever do not fit the disk (~6.6 GB/year at the scale this app is
 * heading for), so `apps/sync/src/prices/rollup.ts` keeps the last ~30 days
 * daily, ~6 months of WEEKLY OHLC buckets, and MONTHLY buckets forever. Making
 * the reader present three tiers as one series is deliberate: uniformity is the
 * reader's problem, solved here, rather than the writer's — see the "Why the
 * daily tier stays in price_observation" section of the plan.
 *
 * So every point carries the full bucket shape, and a DAY is a degenerate
 * bucket: `open = high = low = close`, `start = end = highOn = lowOn`, `n = 1`.
 * A client that only wants a line reads `close` and never branches.
 *
 * ── HOW THE GRAIN IS CHOSEN ────────────────────────────────────────────────
 * Two cheap floors, from the two small `bucket_start` indexes 048 creates —
 * no partition introspection, and self-adjusting as the rollup runs:
 *
 *   day_floor  = max(month bucket_start) + 1 month   (NULL ⇒ nothing is rolled
 *                                                     up yet ⇒ all daily)
 *   week_floor = min(week bucket_start)              (NULL ⇒ no weekly tier)
 *
 * month grain serves [range_start, week_floor), week grain
 * [week_floor, day_floor), daily [day_floor, today].
 *
 * ── THE TWO SEAMS ──────────────────────────────────────────────────────────
 * The tiers are not a clean tiling and cannot be: a month bucket and that same
 * month's week buckets describe THE SAME DAYS at two grains, and ISO weeks do
 * not respect month boundaries. Something has to give at each floor, and the
 * choice everywhere is a small OVERLAP rather than a gap — a chart that draws
 * one week twice is cosmetic; a chart with a hole in it looks like missing data
 * and gets reported as a bug.
 *
 *   day floor   a week bucket starting in the last rolled-up month can extend
 *               up to six days past `day_floor`, so those days appear both in
 *               that week's band and as daily points.
 *   week floor  `month_ceiling` is the last day the MONTH tier is responsible
 *               for — the end of the last month served at month grain. The week
 *               tier picks up from the first week that ENDS after it, which is
 *               at most six days of overlap. Without this the boundary month
 *               would be drawn twice IN FULL: once as one wide month band and
 *               again as its own four or five weekly bands.
 *
 * Both are bounded by six days by construction, and both are documented rather
 * than special-cased in the writer.
 *
 * Grouped by DAY, not by observation. Two ingests can land on one calendar day
 * (a live run and a replayed archive carry different `captured_at` times for
 * the same date) and a chart with two points on one day reads as volatility
 * that did not happen. `max(market_minor)` per day matches how the collection
 * total picks its price across sources, and is exactly the day-series the
 * rollup buckets, so the two tiers cannot disagree about what a day was worth.
 *
 * ── WHAT AN AGENT MAY ASSERT FROM THIS RESPONSE ────────────────────────────
 * ⚠ THIS TEXT IS A CONTRACT. It MUST ship verbatim in any `packages/agent-tools`
 * or MCP tool that later exposes price history — none does today (`get_card`
 * serves current prices only). Rollup destroys real information, and an agent
 * that does not know WHICH information will invent it.
 *
 * Grounded on `grain`, an agent:
 *
 *   MAY assert — open/close/high/low/mean/median of a bucket; the exact dates
 *   and values of the period's high and low (`highOn`/`lowOn` are TRUE DAILY
 *   FACTS that survive the rollup); trend across buckets; and volatility
 *   DERIVED from OHLC (Parkinson or Garman-Klass — never a stored variance,
 *   which would be a second name for the range: corr(stddev, high-low) = 0.9878
 *   measured over 633,431 real weekly buckets).
 *
 *   MAY NOT assert — any specific day's price inside a week or month bucket
 *   other than the two extremes; the path between them; durations ("stayed
 *   under $5 for eleven days"); or a second/third dip or spike within one
 *   bucket. Those are the things the rollup genuinely destroys.
 *
 * "It dipped to $4.00 on the 12th" is licensed if and only if `lowOn` says the
 * 12th and `low` says $4.00.
 *
 * Public, like the rest of this router: a price is a property of the card.
 */
cardsRouter.get(
  '/:cardId/prices',
  asyncHandler(async (req, res) => {
    const cardTcgdexId = String(req.params.cardId);
    const range = oneOf(req.query.range, PRICE_RANGES, '3m');
    const currency = oneOf(req.query.currency, ['USD', 'EUR', 'JPY'] as const, 'USD');

    const card = await q1<{ id: string }>(
      `SELECT id FROM card WHERE tcgdex_id = $1 AND lang = 'en'`,
      [cardTcgdexId],
    );
    if (!card) throw notFound(`No card '${cardTcgdexId}'`);

    const rows = await q<{
      variant_id: string;
      variant_kind_code: string;
      display_name: string | null;
      kind_display: string;
      tier: string | null;
      grain: 'day' | 'week' | 'month';
      start_on: string;
      end_on: string;
      open_minor: string;
      high_minor: string;
      low_minor: string;
      close_minor: string;
      high_on: string;
      low_on: string;
      mean_minor: string;
      median_minor: string;
      n_obs: number;
    }>(
      `WITH floors AS (
         SELECT (SELECT max(bucket_start) + interval '1 month'
                   FROM price_bucket WHERE grain = 'month')::date AS day_floor,
                (SELECT min(bucket_start)
                   FROM price_bucket WHERE grain = 'week')::date  AS week_floor_raw
       ),
       b AS (
         -- With month buckets but no week ones (every week quarter dropped, or
         -- a catch-up that only ever wrote month grain), the weekly band is
         -- empty and month grain runs straight up to the daily floor.
         SELECT f.day_floor,
                COALESCE(f.week_floor_raw, f.day_floor) AS week_floor,
                -- The last day the MONTH tier is responsible for. Derived from
                -- the months actually served rather than from week_floor's own
                -- month, so a week_floor that happens to BE the first of a
                -- month does not push the weekly tier forward by a month and
                -- open a real gap. NULL when nothing is rolled up, which makes
                -- the week band's predicate NULL and therefore empty — correct,
                -- since there are no week buckets either.
                COALESCE(
                  (SELECT (max(bucket_start) + interval '1 month' - interval '1 day')::date
                     FROM price_bucket
                    WHERE grain = 'month' AND bucket_start < f.week_floor_raw),
                  f.week_floor_raw - 1
                ) AS month_ceiling,
                (CURRENT_DATE - $3::interval)::date AS from_day
           FROM floors f
       ),
       v AS (
         SELECT cv.id, cv.variant_kind_code, cv.display_name,
                vk.display_name AS kind_display, t.tier, cv.sort_order
           FROM card_variant cv
           JOIN variant_kind vk ON vk.code = cv.variant_kind_code
      LEFT JOIN variant_tier_resolved t ON t.card_variant_id = cv.id
          WHERE cv.card_id = $1
       ),
       pts AS (
         SELECT v.id AS variant_id, 'month'::text AS grain,
                pb.bucket_start AS start_on,
                (pb.bucket_start + interval '1 month' - interval '1 day')::date AS end_on,
                pb.open_minor, pb.high_minor, pb.low_minor, pb.close_minor,
                pb.high_on, pb.low_on, pb.mean_minor, pb.median_minor, pb.n_obs
           FROM v
           CROSS JOIN b
           JOIN price_bucket pb ON pb.card_variant_id = v.id
          WHERE pb.grain = 'month'
            AND upper(btrim(pb.currency_code)) = $2
            AND pb.bucket_start >= b.from_day
            AND pb.bucket_start <  b.week_floor
         UNION ALL
         SELECT v.id, 'week'::text,
                pb.bucket_start, (pb.bucket_start + 6)::date,
                pb.open_minor, pb.high_minor, pb.low_minor, pb.close_minor,
                pb.high_on, pb.low_on, pb.mean_minor, pb.median_minor, pb.n_obs
           FROM v
           CROSS JOIN b
           JOIN price_bucket pb ON pb.card_variant_id = v.id
          WHERE pb.grain = 'week'
            AND upper(btrim(pb.currency_code)) = $2
            AND pb.bucket_start >= b.from_day
            -- ENDS after the month tier's last day, not STARTS after it: the
            -- week straddling that boundary is what closes the gap.
            AND (pb.bucket_start + 6) > b.month_ceiling
            AND pb.bucket_start <  b.day_floor
         UNION ALL
         -- The degenerate bucket. A day IS its own open, high, low and close.
         SELECT v.id, 'day'::text, d.day, d.day,
                d.val, d.val, d.val, d.val, d.day, d.day, d.val, d.val, 1::smallint
           FROM v
           CROSS JOIN b
           JOIN LATERAL (
             SELECT (po.captured_at AT TIME ZONE 'UTC')::date AS day,
                    max(po.market_minor) AS val
               FROM price_observation po
              WHERE po.card_variant_id = v.id
                AND po.market_minor IS NOT NULL
                AND upper(btrim(po.currency_code)) = $2
                AND po.captured_at >= (b.from_day AT TIME ZONE 'UTC')
                AND (b.day_floor IS NULL
                     OR po.captured_at >= (b.day_floor AT TIME ZONE 'UTC'))
              GROUP BY 1
           ) d ON true
       )
       SELECT p.variant_id, v.variant_kind_code, v.display_name, v.kind_display, v.tier,
              p.grain,
              to_char(p.start_on, 'YYYY-MM-DD') AS start_on,
              to_char(p.end_on,   'YYYY-MM-DD') AS end_on,
              p.open_minor, p.high_minor, p.low_minor, p.close_minor,
              to_char(p.high_on,  'YYYY-MM-DD') AS high_on,
              to_char(p.low_on,   'YYYY-MM-DD') AS low_on,
              p.mean_minor, p.median_minor, p.n_obs
         FROM pts p
         JOIN v ON v.id = p.variant_id
        ORDER BY v.sort_order, p.start_on`,
      [card.id, currency, PRICE_RANGE_INTERVAL[range]],
    );

    const byVariant = new Map<string, {
      variantId: number;
      kind: string;
      displayName: string;
      tier: string | null;
      points: {
        grain: 'day' | 'week' | 'month';
        start: string; end: string;
        open: number; high: number; low: number; close: number;
        highOn: string; lowOn: string;
        mean: number; median: number; n: number;
      }[];
    }>();
    const money = (m: string): number => toMajor(Number(m), currency) ?? 0;
    for (const r of rows) {
      let series = byVariant.get(r.variant_id);
      if (!series) {
        series = {
          variantId: Number(r.variant_id),
          kind: r.variant_kind_code,
          displayName: r.display_name ?? r.kind_display,
          tier: r.tier,
          points: [],
        };
        byVariant.set(r.variant_id, series);
      }
      series.points.push({
        grain: r.grain,
        start: r.start_on,
        end: r.end_on,
        open: money(r.open_minor),
        high: money(r.high_minor),
        low: money(r.low_minor),
        close: money(r.close_minor),
        highOn: r.high_on,
        lowOn: r.low_on,
        mean: money(r.mean_minor),
        median: money(r.median_minor),
        n: Number(r.n_obs),
      });
    }

    userCache(res);
    res.json({ currency, range, series: [...byVariant.values()] });
  }),
);
