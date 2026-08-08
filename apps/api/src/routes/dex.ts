import { Router } from 'express';
import { cardImages, defaultUserId, q, q1, toMajor } from '../db.js';
import { asyncHandler, clampInt, notFound, oneOf, str, userCache } from '../http.js';
import { raritySortSql } from '../rarity.js';

export const dexRouter: Router = Router();

const CARD_SORT = {
  number: 'c.number_sort',
  price: 'price_minor',
  rarity: raritySortSql('c.rarity'),
  artist: 'c.illustrator',
  released: 'c.released_on',
} as const;
type CardSort = keyof typeof CARD_SORT;

interface SpeciesRow {
  id: number;
  identifier: string;
  name: string;
  genus: string | null;
  generation: number;
  total_card_count: string;
  captured: boolean;
  types: string[] | null;
  total_rows: string;
}

/**
 * GET /deckscout/api/dex — the national-dex species list.
 * Query: generation=1..9, own=all|captured|uncaptured, q, page, pageSize.
 * Capture state is the default user's (own ≥1 card featuring the species).
 */
dexRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const userId = await defaultUserId();
    const generation = str(req.query.generation);
    const own = oneOf(req.query.own, ['all', 'captured', 'uncaptured'] as const, 'all');
    const search = str(req.query.q);
    const pageSize = clampInt(req.query.pageSize, 200, 1, 1025);
    const page = clampInt(req.query.page, 1, 1, 100000);
    const offset = (page - 1) * pageSize;

    const params: unknown[] = [userId];
    const where: string[] = ['true'];
    const p = (v: unknown): string => {
      params.push(v);
      return `$${params.length}`;
    };
    if (generation && Number.isFinite(Number(generation))) where.push(`d.generation = ${p(Number(generation))}`);
    if (own === 'captured') where.push('uds.dex_id IS NOT NULL');
    if (own === 'uncaptured') where.push('uds.dex_id IS NULL');
    if (search) where.push(`(d.name ILIKE ${p(`%${search}%`)} OR d.identifier ILIKE $${params.length})`);
    const limitIdx = p(pageSize);
    const offsetIdx = p(offset);

    const rows = await q<SpeciesRow>(
      // dex_species.total_card_count is unpopulated (0 everywhere) in the current
      // import, so count featured cards live from card_species instead.
      `SELECT d.id, d.identifier, d.name, d.genus, d.generation,
              (SELECT count(*) FROM card_species csx WHERE csx.dex_id = d.id) AS total_card_count,
              (uds.dex_id IS NOT NULL) AS captured,
              (SELECT array_agg(t.type ORDER BY t.slot) FROM dex_species_type t WHERE t.dex_id = d.id) AS types,
              count(*) OVER() AS total_rows
         FROM dex_species d
    LEFT JOIN user_dex_state uds ON uds.dex_id = d.id AND uds.user_id = $1
        WHERE ${where.join(' AND ')}
        ORDER BY d.dex_order
        LIMIT ${limitIdx} OFFSET ${offsetIdx}`,
      params,
    );

    const capturedTotal = await q1<{ n: string }>(`SELECT count(*) AS n FROM user_dex_state WHERE user_id = $1`, [userId]);
    const speciesTotal = await q1<{ n: string }>(`SELECT count(*) AS n FROM dex_species`);
    const totalRows = rows.length ? Number(rows[0]!.total_rows) : 0;

    userCache(res);
    res.json({
      completion: { captured: Number(capturedTotal?.n ?? 0), total: Number(speciesTotal?.n ?? 0) },
      pagination: { page, pageSize, total: totalRows, pageCount: Math.ceil(totalRows / pageSize) },
      species: rows.map((r) => ({
        speciesId: r.id,
        slug: r.identifier,
        name: r.name,
        genus: r.genus,
        generation: r.generation,
        totalCardCount: Number(r.total_card_count),
        types: r.types ?? [],
        captured: r.captured,
      })),
    });
  }),
);

/**
 * GET /deckscout/api/dex/:speciesId — a species and every card featuring it.
 * :speciesId accepts the numeric dex id or the identifier slug (e.g. 6 or
 * 'charizard'). Card→species is many-to-many, so tag-team cards appear here too.
 */
