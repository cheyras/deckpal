/**
 * ══════════════════════════════════════════════════════════════════════════════
 * THE APPROVAL CARD — SEGMENTED BY PROVENANCE, NEVER BY A CONFIDENCE SCORE
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * This is the only place in the app where a model asks to change what the
 * reader owns, and the owner designed it himself:
 *
 *   1. **Printings he is sure about** — the printing shown as a settled chip
 *      with the reason he is sure beside it.
 *   2. **"I couldn't tell which printing these were — which ones?"** — the same
 *      chips, as a live picker.
 *
 * with ONE Accept, which commits section 1 even if a section-2 row is left
 * unpicked. One unknown must not hold up the batch.
 *
 * ── WHAT THE SECOND PASS CHANGED, AND WHY ────────────────────────────────────
 *
 * Four things, all from one screen recording, and each is argued where it lives:
 *
 *  1. **HE TALKS.** Every sentence was third person — "Let him add 3 cards?",
 *     "He knows these printings" — about a character who is standing beside the
 *     panel and has just spoken in the first person. *"This should be him
 *     talking like he's presenting it to us."* See `approvalHeadline`.
 *  2. **THE PRINTING CHIPS ARE ON EVERY ROW.** An owner ruling with two payoffs
 *     he named himself. See `rowPrintings`.
 *  3. **A STEPPER, AND THE `+1` IS ITS READOUT.** *"He adds one … but they can
 *     adjust the amount that we're adding."* See `Stepper`.
 *  4. **EVERY ROW SAYS WHETHER IT IS GOING TO HAPPEN, ALWAYS.** The old copy
 *     appeared only in the bad state and vanished on being answered, which is
 *     how a reader counts five rows and reads a button saying two. See
 *     `rowStatus` and `acceptSummary`.
 *
 * ── NO NUMERIC CONFIDENCE METER, AND THE REASON IS RESEARCH ──────────────────
 *
 * Miscalibrated AI confidence measurably degrades decisions, and ~93% of
 * permission prompts are approved regardless of what they say. A percentage on
 * this card would therefore be a number nobody can check, attached to a button
 * nearly everybody presses. Provenance is a real fact that cannot be
 * miscalibrated: either somebody named the printing or nobody did.
 *
 * So `certainty` is a FOUR-VALUED SORTING KEY and it is kept out of the DOM as
 * anything else. It decides which section a row is in and nothing more — no
 * "high / medium / low", no bar, no percentage. The temptation to render one on
 * top of four values will arrive; this paragraph is the answer to it.
 *
 * ── EVERY STRING HERE IS A CONSTANT OR A FACT ────────────────────────────────
 *
 * X2. Card names, set ids, numbers, printings and quantities all come from a
 * real server-run dry run of the real handler, delivered on a transient stream
 * part keyed to the held call. There is no prop through which model prose could
 * reach this dialog. Untrusted text (a card name from the catalog) is rendered
 * as text by React, never as markup.
 *
 * ── THE LOGIC IS NOT IN THIS FILE ────────────────────────────────────────────
 *
 * Which rows are included, whether anything was edited, what batch gets built,
 * what key it carries, what the model is told — AND EVERY SENTENCE THIS CARD
 * SHOWS — live in `approvalCardState.ts`, which has no DOM in it and is driven
 * directly by `__tests__/approvalCardState.test.ts` and
 * `host/__tests__/approvalPresentation.test.ts`.
 *
 * The words moved out for a reason worth recording. This file used to compose
 * its own headline inline —
 *
 *     {`Let him ${title.toLowerCase()}?`}
 *
 * — and on the first day anybody photographed the gallery it read **"Let him
 * let him add a card??"**. A string built inside a JSX expression has no seam a
 * test can reach, so the only check left was somebody opening the page, which is
 * precisely the check that had not happened for the whole of the pass that
 * shipped it. Anything that composes a sentence or renders a number now lives
 * next door with a mutation-checked test on it.
 *
 * ── WHAT THIS FILE IS: A DESIGN, AND THE DESIGN IS DECKPAL'S ─────────────────
 *
 * The first version was structurally correct and visually a receipt: a stack of
 * 13px grey text rows with a `That's wrong` link on each, small-caps section
 * headers, and a flat slab of saturated cyan for the confirm. It sat directly
 * under a Deck-E panel drawing real Pokemon at 4-up, and the contrast between
 * the two was the whole of the owner's complaint. Four things changed:
 *
 *  1. **CARD ART.** Every row leads with the actual card, drawn through the same
 *     `CardImage` and the same catalogue lookup the panel uses (`useCardArt`).
 *     This is a collection app; a dialog about four specific cards that shows
 *     none of them is asking somebody to approve a spreadsheet.
 *
 *  2. **A ROW IS TWO LINES, NOT ONE.** The name is the headline; the set, the
 *     collector number and the printing are the line under it. At 390px the old
 *     single line truncated to "Heat Rotom ex · …" and the printing — the thing
 *     the whole card is about — was the first casualty.
 *
 *  3. **THE SECTION HEADERS ARE SENTENCES.** `THIS CARD` and `WHAT WAS THE
 *     VARIANT ON THIS ONE?` in 11px letterspaced small caps is a 2009 admin
 *     panel. His question is a question and is set as one; the known section
 *     needs no header at all when it is the only section, because the headline
 *     already said what these are.
 *
 *  4. **THE BUTTONS ARE THE APP'S BUTTONS.** `Button` from `components/ui` —
 *     the same dimensional primary with its lip and its shadow that every other
 *     confirm in DeckPal wears. The flat cyan rectangle was not this app's
 *     design system; it was the absence of one.
 */
