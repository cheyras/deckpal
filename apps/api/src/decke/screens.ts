/**
 * The little screens Deck-E can put together to show a result.
 *
 * THE MODEL PICKS COMPONENTS AND PASSES PROPS. It never authors markup, and it
 * cannot: there is no field anywhere in this schema that carries HTML, a class
 * name, a style, a URL or a selector. A screen is a list of blocks drawn from a
 * closed set, each with typed props, and anything the renderer does not
 * recognise is dropped and reported rather than rendered.
 *
 * That is the whole design, and it buys two things at once. It cannot become a
 * markup-injection surface, because there is no markup to inject into. And it
 * cannot look like slop, because every block is a component the design system
 * already owns — the model chooses arrangement, not appearance.
 *
 * FLAT, WITH A `kind` ENUM, for the same reason `tools.ts` is: a `z.union`
 * compiles to a JSON-Schema combinator, and while grok tolerates `anyOf` in a
 * tool schema, the flat shape is the one proven end to end here. Per-block field
 * validity is enforced by `validateBlock` below, which the schema cannot express.
 *
 * WHAT CHANGED WHEN HE GOT DATA TOOLS. This palette was designed and shipped
 * before Deck-E could read anything, so for its whole life it rendered figures
 * the model had invented. The first time it was handed real card ids and real
 * numbers it turned out to be missing the three shapes a real answer actually
 * has: two things side by side, a small table of figures, and a line saying what
 * a grid of cards IS. Those are `group`, `table` and a caption on `cardGrid`,
 * added here. Nothing about the constraint above moved to make room for them.
 */
import { z } from 'zod'

/**
 * The blocks a screen can contain ANYWHERE — including inside a `group`.
 *
 * Kept as its own list because `group` nests and none of these do, and that
 * asymmetry IS the depth limit. A group's two columns are typed as leaf blocks,
 * so "a group inside a group" is not a rule enforced somewhere downstream; it is
 * a sentence this schema cannot express.
 *
 * The obvious shape — one block schema referring to itself with `z.lazy` — was
 * rejected deliberately. Unbounded nesting driven by model output is a
 * denial-of-service surface twice over: in the validator, which would walk
 * whatever depth arrived, and in the renderer, which would recurse to draw it.
 * And there is no comparison anybody wants that needs two levels of columns.
 * One level is the feature; the second level is only a way to be attacked.
 */
export const LEAF_BLOCK_KINDS = [
  'heading',
  'text',
  'cardGrid',
  'statTile',
  'progress',
  'status',
  'empty',
  'table',
] as const

/**
 * The component palette.
 *
 * Chosen because their props are enums and primitives with no free-text styling
 * surface. `Sheet` is deliberately absent: it is the container a screen is
 * rendered INSIDE, not a block a model picks.
 *
 * Spelled out in full rather than derived from `LEAF_BLOCK_KINDS` with a spread,
 * because this list is mirrored by hand in the browser's renderer and the test
 * that compares them reads BOTH files as text — a spread would leave the mirror
 * check reading `...LEAF_BLOCK_KINDS` as if it were a kind. The relationship
 * between the two lists is asserted in the tests instead, which is the same
 * trade the `CLIENT_TOOLS` mirror already makes.
 */
export const BLOCK_KINDS = [
  'heading',
  'text',
  'cardGrid',
  'statTile',
  'progress',
  'status',
  'empty',
  'table',
  'group',
] as const

export type BlockKind = (typeof BLOCK_KINDS)[number]
export type LeafBlockKind = (typeof LEAF_BLOCK_KINDS)[number]

/** A table is figures, not a spreadsheet. Both caps are rejections, not clamps. */
const TABLE_MAX_COLUMNS = 4
const TABLE_MAX_ROWS = 10
/** Blocks per column of a `group`. Enough for a heading, a figure and a note. */
const GROUP_MAX_PER_COLUMN = 4

