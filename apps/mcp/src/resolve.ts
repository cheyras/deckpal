// Shared card + variant resolution for tools that accept "a card" loosely
// (get_card, log_cards). Policy per SPEC §4: ambiguity is returned, not guessed.
// Ambiguous candidates carry price and sort cheapest-first so agents default to
// the cheapest printing (issue #31).
import type { Ctx } from './ctx.js';
import { q, q1 } from './db.js';
import { money } from './format.js';

export interface CardRef {
  card_id?: string; // TCGdex id, e.g. "me05-84"
  name?: string;
  set_id?: string; // TCGdex set id, e.g. "me05"
  number?: string; // local card number within the set
}

export interface ResolvedCard {
  id: number; // internal card.id
  tcgdexId: string;
  name: string;
  setTcgdexId: string;
  setName: string;
  localId: string;
  rarity: string | null;
  category: string;
  /** Best USD market price in minor units (cents), NULL = unpriced. */
  bestMinor: number | null;
}

export type CardResolution =
  | { status: 'ok'; card: ResolvedCard }
  | { status: 'ambiguous'; candidates: ResolvedCard[]; total: number }
  | { status: 'not_found'; message: string };

const CARD_SELECT = `
  SELECT c.id, c.tcgdex_id, c.name, c.local_id, c.rarity, c.category,
         cs.tcgdex_id AS set_tcgdex_id, cs.name AS set_name,
         bp.best_minor
    FROM card c
    JOIN card_set cs ON cs.id = c.set_id
    LEFT JOIN (
      SELECT cv.card_id, min(pc.market_minor)::int AS best_minor
        FROM price_current pc
        JOIN card_variant cv ON cv.id = pc.card_variant_id
       WHERE pc.currency_code = 'USD' AND pc.market_minor IS NOT NULL
       GROUP BY cv.card_id
    ) bp ON bp.card_id = c.id`;

function shape(r: Record<string, unknown>): ResolvedCard {
  return {
    id: Number(r.id),
    tcgdexId: String(r.tcgdex_id),
    name: String(r.name),
    setTcgdexId: String(r.set_tcgdex_id),
    setName: String(r.set_name),
    localId: String(r.local_id),
    rarity: r.rarity == null ? null : String(r.rarity),
    category: String(r.category),
    bestMinor: r.best_minor == null ? null : Number(r.best_minor),
  };
}

export function describeCard(c: ResolvedCard): string {
  return `${c.name} | ${c.tcgdexId} | ${c.setName} #${c.localId}${c.rarity ? ` | ${c.rarity}` : ''} | ${money(c.bestMinor)}`;
}

export async function resolveCard(ctx: Ctx, ref: CardRef): Promise<CardResolution> {
  if (ref.card_id) {
    const r = await q1(ctx.db, `${CARD_SELECT} WHERE c.tcgdex_id = $1 AND c.lang = 'en'`, [
      ref.card_id.trim(),
    ]);
    return r
      ? { status: 'ok', card: shape(r) }
      : { status: 'not_found', message: `No card with id '${ref.card_id}'` };
  }
  const name = ref.name?.trim();
  if (!name) return { status: 'not_found', message: 'Provide card_id, or name (+ set_id/number)' };

  const conds: string[] = [`c.lang = 'en'`];
  const params: unknown[] = [];
  const p = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };
  if (ref.set_id) conds.push(`cs.tcgdex_id = ${p(ref.set_id.trim())}`);
  if (ref.number) conds.push(`c.local_id = ${p(ref.number.trim())}`);

  // Tier 1: exact accent/case-insensitive name; Tier 2: contains (same operator the REST API uses).
  const exactCond = `lower(unaccent(c.name)) = lower(unaccent(${p(name)}))`;
  let rows = await q(
    ctx.db,
    `${CARD_SELECT} WHERE ${[...conds, exactCond].join(' AND ')} ORDER BY cs.tcgdex_id, c.local_id_numeric NULLS LAST, c.local_id LIMIT 9`,
    params,
  );
  if (rows.length === 0) {
    const containsCond = `unaccent(c.name) ILIKE unaccent(${p(`%${name}%`)})`;
    rows = await q(
      ctx.db,
      `${CARD_SELECT} WHERE ${[...conds, containsCond].join(' AND ')} ORDER BY (lower(unaccent(c.name)) = lower(unaccent($${params.length - 1}))) DESC, length(c.name), cs.tcgdex_id, c.local_id_numeric NULLS LAST LIMIT 9`,
      params,
    );
  }
  if (rows.length === 0) {
    const where = [ref.set_id && `set '${ref.set_id}'`, ref.number && `#${ref.number}`]
      .filter(Boolean)
      .join(', ');
    return { status: 'not_found', message: `No card matching '${name}'${where ? ` (${where})` : ''}` };
  }
  if (rows.length === 1) return { status: 'ok', card: shape(rows[0]!) };
  // Sort candidates cheapest-first so agents naturally pick the cheapest
  // printing; unpriced cards sort last (issue #31).
  const candidates = rows.slice(0, 8).map(shape).sort((a, b) => {
    if (a.bestMinor === null && b.bestMinor === null) return 0;
    if (a.bestMinor === null) return 1;
    if (b.bestMinor === null) return -1;
    return a.bestMinor - b.bestMinor;
  });
  return { status: 'ambiguous', candidates, total: rows.length };
}

