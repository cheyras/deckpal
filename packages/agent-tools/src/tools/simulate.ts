import { z } from 'zod'
import type { Ctx } from '../ctx.js'
import { needDeck, resolveDeck } from '../entities.js'
import { defineTool, type ToolDefinition } from '../registry.js'
import { fail, ok, type ToolResult } from '../result.js'
import { errText } from '../shared.js'
import { deckCardLine as cardLine } from './deckCheck.js'

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
  speed?: 'strong' | 'fast'
  compare_with?: string
  compare_cards?: Array<{ name?: string; card_id?: string; quantity: number }>
  compare_ptcgl_text?: string
  compare_name?: string
  continue_token?: string
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
    .describe(
      "Opponent decks. A saved deck by id or name (scouting lists of real opponents count) — a saved deck always wins a name clash. " +
      "Or the built-in Standard META POOL: 'meta' is the top 6 archetypes by tournament share, 'meta:<archetype>' one of them (for example 'meta:Dragapult'; " +
      "a name that matches none of the user's decks also finds a pool archetype). The pool is one representative list per archetype from recent online " +
      "Limitless events (its as-of date, source and each list's event and record are in the report's opponent names and notes), refreshed by hand, so it is " +
      "a snapshot and not today's ladder. Use it when the user has no rivals saved or asks 'how does it do into the meta'. " +
      "Default: up to 6 of the user's other decks, and when they have none, the top 6 meta decks."),
  games: z.number().int().min(2).max(200).optional()
    .describe('Games per opponent, default 24, at most 200; rounded up to an even number. More games means narrower intervals but a longer run. The whole call stops at about 25 seconds and reports how many games it actually played. With continue_token it is the games to add on this call.'),
  speed: z.enum(['strong', 'fast']).optional()
    .describe("'strong' (default): a CPU that searches its whole turn — better play, about 1 second a game, so a run plays roughly 25–30 games in total. 'fast': a one-step CPU — weaker play but about 20× more games, for narrower intervals. Both are bots; say which one ran."),
  seed: z.number().int().min(0).max(2_147_483_647).optional()
    .describe('Random seed, default 1. The same seed, deck and opponents replay the same games. Keep it the same when comparing two versions of a deck.'),
  compare_with: z.string().trim().min(1).max(200).optional()
    .describe(
      'PAIRED COMPARISON — use this to check whether a change makes the deck better. A second version of the deck, one of ' +
      "the user's saved decks by id or name (or give it unsaved as compare_cards / compare_ptcgl_text). The deck from " +
      'deck_id/cards/ptcgl_text is A (before), this is B (after). Both versions play every opponent on the SAME seeds and ' +
      'seats, so luck mostly cancels and the result leads with the paired difference B − A, its 95% interval and a ' +
      'verdict that names a winner only when the interval excludes 0 — otherwise "no clear difference at this n", which ' +
      'is the usual honest answer for a one- or two-card change. Prefer this over two separate runs. The time budget is ' +
      "shared by both versions, so name 1–3 opponents and consider speed 'fast' to get enough games for a verdict.",
    ),
  compare_cards: z.array(cardLine).min(1).max(60).optional()
    .describe('Version B as an unsaved list in the same shape check_deck takes, instead of compare_with — e.g. the current deck with 2 Gwynn instead of 3. Give the WHOLE list, not just the changed lines.'),
  compare_ptcgl_text: z.string().trim().min(1).max(8_000).optional()
    .describe('Version B as PTCG Live export text, instead of compare_with or compare_cards.'),
  compare_name: z.string().trim().min(1).max(80).optional()
    .describe('A label for an unsaved version B (for example "v4 with 2 Gwynn").'),
  continue_token: z.string().trim().min(8).max(16_000).optional()
    .describe(
      'CONTINUE a run for a bigger sample. Every result ends with a continue_token line. To add games, call again with the SAME inputs ' +
      '(the same deck_id / cards, opponents, compare_* , speed, seed) plus that token: the new games are on new seeds, exactly the games ' +
      'one longer run would have played, and the result is CUMULATIVE ("Cumulative over 3 calls: 92 games…") with the interval at the ' +
      "cumulative n. games then means games to ADD on this call. Pass the token back exactly as given and use the newest one each time. " +
      'The token is signed and tied to the user and to the exact card lists: a deck edited since is refused (start a fresh run without it), ' +
      'as is a token older than 2 hours or after a deploy; a run allows at most 12 calls. Cumulative results leave out the per-call detail ' +
      '(card impact, Prize rows) that the first call shows. Continue only when the user asks for more certainty or the answer is not yet ' +
      'decided; stop once the verdict is clear or the intervals are narrow enough to act on — two or three continuations is usually plenty.',
    ),
}).refine((input) => Number(input.deck_id !== undefined) + Number(input.cards !== undefined) + Number(input.ptcgl_text !== undefined) === 1, {
  message: 'Provide exactly one of deck_id, cards or ptcgl_text.',
}).refine((input) => Number(input.compare_with !== undefined) + Number(input.compare_cards !== undefined) + Number(input.compare_ptcgl_text !== undefined) <= 1, {
  message: 'Provide at most one of compare_with, compare_cards or compare_ptcgl_text.',
})

