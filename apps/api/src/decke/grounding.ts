/**
 * Card ids he may show, because a tool actually returned them this turn.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * THE FAILURE THIS EXISTS FOR
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Asked for "my 5 most valuable cards", Deck-E drew a panel of five card ids the
 * account does not own. Measured twice on the deployed preview, and the ids
 * DIFFERED between runs — `084,047,019,021,020`, then `084,083,086,087,085` —
 * which is what proves they were invented rather than stale.
 *
 * The root cause was a tool-contract gap and is fixed: `collection_summary`
 * returned names and no ids while `cardGrid` requires ids, so the only tool that
 * could answer "what are my best cards" could not answer "…and show them", and
 * the gap between those two sentences was exactly one guess wide.
 *
 * But fixing the gap removes the REASON, not the CAPABILITY. He can still
 * type five plausible ids into a grid, and the reader cannot tell: an invented
 * id renders as real card art, correctly, for a card that is not theirs, beside
 * a sentence about the cards they asked for. There is no visual tell at all.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * WHY A MEMBERSHIP CHECK AND NOT A PROMPT RULE
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * The prompt already forbids this in two places. It happened anyway, which is
 * this codebase's most-repeated lesson: a prompt is not an enforcement
 * mechanism.
 *
 * This is enforcement. It is also nearly free — a Set lookup per id, no model
 * call, no round trip, sub-millisecond — which matters on a latency-critical
 * conversational path where the alternatives (a verification pass, a second
 * model, self-consistency) cost 3-4x per turn and were rejected for that reason.
 *
 * The idea generalises beyond ids and is deliberately NOT generalised here.
 * Checking every number he says against tool output would need to understand
 * arithmetic he is entitled to do — "12 of 120" legitimately becomes "10%" — and
 * a checker that is wrong about that is worse than none. Card ids are the case
 * where the check is exact: an id either appeared in this turn's tool output or
 * it did not.
 */

/**
 * Catalog ids look like `me05-013`, `sv3pt5-084`, `gym2-2`.
 *
 * The set part must contain a LETTER. Without that, the pattern also matches
 * `2026-07` out of a release date — caught by this file's own test — which
 * would let a date in one tool's output ground an invented id in the grid. A
 * grounding check that can be fed its own evidence by accident is worse than
 * none, because it would report a clean result while passing a fabrication.
 *
 * Anchored on `-` with no surrounding word characters, so `sv3pt5-084` matches
 * whole and never as a fragment of something longer.
 *
 * THE BOUNDS ARE FROM THE CATALOG, not from the ids that happened to be in
 * front of me. Measured against production: 23,546 cards, every one containing
 * a dash, set part up to 10 characters and number part up to 11 — the long ones
 * being promos like `swshp-SWSH001`. An earlier version capped the number at 6
 * and would have silently refused to ground every promo card in the catalog,
 * which is the quiet kind of wrong: grids of real promos would have had their
 * ids stripped as "invented".
 */
const CARD_ID = /\b(?=[a-z0-9]*[a-z])[a-z0-9]{2,12}-[a-z0-9]{1,12}\b/gi;

/**
 * Every card id a tool returned this turn.
 *
 * Harvested from the tool RESULT TEXT rather than from a structured field,
 * because that is what every tool in the shared package actually produces — one
 * compact row per line — and because a harvester tied to one tool's shape would
 * silently stop working when a second tool started returning cards.
 *
 * Accumulated across the whole turn, not per call: he may reasonably search on
 * step one and draw the grid on step three.
 */
export function createGrounding(): {
  observe(toolResultText: string): void;
  seen(id: string): boolean;
  size(): number;
} {
  const ids = new Set<string>();
  return {
    observe(text: string) {
      for (const m of text.matchAll(CARD_ID)) ids.add(m[0].toLowerCase());
    },
    seen(id: string) {
      return ids.has(id.trim().toLowerCase());
    },
    size() {
      return ids.size;
    },
  };
}

export type Grounding = ReturnType<typeof createGrounding>;

/**
 * Split a grid's ids into the ones a tool returned and the ones he made up.
 *
 * WHEN NOTHING HAS BEEN OBSERVED, EVERYTHING PASSES. That is deliberate and it
 * is the honest default: a turn with no data-tool calls has no evidence either
 * way, and refusing every id in that case would break the legitimate flow where
 * a reader types an id themselves and asks to see it. The check is for
 * CONTRADICTED ids, not unproven ones.
 */
export function partitionCards(
  cards: readonly string[],
  grounding: Grounding | undefined,
): { kept: string[]; invented: string[] } {
  if (!grounding || grounding.size() === 0) return { kept: [...cards], invented: [] };
  const kept: string[] = [];
  const invented: string[] = [];
  for (const id of cards) (grounding.seen(id) ? kept : invented).push(id);
  return { kept, invented };
}
