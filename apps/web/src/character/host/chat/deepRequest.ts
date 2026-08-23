/**
 * What he understood the request to be, put back in front of the reader before
 * they authorise it.
 *
 * ── WHY THE CARD CANNOT JUST SAY "LET HIM PLAN A DECK?" ──────────────────────
 *
 * Every deep call now asks first, because a deep call is the scarcest thing the
 * account has — a sub-agent with its own model, up to 210 seconds, and under the
 * credit model the only thing a reader can run out of. Measured, on camera: he
 * spent one before the owner had confirmed anything, then spent another.
 *
 * But the argument against asking was real and is not answered by asking louder:
 * *"friction people learn to click through is worse than none."* A dialog that
 * says only "Let him plan a deck?" is exactly that dialog. It carries no
 * information, so the honest response to it is a reflex tap, and a reflex tap is
 * not consent.
 *
 * What makes the tap mean something is HIS RESTATEMENT. The reader asked for "a
 * new deck, doesn't have to be good, I just want to give people at the game
 * store a laugh on Saturday"; what he is about to spend a credit on is
 * `idea: "all-Water Squirtle deck built for comedy over competitiveness"`. Those
 * are not the same sentence, and the gap between them is the entire value of
 * being asked. The owner said as much: *"get their input if they want to put in
 * input."*
 *
 * ── IT READS THE ARGUMENTS AND NEVER INVENTS ─────────────────────────────────
 *
 * Returns `null` rather than a placeholder when there is nothing real to show.
 * A confident-sounding line assembled from an empty object is the failure this
 * whole pass exists to remove, and it would land on the one surface where a
 * reader is being asked to trust what they are reading.
 */

/** Fields worth showing, per deep tool, in the order they read best. */
const SHAPE: Record<string, readonly string[]> = {
  plan_deck: ['idea', 'format'],
  deck_strategy: ['deck_name', 'deck_id'],
  write_strategy_guide: ['deck_name', 'deck_id'],
  analyze_collection: ['question'],
  research_meta: ['question', 'format'],
};

/** Trim, collapse whitespace, and cut on a word boundary rather than mid-word. */
function tidy(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const s = v.replace(/\s+/g, ' ').trim();
  if (!s) return null;
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[,;:.\s]+$/, '')}…`;
}

/**
 * One line describing the work about to be paid for, or `null`.
 *
 * `null` means the card shows its title alone — which is what a tool with no
 * declared shape, or a call with nothing readable in it, honestly amounts to.
 */
export function deepRequestLine(name: string, input: unknown): string | null {
  const fields = SHAPE[name];
  if (!fields) return null;
  const obj = (input ?? {}) as Record<string, unknown>;
  const parts: string[] = [];
  for (const f of fields) {
    // The FIRST field carries the request and gets the room; the rest are
    // qualifiers and are short by nature ("Standard", "GLC").
    const v = tidy(obj[f], parts.length === 0 ? 160 : 40);
    if (v) parts.push(v);
  }
  if (parts.length === 0) return null;
  return parts.join(' · ');
}

/** Is this a tool whose call is worth restating? Used to decide the slot. */
export function isDeepRequest(name: string): boolean {
  return name in SHAPE;
}

/**
 * The one sentence that says this costs more, kept OUT of the question.
 *
 * *"External research takes extra usage. Are you okay with me doing research to
 * plan out a good deck or whatever?"*
 *
 * Two facts, deliberately in two places. The headline asks about THEIR deck;
 * this says what it costs us. Folding the second into the first — "Can I spend a
 * deep question building this deck?" — makes the question about our accounting,
 * uses our internal name for the tier, and was the thing he objected to by name.
 *
 * No number. What it costs in credits is real but it is not what a reader needs
 * at the moment of saying yes, and a figure here would have to be right on a
 * deployment where credits are switched off entirely — where it would be a
 * price for something that is not being charged.
 */
export const DEEP_COST_NOTE = 'This kind of research takes longer and uses more than a normal answer.'
