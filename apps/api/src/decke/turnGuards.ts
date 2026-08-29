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
import { CLIENT_TOOLS, SERVER_TOOLS } from './tools.js'

/**
 * Catalog ids look like `me05-013`, `sv3pt5-084`, `gym2-2`.
 *
 * COPIED VERBATIM from `grounding.ts` (see the header note). The set part must
 * contain a LETTER or it would also match `2026-07` out of a release date, which
 * `grounding.ts`'s own test catches. Anchored on `-` with no surrounding word
 * characters. The bounds are from the catalog (set up to 12, number up to 11).
 *
 * This LOOSE pattern is used only by `harvestObservedIds`, which feeds the
 * `observedIds` Set — it must stay in sync with `grounding.ts`'s own harvesting
 * so the two cannot disagree on what an id is. The ACCUSATION path
 * (`ungroundedCardIds`) uses the tighter `CARD_ID_STRICT` below, so ordinary
 * vocabulary like `late-game` or `win-loss` is never accused.
 */
const CARD_ID = /\b(?=[a-z0-9]*[a-z])[a-z0-9]{2,12}-[a-z0-9]{1,12}\b/gi

/**
 * The ACCUSATION-only card-id pattern: plausible catalog ids, nothing looser.
 *
 * `grounding.ts`'s loose `CARD_ID` (copied above) is deliberately permissive —
 * its job is to harvest ids from tool RESULT text, where a false negative would
 * let a fabricated id slip past ungrounded. The accusation path has the opposite
 * bias: a false POSITIVE here injects a "I named an id without looking it up"
 * nudge into a turn that named no id at all, correcting the model for something
 * it did not do. So this pattern is constrained to shapes that are plausibly
 * catalog ids and nothing else.
 *
 * Derived from the real id shapes in this repo — `me05-013`, `me01-104`,
 * `sv08.5-079`, `sv3pt5-084`, `gym2-2`, `swsh12tg-045`, `cel25-077`:
 *   - the SET part is 2–12 alphanumerics, must contain at least one LETTER (so
 *     a pure-numeric date `2026-07` is excluded) AND at least one DIGIT (so
 *     ordinary words `late`, `win`, `dry`, `two` are excluded), with an optional
 *     `.d[suffix]` dot-suffix for the `sv08.5` family;
 *   - the NUMBER part is 1–3 digits with an optional single trailing letter.
 *
 * The listed false positives all fail one half or the other: `late-game`,
 * `two-of`, `win-loss`, `dry-run` have no digit in the set; `v1-v2`'s number
 * part `v2` starts with a letter, not a digit. Real ids match. See
 * `ungroundedCardIds` and its test.
 */
const CARD_ID_STRICT =
  /\b(?=[a-z0-9.]*[a-z])(?=[a-z0-9.]*\d)[a-z0-9]{2,12}(?:\.\d[a-z]?)?-\d{1,3}[a-z]?\b/gi

/**
 * The tools the BROWSER fulfils. A call to any of these ends the server turn and
 * hands off to the next leg, so silence on a turn that called one of them is the
 * NORMAL navigation shape — not the empty-answer defect. Derived from the real
 * `CLIENT_TOOLS` export rather than a hand-written copy, so it cannot go stale
 * the way a divergent list would.
 */
const CLIENT = new Set<string>(CLIENT_TOOLS)

/**
 * The tools THIS SERVER executes and whose result IS the answer — `express` and
 * `showScreen`. A turn that ran one of these and produced no text is NOT an
 * empty-answer defect: a panel IS the answer, and an animation IS the reaction.
 * Derived from the real `SERVER_TOOLS` export, like `CLIENT` above.
 */
const SERVER = new Set<string>(SERVER_TOOLS)

/**
 * (a) EMPTY ANSWER — the turn produced no visible text, called at least one
 * tool, and called NO client tool, NO pending tool, and NO server tool.
 *
 * The client-tool carve-out is the whole discriminator. A turn ending on
 * `goTo`/`flyTo`/`escort`/`journey`/`click`/`highlight`/`scrollToMe` is a
 * navigation handoff: the browser runs it, the words ride the next leg, and
 * speaking here would talk over him mid-journey. Only a turn that ran DATA tools
 * and said nothing is the defect — the reader waited half a minute for an empty
 * bubble. See `notes.md` for the mine finding.
 *
 * TWO MORE CARVE-OUTS, both structural and both measured:
 *
 *   - A HELD WRITE (approval-held). The SDK records the held call in
 *     `step.toolCalls` but `execute` never runs, so no `guardEvent` exists for
 *     it — it is "called but not completed". The leg ends with tool calls and no
 *     text, and without this carve-out the guard would inject "I never actually
 *     answered you" right before the approval card opens. A call that is pending
 *     is a question the reader has not answered yet, not a defect.
 *   - A PANEL/SERVER turn. `showScreen` and `express` are executed server-side
 *     and their result IS the answer — a panel is the answer, not a missing one.
 *     Without this carve-out a turn that drew a panel and said nothing would be
 *     told it failed, which is the opposite of the truth.
 *
 * `clientToolNames` and `serverToolNames` are Sets the wrapper builds from
 * `CLIENT_TOOLS` and `SERVER_TOOLS`; passed in rather than reached for so the
 * test can construct its own. `completedToolNames` is the set of tool NAMES that
 * produced a completed `guardEvent` (phase `ok`/`partial`/`error`/`declined`)
 * this turn — the wrapper derives it from `guardEvents`.
 */
