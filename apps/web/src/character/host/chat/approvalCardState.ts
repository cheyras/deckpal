/**
 * ══════════════════════════════════════════════════════════════════════════════
 * THE SEGMENTED APPROVAL CARD, AS PURE LOGIC
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * The owner's design: ONE card, TWO sections, ONE Accept.
 *
 *   1. printings we know      — plain rows, nothing to answer, each strikeable
 *   2. "what was the variant" — a picker per row
 *
 * and Accept commits section 1 EVEN IF a section-2 row is left unpicked. One
 * unknown must not hold up the batch.
 *
 * ── WHY THIS IS A MODULE AND NOT STATE INSIDE THE COMPONENT ──────────────────
 *
 * The same reason `approval.ts` is a module, written out in that file's header
 * and worth repeating because this is the more dangerous half: the two shipped
 * bugs in this round trip were invisible to the suite because the logic lived
 * inside a React hook that does its own `fetch` and its own
 * `supabase.auth.getSession()`, which `node --import tsx --test` cannot import
 * at all. Put per-row edits and a partial commit in `ApprovalCard.tsx` and they
 * will be exactly as untestable — while now deciding what gets WRITTEN.
 *
 * Nothing in this file touches the DOM, React, `fetch`, or Supabase. The commit
 * arrives as an injected function, which is what lets a test pin the ordering
 * rule below by watching the order two callbacks fire in.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * TWO PATHS, AND WHY THE EDITED ONE CANNOT JUST EDIT THE CALL
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * The SDK signs `HMAC(approvalId, toolCallId, toolName, hashCanonical(input))`
 * at hold time and verifies it over the input taken from the replayed history.
 * Editing `input` client-side does not "probably" fail — it fails BY
 * CONSTRUCTION, with `InvalidToolApprovalSignatureError`, and the turn dies.
 * That binding is the fix for a shipped bug (DECISIONS 2026-08-22) and it stays.
 * Re-signing is not expressible either: the signing helpers are module-internal
 * in `ai@7.0.66`, and a copy would own an unversioned format plus its legacy
 * variant.
 *
 * So:
 *
 *   PATH A — nothing was edited. Settle the held call `approved: true`. Today's
 *            path, today's signature, today's server-side `log_cards`, byte for
 *            byte. This is the owner's high-confidence case and it must stay
 *            boring.
 *
 *   PATH B — something was edited. NEVER touch the held call's arguments.
 *            Commit the corrected batch from the browser through the endpoint
 *            the reader is already entitled to, under their own JWT and RLS,
 *            and THEN settle the held call `approved: false` with a `reason`
 *            built from the real response. `convertToModelMessages` turns a
 *            denied `approval-responded` part directly into
 *            `tool-result {type:'execution-denied', reason}`
 *            (`ai/dist/index.js:10970-10981`), so his account of what happened
 *            stays true.
 *
 * ── COMMIT FIRST, SETTLE SECOND. IN THAT ORDER, WITHOUT EXCEPTION ────────────
 *
 * If the settle leg is lost, the worst outcome is that the model was not told
 * about a real write — recoverable, and the mutation ledger is the witness. If
 * the settle went first and the commit then failed, the model would have been
 * told a corrected write landed when it did not, which is the
 * unfalsifiable-in-the-moment failure this whole control exists to prevent.
 *
 * It is not only discipline: `correctionReason` takes the batch RESPONSE as its
 * argument, so the success message is unconstructible before the commit
 * returns. `commitThenSettleOrder` in the tests pins it anyway, because a data
 * dependency is a rule somebody can refactor away and a test is one they cannot.
 */

import type { Verdict } from '../approval'

export type { Verdict }

/** One printing a row could mean. Mirrors `ApprovalPreviewCandidate` on the wire. */
export type PreviewCandidate = {
  variantId: number
  kindCode: string
  label: string
  isPrimary: boolean
  ownedQty: number
}

export type PreviewCertainty = 'stated' | 'only-one' | 'unstated' | 'ambiguous' | 'unresolvable'

/** One row of the held write. `index` joins back to `input.items`. */
export type PreviewRow = {
  index: number
  cardId: string
  cardName: string
  setId: string | null
  number: string | null
  certainty: PreviewCertainty
  candidates: PreviewCandidate[]
  wouldUseVariantId: number | null
  variantId: number | null
  variantLabel: string | null
  mode: 'delta' | 'quantity'
  value: number
  before: number | null
  after: number | null
  clamped: boolean
}

/** The `data-decke-approval-preview` part's `data`, as the browser reads it. */
export type ApprovalPreview = {
  toolCallId: string
  tool: string
  title: string
  summary: string
  ok: boolean
  editable: boolean
  rows: PreviewRow[]
  skipped: { index: number; reason: string }[]
}

/**
 * What the reader did to one row. Keyed by `PreviewRow.index`.
 *
 * `value` IS THE STEPPER, and `null` is not zero — it means *untouched*, so the
 * row still carries the amount HE proposed. That distinction has to be in the
 * type rather than in a convention, because `0` is a legal value for a
 * `quantity` row ("set this to none") and a sentinel that collides with a real
 * value is a bug waiting for the first person who owns four of something and
 * wants none.
 */
export type RowChoice = { removed: boolean; variantId: number | null; value: number | null }

/** Every row's choice, keyed by row index. */
export type Choices = ReadonlyMap<number, RowChoice>

/** An item in the held call's own shape, as `log_cards` accepts it. */
export type HeldItem = Record<string, unknown>

/** A resolved operation, as `POST /collection/batch` accepts it. */
export type BatchItem = { variantId: number; delta?: number; quantity?: number }

// ── The question ─────────────────────────────────────────────────────────────

/**
 * ══════════════════════════════════════════════════════════════════════════════
 * THE HEADLINE IS HIS OWN SENTENCE. IT IS NOT ABOUT HIM.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * "Can I save this deck?" — the headline, composed from a tool's own title.
 *
 * IT USED TO BE THIRD PERSON and that was the owner's clearest note on this
 * whole card: *"this is all third person, this should be him talking like he's
 * presenting it to us. So here's what I'm thinking of adding, or whatever makes
 * sense."* Every string on this card was written as though a narrator were
 * describing Deck-E to the reader — "Let him add 3 cards?", "He knows these
 * printings", "What was the variant on this one?" — while the character it
 * describes is standing beside the panel, has just spoken in first person, and
 * is the one asking. A dialog that switches to the third person to talk about
 * the person you are talking to is a stage direction, not a conversation.
 *
 * So: he asks. `approvalHeadline` below is the version that reads the ROWS and
 * is what a `log_cards` card actually shows; this is the fallback for a write
 * with no row-level preview, where the tool's own phrase is all there is.
 *
 * THIS IS LOGIC AND NOT PRESENTATION, which the last version proved by being
 * wrong on screen. The card used to render `` `Let him ${title.toLowerCase()}?` ``
 * inline, so a title that already read as a request came out as
 * *"Let him let him add a card??"* — photographed, on the gallery page, in the
 * first run of a review the whole surface exists to make possible. A string
 * that can be malformed by its input is a function, and a function gets a test.
 *
 * Three things it has to survive, each of which a real title has done:
 *
 *  1. **Already a request.** `titleFor` in `useDeckeChat` produces bare verb
 *     phrases ("Adding to your collection"), but `uiToolTitle` and the server's
 *     own titles are not bound by that, and the fixture that caught this came
 *     from a reviewer writing the string a human would write. The strip below
 *     covers the third-person lead-ins as well as the first-person ones, because
 *     a title written before this change is still a title that can arrive.
 *  2. **Terminal punctuation.** "?" or "." or "!" at the end must not survive
 *     into the middle of the composed sentence, and must not double at the end.
 *  3. **A proper noun or an acronym first.** `toLowerCase()` on the whole
 *     string turned "Add Charizard ex" into "add charizard ex" and would turn
 *     "TCGplayer import" into "tcgplayer import". Only the first CHARACTER is
 *     ever lowered, and only when the first word is not already carrying
 *     capitals of its own.
 */
