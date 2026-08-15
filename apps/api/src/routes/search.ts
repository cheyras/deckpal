import { Router } from 'express';
import { cardImages, q, q1, toMajor } from '../db.js';
import { asyncHandler, badRequest, catalogCache, clampInt, oneOf, str, strList } from '../http.js';
import { raritySortSql } from '../rarity.js';

export const searchRouter: Router = Router();

const SORT_COLUMNS = {
  name: 'c.name',
  number: 'c.number_sort',
  price: 'price_minor',
  rarity: raritySortSql('c.rarity'),
  released: 'c.released_on',
} as const;
type SortKey = keyof typeof SORT_COLUMNS;

function integerList(v: unknown, param: string): number[] {
  if (v === undefined) return [];
  const values = Array.isArray(v) ? v : [v];
  return values.map((x) => {
    const n = Number(x);
    if (!Number.isFinite(n) || !Number.isInteger(n)) throw badRequest(`${param} must be an integer`);
    return n;
  });
}

function optionalInteger(v: unknown, param: string): number | undefined {
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n)) throw badRequest(`${param} must be an integer`);
  return n;
}

interface SearchRow {
  tcgdex_id: string;
  local_id: string;
  name: string;
  category: string;
  rarity: string | null;
  illustrator: string | null;
  hp: number | null;
  regulation_mark: string | null;
  released_on: string | null;
  serie: string;
  serie_slug: string;
  serie_name: string;
  setcode: string;
  set_name: string;
  variant_count: string;
  price_minor: number | null;
  price_currency: string | null;
  total_rows: string;
}

/**
 * GET /deckpal/api/search — the 12-filter advanced search + sorts.
 *
 * Filters (AND across fields, OR within a field / multi-value):
 *   cardType   (supertype: Pokemon|Trainer|Energy)   — repeatable
 *   energyType (Fire, Water, …)                       — repeatable
 *   subType    (Stage 1, ex, …)                       — repeatable  [vocab EMPTY in data]
 *   set        (set tcgdex_id, e.g. sv03.5)           — repeatable
 *   rarity                                            — repeatable
 *   weakness   (energy type)                          — repeatable
 *   resistance (energy type)                          — repeatable
 *   retreat    (integer)                              — repeatable
 *   hp         (integer, exact) + hpMin/hpMax (range)
 *   attack     (free text; matches attack name/effect)
 *   ability    (free text; matches ability name/effect)
 *   artist                                            — repeatable
 *   q          (free text: card name or number)
 * Sorts: sort=name|number|price|rarity|released, dir=asc|desc. Pagination: page,pageSize.
 * Pass ?facets=1 to also receive the available filter vocabularies (see gaps).
 */
searchRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const sort = oneOf<SortKey>(req.query.sort, Object.keys(SORT_COLUMNS) as SortKey[], 'name');
    const dir = oneOf(req.query.dir, ['asc', 'desc'] as const, 'asc');
    const pageSize = clampInt(req.query.pageSize, 60, 1, 250);
    const page = clampInt(req.query.page, 1, 1, 100000);
    const offset = (page - 1) * pageSize;

    const cardType = strList(req.query.cardType);
    const energyType = strList(req.query.energyType);
    const subType = strList(req.query.subType);
    const set = strList(req.query.set);
    const rarity = strList(req.query.rarity);
    const weakness = strList(req.query.weakness);
    const resistance = strList(req.query.resistance);
    const retreat = integerList(req.query.retreat, 'retreat');
    const hp = integerList(req.query.hp, 'hp');
    const hpMin = optionalInteger(req.query.hpMin, 'hpMin');
    const hpMax = optionalInteger(req.query.hpMax, 'hpMax');
    const attack = str(req.query.attack);
    const ability = str(req.query.ability);
    const artist = strList(req.query.artist);
    const search = str(req.query.q);

    const params: unknown[] = [];
    const where: string[] = ['true'];
    const p = (v: unknown): string => {
      params.push(v);
      return `$${params.length}`;
    };
    if (cardType.length) where.push(`c.category = ANY(${p(cardType)})`);
    if (energyType.length) where.push(`EXISTS (SELECT 1 FROM card_type ct WHERE ct.card_id = c.id AND ct.type = ANY(${p(energyType)}))`);
    if (subType.length) where.push(`EXISTS (SELECT 1 FROM card_subtype st WHERE st.card_id = c.id AND st.subtype = ANY(${p(subType)}))`);
    if (set.length) where.push(`cs.tcgdex_id = ANY(${p(set)})`);
    if (rarity.length) where.push(`c.rarity = ANY(${p(rarity)})`);
    if (weakness.length) where.push(`EXISTS (SELECT 1 FROM card_matchup m WHERE m.card_id = c.id AND m.kind = 'weakness' AND m.type = ANY(${p(weakness)}))`);
    if (resistance.length) where.push(`EXISTS (SELECT 1 FROM card_matchup m WHERE m.card_id = c.id AND m.kind = 'resistance' AND m.type = ANY(${p(resistance)}))`);
    if (retreat.length) where.push(`c.retreat = ANY(${p(retreat)}::int[])`);
    if (hp.length) where.push(`c.hp = ANY(${p(hp)}::int[])`);
    if (hpMin !== undefined) where.push(`c.hp >= ${p(hpMin)}`);
    if (hpMax !== undefined) where.push(`c.hp <= ${p(hpMax)}`);
    if (attack) where.push(`EXISTS (SELECT 1 FROM card_attack a WHERE a.card_id = c.id AND (a.name ILIKE ${p(`%${attack}%`)} OR a.effect ILIKE $${params.length}))`);
    if (ability) where.push(`EXISTS (SELECT 1 FROM card_ability ab WHERE ab.card_id = c.id AND (ab.name ILIKE ${p(`%${ability}%`)} OR ab.effect ILIKE $${params.length}))`);
    if (artist.length) where.push(`c.illustrator = ANY(${p(artist)})`);
    // Accent-insensitive name match: unaccent() folds diacritics on both sides
    // so "Poke" matches "Pokémon" (é ↔ e). local_id/number_sort are ASCII.
    if (search) where.push(`(unaccent(c.name) ILIKE unaccent(${p(`%${search}%`)}) OR c.local_id ILIKE $${params.length} OR c.number_sort ILIKE $${params.length})`);

    const orderSql = `ORDER BY ${SORT_COLUMNS[sort]} ${dir === 'desc' ? 'DESC' : 'ASC'} NULLS LAST, c.number_sort ASC`;
    const limitIdx = p(pageSize);
    const offsetIdx = p(offset);

    const rows = await q<SearchRow>(
      `SELECT c.tcgdex_id, c.local_id, c.name, c.category, c.rarity, c.illustrator, c.hp, c.regulation_mark, c.released_on,
              ser.tcgdex_id AS serie, ser.slug AS serie_slug, ser.name AS serie_name,
              cs.tcgdex_id AS setcode, cs.name AS set_name,
              vc.variant_count, price.market_minor AS price_minor, price.currency_code AS price_currency,
              count(*) OVER() AS total_rows
         FROM card c
         JOIN card_set cs ON cs.id = c.set_id
         JOIN series ser ON ser.id = cs.series_id
    LEFT JOIN LATERAL (SELECT count(*) AS variant_count FROM card_variant cv2 WHERE cv2.card_id = c.id) vc ON true
    LEFT JOIN LATERAL (
                SELECT pc.market_minor, pc.currency_code
                  FROM card_variant cvp
                  JOIN price_current pc ON pc.card_variant_id = cvp.id
                   AND pc.source_code = 'tcgcsv' AND pc.currency_code = 'USD'
                 WHERE cvp.card_id = c.id AND cvp.is_primary LIMIT 1
              ) price ON true
        WHERE ${where.join(' AND ')}
        ${orderSql}
        LIMIT ${limitIdx} OFFSET ${offsetIdx}`,
      params,
    );

    const totalRows = rows.length ? Number(rows[0]!.total_rows) : 0;
    catalogCache(res, 120);

    let facets: Record<string, unknown> | undefined;
    if (str(req.query.facets) === '1') facets = await loadFacets();

    res.json({
      query: {
        cardType, energyType, subType, set, rarity, weakness, resistance, retreat, hp,
        hpMin: hpMin ?? null, hpMax: hpMax ?? null, attack: attack ?? null, ability: ability ?? null,
        artist, q: search ?? null, sort, dir, page, pageSize,
      },
      pagination: { page, pageSize, total: totalRows, pageCount: Math.ceil(totalRows / pageSize) },
      cards: rows.map((r) => ({
        cardId: r.tcgdex_id,
        number: r.local_id,
        name: r.name,
        category: r.category,
        rarity: r.rarity,
        artist: r.illustrator,
        hp: r.hp,
        regulationMark: r.regulation_mark,
        set: { setId: r.setcode, name: r.set_name },
        // Routing needs the series SLUG (/series/mega-evolution/me05), not the
        // tcgdex_id ("me") that cardImages() keys the cache path on.
        series: { slug: r.serie_slug, name: r.serie_name },
        releasedOn: r.released_on,
        variantCount: Number(r.variant_count),
        images: cardImages(r.serie, r.setcode, r.local_id),
        price: r.price_minor !== null ? { market: toMajor(r.price_minor, r.price_currency ?? 'USD'), currency: (r.price_currency ?? 'USD').trim() } : null,
      })),
      ...(facets ? { facets } : {}),
    });
  }),
);

/**
 * The available filter vocabularies. Some are genuinely empty in the imported
 * data (subTypes, tags were not imported) — reported as empty arrays, never
 * fabricated. `populated: false` flags the gaps.
 *
 * These ten result sets used to be a Promise.all of ten q() calls. Like the
 * cards.ts nine-query fix, in SUPABASE_MODE they serialised on one PoolClient
 * — ten sequential round trips pretending to be parallel, with the concurrent
 * dispatch risking pool-wedging under real traffic. Folded into one statement
 * of independent scalar subqueries: same sub-plans, one round trip instead of
 * ten.
 */
