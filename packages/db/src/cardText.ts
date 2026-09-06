/**
 * The comparison form of a card's printed BODY TEXT — the on-disk format of
 * `card_text.body` and `card_text.tokens` (migration 049).
 *
 * ── WHY THIS LIVES IN THE DATABASE PACKAGE ──────────────────────────────────
 *
 * It is not a database helper. It is the DEFINITION of what two columns
 * contain, and two different apps have to agree on it byte for byte:
 *
 *   apps/sync/src/catalog/import.ts   WRITES the bag, once per card per sync.
 *   apps/api/src/scan/familyText.ts   normalises the OCR lines it compares
 *                                     against that bag, once per request.
 *
 * If those two ever drift, every lookup silently returns nothing and no test
 * that stubs one side can see it. `@deckpal/db` is the only package both apps
 * already depend on, and the column and its format now sit in the same package
 * as each other. It is exported from a SUBPATH (`@deckpal/db/cardText`) rather
 * than the main entry precisely so importing it does not drag `pg` and a
 * connection pool into `apps/api/src/scan`'s deliberately DB-free pure modules.
 *
 * ── WHAT IS FOLDED, AND WHY EACH ONE IS SAFE ────────────────────────────────
 *
 *  - **Energy symbols.** TCGdex writes them as `{C}`, `{L}`, `{P}` INSIDE the
 *    effect text — "it provides {C} Energy", "Search your deck for a Basic {L}
 *    Energy card". The physical card prints a coloured circle there, not a
 *    letter, so OCR produces junk, a stray bracket, or nothing at all. Three
 *    different readings of the same ink must not become three different tokens,
 *    so the placeholder is removed on the catalogue side and any short bracketed
 *    group is removed on the read side.
 *  - **Digits.** Dropped entirely. Damage (`60+`), HP (`170`), counter counts
 *    and "draw 7 cards" are the numerals on a card, and they are both the most
 *    OCR-fragile glyphs on it and the least discriminative: hundreds of cards
 *    say 30. The number that DOES identify a card is the collector number, and
 *    a different rung owns it.
 *  - **Accents.** Folded, not stripped, for the same reason `normalizeCardName`
 *    folds them — `Pokémon` must become `pokemon` and never `pokmon`.
 *  - **Apostrophes.** Removed, not folded to `'`. `opponent's` and `opponents`
 *    are the same word read twice, and the print glyph (`’`) is not the one a
 *    keyboard makes. This is a comparison form and never a display form, so
 *    there is nothing to preserve them for.
 *
 * ── WHAT IS NOT IN THE BAG ──────────────────────────────────────────────────
 *
 * The card's NAME, and the attack ENERGY COSTS.
 *
 * The name is out because of what this bag is FOR: the device sends body text
 * only when the name and the number both failed to extract (see
 * `apps/api/src/scan/resolve.ts`). Seeding the catalogue side with tokens the
 * read cannot contain would inflate every score by a constant and, worse, would
 * let a card be "identified" by a word the OCR never saw. (The rule is about
 * the FIELD, not the string: flavour text routinely says the card's name in a
 * sentence — "Charcadet will battle even tough opponents" — and that is ink on
 * the card like any other, so it stays.)
 *
 * The costs are out because `attacks[].cost` is `["Psychic","Psychic",
 * "Colorless"]` upstream and the card prints three coloured circles. The word
 * "psychic" is not on the card.
 */

/**
 * Bumped whenever anything below changes the bytes this produces.
 *
 * Stored per row in `card_text.normalizer_version`, and checked by the reader:
 * a bag written by an older normaliser is skipped rather than compared, because
 * a half-migrated table is the one state where this feature could quietly match
 * the wrong card. The fix is always the same — re-run the catalog sync.
 */
export const CARD_TEXT_NORMALIZER_VERSION = 1;

/** Shortest token worth keeping. Below this the token is noise in both directions. */
export const MIN_TOKEN_LENGTH = 3;

/**
 * English function words, dropped from the bag entirely.
 *
 * Deliberately SMALL and deliberately structural. It is tempting to also drop
 * the domain boilerplate — `pokemon`, `energy`, `card`, `deck` — because it is
 * on almost every card, but that is the wrong instinct here: a word shared by
 * the top family and its rival raises BOTH scores and therefore SHRINKS the
 * margin between them, which is the direction that makes this rung refuse. The
 * domain words are left in the bag and handled by `COMMON_TOKENS` below, which
 * only affects which tokens are cheap enough to probe an index with.
 */
const STOPWORDS: ReadonlySet<string> = new Set([
  'the', 'and', 'you', 'your', 'yours', 'this', 'that', 'these', 'those', 'for', 'from',
  'with', 'into', 'onto', 'out', 'off', 'are', 'was', 'were', 'its', 'his', 'her',
  'all', 'any', 'each', 'may', 'can', 'cant', 'has', 'have', 'had', 'than', 'then',
  'when', 'they', 'them', 'their', 'there', 'other', 'others', 'only', 'but', 'not',
  'one', 'two', 'who', 'how', 'why', 'own', 'per', 'both', 'been', 'being', 'does',
  'doesnt', 'dont', 'did', 'will', 'would', 'could', 'should', 'must', 'also', 'such',
  'some', 'more', 'most', 'much', 'many', 'less', 'least', 'same', 'another', 'until',
  'while', 'after', 'before', 'between', 'about', 'above', 'below', 'over', 'under',
  'once', 'twice', 'here', 'yourself', 'itself', 'themselves',
]);

