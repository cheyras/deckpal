import { z } from 'zod'
import type { Ctx } from '../ctx.js'
import { defineTool, type ToolDefinition } from '../registry.js'
import { fail, ok, type ToolResult } from '../result.js'
import { errText } from '../shared.js'

export interface CheckDeckInput {
  format?: string
  cards?: Array<{ name?: string; card_id?: string; quantity: number }>
  ptcgl_text?: string
}
export interface DeckCheckLine {
  card_id: string | null
  name: string
  supertype: 'Pokémon' | 'Trainer' | 'Energy' | 'Unknown'
  quantity: number
  owned: number
  unit_price_usd: number | null
  resolved: boolean
  note?: string
}
export interface DeckCheckResult {
  format: string
  total: number
  legal: boolean | null
  issues: string[]
  evolution_gaps: string[]
  lines: DeckCheckLine[]
  owned: number
  missing_cost_usd: number | null
  ptcgl: string
}

export const cardLine = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  card_id: z.string().trim().min(1).max(40).optional(),
  quantity: z.number().int().min(1).max(60),
}).refine((line) => Number(line.name !== undefined) + Number(line.card_id !== undefined) === 1, {
  message: 'Provide exactly one of name or card_id.',
})

export const checkDeckInputSchema = z.object({
  format: z.string().trim().min(1).max(24).default('standard'),
  cards: z.array(cardLine).min(1).max(60).optional(),
  ptcgl_text: z.string().trim().min(1).max(8_000).optional(),
}).refine((input) => Number(input.cards !== undefined) + Number(input.ptcgl_text !== undefined) === 1, {
  message: 'Provide exactly one of cards or ptcgl_text.',
})

export async function checkDeck(ctx: Ctx, input: CheckDeckInput): Promise<DeckCheckResult> {
  return await ctx.api.send('POST', '/decks/check', input) as DeckCheckResult
}

export function renderDeckCheck(result: DeckCheckResult): string {
  const verdict = result.legal === true ? 'LEGAL'
    : result.legal === null ? 'COULD NOT JUDGE'
    : `NOT LEGAL — ${result.issues.length} issue${result.issues.length === 1 ? '' : 's'}`
  const lines = [`Checked ${result.total} cards (${result.format}): ${verdict}`]
  for (const section of ['Pokémon', 'Trainer', 'Energy', 'Unknown'] as const) {
    const rows = result.lines.filter((line) => line.supertype === section)
    if (!rows.length) continue
    lines.push(`${section}:`)
    for (const line of rows) {
      lines.push(`  ${line.quantity}× ${line.name} (${line.card_id ?? 'unresolved'}) — own ${line.owned}`)
      if (line.note) lines.push(`    ${line.note}`)
    }
  }
  if (result.issues.length) {
    lines.push('Issues:')
    for (const issue of result.issues) lines.push(`  - ${issue}`)
  }
  if (result.evolution_gaps.length) {
    lines.push('Evolution gaps:')
    for (const gap of result.evolution_gaps) lines.push(`  - ${gap}`)
  }
  lines.push(
    `You own ${result.owned}/${result.total}; missing costs ` +
      (result.missing_cost_usd === null ? 'cannot be estimated because a missing card is unpriced.' : `about $${result.missing_cost_usd.toFixed(2)}.`),
  )
  return lines.join('\n')
}

export const checkDeckTool: ToolDefinition = defineTool({
  name: 'check_deck',
  title: 'Check a deck list',
  description:
    'Run this on every complete deck list before showing or saving it. It accepts card names or catalog ids, checks legality, evolution gaps, ownership and missing cost. Fix everything it flags, then run it again before showDeck.',
  inputSchema: checkDeckInputSchema,
  annotations: { readOnlyHint: true, idempotentHint: true },
  handler: async (input, ctx): Promise<ToolResult> => {
    try {
      const result = await checkDeck(ctx, input)
      return ok(renderDeckCheck(result), result as unknown as Record<string, unknown>)
    } catch (err) {
      return fail(`check_deck failed: ${errText(err)}`)
    }
  },
})

export const deckCheckTools: ToolDefinition[] = [checkDeckTool]