import { useId, type JSX } from 'react'
import { Icon } from '../../../components/Icon'
import { CardImage } from '../../../components/CardImage'
import { Button } from '../../../components/ui/Button'
import { CARD_ASPECT_RATIO_CSS } from '../../../lib/cardGeometry'
import { useCardArt, type CardArtMap } from './useCardArt'
import { DEEP_COST_NOTE } from './deepRequest'
import {
  acceptButtonLabel,
  acceptCount,
  acceptSummary,
  approvalHeadline,
  askingSectionHeading,
  beforeAfterText,
  choiceFor,
  effectiveValue,
  knownSectionHeading,
  operationText,
  projectedAfter,
  rowMetaText,
  rowPrintings,
  rowStatus,
  sections,
  skippedNote,
  stepBounds,
  stepBy,
  unshownCallsNote,
  whyThisPrinting,
  type ApprovalPreview,
  type Choices,
  type PreviewRow,
  type RowChoice,
} from './approvalCardState'

export type ApprovalCardProps = {
  /** The tool's own title. `approvalQuestion` turns it into the headline. */
  title: string
  /**
   * HIS RESTATEMENT of the request, for a call with no preview to show.
   *
   * A deep call has no dry run, so this card would otherwise be a headline and
   * two buttons — the dialog people learn to tap through without reading, which
   * is the argued reason deep calls did not ask at all until now. The line is
   * what makes the tap mean something: the reader asked for "a deck that'll get
   * a laugh" and what is about to be paid for is `idea: "all-Water Squirtle deck
   * built for comedy over competitiveness"`. The gap between those two sentences
   * is the entire value of being asked.
   *
   * `null` when there is nothing real to show — never a placeholder. See
   * `deepRequest.ts`.
   */
  request?: string | null
  /**
   * How many TOOL CALLS the model held in this step — not how many cards.
   *
   * RENAMED FROM `count`, and the rename is the fix. `count` read as "how many
   * things is this about", so the gallery passed the number of rows and the card
   * announced *"he also asked for 2 other changes"* immediately above all three
   * of the rows it was counting. One call holding three cards withholds nothing.
   * A name that says what the number is cannot be handed the other number by
   * accident.
   */
  heldCalls: number
  /**
   * The server-run dry run for THIS held call, or null.
   *
   * Null renders the plain dialog — title, one line, Leave it / Go ahead — and
   * that is the fallback that keeps a broken preview from becoming a broken
   * write. It is also what a non-`log_cards` write gets, because there are no
   * rows to segment.
   */
  preview: ApprovalPreview | null
  /** What the reader has done to each row, keyed by row index. Owned by the hook. */
  choices: Choices
  onChoice: (index: number, choice: RowChoice) => void
  /** Accept. Runs Path A or Path B; see `runAccept`. */
  onAccept: () => void
  /** Leave it. Settles a plain denial and writes nothing. */
  onDeny: () => void
  /** True from the moment Accept is pressed until the turn moves on. */
  busy?: boolean
}

/**
 * The card's own thumbnail — 44px, which is a deliberate size and not a guess.
 *
 * Small enough that four rows fit in a chat panel without becoming a gallery,
 * big enough that a person can tell a Charizard from a Gardevoir at a glance,
 * which is the entire job. `CardImage` fixes the 63:88 physical-card box before
 * a byte arrives, so the rows do not reflow as art lands — on a consent dialog,
 * a layout that moves under the cursor between reading and clicking is not a
 * cosmetic problem.
 *
 * `undefined` (still asking) draws the empty box, which is the skeleton.
 * `null` (the catalogue has no such card) draws a card-shaped outline with a
 * question mark: a card he named that does not exist is a FACT about this
 * request and the reader should see it, exactly as the panel shows the bare id.
 */
function RowThumb({ row, art, faded }: { row: PreviewRow; art: CardArtMap; faded: boolean }): JSX.Element {
  const found = art[row.cardId]
  return (
    /*
      IT FADES WITH THE ROW, and that was an explicit note: *"these should be
      faded as well… make it more clear: this will be added, this will not."*
      The art is the loudest thing on a row — a full-colour Charizard at the head
      of a line whose text says it will not be written is the row arguing with
      itself, and the picture wins that argument every time.

      `opacity` rather than a greyscale filter: a desaturated card still reads as
      a card that is THERE, and what has to read is *not included*.
    */
    <div
      className={[
        'w-[44px] shrink-0 motion-safe:transition-opacity',
        faded ? 'opacity-35' : '',
      ].join(' ')}
      aria-hidden="true"
    >
      {found ? (
        <CardImage
          low={found.front}
          high={found.frontLarge ?? found.front}
          alt=""
          radius={4}
        />
      ) : (
        <div
          className="flex w-full items-center justify-center rounded-[4px] border border-dashed border-border-default bg-surface-primary"
          style={{ aspectRatio: CARD_ASPECT_RATIO_CSS }}
        >
          {found === null ? <span className="text-[13px] text-text-muted">?</span> : null}
        </div>
      )}
    </div>
  )
}

