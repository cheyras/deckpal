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
 * what key it carries, and what the model is told all live in
 * `approvalCardState.ts`, which has no DOM in it and is driven directly by
 * `__tests__/approvalCardState.test.ts`. That split is load-bearing rather than
 * tidy: the last two shipped bugs on this path were invisible because the logic
 * lived somewhere `node --test` could not import, and this component decides
 * what gets WRITTEN.
 *
 * This file therefore contains presentation and event wiring only. What can be
 * verified in it is what a browser can see: that the sections render, that the
 * controls are real controls with real labels, and that the button counts what
 * will actually happen.
 */
import { useId, type JSX } from 'react'
import { Icon } from '../../../components/Icon'
import {
  acceptButtonLabel,
  acceptCount,
  choiceFor,
  sections,
  type ApprovalPreview,
  type Choices,
  type PreviewRow,
  type RowChoice,
} from './approvalCardState'

export type ApprovalCardProps = {
  /** The tool's own title, for the plain-dialog fallback ("Let him log cards?"). */
  title: string
  /** How many changes are being asked about at once. */
  count: number
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

/** "+1", "−2", "set to 5" — the operation, in the words it will happen in. */
function operationText(row: PreviewRow): string {
  if (row.mode === 'quantity') return `set to ${row.value}`
  return row.value > 0 ? `+${row.value}` : `−${Math.abs(row.value)}`
}

/** "Pitch Black · me05 #84" — enough to recognise a card without a picture. */
function cardText(row: PreviewRow): string {
  const where = [row.setId, row.number ? `#${row.number}` : null].filter(Boolean).join(' ')
  return where ? `${row.cardName} · ${where}` : row.cardName
}

/**
 * The removal control, on every row in both sections.
 *
 * "That's wrong" rather than an ✕, because an ✕ on a consent dialog reads as
 * "close this" and the thing it removes is one line of a list. It is the one
 * affordance the two sections share: section 1 has no question, but it can
 * still be WRONG, and until now the reader's only options were to approve a
 * batch they could see an error in or to refuse all of it.
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
        'pointer-events-auto shrink-0 rounded-[8px] px-[8px] py-[4px] text-[12px] leading-[16px]',
        removed
          ? 'bg-surface-secondary text-text-body'
          : 'text-text-muted hover:bg-surface-secondary hover:text-text-body',
      ].join(' ')}
    >
      {removed ? 'Put back' : "That's wrong"}
    </button>
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
  choice,
  onChoice,
}: {
  row: PreviewRow
  choice: RowChoice
  onChoice: (c: RowChoice) => void
}): JSX.Element {
  return (
    <li
      className={[
        'flex items-center gap-[8px] py-[5px]',
        choice.removed ? 'opacity-50' : '',
      ].join(' ')}
    >
      <span className="min-w-0 flex-1 truncate text-[13px] leading-[18px] text-text-body">
        <span className={choice.removed ? 'line-through' : ''}>{cardText(row)}</span>
        {row.variantLabel ? (
          <span className="text-text-muted"> · {row.variantLabel}</span>
        ) : null}
      </span>
      <span className="shrink-0 text-[12px] tabular-nums text-text-muted">
        {operationText(row)}
        {row.before !== null && row.after !== null ? ` · ${row.before} → ${row.after}` : ''}
      </span>
      <RemoveButton
        removed={choice.removed}
        label={row.cardName}
        onToggle={() => onChoice({ ...choice, removed: !choice.removed })}
      />
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
 */
function AskingRow({
  row,
  choice,
  onChoice,
}: {
  row: PreviewRow
  choice: RowChoice
  onChoice: (c: RowChoice) => void
}): JSX.Element {
  const groupId = useId()
  const answered = choice.variantId !== null
  return (
    <li className={['py-[6px]', choice.removed ? 'opacity-50' : ''].join(' ')}>
      <div className="flex items-center gap-[8px]">
        <span className="min-w-0 flex-1 truncate text-[13px] leading-[18px] text-text-body">
          <span className={choice.removed ? 'line-through' : ''}>{cardText(row)}</span>
        </span>
        <span className="shrink-0 text-[12px] tabular-nums text-text-muted">{operationText(row)}</span>
        <RemoveButton
          removed={choice.removed}
          label={row.cardName}
          onToggle={() => onChoice({ ...choice, removed: !choice.removed })}
        />
      </div>
      {choice.removed ? null : (
        <div
          role="radiogroup"
          aria-label={`Which printing of ${row.cardName}?`}
          className="mt-[4px] flex flex-wrap gap-[6px]"
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
                onClick={() => onChoice({ ...choice, variantId: selected ? null : c.variantId })}
                className={[
                  'pointer-events-auto rounded-[999px] border px-[10px] py-[3px] text-[12px] leading-[16px]',
                  selected
                    ? 'border-action-primary bg-action-primary text-action-primary-text'
                    : 'border-border-default text-text-body hover:bg-surface-secondary',
                ].join(' ')}
              >
                {c.label}
                {c.ownedQty > 0 ? (
                  <span className={selected ? '' : 'text-text-muted'}> · have {c.ownedQty}</span>
                ) : null}
              </button>
            )
          })}
        </div>
      )}
      {!choice.removed && !answered ? (
        <p className="mt-[3px] text-[11px] leading-[15px] text-text-muted">
          Not added until you pick one
          {row.wouldUseVariantId !== null
            ? ` — usually it's ${
                row.candidates.find((c) => c.variantId === row.wouldUseVariantId)?.label ?? 'the first'
              }`
            : ''}
        </p>
      ) : null}
    </li>
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
  count,
  preview,
  choices,
  onChoice,
  onAccept,
  onDeny,
  busy = false,
}: ApprovalCardProps): JSX.Element {
  const editable = preview?.editable === true
  const { known, asking } = editable && preview ? sections(preview) : { known: [], asking: [] }
  const willWrite = editable && preview ? acceptCount(preview, choices) : count

  return (
    <div
      className="decke-composer-card pointer-events-auto mx-[16px] mb-[10px] shrink-0 p-[12px]"
      role="alertdialog"
      aria-label="Deck-E is asking permission"
    >
      <p className="text-[13px] leading-[19px] text-text-body">
        {count === 1 ? `Let him ${title.toLowerCase()}?` : `Let him make ${count} changes?`}
      </p>

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
          <p className="mt-[4px] text-[12px] leading-[18px] text-text-muted">{preview.summary}</p>
        ) : null
      ) : (
        <div className="mt-[8px] flex flex-col gap-[10px]">
          {known.length > 0 ? (
            <section>
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.04em] text-text-muted">
                {known.length === 1 ? 'This card' : 'These cards'}
              </h3>
              <ul className="mt-[2px] divide-y divide-border-default/40">
                {known.map((r) => (
                  <KnownRow
                    key={r.index}
                    row={r}
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
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.04em] text-text-muted">
                {asking.length === 1
                  ? 'What was the variant on this one?'
                  : 'What was the variant on these?'}
              </h3>
              <ul className="mt-[2px] divide-y divide-border-default/40">
                {asking.map((r) => (
                  <AskingRow
                    key={r.index}
                    row={r}
                    choice={choiceFor(choices, r.index)}
                    onChoice={(c) => onChoice(r.index, c)}
                  />
                ))}
              </ul>
            </section>
          ) : null}

          {preview && preview.skipped.length > 0 ? (
            <p className="text-[11px] leading-[16px] text-text-muted">
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

        THE COUNT IS ON THE BUTTON because it is the last thing read before the
        press. It counts what will ACTUALLY be written — struck rows out,
        unpicked printings out — so it moves as the reader answers, and nobody
        can press it expecting a different number.
      */}
      <div className="mt-[10px] flex items-center gap-[8px]">
        <button
          type="button"
          onClick={onDeny}
          disabled={busy}
          className="pointer-events-auto rounded-[10px] border border-border-default px-[12px] py-[6px] text-[13px] text-text-body disabled:opacity-50"
        >
          Leave it
        </button>
        <button
          type="button"
          onClick={onAccept}
          // DISABLED ON THE SAME TICK Accept is pressed. A second press would
          // be a second batch; the idempotency key makes that a no-op rather
          // than a double write, but a control that can be pressed twice while
          // the first press is in flight is a control that will be.
          disabled={busy || willWrite === 0}
          className="pointer-events-auto rounded-[10px] bg-action-primary px-[12px] py-[6px] text-[13px] text-action-primary-text disabled:opacity-50"
        >
          {editable && preview ? acceptButtonLabel(preview, choices) : 'Go ahead'}
        </button>
        {/*
          A DISABLED BUTTON SAYING "Nothing to add" is a dead end unless it also
          says what to do about it. Both routes out are already on the card —
          put a row back, or pick a printing — so this names them rather than
          leaving the reader to work out why the only affirmative control is
          greyed.
        */}
        {editable && willWrite === 0 ? (
          <span className="flex items-center gap-[4px] text-[11px] text-text-muted">
            <Icon name="alert" size={12} />
            {asking.length > 0 ? 'Pick a printing, or leave it' : 'Put a card back, or leave it'}
          </span>
        ) : null}
      </div>
    </div>
  )
}
