// What a saved label records about the SUGGESTION it was reviewed from
// (types.ts `QuadSuggestion`, `QuadLabelBase.suggestion`). Pure, so the
// "agreed" rule can be tested without the editor.

import type { Quad } from '../engine/contract'
import { CANONICAL_SIZE } from '../engine/frame'
import type { TopLeftIndex } from './orientation'
import type { CardFace, InvalidReason, QuadLabel, QuadSuggestion } from './types'

/** Corners count as unchanged within half a canonical pixel. */
const SAME_CORNER = 0.5 / CANONICAL_SIZE

export type SavedVerdict =
  | { corners: Quad; topLeftIndex: TopLeftIndex; face: CardFace }
  | { invalidReason: InvalidReason }

/**
 * The record a label carries about its suggestion, or undefined when there
 * was none. `agreed` means the reader saved the suggestion unchanged: the same
 * verdict (and reason), and for a card the same corners and top-left.
 */
export function suggestionRecord(s: QuadSuggestion | null, saved: SavedVerdict): QuadLabel['suggestion'] {
  if (!s) return undefined
  let agreed: boolean
  if ('invalidReason' in saved) {
    agreed = s.verdict === 'reject' && s.invalidReason === saved.invalidReason
  } else {
    const verdict = saved.face === 'back' ? 'back' : 'card'
    agreed =
      s.verdict === verdict &&
      !!s.corners &&
      (s.topLeftIndex ?? 0) === saved.topLeftIndex &&
      s.corners.every(
        ([x, y], i) => Math.abs(x - saved.corners[i]![0]) <= SAME_CORNER && Math.abs(y - saved.corners[i]![1]) <= SAME_CORNER,
      )
  }
  return {
    by: s.by,
    verdict: s.verdict,
    ...(s.invalidReason ? { invalidReason: s.invalidReason } : {}),
    confidence: s.confidence,
    agreed,
  }
}
