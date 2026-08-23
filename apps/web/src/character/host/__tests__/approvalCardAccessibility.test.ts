/**
 * The approval card's accessibility contract, guarded against a redesign.
 *
 * ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────
 *
 * This card was redrawn from top to bottom during the experience pass — card
 * art added, rows restructured into two lines, the operation and the removal
 * moved into a shared wrappable line, the section headings rebuilt, the buttons
 * swapped for the app's `Button` primitive. Every one of those touched the same
 * JSX as a role or a label, and none of them had anything watching.
 *
 * That is the specific risk a visual pass carries on THIS surface: it is the
 * only place in the app where a model asks to change what somebody owns, it
 * announces itself as an `alertdialog`, and the two things a screen-reader user
 * needs from it — which card each control refers to, and which printing is
 * selected — live entirely in attributes that a designer moving boxes will
 * never see disappear.
 *
 * ── WHY TEXT AND NOT A RENDER ────────────────────────────────────────────────
 *
 * The same reason `chatAccessibility.test.ts` gives, and it applies unchanged:
 * this component's transitive imports reach `lib/supabase.ts`, which reads
 * `import.meta.env` at module scope and throws under Node. So these read the
 * source and check the claim the CODE makes. That cost is real — the assertions
 * are coupled to formatting — so every one of them is written to fail loudly
 * with the reason rather than to pass vacuously.
 */
import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const CARD_SRC = fileURLToPath(new URL('../chat/ApprovalCard.tsx', import.meta.url))
const ROW_SRC = fileURLToPath(new URL('../chat/ToolRow.tsx', import.meta.url))
const card = readFileSync(CARD_SRC, 'utf8')
const row = readFileSync(ROW_SRC, 'utf8')

/**
 * MUTATION: change `role="alertdialog"` to `role="dialog"` and this goes red.
 *
 * Gate 9 finds this control by its role AND its label, and its own comment
 * records what a rename did last time: the gate reported "the client half of
 * the approval round-trip is missing" while the card was on screen.
 */
test('the card is still an alertdialog with the label gate 9 looks for', () => {
  // ANCHORED TO ITS OWN LINE, and that is not decoration. The first version of
  // this assertion was a bare `/role="alertdialog"/` and it passed happily with
  // the JSX mutated to `role="dialog"` — because this file's header comment
  // QUOTES the attribute, and the search found the prose. Caught by mutating it
  // and watching the test stay green, which is the only way that class of
  // mistake is ever caught in a source-text assertion.
  assert.match(card, /^\s+role="alertdialog"$/m, 'the consent dialog must announce itself as one')
  assert.match(
    card,
    /aria-label="Deck-E is asking permission"/,
    'gate 9 finds this control by this exact label; renaming it breaks the gate, not just the label',
  )
})

/**
 * MUTATION: delete the `aria-label` from `RemoveButton` and this goes red.
 *
 * Without it a three-row batch is three buttons all reading "Wrong card", and
 * the one thing the reader has to know — which card they are about to drop — is
 * the one thing not announced.
 */
test('the removal control names the card it removes', () => {
  assert.match(
    card,
    /aria-label=\{removed \? `Put \$\{label\} back` : `Wrong card — leave \$\{label\} out`\}/,
    'the removal must name the CARD, or a batch is N identical buttons',
  )
  assert.match(card, /aria-pressed=\{removed\}/, 'a toggle must report its own state')
})

/**
 * THE STEPPER IS SIX MORE BUTTONS ON A THREE-ROW CARD.
 *
 * MUTATION: delete either `aria-label` from `Stepper`'s two buttons and this
 * goes red. Without them a batch of three cards announces as "plus, minus, plus,
 * minus, plus, minus" and there is no way to tell which card any of them belongs
 * to — the same defect the removal control's label exists to prevent, arriving
 * twice per row.
 *
 * MUTATION: delete `aria-live="polite"` from the readout wrapper and the third
 * assertion goes red. Pressing a button that changes a number without saying the
 * new number is a control a screen-reader user cannot operate.
 */
