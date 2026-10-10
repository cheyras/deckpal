import { z } from 'zod'
import type { Ctx } from '../ctx.js'
import { needDeck, presentRef } from '../entities.js'
import { defineTool, type ToolDefinition } from '../registry.js'
import { fail, ok, type ToolResult } from '../result.js'
import { errText } from '../shared.js'
import { deckCardLine } from './deckCheck.js'

/**
 * `deck_odds` — opening-hand, Prize and draw odds, so neither assistant has to
 * do the arithmetic (or guess it) in prose.
 *
 * The owner once had Claude "run 60,000 drawings of an opening hand and
 * evaluate what percentage of those were setting me up well". Deck-E cannot
 * run code and a claude.ai session does it ad hoc, so the question now has a
 * tool: `POST /decks/odds` shuffles the list tens of thousands of times with a
 * fixed seed (`apps/api/src/deck/odds.ts` is the model) and this renders it.
 *
 * It is the first of a family of simulation tools — a battle simulator that
 * actually plays the cards comes later — so the text always says what was
 * measured, how, and on how many games, and it always says what it is NOT:
 * it draws cards, it does not play them.
 */

export const DECK_ODDS_KINDS = ['basic', 'pokemon', 'supporter', 'item', 'tool', 'stadium', 'energy'] as const

export interface DeckOddsQueryResult {
  label: string
  zone: 'hand' | 'seen' | 'prized'
  by_turn: number
  successes: number
  p: number
  margin95: number
  exact: number | null
}
export interface DeckOddsCardLine {
  name: string
  copies: number
  opening: number
  by_turn: number
  prized_any: number
  prized_all: number | null
}
/** Mirrors `DeckOddsResult` in apps/api/src/deck/odds.ts. */
export interface DeckOddsResult {
  deck: { name: string | null; size: number; basics: number; distinct_names: number }
  method: string
  trials: number
  seed: number | null
  mulligan: { simulated: number; exact: number; avg_per_game: number }
  avg_basics_in_hand: number
  queries: DeckOddsQueryResult[]
  per_card: DeckOddsCardLine[] | null
  per_card_turn: number
  max_margin95: number
  warnings: string[]
}

const group = z.object({
  cards: z.array(z.string().trim().min(1).max(80)).max(12).optional()
    .describe("Card names from this deck (case and accents ignored). A seen card counts if its name is any of these — list a search card (Ultra Ball, Buddy-Buddy Poffin, Nest Ball) here to count it as an out."),
  kinds: z.array(z.enum(DECK_ODDS_KINDS)).max(7).optional()
    .describe("Card kinds that count: 'basic' (Basic Pokémon), 'pokemon', 'supporter', 'item', 'tool' (Pokémon Tool), 'stadium', 'energy'. Combined with cards as OR."),
  count: z.number().int().min(1).max(60).default(1)
    .describe('How many matching cards this group needs. Default 1.'),
}).refine((g) => (g.cards?.length ?? 0) + (g.kinds?.length ?? 0) > 0, {
  message: 'A group needs at least one card name or kind.',
})

const query = z.object({
  label: z.string().trim().min(1).max(80).optional()
    .describe('Short name for this question, echoed in the result; the zone (opening hand, by turn N, prized) is added for you. Omit to have it described from the groups.'),
  all_of: z.array(group).min(1).max(6)
    .describe('Groups that must ALL be met. Each group is an OR over its names and kinds, with a count. Example: [{cards:["Shuppet"]}, {cards:["Buddy-Buddy Poffin","Ultra Ball"]}] = a Shuppet AND (a Poffin or an Ultra Ball).'),
  by_turn: z.number().int().min(0).max(10).default(0)
    .describe('0 = the kept opening hand only (default). N = that hand plus the cards drawn at the start of your first N turns (you draw on turn 1 too, going first or second). Prizes are never seen.'),
  prized: z.boolean().default(false)
    .describe('true = ask about the 6 Prize cards instead of the seen cards, e.g. "both Rare Candy prized" is {cards:["Rare Candy"], count:2}. by_turn does not apply.'),
}).refine((q) => !(q.prized && q.by_turn > 0), {
  message: 'by_turn does not apply to a prized query.',
})

