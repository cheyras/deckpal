/**
 * Deck-E watching a pack get opened.
 *
 * Two behaviours, both deliberately small: he comes over to the running list when
 * a rip starts, and he reacts once per card as it lands. That is the whole
 * feature, and keeping it that small is the point — he is standing next to
 * something the reader is concentrating on, and a character who emotes at every
 * common energy card stops reading as a reaction and starts reading as a
 * screensaver.
 *
 * EVERY EXPORT HERE IS A NO-OP WHEN HE IS NOT LOADED. The scanner is a core
 * feature and he is an enhancement gated behind an entitlement, so nothing in the
 * rip path may depend on him being present, and nothing here may throw into it.
 */
import { currentDeckE } from './runtime'

/** The rip panel, as `attend` looks for it. Set by `Scan.tsx`. */
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

/**
 * Come and watch, or go back to whatever he was doing.
 *
 * Routed through the background like every other journey, because a hop that
 * changes depth reads as teleporting when taken in a straight line — the engine's
 * own measurement is that a depth change is 24-27 world units against under 3 for
 * any same-depth leg.
 */
export function attendRip(on: boolean): void {
  const decke = currentDeckE()
  if (!decke) return
  try {
    if (!on) {
      decke.clearOverrides?.()
      return
    }
    decke.flyTo(
      { selector: `[${RIP_LANDMARK}]` },
      { depth: 'foreground', via: 'background', scrollWith: true, highlight: false },
    )
  } catch {
    /* He is decoration here. A failed journey must not touch the rip. */
  }
}

/**
 * One card landed.
 *
 * `once` rather than `sustain`: this is a punctuation mark on an event, not a
 * mood he should be left holding. Sustaining `alert_star` would leave him
 * permanently startled at a list that has moved on eleven cards since.
 */
export function reactToPull(rarity: string | null | undefined): void {
  const decke = currentDeckE()
  if (!decke) return
  try {
    decke.setState(isRarityHit(rarity) ? 'alert_star' : 'nod_yes', { mode: 'once' })
  } catch {
    /* As above. */
  }
}