test('the stepper names the card it steps, and says the new amount', () => {
  assert.match(card, /aria-label=\{`One fewer \$\{row\.cardName\}`\}/, 'minus must name its card')
  assert.match(card, /aria-label=\{`One more \$\{row\.cardName\}`\}/, 'plus must name its card')
  assert.match(
    card,
    /<span aria-live="polite" aria-atomic="true"/,
    'the amount must be announced when it changes, and the region must pre-exist the change',
  )
  assert.match(
    card,
    /role="group"\s+aria-label=\{`How many \$\{row\.cardName\}`\}/,
    'the two buttons are one control and must be announced as one',
  )
})

/**
 * MUTATION: drop `role="radiogroup"` (or its `aria-label`) and this goes red.
 *
 * These are `<button>`s styled as radios, so nothing about the markup implies a
 * group. Without the role they are announced as N unrelated buttons and there is
 * no signal that picking one un-picks the others.
 */
test('the printing picker is announced as one group of radios, per card', () => {
  assert.match(card, /role="radiogroup"/, 'the pills are a single choice, not N buttons')
  assert.match(
    card,
    /aria-label=\{`Which printing of \$\{row\.cardName\}\?`\}/,
    'two pickers on one card are indistinguishable without the card name in the group label',
  )
  assert.match(card, /role="radio"/, 'each pill is one option of the group')
  assert.match(card, /aria-checked=\{c\.selected\}/, 'a radio that never reports checked is not a radio')
})

/**
 * THE SETTLED PRINTING IS NOT A DISABLED BUTTON.
 *
 * MUTATION: change the `<span>` in `PrintingChips`' non-selectable branch to a
 * `<button disabled>` and this goes red.
 *
 * The chips are on every row now, and on a row he is sure about there is exactly
 * one and nothing to switch it to — because the wire carried no alternatives,
 * which is WHY he is sure. A disabled control announces "there is a thing here
 * you may not have"; the truth is that there was only ever one answer. It looks
 * near-identical and it says the opposite thing.
 */