/**
 * The fields every block may carry, minus the two that nest.
 *
 * `text` is THE LABEL FOR THIS BLOCK, uniformly — the words themselves for
 * `heading`/`text`/`status`/`empty`, and the thing being measured for
 * `statTile`/`progress`/`cardGrid`/`table`. Giving `cardGrid` its caption
 * through the field that already means "label" rather than a new `caption`
 * field was a deliberate subtraction: this file's own rule is that every prop
 * added is a new thing to be sure about, and "the label of a grid of cards" and
 * "the label of a stat tile" are not two ideas.
 */
const leafFields = {
  text: z
    .string()
    .max(280)
    .optional()
    .describe(
      'The label for this block: the words themselves for heading/text/status/empty, and what is being shown for statTile/progress/cardGrid/table (e.g. "your five most valuable"). Plain prose, never markup.',
    ),
  cards: z
    .array(z.string())
    .max(60)
    .optional()
    .describe('cardGrid only: catalog card ids, in the order to show them.'),
  quantities: z
    .array(z.number().int())
    .max(60)
    .optional()
    .describe(
      'cardGrid only: how many of each, positionally matching `cards`. Omit it entirely if every card is a single, or stop early — any card you do not give a number is a single.',
    ),
  value: z
    .string()
    .max(40)
    .optional()
    .describe('statTile only: the figure to show, already formatted.'),
  percent: z.number().min(0).max(100).optional().describe('progress only.'),
  tone: z
    .enum(['neutral', 'good', 'warn', 'bad'])
    .optional()
    .describe('statTile/status only: which of the four semantic tones.'),
  /** cardGrid only. Lets the reader fix a mis-scan in place. */
  editable: z.boolean().optional().describe('cardGrid only: allow the reader to correct rows.'),
  columns: z
    .array(z.string().max(24))
    .min(2)
    .max(TABLE_MAX_COLUMNS)
    .optional()
    .describe(
      `table only: the column headers, two to ${TABLE_MAX_COLUMNS}. The first column is the row label; the rest are read as figures and right-aligned.`,
    ),
  rows: z
    .array(z.array(z.string().max(40)).max(TABLE_MAX_COLUMNS))
    .max(TABLE_MAX_ROWS)
    .optional()
    .describe(
      `table only: up to ${TABLE_MAX_ROWS} rows, each one cell per column, already formatted. A row with the wrong number of cells is dropped — there is no way to guess which column was meant.`,
    ),
}

const leafBlockSchema = z.object({
  kind: z.enum(LEAF_BLOCK_KINDS).describe('Which component this block is.'),
  ...leafFields,
})

export type LeafBlock = z.infer<typeof leafBlockSchema>

const blockSchema = leafBlockSchema.extend({
  kind: z.enum(BLOCK_KINDS).describe('Which component this block is.'),
  left: z
    .array(leafBlockSchema)
    .min(1)
    .max(GROUP_MAX_PER_COLUMN)
    .optional()
    .describe('group only: the blocks in the left column. A group cannot contain another group.'),
  right: z
    .array(leafBlockSchema)
    .min(1)
    .max(GROUP_MAX_PER_COLUMN)
    .optional()
    .describe('group only: the blocks in the right column. A group cannot contain another group.'),
})

export type ScreenBlock = z.infer<typeof blockSchema>

/**
 * How many blocks a screen may hold.
 *
 * EIGHT, RAISED TO TWELVE. Eight was chosen when every block was one row of one
 * thing, and it was the right number for the answers this could give then:
 * heading, grid, a couple of tiles, done. It is the wrong number now for a
 * reason worth writing down — `group` and `table` are BLOCKS THAT HOLD OTHER
 * CONTENT, so a composed answer spends its budget faster than a listed one. A
 * real "how am I doing on this set" is a heading, a caption'd grid, a table of
 * figures, a progress bar, a two-column comparison and a status line, and that
 * is already six with nothing wasted; two of them plus framing is eleven.
 *
 * Twelve and not twenty because a screen is a PANEL IN A CHAT BUBBLE, not a
 * page. Past roughly a dozen blocks the reader is scrolling a document inside a
 * conversation, at which point the honest answer was a route to a real page in
 * the app — which he can also do, and should.
 *
 * Note what this cap is NOT doing: it is not the defence against a screen that
 * is expensive to draw. Twelve blocks of groups of card grids would be hundreds
 * of card-art lookups; `SCREEN_CARD_BUDGET` below is what bounds that, because
 * the cost is in the cards, not in the blocks.
 */
