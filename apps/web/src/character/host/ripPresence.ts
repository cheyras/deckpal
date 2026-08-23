/**
 * The rarity judgement that a rip reaction would use — and the reaction itself,
 * REMOVED, on purpose, with the reason written down.
 *
 * ── WHAT USED TO BE HERE ─────────────────────────────────────────────────────
 *
 * `attendRip()` flew Deck-E over to the running list when a pack rip started,
 * and `reactToPull()` gave him one beat per card as it landed. Both are gone.
 *
 * ── WHY, AND WHY THIS COMMENT IS NOT OPTIONAL ────────────────────────────────
 *
 * Every export here was a NO-OP WHEN HE IS NOT LOADED, which was the correct
 * design — the scanner is a core feature and he is an enhancement behind an
 * entitlement, so nothing in the rip path may depend on him being present.
 *
 * But that made it invisible when he stopped being loaded. The only thing that
 * ever loaded him before a rip was an idle timer in `DeckeHost` that warmed the
 * character on every page whether or not anyone wanted him. Deleting that timer
 * — the owner's stated number-one complaint, and 5.9 MB per visitor — silently
 * killed this feature, because a no-op does not announce itself. That the two
 * were connected appeared in **no** document: not the plan, the brief, the
 * audit, or the research. An adversarial review of the plan found it.
 *
 * The owner's ruling, verbatim: *"the rip-watching feature completely doesn't
 * work, and very clearly needs an overhaul, so I'm ok with gutting the
 * implementation as is because it really, really sucks."*
 *
 * So this is a **sanctioned removal**, not an accident. The functions are
 * deleted rather than left disabled, because a function that is present and
 * does nothing is exactly how this hid in the first place — a caller reads the
 * call site, sees a live-looking API, and concludes the feature works.
 *
 * ── WHAT SURVIVES, AND WHAT AN OVERHAUL SHOULD KNOW ──────────────────────────
 *
 * The rarity heuristic stays. It is the only part of this that was ever right,
 * it is pinned by tests, and it encodes a judgement worth keeping: the bar is
 * the CHASE tiers, not "rare", because every pack contains a guaranteed rare
 * and a character who reacts to that is not reacting, he is ticking.
 *
 * A rip-presence overhaul is out of scope for this pass and wants its own
 * design. It is a second surface where the character reacts to live events, and
 * it should be designed alongside the journey sequencer rather than bolted onto
 * it. Whatever it becomes will have to answer the question this version never
 * did: **how does he come to be loaded at all?** Loading seven megabytes on
 * every page against the chance that someone might open a pack is the trade
 * that was just rejected.
 */

/**
 * The rip panel, as a landmark.
 *
 * Kept on the DOM deliberately. It is a marker, not behaviour — it cannot
 * silently no-op, because on its own it does nothing at all — and the overhaul
 * will want somewhere to fly to. **Nothing currently flies here.**
 */
export const RIP_LANDMARK = 'data-decke-rip-list'

/**
 * Rarity labels worth a reaction.
 *
 * Deliberately a LOOSE HEURISTIC on the label rather than a copy of the rarity
 * ladder. `apps/api/src/rarity.ts` owns the real ordering — it is a 40-odd entry
 * table spanning five eras plus TCG Pocket — and duplicating it here to drive an
 * animation would create a second copy that silently rots every time a set
 * introduces a name. Matching substrings degrades honestly instead: an unknown
 * new chase rarity containing "rare" still reads as a hit, and the cost of a miss
 * is that he nods instead of gasping.
 *
 * The bar is set at the CHASE tiers, not at "rare". Every pack contains a
 * guaranteed rare, so reacting to that is reacting to nothing.
 */
const HIT = /illustration|ultra|hyper|secret|special|double rare|shiny|gold|rainbow|prime|radiant|amazing/i

/** Is this rarity label worth marking? */
export function isRarityHit(rarity: string | null | undefined): boolean {
  return !!rarity && HIT.test(rarity)
}
