import type { Queryable } from '@deckpal/db';
import { buildReprintOracle, loadFactsByIds } from './db.js';
import { cardLegality } from './cardLegality.js';
import { formatConfig } from './data.js';
import { ptcglCodeForSet } from './export.js';
import { canSatisfyByEquivalentPrint } from './identicalPrints.js';
import type { FormatCode } from './types.js';

export interface OwnedSlot {
  cardId: number;
  variantId: number;
  variantKind: string;
  quantity: number;
  group: string | null;
  basicEnergyType: string | null;
  isPromo: boolean;
  isStamped: boolean;
  pinExact: boolean;
}

export interface OwnedCandidate {
  card_id: string;
  variant_id: string;
  variant_kind_code: string;
  quantity: string;
  identical_print_group: string | null;
  is_promo: boolean;
  is_stamped: boolean;
  energy_type: string | null;
  set_id: string;
  local_id: string;
}

export interface OwnedSource {
  setCode: string;
  number: string;
  quantity: number;
}

export interface OwnedAllocation {
  owned: number;
  ownedAs: OwnedSource[];
}

/** Exact copies are reserved first, then each remaining copy can satisfy one slot. */
export function allocateOwnedPrints(
  slots: OwnedSlot[], candidates: OwnedCandidate[], legalCardIds: Set<number>,
): Map<number, OwnedAllocation> {
  const remaining = new Map(candidates.map((c) => [Number(c.variant_id), Number(c.quantity)]));
  const result = new Map<number, OwnedAllocation>();
  for (const slot of slots) {
    const exact = Math.min(slot.quantity, remaining.get(slot.variantId) ?? 0);
    remaining.set(slot.variantId, (remaining.get(slot.variantId) ?? 0) - exact);
    result.set(slot.variantId, { owned: exact, ownedAs: [] });
  }
  for (const slot of slots) {
    const out = result.get(slot.variantId)!;
    if (slot.pinExact || slot.isPromo || slot.isStamped) continue;
    for (const candidate of candidates) {
      if (out.owned >= slot.quantity) break;
      const id = Number(candidate.variant_id);
      const available = remaining.get(id) ?? 0;
      if (available <= 0 || id === slot.variantId) continue;
      const sameEnergy = slot.basicEnergyType !== null && candidate.energy_type === slot.basicEnergyType;
      const samePrint = slot.group !== null && slot.group === candidate.identical_print_group
        && slot.variantKind === candidate.variant_kind_code;
      const eligible = canSatisfyByEquivalentPrint({
        pinnedExact: slot.pinExact, exactVariant: false, ownedVariantStamped: candidate.is_stamped,
        ownedCardPromo: candidate.is_promo, targetCardPromo: slot.isPromo,
        sameGameplayGroup: sameEnergy || samePrint,
      });
      if (!eligible || !legalCardIds.has(Number(candidate.card_id))) continue;
      const used = Math.min(slot.quantity - out.owned, available);
      remaining.set(id, available - used);
      out.owned += used;
      out.ownedAs.push({ setCode: ptcglCodeForSet(candidate.set_id)?.code ?? candidate.set_id.toUpperCase(),
        number: candidate.local_id, quantity: used });
    }
  }
  return result;
}

/** One ownership calculation for the deck page, buying routes and PDF. */
export async function loadOwnedPrints(
  db: Queryable, userId: string, format: FormatCode, slots: OwnedSlot[],
): Promise<Map<number, OwnedAllocation>> {
  if (slots.length === 0) return new Map();
  const ids = slots.map((s) => s.variantId);
  const groups = [...new Set(slots.map((s) => s.group).filter((s): s is string => s !== null))];
  const energyTypes = [...new Set(slots.map((s) => s.basicEnergyType).filter((s): s is string => s !== null))];
  const { rows } = await db.query<OwnedCandidate>(
    `SELECT cv.card_id, cv.id AS variant_id, cv.variant_kind_code,
            SUM(ci.quantity)::text AS quantity, c.identical_print_group,
            s.is_promo, EXISTS (SELECT 1 FROM variant_kind_stamp vks WHERE vks.variant_kind_code = cv.variant_kind_code) AS is_stamped,
            CASE WHEN c.category = 'Energy' AND c.energy_type = 'Normal' THEN ct.type ELSE NULL END AS energy_type,
            s.tcgdex_id AS set_id, c.local_id
       FROM collection_item ci
       JOIN card_variant cv ON cv.id = ci.card_variant_id
       JOIN card c ON c.id = cv.card_id
       JOIN card_set s ON s.id = c.set_id
       LEFT JOIN card_type ct ON ct.card_id = c.id AND ct.slot = 0
      WHERE ci.user_id = $1
        AND (cv.id = ANY($2::bigint[]) OR c.identical_print_group = ANY($3::char(64)[])
          OR (c.category = 'Energy' AND c.energy_type = 'Normal' AND ct.type = ANY($4::text[])))
      GROUP BY cv.card_id, cv.id, cv.variant_kind_code, c.identical_print_group,
               s.is_promo, c.category, c.energy_type, ct.type, s.tcgdex_id, c.local_id
      ORDER BY cv.id`,
    [userId, ids, groups, energyTypes],
  );
  const alternatives = rows.filter((r) => !r.is_promo && !r.is_stamped);
  const facts = await loadFactsByIds(db, [...new Set(alternatives.map((r) => Number(r.card_id)))]);
  const cfg = formatConfig(format);
  const oracle = cfg.pool_strategy === 'all' ? () => false : await buildReprintOracle(db, facts, cfg.legal_marks);
  const legal = new Set(facts.filter((f) => cardLegality(f, { isInFormatByReprint: oracle })
    .formats.find((entry) => entry.format === format)?.legal).map((f) => f.id));
  return allocateOwnedPrints(slots, rows, legal);
}
