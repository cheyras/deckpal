/**
 * National Pokédex completion, per-generation breakdown, and per-species capture
 * / level / shiny state.
 *
 * Capture model (wiki: Dex-Data §A.3, §D.2; pkmn.gg source captures):
 *   • A species is CAPTURED when you own ≥1 card that (a) features it via
 *     card_species AND (b) has card.category = 'Pokemon'. The category gate is
 *     non-negotiable: a Trainer such as "Tropical Tidal Wave" carries dexIds
 *     [25,183,54,187] and would otherwise silently capture four species.
 *     (In the live catalog the importer already gates card_species population on
 *     category='Pokemon', so this is defence-in-depth — but the rule is enforced
 *     here too so the function is correct against ANY input, incl. the test
 *     fixtures.)
 *   • Card→species is many-to-many; a tag-team card captures every species in its
 *     dexId array. We never use dexId[0] as "the" species.
 *   • quantity must be > 0 — a "Need" row (qty 0) does not capture.
 *
 * The species dex is 1025 species (DEX-DATA §B). Per-species "level" reuses the
 * authenticated set-LVL ladder over that species' own card pool. Pure counting
 * lives up top; DB adapters below.
 */
import { q, q1, cardImages, toMajor } from '../db.js';
import { setLevelFromCounts, setLevelLabel } from './trainerLevel.js';

export const NATIONAL_DEX_SIZE = 1025;

/**
 * ── ASSUMPTION (shiny) — FLAGGED, one-line switch ───────────────────────────
 * pkmn.gg captures §21 item 12 states the Pokédex shiny threshold was NEVER
 * observed (no signed-in Pokédex screen exists in the 37 captures). DEX-DATA
 * §D.2 offers only a breadth-based shape, `GREATEST(unique - 1, 0)`, and leaves
 * the exact rule to "the rule layer". We therefore implement the DOCUMENTED
 * breadth model and no invented bands:
 *   shinyBreadth = max(uniqueCardsOfSpecies - 1, 0)   (distinct cards beyond the first)
 *   isShiny      = uniqueCardsOfSpecies >= SHINY_UNIQUE_THRESHOLD
 * Default threshold = 2 (own ≥2 DISTINCT cards of the species). This is a guess
 * on the boundary only; flip the constant if a future capture pins it.
 */
export const SHINY_UNIQUE_THRESHOLD = 2;

/** Distinct cards of a species owned beyond the first (breadth). */
export function shinyBreadth(uniqueCardsOfSpecies: number): number {
  return Math.max((uniqueCardsOfSpecies || 0) - 1, 0);
}

/** Whether a species reads as "shiny" under the documented breadth model. */
export function isShiny(uniqueCardsOfSpecies: number): boolean {
  return (uniqueCardsOfSpecies || 0) >= SHINY_UNIQUE_THRESHOLD;
}

/** Per-species level: the set-LVL ladder over this species' own card pool. */
export function speciesLevel(uniqueOwned: number, cardPool: number): number {
  return setLevelFromCounts(uniqueOwned, cardPool);
}

// ── Pure capture counting (the category='Pokemon' gate lives here) ─────────────

export interface OwnedCardForCapture {
  category: string;
  quantity: number;
  dexIds: number[];
}

/** True iff this owned card contributes to capture: Pokémon-category, qty>0, has species. */
export function capturesSpecies(card: OwnedCardForCapture): boolean {
  return card.category === 'Pokemon' && card.quantity > 0 && card.dexIds.length > 0;
}

/** The set of captured species ids from a list of owned cards, gate applied. */
export function capturedSpeciesSet(cards: readonly OwnedCardForCapture[]): Set<number> {
  const s = new Set<number>();
  for (const c of cards) {
    if (!capturesSpecies(c)) continue;
    for (const id of c.dexIds) s.add(id);
  }
  return s;
}

