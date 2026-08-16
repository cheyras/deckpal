import { Router } from 'express';
import { q, q1 } from '../db.js';
import { asyncHandler, badRequest, notFound, oneOf, strList, userCache } from '../http.js';
import { currentUserId } from '../identity.js';
import { MASSENTRY_NOTE, buildUrls, meLine, tcgplayerAbbrev } from '../tcgplayer/massentry.js';

/**
 * GET /deckpal/api/sets/:setId/massentry — TCGplayer Mass Entry deep link(s)
 * for every card still needed to finish the set (issue 2026-07-30_qhfs2f).
 *
 * The Mass Entry mechanics (line grammar, abbreviation vocabulary, URL
 * chunking) live in ../tcgplayer/massentry.ts, shared with the deck routes.
 * The ONLY real preferences here are which variants count as "needed"
 * (goal + optional finish filter below) — printing and condition are chosen
 * on TCGplayer's own page.
 *
 * Missing-for-goal math mirrors deckpal-mcp's set_progress (and therefore
 * recomputeSetProgress): complete = cards with no owned variant, master =
 * master_required_variant minus owned, grandmaster = every variant minus owned.
 * Variants with no TCGplayer identity are returned as `unlinkable` instead of
 * being dropped silently.
 */

export const massEntryRouter: Router = Router();

const GOALS = ['complete', 'master', 'grandmaster'] as const;
type Goal = (typeof GOALS)[number];
// Closed vocabulary of variant_finish codes (migration 004). Checked against
// the DB at request time only via the allow-list — never interpolated.
const FINISHES = ['normal', 'reverse', 'holo', 'lenticular', 'metal'] as const;

// ── Route ─────────────────────────────────────────────────────────────────────

interface MissingRow {
  card_id: string;
  name: string;
  local_id: string;
  variant_name: string | null; // null for goal=complete (card-level rows)
  linkable: boolean;
  token: string | null;
}

massEntryRouter.get(
  '/:setId/massentry',
  asyncHandler(async (req, res) => {
    const set = await q1<{ id: string; tcgdex_id: string; name: string; group_id: number | null; card_count: number | null }>(
      `SELECT cs.id, cs.tcgdex_id, cs.name, cs.tcgplayer_group_id AS group_id, cs.card_count_official AS card_count
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

    // Missing rows for the goal — same derivation as deckpal-mcp set_progress /
    // recomputeSetProgress so counts reconcile with user_set_progress.
    let rows: MissingRow[];
    if (goal === 'complete') {
      // One row per card with NO owned variant. Finish filter is meaningless
      // here (any one variant completes the card) and is ignored by design.
      rows = await q<MissingRow>(
        `SELECT c.id AS card_id, c.name, c.local_id,
                NULL::text AS variant_name,
                bool_or(cv.tcgplayer_product_id IS NOT NULL OR cv.tcgplayer_mass_entry IS NOT NULL) AS linkable,
                (array_agg(cv.tcgplayer_mass_entry ORDER BY cv.sort_order)
                   FILTER (WHERE cv.tcgplayer_mass_entry IS NOT NULL))[1] AS token
           FROM card c
           JOIN card_variant cv ON cv.card_id = c.id
          WHERE c.set_id = $1
            AND NOT EXISTS (
              SELECT 1 FROM collection_item ci
              JOIN card_variant cv2 ON cv2.id = ci.card_variant_id
             WHERE cv2.card_id = c.id AND ci.user_id = $2 AND ci.quantity > 0)
          GROUP BY c.id, c.name, c.local_id, c.number_sort
          ORDER BY c.number_sort`,
        [set.id, userId],
      );
    } else {
      const reqSql =
        goal === 'master'
          ? `SELECT mrv.card_variant_id FROM master_required_variant mrv
               JOIN card c ON c.id = mrv.card_id WHERE c.set_id = $1`
          : `SELECT cv.id AS card_variant_id FROM card_variant cv
               JOIN card c ON c.id = cv.card_id WHERE c.set_id = $1`;
      rows = await q<MissingRow>(
        `WITH req AS (${reqSql}),
         missing AS (
           SELECT req.card_variant_id FROM req
            WHERE NOT EXISTS (
              SELECT 1 FROM collection_item ci
               WHERE ci.card_variant_id = req.card_variant_id AND ci.user_id = $2 AND ci.quantity > 0))
         SELECT c.id AS card_id, c.name, c.local_id,
                COALESCE(cv.display_name, vk.display_name) AS variant_name,
                (cv.tcgplayer_product_id IS NOT NULL OR cv.tcgplayer_mass_entry IS NOT NULL) AS linkable,
                cv.tcgplayer_mass_entry AS token
           FROM missing m
           JOIN card_variant cv ON cv.id = m.card_variant_id
           JOIN variant_kind vk ON vk.code = cv.variant_kind_code
           JOIN card c          ON c.id = cv.card_id
          WHERE ($3::text[] IS NULL OR vk.finish = ANY($3))
          ORDER BY c.number_sort, cv.sort_order`,
        [set.id, userId, finishes],
      );
    }

    const setCode = await tcgplayerAbbrev(set.group_id);

    // Aggregate per card: Mass Entry lines cannot distinguish printings, so N
    // missing variants of one card become quantity N on one line (the printing
    // is then picked on TCGplayer's page). Stored tokens group by token text.
    interface Agg {
      qty: number;
      name: string;
      local_id: string;
      token: string | null;
    }
    const byCard = new Map<string, Agg>();
    const unlinkable: Array<{ name: string; number: string; variant: string | null }> = [];
    for (const r of rows) {
      if (!r.linkable) {
        unlinkable.push({ name: r.name, number: r.local_id, variant: r.variant_name });
        continue;
      }
      const key = r.token ?? r.card_id;
      const cur = byCard.get(key);
      if (cur) cur.qty += 1;
      else byCard.set(key, { qty: 1, name: r.name, local_id: r.local_id, token: r.token });
    }

    const lines = [...byCard.values()].map((a) => meLine(a.qty, a.name, a.token, setCode, a.local_id, set.group_id, set.card_count));
    const urls = buildUrls(lines);

    const warnings: string[] = [];
    if (setCode === null && lines.length > 0) {
      warnings.push(
        'TCGplayer set code unavailable — lines carry the card name only and may match printings from other sets.',
      );
    }
    if (unlinkable.length > 0) {
      warnings.push(`${unlinkable.length} needed item(s) have no TCGplayer product and are not in the cart link.`);
    }

    userCache(res);
    res.json({
      set: { setId: set.tcgdex_id, name: set.name },
      goal,
      finishes, // null = all finishes
      setCode, // TCGplayer set abbreviation used in the lines, e.g. 'PBL'
      needed: {
        // cards = distinct lines; items = physical copies to buy (Σ quantities);
        // for master/grandmaster items === missing required variants after the
        // finish filter, so it reconciles with user_set_progress.
        cards: byCard.size,
        items: [...byCard.values()].reduce((s, a) => s + a.qty, 0),
        unlinkable: unlinkable.length,
      },
      lines,
      text: lines.join('\n'),
      urls, // ordered; open each in the logged-in browser — all add to one cart
      unlinkable,
      warnings,
      note: MASSENTRY_NOTE,
    });
  }),
);
