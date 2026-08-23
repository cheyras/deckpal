/**
 * The approval card's WORDS AND NUMBERS — the pure functions that compose what a
 * person reads immediately before authorising a write to their collection.
 *
 * ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────
 *
 * Every one of these was inline JSX until the gallery page was photographed and
 * the headline read, verbatim:
 *
 *     Let him let him add a card??
 *
 * The template was `` `Let him ${title.toLowerCase()}?` `` and it had been in the
 * product, unlooked-at, for the whole of the pass that shipped it. Nothing could
 * have caught it: a string built in a JSX expression is not importable, so there
 * was no seam a test could get at, and the only remaining check was somebody
 * opening the page — which is exactly the check that had not happened.
 *
 * So the strings moved into `approvalCardState.ts` and this file drives them.
 * These are not decoration: `approvalHeadline` is the sentence being consented
 * to, `unshownCallsNote` is a COUNT of writes that will not happen, `rowStatus`
 * is the per-row promise about whether a card will be touched at all, and
 * `operationText`/`beforeAfterText`/`projectedAfter` render the quantities
 * themselves — X2 applies to all of them, and X2 without a test is an intention.
 *
 * ── THE SECOND PASS ──────────────────────────────────────────────────────────
 *
 * Two things arrived together and both are pinned here. The VOICE went from
 * third person to his own — *"this is all third person, this should be him
 * talking like he's presenting it to us"* — and a STEPPER appeared, which means
 * the amount on screen is no longer necessarily the amount the dry run computed.
 * Every number this card draws is now derived from one function
 * (`effectiveValue`) so that the chip, the projected count, the button's verb and
 * the wire cannot disagree; these tests are what stops them being re-derived
 * separately later.
 *
 * ── EVERY TEST HERE WAS WATCHED FAIL ─────────────────────────────────────────
 *
 * The mutation is recorded above each one. A test nobody has seen go red is a
 * test nobody has checked, and this project has already shipped two that turned
 * out to assert nothing at all.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  acceptSummary,
  approvalHeadline,
  approvalQuestion,
  askingSectionHeading,
  beforeAfterText,
  clampStep,
  effectiveValue,
  knownSectionHeading,
  operationText,
  projectedAfter,
  rowMetaText,
  rowPrintings,
  rowStatus,
  skippedNote,
  stepBounds,
  stepBy,
  unshownCallsNote,
  whyThisPrinting,
  type ApprovalPreview,
  type PreviewRow,
  type RowChoice,
} from '../chat/approvalCardState'

// ── Fixtures ─────────────────────────────────────────────────────────────────

const NORMAL = { variantId: 11, kindCode: 'normal', label: 'Normal', isPrimary: true, ownedQty: 0 }
const REVERSE = { variantId: 12, kindCode: 'reverse', label: 'Reverse holo', isPrimary: false, ownedQty: 1 }

const row = (over: Partial<PreviewRow> = {}): PreviewRow => ({
  index: 0,
  cardId: 'me05-84',
  cardName: 'Pitch Black',
  setId: 'me05',
  number: '84',
  certainty: 'stated',
  candidates: [],
  wouldUseVariantId: null,
  variantId: 11,
  variantLabel: 'Normal',
  mode: 'delta',
  value: 1,
  before: 0,
  after: 1,
  clamped: false,
  ...over,
})

const preview = (rows: PreviewRow[], editable = true): ApprovalPreview => ({
  toolCallId: 'c1',
  tool: 'log_cards',
  title: 'Log cards',
  summary: '',
  ok: true,
  editable,
  rows,
  skipped: [],
})

const choice = (over: Partial<RowChoice> = {}): RowChoice => ({
  removed: false,
  variantId: null,
  value: null,
  ...over,
})

const choices = (...pairs: [number, RowChoice][]) => new Map(pairs)

// ── approvalQuestion ─────────────────────────────────────────────────────────
//
// HE ASKS IN THE FIRST PERSON NOW. "Let him ___?" became "Can I ___?"; the three
// malformation bugs the old version was written against are unchanged and still
// pinned below, because the inputs that caused them have not changed.

/**
 * THE BUG, PINNED.
 *
 * MUTATION: drop the leading-request strip from `approvalQuestion` and this
 * returns "Can I can i add a card?" and "Can I let him add a card?" — red.
 *
 * The strip covers the third-person lead-ins as well as the first-person ones on
 * purpose: a title written before this change is still a title that can arrive
 * off the wire, and "Can I let him add a card?" is a worse sentence than the one
 * this whole function exists to prevent.
 */