/** Count of captured species (convenience over capturedSpeciesSet). */
export function countCapturedSpecies(cards: readonly OwnedCardForCapture[]): number {
  return capturedSpeciesSet(cards).size;
}

// ── DB adapters ────────────────────────────────────────────────────────────────

export interface DexCompletion {
  captured: number;
  total: number;
  pct: number;
  byGeneration: { generation: number; captured: number; total: number; pct: number }[];
}

/**
 * National Dex completion + per-generation breakdown, computed live with the
 * category='Pokemon' gate. `total` is COUNT(dex_species); `captured` is distinct
 * species featured on any owned Pokémon card (qty>0).
 */
export async function dexCompletion(userId: string): Promise<DexCompletion> {
  const rows = await q<{ generation: number; total: string; captured: string }>(
    `WITH captured AS (
       SELECT DISTINCT cs.dex_id
         FROM collection_item ci
         JOIN card_variant cv ON cv.id = ci.card_variant_id
         JOIN card c ON c.id = cv.card_id
         JOIN card_species cs ON cs.card_id = c.id
        WHERE ci.user_id = $1 AND ci.quantity > 0 AND c.category = 'Pokemon'
     )
     SELECT d.generation,
            count(*)                                   AS total,
            count(*) FILTER (WHERE cap.dex_id IS NOT NULL) AS captured
       FROM dex_species d
  LEFT JOIN captured cap ON cap.dex_id = d.id
      GROUP BY d.generation
      ORDER BY d.generation`,
    [userId],
  );
  const round1 = (o: number, t: number): number => (o && t ? Math.round((o / t) * 1000) / 10 : 0);
  let capturedTotal = 0;
  let total = 0;
  const byGeneration = rows.map((r) => {
    const captured = Number(r.captured);
    const genTotal = Number(r.total);
    capturedTotal += captured;
    total += genTotal;
    return { generation: r.generation, captured, total: genTotal, pct: round1(captured, genTotal) };
  });
  return { captured: capturedTotal, total, pct: round1(capturedTotal, total), byGeneration };
}

/**
 * A species row. Everything from `uniqueOwned` down is the CALLER's state, and
 * every one of those keys is optional because the Pokédex is browsable
 * signed-out: an anonymous read omits them rather than sending a zero, which
 * would be a claim about a collector who isn't there. See `optionalUserId` in
 * identity.ts for the seam.
 */
export interface SpeciesGridRow {
  speciesId: number;
  slug: string;
  name: string;
  genus: string | null;
  generation: number;
  types: string[];
  cardPool: number;
  uniqueOwned?: number;
  captured?: boolean;
  level?: number;
  levelLabel?: string;
  shiny?: boolean;
  shinyBreadth?: number;
  sprite: { pixel: string; pixelShiny: string; art: string; artShiny: string };
}

export interface SpeciesGrid {
  /** Your dex completion. Absent for an anonymous read. */
  completion?: { captured: number; total: number };
  pagination: { page: number; pageSize: number; total: number; pageCount: number };
  species: SpeciesGridRow[];
}

/**
 * The species grid, with live capture state, per-species owned-card breadth,
 * level and shiny. `own` filters to captured/uncaptured; `generation` to one gen.
 */