/**
 * The operation, as a chip, with the before/after beside it.
 *
 * A CHIP AND NOT A SENTENCE FRAGMENT. "+1 · 0 → 1" ran as one grey string at
 * the right edge of a grey row and the eye had nothing to catch. Here the
 * operation is the weighted thing — tinted by DIRECTION, because adding four
 * cards and setting four cards to zero are the two presses this control must
 * never blur together — and the before/after sits beside it as the quiet
 * supporting fact.
 *
 * ONE LINE, NOT TWO, and the first draft got this wrong. Stacking the chip over
 * the before/after made the right end of a row three items at three different
 * heights — chip at the top, count under it, "That's wrong" centred against
 * both — a ragged little triangle at the end of every row. Photographed at 2x
 * it was the ugliest thing left on the card. One baseline fixes it.
 *
 * `tabular-nums` on both, so a column of them lines up rather than breathing.
 */
function OperationChip({ row, value }: { row: PreviewRow; value: number }): JSX.Element {
  const op = operationText({ mode: row.mode, value })
  const negative = row.mode === 'delta' && value < 0
  return (
    <span
      className={[
        // BIGGER, and the owner asked for exactly that: *"make these a little
        // bit bigger, this text, and have it be in green or red depending on if
        // it increased or decreased."* 12px → 13.5px, and the padding with it,
        // because a chip that grows only its type reads as cramped rather than
        // as louder.
        'rounded-[7px] px-[9px] py-[3px] text-[13.5px] font-semibold leading-[19px] tabular-nums',
        negative ? 'bg-halo-error text-error' : 'bg-halo-success text-success',
      ].join(' ')}
    >
      {op}
    </span>
  )
}

/**
 * ══════════════════════════════════════════════════════════════════════════════
 * THE STEPPER — AND THE DELTA CHIP IS ITS READOUT
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * *"I'd like to have like a little stepper still — he adds one, you know, that's
 * what they asked for, but they can adjust the amount that we're adding."*
 *
 * THE ONE DESIGN DECISION WORTH DEFENDING HERE is that the stepper does not sit
 * beside the `+1` chip; the chip is what the stepper reads out. Two controls
 * showing the same number is how a card ends up with a `+1` badge that disagrees
 * with a spinner two inches away for one frame, and there is no arrangement of
 * them in which the reader knows which one the button is going to obey. One
 * number, two buttons around it, and the tint that says which direction it goes.
 *
 * It edits the REAL row. `onChoice` writes `value` into the held row's own
 * `RowChoice`, `effectiveValue` is what every other reader of this card calls,
 * and `resolveBatchItems` sends it. There is no display-only path — which is the
 * whole point, since a stepper that looked live and wrote his number would be
 * the single worst control in this application.
 *
 * ── ACCESSIBILITY ────────────────────────────────────────────────────────────
 *
 * A `role="group"` naming the CARD, because three of these on one dialog are
 * otherwise six identical "plus"/"minus" buttons. The readout is a live region
 * so pressing a button says the new amount rather than leaving a screen-reader
 * user to guess; polite, and per-row, so it cannot interrupt the alertdialog's
 * own announcement.
 *
 * Not `role="spinbutton"`: that role promises arrow-key and Home/End handling
 * this control does not implement, and a role that lies about its keyboard is
 * worse for the people it is meant to help than two honest buttons.
 */
function Stepper({
  row,
  choice,
  onChoice,
  value,
}: {
  row: PreviewRow
  choice: RowChoice
  onChoice: (c: RowChoice) => void
  value: number
}): JSX.Element {
  const { min, max } = stepBounds(row)
  // "MORE" AND "LESS", NOT "UP" AND "DOWN". On a removal row the bigger
  // operation is the more negative number, so the button under the plus sign is
  // the one that takes more away — `stepBy` owns that inversion and this only
  // has to name the two directions in the reader's terms.
  const atMost = value === max || (row.mode === 'delta' && row.value < 0 && value === min)
  const atLeast = value === min || (row.mode === 'delta' && row.value < 0 && value === max)
  const set = (next: number) => onChoice({ ...choice, value: next })

  // ── TWO REAL BUTTONS WITH THE NUMBER BETWEEN THEM ─────────────────────────
  //
  // It used to be one bordered pill with "Set to 1" inside it, flanked by two
  // glyphs. The owner: *"I don't want 'set to 1' to be surrounded by the plus
  // and the minus, and I wanted these to look like they do in our card detail
  // modal — they're like actual buttons just to the left and right."*
  //
  // So this is `QtyStepper` from `routes/CardDetail.tsx` at this card's scale:
  // square `rounded-lg` buttons with a surface behind them, a bare tabular
  // number between, and no border around the group. The readout is the QUANTITY
  // now — "the quantity that we're adding right now" — and the before→after
  // moved out to `RowOutcome`, which is where he asked for it.
  const btn =
    'flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-lg ' +
    'bg-surface-tertiary text-icon-default pointer-events-auto ' +
    'motion-safe:transition-colors enabled:hover:bg-action-default-hover ' +
    'disabled:cursor-default disabled:text-icon-disabled disabled:opacity-40'

  return (
    <span
      role="group"
      aria-label={`How many ${row.cardName}`}
      className="flex shrink-0 items-center gap-[6px]"
    >
      <button
        type="button"
        onClick={() => set(stepBy(row, choice, -1))}
        disabled={atLeast}
        aria-label={`One fewer ${row.cardName}`}
        className={btn}
      >
        <Icon name="minus" size={14} />
      </button>
      {/*
        `aria-live` on the wrapper rather than on the number itself, so the
        region exists before its contents change — the same rule `ToolRow`
        states for its own, and the same failure it avoids.
      */}
      <span aria-live="polite" aria-atomic="true">
        <span className="block w-[18px] text-center text-[15px] font-bold tabular-nums text-text-primary">
          {Math.abs(value)}
        </span>
      </span>
      <button
        type="button"
        onClick={() => set(stepBy(row, choice, 1))}
        disabled={atMost}
        aria-label={`One more ${row.cardName}`}
        className={btn}
      >
        <Icon name="plus" size={14} />
      </button>
    </span>
  )
}

