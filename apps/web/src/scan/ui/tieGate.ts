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
 * ── 2 WAS SIZED ON ROUND 2 AND ROUND 3 SHIPPED IT AND MEASURED IT ───────────
 *
 * 2 was sized on round 2's own 19 confident results: every one of them had a
 * different-card rival within 1, so a margin of 2 downgraded all of them. It
 * did most of its job — round 3 demoted 7 of the 11 server-confident results,
 * and removed EVERY wrong commit from the clutter run, where round 2 had filed a
 * blue Water Energy as Lightning Energy at 88% twice.
 *
 * It under-fired on the residue, and the residue is the whole point of the gate.
 * Round 3 committed three captures of an orange Basic Fighting Energy to the
 * batch as OTHER cards, behind green 88-89% confidence bars and with no prompt:
 * Grass Energy `sve` #009, and Psychic Energy `swsh12.5` #156 at quantity 2.
 * Three of nine captures committed, three of three wrong.
 *
 * ── WHY 3, AND WHY IT IS EXACTLY THE RIGHT NOTCH ────────────────────────────
 *
 * The survivors did not clear the bar comfortably. They cleared it BY EXACTLY 2,
 * with nothing else in the run between. Round 3's probe re-POSTed all nine
 * harvested crops to the live index (`harvest-r3run1/analysis/scan-results.json`)
 * and the margin distribution to the best DIFFERENT-cardId rival is:
 *
 *   margin 0   1 capture   (already unmatched by the server's own threshold)
 *   margin 1   6 captures  (demoted by the shipped gate — correctly)
 *   margin 2   2 captures  (SURVIVED the shipped gate, and BOTH are the wrong card)
 *   margin >=3 0 captures
 *
 * There is no capture in the run with a margin of 3 or more, so raising the bar
 * to 3 costs this footage NOTHING — it demotes exactly the two survivors and
 * nothing else. That is the rare case where the fence and the evidence coincide:
 * the empty band sits between 2 and 3, and the threshold goes in it.
 *
 * ── THE TRADE, NAMED ────────────────────────────────────────────────────────
 *
 * A higher margin sends more TRUE matches to "needs attention". That is the
 * right direction for this product and it is a judgement, not a measurement:
 * needs-attention is a good experience here — round 3 confirmed the picker
 * renders card art, name, set, number and a confidence for each of the top five,
 * with the correct card present and one tap away — and a wrong card behind an
 * 88% bar goes into the collection unnoticed. Round 1's rotated crops matched
 * nothing and the reader was simply asked every time; that was WORSE at finding
 * cards and BETTER at not lying, and the lying is the part that costs trust.
 *
 * It is deliberately not larger than 3. On a visually distinct card the nearest
 * different card sits many units away, so this never fires — it only speaks up
 * where the index genuinely cannot separate two candidates, which on Basic
 * Energy cards it cannot, because a dHash reads the frame and the layout those
 * cards share exactly.
 *
 * WHAT WOULD MOVE IT AGAIN: real-camera footage of visually distinct cards. All
 * three rounds are one Basic Energy through a doubly-compressed screen
 * recording, and the margin distribution above is a property of that corpus.
 */
export const TIE_MARGIN = 3

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