test('approvalQuestion does not double up its own lead-in', () => {
  assert.equal(approvalQuestion('Can I add a card?'), 'Can I add a card?')
  assert.equal(approvalQuestion('can i add 3 cards'), 'Can I add 3 cards?')
  assert.equal(approvalQuestion('Let him add a card?'), 'Can I add a card?')
  assert.equal(approvalQuestion("I'd like to add a card"), 'Can I add a card?')
})

/**
 * THE OTHER HALF OF THE SAME BUG — the doubled "??".
 *
 * MUTATION: drop `stripTerminal`'s regex (return `s.trim()`) and the first
 * assertion returns "Can I add a card??" — red.
 */
test('approvalQuestion ends in exactly one question mark', () => {
  assert.equal(approvalQuestion('Add a card?'), 'Can I add a card?')
  assert.equal(approvalQuestion('Add a card.'), 'Can I add a card?')
  assert.equal(approvalQuestion('Add a card!'), 'Can I add a card?')
  assert.equal(approvalQuestion('Add a card…'), 'Can I add a card?')
  // Repeated, because "card??" is what the screenshot actually showed.
  assert.equal(approvalQuestion('Add a card??'), 'Can I add a card?')
})

/**
 * The real titles. `useDeckeChat`'s `titleFor` de-snake-cases the tool name and
 * sentence-cases it, so what actually arrives here is "Log cards", "Set cart",
 * "Save deck" — verb phrases with one leading capital.
 *
 * MUTATION: change `softLowerFirst` to return `s` unchanged and both assertions
 * return "Can I Log cards?" / "Can I Set progress?" — red.
 */
test('approvalQuestion lowers the first letter of an ordinary title', () => {
  assert.equal(approvalQuestion('Log cards'), 'Can I log cards?')
  assert.equal(approvalQuestion('Set progress'), 'Can I set progress?')
  assert.equal(approvalQuestion('Make that change'), 'Can I make that change?')
})

/**
 * A NAME IS NOT A SENTENCE. The version this replaces called `.toLowerCase()`
 * on the whole title, so a card name in it came out ruined.
 *
 * MUTATION: replace `softLowerFirst(body)` with `body.toLowerCase()` and both
 * assertions go red — "Can I add charizard ex to your collection?" and
 * "Can I import from tcgplayer?".
 */
test('approvalQuestion never lowercases past the first letter', () => {
  assert.equal(
    approvalQuestion('Add Charizard ex to your collection'),
    'Can I add Charizard ex to your collection?',
  )
  assert.equal(approvalQuestion('Import from TCGplayer'), 'Can I import from TCGplayer?')
})

/**
 * MUTATION: delete the `tail !== tail.toLowerCase()` guard in `softLowerFirst`
 * and this returns "Can I tCGplayer import?" — red.
 */
test('approvalQuestion leaves an acronym or a brand alone', () => {
  assert.equal(approvalQuestion('TCGplayer import'), 'Can I TCGplayer import?')
  assert.equal(approvalQuestion('eBay sync'), 'Can I eBay sync?')
})

/**
 * A title is a server-supplied string and can be empty. A dialog headed
 * "Can I ?" is worse than a generic one.
 *
 * MUTATION: delete the `if (!trimmed)` early return and this returns "Can I ?"
 * — red.
 */
test('approvalQuestion falls back when the title is empty', () => {
  assert.equal(approvalQuestion(''), 'Can I make that change?')
  assert.equal(approvalQuestion('   '), 'Can I make that change?')
  assert.equal(approvalQuestion('???'), 'Can I make that change?')
})

// ── approvalHeadline ─────────────────────────────────────────────────────────

/**
 * MUTATION: change "Here's what I want to add." to "Here's what he wants to
 * add." and this goes red — which is the entire point of the change, and the one
 * thing a later edit could undo without anybody noticing on a screenshot.
 */
test('approvalHeadline is spoken by him, in the first person', () => {
  const h = approvalHeadline('Log cards', preview([row(), row({ index: 1 })]))
  assert.match(h, /\bI\b/, 'he is the one asking, and the sentence has to say so')
  assert.doesNotMatch(h, /\b(he|him|his)\b/i, 'nothing on this card describes him from outside')
})

/**
 * MUTATION: delete the `deltas.every((r) => r.value < 0)` arm and a removal batch
 * is headed "Here's the set of changes I want to make." — passable prose, and it
 * drops the one word that says cards are LEAVING.
 */