/**
 * The removal control, on every row.
 *
 * ── IT SAYS "WRONG CARD" NOW, AND THAT IS A NARROWING, NOT A RENAME ──────────
 *
 * *"That's wrong is a little bit too broad."* It was, and the breadth was the
 * problem rather than the wording: "that's wrong" was the only escape hatch on
 * the row, so it had to absorb four different complaints — wrong card, wrong
 * printing, wrong number, changed my mind — while doing exactly one thing.
 *
 * The other three now have their own controls. The printing chips are on every
 * row, so a wrong printing is a click. The stepper is on every row, so a wrong
 * number is two clicks. What is left for this button is the one thing neither
 * can fix: he named a card that is not the card. So it says so.
 *
 * The owner talked himself out of a segmented dropdown here, and he was right
 * to: a menu offering four reasons on a row that already carries two controls
 * for two of them is a menu whose first two entries are duplicates of the
 * controls beside it.
 *
 * It is a chip rather than bare text, for a reason the screenshots settled:
 * three of them stacked down the right edge of a card in plain 12px grey read
 * as a column of labels, not as three separate controls. A bordered chip that
 * fills on hover is unambiguously pressable, and the pressed state is a real
 * fill so a struck row can be told from an intact one from across the card.
 */
function RemoveButton({
  removed,
  onToggle,
  label,
}: {
  removed: boolean
  onToggle: () => void
  label: string
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={removed}
      // The label names the CARD, so a screen reader hears "wrong card, Pitch
      // Black" rather than eleven identical buttons.
      aria-label={removed ? `Put ${label} back` : `Wrong card — leave ${label} out`}
      className={[
        'pointer-events-auto shrink-0 whitespace-nowrap rounded-[7px] border px-[8px] py-[3px]',
        'text-[11px] font-medium leading-[16px] motion-safe:transition-colors',
        removed
          ? 'border-border-default bg-surface-tertiary text-text-primary'
          : 'border-surface-tertiary text-text-muted hover:border-border-default hover:bg-surface-tertiary/60 hover:text-text-body',
      ].join(' ')}
    >
      {removed ? 'Put back' : 'Wrong card'}
    </button>
  )
}

/**
 * ══════════════════════════════════════════════════════════════════════════════
 * THE PRINTING CHIPS — ON EVERY ROW, EVERY TIME
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * See `rowPrintings` for the ruling, the three states and both of the payoffs
 * the owner named. What this file adds is making the three tellable apart at a
 * glance, without any of them reading as an error:
 *
 *   • **SETTLED** — one chip, filled with the app's raised surface, rendered as
 *     a `<span>`. Not a disabled `<button>`: a disabled control announces "there
 *     is a thing here you may not have", and the truth is the opposite — there
 *     was only ever one answer, which is precisely why he is sure. Beside it,
 *     the "why" clause: *"we need to be more clear about like why he knows"*.
 *   • **AN OPTION** — bordered, body colour, hoverable. One of several.
 *   • **PROPOSED** — HIS guess on a row nobody has answered. A DASHED border in
 *     the accent, and no fill. The dash is doing real work: a filled chip means
 *     *decided*, and pre-filling his guess is exactly the silent default this
 *     whole section exists to replace. Dashed says *offered*, which is what it
 *     is, and it survives being photographed in greyscale.
 *
 * The filled treatment is the app's raised surface rather than the brand cyan,
 * because these sit two inches from the confirm button and when both were cyan
 * the eye could not tell which press writes.
 */
