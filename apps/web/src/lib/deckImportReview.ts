import type { DeckFormat, DeckImportFix, DeckImportSummary } from './api'
import { confirmedDecklistText } from './deckImportFixes'
import { reconcileDecklistLineIds } from './decklistLines'

export interface ImportReviewState {
  text: string
  formatCode: DeckFormat
  lineIds: string[]
  nextId: number
  revision: number
  started: boolean
  // Accepted provenance survives edits/deletions: copying or deleting an
  // identical line must not erase the card's legality guard in this dialog.
  corrections: ReadonlyMap<string, readonly DeckImportFix[]>
  validation: { revision: number; summary: DeckImportSummary } | null
  skipped: { revision: number; lineIds: readonly string[] } | null
}

export const initialImportReview = (): ImportReviewState => ({
  text: '', formatCode: 'standard', lineIds: ['line-0'], nextId: 1,
  revision: 0, started: false, corrections: new Map(), validation: null, skipped: null,
})

export type ImportReviewAction =
  | { type: 'text'; text: string }
  | { type: 'format'; formatCode: DeckFormat }
  | { type: 'start' }
  | { type: 'validated'; revision: number; summary: DeckImportSummary }
  | { type: 'accept'; revision: number; fixes: DeckImportFix[] }
  | { type: 'undo'; lineId: string }
  | { type: 'skip'; revision: number; lineIds: readonly string[] }

export function importReviewReducer(state: ImportReviewState, action: ImportReviewAction): ImportReviewState {
  const changed = (patch: Partial<ImportReviewState>): ImportReviewState => ({
    ...state, ...patch, revision: state.revision + 1, skipped: null,
  })
  switch (action.type) {
    case 'start': return { ...state, started: true }
    case 'text': {
      if (action.text === state.text) return state
      let nextId = state.nextId
      const lineIds = reconcileDecklistLineIds(state.text, action.text, state.lineIds, () => `line-${nextId++}`)
      return changed({ text: action.text, lineIds, nextId })
    }
    case 'format': return action.formatCode === state.formatCode ? state : changed({ formatCode: action.formatCode })
    case 'validated': return action.revision !== state.revision ? state : {
      ...state, validation: { revision: action.revision, summary: action.summary },
    }
    case 'accept': {
      if (action.revision !== state.revision || action.fixes.length === 0) return state
      const review = deriveImportReview(state)
      const allowed = new Map(review.unresolved.map(row => [row.lineIndex, row.line]))
      if (!review.current || action.fixes.some(fix => allowed.get(fix.lineIndex) !== fix.original.trim())) return state
      const text = confirmedDecklistText(state.text, action.fixes, new Set())
      if (text === null) return state
      const corrections = new Map(state.corrections)
      for (const fix of action.fixes) {
        const lineId = state.lineIds[fix.lineIndex]
        corrections.set(lineId, [...(corrections.get(lineId) ?? []), fix])
      }
      return changed({ text, corrections })
    }
    case 'undo': {
      const fix = state.corrections.get(action.lineId)?.at(-1)
      const lineIndex = state.lineIds.indexOf(action.lineId)
      if (!fix || lineIndex < 0) return state
      const text = confirmedDecklistText(state.text, [{ ...fix, lineIndex, original: fix.replacement, replacement: fix.original }], new Set())
      if (text === null) return state
      return changed({ text })
    }
    case 'skip': {
      const review = deriveImportReview(state)
      const lineIds = review.unresolved.map(row => row.lineId)
      const displayed = action.revision === state.revision && action.lineIds.length === lineIds.length &&
        lineIds.every(id => action.lineIds.includes(id))
      return review.canSkip && displayed ? { ...state, skipped: { revision: state.revision, lineIds } } : state
    }
  }
}

/** All review UI and the write gate use this same projection. Server facts are
 * usable only for the exact revision checked; text is never relabelled as checked. */
export function deriveImportReview(state: ImportReviewState) {
  const current = state.validation?.revision === state.revision
  const summary = current ? state.validation!.summary : null
  const wanted = new Map<string, number>()
  for (const line of summary?.unresolvedLines ?? []) wanted.set(line.trim(), (wanted.get(line.trim()) ?? 0) + 1)
  const unresolved = state.text.split('\n').flatMap((raw, lineIndex) => {
    const line = raw.trim(), count = wanted.get(line) ?? 0
    if (!count) return []
    wanted.set(line, count - 1)
    return [{ line, lineIndex, lineId: state.lineIds[lineIndex] }]
  })
  // Fail closed if a malformed/stale response cannot be mapped to physical lines.
  const complete = [...wanted.values()].every(count => count === 0)
  const acceptedCards = new Set([...state.corrections.values()].flatMap(fixes => fixes.map(fix => fix.card.id)))
  const issues = (summary?.formatIssues ?? []).filter(issue => acceptedCards.has(issue.cardId))
  const lines = state.text.split('\n')
  const corrections = [...state.corrections].flatMap(([lineId, fixes]) => {
    const fix = fixes.at(-1)!
    const lineIndex = state.lineIds.indexOf(lineId)
    return lineIndex < 0 || lines[lineIndex].trim() !== fix.replacement.trim() ? [] : [{ lineId, fix: { ...fix, lineIndex }, issue: issues.find(issue => issue.cardId === fix.card.id) }]
  })
  const rows = new Map(unresolved.map(row => [row.lineId, row]))
  for (const { lineId, fix, issue } of corrections)
    rows.set(lineId, { lineId, lineIndex: fix.lineIndex, line: issue || unresolved.some(row => row.lineId === lineId) ? fix.replacement.trim() : fix.original.trim() })
  const matchedCards = summary?.totalCards ?? 0
  const safe = current && complete && issues.length === 0 && matchedCards > 0
  const skipConfirmed = state.skipped?.revision === state.revision &&
    unresolved.every(row => state.skipped!.lineIds.includes(row.lineId))
  return {
    current, summary, unresolved, corrections, issues, matchedCards,
    rows: [...rows.values()].sort((a, b) => a.lineIndex - b.lineIndex),
    canSkip: safe && unresolved.length > 0,
    canImport: safe && (unresolved.length === 0 || skipConfirmed),
    canAct: !!state.text.trim() && (!state.started || safe),
  }
}

/** The only path to a write, also used after the final read-only server check. */
export function reviewedImportPayload(state: ImportReviewState) {
  return deriveImportReview(state).canImport ? { text: state.text, formatCode: state.formatCode } : null
}