test('approvalHeadline names the direction of the batch', () => {
  assert.equal(
    approvalHeadline('Log cards', preview([row(), row({ index: 1 })])),
    "Here's what I want to add.",
  )
  assert.equal(approvalHeadline('Log cards', preview([row()])), "Here's the card I want to add.")
  assert.equal(
    approvalHeadline('Log cards', preview([row({ value: -1, before: 3, after: 2 })])),
    "Here's the card I want to take off your collection.",
  )
})

/**
 * A MIXED BATCH GETS THE NEUTRAL SENTENCE.
 *
 * MUTATION: relax either `every` to `some` and a batch that adds two cards and
 * removes one is headed "Here's what I want to add." — the one sentence on this
 * card that could get somebody to press through a removal they did not read.
 */
test('approvalHeadline refuses to name a direction a mixed batch does not have', () => {
  const mixed = preview([row(), row({ index: 1, value: -2, before: 4, after: 2 })])
  assert.equal(approvalHeadline('Log cards', mixed), "Here's the set of changes I want to make.")
})

/**
 * MUTATION: drop the `rows.length === 0` early return and a deck save is headed
 * "Here's the set of changes I want to make." — a sentence about rows, on a card
 * that has none.
 */
test('approvalHeadline falls back to the tool phrase when there are no rows', () => {
  assert.equal(approvalHeadline('Save this deck', null), 'Can I save this deck?')
  assert.equal(approvalHeadline('Save this deck', preview([], false)), 'Can I save this deck?')
  // A preview carrying rows but NOT editable renders the plain dialog, so its
  // headline must be the plain one too.
  assert.equal(
    approvalHeadline('Save this deck', preview([row()], false)),
    'Can I save this deck?',
  )
})

// ── The section headings ─────────────────────────────────────────────────────

/**
 * MUTATION: put "He knows these printings" back and this goes red. It is the
 * same one-word change that made the whole card read as a stage direction, and
 * it is exactly the kind of edit that gets made back for grammatical tidiness.
 */
test('both section headings are him speaking, not a narrator describing him', () => {
  for (const s of [knownSectionHeading(1), knownSectionHeading(3), askingSectionHeading(1), askingSectionHeading(2)]) {
    assert.doesNotMatch(s, /\b(he|him|his)\b/i, `"${s}" describes him from outside`)
    assert.match(s, /\bI\b|\bI'm\b|\bI've\b/i, `"${s}" does not sound like him saying it`)
  }
  assert.notEqual(knownSectionHeading(1), knownSectionHeading(3))
  assert.notEqual(askingSectionHeading(1), askingSectionHeading(2))
})

/**
 * THE ASKING SECTION IS NO LONGER "I HAVE NO IDEA".
 *
 * `reopenIfProxyStated` demotes a `stated` row back to a question whenever the
 * READER named no printing — so most rows under this heading are rows he DID
 * have an answer for, offered as a proposal, alongside `ambiguous` rows where he
 * genuinely had none. One sentence has to be true of both.
 *
 * MUTATION: restore "I couldn't tell which printing this was" and this goes red.
 * It is a claim of ignorance printed above a chip carrying his own confident
 * guess, which is the card contradicting itself in two adjacent elements.
 */
test('the asking heading is about certainty, not about ignorance', () => {
  for (const s of [askingSectionHeading(1), askingSectionHeading(2)]) {
    assert.doesNotMatch(s, /couldn't tell|no idea|don't know/i, `"${s}" claims an ignorance he does not have`)
    assert.match(s, /certain|confirm/i, `"${s}" has to work for a guess AND for a genuine unknown`)
  }
})

/**
 * MUTATION: return the singular string unconditionally from `skippedNote` and
 * the second assertion is red; drop the `count <= 0` guard and the third is.
 */
