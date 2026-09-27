/** Catalog-side identity policy for equivalent-print ownership. */

/** Promo-set cards never join an ordinary card's ownership group. */
export function identicalPrintGroup(fingerprint: string | null, isPromoSet: boolean): string | null {
  return fingerprint && !isPromoSet ? fingerprint : null;
}

/** Stamps belong to a particular variant, so keep that variant distinct. */
export function canSatisfyByEquivalentPrint(input: {
  pinnedExact: boolean;
  exactVariant: boolean;
  ownedVariantStamped: boolean;
  ownedCardPromo: boolean;
  targetCardPromo: boolean;
  sameGameplayGroup: boolean;
}): boolean {
  if (input.pinnedExact) return input.exactVariant;
  if (input.exactVariant) return true;
  return input.sameGameplayGroup && !input.ownedVariantStamped && !input.ownedCardPromo && !input.targetCardPromo;
}
