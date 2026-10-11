import type { PendingApproval } from '../approval'

/**
 * The server's offer for one held `deep_think` call (`data-decke-deep-offer`).
 *
 * `token` binds this exact card to the reader's turn. It is replayed with the
 * answer (`approvalReplayPart`), and without it a yes never reaches Opus.
 * `estimate` is the server's credit range for a paid wallet and null for an
 * account that is not charged, which sees no price line.
 */
export type DeepThinkOffer = {
  toolCallId: string
  token: string
  estimate: { low: number; high: number } | null
}

/** What the card's primary button does right now. */
export type DeepThinkAction = 'approve' | 'top-up' | 'wait' | 'unavailable'

export type DeepThinkCardModel = {
  title: 'Deep Think'
  why: string
  plan: string
  /** Null for an uncharged account: no price line at all. */
  cost: string | null
  approveLabel: 'Use Deep Think'
  declineLabel: 'Keep it quick'
  highEstimate: number | null
  action: DeepThinkAction
  /** Why "Use Deep Think" is disabled, when it is. */
  hint: string | null
}

// Model prose belongs on the card because it explains the offer, but it must
// not be able to turn a consent prompt into an unbounded second answer. EQUAL
// to the `deep_think` schema's `why` and `plan` maxima in
// `apps/api/src/decke/tools.ts` (pinned by `deepThinkCard.test.ts`), so a
// valid call is shown whole and only a malformed one is clipped.
export const DEEP_THINK_WHY_LIMIT = 200
export const DEEP_THINK_PLAN_LIMIT = 300

function text(value: unknown, limit: number): string {
  if (typeof value !== 'string') return ''
  if (value.length <= limit) return value
  return `${value.slice(0, limit - 1)}…`
}

const credit = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

/** Read a `data-decke-deep-offer` part, or reject it. Nothing in it is guessed. */
export function parseDeepThinkOffer(data: unknown): DeepThinkOffer | null {
  if (!data || typeof data !== 'object') return null
  const { toolCallId, token, estimate } = data as Record<string, unknown>
  if (typeof toolCallId !== 'string' || toolCallId.trim().length === 0) return null
  if (typeof token !== 'string' || token.length === 0 || token.length > 200) return null
  if (estimate === null) return { toolCallId, token, estimate: null }
  if (!estimate || typeof estimate !== 'object') return null
  const { low, high } = estimate as Record<string, unknown>
  if (!credit(low) || !credit(high) || high < low) return null
  return { toolCallId, token, estimate: { low, high } }
}

function usableOffer(
  approval: Pick<PendingApproval, 'toolCallId'>,
  offer: DeepThinkOffer | null | undefined,
): offer is DeepThinkOffer {
  return !!offer && offer.toolCallId === approval.toolCallId && parseDeepThinkOffer(offer) !== null
}

/**
 * The reader-facing offer for a held `deep_think` call.
 *
 * The only numbers accepted here come from the server's keyed offer; `why` and
 * `plan` are model input and are never parsed for cost. "Use Deep Think" is
 * live only when it can work: an offer arrived for this call, and on a paid
 * wallet the balance is known (read after the card went up) — a priced yes
 * against an unknown balance is a guess the reader would pay for.
 */
export function deepThinkCard(
  approval: Pick<PendingApproval, 'name' | 'toolCallId' | 'input'>,
  offer?: DeepThinkOffer | null,
  wallet: { balance: number | null; canTopUp: boolean } = { balance: null, canTopUp: false },
): DeepThinkCardModel | null {
  if (approval.name !== 'deep_think') return null

  const base = {
    title: 'Deep Think' as const,
    why: text(approval.input.why, DEEP_THINK_WHY_LIMIT),
    plan: text(approval.input.plan, DEEP_THINK_PLAN_LIMIT),
    approveLabel: 'Use Deep Think' as const,
    declineLabel: 'Keep it quick' as const,
  }
  if (!usableOffer(approval, offer)) {
    return {
      ...base,
      cost: 'Costs more than a normal answer',
      highEstimate: null,
      action: 'unavailable',
      hint: "Deep Think can't start for this request.",
    }
  }
  if (offer.estimate === null) {
    return { ...base, cost: null, highEstimate: null, action: 'approve', hint: null }
  }
  const { low, high } = offer.estimate
  const priced = { ...base, cost: `About ${low}–${high} credits`, highEstimate: high }
  if (wallet.balance === null) return { ...priced, action: 'wait', hint: 'Checking your balance…' }
  // The HIGH end is the affordability threshold: approving when only the
  // optimistic low fits would put a likely meter stop behind a button that
  // just promised the opposite.
  if (wallet.balance < high && wallet.canTopUp) return { ...priced, action: 'top-up', hint: null }
  return { ...priced, action: 'approve', hint: null }
}
