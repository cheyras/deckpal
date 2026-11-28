// The verified per-printing TCGplayer link table. Its rows, and why each one exists, live in
// `@deckpal/db/priceLinkOverrides` (packages/db/src/priceLinkOverrides.ts), because the image tier
// reads them too. This module is how the catalog writers apply them.

import { PRICE_LINK_OVERRIDES, type PriceLinkOverride } from '@deckpal/db/priceLinkOverrides';
import { foldName } from '../prices/linkMatch.js';

export { PRICE_LINK_OVERRIDES, type PriceLinkOverride };

export type OverrideIndex = ReadonlyMap<string, PriceLinkOverride>;

const key = (cardId: string, kind: string): string => `${cardId}|${kind}`;

/** Index a list of overrides by (card, kind). Throws on a duplicate key or a shared target. */
export function indexOverrides(list: readonly PriceLinkOverride[]): OverrideIndex {
  const byKey = new Map<string, PriceLinkOverride>();
  const targets = new Map<string, string>();
  for (const o of list) {
    const k = key(o.cardId, o.kind);
    if (byKey.has(k)) throw new Error(`price-link override listed twice: ${k}`);
    const t = `${o.productId}|${o.printing}`;
    const other = targets.get(t);
    // Two printings on one (product, printing) is exactly the fault this table repairs.
    if (other) throw new Error(`price-link overrides ${other} and ${k} both target ${t}`);
    byKey.set(k, o);
    targets.set(t, k);
  }
  return byKey;
}

export const OVERRIDES: OverrideIndex = indexOverrides(PRICE_LINK_OVERRIDES);

/** The TCGdex card ids an index covers (the link pass loads only these). */
export function overrideCardIds(index: OverrideIndex): string[] {
  return [...new Set([...index.values()].map((o) => o.cardId))];
}

export type OverrideCheck =
  | { applies: true; override: PriceLinkOverride }
  | { applies: false; refused: string; override: PriceLinkOverride }
  | null;

/**
 * The override for one printing of one card, after the identity check, or null when there is none.
 * `refused` says why an override exists but does not apply; the caller keeps the upstream value.
 */
export function checkOverride(
  index: OverrideIndex,
  input: { language: string; setId: string; cardId: string; localId: string; name: string; kind: string },
): OverrideCheck {
  const o = index.get(key(input.cardId, input.kind));
  if (!o) return null;
  const refuse = (refused: string): OverrideCheck => ({ applies: false, refused, override: o });
  if (input.language !== 'en') return refuse(`language ${input.language}`);
  if (input.setId !== o.setId) return refuse(`set is ${input.setId}, pinned ${o.setId}`);
  if (input.localId !== o.localId) return refuse(`number is ${input.localId}, pinned ${o.localId}`);
  if (foldName(input.name) !== foldName(o.cardName)) return refuse(`name is "${input.name}", pinned "${o.cardName}"`);
  return { applies: true, override: o };
}

/** The four `card_variant` columns a TCGplayer link occupies, as the importer writes them. */
export interface VariantLink {
  productId: number | null;
  printing: string | null;
  idSource: 'variant' | 'card' | 'none';
  idConfidence: number;
}

/**
 * The importer's boundary: the link one planned printing is written with. An override that applies
 * replaces the upstream link whatever upstream said (a wrong id, or none); otherwise the upstream
 * link is returned untouched. `check` reports which happened, for the import summary.
 */
export function overrideVariantLink(
  index: OverrideIndex,
  input: { language: string; setId: string; card: { id: string; localId: string; name: string }; kind: string },
  upstream: VariantLink,
): { link: VariantLink; check: OverrideCheck } {
  const check = checkOverride(index, {
    language: input.language, setId: input.setId, cardId: input.card.id,
    localId: input.card.localId, name: input.card.name, kind: input.kind,
  });
  if (!check?.applies) return { link: upstream, check };
  const o = check.override;
  return { link: { productId: o.productId, printing: o.printing, idSource: 'variant', idConfidence: 100 }, check };
}
