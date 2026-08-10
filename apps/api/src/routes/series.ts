import { Router } from 'express';
import { q, q1 } from '../db.js';
import { asyncHandler, notFound, userCache } from '../http.js';
import { currentUserId } from '../identity.js';

export const seriesRouter: Router = Router();

interface SeriesRow {
  id: string;
  tcgdex_id: string;
  slug: string;
  name: string;
  first_release_on: string | null;
  sort_order: number;
  set_count: string;
  card_count: string;
  rep_set_id: string | null;
  rep_has_symbol: boolean | null;
  owned_required: string | null;
  total_required: string | null;
}

/** GET /deckscout/api/series — the series list (English catalogue). */
seriesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const userId = currentUserId(req);
    // rep: the series' base/namesake set — the set sharing the series name (e.g.
    // "Scarlet & Violet" → set sv01), else the earliest non-promo set with a logo
    // (the flagship base set). Represents the whole era rather than a random recent
    // sub-set. Its logo/symbol are served locally by deckscout-images via the set id
    // (the client falls back cleanly when absent).
    //
    // Pokémon TCG Pocket (tcgdex_id 'tcgp') is a separate game, not an English TCG
    // era — excluded from this list. The rows are ordered newest era first.
    //
    // The per-series set/card counts are aggregated in a CTE *before* the two
    // LATERALs rather than alongside them. Joining `card` inline fanned the row
    // set out to one row per card (~21 000) and the `rep` LATERAL — which is not
    // memoizable, since its ORDER BY reads s.name — was then re-evaluated once
    // per fanned-out row: 20 968 loops, 91 837 shared buffers, 661 ms execution.
    // Aggregating first leaves 20 rows, so each LATERAL runs 20 times: 46 ms,
    // byte-identical output (verified by diffing both result sets).
    const rows = await q<SeriesRow>(
      `WITH counts AS (
         SELECT cs.series_id,
                count(DISTINCT cs.id) AS set_count,
                count(c.id)           AS card_count
           FROM card_set cs
      LEFT JOIN card c ON c.set_id = cs.id
          GROUP BY cs.series_id
       )
       SELECT s.id, s.tcgdex_id, s.slug, s.name, s.first_release_on, s.sort_order,
              COALESCE(cnt.set_count, 0)  AS set_count,
              COALESCE(cnt.card_count, 0) AS card_count,
              rep.tcgdex_id        AS rep_set_id,
              rep.symbol_url IS NOT NULL AS rep_has_symbol,
              prog.owned_required  AS owned_required,
              prog.total_required  AS total_required
         FROM series s
         JOIN catalogue cat ON cat.code = s.catalogue_code AND cat.is_enabled
    LEFT JOIN counts cnt ON cnt.series_id = s.id
    LEFT JOIN LATERAL (
                SELECT cs2.tcgdex_id, cs2.symbol_url
                  FROM card_set cs2
                 WHERE cs2.series_id = s.id AND cs2.logo_url IS NOT NULL
                 ORDER BY (lower(cs2.name) = lower(s.name)) DESC,
                          cs2.is_promo ASC,
                          cs2.released_on ASC NULLS LAST,
                          cs2.name
                 LIMIT 1
              ) rep ON true
    LEFT JOIN LATERAL (
                SELECT COALESCE(sum(usp.owned_required), 0) AS owned_required,
                       COALESCE(sum(usp.total_required), 0) AS total_required
                  FROM user_set_progress usp
                  JOIN card_set cs3 ON cs3.id = usp.set_id
                 WHERE cs3.series_id = s.id AND usp.user_id = $1 AND usp.goal = 'complete'
              ) prog ON true
        WHERE s.tcgdex_id <> 'tcgp'
        ORDER BY s.sort_order DESC, s.first_release_on DESC NULLS LAST, s.name`,
      [userId],
    );
    // Now includes the user's completion rollup, so it's user-private (not shared-cacheable).
    userCache(res);
    res.json({
      series: rows.map((r) => {
        const owned = Number(r.owned_required ?? 0);
        const total = Number(r.total_required ?? 0) || Number(r.card_count);
        return {
          slug: r.slug,
          tcgdexId: r.tcgdex_id,
          name: r.name,
          firstReleaseOn: r.first_release_on,
          sortOrder: r.sort_order,
          setCount: Number(r.set_count),
          cardCount: Number(r.card_count),
          repSetId: r.rep_set_id,
          repHasSymbol: Boolean(r.rep_has_symbol),
          // Per-series completion rollup (owned cards / total cards across the series).
          progress: { owned, total, pct: pct(owned, total) },
        };
      }),
    });
  }),
);

