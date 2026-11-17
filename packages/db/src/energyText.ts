/**
 * The comparison form of Energy TYPES inside printed rules text.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * The catalogue writes the same Energy type three ways, depending on which
 * upstream printing a row came from:
 *
 *     me04-013 Delphox   "discard a Basic {R} Energy card"
 *     mep-074  Delphox   "discard a Basic Fire Energy card"
 *     30th-…             "<span class="energy-symbol Lightning" …>Lightning</span>"
 *
 * All three are the same ink on the physical card. Left alone, the difference
 * broke two things: `playable_fingerprint` hashed the two Delphox printings
 * differently, so `search_cards` called one reprint "2 DIFFERENT CARDS" and
 * cheapest-printing advice stopped working for it; and a rules-text search for
 * "Basic Fire Energy" never saw a card that says "{R}".
 *
 * ── THE CANONICAL FORM IS THE SPELLED-OUT WORD ──────────────────────────────
 *
 * `{R}` -> `Fire`, never the other way round, because only that direction is
 * unambiguous: a brace token always means one Energy type, while the WORD
 * "Fire" is also part of attack names ("Fire Spin"), card names and flavour.
 * Rewriting words into symbols would need to guess which "Fire" is a type;
 * rewriting symbols into words never guesses. It also matches how people type
 * a search ("Fire Energy").
 *
 * This is a COMPARISON form, applied when text is hashed or searched. Stored
 * catalogue text is not rewritten (see the 2026-11-17 decision file).
 *
 * ── WHAT IT DOES NOT TOUCH ──────────────────────────────────────────────────
 *
 *  - Attack COSTS. `card_attack.cost` is already words upstream
 *    ("Fire,Fire,Colorless"); nothing here reads it.
 *  - Card NAMES. Basic Energy is named "Fire Energy" in one set and
 *    "Basic {R} Energy" in a decklist; folding names would be a different
 *    change with different risks, and nothing here needs it.
 *  - Unknown letters. `{X}` (a variable count in some effects) and anything
 *    else not in the table below is left exactly as it is.
 *
 * Exported from a SUBPATH (`@deckpal/db/energyText`) so pure modules can import
 * it without pulling `pg`, like `@deckpal/db/cardText`.
 */

/** Brace letter -> the Energy type it stands for. TCGdex's spelling, and the sim's clean-text table. */
export const ENERGY_SYMBOL_WORDS: Readonly<Record<string, string>> = {
  G: 'Grass',
  R: 'Fire',
  W: 'Water',
  L: 'Lightning',
  P: 'Psychic',
  F: 'Fighting',
  D: 'Darkness',
  M: 'Metal',
  N: 'Dragon',
  Y: 'Fairy',
  C: 'Colorless',
};

/** One pass, the same pass the SQL twin makes: markup out, the span's inner text (the type word) stays. */
const TAG = /<[^<>]*>/g;

/**
 * Text with every Energy symbol in its spelled-out form: `{R}` -> `Fire`, and
 * `<span class="energy-symbol Fire">Fire</span>` -> `Fire`. Text with neither is
 * returned unchanged (same string), so a hash over it does not move.
 *
 * Case-insensitive on the brace letter (`{r}` from a search box means Fire);
 * the catalogue itself always writes upper case.
 */
export function canonicalEnergyText(s: string): string;
export function canonicalEnergyText(s: string | null | undefined): string | null | undefined;
export function canonicalEnergyText(s: string | null | undefined): string | null | undefined {
  if (s == null || (!s.includes('{') && !s.includes('<'))) return s;
  return s
    .replace(TAG, '')
    .replace(/\{([A-Za-z])\}/g, (m, letter: string) => ENERGY_SYMBOL_WORDS[letter.toUpperCase()] ?? m);
}

/**
 * The SQL twin of {@link canonicalEnergyText}, wrapped around a text
 * expression. Plain `replace()` calls (no extension, no function to migrate),
 * built from the same table so the two cannot drift; a test parses this output
 * and re-applies it in JS to prove parity.
 *
 * `expr` is trusted SQL (a column expression the caller wrote), never user input.
 * Upper-case letters only, because only the search TERM can be lower case and
 * that side goes through the TS function.
 */
export function canonicalEnergyTextSql(expr: string): string {
  let out = `regexp_replace(${expr}, '<[^<>]*>', '', 'g')`;
  for (const [letter, word] of Object.entries(ENERGY_SYMBOL_WORDS)) {
    out = `replace(${out}, '{${letter}}', '${word}')`;
  }
  return out;
}
