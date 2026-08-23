/**
 * The approval card's WORDS — the four pure functions that compose what a
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
 * These are not decoration: `approvalQuestion` is the sentence being consented
 * to, `unshownCallsNote` is a COUNT of writes that will not happen, and
 * `operationText`/`beforeAfterText` render the quantities themselves — X2
 * applies to all four, and X2 without a test is an intention.
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
  approvalQuestion,
  beforeAfterText,
  operationText,
  rowMetaText,
  unshownCallsNote,
} from '../chat/approvalCardState'

// ── approvalQuestion ─────────────────────────────────────────────────────────

/**
 * THE BUG, PINNED.
 *
 * MUTATION: drop the `.replace(/^let\s+h(?:im|er|them)\s+/i, '')` from
 * `approvalQuestion` and this returns "Let him let him add a card?" — red.
 */
test('approvalQuestion does not say "Let him" twice', () => {
  assert.equal(approvalQuestion('Let him add a card?'), 'Let him add a card?')
  assert.equal(approvalQuestion('let him add 3 cards'), 'Let him add 3 cards?')
})

/**
 * THE OTHER HALF OF THE SAME BUG — the doubled "??".
 *
 * MUTATION: drop `stripTerminal`'s regex (return `s.trim()`) and the first
 * assertion returns "Let him add a card??" — red.
 */
test('approvalQuestion ends in exactly one question mark', () => {
  assert.equal(approvalQuestion('Add a card?'), 'Let him add a card?')
  assert.equal(approvalQuestion('Add a card.'), 'Let him add a card?')
  assert.equal(approvalQuestion('Add a card!'), 'Let him add a card?')
  assert.equal(approvalQuestion('Add a card…'), 'Let him add a card?')
  // Repeated, because "card??" is what the screenshot actually showed.
  assert.equal(approvalQuestion('Add a card??'), 'Let him add a card?')
})

/**
 * The real titles. `useDeckeChat`'s `titleFor` de-snake-cases the tool name and
 * sentence-cases it, so what actually arrives here is "Log cards", "Set cart",
 * "Save deck" — verb phrases with one leading capital.
 *
 * MUTATION: change `softLowerFirst` to return `s` unchanged and both assertions
 * return "Let him Log cards?" / "Let him Set progress?" — red.
 */
test('approvalQuestion lowers the first letter of an ordinary title', () => {
  assert.equal(approvalQuestion('Log cards'), 'Let him log cards?')
  assert.equal(approvalQuestion('Set progress'), 'Let him set progress?')
  assert.equal(approvalQuestion('Make that change'), 'Let him make that change?')
})

/**
 * A NAME IS NOT A SENTENCE. The version this replaces called `.toLowerCase()`
 * on the whole title, so a card name in it came out ruined.
 *
 * MUTATION: replace `softLowerFirst(body)` with `body.toLowerCase()` and both
 * assertions go red — "let him add charizard ex to your collection?" and
 * "let him import from tcgplayer?".
 */
test('approvalQuestion never lowercases past the first letter', () => {
  assert.equal(
    approvalQuestion('Add Charizard ex to your collection'),
    'Let him add Charizard ex to your collection?',
  )
  assert.equal(approvalQuestion('Import from TCGplayer'), 'Let him import from TCGplayer?')
})

/**
 * MUTATION: delete the `tail !== tail.toLowerCase()` guard in `softLowerFirst`
 * and this returns "Let him tCGplayer import?" — red.
 */
test('approvalQuestion leaves an acronym or a brand alone', () => {
  assert.equal(approvalQuestion('TCGplayer import'), 'Let him TCGplayer import?')
  assert.equal(approvalQuestion('eBay sync'), 'Let him eBay sync?')
})

/**
 * A title is a server-supplied string and can be empty. A dialog headed
 * "Let him ?" is worse than a generic one.
 *
 * MUTATION: delete the `if (!trimmed)` early return and this returns "Let him ?"
 * — red.
 */
test('approvalQuestion falls back when the title is empty', () => {
  assert.equal(approvalQuestion(''), 'Let him make that change?')
  assert.equal(approvalQuestion('   '), 'Let him make that change?')
  assert.equal(approvalQuestion('???'), 'Let him make that change?')
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
  assert.match(unshownCallsNote(2), /^He also asked for one other change\./)
  assert.match(unshownCallsNote(4), /^He also asked for 3 other changes\./)
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
