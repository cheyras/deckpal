import type { PendingApproval } from '../approval'

/** Server-authored price range for the exact held call. */
export type DeepThinkEstimate = {
  toolCallId: string
  low: number
  high: number
}

export type DeepThinkCardModel = {
  title: 'Deep Think'
  why: string
  plan: string
  cost: string
  approveLabel: 'Use Deep Think'
  declineLabel: 'Keep it quick'
  highEstimate: number | null
}

// Model prose belongs on the card because it explains the offer, but it must
// not be able to turn a consent prompt into an unbounded second answer.
export const DEEP_THINK_WHY_LIMIT = 240
export const DEEP_THINK_PLAN_LIMIT = 180

function text(value: unknown, limit: number): string {
  if (typeof value !== 'string') return ''
  if (value.length <= limit) return value
  return `${value.slice(0, limit - 1)}…`
}

function usableEstimate(
  approval: Pick<PendingApproval, 'toolCallId'>,
  estimate: DeepThinkEstimate | null | undefined,
): estimate is DeepThinkEstimate {
  return !!estimate
    && estimate.toolCallId === approval.toolCallId
    && Number.isInteger(estimate.low)
    && Number.isInteger(estimate.high)
    && estimate.low >= 0
    && estimate.high >= estimate.low
}

/**
 * The reader-facing offer for a held `deep_think` call.
 *
 * The only numbers accepted here come from the server's keyed estimate part.
 * `why` and `plan` are model input and are deliberately never parsed for cost.
 */
export function deepThinkCard(
  approval: Pick<PendingApproval, 'name' | 'toolCallId' | 'input'>,
  estimate?: DeepThinkEstimate | null,
): DeepThinkCardModel | null {
  if (approval.name !== 'deep_think') return null

  const priced = usableEstimate(approval, estimate)
  return {
    title: 'Deep Think',
    why: text(approval.input.why, DEEP_THINK_WHY_LIMIT),
    plan: text(approval.input.plan, DEEP_THINK_PLAN_LIMIT),
    cost: priced
      ? `About ${estimate.low}–${estimate.high} credits`
      : 'Costs more than a normal answer',
    approveLabel: 'Use Deep Think',
    declineLabel: 'Keep it quick',
    highEstimate: priced ? estimate.high : null,
  }
}