dexRouter.get(
  '/:speciesId',
  asyncHandler(async (req, res) => {
    const userId = await defaultUserId();
    const raw = String(req.params.speciesId ?? '');
    const numeric = Number.parseInt(raw, 10);
    const species = await q1<{ id: number; identifier: string; name: string; genus: string | null; generation: number; total_card_count: string; captured: boolean; types: string[] | null }>(
      `SELECT d.id, d.identifier, d.name, d.genus, d.generation,
              (SELECT count(*) FROM card_species csx WHERE csx.dex_id = d.id) AS total_card_count,
              EXISTS (SELECT 1 FROM user_dex_state uds WHERE uds.dex_id = d.id AND uds.user_id = $2) AS captured,
              (SELECT array_agg(t.type ORDER BY t.slot) FROM dex_species_type t WHERE t.dex_id = d.id) AS types
         FROM dex_species d
        WHERE d.id = $1 OR d.identifier = $3`,
      [Number.isFinite(numeric) ? numeric : -1, userId, raw],
    );
    if (!species) throw notFound(`No species '${raw}'`);

    const sort = oneOf<CardSort>(req.query.sort, Object.keys(CARD_SORT) as CardSort[], 'number');
    const dir = oneOf(req.query.dir, ['asc', 'desc'] as const, 'asc');
    const orderSql = `ORDER BY ${CARD_SORT[sort]} ${dir === 'desc' ? 'DESC' : 'ASC'} NULLS LAST, c.number_sort ASC`;

    const cards = await q<{
      tcgdex_id: string; local_id: string; name: string; category: string; rarity: string | null;
      illustrator: string | null; serie: string; setcode: string; set_name: string;
      variant_count: string; owned_qty: string; price_minor: number | null; price_currency: string | null;
    }>(
      `SELECT c.tcgdex_id, c.local_id, c.name, c.category, c.rarity, c.illustrator,
              ser.tcgdex_id AS serie, cs.tcgdex_id AS setcode, cs.name AS set_name,
              (SELECT count(*) FROM card_variant cv2 WHERE cv2.card_id = c.id) AS variant_count,
              COALESCE((SELECT sum(ci.quantity) FROM collection_item ci
                          JOIN card_variant cv3 ON cv3.id = ci.card_variant_id
                         WHERE cv3.card_id = c.id AND ci.user_id = $2), 0) AS owned_qty,
              price.market_minor AS price_minor, price.currency_code AS price_currency
         FROM card_species csp
         JOIN card c ON c.id = csp.card_id
         JOIN card_set cs ON cs.id = c.set_id
         JOIN series ser ON ser.id = cs.series_id
    LEFT JOIN LATERAL (
                SELECT pc.market_minor, pc.currency_code FROM card_variant cvp
                  JOIN price_current pc ON pc.card_variant_id = cvp.id
                   AND pc.source_code='tcgcsv' AND pc.currency_code='USD'
                 WHERE cvp.card_id = c.id AND cvp.is_primary LIMIT 1
              ) price ON true
        WHERE csp.dex_id = $1
        ${orderSql}`,
      [species.id, userId],
    );

    userCache(res);
    res.json({
      species: {
        speciesId: species.id,
        slug: species.identifier,
        name: species.name,
        genus: species.genus,
        generation: species.generation,
        types: species.types ?? [],
        totalCardCount: Number(species.total_card_count),
        captured: species.captured,
      },
      cards: cards.map((c) => ({
        cardId: c.tcgdex_id,
        number: c.local_id,
        name: c.name,
        category: c.category,
        rarity: c.rarity,
        artist: c.illustrator,
        set: { setId: c.setcode, name: c.set_name },
        variantCount: Number(c.variant_count),
        owned: Number(c.owned_qty) > 0,
        ownedQuantity: Number(c.owned_qty),
        images: cardImages(c.serie, c.setcode, c.local_id),
        price: c.price_minor !== null ? { market: toMajor(c.price_minor, c.price_currency ?? 'USD'), currency: (c.price_currency ?? 'USD').trim() } : null,
      })),
    });
  }),
);
