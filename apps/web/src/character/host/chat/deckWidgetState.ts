/** Pure presentation rules for the deck widget, kept outside the streamed UI. */

export type DeckLegality = boolean | null

export const DECK_COMPACT_CARDS = 6

export type DeckSectionShape = { cards: readonly unknown[] }

/** The deck, rather than its containing screen, owns this disclosure state. */
export function deckDisclosure(
  sections: readonly DeckSectionShape[],
  total: number,
  expanded: boolean,
): { compactable: boolean; compact: boolean; sectionLimit: number; cardLimit: number; label: string } {
  const compactable = sections.length > 1 || (sections[0]?.cards.length ?? 0) > DECK_COMPACT_CARDS
  const compact = compactable && !expanded
  return {
    compactable,
    compact,
    sectionLimit: compact ? 1 : sections.length,
    cardLimit: compact ? DECK_COMPACT_CARDS : Number.POSITIVE_INFINITY,
    label: compact ? `Show all ${total} cards` : 'Show less',
  }
}

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

/** `version`: onto the deck the list revises. `new`: a deck of its own. */
export type SaveTarget = 'version' | 'new'
export type SaveAction = { target: SaveTarget; label: string; primary: boolean }

/**
 * The save buttons, in order, and what each says right now.
 *
 * One save at a time, across both buttons: `state` is the widget's, and only
 * the button that was pressed (`active`) says "Saving…" or "Try saving again".
 * A brand-new deck keeps exactly the one button it always had.
 */
export function saveActions(kind: 'new' | 'version', state: SaveState, active: SaveTarget | null): SaveAction[] {
  const label = (target: SaveTarget, idle: string): string =>
    active !== target ? idle : state === 'saving' ? 'Saving…' : state === 'error' ? 'Try saving again' : idle
  if (kind === 'new') return [{ target: 'new', label: label('new', 'Save to my decks'), primary: true }]
  return [
    { target: 'version', label: label('version', 'Save as new version'), primary: true },
    { target: 'new', label: label('new', 'Save as a separate deck'), primary: false },
  ]
}
