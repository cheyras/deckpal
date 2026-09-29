/** Pure presentation rules for the deck widget, kept outside the streamed UI. */

export type DeckLegality = boolean | null

export type DeckHeader = {
  count: string
  countTone: 'good' | 'warn'
  legality: 'Legal' | 'Not legal' | 'Unchecked'
  legalityTone: 'good' | 'bad' | 'neutral'
  ownership: string
}

export function deckHeader(input: {
  total: number
  legal: DeckLegality
  owned: number
  missingCostUsd: number | null
}): DeckHeader {
  const cost = input.missingCostUsd == null ? '' : ` · ~${formatUsd(input.missingCostUsd)} to finish`
  return {
    count: `${input.total}/60`,
    countTone: input.total === 60 ? 'good' : 'warn',
    legality: input.legal === true ? 'Legal' : input.legal === false ? 'Not legal' : 'Unchecked',
    legalityTone: input.legal === true ? 'good' : input.legal === false ? 'bad' : 'neutral',
    ownership: `You own ${input.owned}/${input.total}${cost}`,
  }
}

function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`
}

export type OwnershipMark = { kind: 'owned' | 'partial' | 'missing'; text: string; label: string }

export function ownershipMark(owned: number, quantity: number): OwnershipMark {
  if (owned >= quantity) return { kind: 'owned', text: '✓', label: 'owned' }
  if (owned > 0) return { kind: 'partial', text: `${owned}/${quantity}`, label: `${owned} of ${quantity} owned` }
  return { kind: 'missing', text: `need ${quantity}`, label: 'missing' }
}

export function visibleIssues(issues: readonly string[], limit = 3): { visible: string[]; hidden: number } {
  return { visible: issues.slice(0, limit), hidden: Math.max(0, issues.length - limit) }
}

export type SaveState = 'idle' | 'saving' | 'saved' | 'error'
export type SaveEvent = 'start' | 'success' | 'failure' | 'retry'

/** A second tap cannot duplicate a creation request while the first is in flight. */
export function nextSaveState(state: SaveState, event: SaveEvent): SaveState {
  if (state === 'idle' && event === 'start') return 'saving'
  if (state === 'saving' && event === 'success') return 'saved'
  if (state === 'saving' && event === 'failure') return 'error'
  if (state === 'error' && event === 'retry') return 'idle'
  return state
}
