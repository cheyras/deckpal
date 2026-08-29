/**
 * Turn-end guards for the four control-flow gaps the prompt could not close.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * WHAT THIS IS FOR, MEASURED
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * From the owner's 28-conversation Deck-E history, four failure modes that are
 * all control-flow gaps in the turn loop and NONE of which a prompt can reach —
 * this codebase has twice measured prompt-only fixes at zero. Each guard below
 * names its mine finding inline at its wiring point in `api/chat.mjs`; this
 * module is the pure, testable half.
 *
 *   (a) EMPTY ANSWERS — 13 of 28 turns had a step where the model called data
 *       tools and produced ZERO answer text (finishReason 'tool-calls' or null,
 *       1–11 steps). The existing 'went round in circles' guard fires only when
 *       all 12 steps were spent. Quotes: "You didn't fucking show me it at all";
 *       "you told me you weee escorting me. You didn't actually DO it".
 *   (b) TRUNCATION — answers cut mid-sentence when finishReason === 'length'
 *       ("Here's your Mewtwo (Base").
 *   (c) FLAILING — turns with 12–24 tool calls where 5–12 of them error, often
 *       the SAME error across DIFFERENT tools/args, so the per-tool repeat
 *       ledger and the empty-run counter never fire. Quote: "He's doing tons of
 *       tool calls for absolutely zero reason."
 *   (d) PHANTOM ACTIONS / UNGROUNDED IDS — the answer says "I'm creating the
 *       list now" / "I just wiped it clean and rebuilt it" / "pulling both up"
 *       while NO write or navigation tool was called that turn (5 of 28 turns,
 *       the angriest quotes); or names a card id that appeared in NO tool result
 *       this turn ("search returned me02-013 | $4.67, answer said me02-125,
 *       $770").
 *
 * The guards are PURE DETECTORS. Each returns a boolean (or, for (d), the
 * offending phrases/ids), and the wrapper in `api/chat.mjs` decides what to do
 * with that — at most ONE guard step per turn, whichever fires first, never
 * stacked with the circles guard. See `notes.md` for the one-guard accounting.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * THE CARD-ID PATTERN IS COPIED, NOT IMPORTED
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * `grounding.ts` owns the canonical `CARD_ID` regex and keeps it module-private.
 * The ownership of this pass does not extend to editing `grounding.ts`, so the
 * pattern is reproduced here VERBATIM and must stay in sync with the one there.
 * The two are identical by construction; if `grounding.ts` ever exports it, this
 * copy should be replaced with that import. See `notes.md`.
 */
import { CLIENT_TOOLS } from './tools.js'

/**
 * Catalog ids look like `me05-013`, `sv3pt5-084`, `gym2-2`.
 *
 * COPIED VERBATIM from `grounding.ts` (see the header note). The set part must
 * contain a LETTER or it would also match `2026-07` out of a release date, which
 * `grounding.ts`'s own test catches. Anchored on `-` with no surrounding word
 * characters. The bounds are from the catalog (set up to 12, number up to 11).
 */
const CARD_ID = /\b(?=[a-z0-9]*[a-z])[a-z0-9]{2,12}-[a-z0-9]{1,12}\b/gi

/**
 * The tools the BROWSER fulfils. A call to any of these ends the server turn and
 * hands off to the next leg, so silence on a turn that called one of them is the
 * NORMAL navigation shape — not the empty-answer defect. Derived from the real
 * `CLIENT_TOOLS` export rather than a hand-written copy, so it cannot go stale
 * the way a divergent list would.
 */
const CLIENT = new Set<string>(CLIENT_TOOLS)

/**
 * (a) EMPTY ANSWER — the turn produced no visible text, called at least one
 * tool, and called NO client tool.
 *
 * The client-tool carve-out is the whole discriminator. A turn ending on
 * `goTo`/`flyTo`/`escort`/`journey`/`click`/`highlight`/`scrollToMe` is a
 * navigation handoff: the browser runs it, the words ride the next leg, and
 * speaking here would talk over him mid-journey. Only a turn that ran DATA tools
 * and said nothing is the defect — the reader waited half a minute for an empty
 * bubble. See `notes.md` for the mine finding.
 *
 * `clientToolNames` is a Set the wrapper builds from `CLIENT_TOOLS`; passed in
 * rather than reached for so the test can construct its own.
 */
