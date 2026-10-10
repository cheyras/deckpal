/**
 * Compatibility surface for the approval card.
 *
 * The old paid-tool menu is gone. Deep Think is one explicit `deep_think`
 * approval whose copy and server-computed range live in `deepThinkCard.ts`.
 * These helpers remain only because the host still shares its wallet balance
 * with the approval surface; they must not revive prices for retired tools.
 */

export type DeepCost = { credits: number; balance: number }
export type DeepQuote = { balance: number | null }

export const DEEP_COST_NOTE = 'This takes longer and uses more than a normal answer.'

export function deepRequestLine(_name: string, _input: unknown): null {
  return null
}

export function deepCost(_name: string, _quote: DeepQuote | null | undefined): null {
  return null
}

export function isShort(cost: DeepCost | null | undefined): boolean {
  return !!cost && cost.balance < cost.credits
}

const credits = (n: number) => `${n} credit${n === 1 ? '' : 's'}`

/** Retained for a legacy non-null prop; new Deck-E approval cards pass null. */
export function deepCostLine(cost: DeepCost | null | undefined): string {
  if (!cost) return DEEP_COST_NOTE
  if (isShort(cost)) return `This needs ${credits(cost.credits)} and you have ${cost.balance}.`
  return `This takes longer than a normal answer and uses ${credits(cost.credits)} of your ${cost.balance}.`
}