export const MAX_BLOCKS = 12

/**
 * Cards a whole screen may show, across every grid in it.
 *
 * `cards` was capped at 60 per grid from the start, and while one grid was the
 * only way to show cards that cap was also the screen's. It stopped being that
 * the moment a screen could hold twelve blocks and a group could hold more
 * grids inside them: 12 × 60 is 720 card ids, and every one of them is a catalog
 * lookup the browser makes to resolve art. That is a request storm a model can
 * trigger with one tool call, which makes it a real denial-of-service surface
 * rather than a tidiness concern.
 *
 * So the per-grid cap becomes a per-SCREEN cap, and it is spent in block order:
 * a grid that does not fit in what is left is dropped whole, with a reason,
 * never truncated. Truncating would show the reader a grid of "your five most
 * valuable" containing three of them and no indication that two are missing,
 * which is the failure mode this entire file exists to avoid.
 */
export const SCREEN_CARD_BUDGET = 60

export const screenSchema = z.object({
  title: z.string().max(80).describe('What this screen is. Shown as its header.'),
  blocks: z.array(blockSchema).min(1).max(MAX_BLOCKS).describe('Rendered in order.'),
})

export type Screen = z.infer<typeof screenSchema>

/**
 * What the flat schema cannot say.
 *
 * Returns a reason, or null when the block is fine. REJECTS RATHER THAN
 * CLAMPS, matching the engine's own command surface: a model that is silently
 * corrected learns nothing and repeats the mistake next turn.
 */
export function validateBlock(b: ScreenBlock): string | null {
  switch (b.kind) {
    case 'heading':
    case 'text':
      return b.text ? null : `${b.kind} needs text`
    case 'cardGrid': {
      if (!b.cards?.length) return 'cardGrid needs at least one card id'
      // A SHORT `quantities` is normalised, not rejected — see `normalizeBlock`.
      // A LONG one still is: quantities for cards that are not there have no
      // reading that is not a guess about which ones were meant.
      if (b.quantities && b.quantities.length > b.cards.length) {
        return 'more quantities than cards — one per card, or leave the rest off'
      }
      if (b.quantities?.some((q) => q < 1)) return 'a quantity below 1 is not a card you own'
      return null
    }
    case 'statTile':
      return b.text && b.value ? null : 'statTile needs both text and value'
    case 'progress':
      return typeof b.percent === 'number' ? null : 'progress needs a percent'
    case 'status':
      return b.text ? null : 'status needs a message'
    case 'empty':
      return b.text ? null : 'empty needs something to say'
    case 'table': {
      if (!b.columns?.length) return 'table needs columns'
      if (!b.rows?.length) return 'table needs at least one row'
      // ONE CELL PER COLUMN, EXACTLY. A short row is the case that most looks
      // like it deserves the `quantities` treatment and most does not: padding
      // "Charizard | 4" out to three columns means inventing which column the
      // missing figure belongs to, and a table of figures with a number under
      // the wrong heading is worse than no table. See `normalizeBlock` for why
      // `quantities` is genuinely different.
      const wrong = b.rows.findIndex((r) => r.length !== b.columns!.length)
      if (wrong >= 0) {
        return `table row ${wrong + 1} has ${b.rows[wrong]!.length} cells but the table has ${b.columns.length} columns — one cell per column`
      }
      return null
    }
    case 'group': {
      if (!b.left?.length || !b.right?.length) {
        return 'group needs blocks in both columns — one column is not a comparison'
      }
      // THE DEPTH LIMIT, ENFORCED TWICE. The schema already cannot express a
      // group inside a group, because a column is typed as a leaf block. This
      // says it again in code because `validateBlock` is exported and callable
      // on hand-built objects that never went through the schema, and a rule
      // that holds only for one of its two entrances is not a rule.
      for (const side of ['left', 'right'] as const) {
        const column = (b[side] ?? []) as ScreenBlock[]
        for (const [i, inner] of column.entries()) {
          if (inner.kind === 'group') {
            return `group.${side}[${i}]: a group cannot contain another group`
          }
          const bad = validateBlock(inner)
          if (bad) return `group.${side}[${i}]: ${bad}`
        }
      }
      return null
    }
    default:
      return `unknown block "${String((b as { kind?: string }).kind)}"`
  }
}