test('skippedNote counts what he could not match, and says nothing when there is nothing', () => {
  assert.match(skippedNote(1), /^I couldn't match one more item/)
  assert.match(skippedNote(4), /^I couldn't match 4 more items/)
  assert.equal(skippedNote(0), '')
  assert.equal(skippedNote(-2), '')
})

// ── unshownCallsNote ─────────────────────────────────────────────────────────

/**
 * THE THIRD DEFECT FROM THE SAME SCREENSHOT: the card said "he also asked for
 * 2 other changes" while rendering all three rows it was counting.
 *
 * The number counts HELD CALLS, of which the card shows one. One call is
 * nothing withheld, however many cards are inside it.
 *
 * MUTATION: change `Math.floor(heldCalls) - 1` to `heldCalls` and the first two
 * assertions go red.
 */
test('unshownCallsNote says nothing when only one call is held', () => {
  assert.equal(unshownCallsNote(1), '')
  assert.equal(unshownCallsNote(0), '')
  assert.equal(unshownCallsNote(-3), '')
})

/**
 * MUTATION: swap the singular and plural branches and both assertions go red.
 */
test('unshownCallsNote counts only the calls it is not showing', () => {
  assert.match(unshownCallsNote(2), /^I asked for one other change too\./)
  assert.match(unshownCallsNote(4), /^I asked for 3 other changes too\./)
})

/**
 * MUTATION: drop "so it will not run" from the singular string and this is red.
 * The sentence's whole job is to say the held call was DROPPED, not queued.
 */
test('unshownCallsNote promises the unshown calls will not run', () => {
  assert.match(unshownCallsNote(2), /will not run/)
  assert.match(unshownCallsNote(5), /will not run/)
})

// ── operationText ────────────────────────────────────────────────────────────

/**
 * MUTATION: change `row.value > 0` to `row.value >= 0` — a zero delta then
 * renders "+0" instead of "−0"; both are odd, so the assertion below pins the
 * signs that matter. Change `+${row.value}` to `${row.value}` and the first
 * assertion is red.
 */
test('operationText signs a delta and spells out a quantity', () => {
  assert.equal(operationText({ mode: 'delta', value: 1 }), '+1')
  assert.equal(operationText({ mode: 'delta', value: 12 }), '+12')
  assert.equal(operationText({ mode: 'quantity', value: 5 }), 'Set to 5')
  assert.equal(operationText({ mode: 'quantity', value: 0 }), 'Set to 0')
})

/**
 * A REAL MINUS SIGN, U+2212 — not a hyphen. In a tabular column a hyphen is a
 * third of the plus's width and the numbers sit ragged under each other.
 *
 * MUTATION: replace `−` with `-` in `operationText` and this is red.
 */
test('operationText uses a minus sign, not a hyphen', () => {
  assert.equal(operationText({ mode: 'delta', value: -2 }), '−2')
  assert.notEqual(operationText({ mode: 'delta', value: -2 }), '-2')
})

// ── beforeAfterText ──────────────────────────────────────────────────────────

/**
 * `before` is legitimately `0` — the commonest case, a card you own none of.
 * A truthiness check here hides the arrow on exactly the row that most needs it.
 *
 * MUTATION: change the guard to `if (!row.before || !row.after)` and the first
 * assertion goes red.
 */
test('beforeAfterText renders a zero before-count', () => {
  assert.equal(beforeAfterText({ before: 0, after: 1 }), '0 → 1')
  assert.equal(beforeAfterText({ before: 1, after: 2 }), '1 → 2')
})

/**
 * MUTATION: return `` `${row.before} → ${row.after}` `` unconditionally and
 * this renders "null → null" — red.
 */
test('beforeAfterText says nothing when the dry run did not carry both ends', () => {
  assert.equal(beforeAfterText({ before: null, after: 1 }), '')
  assert.equal(beforeAfterText({ before: 0, after: null }), '')
  assert.equal(beforeAfterText({ before: null, after: null }), '')
})

// ── rowMetaText ──────────────────────────────────────────────────────────────

/**
 * MUTATION: drop the `#` and this is red; drop the `.filter(Boolean)` and the
 * promo case below renders " · #013 · Normal" with a leading separator.
 */
test('rowMetaText joins set, number and printing', () => {
  assert.equal(
    rowMetaText({ setId: 'me05', number: '013', variantLabel: 'Normal' }),
    'me05 · #013 · Normal',
  )
})

/**
 * Every field is optional in the catalogue, so every field is optional here.
 *
 * MUTATION: replace the filter with `.join(' · ')` over the raw array and each
 * of these grows a stray separator — red.
 */
test('rowMetaText drops the parts the catalogue does not have', () => {
  assert.equal(rowMetaText({ setId: null, number: '013', variantLabel: 'Normal' }), '#013 · Normal')
  assert.equal(rowMetaText({ setId: 'me05', number: null, variantLabel: 'Normal' }), 'me05 · Normal')
  // The section-2 row: nobody has named the printing yet, so there is no label.
  assert.equal(rowMetaText({ setId: 'sv01', number: '025', variantLabel: null }), 'sv01 · #025')
  assert.equal(rowMetaText({ setId: null, number: null, variantLabel: null }), '')
})

// ── The stepper ──────────────────────────────────────────────────────────────

/**
 * THE ONE-SIDED BOUNDS ARE THE WHOLE SAFETY PROPERTY.
 *
 * MUTATION: change the delta arm of `stepBounds` to `{ min: -STEP_MAX, max:
 * STEP_MAX }` and the first two assertions go red. An add that can be stepped
 * down through zero into a removal would change the verb on the confirm button
 * under the reader's hand between reading it and pressing it.
 */
test('a stepper cannot turn an add into a removal, or the reverse', () => {
  assert.deepEqual(stepBounds({ mode: 'delta', value: 1 }), { min: 1, max: 99 })
  assert.deepEqual(stepBounds({ mode: 'delta', value: -2 }), { min: -99, max: -1 })
  // An absolute quantity is a different kind of statement and 0 is a real one.
  assert.deepEqual(stepBounds({ mode: 'quantity', value: 3 }), { min: 0, max: 99 })
})

/**
 * MUTATION: drop the `Math.trunc` from `clampStep` and the fractional case
 * returns 1.5 — a `delta` the server's zod schema rejects outright, from a
 * control that cannot produce one, which is exactly the sort of thing a stored
 * choice from a future version could smuggle in.
 */
test('clampStep forces a value inside this row own bounds, as an integer', () => {
  const add = { mode: 'delta' as const, value: 1 }
  assert.equal(clampStep(add, 0), 1)
  assert.equal(clampStep(add, -40), 1)
  assert.equal(clampStep(add, 400), 99)
  assert.equal(clampStep(add, 1.5), 1)
  assert.equal(clampStep(add, Number.NaN), 1, 'a NaN falls back to his own number, never to zero')
  assert.equal(clampStep({ mode: 'delta', value: -1 }, 3), -1)
  assert.equal(clampStep({ mode: 'quantity', value: 3 }, 0), 0)
})

/**
 * `null` IS NOT ZERO. A `quantity` row set to 0 is a real instruction, so the
 * "untouched" sentinel cannot be a number at all.
 *
 * MUTATION: change `effectiveValue`'s guard to `choice.value || row.value` and
 * the third assertion goes red — a reader who set a row to zero silently gets
 * his number back.
 */
test('effectiveValue tells an untouched row from one deliberately set to zero', () => {
  const q = row({ mode: 'quantity', value: 3, before: 3, after: 3 })
  assert.equal(effectiveValue(q, choice()), 3)
  assert.equal(effectiveValue(q, choice({ value: 5 })), 5)
  assert.equal(effectiveValue(q, choice({ value: 0 })), 0)
  // And a stored value outside the bounds is clamped on the way out, not trusted.
  assert.equal(effectiveValue(q, choice({ value: 9999 })), 99)
})

/**
 * "MORE" ON A REMOVAL ROW IS MORE NEGATIVE.
 *
 * MUTATION: delete the `sign` inversion in `stepBy` and the second pair goes red
 * — the button under the plus sign would then take FEWER cards away, which is
 * the inversion somebody presses twice before they notice.
 */
test('stepBy moves in the direction the reader means, not the direction of the number', () => {
  const add = row({ value: 1 })
  assert.equal(stepBy(add, choice(), 1), 2)
  assert.equal(stepBy(add, choice({ value: 2 }), -1), 1)
  assert.equal(stepBy(add, choice({ value: 1 }), -1), 1, 'and it stops at the floor')

  const take = row({ value: -1, before: 4, after: 3 })
  assert.equal(stepBy(take, choice(), 1), -2, 'plus takes MORE away')
  assert.equal(stepBy(take, choice({ value: -2 }), -1), -1, 'minus takes fewer away')
  assert.equal(stepBy(take, choice({ value: -1 }), -1), -1, 'and it stops at the floor')
})

/**
 * X2, ON THE ONE NUMBER THAT WOULD BE STALE.
 *
 * MUTATION: return `row.after` from `projectedAfter` and the second assertion
 * goes red. The dry run computed `after` for HIS amount; the moment a stepper
 * exists it is a fact about a batch that is not the batch being confirmed — and
 * it is stale in the direction that UNDER-states what is about to happen, since
 * the reader most often steps up.
 */
test('projectedAfter recomputes the landing count from the reader own amount', () => {
  const r = row({ before: 2, value: 1, after: 3 })
  assert.equal(projectedAfter(r, 1), 3)
  assert.equal(projectedAfter(r, 4), 6)
  // The server's own floor: `after = max(0, before + delta)`.
  assert.equal(projectedAfter(row({ before: 1, value: -1, after: 0 }), -5), 0)
  assert.equal(projectedAfter(row({ mode: 'quantity', value: 3, before: 9, after: 3 }), 7), 7)
})

/**
 * MUTATION: return `0` instead of `null` when `before` is missing and this goes
 * red. A projection needs a real starting count; without one there is no honest
 * number to draw, and "0 → 4" on a card whose owned quantity nobody knows is an
 * invented fact on a consent dialog.
 */
test('projectedAfter draws nothing when there is no real count to project from', () => {
  assert.equal(projectedAfter(row({ before: null, after: null }), 3), null)
})

// ── The per-row promise ──────────────────────────────────────────────────────

/**
 * THE LINE THAT MUST NOT VANISH.
 *
 * *"It shouldn't go away, it should turn into like 'this card will be added'."*
 *
 * MUTATION: return `{ ..., text: '' }` from the `ready` branch of `rowStatus` —
 * i.e. reinstate the old behaviour where the line only appeared while the row
 * was unanswered — and the first assertion goes red.
 */
test('every row says out loud whether it is going to happen, in every state', () => {
  const asking = row({ certainty: 'ambiguous', candidates: [NORMAL, REVERSE], variantId: null, variantLabel: null })
  const unanswered = rowStatus(asking, choice())
  const answered = rowStatus(asking, choice({ variantId: 12 }))
  const struck = rowStatus(asking, choice({ removed: true }))

  for (const s of [unanswered, answered, struck]) {
    assert.ok(s.text.length > 0, 'a state with no sentence is a state a reader has to infer')
  }
  assert.equal(unanswered.included, false)
  assert.equal(answered.included, true)
  assert.equal(struck.included, false)
  assert.match(answered.text, /I'll add one of these/)
  assert.match(struck.text, /Leaving this one out/)
})

/**
 * THE VERB FOLLOWS THE OPERATION, IN BOTH BRANCHES.
 *
 * MUTATION: hardcode `rowVerbPhrase` to `'add one of these'` and this goes red
 * on both assertions. An unnamed printing turns up on removals too, and a line
 * promising to ADD a card he is proposing to take away is a near-miss somebody
 * reads straight past — and it reads as reassurance, which is the worst
 * direction for it to be wrong in.
 */
test('neither line promises the wrong verb on a removal', () => {
  const takingAway = row({
    certainty: 'ambiguous',
    candidates: [NORMAL, REVERSE],
    variantId: null,
    variantLabel: null,
    value: -1,
    before: 3,
    after: 2,
  })
  assert.doesNotMatch(rowStatus(takingAway, choice()).text, /\badd\b/i)
  assert.match(rowStatus(takingAway, choice({ variantId: 12 })).text, /take one of these away/)
})

/**
 * ══════════════════════════════════════════════════════════════════════════════
 * HIS GUESS IS OFFERED, NEVER TAKEN.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Since `reopenIfProxyStated`, `wouldUseVariantId` on an ordinary add is the
 * printing DECK-E typed into the tool call — measured at 100 items out of 100.
 * So this line is where a guess is either presented as a guess or smuggled in as
 * a fact, and the row must stay OUT of the batch until somebody presses it.
 *
 * MUTATION: return `{ included: true, … }` from the needs-printing branch — i.e.
 * treat his pre-selection as an answer — and the second assertion goes red. That
 * mutation is the entire defect the server-side demotion exists to close,
 * reintroduced one level up.
 */
test('the proposed printing is named as a proposal and does not include the row', () => {
  const proposed = row({
    certainty: 'unstated',
    candidates: [NORMAL, REVERSE],
    wouldUseVariantId: 12,
    variantId: null,
    variantLabel: null,
  })
  const s = rowStatus(proposed, choice())
  assert.match(s.text, /^I think it's the reverse holo/, 'a guess has to sound like one')
  assert.equal(s.included, false, 'and it must not be counted as answered')
  assert.match(s.text, /confirm that and I'll add one of these/, 'and it must say what confirming does')
})

/**
 * MUTATION: change `rowStatus`'s ready branch to read `row.value` instead of
 * `effectiveValue(row, choice)` and this goes red. That is the exact defect
 * shape the second pass is guarding against everywhere: a sentence describing
 * his number while the control beside it shows the reader's.
 */
test('the per-row line tracks the stepper', () => {
  const r = row({ value: 1 })
  assert.match(rowStatus(r, choice()).text, /I'll add one of these/)
  assert.match(rowStatus(r, choice({ value: 4 })).text, /I'll add 4 of these/)
  const q = row({ mode: 'quantity', value: 3, before: 9, after: 3 })
  assert.match(rowStatus(q, choice({ value: 0 })).text, /I'll set this one to 0/)
})

/**
 * MUTATION: drop the `would` lookup and the first assertion goes red. The
 * default he WOULD have taken is a real fact from the dry run, and naming it is
 * what makes an unanswered question answerable without going and looking
 * something up.
 */
test('the unanswered line falls back cleanly when there is no proposal', () => {
  // `ambiguous` — `pickVariant` itself declined, so there is no `wouldUse`.
  const noDefault = row({
    certainty: 'ambiguous',
    candidates: [NORMAL, REVERSE],
    wouldUseVariantId: null,
    variantId: null,
    variantLabel: null,
  })
  assert.equal(rowStatus(noDefault, choice()).text, "Pick a printing and I'll add one of these.")
})

// ── The printing chips ───────────────────────────────────────────────────────

/**
 * THE OWNER RULING: chips on EVERY row.
 *
 * MUTATION: return `{ chips: [], selectable: false }` for the non-asking case —
 * the old behaviour, where a settled printing was plain grey text — and the
 * first assertion goes red.
 */
test('a row he is sure about still draws its printing as a chip', () => {
  const { chips, selectable } = rowPrintings(row({ variantLabel: 'Reverse holo', variantId: 12 }), choice())
  assert.equal(chips.length, 1)
  assert.equal(chips[0].label, 'Reverse holo')
  assert.equal(chips[0].selected, true, 'the one printing is the chosen one')
  assert.equal(chips[0].proposed, false, 'a settled printing is not a guess')
  assert.equal(selectable, false, 'there is nothing to switch it to, so it is not a control')
})

/**
 * `resolve.ts` now carries candidates on `stated` and `only-one` too, so the
 * settled chip's words come from the same catalogue list a picker would draw.
 *
 * MUTATION: delete the `row.candidates.find(...)` lookup and fall straight
 * through to `variantLabel`, and the first assertion goes red. Two renderings of
 * one printing, from two sources, is how "Reverse holo" and "Reverse Holo" end
 * up on the same card.
 */
test('the settled chip reads the catalogue list, and falls back to the label', () => {
  const stated = row({
    certainty: 'stated',
    candidates: [NORMAL, REVERSE],
    variantId: 12,
    variantLabel: 'rev holo (stale)',
  })
  assert.equal(rowPrintings(stated, choice()).chips[0].label, 'Reverse holo')
  assert.equal(rowPrintings(stated, choice()).chips[0].ownedQty, 1, 'and its real owned count')
  // A row that somehow arrives without the list still draws something true.
  const bare = row({ certainty: 'only-one', candidates: [], variantId: 12, variantLabel: 'Holo' })
  assert.equal(rowPrintings(bare, choice()).chips[0].label, 'Holo')
})

/**
 * ══════════════════════════════════════════════════════════════════════════════
 * THE PROPOSED CHIP IS NOT A SELECTED CHIP.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * MUTATION: set `selected: choice.variantId === c.variantId || c.variantId ===
 * row.wouldUseVariantId` — i.e. pre-select his guess, which is the obvious and
 * wrong reading of "pre-selection" — and the first assertion goes red. A chip
 * that renders as chosen while `rowIsIncluded` says the row is excluded is the
 * card disagreeing with the button, which is the whole complaint.
 *
 * MUTATION: drop the `undecided &&` guard and the last assertion goes red —
 * after answering, two chips in one group would carry emphasis.
 */
test('his guess is marked as a proposal, never as an answer', () => {
  const asking = row({
    certainty: 'unstated',
    candidates: [NORMAL, REVERSE],
    wouldUseVariantId: 12,
    variantId: null,
    variantLabel: null,
  })
  const open = rowPrintings(asking, choice())
  assert.deepEqual(
    open.chips.map((c) => [c.label, c.selected, c.proposed]),
    [
      ['Normal', false, false],
      ['Reverse holo', false, true],
    ],
  )
  // Once answered, the guess stops being marked at all.
  const answered = rowPrintings(asking, choice({ variantId: 11 }))
  assert.deepEqual(
    answered.chips.map((c) => [c.label, c.selected, c.proposed]),
    [
      ['Normal', true, false],
      ['Reverse holo', false, false],
    ],
  )
})

/**
 * MUTATION: drop the `row.candidates.length > 0` guard and an `ambiguous` row
 * that arrived with an empty candidate list renders an empty radiogroup — a
 * question with no answers on it. The wire can produce that: `candidatesOf`
 * skips any candidate with no numeric `variantId`.
 */
test('a question with no candidates falls back rather than drawing an empty picker', () => {
  const broken = row({ certainty: 'ambiguous', candidates: [], variantId: null, variantLabel: 'Normal' })
  assert.equal(rowPrintings(broken, choice()).selectable, false)
  const nothingAtAll = row({ certainty: 'ambiguous', candidates: [], variantId: null, variantLabel: null })
  assert.deepEqual(rowPrintings(nothingAtAll, choice()), { chips: [], selectable: false })
})

/**
 * MUTATION: return `'high confidence'` from `whyThisPrinting` for either arm and
 * this goes red. The card's header forbids turning `certainty` into a meter;
 * these two strings are PROVENANCE — where the printing came from — and the
 * distinction is the whole reason the card is segmented the way it is.
 */
test('the why-clause states provenance and never a confidence', () => {
  assert.equal(whyThisPrinting({ certainty: 'stated' }), 'you named it')
  assert.equal(whyThisPrinting({ certainty: 'only-one' }), "it's the only printing")
  assert.equal(whyThisPrinting({ certainty: 'ambiguous' }), '', 'the question above already said so')
  assert.equal(whyThisPrinting({ certainty: 'unstated' }), '')
  for (const c of ['stated', 'only-one'] as const) {
    assert.doesNotMatch(whyThisPrinting({ certainty: c }), /high|medium|low|confiden|%|sure/i)
  }
})

// ── The card's own arithmetic ────────────────────────────────────────────────

/**
 * THE DEFECT, IN ONE TEST.
 *
 * *"Down here it says add two cards and the first time I did this I was like, oh
 * well it's five cards."*
 *
 * MUTATION: return `''` from `acceptSummary` unconditionally and this goes red.
 * That is the state the product shipped in: a button with a count, a list with a
 * different count, and nothing joining the two.
 */
test('acceptSummary states the split when the rows and the button disagree', () => {
  const asking = row({
    index: 2,
    certainty: 'ambiguous',
    candidates: [NORMAL, REVERSE],
    variantId: null,
    variantLabel: null,
  })
  const p = preview([row(), row({ index: 1 }), asking])
  const s = acceptSummary(p, choices())
  assert.match(s, /^2 of these 3 will be added\./)
  assert.match(s, /one still needs a printing/i)
})

/**
 * MUTATION: swap `included === rows.length` for `included > 0` and a partly
 * answered card reports "All 3 of these will be added." — the worst possible
 * sentence on this surface.
 */
test('acceptSummary goes quiet only when there is genuinely nothing to reconcile', () => {
  assert.equal(acceptSummary(preview([row()]), choices()), '', 'one row that is going in needs no arithmetic')
  assert.equal(
    acceptSummary(preview([row(), row({ index: 1 })]), choices()),
    'All 2 of these will be added.',
  )
})

/**
 * MUTATION: hardcode the verb to `'be added'` and this goes red. "2 of these 3
 * will be added" over a list that takes cards away is the one wrong sentence on
 * this card that would be comfortable to read past.
 */
test('acceptSummary uses the verb the batch actually means', () => {
  const p = preview([
    row({ value: -1, before: 3, after: 2 }),
    row({ index: 1, value: -1, before: 2, after: 1 }),
  ])
  assert.match(acceptSummary(p, choices([0, choice({ removed: true })])), /will be removed/)
  const mixed = preview([row(), row({ index: 1, value: -1, before: 3, after: 2 })])
  assert.match(acceptSummary(mixed, choices([0, choice({ removed: true })])), /will go through/)
})

/**
 * MUTATION: drop the `removed` clause from the tail and a card where every row
 * has been struck out reports "None of these will be added." with no account of
 * WHY — which is the same "nothing telegraphs this" failure one level up.
 */
test('acceptSummary accounts for the rows the reader struck out', () => {
  const p = preview([row(), row({ index: 1 })])
  const s = acceptSummary(p, choices([0, choice({ removed: true })], [1, choice({ removed: true })]))
  assert.match(s, /^None of these will be added\./)
  assert.match(s, /2 you've left out/)
})
