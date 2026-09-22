import { approvalReplayPart, type PendingApproval, type Verdict } from './approval'

export type ReplayPendingTool = {
  id: string
  name: string
  input: Record<string, unknown>
}

export type ReplayPart = Record<string, unknown>

/**
 * Finish one streamed leg in wire order.
 *
 * Browser tools have already been requested by the model, while approval-held
 * writes have not run. Mixed legs must therefore execute and record every
 * browser tool first, then append approval answers last. The AI SDK only
 * collects approvals from the final replay message; nothing may follow them.
 * Returning null is an aborted leg, so neither later browser calls nor approval
 * answers can leak into a subsequent request.
 */
export async function replayLegParts({
  prefix,
  pending,
  approvals,
  answers,
  signal,
  runPending,
}: {
  prefix: ReplayPart[]
  pending: ReplayPendingTool[]
  approvals: PendingApproval[]
  answers?: Map<string, Verdict>
  signal: AbortSignal
  runPending: (call: ReplayPendingTool) => Promise<ReplayPart>
}): Promise<ReplayPart[] | null> {
  if (signal.aborted) return null
  const parts = [...prefix]
  for (const call of pending) {
    if (signal.aborted) return null
    parts.push(await runPending(call))
    if (signal.aborted) return null
  }
  for (const approval of approvals) {
    const verdict = answers?.get(approval.approvalId)
    const approved = verdict?.approved === true
    parts.push(
      approvalReplayPart(
        approval,
        approved,
        approved ? undefined : verdict?.reason,
      ) as ReplayPart,
    )
  }
  return parts
}
