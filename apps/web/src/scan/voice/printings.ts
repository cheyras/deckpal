// WHICH OF THIS CARD'S PRINTINGS THE READER MEANT.
//
// The grammar hears a printing in the reader's words ("reverse holo", "poke
// ball", "first edition"); the row holds the card's real printings, straight off
// `api.card()`. This is the join, and it has to be a join over the catalog's own
// facets rather than over display names: `variant_kind.code` is a deterministic
// slug of the facet tuple (research/SCHEMA.md §4.5 — finish first, then subtype,
// foil, stamps, size), while `display_name` is curated free text that "nothing
// joins on". Real rows, from deckpal.app on 2026-09-26:
//
//   Exeggcute   normal · reverse · reverse-foil-pokeball · reverse-foil-masterball
//   Charizard   holo-unlimited · holo-shadowless · holo-shadowless-stamp-1st-edition
//               · holo-1999-2000-copyright
//
// "Reverse holo" on Exeggcute means `reverse`, not the Poké Ball pattern that is
// also a reverse: the reader who meant the pattern would have said so. So among
// the printings that satisfy everything said, the one with the FEWEST facets
// nobody mentioned wins, and the catalog's primary printing breaks a tie
// ("holo" on that Charizard is the unlimited print).
import type { Finish, Modifier, PrintingSpec } from './grammar'

export interface VariantLike {
  variantId: number
  kind: string
  displayName: string
  isPrimary: boolean
}

/** Legacy spellings of a finish that still turn up in older kind slugs. */
const FINISH_ALIASES: Record<string, Finish> = { normal: 'normal', holo: 'holo', holofoil: 'holo', reverse: 'reverse', reverseholofoil: 'reverse' }

/** Which kind-slug words (and, as a fallback, display-name text) satisfy a
 *  spoken modifier. The slug words are the ones the catalog sync mints; the
 *  display test catches a curated name for a printing whose slug says it
 *  differently. */
const MODIFIER_SLUG: Record<Modifier, { words: readonly string[]; display: RegExp }> = {
  'first-edition': { words: ['1st'], display: /\b(1st|first) edition\b/i },
  shadowless: { words: ['shadowless'], display: /\bshadowless\b/i },
  unlimited: { words: ['unlimited'], display: /\bunlimited\b/i },
  pokeball: { words: ['pokeball'], display: /\bpok[eé] ?ball\b/i },
  masterball: { words: ['masterball'], display: /\bmaster ?ball\b/i },
  stamp: { words: ['stamp'], display: /\bstamp/i },
  league: { words: ['league'], display: /\bleague\b/i },
  cosmos: { words: ['cosmos'], display: /\bcosmos\b/i },
}

function facets(kind: string): { finish: Finish | null; rest: string[] } {
  const words = kind.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  const finish = FINISH_ALIASES[words[0] ?? ''] ?? null
  return { finish, rest: finish ? words.slice(1) : words }
}

/**
 * The printing `spec` names on this card, or null when the card has no such
 * printing — which the caller says out loud rather than guessing ("Charizard ex
 * has no Normal printing").
 */
export function pickVariant<V extends VariantLike>(spec: Pick<PrintingSpec, 'finish' | 'modifiers'>, variants: readonly V[]): V | null {
  let best: V | null = null
  let bestExtra = Infinity
  for (const variant of variants) {
    const { finish, rest } = facets(variant.kind)
    if (spec.finish && finish !== spec.finish) continue
    const claimed = new Set<string>()
    const satisfied = spec.modifiers.every((m) => {
      const rule = MODIFIER_SLUG[m]
      const word = rule.words.find((w) => rest.includes(w))
      if (word) claimed.add(word)
      return !!word || rule.display.test(variant.displayName)
    })
    if (!satisfied) continue
    // `1st` arrives with `edition` beside it in the slug; both are the one
    // facet the reader named.
    if (claimed.has('1st')) claimed.add('edition')
    const extra = rest.filter((w) => !claimed.has(w)).length
    // Earlier wins a full tie: the catalog already orders a card's printings.
    if (extra < bestExtra || (extra === bestExtra && variant.isPrimary && !best?.isPrimary)) {
      best = variant
      bestExtra = extra
    }
  }
  return best
}
