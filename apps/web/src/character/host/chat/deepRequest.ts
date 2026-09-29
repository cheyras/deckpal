/**
 * Compatibility surface for the approval card.
 *
 * Deck-E no longer asks permission for analysis, research, or planning, so
 * there is no paid "deep request" to restate or quote on a consent card. The
 * component still imports these helpers while write approvals use the same UI;
 * null keeps that obsolete block absent without coupling the presentation lane
 * to this rollout.
 */

export type DeepCost = { credits: number; balance: number }
export type DeepQuote = { analysis: number; planDeck: number; chatTurn: number; balance: number | null }

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