export interface VariantRef {
  variant_id?: number; // card_variant.id
  variant_kind?: string; // variant_kind.code, e.g. "reverse"
}

export interface ResolvedVariant {
  id: number;
  kindCode: string;
  displayName: string | null;
  isPrimary: boolean;
  ownedQty: number;
}

export type VariantResolution =
  | { status: 'ok'; variant: ResolvedVariant }
  | { status: 'ambiguous'; variants: ResolvedVariant[]; message: string }
  | { status: 'not_found'; message: string };

async function variantsOf(ctx: Ctx, cardId: number): Promise<ResolvedVariant[]> {
  const rows = await q(
    ctx.db,
    `SELECT cv.id, cv.variant_kind_code, cv.display_name, cv.is_primary,
            COALESCE(ci.quantity, 0) AS owned_qty
       FROM card_variant cv
       LEFT JOIN collection_item ci ON ci.card_variant_id = cv.id AND ci.user_id = $2
      WHERE cv.card_id = $1
      ORDER BY cv.sort_order`,
    [cardId, ctx.userId],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    kindCode: String(r.variant_kind_code),
    displayName: r.display_name == null ? null : String(r.display_name),
    isPrimary: Boolean(r.is_primary),
    ownedQty: Number(r.owned_qty),
  }));
}

export function describeVariant(v: ResolvedVariant): string {
  return `${v.displayName ?? v.kindCode}${v.isPrimary ? ' (primary)' : ''} — owned x${v.ownedQty}`;
}

/**
 * Resolve which variant of a card an operation targets.
 * - explicit variant_id / variant_kind wins;
 * - omitted → the card's primary variant;
 * - EXCEPT: setting an absolute quantity (opts.forAbsoluteQuantity) on a card where the
 *   user owns >1 distinct variant and gave no explicit variant → ambiguous, per SPEC §4.
 */
export async function resolveVariant(
  ctx: Ctx,
  cardId: number,
  ref: VariantRef,
  opts: { forAbsoluteQuantity?: boolean } = {},
): Promise<VariantResolution> {
  const all = await variantsOf(ctx, cardId);
  if (all.length === 0) return { status: 'not_found', message: 'Card has no variants in the catalog' };

  if (ref.variant_id != null) {
    const v = all.find((x) => x.id === ref.variant_id);
    return v
      ? { status: 'ok', variant: v }
      : {
          status: 'not_found',
          message: `Variant ${ref.variant_id} does not belong to this card. Its variants: ${all.map(describeVariant).join('; ')}`,
        };
  }
  if (ref.variant_kind) {
    const kind = ref.variant_kind.trim().toLowerCase();
    const v = all.find((x) => x.kindCode === kind);
    return v
      ? { status: 'ok', variant: v }
      : {
          status: 'not_found',
          message: `No '${kind}' variant. Available: ${all.map((x) => x.kindCode).join(', ')}`,
        };
  }

  const ownedDistinct = all.filter((x) => x.ownedQty > 0);
  if (opts.forAbsoluteQuantity && ownedDistinct.length > 1) {
    return {
      status: 'ambiguous',
      variants: all,
      message:
        'Multiple variants of this card are owned — setting an absolute quantity needs an explicit variant_id or variant_kind.',
    };
  }
  const primary = all.find((x) => x.isPrimary) ?? all[0]!;
  return { status: 'ok', variant: primary };
}