export async function speciesGrid(
  userId: string | null,
  opts: { generation?: number; own?: 'all' | 'captured' | 'uncaptured'; search?: string; page: number; pageSize: number },
): Promise<SpeciesGrid> {
  // An anonymous caller has no capture state to filter on, so the facet
  // collapses to 'all' rather than returning every species or none.
  const own = userId === null ? 'all' : opts.own ?? 'all';
  const offset = (opts.page - 1) * opts.pageSize;
  const params: unknown[] = [userId];
  const where: string[] = ['true'];
  const p = (v: unknown): string => {
    params.push(v);
    return `$${params.length}`;
  };
  if (opts.generation && Number.isFinite(opts.generation)) where.push(`d.generation = ${p(opts.generation)}`);
  if (opts.search) where.push(`(d.name ILIKE ${p(`%${opts.search}%`)} OR d.identifier ILIKE $${params.length})`);
  if (own === 'captured') where.push('owned.unique_owned > 0');
  if (own === 'uncaptured') where.push('COALESCE(owned.unique_owned, 0) = 0');
  const limitIdx = p(opts.pageSize);
  const offsetIdx = p(offset);

  const rows = await q<{
    id: number; identifier: string; name: string; genus: string | null; generation: number;
    types: string[] | null; card_pool: string; unique_owned: string | null; total_rows: string;
  }>(
    `SELECT d.id, d.identifier, d.name, d.genus, d.generation,
            (SELECT array_agg(t.type ORDER BY t.slot) FROM dex_species_type t WHERE t.dex_id = d.id) AS types,
            (SELECT count(*) FROM card_species csx WHERE csx.dex_id = d.id) AS card_pool,
            owned.unique_owned,
            count(*) OVER() AS total_rows
       FROM dex_species d
  LEFT JOIN LATERAL (
         SELECT count(DISTINCT c.id) AS unique_owned
           FROM card_species cs
           JOIN card c ON c.id = cs.card_id AND c.category = 'Pokemon'
           JOIN card_variant cv ON cv.card_id = c.id
           JOIN collection_item ci ON ci.card_variant_id = cv.id AND ci.user_id = $1 AND ci.quantity > 0
          WHERE cs.dex_id = d.id
       ) owned ON true
      WHERE ${where.join(' AND ')}
      ORDER BY d.dex_order
      LIMIT ${limitIdx} OFFSET ${offsetIdx}`,
    params,
  );

  const capturedTotal = userId === null ? null : await dexCapturedCount(userId);
  const totalRows = rows.length ? Number(rows[0]!.total_rows) : 0;
  return {
    ...(capturedTotal === null ? {} : { completion: { captured: capturedTotal, total: NATIONAL_DEX_SIZE } }),
    pagination: { page: opts.page, pageSize: opts.pageSize, total: totalRows, pageCount: Math.ceil(totalRows / opts.pageSize) },
    species: rows.map((r) => shapeGridRow(r, userId !== null)),
  };
}

function shapeGridRow(
  r: {
    id: number; identifier: string; name: string; genus: string | null; generation: number;
    types: string[] | null; card_pool: string; unique_owned: string | null;
  },
  /** False for an anonymous read — the capture block is left off entirely. */
  withOwnership: boolean,
): SpeciesGridRow {
  const pool = Number(r.card_pool);
  const uniqueOwned = Number(r.unique_owned ?? 0);
  const level = speciesLevel(uniqueOwned, pool);
  return {
    speciesId: r.id,
    slug: r.identifier,
    name: r.name,
    genus: r.genus,
    generation: r.generation,
    types: r.types ?? [],
    cardPool: pool,
    ...(withOwnership
      ? {
          uniqueOwned,
          captured: uniqueOwned > 0,
          level,
          levelLabel: setLevelLabel(level),
          shiny: isShiny(uniqueOwned),
          shinyBreadth: shinyBreadth(uniqueOwned),
        }
      : {}),
    sprite: speciesSprite(r.id),
  };
}

/** Distinct captured species, live, gated — the headline number. */
export async function dexCapturedCount(userId: string): Promise<number> {
  const row = await q1<{ n: string }>(
    `SELECT count(DISTINCT cs.dex_id) AS n
       FROM collection_item ci
       JOIN card_variant cv ON cv.id = ci.card_variant_id
       JOIN card c ON c.id = cv.card_id
       JOIN card_species cs ON cs.card_id = c.id
      WHERE ci.user_id = $1 AND ci.quantity > 0 AND c.category = 'Pokemon'`,
    [userId],
  );
  return Number(row?.n ?? 0);
}