export const deckOddsInputSchema = z.object({
  deck_id: z.string().trim().min(1).max(120).optional()
    .describe('A saved deck, by UUID or by NAME. Give exactly one of deck_id, cards or ptcgl_text.'),
  cards: z.array(deckCardLine).min(1).max(60).optional()
    .describe('An unsaved list, the same lines check_deck takes ({name | card_id, quantity}). Use it to test a hypothetical change without saving it.'),
  ptcgl_text: z.string().trim().min(1).max(8_000).optional()
    .describe('An unsaved list as PTCG Live export text.'),
  queries: z.array(query).max(12).optional()
    .describe('Questions to answer. Omit for the default report: every card\'s chance to be in the opening hand, seen by turn 2, and prized.'),
  trials: z.number().int().min(1_000).max(200_000).default(50_000)
    .describe('Shuffled games to simulate. Default 50,000 (±0.4 points at 95%); more only narrows the margin.'),
  seed: z.number().int().min(0).max(4_294_967_295).optional()
    .describe('RNG seed. Omit for the fixed default, so asking twice gives the same numbers.'),
}).refine((input) => Number(input.deck_id !== undefined) + Number(input.cards !== undefined) + Number(input.ptcgl_text !== undefined) === 1, {
  message: 'Provide exactly one of deck_id, cards or ptcgl_text.',
})

export type DeckOddsInput = z.output<typeof deckOddsInputSchema>

// ── Rendering ────────────────────────────────────────────────────────────────

const int = (n: number) => n.toLocaleString('en-US')

/** A probability as a percent, without pretending a tiny count is a precise rate. */
function pct(p: number, unit = '%'): string {
  if (p <= 0) return `0${unit}`
  if (p >= 1) return `100${unit}`
  if (p < 0.001) return `<0.1${unit}`
  if (p > 0.999) return `>99.9${unit}`
  return `${(p * 100).toFixed(1)}${unit}`
}

/** A closed-form value has no sampling noise, so a tiny one keeps two significant figures. */
function exactPct(p: number): string {
  return p > 0 && p < 0.001 ? `${(p * 100).toPrecision(2)}%` : pct(p)
}

function zoneText(q: Pick<DeckOddsQueryResult, 'zone' | 'by_turn'>): string {
  return q.zone === 'hand' ? 'opening hand' : q.zone === 'prized' ? 'prized' : `by your turn ${q.by_turn}`
}

function queryLine(q: DeckOddsQueryResult, i: number, trials: number): string {
  const extreme = q.p < 0.001 || q.p > 0.999
  const notes = [
    ...(extreme ? [`${int(q.successes)} of ${int(trials)} games`] : []),
    ...(q.exact === null ? [] : [`exact ${exactPct(q.exact)}`]),
  ]
  const zone = zoneText(q)
  // A label that already names its zone ("…, opening hand") is not told it twice.
  const name = q.label.toLowerCase().includes(zone) ? q.label : `${q.label}, ${zone}`
  return `${i + 1}. ${name}: ${pct(q.p)}${extreme ? '' : ` ±${(q.margin95 * 100).toFixed(1)}`}` +
    (notes.length ? ` (${notes.join('; ')})` : '')
}

export const DRAW_ONLY_CAVEAT =
  'Draw-only: this counts cards, it does not play them. Ultra Ball, Buddy-Buddy Poffin, Supporters and other ' +
  'search or draw cards are never used, so name them inside a group to count them as outs. These are draw odds, ' +
  'not setup odds; a battle simulator that plays the cards is coming.'

