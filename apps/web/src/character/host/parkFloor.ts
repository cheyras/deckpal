/**
 * WHICH CARD HE STANDS ON, when there is more than one to choose from.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 *
 * *"We have this issue where the permission prompts, he's covering it up. I'd
 * like him to like jump up above the permission prompt. That would be much
 * better … so we can actually read the text that he's covering up."*
 *
 * 2026-08-27, narrated over a mobile screen recording at 0:54, and visible on
 * every frame from 0:44 to 1:20 of it. He parks on the composer's top edge —
 * the placement `DeckeChat`'s park box argues for at length and which is not in
 * question here — and the approval card is a SIBLING ABOVE the composer in the
 * same bottom block. So the one moment the panel puts a block of text beside
 * the one thing that has to be answered, the character is standing in front of
 * it: on the frame at 1:10 his head covers the whole of *"the deep research
 * takes longer and uses more than a normal request"*, which is the sentence the
 * dialog exists to show.
 *
 * The park box already had the right shape for this. It was only ever asking
 * about the wrong element.
 *
 * ── WHY A `.ts` SIBLING ──────────────────────────────────────────────────────
 *
 * Same reason as `markWatch.ts` and `composerRuler.ts`: a `.tsx` throws under
 * `node --import tsx` on `import.meta.env`, so a decision that lives inside the
 * component cannot be tested. This one has a clamp in it, and a clamp that is
 * only ever exercised by a tall approval card on a short phone is exactly the
 * kind of arithmetic that ships wrong and is noticed months later.
 */

/** Every measurement the choice needs, all in CSS px above the panel's floor. */
export type ParkFloorSample = {
  /** The composer's top edge above the panel's floor. 0 = not measured yet. */
  composerTop: number
  /** The approval card's top edge, or 0 when there is no card up. */
  askTop: number
  /** The panel's own height, for the ceiling. 0 = not measured yet. */
  panelH: number
  /** His silhouette's height — the space he actually needs to fit. */
  parkH: number
  /** The daylight kept under him, and above him at the ceiling. */
  above: number
}

/**
 * The floor to stand on: the composer, or the approval card when one is up.
 *
 * `Math.max` IS THE WHOLE RULE for the ordinary case. The two are stacked in
 * the same block, so the higher edge is the one that has to be cleared — and
 * with no card up, `askTop` is 0 and this returns exactly `composerTop`, which
 * is what every decision downstream of it still gets on the ordinary path.
 *
 * THE CEILING IS NOT OPTIONAL. An approval card can be most of a phone screen —
 * the one on the tape is a title, a request line, three lines of consequence and
 * two buttons — and "stand above it" solved without a ceiling puts a 200 px
 * character off the top of the panel, which is the same defect as covering the
 * card with the sign flipped. He rises only as far as his own silhouette still
 * fits under the panel's ceiling.
 *
 * ON A CARD TALLER THAN THAT HE STANDS IN IT, and that is the honest
 * degradation rather than a fallback nobody thought about: it is a card he
 * cannot clear, and being on screen beats being correct about a mark that is
 * not. The clamp's lower bound is `composerTop`, never zero, so a mis-measured
 * panel cannot push him back down into the one control the reader is using.
 *
 * `0` means "nothing measured yet" and the caller keeps its own fallback for
 * that, exactly as it did when this was one number.
 */
export function parkFloor(s: ParkFloorSample): number {
  const floor = Math.max(s.composerTop, s.askTop)
  if (!floor) return 0
  // No panel height yet is not a reason to refuse to rise: the measurement
  // arrives a frame later and a ceiling of Infinity is the same answer this
  // returned before there was a ceiling at all.
  const ceiling = s.panelH ? s.panelH - s.parkH - s.above * 2 : Infinity
  return Math.max(s.composerTop, Math.min(floor, ceiling))
}
