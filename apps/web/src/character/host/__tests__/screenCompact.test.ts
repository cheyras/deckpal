/**
 * The numbers a compact screen says out loud.
 *
 * `DeckeScreen` now shows a widget first and a panel on request, and the control
 * that opens it makes a claim about the reader's data — "Show all 24 cards".
 * X2 of the experience pass is that a status the data does not support must
 * never be rendered, and a count is exactly the kind of claim that goes wrong
 * quietly: nobody counts the thumbnails to check. So the arithmetic is pure and
 * it is checked here, including the two cases that make it non-obvious — cards
 * hidden inside a block that the block cut removed, and cards inside a group
 * that the renderer refuses to draw at all.
 */
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  COLLAPSE_LABEL,
  COMPACT_BLOCKS,
  COMPACT_CARDS,
  compactPlan,
  expandLabel,
  showingLabel,
} from '../screenCompact'
import type { Block } from '../DeckeScreen'

const text = (t: string): Block => ({ kind: 'text', text: t })
const grid = (n: number): Block => ({
  kind: 'cardGrid',
  cards: Array.from({ length: n }, (_, i) => `sv8pt5-${i + 1}`),
})
const screen = (...blocks: Block[]) => ({ title: 'Panel', blocks })

test('a small screen is not compacted at all', () => {
  const plan = compactPlan(screen(text('one'), text('two'), grid(3)))
  assert.equal(plan.compactable, false)
  assert.equal(plan.hiddenBlocks, 0)
  assert.equal(plan.hiddenCards, 0)
  assert.equal(plan.totalCards, 3)
  assert.equal(plan.shownCards, plan.totalCards)
  // Nothing is hidden, so the limits must not clip anything either.
  assert.equal(plan.blockLimit, 3)
  assert.equal(plan.cardLimit, Number.POSITIVE_INFINITY)
})

test('hiding a single extra card is not worth a click', () => {
  // COMPACT_CARDS + 1 is the boundary the MIN_HIDDEN_CARDS rule exists for.
  const plan = compactPlan(screen(grid(COMPACT_CARDS + 1)))
  assert.equal(plan.compactable, false)
  const two = compactPlan(screen(grid(COMPACT_CARDS + 2)))
  assert.equal(two.compactable, true)
  assert.equal(two.hiddenCards, 2)
})

test('a long screen compacts, and the block cut is the threshold', () => {
  const blocks = Array.from({ length: COMPACT_BLOCKS + 3 }, (_, i) => text(`b${i}`))
  const plan = compactPlan(screen(...blocks))
  assert.equal(plan.compactable, true)
  assert.equal(plan.totalBlocks, COMPACT_BLOCKS + 3)
  assert.equal(plan.blockLimit, COMPACT_BLOCKS)
  assert.equal(plan.hiddenBlocks, 3)
})

test('"N of M" counts cards the block cut removed, not just the grid cut', () => {
  // Four blocks survive; the grid in the fifth is hidden entirely. Its cards
  // are still reachable by expanding, so they are still part of M — a total
  // that only counted the visible grids would understate what the button
  // delivers, which is the same lie as overstating it.
  const plan = compactPlan(
    screen(text('a'), text('b'), text('c'), grid(10), grid(4), text('d')),
  )
  assert.equal(plan.totalCards, 14)
  assert.equal(plan.shownCards, COMPACT_CARDS) // only the first grid, truncated
  assert.equal(plan.hiddenCards, 14 - COMPACT_CARDS)
  assert.equal(plan.hiddenBlocks, 2)
  // shown + hidden must always be the whole, or one of the three is a fiction.
  assert.equal(plan.shownCards + plan.hiddenCards, plan.totalCards)
})

test('cards in a group column count; cards in a group inside a group do not', () => {
  // `DeckeScreen`'s group case returns null for a nested group, so those cards
  // can never be drawn however hard the reader presses expand. Counting them
  // would make the label a promise the panel cannot keep.
  const nested: Block = {
    kind: 'group',
    left: [grid(3), { kind: 'group', left: [grid(50)], right: [grid(50)] }],
    right: [grid(2)],
  }
  const plan = compactPlan(screen(nested))
  assert.equal(plan.totalCards, 5)
  assert.equal(plan.compactable, false)
})

test('the expand label names the real totals, and never both halves twice', () => {
  const cardsOnly = compactPlan(screen(grid(24)))
  assert.equal(expandLabel(cardsOnly), 'Show all 24 cards')

  const blocksOnly = compactPlan(
    screen(text('a'), text('b'), text('c'), text('d'), text('e'), text('f')),
  )
  assert.equal(expandLabel(blocksOnly), 'Show 2 more sections')

  const oneBlock = compactPlan(
    screen(text('a'), text('b'), text('c'), text('d'), text('e')),
  )
  assert.equal(expandLabel(oneBlock), 'Show 1 more section')

  const both = compactPlan(screen(text('a'), text('b'), text('c'), grid(10), grid(4)))
  assert.equal(expandLabel(both), 'Show 1 more section and all 14 cards')

  // A screen with nothing to hide has no control, so it has no label either.
  assert.equal(expandLabel(compactPlan(screen(text('a')))), '')
  assert.equal(COLLAPSE_LABEL, 'Show less')
})

test('a grid caption appears only when the grid is actually cut', () => {
  assert.equal(showingLabel(6, 24), 'Showing 6 of 24')
  assert.equal(showingLabel(6, 6), null)
  assert.equal(showingLabel(0, 0), null)
})

test('an empty or malformed spec does not invent anything', () => {
  const plan = compactPlan({ blocks: [] })
  assert.equal(plan.compactable, false)
  assert.equal(plan.totalCards, 0)
  assert.equal(plan.totalBlocks, 0)
  assert.equal(compactPlan({}).totalCards, 0)
  // A grid the model sent with no `cards` array is zero cards, not a crash.
  assert.equal(compactPlan(screen({ kind: 'cardGrid' })).totalCards, 0)
})
