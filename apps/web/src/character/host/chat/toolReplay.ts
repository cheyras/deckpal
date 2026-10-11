import { DECLINED_REASON } from '../approval'
import { failureParts, type FailurePart } from './lookupRecord'

/** Recent assistant turns keep their real tool results instead of summaries. */
export const FULL_REPLAY_TURNS = 6

/** Bounds one result before it becomes recurring conversation history. */
export const TOOL_OUTPUT_MAX_CHARS = 12_000

const TRIMMED_MARKER = '\n[… trimmed for length …]'

export type ReplayChip = {
  id: string
  name: string
  phase: string
  args?: Record<string, unknown>
  output?: unknown
  summary?: string
  reason?: 'timeout' | 'truncated'
  approvalId?: string
  declineReason?: string
}

export type AvailableReplayPart = {
  type: string
  toolCallId: string
  input: Record<string, unknown>
  state: 'output-available'
  output: string
}

export type DeniedReplayPart = {
  type: string
  toolCallId: string
  input: Record<string, unknown>
  state: 'output-denied'
  approval: { id: string; approved: false; reason: string }
}

export type ToolReplayPart = AvailableReplayPart | DeniedReplayPart | FailurePart

/** Declines stay exact for the whole browser window, not only full-replay turns. */
export function declineParts(
  chips: readonly ReplayChip[],
  opts: { isServerTool: (name: string) => boolean },
): DeniedReplayPart[] {
  return chips.flatMap((chip) => {
    if (chip.phase !== 'declined' || chip.name === 'express' || !opts.isServerTool(chip.name)) return []
    return [{
      type: `tool-${chip.name}`,
      toolCallId: chip.id,
      input: chip.args ?? {},
      state: 'output-denied' as const,
      approval: {
        id: chip.approvalId ?? `replay-${chip.id}`,
        approved: false as const,
        reason: chip.declineReason ?? DECLINED_REASON,
      },
    }]
  })
}

/** Convert a captured SDK output to bounded text suitable for replay. */
export function capOutput(output: unknown): string {
  const value = typeof output === 'string'
    ? output
    : (JSON.stringify(output) ?? String(output))
  return value.length > TOOL_OUTPUT_MAX_CHARS
    ? `${value.slice(0, TOOL_OUTPUT_MAX_CHARS)}${TRIMMED_MARKER}`
    : value
}

/**
 * Rebuild finished server calls in their original order.
 *
 * A summary-only success is returned separately so rollout callers can retain
 * the compact lookup record for old chips that never captured their output.
 */
export function toolReplayParts(
  chips: readonly ReplayChip[],
  opts: { isServerTool: (name: string) => boolean },
): { parts: ToolReplayPart[]; unrecorded: ReplayChip[] } {
  const parts: ToolReplayPart[] = []
  const unrecorded: ReplayChip[] = []
  const failures = new Map(failureParts(chips).map((part) => [part.toolCallId, part]))
  const declines = new Map(declineParts(chips, opts).map((part) => [part.toolCallId, part]))

  for (const chip of chips) {
    if (chip.name === 'express' || !opts.isServerTool(chip.name)) continue

    if ((chip.phase === 'ok' || chip.phase === 'partial') && chip.output !== undefined) {
      parts.push({
        type: `tool-${chip.name}`,
        toolCallId: chip.id,
        input: chip.args ?? {},
        state: 'output-available',
        output: capOutput(chip.output),
      })
    } else if (chip.phase === 'ok' || chip.phase === 'partial') {
      unrecorded.push(chip)
    } else if (chip.phase === 'declined') {
      const decline = declines.get(chip.id)
      if (decline) parts.push(decline)
    } else if (chip.phase === 'error') {
      const failure = failures.get(chip.id)
      if (failure) parts.push(failure)
    }
  }

  return { parts, unrecorded }
}

/**
 * Approved calls whose RESULT is replayed in place of their approval answer.
 *
 * The approval answer is a one-leg message: the SDK reads it only at the end
 * of the final message, runs the call, and streams its output. Left in the
 * wire after that, it is a tool call with no result on every later leg — an
 * unpaired call a provider rejects — and its output (for `deep_think`, the
 * grant that keeps the turn on Deep) would never reach the server again. The
 * call's chip cannot carry it either: it was marked replayed on the leg that
 * answered it. Only `deep_think` today; writes keep their existing replay.
 */
export const RESULT_REPLAYED_APPROVALS: ReadonlySet<string> = new Set(['deep_think'])

type WirePartLike = Record<string, unknown>
type WireMessageLike = { role: string; parts: WirePartLike[] }

/**
 * The wire with each approved, now-answered call in `names` turned into the
 * finished tool part it became: same call, its captured output, no approval.
 * Only the reader's current turn is touched, and only a call whose output
 * actually arrived; everything else is returned as it was.
 */
export function settleApprovedCalls<T extends WireMessageLike>(
  wire: readonly T[],
  outputs: ReadonlyMap<string, string>,
  names: ReadonlySet<string> = RESULT_REPLAYED_APPROVALS,
): T[] {
  let current = wire.length - 1
  while (current >= 0 && wire[current]!.role !== 'user') current--
  return wire.map((message, index) => {
    if (index <= current) return message
    let changed = false
    const parts = message.parts.map((part) => {
      const type = typeof part.type === 'string' ? part.type : ''
      const id = typeof part.toolCallId === 'string' ? part.toolCallId : ''
      const approval = part.approval as { approved?: unknown } | undefined
      if (
        part.state !== 'approval-responded' ||
        approval?.approved !== true ||
        !type.startsWith('tool-') ||
        !names.has(type.slice('tool-'.length)) ||
        !outputs.has(id)
      ) return part
      changed = true
      return {
        type,
        toolCallId: id,
        input: (part.input ?? {}) as Record<string, unknown>,
        state: 'output-available',
        output: outputs.get(id)!,
      }
    })
    return changed ? { ...message, parts } : message
  })
}

export function savedDeckRecord({
  name,
  total,
  id,
}: {
  name: string
  total: number
  id: string
}): { type: 'text'; text: string } {
  return {
    type: 'text',
    text: `[the reader saved the deck "${name}" from the deck widget — ${total} cards, deck id ${id}]`,
  }
}

export function replayPlan(assistantIndexFromEnd: number): 'full' | 'record' {
  return assistantIndexFromEnd < FULL_REPLAY_TURNS ? 'full' : 'record'
}