/**
 * Fill in what has an unambiguous reading, before judging the block.
 *
 * ONLY ONE THING QUALIFIES, and it earns it: a `quantities` array shorter than
 * `cards`. Omitting `quantities` ALTOGETHER already means every card is a
 * single, so "the ones I did not mention are singles" is not a guess about
 * intent — it is the same rule the field already follows. Rejecting a partial
 * array while accepting an absent one was an inconsistency in this schema rather
 * than a safety property, and it was the single most common rejection in
 * practice: models naturally list quantities only where they differ from one.
 *
 * This is NOT a licence to clamp generally. Everything else still rejects
 * loudly, because a model that is silently corrected learns nothing and repeats
 * the mistake next turn. In particular a short table row is NOT normalised —
 * see `validateBlock`'s `table` case for why that one has no unambiguous
 * reading even though it looks like the same shape of mistake.
 */
function fillQuantities<T extends { kind: string; cards?: string[]; quantities?: number[] }>(
  b: T,
): T {
  if (b.kind !== 'cardGrid' || !b.cards || !b.quantities) return b
  if (b.quantities.length >= b.cards.length) return b
  const quantities = [...b.quantities]
  while (quantities.length < b.cards.length) quantities.push(1)
  return { ...b, quantities }
}

/**
 * The one allowed clamp, applied at both levels a `cardGrid` can appear at.
 *
 * A grid inside a group is the same grid; having the short-`quantities` rule
 * apply at the top level and silently not apply one level in would be exactly
 * the kind of inconsistency the rule was introduced to remove.
 */
function normalizeBlock(b: ScreenBlock): ScreenBlock {
  if (b.kind !== 'group') return fillQuantities(b)
  if (!b.left && !b.right) return b
  return {
    ...b,
    ...(b.left ? { left: b.left.map(fillQuantities) } : {}),
    ...(b.right ? { right: b.right.map(fillQuantities) } : {}),
  }
}

/** Every card id this block would put on screen, one level of nesting included. */
function cardCount(b: ScreenBlock): number {
  if (b.kind === 'cardGrid') return b.cards?.length ?? 0
  if (b.kind !== 'group') return 0
  return [...(b.left ?? []), ...(b.right ?? [])].reduce(
    (n, inner) => n + (inner.kind === 'cardGrid' ? (inner.cards?.length ?? 0) : 0),
    0,
  )
}

/**
 * Drop what cannot be rendered, keep what can, and say what went.
 *
 * A screen is a RESULT — usually "here is what I just added" — so a single bad
 * block must not take the rest of it down. What the reader loses is one panel;
 * what they would lose otherwise is the confirmation that their cards went in.
 */
export function sanitizeScreen(screen: Screen): { screen: Screen; dropped: string[] } {
  const dropped: string[] = []
  const blocks: ScreenBlock[] = []
  let cardsSpent = 0
  screen.blocks.forEach((raw, i) => {
    const b = normalizeBlock(raw)
    const bad = validateBlock(b)
    if (bad) {
      dropped.push(`blocks[${i}]: ${bad}`)
      return
    }
    const cards = cardCount(b)
    if (cardsSpent + cards > SCREEN_CARD_BUDGET) {
      dropped.push(
        `blocks[${i}]: ${cards} more cards would put this screen over ${SCREEN_CARD_BUDGET} — show fewer, or send a second screen`,
      )
      return
    }
    cardsSpent += cards
    blocks.push(b)
  })
  return { screen: { ...screen, blocks }, dropped }
}