/** Sprite paths are a pure function of dex id (DEX-DATA §B.2, §D.1). */
export function speciesSprite(dexId: number): SpeciesGridRow['sprite'] {
  const base = '/deckscout/images/sprites';
  return {
    pixel: `${base}/pixel/${dexId}.png`,
    pixelShiny: `${base}/pixel/shiny/${dexId}.png`,
    art: `${base}/art/${dexId}.png`,
    artShiny: `${base}/art/shiny/${dexId}.png`,
  };
}

export interface SpeciesDetail {
  species: {
    speciesId: number; slug: string; name: string; genus: string | null; generation: number;
    types: string[]; cardPool: number; uniqueOwned?: number; captured?: boolean;
    level?: number; levelLabel?: string; shiny?: boolean; shinyBreadth?: number;
    sprite: SpeciesGridRow['sprite'];
  };
  cards: Array<{
    cardId: string; number: string; name: string; category: string; rarity: string | null;
    artist: string | null; set: { setId: string; name: string };
    variantCount: number; owned?: boolean; ownedQuantity?: number;
    images: { low: string; high: string };
    price: { market: number | null; currency: string } | null;
  }>;
}

/** One species (by numeric id or slug) with every card featuring it + capture/level. */
export async function speciesDetail(userId: string | null, raw: string): Promise<SpeciesDetail | null> {
  const numeric = Number.parseInt(raw, 10);
  const species = await q1<{
    id: number; identifier: string; name: string; genus: string | null; generation: number;
    types: string[] | null; card_pool: string; unique_owned: string | null;
  }>(
    `SELECT d.id, d.identifier, d.name, d.genus, d.generation,
            (SELECT array_agg(t.type ORDER BY t.slot) FROM dex_species_type t WHERE t.dex_id = d.id) AS types,
            (SELECT count(*) FROM card_species csx WHERE csx.dex_id = d.id) AS card_pool,
            (SELECT count(DISTINCT c.id)
               FROM card_species cs
               JOIN card c ON c.id = cs.card_id AND c.category = 'Pokemon'
               JOIN card_variant cv ON cv.card_id = c.id
               JOIN collection_item ci ON ci.card_variant_id = cv.id AND ci.user_id = $2 AND ci.quantity > 0
              WHERE cs.dex_id = d.id) AS unique_owned
       FROM dex_species d
      WHERE d.id = $1 OR d.identifier = $3`,
    [Number.isFinite(numeric) ? numeric : -1, userId, raw],
  );
  if (!species) return null;

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
                AND pc.source_code = 'tcgcsv' AND pc.currency_code = 'USD'
              WHERE cvp.card_id = c.id AND cvp.is_primary LIMIT 1
           ) price ON true
      WHERE csp.dex_id = $1
      ORDER BY c.number_sort ASC`,
    [species.id, userId],
  );

  const pool = Number(species.card_pool);
  const uniqueOwned = Number(species.unique_owned ?? 0);
  const level = speciesLevel(uniqueOwned, pool);
  return {
    species: {
      speciesId: species.id,
      slug: species.identifier,
      name: species.name,
      genus: species.genus,
      generation: species.generation,
      types: species.types ?? [],
      cardPool: pool,
      ...(userId === null
        ? {}
        : {
            uniqueOwned,
            captured: uniqueOwned > 0,
            level,
            levelLabel: setLevelLabel(level),
            shiny: isShiny(uniqueOwned),
            shinyBreadth: shinyBreadth(uniqueOwned),
          }),
      sprite: speciesSprite(species.id),
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
      ...(userId === null ? {} : { owned: Number(c.owned_qty) > 0, ownedQuantity: Number(c.owned_qty) }),
      images: cardImages(c.serie, c.setcode, c.local_id),
      price:
        c.price_minor !== null
          ? { market: toMajor(c.price_minor, c.price_currency ?? 'USD'), currency: (c.price_currency ?? 'USD').trim() }
          : null,
    })),
  };
}
