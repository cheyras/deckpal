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
 * What Deck-E is told, on his next turn, about a save the reader made with
 * the deck widget's own button — he did not call anything, so without this he
 * would not know. A version save names the version it landed on, or that the
 * deck already matched and nothing changed.
 */
export function savedDeckRecord({
  name,
  total,
  id,
  version,
}: {
  name: string
  total: number
  id: string
  version?: { number: number; changed: boolean }
}): { type: 'text'; text: string } {
  if (!version) {
    return {
      type: 'text',
      text: `[the reader saved the deck "${name}" from the deck widget — ${total} cards, deck id ${id}]`,
    }
  }
  return {
    type: 'text',
    text: version.changed
      ? `[the reader saved this list from the deck widget as v${version.number} of their deck "${name}" — ${total} cards, deck id ${id}]`
      : `[the reader saved this list from the deck widget as a new version of their deck "${name}", but it already matched v${version.number}, so nothing changed — deck id ${id}]`,
  }
}

export function replayPlan(assistantIndexFromEnd: number): 'full' | 'record' {
  return assistantIndexFromEnd < FULL_REPLAY_TURNS ? 'full' : 'record'
}
