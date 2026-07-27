/**
 * Name normalization + basic-Energy helpers. DECK-FORMATS §1.7 step 5, §3.2, §3.3.
 *
 * The 4-copy rule keys on the *normalized English name*: TCGdex parenthetical
 * disambiguators stripped, δ (Delta Species) and LV. suffixes stripped, but
 * owner/form prefixes (Alolan, Rocket's, Dark) KEPT.
 */

/** {brace} -> basic Energy type name (DECK-FORMATS §1.5 case 2). */
export const BRACE_TO_TYPE: Record<string, string> = {
  G: 'Grass',
  R: 'Fire',
  W: 'Water',
  L: 'Lightning',
  P: 'Psychic',
  F: 'Fighting',
  D: 'Darkness',
  M: 'Metal',
  Y: 'Fairy',
};

/**
 * Normalize a card name for the 4-copy / singleton / ban / exclusive-group keys.
 * - casefold
 * - fold curly apostrophe U+2019 -> straight
 * - strip a trailing " (…)" disambiguator: "Boss's Orders (Lysandre)" -> "boss's orders"
 * - strip " δ" / " (Delta Species)" — same name as the base (§3.2)
 * - strip " LV.X" / " LV. 44" level suffixes — not part of the name (§3.2)
 */
export function normalizeName(raw: string): string {
  let s = raw.normalize('NFC').replace(/’/g, "'").trim();
  // strip trailing parenthetical disambiguator (keep original for display elsewhere)
  s = s.replace(/\s*\([^)]*\)\s*$/u, '');
  // delta species
  s = s.replace(/\s+δ$/u, '').replace(/\s*\(delta species\)$/iu, '');
  // level suffixes: "LV.X", "LV. 44", "Lv.43", "Lv X"
  s = s.replace(/\s+lv\.?\s*(x|\d+)\s*$/iu, '');
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** A card is basic Energy iff category==Energy AND energyType==Normal (§3.3). NEVER infer from braces. */
export function isBasicEnergy(card: { category: string; energyType: string | null }): boolean {
  return card.category === 'Energy' && card.energyType === 'Normal';
}

/** Radiant detection is name-only and blessed by the rulebook (§3.6). */
export function isRadiant(name: string): boolean {
  return /^Radiant\s/u.test(name);
}

/** Prism Star: trailing ◇ (U+25C7) in the name (§3.7). */
export function isPrismStar(name: string): boolean {
  return /◇\s*$/u.test(name.trim()) || /\s◇$/u.test(name.trim());
}