interface SimulateResponse {
  text: string
  report: Record<string, unknown>
}

/** 'meta' or 'meta:<archetype>': the built-in meta pool, passed through to the API as written. */
export const isMetaRef = (ref: string): boolean => /^meta\s*(:|$)/i.test(ref.trim())

/** A reference that is a name, not a deck id: the API may still find it in the meta pool. */
const looksLikeName = (ref: string): boolean => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ref.trim())

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
      // The built-in meta pool is the API's to resolve; so is a name that matches none of the user's decks (it may be an archetype).
      if (isMetaRef(ref)) {
        ids.push(ref)
        continue
      }
      const found = await resolveDeck(ctx, ref)
      if (found.kind === 'found') {
        ids.push(found.value.id)
        continue
      }
      // Only a name that matches NO saved deck may be a pool archetype; an ambiguous one keeps the usual candidate list.
      if (found.kind === 'not-found' && looksLikeName(ref)) {
        ids.push(ref)
        continue
      }
      const missed = await needDeck(ctx, ref)
      return fail(`Opponent ${missed.ok ? 'is ambiguous' : missed.message}`)
    }
    body.opponents = ids
  }
  if (input.compare_with !== undefined) {
    const picked = await needDeck(ctx, input.compare_with)
    if (!picked.ok) return fail(`compare_with: ${picked.message}`)
    body.compare_with = picked.value.id
  } else {
    if (input.compare_cards !== undefined) body.compare_cards = input.compare_cards
    if (input.compare_ptcgl_text !== undefined) body.compare_ptcgl_text = input.compare_ptcgl_text
    if (input.compare_name !== undefined) body.compare_name = input.compare_name
  }
  if (input.games !== undefined) body.games = input.games
  if (input.seed !== undefined) body.seed = input.seed
  if (input.speed !== undefined) body.speed = input.speed
  if (input.continue_token !== undefined) body.continue_token = input.continue_token
  const result = (await ctx.api.send('POST', '/decks/simulate', body)) as SimulateResponse
  return ok(result.text, result.report)
}

export const simulateBattlesTool: ToolDefinition = defineTool({
  name: 'simulate_battles',
  title: 'Simulate battles',
  // Trimmed 2026-10-14 to make room in tools/list for `playbook`; how to use it in a job is in the deck-tune playbook.
  description:
    "Play simulated games between one of the user's decks (or an unsaved list) and other decks in DeckPal's rules engine, " +
    'a heuristic CPU on both sides. Test a list against a field, find weak matchups, or check a change: pass the new ' +
    'version as compare_with (or compare_cards / compare_ptcgl_text) and both play the same opponents on the same seeds; ' +
    'the result leads with the paired difference and a verdict. Per opponent: wins, losses, draws, time-outs, win rate ' +
    'with its 95% interval and n, going-first/second splits, game length, Prize takers, loss patterns, and the cards the ' +
    "engine approximates. Opponents: the user's saved decks or the built-in Standard meta pool ('meta', 'meta:<archetype>'). " +
    "These are a bot's games: say so, give n and the interval with every rate, treat overlapping intervals as noise, never " +
    'call them real-world win rates. A run is a few dozen games in up to ~25 s; for more certainty call again with the ' +
    'continue_token it ends with (games add up; editing the deck starts afresh), a few times at most.',
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