/**
 * Domain words too common to be worth probing an index with.
 *
 * These STAY in the bag and count toward the score. They are excluded only from
 * `probeTokens()`, whose job is to hand Postgres a handful of terms selective
 * enough that a GIN `&&` returns a candidate pool instead of the catalogue.
 * `pokemon` alone is on roughly every card in the table; asking the index for it
 * is asking for a sequential scan with extra steps.
 */
const COMMON_TOKENS: ReadonlySet<string> = new Set([
  'pokemon', 'energy', 'card', 'cards', 'deck', 'hand', 'attack', 'attacks',
  'attacking', 'damage', 'discard', 'bench', 'benched', 'active', 'basic', 'stage',
  'turn', 'turns', 'play', 'player', 'prize', 'prizes', 'counter', 'counters',
  'opponent', 'opponents', 'put', 'puts', 'search', 'shuffle', 'draw', 'attached',
  'attach', 'attaches', 'during', 'evolve', 'evolves', 'evolved', 'knocked',
  'pile', 'top', 'way', 'use', 'used', 'using', 'take', 'takes',
]);

/**
 * One line of printed body text, or one field of catalogue text, folded to the
 * form both sides are compared in. See the header for what each fold buys.
 */
export function normalizeBodyLine(raw: string): string {
  return raw
    .normalize('NFC')
    // Energy-symbol placeholders. `{C}` is the catalogue spelling; `[C]` and
    // `(C)` are what OCR makes of the printed circle when it makes anything.
    // Bounded to three characters so a real parenthetical clause survives.
    .replace(/[{[(][^{}[\]()]{0,3}[}\])]/g, ' ')
    .replace(/[‘’ʼ′']/g, '')
    .normalize('NFD')
    .replace(/\p{Mn}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The token bag for a whole card: normalised, split, filtered, deduped, sorted.
 *
 * Sorted because it is stored as a Postgres array and compared as a set — a
 * stable order makes a re-import a no-op instead of a rewrite, and makes the
 * fixtures in the tests readable.
 */
export function bodyTokens(lines: readonly string[]): string[] {
  const out = new Set<string>();
  for (const line of lines) {
    for (const tok of normalizeBodyLine(line).split(' ')) {
      if (tok.length < MIN_TOKEN_LENGTH) continue;
      // Digits-only. `60`, `170`, `7` — see the header.
      if (!/[a-z]/.test(tok)) continue;
      if (STOPWORDS.has(tok)) continue;
      out.add(tok);
    }
  }
  return [...out].sort();
}

/** The normalised text itself, joined. Stored so a future scorer that needs word ORDER (a
 *  trigram or phrase pass) does not have to re-derive it from four tables. */
export function bodyText(lines: readonly string[]): string {
  return lines
    .map(normalizeBodyLine)
    .filter((l) => l !== '')
    .join(' ');
}

/**
 * The subset of a read's tokens selective enough to probe the GIN index with,
 * longest first (a long token is a rarer token, near enough, and this needs no
 * corpus statistics to be true).
 *
 * `limit` exists because this array crosses into SQL as a bind parameter built
 * from user-influenced input.
 *
 * 🔴 `rareFloor` IS NOT A TUNING KNOB, it is a correctness fix. A short Trainer's
 * entire printed vocabulary can be domain-common: Nest Ball's whole body is
 * "Item / Search your deck for a Basic Pokémon and put it onto your Bench.
 * Then, shuffle your deck.", of which exactly one word — "item" — is not on
 * half the cards in the game. Probing on rare tokens alone would hand the index
 * a one-element array, fail the caller's own overlap floor, and make this rung
 * useless for precisely the cards whose text is shortest. So when fewer than
 * `rareFloor` rare tokens exist, the common ones are appended to fill up: a
 * wider pool, which the scorer then narrows honestly, instead of no pool.
 */
export function probeTokens(
  tokens: readonly string[],
  limit: number,
  rareFloor: number,
): { tokens: string[]; rareCount: number } {
  const byLength = (a: string, b: string): number => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0);
  const rare = tokens.filter((t) => !COMMON_TOKENS.has(t)).sort(byLength);
  if (rare.length >= rareFloor) return { tokens: rare.slice(0, limit), rareCount: rare.length };
  const common = tokens.filter((t) => COMMON_TOKENS.has(t)).sort(byLength);
  // `rareCount` travels with the tokens so the caller can tell a selective
  // probe from a widened one and ask for more overlap from the widened kind.
  return { tokens: [...rare, ...common].slice(0, limit), rareCount: rare.length };
}