function PrintingChips({
  row,
  choice,
  onChoice,
}: {
  row: PreviewRow
  choice: RowChoice
  onChoice: (c: RowChoice) => void
}): JSX.Element | null {
  const groupId = useId()
  const { chips, selectable } = rowPrintings(row, choice)
  if (chips.length === 0) return null

  const base = 'rounded-full border px-[11px] py-[4px] text-[12px] leading-[17px]'
  const filled = 'border-surface-control-active bg-surface-quaternary font-semibold text-text-primary'

  if (!selectable) {
    const why = whyThisPrinting(row)
    return (
      <div className="flex flex-wrap items-center gap-[7px]">
        <span className={[base, filled].join(' ')}>{chips[0].label}</span>
        {why ? (
          <span className="text-[11.5px] leading-[16px] text-text-muted">{why}</span>
        ) : null}
      </div>
    )
  }

  return (
    <div
      role="radiogroup"
      aria-label={`Which printing of ${row.cardName}?`}
      className="flex flex-wrap gap-[6px]"
    >
      {chips.map((c) => (
        <button
          key={c.variantId ?? c.label}
          type="button"
          role="radio"
          aria-checked={c.selected}
          id={`${groupId}-${c.variantId}`}
          onClick={() => onChoice({ ...choice, variantId: c.selected ? null : c.variantId })}
          className={[
            'pointer-events-auto motion-safe:transition-colors',
            base,
            c.selected
              ? filled
              : c.proposed
                ? 'border-dashed border-action-primary-strong/70 text-text-primary hover:bg-surface-tertiary/60'
                : 'border-border-default text-text-body hover:border-surface-raised hover:bg-surface-tertiary/60',
          ].join(' ')}
        >
          {c.label}
          {c.ownedQty > 0 ? (
            <span className={c.selected ? 'text-text-body' : 'text-text-muted'}>
              {' · have '}
              {c.ownedQty}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  )
}

/**
 * The two lines every row shares: the card's name, and what tells it apart.
 *
 * The name is 13.5px at the body colour and the meta is 11.5px muted, which is
 * a real step rather than the half-step the flat row had. `min-w-0` on the
 * column and `truncate` on the name mean a long name shortens and the printing
 * underneath survives — the opposite of the old behaviour, where one line
 * truncated and took the printing with it.
 */
function RowIdentity({
  row,
  struck,
  after,
}: {
  row: PreviewRow
  struck: boolean
  after: number | null
}): JSX.Element {
  /*
    THE PRINTING CAME OUT OF THIS LINE, because it is now a chip on every row —
    see `PrintingChips`. Leaving it here as well would print the same fact twice
    on every row of the card, four inches apart, in two different renderings.

    WHAT WENT IN INSTEAD is where the count lands, because it is the fact the
    stepper changes. `projectedAfter` recomputes it from the reader's own amount;
    a dry run's `after` is a fact about HIS number and stops being true the first
    time anybody presses `+`.
  */
  const meta = rowMetaText({ setId: row.setId, number: row.number, variantLabel: null })
  return (
    /*
      `min-w-[128px]` IS THE WHOLE RESPONSIVE STRATEGY, and it is a floor rather
      than a width. Paired with `flex-wrap` on the row (see `RowLine`), it says:
      this column never shrinks below a legible card name — if the operation and
      the removal cannot fit beside 128px of name, they wrap onto their own line
      instead of squeezing it.

      Without it, `min-w-0 flex-1` let the name collapse to whatever was left,
      and at 390px that was "Gol…", "Pika…", "Cha…" — three truncated stubs in a
      dialog whose entire subject is WHICH CARDS. A container query would be the
      textbook answer; a min-width plus a wrap is the same answer with no
      breakpoint to get wrong and no support question to ask.
    */
    <span className="flex min-w-[128px] flex-1 flex-col gap-[1px]">
      <span
        className={[
          'truncate text-[13.5px] font-medium leading-[19px] text-text-primary',
          struck ? 'line-through' : '',
        ].join(' ')}
      >
        {row.cardName}
      </span>
      {/*
        THE BEFORE→AFTER IS NOT HERE ANY MORE. It was appended to this line as
        "sv04.5 · #007 · 0 → 1", in 11.5px muted grey beside the set code, and
        the owner's reaction was immediate: *"the move of this over here makes
        no sense, I didn't ask for this."* He wanted it OUT of the metadata and
        LOUDER — *"have the current-to-proposed be like the biggest thing here
        … the main thing on the farthest right."* It lives in `RowOutcome` now.
      */}
      {meta ? (
        <span className="truncate text-[11.5px] leading-[16px] text-text-muted">{meta}</span>
      ) : null}
    </span>
  )
}

/**
 * WHAT THIS ROW WILL DO TO THE COUNT — the loudest thing on the line.
 *
 * *"Have the current-to-proposed be like the biggest thing here … bigger and
 * more noticeable as like the main thing on the farthest right."*
 *
 * It is the only number on the row that is a CONSEQUENCE rather than an input.
 * The stepper's number is what you are asking for; this is what your collection
 * will say afterwards, and it is the thing worth checking before pressing a
 * button that writes. Green up, red down — his instruction, and the same
 * direction language the rest of the app uses.
 *
 * `projectedAfter` recomputes it from the reader's own amount, so it tracks the
 * stepper rather than reporting the dry run's opinion of a number the reader has
 * since changed.
 */
function RowOutcome({
  row,
  after,
  struck,
}: {
  row: PreviewRow
  after: number | null
  struck: boolean
}): JSX.Element | null {
  // `before` is null when the dry run could not read a current quantity. There
  // is then no before→after to state, and inventing one — "0 → 1" for a row
  // whose current count is unknown — would be a confident number on the one
  // surface where a reader is about to authorise a write.
  if (after === null || row.before === null) return null
  const down = after < row.before
  return (
    <span
      aria-live="polite"
      aria-atomic="true"
      aria-label={`${row.cardName}: ${row.before} becomes ${after}`}
      className={[
        'shrink-0 whitespace-nowrap text-[16px] font-semibold leading-[22px] tabular-nums',
        struck ? 'text-text-muted line-through' : down ? 'text-error' : 'text-success',
      ].join(' ')}
    >
      {beforeAfterText({ before: row.before, after })}
    </span>
  )
}

/**
 * The identity, the stepper and the removal, on one line that can become two.
 *
 * Shared by every row so they cannot drift — they had already drifted once, the
 * known row centring its contents and the asking row top-aligning them, for no
 * reason either could have defended.
 *
 * THE ORDER IS `name … amount, wrong card`. The amount sits immediately to the
 * LEFT of the removal — which is where the owner put it — so the eye finishes
 * the row on the two things it can act on, adjacent, rather than crossing a
 * runway of grey between them.
 */
function RowLine({
  row,
  choice,
  onChoice,
  value,
  after,
  dim,
}: {
  row: PreviewRow
  choice: RowChoice
  onChoice: (c: RowChoice) => void
  value: number
  after: number | null
  dim: boolean
}): JSX.Element {
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-[10px] gap-y-[6px]">
      {/*
        THE FADE STOPS HERE. Only the row's EVIDENCE dims — the art (see
        `RowThumb`) and the name — never the controls beside it. Photographed at
        2x with the fade on the whole line, "Wrong card" on an unanswered row was
        indistinguishable from a disabled button, on the one row where a reader
        is most likely to want it. Faded evidence, bright affordance.
      */}
      <span
        className={[
          'flex min-w-[128px] flex-1 motion-safe:transition-opacity',
          dim ? 'opacity-45' : '',
        ].join(' ')}
      >
        <RowIdentity row={row} struck={choice.removed} after={after} />
      </span>
      {/* `ml-auto` so that when this pair wraps to its own line it finishes at
          the right edge, under the name, rather than starting under the thumb. */}
      {/*
        THE ORDER IS HIS: *"wrong card goes to here, vertically centered … then
        the quantity with the minus and plus … and zero-to-one bigger and more
        noticeable as the main thing on the farthest right."*

        `items-center` rather than the row's default, so "Wrong card" sits level
        with the middle of the name and its set line instead of hanging off the
        top of them — the other half of the same sentence.
      */}
      <span className="ml-auto flex shrink-0 items-center gap-[10px]">
        <RemoveButton
          removed={choice.removed}
          label={row.cardName}
          onToggle={() => onChoice({ ...choice, removed: !choice.removed })}
        />
        {/*
          NO STEPPER ON A STRUCK ROW. Adjusting the amount of something that is
          not going to happen is a control with nothing behind it, and leaving it
          live invites somebody to set a number, look at the row, and believe
          they have un-struck it.
        */}
        {choice.removed ? null : (
          <Stepper row={row} choice={choice} onChoice={onChoice} value={value} />
        )}
        <RowOutcome row={row} after={after} struck={choice.removed} />
      </span>
    </div>
  )
}

/**
 * ══════════════════════════════════════════════════════════════════════════════
 * ONE ROW COMPONENT, BECAUSE THERE IS ONE KIND OF ROW NOW
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * There used to be two — `KnownRow` (identity, chip, removal) and `AskingRow`
 * (the same plus a picker and a footnote) — and the split was the reason the two
 * drifted apart on alignment twice. Putting the printing chips on EVERY row
 * collapses the difference to a single boolean inside `PrintingChips`, so the
 * two components had nothing left to disagree about.
 *
 * The requirement that produced the split survives intact and is worth restating
 * because it looks violated at a glance: *"if it's truly high confidence I don't
 * want the user to feel like they have to pick a variant again."* A settled row
 * still poses no question — its single chip is not a control, and the section it
 * sits in says "I'm sure about these printings". What changed is that the answer
 * he is sure of is now VISIBLE and SHAPED like every other answer on the card,
 * rather than being grey text in a different typeface saying the same word.
 *
 * ── THE FADE IS DELIBERATELY PARTIAL, AND THAT IS THE INTERESTING BIT ────────
 *
 * The row's identity and its art fade when the row will not be written; the
 * PRINTING CHIPS AND THE CONTROLS DO NOT. Fading the whole block was the obvious
 * reading of *"these should be faded as well"* and it is wrong in the one state
 * that matters most: an unpicked row is excluded precisely BECAUSE nobody has
 * touched its chips, so dimming the chips dims the way out of the state the
 * dimming is complaining about. Faded evidence, bright affordance.
 */
function CardRow({
  row,
  art,
  choice,
  onChoice,
}: {
  row: PreviewRow
  art: CardArtMap
  choice: RowChoice
  onChoice: (c: RowChoice) => void
}): JSX.Element {
  const value = effectiveValue(row, choice)
  const after = projectedAfter(row, value)
  const status = rowStatus(row, choice)
  const dim = !status.included

  return (
    <li className="py-[9px]">
      <div className="flex items-start gap-[11px]">
        <RowThumb row={row} art={art} faded={dim} />
        <div className="flex min-w-0 flex-1 flex-col gap-[7px]">
          <RowLine row={row} choice={choice} onChoice={onChoice} value={value} after={after} dim={dim} />

          {/*
            NO WARNING ICON ANYWHERE ON THIS BLOCK. The first pass put an alert
            triangle beside the picker and it contradicted the heading directly
            above it: an unnamed printing is an ordinary thing and not an error,
            which is why the heading is a question. A caution glyph on the answer
            to a friendly question un-asks it.
          */}
          {choice.removed ? null : (
            <PrintingChips row={row} choice={choice} onChoice={onChoice} />
          )}

          <RowStatusLine status={status} />
        </div>
      </div>
    </li>
  )
}

/**
 * The line that says whether this row is going to happen.
 *
 * IT IS ALWAYS HERE. `rowStatus` carries the reasoning for why it must never be
 * the kind of line that appears only in the bad state; this is the rendering,
 * and the rendering has one job beyond the words — to be TELLABLE APART at a
 * glance from across the card, since the whole complaint was that a reader
 * counted five rows and got a button saying two.
 *
 * So a row that is going in gets a tick and the success colour, and a row that
 * is not gets a muted dot and muted text. Colour is never the only signal: the
 * sentence says it in words, the thumbnail is faded, and the icon differs in
 * SHAPE. Any one of those three carries the fact on its own.
 */
function RowStatusLine({ status }: { status: ReturnType<typeof rowStatus> }): JSX.Element {
  return (
    <p
      className={[
        'flex items-center gap-[5px] text-[11.5px] leading-[16px]',
        status.included ? 'text-success' : 'text-text-muted',
      ].join(' ')}
    >
      {status.included ? (
        <Icon name="check" size={12} className="shrink-0" />
      ) : (
        <span aria-hidden="true" className="block h-[5px] w-[5px] shrink-0 rounded-full bg-current" />
      )}
      {status.text}
    </p>
  )
}

/**
 * A section's heading.
 *
 * SENTENCE CASE, BODY WEIGHT, NO LETTERSPACING. The version this replaces was
 * `text-[11px] font-semibold uppercase tracking-[0.04em]` — the small-caps
 * eyebrow that every dashboard template ships with, which reads as chrome
 * rather than as speech and which the owner picked out by name. His question is
 * a question a person asked; setting it like a table header answers it in the
 * wrong voice.
 *
 * `font-text` IS LOAD-BEARING. `theme.css` gives every `h1/h2/h3` the Fraunces
 * display serif, and says in the same block that a serif *"goes muddy below
 * ~14px"*. This heading is 12.5px, and the first photograph of the redesign
 * caught it in Fraunces: two serif labels in the middle of an otherwise sans
 * card, at a size the app's own rule says a serif should not be used at.
 *
 * A `font-sans` utility DOES NOT FIX IT and the reason is a cascade-layer trap
 * rather than a specificity one — Tailwind v4 layers every utility, the heading
 * rule is unlayered, and unlayered beats layered outright. `.font-text` is the
 * opt-out added beside the opt-in in `theme.css`, where that whole argument is
 * written down and counted.
 */
function SectionHeading({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <h3 className="font-text mb-[4px] text-[12.5px] font-medium leading-[18px] text-text-secondary">
      {children}
    </h3>
  )
}

/**
 * The card.
 *
 * `role="alertdialog"` and the label are unchanged from the plain dialog this
 * replaces, because gate 9 finds the control by them and a rename would have it
 * report "the client half of the approval round-trip is missing" while the card
 * is on screen — which is exactly the failure that gate's own comment records.
 */
export function ApprovalCard({
  title,
  request,
  heldCalls,
  preview,
  choices,
  onChoice,
  onAccept,
  onDeny,
  busy = false,
}: ApprovalCardProps): JSX.Element {
  const editable = preview?.editable === true
  const { known, asking } = editable && preview ? sections(preview) : { known: [], asking: [] }
  const willWrite = editable && preview ? acceptCount(preview, choices) : 1

  /*
    THE ART REQUEST IS ONE CALL FOR THE WHOLE CARD, made unconditionally so the
    hook order never changes between the plain dialog and the segmented one. An
    empty id list is a no-op inside `useCardArt`, so the non-editable fallback
    costs nothing.
  */
  const art = useCardArt(editable && preview ? preview.rows.map((r) => r.cardId) : [])

  /**
   * Other calls the model held in the same step, which this card does not show.
   *
   * The headline used to read "Let him make 2 changes?" while rendering ONE of
   * them, so a single press answered for a change whose arguments appeared
   * nowhere. It cannot any more — anything not shown here is settled as "not
   * shown to the reader, so it was not run" — but the reader still deserves to
   * be told that something was held back rather than silently dropped.
   */
  const unshown = unshownCallsNote(heldCalls)
  const summary = editable && preview ? acceptSummary(preview, choices) : ''

  /*
    ONE HEADER BLOCK, then the rows, then the footer. The gaps are 12/14/16
    rather than the flat 10 the first version used, because a card with four
    kinds of thing in it needs the reader to be able to see the joints — the
    question, the evidence, the decision.
  */
  return (
    <div
      className="decke-composer-card pointer-events-auto mx-[16px] mb-[10px] shrink-0 p-[14px]"
      role="alertdialog"
      aria-label="Deck-E is asking permission"
    >
      <p className="text-[14.5px] font-semibold leading-[21px] text-text-primary">
        {approvalHeadline(title, preview)}
      </p>
      {/*
        HIS RESTATEMENT, for a call that has no preview to show.

        Without it a deep-call confirmation is a headline and two buttons, which
        is the dialog people learn to tap through — and that is the argued reason
        these calls did not ask at all until now. Quoted rather than paraphrased,
        because the point is to show the reader the sentence he is about to spend
        on, not our summary of it.
      */}
      {request ? (
        <div className="mt-[8px] rounded-[8px] border border-border-subtle bg-surface-secondary px-[10px] py-[8px]">
          <p className="text-[12.5px] leading-[18px] text-text-secondary">{request}</p>
          {/* The cost, as its own sentence — see `DEEP_COST_NOTE`. */}
          <p className="mt-[4px] text-[11.5px] leading-[16px] text-text-muted">{DEEP_COST_NOTE}</p>
        </div>
      ) : null}
      {unshown ? (
        <p className="mt-[6px] text-[12px] leading-[17px] text-text-muted">{unshown}</p>
      ) : null}

      {/*
        THE PREVIEW, KEYED TO THIS CALL.

        The line this replaces scanned backwards through the transcript for the
        last successful chip of ANY tool, so on a turn where a read ran after
        the write was held it showed the wrong preview entirely. This comes off
        a stream part carrying the held call's own `toolCallId`, produced by a
        real dry run of the real handler — the same fact, from the tool rather
        than from him, which is the version that cannot be forgotten or
        embellished.
      */}
      {!editable ? (
        preview?.summary ? (
          <p className="mt-[6px] text-[12.5px] leading-[18px] text-text-secondary">
            {preview.summary}
          </p>
        ) : null
      ) : (
        <div className="mt-[12px] flex flex-col gap-[14px]">
          {known.length > 0 ? (
            <section>
              {/*
                NO HEADING WHEN THERE IS NOTHING TO DISTINGUISH IT FROM. The
                headline above already said "Here's what I want to add"; a
                heading reading "These cards" directly under it is a label on
                the only thing on screen. It earns its place only when the
                second section exists and the reader has to tell the two apart.
              */}
              {asking.length > 0 ? (
                <SectionHeading>{knownSectionHeading(known.length)}</SectionHeading>
              ) : null}
              <ul className="divide-y divide-border-default/30">
                {known.map((r) => (
                  <CardRow
                    key={r.index}
                    row={r}
                    art={art}
                    choice={choiceFor(choices, r.index)}
                    onChoice={(c) => onChoice(r.index, c)}
                  />
                ))}
              </ul>
            </section>
          ) : null}

          {asking.length > 0 ? (
            <section>
              {/*
                HIS QUESTION, IN HIS OWN VOICE. The owner liked being asked when
                a printing was genuinely unknown; this is that, phrased as a
                question rather than as a warning, because an unnamed printing
                is an ordinary thing and not an error — and phrased in the FIRST
                PERSON, because the person asking is the one standing beside the
                panel.
              */}
              <SectionHeading>{askingSectionHeading(asking.length)}</SectionHeading>
              <ul className="divide-y divide-border-default/30">
                {asking.map((r) => (
                  <CardRow
                    key={r.index}
                    row={r}
                    art={art}
                    choice={choiceFor(choices, r.index)}
                    onChoice={(c) => onChoice(r.index, c)}
                  />
                ))}
              </ul>
            </section>
          ) : null}

          {preview && preview.skipped.length > 0 ? (
            <p className="text-[11.5px] leading-[16px] text-text-muted">
              {skippedNote(preview.skipped.length)}
            </p>
          ) : null}
        </div>
      )}

      {/*
        The buttons are deliberately not symmetrical. "Leave it" is the plain
        one and comes first in reading order; going ahead takes the deliberate
        click. This is the only place in the app where a model asks to change
        the reader's collection, and the default posture should be no.

        THEY ARE THE APP'S OWN BUTTONS. `Button variant="primary"` is the
        dimensional, gradient-faced control every other confirm in DeckPal
        wears; what was here before was `bg-action-primary` on a 10px rectangle,
        which is the brand colour without any of the design system attached to
        it — a flat slab of saturated cyan, in the owner's words. Using the real
        primitive is both better looking and the only way this dialog can stay
        in step with the rest of the app when the button changes.

        THE COUNT IS ON THE BUTTON because it is the last thing read before the
        press. It counts what will ACTUALLY be written — struck rows out,
        unpicked printings out — so it moves as the reader answers, and nobody
        can press it expecting a different number.
      */}
      {/*
        AND THE COUNT IS ALSO A SENTENCE, DIRECTLY ABOVE IT.

        The button alone was not enough and the owner said exactly why: *"down
        here it says add two cards and the first time I did this I was like, oh
        well it's five cards."* A verb and a number, with five rows above it and
        nothing joining the two, is a sum the reader has to do themselves —
        against a list they have just been told is about to change what they own.

        `acceptSummary` states the split in words and goes SILENT when there is
        nothing to reconcile, so this line only ever appears when it is carrying
        information. Its reasoning, including why the rows are not regrouped when
        a printing is picked, is in that function.
      */}
      {editable && preview && summary ? (
        <p className="mt-[12px] text-[12.5px] leading-[18px] text-text-secondary">{summary}</p>
      ) : null}
      <div className="mt-[12px] flex flex-wrap items-center gap-[8px]">
        <Button variant="ghost" size="sm" onClick={onDeny} disabled={busy}>
          Leave it
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={onAccept}
          // DISABLED ON THE SAME TICK Accept is pressed. A second press would
          // be a second batch; the idempotency key makes that a no-op rather
          // than a double write, but a control that can be pressed twice while
          // the first press is in flight is a control that will be.
          disabled={busy || willWrite === 0}
          loading={busy}
        >
          {editable && preview ? acceptButtonLabel(preview, choices) : 'Go ahead'}
        </Button>
        {/*
          A DISABLED BUTTON SAYING "Nothing to add" is a dead end unless it also
          says what to do about it. Both routes out are already on the card —
          put a row back, or pick a printing — so this names them rather than
          leaving the reader to work out why the only affirmative control is
          greyed.
        */}
        {editable && willWrite === 0 ? (
          <span className="flex items-center gap-[5px] text-[11.5px] leading-[16px] text-text-muted">
            <Icon name="alert" size={12} className="shrink-0" />
            {asking.length > 0 ? 'Pick a printing, or leave it with me' : 'Put a card back, or leave it with me'}
          </span>
        ) : null}
      </div>
    </div>
  )
}