export function needsAnswerNudge(
  spokeText: string,
  calledToolNames: string[],
  clientToolNames: Set<string>,
): boolean {
  // Text was produced — nothing to nudge.
  if ((spokeText ?? '').trim().length > 0) return false
  // No tool ran at all — that is a different failure (an empty turn with no
  // work), already owned by the circles guard when it reaches the step cap.
  if (calledToolNames.length === 0) return false
  // A client tool was among them — navigation handoff, silence is correct.
  for (const name of calledToolNames) {
    if (clientToolNames.has(name)) return false
  }
  return true
}

/**
 * (b) TRUNCATION — the model stopped because it hit the output-token cap, not
 * because it finished.
 *
 * `finishReason === 'length'` is the SDK's signal for "cut off mid-generation",
 * which on this path means mid-sentence. `stop` (and `undefined`) is a natural
 * finish and is not nudged.
 */
export function needsContinuation(finishReason: string | undefined): boolean {
  return finishReason === 'length'
}

/**
 * (c) FLAILING — count of 'error' phases across ALL tools this turn, against a
 * budget.
 *
 * The per-tool repeat ledger in `repeat.ts` catches the SAME call failing
 * repeatedly; the empty-run counter catches one tool coming up empty. Neither
 * catches the measured shape: the SAME error (e.g. "no set matches") raised
 * across DIFFERENT tools with DIFFERENT args in one turn, so no single tool's
 * counter ever reaches its threshold. This counts errors across the whole turn,
 * which is the only axis that sees that shape.
 *
 * Default budget 5: four errors across a turn is a bad run a model can recover
 * from; five is a pattern, and a sixth call is not going to break it. The
 * threshold is `>=` so exactly `budget` fires.
 */
export function errorBudgetExceeded(phases: string[], budget = 5): boolean {
  let errors = 0
  for (const p of phases) if (p === 'error') errors += 1
  return errors >= budget
}

/**
 * A chip on the closing-step note for (c): the {name, title} of an errored call.
 *
 * `title` is the human-facing chip label the wrapper already emits (e.g.
 * "Check set completion"); `name` is the tool. Used to name the failures in the
 * nudge without echoing raw tool output.
 */
export interface FailureChip {
  name: string
  title: string
}

/**
 * Build the reader-facing summary of this turn's failures for the (c) nudge.
 *
 * Groups by tool name so a tool that errored four times reads as one line, not
 * four — the point is the pattern, not the count. Pure: given the chips, returns
 * a string; the wrapper decides whether to inject it.
 */
export function summarizeFailures(chips: FailureChip[]): string {
  if (chips.length === 0) return ''
  const byName = new Map<string, number>()
  const titleFor = new Map<string, string>()
  for (const c of chips) {
    byName.set(c.name, (byName.get(c.name) ?? 0) + 1)
    if (!titleFor.has(c.name)) titleFor.set(c.name, c.title)
  }
  const lines: string[] = []
  for (const [name, count] of byName) {
    const title = titleFor.get(name) ?? name
    lines.push(count > 1 ? `${title} (${name}) ×${count}` : `${title} (${name})`)
  }
  return `This turn failed ${chips.length} time${chips.length === 1 ? '' : 's'}: ${lines.join('; ')}.`
}

