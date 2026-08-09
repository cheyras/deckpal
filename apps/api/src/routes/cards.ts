import { Router } from 'express';
import { cardImages, q, q1, shapePrice, tcgplayerUrl, type PriceRow } from '../db.js';
import { asyncHandler, notFound, userCache } from '../http.js';

export const cardsRouter: Router = Router();

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
 * GET /deckscout/api/cards/:cardId — card detail.
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
    const userId = req.user!.id;

    const [variants, priceRows, attacks, abilities, matchups, types, subtypes, tags, species] = await Promise.all([
      q<VariantRow>(
        `SELECT cv.id, cv.variant_kind_code, cv.display_name, vk.display_name AS kind_display,
                cv.provenance, cv.sort_order, cv.is_primary, cv.is_synthesized, cv.source,
                cv.fill_confidence, t.tier, t.tier_source,
                cv.tcgplayer_url, cv.tcgplayer_product_id, cv.tcgplayer_printing,
                COALESCE(ci.quantity, 0) AS quantity
           FROM card_variant cv
           JOIN variant_kind vk ON vk.code = cv.variant_kind_code
           JOIN variant_tier_resolved t ON t.card_variant_id = cv.id
      LEFT JOIN collection_item ci ON ci.card_variant_id = cv.id AND ci.user_id = $2
          WHERE cv.card_id = $1
          ORDER BY cv.sort_order`,
        [cardId, userId],
      ),
      q<PriceRow & { card_variant_id: string }>(
        `SELECT pc.card_variant_id, pc.source_code, ps.label AS source_label, ps.marketplace,
                pc.currency_code, pc.market_minor, pc.low_minor, pc.mid_minor, pc.high_minor,
                pc.direct_low_minor, pc.trend_minor, pc.avg1_minor, pc.avg7_minor, pc.avg30_minor,
                pc.priced_at, pc.is_fallback
           FROM price_current pc
           JOIN card_variant cv ON cv.id = pc.card_variant_id
           JOIN price_source ps ON ps.code = pc.source_code
          WHERE cv.card_id = $1
          ORDER BY ps.priority, pc.currency_code`,
        [cardId],
      ),
      q(`SELECT ord, name, damage, effect, cost FROM card_attack WHERE card_id = $1 ORDER BY ord`, [cardId]),
      q(`SELECT ord, kind, name, effect FROM card_ability WHERE card_id = $1 ORDER BY ord`, [cardId]),
      q(`SELECT kind, ord, type, value FROM card_matchup WHERE card_id = $1 ORDER BY kind, ord`, [cardId]),
      q<{ slot: number; type: string }>(`SELECT slot, type FROM card_type WHERE card_id = $1 ORDER BY slot`, [cardId]),
      q<{ ord: number; subtype: string }>(`SELECT ord, subtype FROM card_subtype WHERE card_id = $1 ORDER BY ord`, [cardId]),
      q<{ ord: number; tag: string }>(`SELECT ord, tag FROM card_tag WHERE card_id = $1 ORDER BY ord`, [cardId]),
      q<{ id: number; identifier: string; name: string; generation: number; ord: number }>(
        `SELECT d.id, d.identifier, d.name, d.generation, csp.ord
           FROM card_species csp JOIN dex_species d ON d.id = csp.dex_id
          WHERE csp.card_id = $1 ORDER BY csp.ord`,
        [cardId],
      ),
    ]);

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
        quantity: Number(v.quantity), // owned quantity for the default user (0 if unowned)
        buyUrl: tcgplayerUrl(v.tcgplayer_url, v.tcgplayer_product_id, v.tcgplayer_printing),
        // Every price carries currency + priced_at; a missing price is null, never 0.
        prices: (pricesByVariant.get(v.id) ?? []).map(shapePrice),
      })),
    });
  }),
);