interface SetSummaryRow {
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
  card_rows: string;
  complete_owned: number | null;
  complete_total: number | null;
  complete_level: number | null;
  master_owned: number | null;
  master_total: number | null;
  grand_owned: number | null;
  grand_total: number | null;
}

function pct(owned: number | null, total: number | null): number {
  if (!owned || !total) return 0;
  return Math.round((owned / total) * 1000) / 10; // one decimal, matches pkmn.gg
}

/**
 * GET /deckscout/api/series/:seriesSlug — the sets in a series, each with the
 * three-goal completion summary for the default user (read from
 * user_set_progress; the Master total is a (card,variant) pair fraction).
 */
seriesRouter.get(
  '/:seriesSlug',
  asyncHandler(async (req, res) => {
    const slug = req.params.seriesSlug;
    const series = await q1<SeriesRow>(
      `SELECT s.id, s.tcgdex_id, s.slug, s.name, s.first_release_on, s.sort_order,
              0 AS set_count, 0 AS card_count
         FROM series s
         JOIN catalogue cat ON cat.code = s.catalogue_code AND cat.is_enabled
        WHERE s.slug = $1`,
      [slug],
    );
    if (!series) throw notFound(`No series '${slug}'`);
    const userId = currentUserId(req);

    const sets = await q<SetSummaryRow>(
      `SELECT cs.id, cs.tcgdex_id, cs.slug, cs.name, cs.released_on,
              cs.card_count_official, cs.card_count_total, cs.is_promo,
              cs.logo_url, cs.symbol_url,
              count(c.id) AS card_rows,
              pc.owned_required AS complete_owned, pc.total_required AS complete_total, pc.set_level AS complete_level,
              pm.owned_required AS master_owned,   pm.total_required AS master_total,
              pg.owned_required AS grand_owned,     pg.total_required AS grand_total
         FROM card_set cs
    LEFT JOIN card c ON c.set_id = cs.id
    LEFT JOIN user_set_progress pc ON pc.set_id = cs.id AND pc.user_id = $2 AND pc.goal = 'complete'
    LEFT JOIN user_set_progress pm ON pm.set_id = cs.id AND pm.user_id = $2 AND pm.goal = 'master'
    LEFT JOIN user_set_progress pg ON pg.set_id = cs.id AND pg.user_id = $2 AND pg.goal = 'grandmaster'
        WHERE cs.series_id = $1
        GROUP BY cs.id, pc.owned_required, pc.total_required, pc.set_level,
                 pm.owned_required, pm.total_required, pg.owned_required, pg.total_required
        -- Hide zero-card sets (catalogue artifacts with no cards imported, e.g.
        -- base/wp, miscellaneous/jumbo): they'd otherwise render an empty set page.
        HAVING count(c.id) > 0
        ORDER BY cs.released_on DESC NULLS LAST, cs.name`,
      [series.id, userId],
    );

    userCache(res);
    res.json({
      series: { slug: series.slug, tcgdexId: series.tcgdex_id, name: series.name, firstReleaseOn: series.first_release_on },
      sets: sets.map((s) => {
        const total = s.card_count_total ?? Number(s.card_rows);
        const official = s.card_count_official ?? total;
        return {
          setId: s.tcgdex_id,
          slug: s.slug,
          name: s.name,
          releasedOn: s.released_on,
          isPromo: s.is_promo,
          printedCount: official,
          secretCount: Math.max(0, total - official),
          cardCountTotal: total,
          logoUrl: s.logo_url,
          symbolUrl: s.symbol_url,
          progress: {
            complete: { owned: s.complete_owned ?? 0, total: s.complete_total ?? Number(s.card_rows), pct: pct(s.complete_owned, s.complete_total), setLevel: s.complete_level ?? 0 },
            master: { owned: s.master_owned ?? 0, total: s.master_total ?? 0, pct: pct(s.master_owned, s.master_total) },
            grandmaster: { owned: s.grand_owned ?? 0, total: s.grand_total ?? 0, pct: pct(s.grand_owned, s.grand_total) },
          },
        };
      }),
    });
  }),
);