/**
 * (d) PHANTOM ACTIONS — the answer claims an action in the present tense while
 * the tool that would perform it was not called this turn.
 *
 * The verb map is SMALL AND PRECISE on purpose. A false positive here injects a
 * pointless extra step and tells a reader the model is being corrected for
 * something it did not do, so precision beats recall: only claims phrased as a
 * thing happening NOW (present continuous, or the "I just …" immediate-past)
 * are matched. A simple-past reference to an EARLIER turn — "I created a list
 * for you earlier" — is deliberately NOT matched: that action belongs to a
 * previous leg and is not a phantom claim about this turn. See `notes.md` for
 * the past-tense decision and its test.
 *
 * Each family maps to the tool whose absence makes the claim a phantom:
 *   - creating / building / rebuilding / wiping a list  →  `edit_list`
 *   - taking you / pulling up / escorting / showing you the page  →  any CLIENT tool
 *   - logging the battle  →  `add_battle_log`
 *
 * Returns the claim phrases that are phantoms (the mapped tool was not called
 * this turn). Word-boundary safe and case-insensitive throughout.
 */
export function phantomClaims(answerText: string, calledToolNames: string[]): string[] {
  const called = new Set(calledToolNames)
  const hasClient = CLIENT_TOOLS.some((n) => called.has(n))
  const phantoms: string[] = []

  // Each entry: [regex, requiredTool | 'client']. A match is a phantom only if
  // the required tool was NOT called this turn. For 'client', that means NO
  // client tool at all was called.
  const families: [RegExp, string | 'client'][] = [
    // Present-continuous list claims: "I'm creating the list now".
    [/\b(?:creating|building|rebuilding) (?:a|the|this|that|your) list\b/i, 'edit_list'],
    // "I'm wiping the list" / "I'm wiping the list clean".
    [/\bwiping (?:a|the|this|that|your) list(?: clean)?\b/i, 'edit_list'],
    // The measured quote "I just wiped it clean and rebuilt it" — the "just"
    // marks it as this turn, so the immediate-past is a now-claim.
    [/\bjust wiped (?:it|the list)(?: clean)?\b/i, 'edit_list'],
    // Client-tool navigation claims.
    [/\btaking you to\b/i, 'client'],
    [/\bpulling (?:up|it up|both up|them up)\b/i, 'client'],
    [/\bescorting you\b/i, 'client'],
    [/\bshowing you the (?:page|way)\b/i, 'client'],
    // Battle log.
    [/\blogging the battle\b/i, 'add_battle_log'],
  ]

  for (const [re, required] of families) {
    const m = answerText.match(re)
    if (!m) continue
    if (required === 'client') {
      if (!hasClient) phantoms.push(m[0])
    } else if (!called.has(required)) {
      phantoms.push(m[0])
    }
  }
  return phantoms
}

/**
 * Lowercased catalog ids in a chunk of tool-result text, using the same
 * `CARD_ID` regex as `ungroundedCardIds`.
 *
 * The wiring in `api/chat.mjs` builds the `observedIds` Set for
 * `ungroundedCardIds` by tapping the same tool results the `grounding.ts`
 * observer already sees — through ONE regex, so the two never disagree on what
 * an id is. Exported because `CARD_ID` itself is kept private; this is its
 * read-only face.
 */
export function harvestObservedIds(text: string): string[] {
  const out: string[] = []
  for (const m of String(text ?? '').matchAll(CARD_ID)) out.push(m[0].toLowerCase())
  return out
}

/**
 * (d) UNGROUNDED CARD IDS — ids the answer names that appeared in NO tool result
 * this turn.
 *
 * Reuses the exact `CARD_ID` regex from `grounding.ts` (copied — see header) so
 * the two cannot disagree on what an id is. WHEN NOTHING WAS OBSERVED, every id
 * passes: that is the same honest default `grounding.ts`'s `partitionCards`
 * takes — a turn with no data-tool calls has no evidence either way, and refusing
 * every id would break the legitimate flow where a reader types an id and asks
 * to see it. The check is for CONTRADICTED ids, not unproven ones.
 *
 * `observedIds` is the set a tool-result harvester accumulated this turn, lower-
 * cased (matching how `grounding.ts` stores them).
 */
export function ungroundedCardIds(answerText: string, observedIds: Set<string>): string[] {
  if (observedIds.size === 0) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const m of answerText.matchAll(CARD_ID)) {
    const id = m[0].toLowerCase()
    if (seen.has(id)) continue
    seen.add(id)
    if (!observedIds.has(id)) out.push(m[0])
  }
  return out
}