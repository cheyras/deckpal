/**
 * ══════════════════════════════════════════════════════════════════════════════
 * THE APPROVAL CARD — SEGMENTED BY PROVENANCE, NEVER BY A CONFIDENCE SCORE
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * This is the only place in the app where a model asks to change what the
 * reader owns, and the owner designed it himself:
 *
 *   1. **Cards where the variant is known** — plain rows, needing no
 *      interaction, each with a "that's wrong" removal.
 *   2. **"What was the variant on these?"** — an inline picker per row.
 *
 * with ONE Accept, which commits section 1 even if a section-2 row is left
 * unpicked. One unknown must not hold up the batch.
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
import { useCardArt, type CardArtMap } from './useCardArt'
import {
  acceptButtonLabel,
  acceptCount,
  approvalQuestion,
  beforeAfterText,
  choiceFor,
  operationText,
  rowMetaText,
  sections,
  unshownCallsNote,
  type ApprovalPreview,
  type Choices,
  type PreviewRow,
  type RowChoice,
} from './approvalCardState'

export type ApprovalCardProps = {
  /** The tool's own title. `approvalQuestion` turns it into the headline. */
  title: string
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
 * which is the entire job. `CardImage` fixes the 245:337 box before a byte
 * arrives, so the rows do not reflow as art lands — on a consent dialog, a
 * layout that moves under the cursor between reading and clicking is not a
 * cosmetic problem.
 *
 * `undefined` (still asking) draws the empty box, which is the skeleton.
 * `null` (the catalogue has no such card) draws a card-shaped outline with a
 * question mark: a card he named that does not exist is a FACT about this
 * request and the reader should see it, exactly as the panel shows the bare id.
 */
