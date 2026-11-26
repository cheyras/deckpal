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

/**
 * Brace letter -> the Energy type it stands for, in TCGdex's spelling.
 *
 * The sim keeps its own copies of this table (`packages/sim/src/cards/clean-text.ts` SYMBOL, the
 * reverse direction, and `render.ts` TYPE_SYMBOL) because `@deckpal/sim` has no workspace
 * dependencies and is not given one for eleven fixed pairs. The 2026-11-17 decision file records
 * the duplication; change all three together.
 */
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

/** The type words, for the energy-symbol span pattern. */
const TYPE_WORDS = Object.values(ENERGY_SYMBOL_WORDS);

/*
 * The two regular expressions are written ONCE, as source text that means the same thing to a
 * JavaScript RegExp and to a PostgreSQL ARE: no backslashes, no word boundaries (`\b` is a
 * backspace in Postgres), no quotes, and no construct the two engines disagree on. Neither can
 * match across a `<` or `>`, so every match is unique at its start position and the two engines'
 * different longest/first-match rules cannot pick different text.
 */

/**
 * A 30th Celebration energy symbol, read from its CLASS rather than its inner text, like the
 * sim's clean-text: `<span class="energy-symbol Fire" title="Fire"></span>` is Fire even when the
 * span is empty, so an empty span cannot fold to "" and merge two different types. Group 1 is the
 * type word. Case-sensitive, as the catalogue writes it; a span naming no known type is left for
 * the tag strip below.
 */
export const ENERGY_SPAN_PATTERN = `<span [^<>]*energy-symbol (${TYPE_WORDS.join('|')})[" ][^<>]*>[^<>]*</span>`;

/**
 * Anything that looks like an HTML tag: `<`, an optional `/`, then a letter. A bare angle bracket
 * in prose ("HP < 50 and > 10") is not a tag and is kept.
 */
export const TAG_PATTERN = '</?[A-Za-z][^<>]*>';

const SPAN_RE = new RegExp(ENERGY_SPAN_PATTERN, 'g');
const TAG_RE = new RegExp(TAG_PATTERN, 'g');

/**
 * Text with every Energy symbol in its spelled-out form: `{R}` -> `Fire`, and
 * `<span class="energy-symbol Fire">Fire</span>` -> `Fire`. Every other HTML tag is dropped too
 * (its inner text stays), so `<em>…</em>` reminder text compares equal to the same words untagged.
 * Text with no `{` and no `<` is returned unchanged (same string), so a hash over it does not move;
 * text whose only `<` is not a tag ("HP < 50") comes back equal to its input.
 *
 * Case-insensitive on the brace letter (`{r}` from a search box means Fire);
 * the catalogue itself always writes upper case, and the SQL twin only folds upper case.
 */
export function canonicalEnergyText(s: string): string;
export function canonicalEnergyText(s: string | null | undefined): string | null | undefined;
export function canonicalEnergyText(s: string | null | undefined): string | null | undefined {
  if (s == null || (!s.includes('{') && !s.includes('<'))) return s;
  return s
    .replace(SPAN_RE, '$1')
    .replace(TAG_RE, '')
    .replace(/\{([A-Za-z])\}/g, (m, letter: string) => ENERGY_SYMBOL_WORDS[letter.toUpperCase()] ?? m);
}

/**
 * The SQL twin of {@link canonicalEnergyText}, wrapped around a text
 * expression. Two `regexp_replace()` and plain `replace()` calls (no extension,
 * no function to migrate), built from the same table and the same patterns so
 * the two cannot drift; a test parses this output and re-applies it in JS to
 * prove parity, and the database integration suite runs it on real PostgreSQL.
 *
 * Gated like the TS early return: a value with neither `{` nor `<` (most rules
 * text) skips the regex and the eleven replaces entirely. The result is the
 * same either way, because without those characters nothing could match.
 *
 * `expr` is trusted SQL (a column expression the caller wrote), never user input.
 * It appears three times in the output, so it should be cheap to evaluate.
 * Upper-case letters only, because only the search TERM can be lower case and
 * that side goes through the TS function.
 */
export function canonicalEnergyTextSql(expr: string): string {
  let out = `regexp_replace(regexp_replace(${expr}, '${ENERGY_SPAN_PATTERN}', '\\1', 'g'), '${TAG_PATTERN}', '', 'g')`;
  for (const [letter, word] of Object.entries(ENERGY_SYMBOL_WORDS)) {
    out = `replace(${out}, '{${letter}}', '${word}')`;
  }
  return `CASE WHEN strpos(${expr}, '{') > 0 OR strpos(${expr}, '<') > 0 THEN ${out} ELSE ${expr} END`;
}
