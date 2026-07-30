import { Router } from 'express';
import { defaultUserId, q, q1 } from '../db.js';
import { asyncHandler, badRequest, notFound, oneOf, strList, userCache } from '../http.js';

/**
 * GET /pokedex/api/sets/:setId/massentry — TCGplayer Mass Entry deep link(s)
 * for every card still needed to finish the set (issue 2026-07-30_qhfs2f).
 *
 * What TCGplayer Mass Entry actually supports (research 2026-07-30, TCGplayer
 * help S11 in research/DECK-FORMATS.md §1.9 + live URL checks):
 *   - URL:  https://www.tcgplayer.com/massentry?productline=Pokemon&c=<lines>
 *     with lines separated by `||` (%7C%7C) and spaces as `+`.
 *   - Line: `<qty> <name> [<SETCODE>] <number>` — set code is TCGplayer's own
 *     abbreviation vocabulary (e.g. PBL for "ME05: Pitch Black"), number is the
 *     collector number without leading zeros.
 *   - NOT supported per line or per URL: printing (normal/foil/reverse) and
 *     condition (NM/LP/…) — both are chosen in the Mass Entry page's own
 *     preferences panel after the list is parsed. We therefore never encode
 *     them; the ONLY real preferences are which variants count as "needed"
 *     (goal + optional finish filter below).
 *   - Long URLs 414 — the `c` payload is chunked (~1800 encoded chars) into an
 *     ordered list of URLs; opening each adds to the same cart.
 *
 * Missing-for-goal math mirrors rotom-mcp's set_progress (and therefore
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

const MASSENTRY_BASE = 'https://www.tcgplayer.com/massentry?productline=Pokemon&c=';
/** Max encoded chars for one URL's `c` payload — well under common 414 limits. */
const MAX_C_CHARS = 1800;

// ── TCGplayer set abbreviations ───────────────────────────────────────────────
// The catalog stores card_set.tcgplayer_group_id but not the group's
// abbreviation (the Mass Entry set-code vocabulary). TCGCSV's groups endpoint
// (already our price feed upstream) carries it; fetched lazily, cached
// in-process for 24h, 5-minute negative cache, and every failure degrades to
// bare-name lines rather than an error.
const ABBREV_TTL_MS = 24 * 60 * 60 * 1000;
const ABBREV_NEG_TTL_MS = 5 * 60 * 1000;
let abbrevCache: { at: number; ok: boolean; map: Map<number, string> } | null = null;
let abbrevInFlight: Promise<Map<number, string>> | null = null;

async function fetchAbbrevMap(): Promise<Map<number, string>> {
  const res = await fetch('https://tcgcsv.com/tcgplayer/3/groups', {
    // TCGCSV blocks generic/missing UAs — same identity apps/sync uses.
    headers: { 'User-Agent': 'pokedex/1.0 (+cheyras@gmail.com)', Accept: 'application/json' },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`tcgcsv groups → ${res.status}`);
  const body = (await res.json()) as { results?: Array<{ groupId?: number; abbreviation?: string | null }> };
  const map = new Map<number, string>();
  for (const g of body.results ?? []) {
    if (typeof g.groupId === 'number' && typeof g.abbreviation === 'string' && g.abbreviation) {
      map.set(g.groupId, g.abbreviation);
    }
  }
  if (map.size === 0) throw new Error('tcgcsv groups: empty abbreviation map');
  return map;
}

async function tcgplayerAbbrev(groupId: number | null): Promise<string | null> {
  if (groupId === null) return null;
  const now = Date.now();
  if (abbrevCache && now - abbrevCache.at < (abbrevCache.ok ? ABBREV_TTL_MS : ABBREV_NEG_TTL_MS)) {
    return abbrevCache.map.get(groupId) ?? null;
  }
  abbrevInFlight ??= fetchAbbrevMap()
    .then((map) => {
      abbrevCache = { at: Date.now(), ok: true, map };
      return map;
    })
    .catch((err: unknown) => {
      console.error('[pokedex-api] tcgcsv abbreviation fetch failed:', (err as Error).message);
      // Keep a stale successful map if we ever had one; else negative-cache.
      abbrevCache = abbrevCache?.ok ? { ...abbrevCache, at: Date.now() } : { at: Date.now(), ok: false, map: new Map() };
      return abbrevCache.map;
    })
    .finally(() => {
      abbrevInFlight = null;
    });
  const map = await abbrevInFlight;
  return map.get(groupId) ?? null;
}

// ── Line + URL builders ───────────────────────────────────────────────────────

/** Collector number as Mass Entry expects it: leading zeros stripped ("013" → "13"). */
function meNumber(localId: string): string {
  return /^\d+$/.test(localId) ? String(Number(localId)) : localId;
}

/** One Mass Entry line. A stored per-variant token wins (re-quantified); else composed. */
function meLine(qty: number, name: string, token: string | null, setCode: string | null, localId: string): string {
  if (token) return `${qty}${token.replace(/^\d+/, '')}`;
  if (setCode) return `${qty} ${name} [${setCode}] ${meNumber(localId)}`;
  return `${qty} ${name}`; // no set code available — matches any printing/set
}

/** Encode one line for the `c` param: URL-encoded, spaces as `+` (observed TCGplayer format). */
function encodeLine(line: string): string {
  return encodeURIComponent(line).replace(/%20/g, '+');
}

/** Chunk encoded lines into complete massentry URLs, each `c` ≤ MAX_C_CHARS. */
function buildUrls(lines: string[]): string[] {
  const SEP = '%7C%7C';
  const urls: string[] = [];
  let cur = '';
  for (const line of lines) {
    const enc = encodeLine(line);
    if (cur && cur.length + SEP.length + enc.length > MAX_C_CHARS) {
      urls.push(MASSENTRY_BASE + cur);
      cur = enc;
    } else {
      cur = cur ? cur + SEP + enc : enc;
    }
  }
  if (cur) urls.push(MASSENTRY_BASE + cur);
  return urls;
}

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
    const set = await q1<{ id: string; tcgdex_id: string; name: string; group_id: number | null }>(
      `SELECT cs.id, cs.tcgdex_id, cs.name, cs.tcgplayer_group_id AS group_id
         FROM card_set cs
         JOIN series ser ON ser.id = cs.series_id
        WHERE cs.tcgdex_id = $1
        ORDER BY (ser.catalogue_code = 'en') DESC
        LIMIT 1`,
      [String(req.params.setId)],
    );
    if (!set) throw notFound(`No set '${String(req.params.setId)}'`);
    const userId = await defaultUserId();

    const goal = oneOf<Goal>(req.query.goal, GOALS, 'complete');
    const rawFinishes = strList(req.query.finish).map((f) => f.toLowerCase());
    const unknown = rawFinishes.filter((f) => !(FINISHES as readonly string[]).includes(f));
    if (unknown.length) throw badRequest(`Unknown finish '${unknown[0]}' — expected one of: ${FINISHES.join(', ')}`);
    // A full selection is the same as no filter; normalize so responses agree.
    const finishes = rawFinishes.length && rawFinishes.length < FINISHES.length ? [...new Set(rawFinishes)] : null;

    // Missing rows for the goal — same derivation as rotom-mcp set_progress /
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

    const lines = [...byCard.values()].map((a) => meLine(a.qty, a.name, a.token, setCode, a.local_id));
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
      note:
        'Printing (normal/foil/reverse) and condition (NM/LP/…) cannot be preselected by link — ' +
        "choose them in the preferences panel on TCGplayer's Mass Entry page.",
    });
  }),
);
