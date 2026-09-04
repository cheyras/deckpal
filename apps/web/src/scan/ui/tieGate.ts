// THE TIE GATE — never present a confident answer the evidence does not support.
//
// ── THE OWNER-PRINCIPLE VIOLATION IT FIXES (e2e drive round 2, 2026-09-04) ──
//
// Once the 90-degree rectify defect was fixed the matcher started answering, and
// on Basic Energy cards it answered CONFIDENTLY AND WRONGLY. The drive's probe
// over 15 captures of a single Basic Fighting Energy found the index returning
// four different energies at IDENTICAL distances — Fighting/014 d=7,
// Psychic/013 d=7, Water/011 d=7, Fire/010 d=7 — because a dHash over a Basic
// Energy card reads the frame and the layout, which those cards share exactly,
// and the element symbol that separates them is a small central colour blob it
// does not weight.
//
// The product then filed six rows at 86-91% confidence and got ONE right. In the
// clutter run a blue Water Energy was confidently filed as Lightning Energy at
// 88%, twice.
//
// That is worse than not matching at all. Round 1's rotated crops matched
// nothing, so every capture arrived as "Needs attention — pick one below" and
// the reader was asked; round 2 traded "asks the user" for "is confidently
// wrong" five times out of six. A wrong card behind a green 88% bar goes into
// the collection unnoticed.
//
// ── THE RULE ────────────────────────────────────────────────────────────────
//
// A match may present as confident only when its distance is at least
// TIE_MARGIN better than the best alternative that is A DIFFERENT CARD. When it
// is not, the capture is still kept, its top-5 is still offered, and the row
// reads "needs attention" — the reader picks. Nothing is discarded; only the
// CLAIM of confidence is withheld.
//
// ── WHY HERE AND NOT IN THE API ─────────────────────────────────────────────
//
// The endpoint already returns the full ranked list with distances, and the feed
// already receives it — every input this decision needs is on the client. Doing
// it here keeps the API's meaning intact ("these are the k nearest, with their
// distances") and puts the PRODUCT decision ("is that good enough to assert?")
// in the product. It also means no server deploy is needed to change a
// judgement call that will want tuning against real cameras.

import type { ScanMatch, ScanResponse } from '../../lib/api'

/**
 * How much better than the runner-up a top hit must be to claim confidence.
 *
 * 2 means "a tie, or a one-unit lead, is not enough". Sized directly on the
 * drive's own 19 confident results: EVERY one of them had a different-card rival
 * within 1 (9/9 in the card run, 2/2 in the clutter run), and 5 of those 6 the
 * product committed to were the wrong card. A margin of 2 downgrades all of them
 * to "pick one below", which is the honest answer for that footage.
 *
 * It is deliberately not larger. On a visually distinct card the nearest
 * different card sits many units away, so this never fires — it only speaks up
 * where the index genuinely cannot separate two candidates.
 */
export const TIE_MARGIN = 2

/** Two matches are the same card when they share a cardId. Name/set/number are
 *  NOT used: two printings of one card are legitimately distinct answers, and
 *  the reader picking between them is exactly what the variant chooser is for. */
function sameCard(a: ScanMatch, b: ScanMatch): boolean {
  return a.cardId === b.cardId
}

export interface TieVerdict {
  /** May the UI present this as an identified card? */
  confident: boolean
  /** The rival that blocked it, when one did — for telemetry and for the notice. */
  rival: ScanMatch | null
  /** How far ahead the top hit actually was (Infinity when nothing rivals it). */
  margin: number
}

/**
 * Judge whether `matches[0]` may be presented as an identified card.
 *
 * Pure and total: an empty list, a single result, or a list where every entry is
 * the same card all resolve without a rival, and a single result is therefore
 * confident on its own distance alone.
 */
export function judgeTie(matches: readonly ScanMatch[], margin: number = TIE_MARGIN): TieVerdict {
  if (!matches.length) return { confident: false, rival: null, margin: 0 }
  const top = matches[0]
  const rival = matches.find((m) => !sameCard(m, top)) ?? null
  if (!rival) return { confident: true, rival: null, margin: Infinity }
  const lead = rival.distance - top.distance
  return { confident: lead >= margin, rival, margin: lead }
}

/**
 * Apply the gate to a whole scan response.
 *
 * Returns a response that is IDENTICAL except that `matched` may be turned off.
 * The ranked list is left completely intact, because the reader is about to pick
 * from it — suppressing the claim must never suppress the evidence.
 */
export function gateScanResponse(res: ScanResponse | null, margin: number = TIE_MARGIN): ScanResponse | null {
  if (!res || !res.matched) return res
  const verdict = judgeTie(res.matches, margin)
  if (verdict.confident) return res
  return { ...res, matched: false }
}
