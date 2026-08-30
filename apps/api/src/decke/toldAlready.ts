/**
 * An answer they have already been given is not delivered a second time.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * THE COMPLAINT, IN THE READER'S OWN WORDS
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * From the 2026-08-29 transcript, turn 5:
 *
 *   "by the way, you had already told me about most of these stats and had
 *    already told me i was missing most of the engine - probably didn't need to
 *    repeat yourself just because the battle logs didn't work."
 *
 * And turn 6, after it happened again:
 *
 *   "OK, you tried the same tool call again even though i didn't ask you to.
 *    And you repeated the same shit again. Flagging as an issue"
 *
 * The v1 6-2 / v2 0-3 / v3 2-2 record, the archetype paragraph, the
 * missing-pieces list and the ~$19-owned-of-$42 figure were delivered on turns
 * 3, 4, 5, 6 AND 7. Five times.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * WHY NEITHER EXISTING GUARD REACHES IT
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * `repeat.ts`'s `CallLedger` catches the same call twice IN ONE LEG and is
 * rebuilt on every request, so it cannot see a turn boundary at all.
 * `failing.ts`'s breaker only ever opens on FAILURES — and the tool doing the
 * damage here was `decks`, which SUCCEEDED on every one of those turns. Turn 7
 * is the proof: three `decks` calls, all `ok`, two of them caught by the repeat
 * ledger, and the reply still restated the same summary a fourth time.
 *
 * So the fact the model was missing is not "this tool is broken". It is "the
 * reader has already seen this answer". Nothing in the replayed window said so:
 * the lookup record arrives every turn looking exactly as new as it did the
 * first time.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * WHAT IS COMPARABLE ACROSS A TURN BOUNDARY, AND WHAT IS NOT
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Full result text does not survive the turn and must not be made to — that is
 * the unbounded-input option `lookupRecord.ts` weighed and the owner rejected.
 * What DOES survive is the chip's one-line summary, and it is the server's own
 * `summarise(result)`: the first line of the real result, capped. The same
 * function computes the same string for this turn's call. So first-line identity
 * is comparable across turns for free, with no wire change at all.
 *
 * It is a COARSE key, and the annotation's wording is chosen to stay true under
 * it: two `decks` calls differing only in their `include` share a header line.
 * "They were already shown this" is then still correct about the summary, and
 * "say only what is new" is still the right instruction — which is exactly why
 * the note points at what to do rather than asserting the results are byte
 * identical.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * WHERE IT DOES NOT FIRE
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Three exclusions, two of them structural and free:
 *
 *   • CLIENT AND COSMETIC TOOLS never reach this seam. It lives inside
 *     `buildDataTools`; `express`, `flyTo` and `showScreen` are built by
 *     `buildTools`. Repeating a movement is how movement works.
 *   • WRITES never reach it either — the write path returns before the
 *     annotation seam, which is right: "add one more" twice is two adds.
 *   • A TOOL ALREADY INTERCEPTED BY THE BREAKER never reaches it: `failing.ts`
 *     returns its `[[NO_WORK]]` message earlier in the same `execute`, and that
 *     message carries its own do-not-restate instruction.
 *
 * And one that has to be written down, below.
 */

import { recordedLookups } from './failing.js'

/**
 * Tools whose whole value is the SECOND answer.
 *
 * `health` exists to be asked again — "is it back up yet" is the only question
 * it answers, and telling the model it already reported that is telling it to
 * stop checking. `set_cart` composes an outbound TCGplayer URL: its result is a
 * destination rather than a finding, and a reader who wants the link again
 * wants the link again. Both are read-only data tools, so both would otherwise
 * reach the seam.
 *
 * Deliberately short, and it is a LIST rather than a heuristic: every entry is
 * a tool whose repetition was argued about by name.
 */
export const REPETITION_IS_THE_POINT: ReadonlySet<string> = new Set(['health', 'set_cart'])

/**
 * How distinctive a summary has to be before identity means anything.
 *
 * Short lines collide by accident — `lists`' "No lists yet." would match itself
 * across two turns in which the reader created and deleted one, and a bare
 * "OK" would match everything. Sixteen characters is about one clause, which is
 * the shortest thing that can be evidence of the same finding rather than of
 * the same shape of finding. Precision over recall, the rule `turnGuards.ts`
 * states for `phantomClaims` and which applies identically here: a missed
 * repeat costs a paragraph the reader has read before, and a false one tells
 * the model not to say something it has never said.
 */
export const MIN_DISTINCTIVE = 16

/**
 * `<tool>\0<summary>`, reusing `callKey`'s NUL convention for the same reason:
 * no tool name and no summary can contain it, so no two distinct pairs can
 * collide by concatenation.
 */
export function toldKey(tool: string, summary: string): string {
  return `${tool}\u0000${summary.trim()}`
}

/**
 * Every `<tool>: <summary>` the READER WAS SHOWN in an earlier turn.
 *
 * Same scan shape as `failingTools` and `declinedCalls` — walk `messages`, walk
 * `parts`, read the replayed text blocks — and it holds nothing between
 * requests. Parsing is `failing.ts`'s `recordedLookups`, the one parser for
 * that block.
 *
 * A `partial` line carries `lookupRecord`'s `[INCOMPLETE — …]` marker inside
 * its summary, so it can never equal a complete result's summary. That is the
 * behaviour wanted and not an accident worth removing: a reading that ran out
 * of room is not the answer that a full one is, and telling the model it has
 * already given a complete figure it only half has would be worse than saying
 * nothing.
 */
export function priorSummaries(messages: unknown): Set<string> {
  const out = new Set<string>()
  if (!Array.isArray(messages)) return out
  for (const m of messages) {
    const parts = (m as { parts?: unknown })?.parts
    if (!Array.isArray(parts)) continue
    for (const p of parts) {
      const part = p as { type?: unknown; text?: unknown } | null
      if (!part || part.type !== 'text' || typeof part.text !== 'string') continue
      for (const rec of recordedLookups(part.text)) out.add(toldKey(rec.name, rec.summary))
    }
  }
  return out
}

/**
 * Has the reader already been shown exactly this, from exactly this tool?
 *
 * Everything that decides "no" lives here rather than at the call site, so the
 * adapter reads as one predicate and the exclusions are testable without
 * running a tool.
 */
export function alreadyTold(
  told: ReadonlySet<string>,
  tool: string,
  summary: string,
): boolean {
  if (told.size === 0) return false
  if (REPETITION_IS_THE_POINT.has(tool)) return false
  const s = summary.trim()
  if (s.length < MIN_DISTINCTIVE) return false
  return told.has(toldKey(tool, s))
}

/**
 * What rides on the result, and the whole of it.
 *
 * ONE LINE, in `repeatNote`'s register (`repeat.ts`) — it is appended to a
 * result the model still has to read, and it is not the answer. It is also
 * MODEL-FACING ONLY: the chip is untouched, because the lookup genuinely ran
 * and `phase: 'ok'` is the truth about it (X2). Nothing here reaches the
 * transcript.
 *
 * It says what to DO, not merely what not to do. "Do not restate it" on its own
 * produced, in the measured turns, a reply that restated it with an apology in
 * front — so the instruction names the two useful moves instead.
 */
export const ALREADY_TOLD_NOTE =
  `\n\n(They were already shown this same result in an earlier turn of this conversation and it ` +
  `has not changed — do not restate it. Refer back to it, and say only what is new or answer ` +
  `what they actually asked.)`