export function approvalQuestion(title: string): string {
  const trimmed = stripTerminal(title)
  if (!trimmed) return 'Can I make that change?'
  const bare = trimmed.replace(/^(?:can\s+i|let\s+h(?:im|er|them)|let\s+me|i(?:'d| would)\s+like\s+to|i\s+want\s+to)\s+/i, '')
  const body = bare || trimmed
  return `Can I ${softLowerFirst(body)}?`
}

/**
 * The headline when the card knows what the rows ARE — which is the log_cards
 * case, i.e. very nearly every card anybody sees.
 *
 * Written from the direction of the batch rather than from the tool's name,
 * because the owner's own phrasing for it was about the CONTENT: *"here's what
 * I'm thinking of adding"*. A sentence naming the operation is also the thing
 * that stops the read-then-press gap this card keeps producing — he says what
 * kind of change it is, the rows say which cards, and the button says how many.
 *
 * MIXED BATCHES GET THE NEUTRAL SENTENCE, for the same reason
 * `acceptButtonLabel` does: "here's what I want to add" over a list that also
 * takes two cards away is the one sentence on this card that could get somebody
 * to press through a removal they did not read.
 *
 * Falls back to `approvalQuestion` for a write with no rows at all — a deck
 * save, a list edit, a revert — where the tool phrase is the only fact there is.
 */
export function approvalHeadline(title: string, preview: ApprovalPreview | null): string {
  const rows = preview?.editable ? preview.rows : []
  if (rows.length === 0) return approvalQuestion(title)
  const deltas = rows.filter((r) => r.mode === 'delta')
  if (deltas.length === rows.length) {
    if (deltas.every((r) => r.value > 0)) {
      return rows.length === 1 ? "Here's the card I want to add." : "Here's what I want to add."
    }
    if (deltas.every((r) => r.value < 0)) {
      return rows.length === 1
        ? "Here's the card I want to take off your collection."
        : "Here's what I want to take off your collection."
    }
  }
  return rows.length === 1
    ? "Here's the change I want to make."
    : "Here's the set of changes I want to make."
}

/** Trailing "?", ".", "!" and whitespace — repeated, so "card??" collapses too. */
function stripTerminal(s: string): string {
  return s.trim().replace(/[?.!…\s]+$/u, '')
}

/**
 * Lowercase the first letter, unless the first word wears capitals of its own.
 *
 * "Add cards" → "add cards". "TCGplayer import" and "eBay sync" are left alone,
 * because a word whose SECOND character onward is not all lowercase is a name or
 * an acronym, and lowering it makes a typo out of a fact.
 */
function softLowerFirst(s: string): string {
  const first = s.split(/\s/u, 1)[0] ?? ''
  const tail = first.slice(1)
  if (tail && tail !== tail.toLowerCase()) return s
  return s.charAt(0).toLowerCase() + s.slice(1)
}

/**
 * The line about calls this card is NOT showing, or `''`.
 *
 * `heldCalls` is a count of TOOL CALLS the model held in one step, of which
 * this card shows the first. It is not a count of cards, and the two were
 * conflated once already — the gallery passed the row count and the card
 * announced *"he also asked for 2 other changes"* directly above all three of
 * them. Deriving the sentence here rather than in JSX is what lets a test say
 * which number it counts.
 */
export function unshownCallsNote(heldCalls: number): string {
  const unshown = Math.max(0, Math.floor(heldCalls) - 1)
  if (unshown === 0) return ''
  // FIRST PERSON, like everything else on this card. It is his admission that he
  // over-reached in one step, and an admission read out by a narrator is not an
  // admission.
  if (unshown === 1) {
    return 'I asked for one other change too. It is not shown here, so it will not run — ask me about it on its own.'
  }
  return `I asked for ${unshown} other changes too. They are not shown here, so they will not run — ask me about them on their own.`
}

// ── The two sections, in his voice ───────────────────────────────────────────

/**
 * What he calls the rows he is sure about, and the rows he is not.
 *
 * Here rather than inline in the JSX for the reason the whole of this file
 * exists: they are sentences with a plural rule in them, and a sentence with a
 * rule in it is a function. The old pair read "He knows these printings" and
 * "What was the variant on this one?" — a narrator, and a form-field prompt.
 *
 * The second one keeps being a QUESTION, because it is one and because an
 * unnamed printing is an ordinary thing rather than an error. What changes is
 * who is asking it.
 */
export function knownSectionHeading(count: number): string {
  return count === 1 ? "I'm sure about this printing" : "I'm sure about these printings"
}

/**
 * The asking section, which is no longer "I have no idea".
 *
 * ── WHAT CHANGED UNDER THIS HEADING, AND WHY THE WORDS HAD TO ────────────────
 *
 * `reopenIfProxyStated` (adapter, 2026-08-23) demotes a `stated` row back to
 * `unstated` whenever the READER's own sentence named no printing — because
 * measured, Deck-E fills that field on 100 items out of 100, so "they said which
 * one" was a fact about HIM. His pick rides along as `wouldUseVariantId`.
 *
 * So the rows under this heading are now mostly rows he DID have an answer for,
 * offered as a proposal. "I couldn't tell which printing this was" would be
 * false of them — he could tell, he just does not get to decide. And `ambiguous`
 * rows, where he genuinely could not, sit in the same section.
 *
 * One sentence has to be true of both, which is why it is about CERTAINTY rather
 * than about knowledge.
 */
export function askingSectionHeading(count: number): string {
  return count === 1
    ? "I'm not certain about this printing — can you confirm it?"
    : "I'm not certain about these printings — can you confirm them?"
}

/** His line about rows the planner could not resolve at all. */
export function skippedNote(count: number): string {
  if (count <= 0) return ''
  return count === 1
    ? "I couldn't match one more item to a card, so I'm leaving it out."
    : `I couldn't match ${count} more items to cards, so I'm leaving them out.`
}

// ── Sections ─────────────────────────────────────────────────────────────────

/**
 * Does this row need a person to pick a printing?
 *
 * THE ONE PLACE THE FOUR KINDS COLLAPSE INTO TWO BUCKETS, mirroring
 * `certaintyAsksSelection` in `@deckpal/agent-tools`. `unresolvable` is neither
 * bucket — a card carrying one is not editable at all.
 */
export function asksSelection(row: Pick<PreviewRow, 'certainty'>): boolean {
  return row.certainty === 'unstated' || row.certainty === 'ambiguous'
}

/**
 * The two sections, in the held call's own row order.
 *
 * `known` rows carry no control that looks like a question — that is the
 * owner's requirement, in his words: *"if it's truly high confidence I don't
 * want the user to feel like they have to pick a variant again."* Removal is
 * not a question; it is a correction, and it is the one affordance both
 * sections share.
 */
export function sections(preview: ApprovalPreview): { known: PreviewRow[]; asking: PreviewRow[] } {
  const known: PreviewRow[] = []
  const asking: PreviewRow[] = []
  for (const r of preview.rows) (asksSelection(r) ? asking : known).push(r)
  return { known, asking }
}

/** Every row unremoved, unpicked and at his own amount — the state the card opens in. */
export function initialChoices(preview: ApprovalPreview): Map<number, RowChoice> {
  return new Map(preview.rows.map((r) => [r.index, { removed: false, variantId: null, value: null }]))
}

const NO_CHOICE: RowChoice = { removed: false, variantId: null, value: null }

export function choiceFor(choices: Choices, index: number): RowChoice {
  return choices.get(index) ?? NO_CHOICE
}

// ── The stepper ──────────────────────────────────────────────────────────────

/**
 * ══════════════════════════════════════════════════════════════════════════════
 * A STEPPER THAT NEVER CHANGES THE DIRECTION OF THE OPERATION
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * The owner's ask, in his words: *"he adds one, you know, that's what they asked
 * for, but they can adjust the amount that we're adding."* **Adjust the amount**
 * — not flip the sentence.
 *
 * So the bounds below are stated in the operation's OWN units and are one-sided
 * by construction. A `+1` row steps 1…99 and can never reach 0 or go negative; a
 * `−2` row steps −1…−99 and can never become an add. That is not fussiness: the
 * confirm button says "Add 3 cards" or "Remove 3 cards" depending on whether
 * every row points the same way (`acceptButtonLabel`), so a stepper that could
 * cross zero could silently change the verb on the button under the reader's
 * hand between the moment they read it and the moment they press it. The way out
 * of a row pointing the wrong way is "Wrong card", which removes it, and then
 * asking him for the other direction — an explicit act, not a side effect of
 * holding down a minus.
 *
 * A `quantity` row is absolute, so 0 IS meaningful there and is allowed: "set
 * this to none" is a real thing to say and the server accepts it.
 *
 * The ceiling is 99 rather than the server's 100000. Nothing about a
 * click-a-button control makes four figures reachable, and a cap a person can
 * hit is better than one they cannot: the number they can type is on the
 * composer, in words, where he can plan the whole batch.
 */
export const STEP_MAX = 99

export type StepBounds = { min: number; max: number }

export function stepBounds(row: Pick<PreviewRow, 'mode' | 'value'>): StepBounds {
  if (row.mode === 'quantity') return { min: 0, max: STEP_MAX }
  return row.value < 0 ? { min: -STEP_MAX, max: -1 } : { min: 1, max: STEP_MAX }
}

/** A value forced inside this row's bounds. */
export function clampStep(row: Pick<PreviewRow, 'mode' | 'value'>, value: number): number {
  const { min, max } = stepBounds(row)
  const n = Math.trunc(Number.isFinite(value) ? value : row.value)
  return Math.min(max, Math.max(min, n))
}

/**
 * The amount this row will actually move by — his, or the reader's correction.
 *
 * ONE FUNCTION, READ EVERYWHERE. The value reaches the screen four times (the
 * delta chip, the projected after-count, the stepper's own readout, the button's
 * count) and the wire once, and every one of those has to be the same number or
 * the card is lying somewhere. The clamp is applied HERE rather than trusted
 * from the setter, so a stored choice that predates a bounds change still
 * renders inside them.
 */
export function effectiveValue(row: PreviewRow, choice: RowChoice): number {
  return choice.value === null ? row.value : clampStep(row, choice.value)
}

/** One press of + or −, in this row's own direction. Returns the NEW value. */
export function stepBy(row: PreviewRow, choice: RowChoice, direction: 1 | -1): number {
  const current = effectiveValue(row, choice)
  // A REMOVAL'S "MORE" IS MORE NEGATIVE. `+` on a `−1` row means "take away two",
  // which is −2. Stepping the raw number would make `+` mean "take away less",
  // so the control under the plus sign would shrink the operation — the exact
  // inversion somebody presses twice before they notice.
  const sign = row.mode === 'delta' && row.value < 0 ? -1 : 1
  return clampStep(row, current + direction * sign)
}

/**
 * Where this row's count lands, recomputed from the reader's own amount.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * X2 LIVES HERE. The dry run's `after` was computed for HIS number.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * The moment a stepper exists, `row.after` is a fact about a batch that is no
 * longer the batch being confirmed. Leaving it on screen would put a stale
 * quantity two inches from a live one — and it would be stale in the direction
 * that under-states what is about to happen, since the reader most often steps
 * UP. So it is recomputed, by the same arithmetic the server does
 * (`apps/api/src/routes/collection.ts` — `after = clamp(before + delta, 0, …)`;
 * an absolute quantity is its own answer), and it returns `null` — showing
 * nothing at all — when the dry run did not carry a `before` to compute from.
 *
 * `null` rather than a guess is the whole point. A projection needs a real
 * starting count; without one there is no honest number to draw.
 */
export function projectedAfter(row: PreviewRow, value: number): number | null {
  if (row.mode === 'quantity') return Math.max(0, value)
  if (row.before === null) return null
  return Math.max(0, row.before + value)
}

/**
 * Will this row be written when Accept is pressed?
 *
 * A section-2 row is EXCLUDED UNTIL PICKED. That is the behaviour change the
 * owner asked for and it should be stated plainly: today an omitted printing on
 * a multi-printing card silently becomes the primary and IS written. After
 * this it is asked about, and if the question is ignored the row is not
 * written. The first person to notice a card that "didn't get added" will
 * otherwise file it as a bug.
 */
export function rowIsIncluded(row: PreviewRow, choice: RowChoice): boolean {
  if (choice.removed) return false
  if (!asksSelection(row)) return true
  return choice.variantId !== null
}

/** Rows that will actually be written, in row order. */
export function includedRows(preview: ApprovalPreview, choices: Choices): PreviewRow[] {
  return preview.rows.filter((r) => rowIsIncluded(r, choiceFor(choices, r.index)))
}

/**
 * How many cards Accept will move, for the button.
 *
 * The count must track the picks: a person who presses Accept with section 2
 * untouched must not be able to be surprised by what happened, and the number
 * on the button is the cheapest possible way to say so.
 */
export function acceptCount(preview: ApprovalPreview, choices: Choices): number {
  return includedRows(preview, choices).length
}

/**
 * What the Accept button says.
 *
 * IT NAMES THE OPERATION, not just the count. "Add 4000 cards" and "Set 3
 * cards to 0" are very different presses, and a button that says the same word
 * for both is a button that will one day be pressed for the wrong one. A batch
 * that mixes directions gets the neutral word rather than a guess.
 *
 * Here rather than in the component so it is driven by a test — a label is the
 * last thing a person reads before authorising a write, which makes it logic.
 */
export function acceptButtonLabel(preview: ApprovalPreview, choices: Choices): string {
  const rows = includedRows(preview, choices)
  const n = rows.length
  if (n === 0) return 'Nothing to add'
  const noun = n === 1 ? 'card' : 'cards'
  // READ THROUGH `effectiveValue`, not off the row. The sign cannot move — see
  // `stepBounds` — so today these agree; reading the live value anyway means the
  // day somebody widens the bounds, the verb on the button is still derived from
  // the number the button is actually going to send.
  const dir = (r: PreviewRow) => (r.mode === 'delta' ? effectiveValue(r, choiceFor(choices, r.index)) : 0)
  if (rows.every((r) => r.mode === 'delta' && dir(r) > 0)) return `Add ${n} ${noun}`
  if (rows.every((r) => r.mode === 'delta' && dir(r) < 0)) return `Remove ${n} ${noun}`
  return n === 1 ? 'Apply 1 change' : `Apply ${n} changes`
}

// ── What every row says about itself ─────────────────────────────────────────

/**
 * ══════════════════════════════════════════════════════════════════════════════
 * THE PRINTING CHIPS ARE ON EVERY ROW NOW. THAT IS AN OWNER RULING.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Until now a printing appeared as a CHIP only when he was unsure, and as plain
 * grey text ("me05 · #013 · Normal") when he was sure. Two different renderings
 * of the same fact, and the confident one was the one you could not act on.
 *
 * The owner decided both halves of the fix at once and named both payoffs:
 *
 *  1. **A wrong printing becomes a click rather than a complaint.** Wherever
 *     there is more than one printing to choose from, the alternatives are on
 *     screen, selected state and all.
 *  2. **It is the answer to "why is he sure".** *"We need to be more clear about
 *     like why he knows."* When there is exactly ONE chip, the chip IS the
 *     explanation — there was nothing else it could have been. That is a fact
 *     about the catalogue, not a confidence score, and it is the distinction
 *     this card's header has always insisted on.
 *
 * ── THREE STATES, NOT TWO ────────────────────────────────────────────────────
 *
 * `reopenIfProxyStated` in the API adapter changed what the middle of this card
 * means, and the chips are where that has to become visible:
 *
 *   1. **SETTLED BECAUSE THEY SAID SO** (`stated`). The reader's own sentence
 *      named a printing. One chip, filled, not a control — and it is not a
 *      control for a reason stronger than taste: `assertNarrowing` throws
 *      `overrode a stated printing` if a client tries to change it, so a
 *      pressable chip here would be a control that cannot work.
 *   2. **SETTLED BECAUSE THERE IS ONLY ONE** (`only-one`). Same treatment, and
 *      the chip standing visibly alone IS the answer to *"we need to be more
 *      clear about like why he knows"*.
 *   3. **PROPOSED, AWAITING CONFIRMATION** (`unstated`, `ambiguous`). A real
 *      picker. When the row carries a `wouldUseVariantId` the chip for it is
 *      marked `proposed` — HIS guess, drawn as a guess — and it is emphatically
 *      NOT pre-selected: `rowIsIncluded` keeps the row out of the batch until
 *      somebody presses it, which is the whole of *"not added until you pick
 *      one"*.
 *
 * A `stated` row that survives the demotion is one where the reader genuinely
 * typed "reverse holo", so it needs no question. A row where Deck-E typed it for
 * them arrives here as case 3, with his pick as the proposal.
 *
 * ── THE SETTLED CHIP IS BUILT FROM `candidates`, NOT FROM `variantLabel` ─────
 *
 * `resolve.ts` now carries candidates on every resolvable kind, so the settled
 * label comes from the same catalogue list the picker would have drawn — one
 * source, so the two renderings of "Reverse holo" cannot disagree. The
 * `variantLabel` fallback stays for a row that somehow arrives without the list,
 * because a chip with the right words in it beats no chip at all.
 */
export type PrintingChip = {
  variantId: number | null
  label: string
  selected: boolean
  /** His guess, offered rather than applied. Never true once something is picked. */
  proposed: boolean
  ownedQty: number
}

export type RowPrintings = {
  chips: PrintingChip[]
  /** Can the reader change this? False for the two settled kinds. */
  selectable: boolean
}

export function rowPrintings(row: PreviewRow, choice: RowChoice): RowPrintings {
  if (asksSelection(row) && row.candidates.length > 0) {
    const undecided = choice.variantId === null
    return {
      selectable: true,
      chips: row.candidates.map((c) => ({
        variantId: c.variantId,
        label: c.label,
        selected: choice.variantId === c.variantId,
        // ONLY WHILE NOTHING IS CHOSEN. Once the reader has answered, his guess
        // is history — leaving it marked would put two emphasised chips in one
        // group and make the answered state look unanswered.
        proposed: undecided && c.variantId === row.wouldUseVariantId,
        ownedQty: c.ownedQty,
      })),
    }
  }
  // The resolved printing, as one settled chip.
  const settled = row.candidates.find((c) => c.variantId === row.variantId)
  const label = settled?.label ?? row.variantLabel
  if (label) {
    return {
      selectable: false,
      chips: [
        {
          variantId: row.variantId,
          label,
          selected: true,
          proposed: false,
          ownedQty: settled?.ownedQty ?? 0,
        },
      ],
    }
  }
  return { selectable: false, chips: [] }
}

/**
 * Why he is sure — in one clause, from `certainty` and nothing else.
 *
 * The card's own header forbids turning `certainty` into a meter, and this does
 * not: there is no ordering here, no score and no adjective. `stated` and
 * `only-one` are two different FACTS about where the printing came from, and
 * saying which one it was is the whole of what the owner asked for. A row whose
 * printing is still a question gets nothing, because the question above it has
 * already said so.
 */
export function whyThisPrinting(row: Pick<PreviewRow, 'certainty'>): string {
  if (row.certainty === 'stated') return 'you named it'
  if (row.certainty === 'only-one') return "it's the only printing"
  return ''
}

/**
 * ══════════════════════════════════════════════════════════════════════════════
 * ONE LINE PER ROW THAT NEVER DISAPPEARS — IT CHANGES.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * The defect, in the owner's words, is worth quoting in full because it is the
 * clearest statement of what this card is for:
 *
 *   *"down here it says add two cards and the first time I did this I was like,
 *   oh well it's five cards. It's because we're not telegraphing well enough
 *   that these won't be added."*
 *
 * Five rows on screen, a button saying two, and nothing on the three excluded
 * rows saying they were excluded. The old copy — "Not added until you pick one"
 * — was correct AND it VANISHED the moment you answered, which is exactly
 * backwards: a line that appears only in the bad state is a line whose absence
 * carries meaning, and absence is the one thing nobody reads. His instruction
 * was explicit: *"it shouldn't go away, it should turn into like 'this card will
 * be added'."*
 *
 * So every row that can be excluded carries a line in every state, and the line
 * is the row's ANSWER to "will this happen":
 *
 *   picked / known   → "I'll add this one."      (affirmative, and it stays)
 *   not yet picked   → "I won't add this until you pick a printing."
 *   struck out       → "Leaving this one out."
 *
 * The verb tracks the operation, so a removal does not announce itself as an
 * add. `included` comes back with the sentence so the component can tone it
 * without deciding anything.
 */
export type RowStatus = {
  included: boolean
  reason: 'ready' | 'needs-printing' | 'removed'
  text: string
}

/**
 * What this row DOES, as a verb phrase he can put "I'll" in front of.
 *
 * Split out because it is needed twice — once in the affirmative line and once
 * in the promise attached to an unanswered question — and because the wrong verb
 * on a removal is the specific near-miss a reader glides past. "I won't add
 * this" on a row that proposes to TAKE two cards away is a sentence that is
 * both comforting and false.
 */
function rowVerbPhrase(row: PreviewRow, value: number): string {
  if (row.mode === 'quantity') return `set this one to ${value}`
  if (value < 0) {
    const n = Math.abs(value)
    return n === 1 ? 'take one of these away' : `take ${n} of these away`
  }
  return value === 1 ? 'add one of these' : `add ${value} of these`
}

export function rowStatus(row: PreviewRow, choice: RowChoice): RowStatus {
  if (choice.removed) {
    return { included: false, reason: 'removed', text: 'Leaving this one out.' }
  }
  const value = effectiveValue(row, choice)
  const phrase = rowVerbPhrase(row, value)

  if (asksSelection(row) && choice.variantId === null) {
    // HIS GUESS, NAMED AS A GUESS. `wouldUseVariantId` is the printing the
    // server would have written — and since `reopenIfProxyStated` landed in the
    // API adapter, on an ordinary "add five Squirtles" it is the one HE typed
    // into the tool call. Naming it turns a question into one press, and saying
    // "I think" is the difference between offering it and having already taken
    // it.
    //
    // NOT PRE-SELECTED, and that is the whole control: the row stays out of the
    // batch until somebody presses the chip. See `rowIsIncluded`.
    const would = row.candidates.find((c) => c.variantId === row.wouldUseVariantId)
    return {
      included: false,
      reason: 'needs-printing',
      text: would
        ? `I think it's the ${would.label.toLowerCase()} — confirm that and I'll ${phrase}.`
        : `Pick a printing and I'll ${phrase}.`,
    }
  }
  return { included: true, reason: 'ready', text: `I'll ${phrase}.` }
}

/**
 * The whole card's arithmetic, in one sentence above the button.
 *
 * ── WHY THIS AND NOT THE REGROUPING HE FLOATED ───────────────────────────────
 *
 * The owner raised, unsure, a second idea: *"maybe even like once we pick one it
 * goes up to another section that's like 'these will be added'."* This is the
 * other answer to the same problem and it is the one that shipped, for three
 * reasons worth writing down since the idea will come back:
 *
 *  1. **It would move the row out from under the cursor at the instant it is
 *     clicked.** This card already refuses to reflow while somebody is reading
 *     it — that is why `CardImage` fixes its box before a byte of art arrives —
 *     and a consent dialog that relocates the thing you just pressed is a worse
 *     version of the same defect, three times over on a three-row batch.
 *  2. **Row order is the join back to the held call.** `index` is what
 *     `assertNarrowing` proves the batch is a subsequence of; a display order
 *     that diverges from it is one more thing that can be read wrong by a human
 *     comparing the card to the transcript.
 *  3. **The problem he actually described was a COUNT, not a grouping.** Five
 *     rows, a button saying two, nothing joining them. A sentence that states
 *     the split — and per-row lines that say which side each row is on — closes
 *     that gap without moving anything.
 *
 * If it still reads unclear on the next recording, regrouping is the next thing
 * to try and this paragraph is the record of why it was not the first.
 */
export function acceptSummary(preview: ApprovalPreview, choices: Choices): string {
  const rows = preview.rows
  if (rows.length === 0) return ''
  const statuses = rows.map((r) => rowStatus(r, choiceFor(choices, r.index)))
  const included = statuses.filter((s) => s.included).length
  const needsPrinting = statuses.filter((s) => s.reason === 'needs-printing').length
  const removed = statuses.filter((s) => s.reason === 'removed').length

  // THE VERB FOLLOWS THE BATCH. "2 of these 3 will be added" over a list that
  // takes cards away is the one sentence on this card whose wrongness would be
  // comfortable to read past.
  const verb = rows.every((r) => r.mode === 'delta' && r.value > 0)
    ? 'be added'
    : rows.every((r) => r.mode === 'delta' && r.value < 0)
      ? 'be removed'
      : 'go through'

  // NOTHING TO SAY WHEN THERE IS NOTHING TO SPLIT. One row that is going in
  // needs no arithmetic, and a line reading "1 of 1" under a single row is the
  // chrome this card keeps having to have removed from it.
  if (included === rows.length) return rows.length === 1 ? '' : `All ${rows.length} of these will ${verb}.`

  const head =
    included === 0
      ? `None of these will ${verb}.`
      : `${included} of these ${rows.length} will ${verb}.`
  const tail: string[] = []
  if (needsPrinting > 0) {
    tail.push(needsPrinting === 1 ? 'one still needs a printing' : `${needsPrinting} still need a printing`)
  }
  if (removed > 0) tail.push(removed === 1 ? "one you've left out" : `${removed} you've left out`)
  return tail.length ? `${head} ${capitalise(tail.join(', and '))}.` : head
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

// ── One row, in words ────────────────────────────────────────────────────────

/**
 * "+1", "−2", "Set to 5" — the operation, in the words it will happen in.
 *
 * A REAL MINUS SIGN (U+2212), not a hyphen: at 12px in a tabular column a
 * hyphen is a third of the width of the plus it sits under and the column reads
 * ragged. Here rather than in the component because it renders a NUMBER, and a
 * number that reaches the screen without a test behind it is the X2 failure
 * this whole card is built against.
 */
export function operationText(row: Pick<PreviewRow, 'mode' | 'value'>): string {
  if (row.mode === 'quantity') return `Set to ${row.value}`
  return row.value > 0 ? `+${row.value}` : `−${Math.abs(row.value)}`
}

/**
 * "0 → 1", or `''` when the dry run did not carry both ends.
 *
 * Split out of the row's own line because the redesign puts it under the
 * operation rather than after it, and because `before === 0` is falsy — the
 * inline version tested `row.before !== null` correctly and the next person to
 * shorten it would not have.
 */
export function beforeAfterText(row: Pick<PreviewRow, 'before' | 'after'>): string {
  if (row.before === null || row.after === null) return ''
  return `${row.before} → ${row.after}`
}

/**
 * "me05 · #013 · Normal" — the second line of a row, under the card's name.
 *
 * The name is the headline and this is everything needed to tell two printings
 * of it apart. Every part is optional because the catalogue's own fields are:
 * a promo with no set id, a card with no collector number, and a row whose
 * printing nobody has named all reach this function in the real product.
 */
export function rowMetaText(
  row: Pick<PreviewRow, 'setId' | 'number' | 'variantLabel'>,
): string {
  return [row.setId, row.number ? `#${row.number}` : null, row.variantLabel]
    .filter((p): p is string => Boolean(p))
    .join(' · ')
}

// ── The router, and its cross-check ──────────────────────────────────────────

/**
 * Did the reader change anything about what gets written?
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ROUTED ON THE CHOICES THEMSELVES, NEVER ON A RECONSTRUCTION
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * The design's first draft routed on `isUnedited(acceptedItems(held, choices))`
 * — the same function that BUILDS the batch. A reviewer caught what that costs:
 * a bug in the reconstruction (a dropped `removed` flag, an index misalignment)
 * makes the rebuilt list equal the held one, the router says "unedited", and
 * Path A auto-approves the ORIGINAL batch — including a row the reader visibly
 * struck out. That is the false-positive direction, on a consent dialog.
 *
 * So this reads the user's actual gestures and the card's own structure, one
 * step from what they did, with nothing to get wrong:
 *
 *   • any row struck out                → edited
 *   • any row in section 2 AT ALL       → edited, picked or not
 *   • any row whose AMOUNT was stepped  → edited
 *
 * The second clause is not a shortcut. A picked section-2 row gains a
 * `variant_id` the held call did not have; an unpicked one is excluded. Either
 * way what gets written differs from the held call, so the presence of the
 * question is itself the edit.
 *
 * The third clause is the stepper, and it is the one that would be catastrophic
 * to omit. Path A settles the held call `approved: true`, which replays HIS
 * arguments verbatim — so a router blind to the stepper would take a reader who
 * had visibly changed "+1" to "+4" down the path that writes +1, and the
 * transcript would then report his number as though it were theirs. It is
 * checked against the CHOICE rather than against a rebuilt batch for the reason
 * above, and `clampStep` is applied so that a stored value equal to his after
 * clamping is correctly read as no edit at all.
 *
 * Consequence worth stating: any batch containing one unstated printing takes
 * Path B even if the reader touches nothing. Given that the prompt steers the
 * model away from naming printings, that is plausibly the MAJORITY add, not an
 * exception. Path B is a mainstream path and is tested as one.
 */
export function isEdited(preview: ApprovalPreview, choices: Choices): boolean {
  return preview.rows.some((r) => {
    const c = choiceFor(choices, r.index)
    return c.removed || asksSelection(r) || effectiveValue(r, c) !== r.value
  })
}

/**
 * JSON with object keys sorted, at every depth.
 *
 * The same notion of "the same input" the SDK's own signature uses
 * (`hashCanonical`, `ai/dist/index.js:5031-5046`), so the predicate and the
 * primitive cannot drift apart.
 *
 * Worth one sentence so nobody "fixes" the asymmetry: the SIGNATURE binds the
 * canonical JSON of the WHOLE input — `{items, note, dry_run, …}` — while this
 * compares `items` only. That is fine, because this comparison is ROUTING, not
 * security. Path A replays the original input verbatim regardless of what this
 * says; the signature does the enforcing, as it should.
 */
export function canonicalJSON(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJSON(v)}`).join(',')}}`
}

/**
 * The held items the card is actually ABOUT.
 *
 * Not `held` itself. A batch can contain items the planner refused before it
 * ever resolved a card — "has both delta and quantity" — and those never became
 * rows. `log_cards` skips them server-side either way, so they are outside the
 * comparison; including them would make an untouched card look edited.
 */
export function previewedHeldItems(held: readonly HeldItem[], preview: ApprovalPreview): HeldItem[] {
  return preview.rows.map((r) => held[r.index] ?? {})
}

/**
 * The item list the reader has actually accepted, in the HELD CALL'S OWN SHAPE.
 *
 * Each entry keeps its original `index`, because the narrowing check needs to
 * prove the result is a subsequence of what was shown, and an index is the only
 * thing that can prove it.
 */
export function acceptedItems(
  held: readonly HeldItem[],
  preview: ApprovalPreview,
  choices: Choices,
): { index: number; item: HeldItem }[] {
  const out: { index: number; item: HeldItem }[] = []
  for (const row of preview.rows) {
    const choice = choiceFor(choices, row.index)
    if (!rowIsIncluded(row, choice)) continue
    const base = held[row.index] ?? {}
    const item: HeldItem = asksSelection(row) ? { ...base, variant_id: choice.variantId } : { ...base }
    // THE STEPPER, WRITTEN BACK INTO THE HELD CALL'S OWN SHAPE.
    //
    // `log_cards` takes exactly one of `delta` | `quantity` per item and rejects
    // an item carrying both (`logging.ts` — "has BOTH delta and quantity"), so
    // the key written is the one this row's MODE names and the other is never
    // introduced. Untouched rows are left byte-identical, which is what keeps
    // `assertRouteAgrees` able to tell an edit from a no-op.
    const value = effectiveValue(row, choice)
    if (value !== row.value) {
      if (row.mode === 'quantity') item.quantity = value
      else item.delta = value
    }
    out.push({ index: row.index, item })
  }
  return out
}

/** The two derivations disagreed, which is a bug in the card, not a state. */
export class ApprovalEditError extends Error {
  override name = 'ApprovalEditError'
}

/**
 * The cross-check the router is NOT.
 *
 * Two independent derivations of "did anything change" — the reader's gestures,
 * and canonical-JSON equality over the rebuilt list — that must agree. If they
 * do not, something is wrong with the card and the correct response is to send
 * NOTHING, not to guess which one to believe. This throws before a byte leaves
 * the browser.
 */
export function assertRouteAgrees(
  held: readonly HeldItem[],
  preview: ApprovalPreview,
  choices: Choices,
): void {
  const edited = isEdited(preview, choices)
  const accepted = canonicalJSON(acceptedItems(held, preview, choices).map((a) => a.item))
  const shown = canonicalJSON(previewedHeldItems(held, preview))
  if (edited && accepted === shown) {
    throw new ApprovalEditError(
      'the reader edited this card but the rebuilt batch is identical to the held one',
    )
  }
  if (!edited && accepted !== shown) {
    throw new ApprovalEditError(
      'nothing was edited but the rebuilt batch differs from the held one',
    )
  }
}

/**
 * Is this edit a legal narrowing-or-adjustment of what was previewed?
 *
 * `accepted` must be a subsequence of the shown rows by `index`; every surviving
 * row must still be about THE SAME CARD; and exactly two things may differ from
 * the held item:
 *
 *   • `variant_id`, set to a printing drawn from THAT ROW'S OWN candidate list,
 *     and only on a row that had no stated printing to begin with;
 *   • the AMOUNT — `delta` or `quantity`, whichever this row's mode names —
 *     within `stepBounds`, which cannot cross zero on a delta.
 *
 * Nothing may be added, no card may change, and no row may swap which KIND of
 * amount it carries: a `delta` row that arrived here as a `quantity` would be a
 * different operation wearing the same row.
 *
 * ── WHY THE AMOUNT IS ALLOWED NOW, AND WHY THE CHECK GOT LONGER ──────────────
 *
 * The previous version's rule was "every surviving row keeps its operation
 * EXACTLY", which was the right rule for a card with no stepper on it. Adding
 * one means the check can no longer be "nothing moved"; it has to be "what moved
 * is one of the two things the UI can move, and it moved somewhere legal". That
 * is strictly more code and strictly the same job — this is the assertion that
 * the UI produced what the UI is supposed to produce.
 *
 * Still not a security boundary. The write goes out under the reader's own JWT
 * through an endpoint they can already call, so nothing here grants authority.
 * An edit that fails it is a bug in this card, and it must throw rather than
 * send.
 */
export function assertNarrowing(
  held: readonly HeldItem[],
  preview: ApprovalPreview,
  accepted: readonly { index: number; item: HeldItem }[],
): void {
  const byIndex = new Map(preview.rows.map((r) => [r.index, r]))
  let previous = -1
  for (const { index, item } of accepted) {
    const row = byIndex.get(index)
    if (!row) throw new ApprovalEditError(`accepted row ${index} was never previewed`)
    if (index <= previous) throw new ApprovalEditError('accepted rows are out of order or repeated')
    previous = index

    const original = held[index] ?? {}
    // Everything the reader is NOT allowed to touch, compared whole: the card
    // identity, the note, and anything a future version of `log_cards` grows.
    const strip = (o: HeldItem): HeldItem => {
      const { variant_id: _v, delta: _d, quantity: _q, ...rest } = o
      return rest
    }
    if (canonicalJSON(strip(item)) !== canonicalJSON(strip(original))) {
      throw new ApprovalEditError(
        `accepted row ${index} changed something other than its printing or its amount`,
      )
    }

    if (item.variant_id !== original.variant_id) {
      if (original.variant_id !== undefined) {
        throw new ApprovalEditError(`accepted row ${index} overrode a stated printing`)
      }
      const picked = item.variant_id
      if (!row.candidates.some((c) => c.variantId === picked)) {
        throw new ApprovalEditError(
          `accepted row ${index} picked printing ${String(picked)}, which is not one of its candidates`,
        )
      }
    }

    // ── The amount ───────────────────────────────────────────────────────────
    const key = row.mode === 'quantity' ? 'quantity' : 'delta'
    const other = row.mode === 'quantity' ? 'delta' : 'quantity'
    if (item[other] !== original[other]) {
      throw new ApprovalEditError(`accepted row ${index} changed which kind of amount it carries`)
    }
    const sent = item[key]
    if (sent !== original[key]) {
      if (typeof sent !== 'number' || !Number.isInteger(sent)) {
        throw new ApprovalEditError(`accepted row ${index} carries a non-integer ${key}`)
      }
      const { min, max } = stepBounds(row)
      if (sent < min || sent > max) {
        throw new ApprovalEditError(
          `accepted row ${index} set ${key} to ${sent}, outside ${min}…${max} for this row`,
        )
      }
    }
  }
}

// ── The corrected batch ──────────────────────────────────────────────────────

/**
 * The accepted rows as resolved operations `POST /collection/batch` understands.
 *
 * `mode` comes from the PREVIEW, which came from the real planner. The VALUE is
 * `effectiveValue` — his number unless the reader stepped it — which is the same
 * function the delta chip, the projected count and the button's verb all read,
 * so the number that goes on the wire is the number that was on the screen.
 * The client still never re-derives a quantity of its own from anything else.
 */
export function resolveBatchItems(preview: ApprovalPreview, choices: Choices): BatchItem[] {
  const out: BatchItem[] = []
  for (const row of preview.rows) {
    const choice = choiceFor(choices, row.index)
    if (!rowIsIncluded(row, choice)) continue
    const variantId = asksSelection(row) ? choice.variantId : row.variantId
    if (variantId === null) continue
    const value = effectiveValue(row, choice)
    out.push(row.mode === 'quantity' ? { variantId, quantity: value } : { variantId, delta: value })
  }
  return out
}

/** The batch's content, canonically — order-independent, mode-distinguishing. */
export function batchContent(items: readonly BatchItem[]): string {
  return items
    .map((i) => `${i.variantId}:${i.quantity !== undefined ? `set:${i.quantity}` : `delta:${i.delta}`}`)
    .sort()
    .join('|')
}

/**
 * FNV-1a, 64 bits, as two 32-bit lanes.
 *
 * NOT CRYPTOGRAPHIC, AND IT DOES NOT NEED TO BE. The `toolCallId` scope below
 * does the isolating; this only has to separate two different corrected batches
 * made against the SAME held call, which the UI does not even offer. A
 * `crypto.subtle` digest would be strictly stronger and asynchronous, and
 * pushing an `await` into key derivation to harden a scoping suffix is a bad
 * trade for a function that must be callable from a click handler.
 */
function fnv1a64(text: string): string {
  let h1 = 0x811c9dc5
  let h2 = 0xc9dc5811
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0
    h2 = Math.imul(h2 ^ ((c << 8) | (c >>> 8)), 0x01000193) >>> 0
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')
}

/**
 * ══════════════════════════════════════════════════════════════════════════════
 * THE IDEMPOTENCY KEY — SCOPED TO THE HELD CALL, NOT TO ITS CONTENT
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * THIS IS THE LINE THAT WOULD HAVE CAUSED A PRODUCTION WRITE BUG, and it is
 * worth the paragraph because the bug is invisible on first use and permanent
 * afterwards.
 *
 * The design borrowed `ripCommit.ts:82`'s key, which is PURE CONTENT
 * (`rip-<variantId>x<delta>,…`). But a caller-supplied key is honoured
 * UNBUCKETED AND UNBOUNDED: `apps/api/src/mutations.ts:121-122` says so in
 * those words, and `collection.ts:367` confirms it — only the SERVER-derived
 * fingerprint gets the 15-minute bucketing; a caller key is looked up bare
 * against every batch this user has ever committed.
 *
 * So with a content-only key: the reader adds one Pikachu, corrects it to the
 * reverse holo, Accepts. Next week they do exactly the same thing. The second
 * POST collides, `/collection/batch` returns the ORIGINAL response with
 * `replayed: true`, NOTHING IS WRITTEN, and a reason built "from the real
 * response" recites last week's before/after numbers as fresh — which the
 * transcript record then repeats on every subsequent turn. The failure this
 * whole design exists to prevent, manufactured by one borrowed line.
 *
 * The repo had already learned this, in the other file the design quotes:
 * `logging.ts`'s `chunkKey` carries a comment saying that without its time
 * bucket, "'+1 Pikachu' logged today would make the identical call next month a
 * silent no-op that still reported the old quantities as current."
 *
 * SCOPING TO `toolCallId` does the work the bucket does there, and does it
 * better:
 *   • a double-tap or a retry of THIS Accept collides — same call, same
 *     content, so `replayed: true` is the truth;
 *   • two different approvals with identical content never collide, so the
 *     second real correction applies;
 *   • no time window to be on the wrong side of.
 *
 * The content digest stays as the second half so that if the card ever does
 * offer a second, different Accept against one held call, that is a new key
 * rather than a silent replay of the first.
 *
 * `slice(200)` because the server REJECTS anything longer rather than
 * truncating it — deliberately, since two keys sharing a 200-char prefix would
 * collide and the loser would be told its write was a replay. `toolCallId` is
 * short in practice; this slice is belt.
 */
export function correctionIdempotencyKey(toolCallId: string, items: readonly BatchItem[]): string {
  return `decke-approval-${toolCallId}#${fnv1a64(batchContent(items))}`.slice(0, 200)
}

// ── The commit, and its three outcomes ───────────────────────────────────────

/** `POST /collection/batch`'s response, as much of it as this file reads. */
export type BatchResponse = {
  batchId: string
  replayed: boolean
  applied: number
  unchanged: number
  items: { variantId: number; cardId: string; before: number; after: number; clamped: boolean }[]
}

/**
 * What the transport observed — which is NOT the same question as whether the
 * write happened.
 *
 * A `fetch` that throws on timeout or a dropped socket is evidence the RESPONSE
 * was lost, never evidence the write failed. `/collection/batch` commits before
 * it responds. This codebase has met the case twice already — `logging.ts`'s
 * `landedAfterTimeout` ("timed out waiting for a reply, but the mutation log
 * confirms the write COMMITTED") and `ripCommit.ts`'s "a request that
 * half-succeeded and was retried".
 */
export type CommitTransport =
  | { received: true; ok: true; body: BatchResponse }
  | { received: true; ok: false; error: string }
  | { received: false; error: string }

export type CorrectionRequest = {
  items: BatchItem[]
  source: string
  note: string
  idempotencyKey: string
}

/**
 * THREE OUTCOMES, NEVER TWO.
 *
 * `failed` is a claim — "nothing was written" — and a claim may only be made
 * about something observed. `unconfirmed` is what an unobserved outcome is
 * called, and it exists so that the one branch on which this machinery could
 * make a confident false statement in the UNWRITTEN direction does not exist.
 */
export type CommitOutcome =
  | { kind: 'applied'; body: BatchResponse; replayed: boolean }
  | { kind: 'nothing'; why: 'all-removed' | 'none-picked' | 'nothing-included' }
  | { kind: 'failed'; error: string }
  | { kind: 'unconfirmed'; error: string }

/**
 * A thrown error, classified conservatively.
 *
 * DEFAULTS TO `received: false`, which is the direction that never asserts an
 * unobserved negative. A caller whose transport can prove a response arrived —
 * by attaching the HTTP `status` to the error it throws — gets the sharper
 * answer; `apps/web/src/lib/api.ts`'s `send` does not do that today, so a real
 * HTTP 400 currently reads as unconfirmed. That is a worse message and a
 * correct one, and the retry below usually resolves it anyway.
 */
export function transportFromThrown(err: unknown): CommitTransport {
  const status = (err as { status?: unknown } | null)?.status
  const message = err instanceof Error ? err.message : String(err)
  if (typeof status === 'number' && status > 0) return { received: true, ok: false, error: message }
  return { received: false, error: message }
}

/**
 * Run the corrected batch, retrying ONCE if the response was lost.
 *
 * The retry is safe only because the key is scoped to the held call: a retry
 * either applies (the first attempt never reached COMMIT) or comes back
 * `replayed: true` carrying the real numbers (it did). Both are the truth. With
 * the content-only key this would have been a retry into a week-old response.
 *
 * A retry that ALSO gets no response leaves `unconfirmed`, and the reason
 * string then says so rather than asserting a negative nobody watched.
 */
export async function commitCorrection(
  request: CorrectionRequest,
  commit: (r: CorrectionRequest) => Promise<CommitTransport>,
): Promise<CommitOutcome> {
  const first = await commit(request)
  if (first.received && first.ok) return { kind: 'applied', body: first.body, replayed: first.body.replayed }
  if (first.received) return { kind: 'failed', error: first.error }

  const second = await commit(request)
  if (second.received && second.ok) {
    return { kind: 'applied', body: second.body, replayed: second.body.replayed }
  }
  if (second.received) {
    // The retry got a real answer and it was an error. That is NOT proof the
    // first attempt failed — the first one's response was lost — so this stays
    // unconfirmed rather than becoming "nothing was written".
    return { kind: 'unconfirmed', error: second.error }
  }
  return { kind: 'unconfirmed', error: first.error }
}

// ── What the model is told ───────────────────────────────────────────────────

/** How many rows a reason may enumerate before it starts costing every turn. */
export const REASON_ROW_CAP = 8

function enumerate(body: BatchResponse): string {
  const shown = body.items.slice(0, REASON_ROW_CAP)
  const lines = shown.map((i) => `${i.cardId} ${i.before} → ${i.after}`)
  const more = body.items.length - shown.length
  if (more > 0) lines.push(`and ${more} more — batch ${body.batchId} has the full list`)
  return lines.join('; ')
}

export type CorrectionCounts = {
  /** Rows the reader struck out. */
  removed: number
  /** Section-2 rows left unpicked, which is a different fact from struck out. */
  unpicked: number
}

/**
 * The one sentence the model is told, built from the REAL response.
 *
 * It becomes a `tool-result {type:'execution-denied', reason}` in his context
 * (`ai/dist/index.js:10970-10981`). Short, factual, and giving him nothing to
 * embellish — including, in the failure cases, an explicit instruction about
 * what he may NOT say.
 */
export function correctionReason(outcome: CommitOutcome, counts: CorrectionCounts): string {
  const dropped: string[] = []
  if (counts.removed > 0) dropped.push(`${counts.removed} row(s) they removed`)
  if (counts.unpicked > 0) dropped.push(`${counts.unpicked} row(s) whose printing they did not pick`)
  const droppedText = dropped.length ? ` Not applied: ${dropped.join(' and ')}.` : ''

  switch (outcome.kind) {
    case 'applied':
      // THE `replayed` GUARD. The server matched this to a batch it had already
      // committed and wrote nothing new. Reciting its numbers as fresh is
      // exactly the dishonesty the scoped key was introduced to prevent, so say
      // what happened instead.
      if (outcome.replayed) {
        return (
          'The reader corrected this before it ran, so THIS call did NOT execute. Their corrected ' +
          `version was sent, and the server matched it to an identical batch it had ALREADY applied ` +
          `(batch ${outcome.body.batchId}) — so nothing new was written this time. The quantities on ` +
          `record are: ${enumerate(outcome.body)}. Say that it was already applied; do NOT report it ` +
          `as a fresh change.${droppedText} Do not call log_cards for this again.`
        )
      }
      return (
        'The reader corrected this before it ran, so THIS call did NOT execute. They applied their own ' +
        `corrected version and it has already landed: batch ${outcome.body.batchId}, ` +
        `${outcome.body.applied} applied — ${enumerate(outcome.body)}.${droppedText} Report these ` +
        `numbers. Do not call log_cards for this again; offer revert(batch_id: "${outcome.body.batchId}") ` +
        'if they want it back.'
      )
    case 'nothing':
      return outcome.why === 'all-removed'
        ? 'The reader removed every row before this ran. Nothing was written and nothing was attempted.'
        : outcome.why === 'none-picked'
          ? 'The reader did not pick a printing for any row, so nothing was written and nothing was ' +
            'attempted. Ask which printing they meant if it matters; do not assume one.'
          : 'The reader left nothing to apply. Nothing was written and nothing was attempted.'
    case 'failed':
      return (
        'The reader corrected this before it ran, so THIS call did NOT execute. Their corrected version ' +
        `was attempted and FAILED (${outcome.error}). NOTHING was written. Say so.`
      )
    case 'unconfirmed':
      // NEVER "nothing was written". The response was lost; the write may well
      // have committed. An unobserved negative is not a fact.
      return (
        'The reader corrected this before it ran, so THIS call did NOT execute. Their corrected version ' +
        `was sent and I could NOT confirm whether it landed (${outcome.error}). Do NOT say it was ` +
        'written and do NOT say nothing was written — say you could not confirm it, and offer to check ' +
        'their collection.'
      )
  }
}

// ── The whole of Accept, in order ────────────────────────────────────────────

export type AcceptDeps = {
  /** Sends the corrected batch. Injected, so ordering can be observed in a test. */
  commit: (r: CorrectionRequest) => Promise<CommitTransport>
  /** Answers the held approval. MUST be called after `commit`, never before. */
  settle: (verdict: Verdict) => void
  /**
   * Writes the real result onto the transcript as a tool record.
   *
   * Independent of the leg, and that is the point: a lost settle leg would take
   * the `execution-denied` with it, and this survives because `messagesToWire`
   * rebuilds history from text and records.
   */
  record?: (text: string) => void
}

export type AcceptResult =
  | { path: 'A' }
  | { path: 'B'; outcome: CommitOutcome; reason: string; request: CorrectionRequest | null }

export const CORRECTION_SOURCE = 'deckpal-web'
export const CORRECTION_NOTE = 'Deck-E — corrected before applying'

/**
 * Press Accept.
 *
 * ONE BRANCH, TAKEN ONCE, BEFORE EITHER SIDE EFFECT. That is what makes the
 * double-write unrepresentable rather than merely unlikely: Path A never issues
 * a client batch, and Path B settles `approved: false`, after which the SDK
 * does not execute the held call — enforced by `collectToolApprovals`, not by
 * our care.
 *
 * Everything that could be wrong is checked BEFORE anything is sent: the router
 * and the canonical comparison must agree, and the batch must be a legal
 * narrowing. Both throw, and a throw here means nothing was written and nothing
 * was settled, which is the recoverable state (the reader can press Accept
 * again, or Leave it).
 */
export async function runAccept(
  args: {
    toolCallId: string
    held: readonly HeldItem[]
    preview: ApprovalPreview
    choices: Choices
  },
  deps: AcceptDeps,
): Promise<AcceptResult> {
  const { toolCallId, held, preview, choices } = args

  assertRouteAgrees(held, preview, choices)

  if (!isEdited(preview, choices)) {
    // PATH A. Today's path, unchanged, down to the byte: `approvalReplayPart`
    // replays the original input and the original signature, and `log_cards`
    // executes on the server with everything it already does — batch id,
    // progress recompute, the revert line, the duplicate warning.
    deps.settle({ approved: true })
    return { path: 'A' }
  }

  // PATH B.
  const accepted = acceptedItems(held, preview, choices)
  assertNarrowing(held, preview, accepted)

  const counts: CorrectionCounts = {
    removed: preview.rows.filter((r) => choiceFor(choices, r.index).removed).length,
    unpicked: preview.rows.filter(
      (r) => asksSelection(r) && !choiceFor(choices, r.index).removed && choiceFor(choices, r.index).variantId === null,
    ).length,
  }

  const items = resolveBatchItems(preview, choices)
  if (items.length === 0) {
    // NO HTTP CALL IS MADE, and the two ways to get here are different facts
    // that deserve different sentences: struck out is a decision, unpicked is a
    // question left open.
    const why = counts.removed > 0 && counts.unpicked === 0 ? 'all-removed' : counts.unpicked > 0 ? 'none-picked' : 'nothing-included'
    const outcome: CommitOutcome = { kind: 'nothing', why }
    const reason = correctionReason(outcome, counts)
    deps.settle({ approved: false, reason })
    return { path: 'B', outcome, reason, request: null }
  }

  const request: CorrectionRequest = {
    items,
    source: CORRECTION_SOURCE,
    note: CORRECTION_NOTE,
    idempotencyKey: correctionIdempotencyKey(toolCallId, items),
  }

  // ── COMMIT FIRST ───────────────────────────────────────────────────────────
  const outcome = await commitCorrection(request, deps.commit)
  const reason = correctionReason(outcome, counts)
  if (outcome.kind === 'applied') deps.record?.(reason)
  // ── SETTLE SECOND ──────────────────────────────────────────────────────────
  deps.settle({ approved: false, reason })

  return { path: 'B', outcome, reason, request }
}
