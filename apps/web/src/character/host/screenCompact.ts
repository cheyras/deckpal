/**
 * How much of a screen to draw before asking.
 *
 * `DeckeScreen` renders whatever the server let through, at full size, forever.
 * That is right for a dashboard and wrong for the thing the owner actually
 * asked for — *"he could present that ad hoc screen first as, like, a little
 * widget inline chat"* — because the panel shares a phone's viewport with the
 * transcript above it, the composer below it, and Deck-E himself standing in
 * the corner. A twelve-block panel with sixty cards in it does not read as a
 * widget; it reads as the answer having eaten the conversation.
 *
 * The arithmetic lives here rather than in the component for one reason: every
 * number this file returns is going to be shown to a person as a claim about
 * their data — "show all 24 cards" — and X2 of the experience pass says a
 * number the data does not support must never be rendered. A claim that can be
 * unit-tested is a claim somebody has checked. See
 * `__tests__/screenCompact.test.ts`.
 *
 * IT MIRRORS THE RENDERER, DELIBERATELY. `countCards` skips a group inside a
 * group exactly as `DeckeScreen`'s `group` case returns `null` for one, because
 * the total in "of 24" has to be the number of cards a reader can actually
 * reach by pressing expand. Counting cards in a block that draws nothing would
 * make the button a promise the panel cannot keep.
 */
import type { Block } from './DeckeScreen'

/**
 * HOW MANY BLOCKS SURVIVE THE FIRST LOOK: four.
 *
 * The server's authoring cap is `MAX_BLOCKS = 12` (`apps/api/src/decke/screens.ts`),
 * which bounds how much the model may compose and says nothing about how much
 * to show at once. Four is a third of that, and it is chosen from the layout
 * rather than from the cap: measured against the phone composition this panel is
 * built for (390px wide, the app header above, the composer and Deck-E's park
 * box below), four blocks of the typical mix — a heading, a line of prose, a
 * stat tile and a grid — is about what stands above the fold. Past that the
 * reader is scrolling through the answer to get back to the conversation, which
 * is the complaint.
 */
export const COMPACT_BLOCKS = 4

/**
 * HOW MANY CARDS A GRID SHOWS COMPACT: six.
 *
 * `cardGrid` is `grid-cols-3` on a phone and `grid-cols-4` on desktop, so six is
 * exactly two rows at the narrow width and one and a half at the wide one. Two
 * rows reads as *a sample of what he found*; four rows reads as a dump. The
 * budget he is allowed to spend is `SCREEN_CARD_BUDGET = 60`, so the compact
 * form can be hiding an order of magnitude — which is precisely why the control
 * that reveals them has to say how many there are.
 */
export const COMPACT_CARDS = 6

/**
 * Below this, compacting is not worth a click.
 *
 * Hiding one card behind a button costs the reader an interaction and buys them
 * one thumbnail. Two is the smallest number where expanding is worth doing.
 */
export const MIN_HIDDEN_CARDS = 2

export type CompactPlan = {
  /** Is there enough here that a first look should be a summary? */
  compactable: boolean
  /** Blocks drawn while compact. Equal to `totalBlocks` when there is nothing to hide. */
  blockLimit: number
  /** Cards drawn per grid while compact. `Infinity` when there is nothing to hide. */
  cardLimit: number
  totalBlocks: number
  hiddenBlocks: number
  /** Every card a reader can reach by expanding — the M in "N of M". */
  totalCards: number
  /** Every card the compact form actually draws — the N. */
  shownCards: number
  hiddenCards: number
}

/**
 * Cards under these blocks, counting at most `cap` per grid.
 *
 * `dense` is what the renderer calls a block inside a group column, and a group
 * that arrives inside one draws nothing there — so neither does it count here.
 */
function countCards(blocks: readonly Block[], cap: number, dense: boolean): number {
  let n = 0
  for (const b of blocks) {
    if (b.kind === 'cardGrid') {
      n += Math.min(b.cards?.length ?? 0, cap)
    } else if (b.kind === 'group' && !dense) {
      n += countCards(b.left ?? [], cap, true)
      n += countCards(b.right ?? [], cap, true)
    }
  }
  return n
}

/** What a screen looks like at first glance, and what pressing expand would add. */
export function compactPlan(spec: { blocks?: readonly Block[] }): CompactPlan {
  const blocks = spec.blocks ?? []
  const totalBlocks = blocks.length
  const totalCards = countCards(blocks, Number.POSITIVE_INFINITY, false)

  const blockLimit = Math.min(COMPACT_BLOCKS, totalBlocks)
  const hiddenBlocks = totalBlocks - blockLimit
  const shownCards = countCards(blocks.slice(0, blockLimit), COMPACT_CARDS, false)
  const hiddenCards = totalCards - shownCards

  const compactable = hiddenBlocks > 0 || hiddenCards >= MIN_HIDDEN_CARDS
  if (!compactable) {
    return {
      compactable: false,
      blockLimit: totalBlocks,
      cardLimit: Number.POSITIVE_INFINITY,
      totalBlocks,
      hiddenBlocks: 0,
      totalCards,
      shownCards: totalCards,
      hiddenCards: 0,
    }
  }
  return {
    compactable: true,
    blockLimit,
    cardLimit: COMPACT_CARDS,
    totalBlocks,
    hiddenBlocks,
    totalCards,
    shownCards,
    hiddenCards,
  }
}

const plural = (n: number) => (n === 1 ? '' : 's')

/**
 * The accessible name of the control that reveals the rest.
 *
 * IT NAMES THE REAL TOTALS. "Show more" is the version of this button that
 * cannot be wrong and also cannot be judged — a reader deciding whether to open
 * it wants to know whether they are about to get four more cards or fifty-four.
 * Both numbers here come out of `compactPlan`, which counts the spec, so there
 * is no path by which this string states a figure the panel will not then draw.
 */
export function expandLabel(plan: CompactPlan): string {
  if (!plan.compactable) return ''
  const { hiddenBlocks: sections, hiddenCards: cards, totalCards } = plan
  if (sections > 0 && cards > 0) {
    return `Show ${sections} more section${plural(sections)} and all ${totalCards} cards`
  }
  if (sections > 0) return `Show ${sections} more section${plural(sections)}`
  return `Show all ${totalCards} cards`
}

/** The control's name once everything is out. */
export const COLLAPSE_LABEL = 'Show less'

/**
 * The honest caption on a truncated grid, or `null` when nothing is truncated.
 *
 * Returning `null` rather than "Showing 6 of 6" matters: a count that appears
 * on a grid showing everything trains the reader to ignore the count on the
 * grid that is not.
 */
export function showingLabel(shown: number, total: number): string | null {
  if (!(total > shown)) return null
  return `Showing ${shown} of ${total}`
}