async function loadFacets(): Promise<Record<string, unknown>> {
  const bundle = await q1<{
    card_type: { v: string; n: string }[];
    energy_type: { v: string; n: string }[];
    sub_type: { v: string; n: string }[];
    sets: { v: string; label: string }[];
    rarity: { v: string; n: string }[];
    weakness: { v: string; n: string }[];
    resistance: { v: string; n: string }[];
    retreat: { v: number }[];
    hp_range: { min: number; max: number }[];
    artist: { v: string; n: string }[];
  }>(
    `SELECT
       COALESCE((SELECT json_agg(r) FROM (
         SELECT category AS v, count(*)::text AS n
           FROM card GROUP BY category ORDER BY count(*) DESC
       ) r), '[]'::json) AS card_type,
       COALESCE((SELECT json_agg(r) FROM (
         SELECT type AS v, count(*)::text AS n
           FROM card_type GROUP BY type ORDER BY count(*) DESC
       ) r), '[]'::json) AS energy_type,
       COALESCE((SELECT json_agg(r) FROM (
         SELECT subtype AS v, count(*)::text AS n
           FROM card_subtype GROUP BY subtype ORDER BY count(*) DESC
       ) r), '[]'::json) AS sub_type,
       COALESCE((SELECT json_agg(r) FROM (
         SELECT cs.tcgdex_id AS v, cs.name AS label
           FROM card_set cs
           JOIN series s ON s.id = cs.series_id
           JOIN catalogue cat ON cat.code = s.catalogue_code AND cat.is_enabled
          ORDER BY cs.released_on DESC NULLS LAST
       ) r), '[]'::json) AS sets,
       COALESCE((SELECT json_agg(r) FROM (
         SELECT rarity AS v, count(*)::text AS n
           FROM card WHERE rarity IS NOT NULL GROUP BY rarity ORDER BY count(*) DESC
       ) r), '[]'::json) AS rarity,
       COALESCE((SELECT json_agg(r) FROM (
         SELECT type AS v, count(*)::text AS n
           FROM card_matchup WHERE kind = 'weakness' GROUP BY type ORDER BY count(*) DESC
       ) r), '[]'::json) AS weakness,
       COALESCE((SELECT json_agg(r) FROM (
         SELECT type AS v, count(*)::text AS n
           FROM card_matchup WHERE kind = 'resistance' GROUP BY type ORDER BY count(*) DESC
       ) r), '[]'::json) AS resistance,
       COALESCE((SELECT json_agg(r) FROM (
         SELECT DISTINCT retreat AS v FROM card WHERE retreat IS NOT NULL ORDER BY 1
       ) r), '[]'::json) AS retreat,
       COALESCE((SELECT json_agg(r) FROM (
         SELECT min(hp) AS min, max(hp) AS max FROM card WHERE hp IS NOT NULL
       ) r), '[]'::json) AS hp_range,
       COALESCE((SELECT json_agg(r) FROM (
         SELECT illustrator AS v, count(*)::text AS n
           FROM card WHERE illustrator IS NOT NULL
          GROUP BY illustrator ORDER BY count(*) DESC
       ) r), '[]'::json) AS artist`,
  );

  const cardType = bundle?.card_type ?? [];
  const energyType = bundle?.energy_type ?? [];
  const subType = bundle?.sub_type ?? [];
  const sets = bundle?.sets ?? [];
  const rarityList = bundle?.rarity ?? [];
  const weaknessList = bundle?.weakness ?? [];
  const resistanceList = bundle?.resistance ?? [];
  const retreatList = bundle?.retreat ?? [];
  const hpRange = bundle?.hp_range ?? [];
  const artistList = bundle?.artist ?? [];

  const facet = (label: string, values: { v: string; n?: string; label?: string }[]) => ({
    label,
    populated: values.length > 0,
    values: values.map((r) => ({ value: r.v, label: r.label ?? r.v, count: r.n ? Number(r.n) : undefined })),
  });
  return {
    cardType: facet('Card Type', cardType),
    energyType: facet('Energy Type', energyType),
    subType: facet('Sub-Type', subType), // EMPTY in data
    set: facet('Set', sets),
    rarity: facet('Rarity', rarityList),
    weakness: facet('Weakness', weaknessList),
    resistance: facet('Resistance', resistanceList),
    retreat: { label: 'Retreat Cost', populated: retreatList.length > 0, values: retreatList.map((r) => ({ value: r.v })) },
    hitPoints: { label: 'Hit Points', populated: !!hpRange[0]?.max, range: hpRange[0] ?? null },
    attack: { label: 'Attack Search', populated: true, freeText: true },
    ability: { label: 'Ability Search', populated: true, freeText: true },
    artist: facet('Artist', artistList),
  };
}