export function needsAnswerNudge(
  spokeText: string,
  calledToolNames: string[],
  clientToolNames: Set<string>,
  completedToolNames: string[] = [],
  serverToolNames: Set<string> = SERVER,
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
  // A SERVER tool whose result IS the answer ran and completed — a panel is the
  // answer, not a missing one. Checked on COMPLETED server calls only, so a
  // held `showScreen` (which cannot happen — it is not a write — but is named
  // here for symmetry) does not misread as "the panel is the answer".
  const completed = new Set(completedToolNames)
  for (const name of completedToolNames) {
    if (serverToolNames.has(name)) return false
  }
  // ANY called tool that did not complete is PENDING — a held approval. The leg
  // ended silent because the reader has not answered yet, not because the model
  // forgot to speak. Do not nudge over an open question.
  for (const name of calledToolNames) {
    if (!completed.has(name)) return false
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
 * (c) FLAILING — circuit-breaker predicate for the closing-step NOTE.
 *
 * `errorBudgetExceeded` is the detector; this is the wrapper's decision, kept
 * pure so it can be pinned by a test the wiring in `api/chat.mjs` cannot be.
 *
 * TWO conditions, both required:
 *   - the error budget across the turn was exceeded (`errorBudgetExceeded`), AND
 *   - the turn did NOT recover into a substantive answer. A turn that flailed
 *     and then answered well (>= 200 chars of visible text) must not be told it
 *     flailed — the recovery is the thing that happened, and a post-mortem note
 *     on a successful answer reads as a correction for something the model fixed.
 *
 * The 200-char threshold is the same "substantive answer" bar the empty-answer
 * guard's flip side implies: below it, the turn did not answer; at or above it,
 * it did. See `notes.md`.
 *
 * The CIRCUIT BREAKER (stopping further steps when the budget is exceeded) is
 * wired separately, in `api/chat.mjs`'s `stopWhen` — this predicate only
 * decides whether the NOTE fires at turn end. The breaker uses
 * `errorBudgetExceeded` directly so it can trip mid-turn before the note is
 * even composed.
 */
export function shouldFireFlailing(
  phases: string[],
  answerText: string,
  budget = 5,
): boolean {
  return errorBudgetExceeded(phases, budget) && (answerText ?? '').trim().length < 200
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
 * something it did not do, so precision beats recall. Three guards carry that
 * precision, each pinned by its own repro:
 *
 *   (a) HEADINGS are skipped. A line starting with `#` is a markdown heading,
 *       and `## Creating Your List` is a section title — not a present-tense
 *       claim about this turn. Without this, every heading containing a verb
 *       fired.
 *   (b) NEGATION suppresses. A negation token (`not`, `n't`, `won't`, `never`,
 *       `without`) within 25 characters before the matched phrase, on the SAME
 *       sentence, suppresses the match — "I'm not creating a list right now" is
 *       the opposite of a phantom claim. Without this, every denial fired.
 *   (c) A PRESENT-PROGRESSIVE ANCHOR is required near the match. Only claims
 *       phrased as a thing happening NOW (`I'm` / `I am` / `I'll just` /
 *       `right now` / `now`) are matched; a past-continuous reference like "I
 *       was building the list yesterday" is deliberately NOT matched, because
 *       that action belongs to a previous turn and is not a phantom claim about
 *       this one. The "just wiped" family carries its own `just` anchor in the
 *       match itself (the immediate-past marker), so it is exempt from the
 *       external-anchor requirement.
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

  // Each entry: [regex, requiredTool | 'client', selfAnchored]. A match is a
  // phantom only if the required tool was NOT called this turn. For 'client',
  // that means NO client tool at all was called. `selfAnchored` marks a family
  // that carries its own present-tense anchor in the match (the "just wiped"
  // immediate-past form) and so is exempt from the external-anchor check.
  const families: [RegExp, string | 'client', boolean][] = [
    // Present-continuous list claims: "I'm creating the list now".
    [/\b(?:creating|building|rebuilding) (?:a|the|this|that|your) list\b/i, 'edit_list', false],
    // "I'm wiping the list" / "I'm wiping the list clean".
    [/\bwiping (?:a|the|this|that|your) list(?: clean)?\b/i, 'edit_list', false],
    // The measured quote "I just wiped it clean and rebuilt it" — the "just"
    // marks it as this turn, so the immediate-past is a now-claim.
    [/\bjust wiped (?:it|the list)(?: clean)?\b/i, 'edit_list', true],
    // Client-tool navigation claims.
    [/\btaking you to\b/i, 'client', false],
    [/\bpulling (?:up|it up|both up|them up)\b/i, 'client', false],
    [/\bescorting you\b/i, 'client', false],
    [/\bshowing you the (?:page|way)\b/i, 'client', false],
    // Battle log.
    [/\blogging the battle\b/i, 'add_battle_log', false],
  ]

  // (b) negation tokens, checked in the 25 chars before the match.
  const NEGATION = /\b(?:not|n't|won't|never|without)\b/i
  // (c) present-progressive anchors, checked near the match.
  const ANCHOR = /\b(?:I'm|I am|I'll just|right now|now)\b/i

  const lines = String(answerText ?? '').split(/\r?\n/)
  for (const line of lines) {
    // (a) skip markdown headings — a heading is a title, not a claim.
    if (/^\s*#/.test(line)) continue
    for (const [re, required, selfAnchored] of families) {
      const m = line.match(re)
      if (!m) continue
      const matched = m[0]
      const idx = m.index ?? 0
      // (b) negation within 25 chars before the match, on the SAME sentence.
      // Cut the window at the last sentence terminator so a negation in an
      // earlier sentence does not suppress a match in a later one.
      const before = line.slice(Math.max(0, idx - 25), idx)
      let cut = -1
      for (let i = before.length - 1; i >= 0; i--) {
        if (before[i] === '.' || before[i] === '!' || before[i] === '?') {
          cut = i
          break
        }
      }
      const sameSentence = cut >= 0 ? before.slice(cut + 1) : before
      if (NEGATION.test(sameSentence)) continue
      // (c) present-progressive anchor near the match (within 40 chars either
      // side), unless the family carries its own anchor.
      if (!selfAnchored) {
        const vicinity = line.slice(
          Math.max(0, idx - 40),
          Math.min(line.length, idx + matched.length + 40),
        )
        if (!ANCHOR.test(vicinity)) continue
      }
      if (required === 'client') {
        if (!hasClient) phantoms.push(matched)
      } else if (!called.has(required)) {
        phantoms.push(matched)
      }
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
 * Seed the `observedIds` Set from the INCOMING replayed conversation, so ids a
 * prior leg already carried are "observed" before this turn's tools even run.
 *
 * CROSS-LEG BLINDNESS, measured: without this, a card id that appeared in an
 * earlier leg's tool result — and so is legitimately in the reader's context —
 * is NOT in this turn's `observedIds`, and `ungroundedCardIds` would flag it as
 * invented. The reader typed it back to ask about it, the model named it in the
 * answer, and the guard corrected the model for a detail that was grounded two
 * legs ago. Seeding from the replayed history closes that: anything the
 * conversation already carried is observed.
 *
 * Pure: takes the strings (text parts, tool-result text) the wrapper serialized
 * from the incoming messages, returns the Set. The wrapper adds the Set's
 * contents to the turn's `observedIds` before any tool runs.
 */
export function seedObservedIds(texts: readonly string[]): Set<string> {
  const out = new Set<string>()
  for (const t of texts) {
    for (const id of harvestObservedIds(t)) out.add(id)
  }
  return out
}

/**
 * (d) UNGROUNDED CARD IDS — ids the answer names that appeared in NO tool result
 * this turn (or in the replayed conversation — see `seedObservedIds`).
 *
 * Uses the tight `CARD_ID_STRICT` pattern, NOT the loose `CARD_ID` the harvester
 * uses. The accusation path has the opposite bias from the harvesting path: a
 * false POSITIVE here injects a "you named an id without looking it up" nudge
 * into a turn that named no id at all, while a false negative in harvesting
 * would let a fabricated id slip past. So this pattern is constrained to
 * plausible catalog ids — `me05-013`, `sv08.5-079`, `gym2-2` — and refuses
 * ordinary vocabulary like `late-game`, `win-loss`, `dry-run`, `two-of`,
 * `v1-v2` that the loose pattern matches. See `CARD_ID_STRICT` above.
 *
 * WHEN NOTHING WAS OBSERVED, every id passes: that is the same honest default
 * `grounding.ts`'s `partitionCards` takes — a turn with no data-tool calls has
 * no evidence either way, and refusing every id would break the legitimate flow
 * where a reader types an id and asks to see it. The check is for
 * CONTRADICTED ids, not unproven ones.
 *
 * `observedIds` is the set a tool-result harvester (and the cross-leg seeder)
 * accumulated, lowercased (matching how `grounding.ts` stores them).
 */
export function ungroundedCardIds(answerText: string, observedIds: Set<string>): string[] {
  if (observedIds.size === 0) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const m of answerText.matchAll(CARD_ID_STRICT)) {
    const id = m[0].toLowerCase()
    if (seen.has(id)) continue
    seen.add(id)
    if (!observedIds.has(id)) out.push(m[0])
  }
  return out
}