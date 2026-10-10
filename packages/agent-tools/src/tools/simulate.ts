import { z } from 'zod'
import type { Ctx } from '../ctx.js'
import { needDeck } from '../entities.js'
import { defineTool, type ToolDefinition } from '../registry.js'
import { fail, ok, type ToolResult } from '../result.js'
import { errText } from '../shared.js'
import { cardLine } from './deckCheck.js'

/**
 * `simulate_battles` — DeckPal's battle simulator (@deckpal/sim, behind
 * `POST /decks/simulate`) for both assistants. Read-only: the games are a
 * computation over decklists and are never stored; battle_logs stays the
 * record of games people actually played.
 *
 * The description below is the whole of what teaches a model to use this
 * well, and most of it is about what the numbers are NOT: a heuristic bot's
 * results, with a sample size, an interval, and a list of cards it plays only
 * approximately. The report repeats all of that in its text, because a model
 * that reads only the numbers will present them as real win rates.
 */

export interface SimulateBattlesInput {
  deck_id?: string
  cards?: Array<{ name?: string; card_id?: string; quantity: number }>
  ptcgl_text?: string
  name?: string
  format?: string
  opponents?: string[]
  games?: number
  seed?: number
}

export const simulateBattlesInputSchema = z.object({
  deck_id: z.string().trim().min(1).max(200).optional()
    .describe("The deck to test: one of the user's saved decks, by id or name. Omit it to test an unsaved list given as cards or ptcgl_text."),
  cards: z.array(cardLine).min(1).max(60).optional()
    .describe('An unsaved list to test instead of deck_id, in the same shape check_deck takes. Run check_deck on it first.'),
  ptcgl_text: z.string().trim().min(1).max(8_000).optional()
    .describe('An unsaved list as PTCG Live export text, instead of deck_id or cards.'),
  name: z.string().trim().min(1).max(80).optional()
    .describe('A label for an unsaved list in the report (for example "v4 with 2 Gwynn").'),
  format: z.string().trim().min(1).max(24).optional()
    .describe('Format used to resolve card names in an unsaved list; default standard.'),
  opponents: z.array(z.string().trim().min(1).max(200)).min(1).max(8).optional()
    .describe("Opponent decks, by id or name, from the user's saved decks (scouting lists of real opponents count). Default: up to 6 of the user's other decks."),
  games: z.number().int().min(2).max(200).optional()
    .describe('Games per opponent, default 24, at most 200; rounded up to an even number. More games means narrower intervals but a longer run. The whole call stops at about 25 seconds and reports how many games it actually played.'),
  seed: z.number().int().min(0).max(2_147_483_647).optional()
    .describe('Random seed, default 1. The same seed, deck and opponents replay the same games. Keep it the same when comparing two versions of a deck.'),
}).refine((input) => Number(input.deck_id !== undefined) + Number(input.cards !== undefined) + Number(input.ptcgl_text !== undefined) === 1, {
  message: 'Provide exactly one of deck_id, cards or ptcgl_text.',
})

interface SimulateResponse {
  text: string
  report: Record<string, unknown>
}

export async function simulateBattles(ctx: Ctx, input: SimulateBattlesInput): Promise<ToolResult> {
  const body: Record<string, unknown> = {}
  if (input.deck_id !== undefined) {
    // Loose, like every read: a near match costs a sentence at worst.
    const picked = await needDeck(ctx, input.deck_id)
    if (!picked.ok) return fail(picked.message)
    body.deck_id = picked.value.id
  } else {
    if (input.cards !== undefined) body.cards = input.cards
    if (input.ptcgl_text !== undefined) body.ptcgl_text = input.ptcgl_text
    if (input.name !== undefined) body.name = input.name
    if (input.format !== undefined) body.format = input.format
  }
  if (input.opponents !== undefined) {
    const ids: string[] = []
    for (const ref of input.opponents) {
      const picked = await needDeck(ctx, ref)
      if (!picked.ok) return fail(`Opponent ${picked.message}`)
      ids.push(picked.value.id)
    }
    body.opponents = ids
  }
  if (input.games !== undefined) body.games = input.games
  if (input.seed !== undefined) body.seed = input.seed
  const result = (await ctx.api.send('POST', '/decks/simulate', body)) as SimulateResponse
  return ok(result.text, result.report)
}

export const simulateBattlesTool: ToolDefinition = defineTool({
  name: 'simulate_battles',
  title: 'Simulate battles',
  description:
    "Play simulated games between one of the user's decks (or an unsaved list) and other decks in DeckPal's rules engine, " +
    'with a heuristic CPU playing both sides, and get the numbers back. Use it to test a list against a field of opponents, ' +
    "to find a deck's weak matchups, or to check a change: run the old and the new version with the same opponents and seed and compare. " +
    'Returns, per opponent: wins, losses, draws and time-outs; win rate with its 95% interval and sample size; going-first and ' +
    'going-second splits; game length and how games were won or lost; how fast each side starts attacking; which Pokémon took ' +
    'and gave up the most Prizes; and patterns in the losses. Also: which cards played early go with winning (an association, ' +
    'not a cause), and which cards the engine only approximates or cannot play, which skews any matchup they are in. ' +
    'These are simulations by a bot, not real games. When you report them, say so, give the n and the interval with every rate, ' +
    'treat differences whose intervals overlap as noise, and never present them as real-world or ladder win rates. ' +
    'A run takes up to about 25 seconds.',
  inputSchema: simulateBattlesInputSchema,
  annotations: { readOnlyHint: true, idempotentHint: true },
  handler: async (input, ctx): Promise<ToolResult> => {
    try {
      return await simulateBattles(ctx, input)
    } catch (err) {
      return fail(`simulate_battles failed: ${errText(err)}`)
    }
  },
})

export const simulateTools: ToolDefinition[] = [simulateBattlesTool]
