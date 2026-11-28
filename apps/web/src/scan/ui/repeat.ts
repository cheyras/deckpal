// SAME CARD OR NOT — decided AFTER a capture, by identity, never by the look
// (design §2.3; decision 2026-11-27 "a flip is always captured").
//
// The presentation machine (presentation.ts) captures every new presentation:
// any break in continuity followed by a steady card. Whether that capture is a
// different card or the same one again is asked here, once its identity has
// settled, against the capture it broke from (`prevCaptureId`).
//
//   kind        identity says       result
//   first       anything            a row
//   manual      anything            a row (a "Scan again" press: flagged when same)
//   disturbed   different           a row
//   disturbed   same                a row FLAGGED "Same as last scan", with Undo
//   disturbed   unknown             a row
//   drift       different           promoted: flash, tray, row
//   drift       same, look ≤ 0.60   discarded silently: the only drop
//   drift       same (look > 0.60)  promoted and flagged
//               or unknown
//
// THE FLAG IS ADVISORY. A wrong `sameCard` costs a wrong chip, never a card:
// every disturbed capture becomes a row either way. That is also what makes a
// mis-identification survivable (the owner's Lillipup read as Herdier lands as a
// second "Herdier" row flagged "Same as last scan", which is the row he would
// look at). Two rows stay two rows (2026-09-07: a normal and a reverse holo of
// one card need two printing pickers): no merge, no quantity bump.
//
// PURE. Scan.tsx calls it from the landing; the tests read it row by row.

import { lookDistance, type CardLook } from '../engine/look'
import type { IdentityState } from './identity'
import type { FireKind } from './presentation'

/**
 * THE KILL SWITCH for the one judgement this design cannot make: the same card
 * after a full break (a hand covered it, the phone left and came back) is the
 * same pixels as an identical copy swapped in.
 *
 *   'keep-flagged'  keep it as its own row, flagged "Same as last scan", with a
 *                   one-tap Undo in the pill and the chip on the row. Zero taps
 *                   for a real second copy; one tap for a false one.
 *   'ask'           hold the thumbnail in the tray with "Same card — Add copy /
 *                   Skip" and add nothing until tapped (skipped when the next
 *                   capture fires). One tap for a real copy, none for a false one.
 *
 * Default 'keep-flagged': the owner's standing priority (regions.ts, 2026-09) is
 * that a duplicate row costs less than a refused card, and his stated goal for
 * this flow is that a flip counts without a tap. One constant, so his verdict on
 * the phone can flip it without a redesign.
 */
export type SameAfterBreak = 'keep-flagged' | 'ask'
export const SAME_AFTER_BREAK: SameAfterBreak = 'keep-flagged'

/** A drift probe of the same card is dropped only when its capture look is within this of the episode's capture. */
export const DRIFT_DISCARD_LOOK_MAX = 0.6
/** An OCR name shorter than this many letters is too weak to call two cards the same. */
export const NAME_MIN_LETTERS = 4

/** What a settled capture is, for comparing: a confident card, or what OCR read off it. */
export interface IdentityKey {
  cardId: string | null
  /** Normalised name (catalog name for a confident card, the OCR read otherwise), ≥ NAME_MIN_LETTERS letters. */
  name: string | null
  /** Normalised collector number, when one is known. */
  number: string | null
}

/** Lower case, accents folded (Poké → poke), letters and digits only, single spaces. Null below NAME_MIN_LETTERS letters. */
export function normName(s: string | null | undefined): string | null {
  if (!s) return null
  const n = s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
  const letters = n.replace(/[^a-z]/g, '').length
  return letters >= NAME_MIN_LETTERS ? n : null
}

/** A collector number without its zero padding (`082` and `82` are one number); letters kept (`TG12`). */
export function normNumber(s: string | null | undefined): string | null {
  if (!s) return null
  const n = s.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^0+(?=\d)/, '')
  return n || null
}

/** The identity of a settled capture, or null when there is nothing usable to compare. */
export function identityKeyOf(st: IdentityState | null | undefined): IdentityKey | null {
  if (!st) return null
  if (st.phase === 'confident' && st.match) {
    return { cardId: st.match.cardId, name: normName(st.match.name), number: normNumber(st.match.number) }
  }
  if (st.phase === 'needs-you' && st.read) {
    const name = normName(st.read.name)
    if (!name) return null
    return { cardId: null, name, number: normNumber(st.read.number) }
  }
  return null
}

/**
 * Are two settled captures the same card?
 *  1. both named confidently → the same card id;
 *  2. otherwise → the same normalised name (≥ 4 letters), and the same number
 *     where both have one;
 *  3. otherwise → not the same.
 * Null — "cannot say" — when either side has nothing usable.
 */
export function sameCard(a: IdentityKey | null, b: IdentityKey | null): boolean | null {
  if (!a || !b) return null
  if (a.cardId && b.cardId) return a.cardId === b.cardId
  if (a.name && b.name) {
    if (a.name !== b.name) return false
    if (a.number && b.number && a.number !== b.number) return false
    return true
  }
  return null
}

export type RepeatAction =
  /** Land as an ordinary row. */
  | 'row'
  /** Land as a row flagged "Same as last scan", with Undo. */
  | 'flagged'
  /** Hold in the tray and ask "Same card — Add copy / Skip" (SAME_AFTER_BREAK 'ask'). */
  | 'ask'
  /** A drift probe of the same card: drop it silently. */
  | 'discard'

export interface RepeatResolution {
  action: RepeatAction
  /** A drift probe that becomes a capture: it flashes and joins the tray now. */
  promoted: boolean
}

/**
 * What to do with a settled capture. `same` is `sameCard` against the capture
 * it broke from; `lookDistance` (drift only) is between the two captures' looks.
 */
export function resolveRepeat(o: {
  kind: FireKind
  same: boolean | null
  /** The two captures' look distance, for a drift probe (captureLookDistance). */
  lookDistance?: number | null
  /** A "Scan again" press on the "Scanned ✓" pill: flagged like any other when it names the same card. */
  scanAgain?: boolean
  mode?: SameAfterBreak
}): RepeatResolution {
  const mode = o.mode ?? SAME_AFTER_BREAK
  const sameAfterBreak: RepeatAction = mode === 'ask' ? 'ask' : 'flagged'
  switch (o.kind) {
    case 'first':
      return { action: 'row', promoted: false }
    case 'manual':
      // The reader asked for this one: never held to ask, only labelled.
      return { action: o.scanAgain && o.same === true ? 'flagged' : 'row', promoted: false }
    case 'disturbed':
      return { action: o.same === true ? sameAfterBreak : 'row', promoted: false }
    case 'drift':
      if (o.same === false) return { action: 'row', promoted: true }
      if (o.same === true && o.lookDistance != null && o.lookDistance <= DRIFT_DISCARD_LOOK_MAX) {
        return { action: 'discard', promoted: false }
      }
      return { action: sameAfterBreak, promoted: true }
  }
}

/** The look distance between two captures' looks (each carries four quarter turns), or null. */
export function captureLookDistance(a: CardLook | null | undefined, b: CardLook | null | undefined): number | null {
  return a && b ? lookDistance(a, b) : null
}
