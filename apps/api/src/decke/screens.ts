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
 */
import { z } from 'zod'

/**
 * The component palette.
 *
 * Chosen because their props are enums and primitives with no free-text styling
 * surface. `Sheet` is deliberately absent: it is the container a screen is
 * rendered INSIDE, not a block a model picks.
 */
export const BLOCK_KINDS = [
  'heading',
  'text',
  'cardGrid',
  'statTile',
  'progress',
  'status',
  'empty',
] as const

export type BlockKind = (typeof BLOCK_KINDS)[number]

const blockSchema = z.object({
  kind: z.enum(BLOCK_KINDS).describe('Which component this block is.'),
  text: z
    .string()
    .max(280)
    .optional()
    .describe('heading/text/statTile label/status message/empty title. Plain prose, never markup.'),
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
})

export type ScreenBlock = z.infer<typeof blockSchema>

export const screenSchema = z.object({
  title: z.string().max(80).describe('What this screen is. Shown as its header.'),
  blocks: z.array(blockSchema).min(1).max(8).describe('Rendered in order.'),
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
 * the mistake next turn.
 */
function normalizeBlock(b: ScreenBlock): ScreenBlock {
  if (b.kind !== 'cardGrid' || !b.cards || !b.quantities) return b
  if (b.quantities.length >= b.cards.length) return b
  const quantities = [...b.quantities]
  while (quantities.length < b.cards.length) quantities.push(1)
  return { ...b, quantities }
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
  screen.blocks.forEach((raw, i) => {
    const b = normalizeBlock(raw)
    const bad = validateBlock(b)
    if (bad) dropped.push(`blocks[${i}]: ${bad}`)
    else blocks.push(b)
  })
  return { screen: { ...screen, blocks }, dropped }
}
