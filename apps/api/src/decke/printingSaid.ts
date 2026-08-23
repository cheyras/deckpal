/**
 * Did the READER name a printing, or did Deck-E pick one for them?
 *
 * ── WHY THIS CANNOT BE ASKED OF THE MODEL ────────────────────────────────────
 *
 * `log_cards` takes an optional printing. When it is present, the shared
 * resolver classifies the row `stated` — "they said which one" — and the
 * approval card asks nothing, correctly, because for an MCP caller "they" IS
 * the person whose collection it is.
 *
 * Deck-E is a proxy. Measured 2026-08-23, ten trials, "Add five different
 * Squirtle cards to my collection" with no printing named:
 *
 *     items across all calls          100
 *     printing left open                0
 *     printing chosen by him          100   ("Normal" 86, Reverse holo 10, Holo 4)
 *
 * So every row arrived `stated`, the picker never appeared, and the reader was
 * never told a choice existed. Reported as *"for some reason he has completely
 * stopped asking me about variance"* and *"I didn't provide a variant so he
 * honestly probably should be asking about variance"*.
 *
 * **A prompt rule was tried first and did nothing.** An explicit instruction —
 * leave the field EMPTY unless they named a printing, filling it in is choosing
 * for them — was added and the same ten trials re-run: 100/100 before, 100/100
 * after. A non-reasoning model fills the fields it is offered. This is the same
 * lesson the escort produced, in a different costume: when a behaviour has to be
 * guaranteed, guarantee it structurally and stop asking nicely.
 *
 * ── SO THE SERVER DECIDES, FROM WHAT THE READER ACTUALLY TYPED ───────────────
 *
 * The one fact the model cannot fake is the reader's own sentence. If no word
 * for a printing appears in it, no printing was stated, whatever the tool call
 * says — and the row goes back to being a question.
 *
 * It is deliberately GENEROUS in the direction of not asking: a reader who
 * clearly named a printing should not be interrogated about it. Being wrong the
 * other way costs one extra tap on a picker that is already on screen; being
 * wrong this way silently writes a printing they never chose, which is the
 * defect.
 */

/**
 * Words that name a printing, or unambiguously reach for one.
 *
 * These are VARIANT kinds — how a card was printed — and deliberately not
 * rarities. "Illustration rare" is a rarity: two cards of that rarity still have
 * a normal and a reverse printing between them, so hearing it tells you nothing
 * about which printing was meant.
 */
const PRINTING_WORDS = [
  'normal',
  'regular',
  'non-holo',
  'nonholo',
  'holo',
  'holofoil',
  'foil',
  'reverse',
  'rev holo',
  'first edition',
  '1st edition',
  '1st ed',
  'unlimited',
  'shadowless',
  'promo',
  'stamped',
  'cosmos',
  'poke ball',
  'pokeball',
  'master ball',
  'masterball',
] as const;

/**
 * Reduce a sentence to space-separated lowercase tokens, padded at both ends.
 *
 * ── WHY NOT A REGEX PER WORD ─────────────────────────────────────────────────
 *
 * A word must only count on its own boundaries, and the naive `includes` is
 * badly wrong here: "Rapidash" contains "id", and — the one that actually bites
 * — any card whose NAME contains "holo" would silently count as a stated
 * printing. There are 23,000 card names and somebody else chooses them.
 *
 * Normalising both sides to ` token token ` gets that for free, matches the
 * multi-word entries ("reverse holo", "1st edition") as phrases, and folds
 * "non-holo" onto "non holo" without a second spelling. It also avoids escaping
 * a vocabulary into a regex, which is where two attempts at this went wrong.
 */
const tokens = (s: string) => ` ${s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;

/** Pre-normalised once, since the vocabulary is fixed. */
const NEEDLES = PRINTING_WORDS.map(tokens);

/**
 * Did this message name a printing?
 *
 * Pass the reader's OWN latest message — never the conversation, and never
 * anything Deck-E wrote. He says "Normal" constantly; letting his words count
 * would restore the exact bug this closes.
 */
export function readerNamedPrinting(text: unknown): boolean {
  if (typeof text !== 'string' || !text.trim()) return false;
  const hay = tokens(text);
  return NEEDLES.some((n) => hay.includes(n));
}