test('a settled printing is announced as a fact, not as an unavailable control', () => {
  const branch = card.slice(card.indexOf('if (!selectable) {'), card.indexOf('role="radiogroup"'))
  assert.ok(branch.length > 60, 'the non-selectable branch is gone — this test is reading a file it no longer understands')
  assert.doesNotMatch(branch, /<button/, 'the single chip must not be a button of any kind')
  assert.doesNotMatch(branch, /disabled/, 'and must not be announced as unavailable')
  assert.match(branch, /<span className=\{\[base, filled\]/, 'it is the same filled chip, as static text')
})

/**
 * MUTATION: remove `aria-hidden="true"` from `RowThumb` and this goes red.
 *
 * The art is decorative — the card's name and printing are already text on the
 * same row — so announcing it would read every row twice. `CardImage` is passed
 * `alt=""` for the same reason, and both are needed: an empty alt on the img
 * plus a hidden wrapper covers the skeleton and the not-found states too, which
 * have no img at all.
 */
test('the card art is decorative and does not double-announce every row', () => {
  const thumb = card.slice(card.indexOf('function RowThumb'), card.indexOf('function OperationChip'))
  assert.ok(thumb.length > 200, 'RowThumb is gone — this test is reading a file it no longer understands')
  assert.match(
    thumb,
    /aria-hidden="true"/,
    'the thumbnail wrapper must be hidden from the accessibility tree',
  )
  assert.match(thumb, /alt=""/, 'the img inside it carries an empty alt for the same reason')
})

/**
 * THE PER-ROW VERDICT IS TEXT, NOT A COLOUR.
 *
 * MUTATION: delete `{status.text}` from `RowStatusLine` and this goes red.
 *
 * "Will this card be written" is the single fact the second pass exists to make
 * unmissable, and the tick/dot and the green/muted are both decoration on top of
 * a sentence. A row that carried only the icon and the colour would say nothing
 * at all to a screen reader and nothing reliable to a colour-blind reader.
 */
test('every row states its own outcome in words', () => {
  const line = card.slice(card.indexOf('function RowStatusLine'), card.indexOf('function SectionHeading'))
  assert.ok(line.length > 100, 'RowStatusLine is gone — this test is reading a file it no longer understands')
  assert.match(line, /\{status\.text\}/, 'the sentence is the signal; the icon and the tint are not')
  assert.match(line, /aria-hidden="true"/, 'the dot is decorative and must not be announced')
})

/**
 * MUTATION: delete `aria-busy` from `components/ui/Button` — or swap `Button`
 * back for a bare `<button>` — and the second assertion goes red.
 *
 * The accept button is the one control whose in-flight state matters most: a
 * second press is a second batch, and the disabled attribute alone does not say
 * WHY it went away.
 */
test('accept and deny are the app Button, so busy is announced', () => {
  assert.match(card, /import \{ Button \} from '\.\.\/\.\.\/\.\.\/components\/ui\/Button'/)
  assert.match(
    card,
    /loading=\{busy\}/,
    "the accept button must pass `loading`, which is what puts aria-busy on it",
  )
  assert.match(card, /disabled=\{busy \|\| willWrite === 0\}/, 'and it must not be pressable twice')
})

/**
 * THE HEADING IS STILL A HEADING.
 *
 * MUTATION: change the `<h3>` in `SectionHeading` to a `<p>` and this goes red.
 * The visual fix for the serif was a class, deliberately, and NOT a downgrade to
 * a `<p>` — which would have looked identical and quietly removed both sections
 * from the document outline a screen-reader user navigates by.
 */
test('the section labels are real headings, not styled paragraphs', () => {
  assert.match(
    card,
    /<h3 className="font-text /,
    'the serif opt-out is a class on a real h3; a p tag would look the same and lose the outline',
  )
})

/**
 * MUTATION: delete `ml-auto` from the retry chip and this still passes — that is
 * layout. Delete the `aria-label` and it goes red.
 *
 * "Try again" repeated down a transcript is as ambiguous as "That's wrong"
 * repeated down this card, and for the same reason.
 */
test('the retry control names the call it retries', () => {
  assert.match(row, /aria-label=\{`Try \$\{title\} again`\}/, 'a bare "Try again" names nothing')
})

/**
 * MUTATION: remove `aria-expanded` or `aria-controls` from ToolRow's disclosure
 * and this goes red. The redesign moved the chevron from the end of a `flex-1`
 * button to sit against the title; that is a class change and it must not have
 * taken the disclosure semantics with it.
 */
test('the tool row disclosure still says what it expands', () => {
  assert.match(row, /aria-expanded=\{open\}/, 'a disclosure must report its state')
  assert.match(row, /aria-controls=\{detailId\}/, 'aria-expanded without aria-controls says WHAT nothing')
})

/**
 * THE FAILURE ROW'S LIVE REGION MUST KEEP ANNOUNCING.
 *
 * MUTATION: make the region conditional (`{a.live !== 'off' && <span …>}`) and
 * this goes red on the second assertion. A region added to the DOM at the same
 * moment its content appears is frequently not announced at all, and the one
 * announcement that must never be missed is the failure.
 */
test('the tool row live region is always mounted, and assertive for errors', () => {
  assert.match(
    row,
    /<span className="sr-only" aria-live=\{a\.live === 'assertive' \? 'assertive' : 'polite'\} aria-atomic="true">/,
    'the live region must exist before its content changes',
  )
  assert.match(
    row,
    /\{a\.live === 'off' \? '' : a\.announce\}/,
    'silence is the CONTENT going empty, never the region unmounting',
  )
})

/**
 * X1 — REDUCED MOTION SHIPS WITH THE MOTION.
 *
 * MUTATION: drop a `motion-safe:` prefix from any transition added in this pass
 * and this goes red, naming the file.
 *
 * The pass added hover and state transitions to the removal chip, the printing
 * pills, the row's struck-out fade, the retry chip, the opener chips and the
 * send button. Each is small; together they are the whole surface, and a blanket
 * `0.01ms` override is explicitly not the remedy.
 */
test('every transition added in this pass is behind motion-safe', () => {
  for (const [name, src] of [
    ['ApprovalCard.tsx', card],
    ['ToolRow.tsx', row],
  ] as const) {
    const unguarded = [...src.matchAll(/(?<!motion-safe:)\btransition-(colors|opacity|all|transform)\b/g)]
    assert.equal(
      unguarded.length,
      0,
      `${name} has ${unguarded.length} unguarded transition utilit${unguarded.length === 1 ? 'y' : 'ies'}: ` +
        `${unguarded.map((m) => m[0]).join(', ')} — prefix each with motion-safe:`,
    )
    // Prove the search found something to guard, so the assertion above cannot
    // pass because the regex stopped matching anything at all.
    assert.ok(
      /motion-safe:transition-/.test(src),
      `${name} has no motion-safe transitions at all — this test is checking a file it no longer understands`,
    )
  }
})

/**
 * ══════════════════════════════════════════════════════════════════════════════
 * THE CARD ACTUALLY CALLS THE FUNCTIONS. THIS PROJECT KEEPS NOT DOING THAT.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * A MUTATION CAME BACK GREEN AND THIS IS THE ANSWER TO IT. Replacing the card's
 * `approvalHeadline(title, preview)` with `approvalHeadline(title, null)` — so
 * every card fell back to the tool-name sentence and the row-aware headline
 * became dead code — broke NOTHING, because every assertion about the headline
 * calls the pure function directly.
 *
 * That is this repository's single most-repeated defect: `CardRows`,
 * `onRemoveCard` and `resetDeckeEntitlement` were all built and never wired, and
 * the last of them meant Deck-E never appeared for a signed-in reader.
 * `approvalPhrases.test.ts` carries the same pin for the same reason, added
 * after the same discovery.
 *
 * A SOURCE PIN, because `ApprovalCard.tsx`'s transitive imports reach
 * `lib/supabase.ts`, which reads `import.meta.env` at module scope and throws
 * under Node — so it cannot be rendered here. The cost is that these assertions
 * are coupled to formatting; the benefit is that a whole feature cannot become
 * decoration in a file nobody re-photographs.
 */
test('every pure function the second pass added is actually called by the card', () => {
  const wiring: [RegExp, string][] = [
    [/\{approvalHeadline\(title, preview\)\}/, 'the row-aware headline — the mutation that came back green'],
    [/rowStatus\(row, choice\)/, 'the per-row verdict line'],
    [/rowPrintings\(row, choice\)/, 'the printing chips, on every row'],
    [/acceptSummary\(preview, choices\)/, 'the sentence that states the split'],
    [/effectiveValue\(row, choice\)/, "the stepper's value, which every other number is derived from"],
    [/projectedAfter\(row, value\)/, 'the recomputed landing count'],
    [/stepBy\(row, choice, -1\)/, 'the minus button'],
    [/stepBy\(row, choice, 1\)/, 'the plus button'],
    [/stepBounds\(row\)/, "the stepper's one-sided limits"],
    [/whyThisPrinting\(row\)/, 'the reason he is sure'],
    [/knownSectionHeading\(known\.length\)/, "the settled section's heading"],
    [/askingSectionHeading\(asking\.length\)/, "the asking section's heading"],
    [/skippedNote\(preview\.skipped\.length\)/, 'his line about rows that did not resolve'],
  ]
  for (const [re, what] of wiring) {
    assert.match(card, re, `${what} is imported but never called — it is dead code`)
  }
})

/**
 * MUTATION: delete the `dim` prop from `RowThumb`'s call site and this goes red.
 *
 * *"These should be faded as well… make it more clear: this will be added, this
 * will not."* The fade is the one part of the row-state design that is pure
 * presentation, so it has no pure function to pin it — which makes it exactly
 * the part a later restyle would drop without anything noticing.
 */
test('the thumbnail fades with the row it belongs to', () => {
  assert.match(card, /<RowThumb row=\{row\} art=\{art\} faded=\{dim\} \/>/, 'the art must dim with the row')
  assert.match(card, /const dim = !status\.included/, 'and `dim` must mean "will not be written"')
})
