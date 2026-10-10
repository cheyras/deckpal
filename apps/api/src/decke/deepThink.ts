import type { PathwayName } from './pathways/names.js'

export const DEEP_THINK_TOOL = 'deep_think'

/**
 * The approved card belongs to the reader's latest message, not the whole
 * conversation. A completed Deep Think turn must not silently put every later
 * turn on Opus just because its approved tool part remains in history.
 *
 * This routing read is safe only because chat passes the same replay through
 * ai@7.0.113 with `experimental_toolApprovalSecret` before any tool or model
 * work. The installed SDK reconstructs the approval in
 * `convert-to-model-messages.ts`, then `stream-text.ts` calls
 * `validateApprovedToolApprovals`; `validate-tool-approvals.ts` verifies the
 * HMAC over approval id, call id, tool name and input and throws on a missing
 * or invalid signature. In other words, a forged approved part fails before
 * the approved run starts rather than becoming authority here.
 */
export function deepApprovedThisTurn(messages: unknown): boolean {
  if (!Array.isArray(messages)) return false
  let latestUser = -1
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === 'user') {
      latestUser = i
      break
    }
  }
  if (latestUser < 0) return false

  for (const message of messages.slice(latestUser + 1)) {
    if (!Array.isArray(message?.parts)) continue
    for (const part of message.parts) {
      if (part?.type !== `tool-${DEEP_THINK_TOOL}`) continue
      if (part.state === 'approval-responded' && part.approval?.approved === true) return true
      if (part.state === 'output-available' && part.approval?.approved === true) return true
    }
  }
  return false
}

export type DeepThinkEstimate = { low: number; high: number }

/**
 * Credits are cents. At Opus 5.5's 2026-10-10 Gateway rates ($4/M input,
 * $20/M output), the analysis band is 25k input + 15k output = $0.40 and
 * 100k + 40k = $1.20. A full deck build commonly re-reads more catalog and
 * check output: 50k + 20k = $0.60 through 150k + 60k = $1.80. These are
 * aggregate billable tokens across the request's steps, not one prompt's
 * context window. The model never supplies or edits these server numbers.
 */
const ESTIMATE_BY_PATHWAY: Readonly<Record<PathwayName, DeepThinkEstimate>> = {
  battle_log: { low: 40, high: 120 },
  battle_review: { low: 40, high: 120 },
  deck_build: { low: 60, high: 180 },
  deck_iterate: { low: 60, high: 180 },
  collection_plan: { low: 40, high: 120 },
  lists: { low: 40, high: 120 },
  price_value: { low: 40, high: 120 },
  card_rules: { low: 40, high: 120 },
  research: { low: 40, high: 120 },
  navigate: { low: 40, high: 120 },
  small_talk: { low: 40, high: 120 },
  general: { low: 40, high: 120 },
}

const DEFAULT_ESTIMATE = ESTIMATE_BY_PATHWAY.general

export function estimateCredits(pathways: readonly PathwayName[]): DeepThinkEstimate {
  const estimates = pathways.length > 0
    ? pathways.map((pathway) => ESTIMATE_BY_PATHWAY[pathway])
    : [DEFAULT_ESTIMATE]
  return {
    low: Math.max(...estimates.map((estimate) => estimate.low)),
    high: Math.max(...estimates.map((estimate) => estimate.high)),
  }
}

/** Today's ordinary leg hold is 25 credits, so Deep Think reserves up to 200. */
export const DEEP_HOLD_MULTIPLIER = 8