export function renderDeckOdds(r: DeckOddsResult): string {
  const name = r.deck.name ? `${r.deck.name} ` : 'Your list '
  const lines = [
    `Deck odds: ${name}(${r.deck.size} cards, ${r.deck.basics} Basic Pokémon)`,
    `Method: ${r.method}. ${int(r.trials)} shuffled games${r.seed === null ? '' : `, seed ${r.seed}`}. Each game: draw 7, ` +
      'mulligan until the hand has a Basic, set aside 6 Prizes, then draw one card at the start of each turn ' +
      '(turn 1 included). Hand odds are for the hand you keep.',
    `Mulligan: ${pct(r.mulligan.simulated)} of first hands (exact ${pct(r.mulligan.exact)}), ` +
      `${r.mulligan.avg_per_game.toFixed(2)} redraws per game. The kept hand holds ${r.avg_basics_in_hand.toFixed(1)} Basics on average.`,
  ]
  if (r.per_card) {
    lines.push(
      `Per card, % of games with at least one copy: opening hand / seen by your turn ${r.per_card_turn} / prized, ` +
        `then / every copy prized for multiples (each ±${(r.max_margin95 * 100).toFixed(1)} or better at 95%):`,
    )
    for (const c of r.per_card) {
      const cells = [c.opening, c.by_turn, c.prized_any, ...(c.prized_all === null ? [] : [c.prized_all])].map((p) => pct(p, ''))
      lines.push(`  ${c.copies} ${c.name}: ${cells.join(' / ')}`)
    }
  } else {
    lines.push('Queries (simulated, ± is the 95% margin; exact where one group has a closed form):')
    r.queries.forEach((q, i) => lines.push(`  ${queryLine(q, i, r.trials)}`))
  }
  for (const w of r.warnings) lines.push(`Note: ${w}`)
  lines.push(DRAW_ONLY_CAVEAT)
  return lines.join('\n')
}

export async function deckOddsCall(ctx: Ctx, body: Record<string, unknown>): Promise<DeckOddsResult> {
  return await ctx.api.send('POST', '/decks/odds', body) as DeckOddsResult
}

export const deckOddsTool: ToolDefinition = defineTool({
  name: 'deck_odds',
  title: 'Deck odds',
  description:
    'Opening-hand, Prize and draw odds for a deck, from tens of thousands of seeded shuffles (a repeat call gives ' +
    'the same numbers). Use it whenever someone asks how likely, how often, or what the odds are of opening, ' +
    'drawing or prizing something, or whether a change makes a list more consistent; never estimate odds yourself. ' +
    'Give a saved deck (deck_id, UUID or name) or any unsaved list (cards or ptcgl_text, as check_deck takes them), ' +
    'so a hypothetical change can be tested before it is saved. Without queries it reports every card; with ' +
    'queries it answers each one: the chance that ALL its groups are met in the opening hand, by turn N, or in the ' +
    'Prizes, with a 95% margin. Models a real setup (mulligan until a Basic, 6 Prizes, one draw a turn) but plays ' +
    'no cards: put search cards like Ultra Ball in a group to count them as outs. Read-only.',
  inputSchema: deckOddsInputSchema,
  annotations: { readOnlyHint: true, idempotentHint: true },
  handler: async (input, ctx): Promise<ToolResult> => {
    try {
      const body: Record<string, unknown> = {
        ...(input.queries?.length ? { queries: input.queries } : {}),
        trials: input.trials,
        ...(input.seed !== undefined ? { seed: input.seed } : {}),
      }
      let note: string | null = null
      if (input.deck_id !== undefined) {
        const ref = presentRef(input.deck_id)
        if (!ref) return fail('deck_odds needs a deck. The `decks` index lists every deck with its id; or pass the list as cards or ptcgl_text.')
        const picked = await needDeck(ctx, ref)
        if (!picked.ok) return fail(picked.message)
        body.deck_id = picked.value.id
        note = picked.note
      } else if (input.cards !== undefined) {
        body.cards = input.cards
      } else {
        body.ptcgl_text = input.ptcgl_text
      }
      const result = await deckOddsCall(ctx, body)
      const text = renderDeckOdds(result)
      return ok(note ? `${note}\n${text}` : text, result as unknown as Record<string, unknown>)
    } catch (err) {
      return fail(`deck_odds failed: ${errText(err)}`)
    }
  },
})

export const deckOddsTools: ToolDefinition[] = [deckOddsTool]