function RowThumb({ row, art }: { row: PreviewRow; art: CardArtMap }): JSX.Element {
  const found = art[row.cardId]
  return (
    <div className="w-[44px] shrink-0" aria-hidden="true">
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
          style={{ aspectRatio: '245 / 337' }}
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
function OperationChip({ row }: { row: PreviewRow }): JSX.Element {
  const op = operationText(row)
  const trail = beforeAfterText(row)
  const negative = row.mode === 'delta' && row.value < 0
  return (
    <span className="flex shrink-0 items-center gap-[8px]">
      {trail ? (
        <span className="text-[11.5px] leading-[16px] tabular-nums text-text-muted">{trail}</span>
      ) : null}
      <span
        className={[
          'rounded-[6px] px-[7px] py-[2px] text-[12px] font-semibold leading-[17px] tabular-nums',
          negative ? 'bg-halo-error text-error' : 'bg-halo-success text-success',
        ].join(' ')}
      >
        {op}
      </span>
    </span>
  )
}

/**
 * The removal control, on every row in both sections.
 *
 * "That's wrong" rather than an ✕, because an ✕ on a consent dialog reads as
 * "close this" and the thing it removes is one line of a list. It is the one
 * affordance the two sections share: section 1 has no question, but it can
 * still be WRONG, and until now the reader's only options were to approve a
 * batch they could see an error in or to refuse all of it.
 *
 * It is a chip now rather than bare text, for a reason the screenshots settled:
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
      // The label names the CARD, so a screen reader hears "that's wrong,
      // Pitch Black" rather than eleven identical buttons.
      aria-label={removed ? `Put ${label} back` : `That's wrong — leave ${label} out`}
      className={[
        'pointer-events-auto shrink-0 whitespace-nowrap rounded-[7px] border px-[8px] py-[3px]',
        'text-[11px] font-medium leading-[16px] motion-safe:transition-colors',
        removed
          ? 'border-border-default bg-surface-tertiary text-text-primary'
          : 'border-surface-tertiary text-text-muted hover:border-border-default hover:bg-surface-tertiary/60 hover:text-text-body',
      ].join(' ')}
    >
      {removed ? 'Put back' : "That's wrong"}
    </button>
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
function RowIdentity({ row, struck }: { row: PreviewRow; struck: boolean }): JSX.Element {
  const meta = rowMetaText(row)
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
      {meta ? (
        <span className="truncate text-[11.5px] leading-[16px] text-text-muted">{meta}</span>
      ) : null}
    </span>
  )
}

/**
 * The identity, the operation and the removal, on one line that can become two.
 *
 * Shared by both row kinds so they cannot drift — they had already drifted once,
 * the known row centring its contents and the asking row top-aligning them, for
 * no reason either could have defended.
 */
function RowLine({
  row,
  choice,
  onChoice,
}: {
  row: PreviewRow
  choice: RowChoice
  onChoice: (c: RowChoice) => void
}): JSX.Element {
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-[10px] gap-y-[6px]">
      <RowIdentity row={row} struck={choice.removed} />
      {/* `ml-auto` so that when this pair wraps to its own line it finishes at
          the right edge, under the name, rather than starting under the thumb. */}
      <span className="ml-auto flex shrink-0 items-center gap-[10px]">
        <OperationChip row={row} />
        <RemoveButton
          removed={choice.removed}
          label={row.cardName}
          onToggle={() => onChoice({ ...choice, removed: !choice.removed })}
        />
      </span>
    </div>
  )
}

/**
 * A row whose printing nobody has to think about.
 *
 * NO CONTROL THAT LOOKS LIKE A QUESTION, which is the owner's requirement in
 * his own words: *"if it's truly high confidence I don't want the user to feel
 * like they have to pick a variant again, especially if they were already
 * pretty clear about what variant it is."*
 */
function KnownRow({
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
  return (
    <li
      className={[
        'flex items-center gap-[11px] py-[9px] motion-safe:transition-opacity',
        choice.removed ? 'opacity-45' : '',
      ].join(' ')}
    >
      <RowThumb row={row} art={art} />
      <RowLine row={row} choice={choice} onChoice={onChoice} />
    </li>
  )
}

/**
 * A row nobody named a printing for.
 *
 * IT LOOKS EXCLUDED UNTIL IT IS ANSWERED, because it IS excluded until it is
 * answered — Accept commits section 1 regardless, and a person who presses it
 * with this untouched must not be able to be surprised by what happened. The
 * button's own count moves the moment a printing is picked, which is the
 * cheapest honest way to say so.
 *
 * The default the server would have used is marked, and marked as a fact
 * ("usually this one") rather than as a recommendation. It is not preselected:
 * preselecting it would answer the question on the reader's behalf and turn the
 * whole section back into the silent default it exists to replace.
 *
 * THE PICKER IS INDENTED UNDER THE NAME, not under the thumbnail. The card art
 * is the row's left rail; hanging the pills off the same left edge as the name
 * makes the block read as one thing that belongs to one card, which matters
 * when two of these stack.
 */
function AskingRow({
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
  const groupId = useId()
  const answered = choice.variantId !== null
  return (
    <li className={['py-[9px] motion-safe:transition-opacity', choice.removed ? 'opacity-45' : ''].join(' ')}>
      <div className="flex items-start gap-[11px]">
        <RowThumb row={row} art={art} />
        <div className="flex min-w-0 flex-1 flex-col gap-[8px]">
          <RowLine row={row} choice={choice} onChoice={onChoice} />

          {choice.removed ? null : (
            <>
              <div
                role="radiogroup"
                aria-label={`Which printing of ${row.cardName}?`}
                className="flex flex-wrap gap-[6px]"
              >
                {row.candidates.map((c) => {
                  const selected = choice.variantId === c.variantId
                  return (
                    <button
                      key={c.variantId}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      id={`${groupId}-${c.variantId}`}
                      onClick={() =>
                        onChoice({ ...choice, variantId: selected ? null : c.variantId })
                      }
                      className={[
                        'pointer-events-auto rounded-full border px-[11px] py-[4px]',
                        'text-[12px] leading-[17px] motion-safe:transition-colors',
                        selected
                          // A SELECTED RADIO IS FILLED, but with the app's own
                          // raised surface rather than the brand cyan. The pills
                          // sit two inches from the confirm button; when both
                          // were cyan the eye could not tell which one was the
                          // press that writes.
                          ? 'border-surface-control-active bg-surface-quaternary font-semibold text-text-primary'
                          : 'border-border-default text-text-body hover:border-surface-raised hover:bg-surface-tertiary/60',
                      ].join(' ')}
                    >
                      {c.label}
                      {c.ownedQty > 0 ? (
                        <span className={selected ? 'text-text-body' : 'text-text-muted'}>
                          {' · have '}
                          {c.ownedQty}
                        </span>
                      ) : null}
                    </button>
                  )
                })}
              </div>
              {/*
                NO WARNING ICON. The first pass put an alert triangle here and
                it contradicted the section directly above it: an unnamed
                printing is *"an ordinary thing and not an error"*, which is why
                the heading is a question rather than a warning. A caution glyph
                on the answer to a friendly question un-asks it.
              */}
              {!answered ? (
                <p className="text-[11.5px] leading-[16px] text-text-muted">
                  Not added until you pick one
                  {row.wouldUseVariantId !== null
                    ? ` — usually it's ${
                        row.candidates.find((c) => c.variantId === row.wouldUseVariantId)?.label ??
                        'the first'
                      }`
                    : ''}
                </p>
              ) : null}
            </>
          )}
        </div>
      </div>
    </li>
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
        {approvalQuestion(title)}
      </p>
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
                headline above already said "Let him add 3 cards?"; a heading
                reading "These cards" directly under it is a label on the only
                thing on screen. It earns its place only when the second section
                exists and the reader has to tell the two apart.
              */}
              {asking.length > 0 ? (
                <SectionHeading>
                  {known.length === 1 ? 'He knows this printing' : 'He knows these printings'}
                </SectionHeading>
              ) : null}
              <ul className="divide-y divide-border-default/30">
                {known.map((r) => (
                  <KnownRow
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
                HIS QUESTION, IN HIS WORDS. The owner liked being asked when a
                printing was genuinely unknown; this is that, phrased as a
                question rather than as a warning, because an unnamed printing
                is an ordinary thing and not an error.
              */}
              <SectionHeading>
                {asking.length === 1
                  ? 'What was the variant on this one?'
                  : 'What was the variant on these?'}
              </SectionHeading>
              <ul className="divide-y divide-border-default/30">
                {asking.map((r) => (
                  <AskingRow
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
              {preview.skipped.length} item
              {preview.skipped.length === 1 ? '' : 's'} couldn&rsquo;t be matched to a card and
              won&rsquo;t be added.
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
      <div className="mt-[14px] flex flex-wrap items-center gap-[8px]">
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
            {asking.length > 0 ? 'Pick a printing, or leave it' : 'Put a card back, or leave it'}
          </span>
        ) : null}
      </div>
    </div>
  )
}
