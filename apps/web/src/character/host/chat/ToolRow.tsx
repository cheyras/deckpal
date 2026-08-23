/**
 * What he actually did — one row, one real invocation.
 *
 * This replaces the grey pill. The pill had four problems and this file is the
 * answer to all four:
 *
 *  (a) IT WAS NOT A CONTROL. A static `<li>` with no `onClick`, no `role`, no
 *      `tabIndex`, whose real content lived in a native `title` attribute —
 *      invisible on a phone, undiscoverable on a desktop, unreliable to a
 *      screen reader. Here the summary is a real expandable region behind a
 *      real `<button aria-expanded aria-controls>`, and a row with nothing to
 *      reveal renders no button at all rather than a control that lies.
 *
 *  (b) IT WAS LOUD AT REST. `rounded-full border bg-surface-secondary` is this
 *      app's badge language, so a finished read of the collection wore the same
 *      chrome as a thing you can press. At rest a row here is flat inline text
 *      with no border, no background and no radius — *"highlightable, but not a
 *      pill by default."* It stays selectable on purpose: he drag-selected
 *      these on camera and liked that he could.
 *
 *  (c) FAILURE IS THE DELIBERATE EXCEPTION TO (b), and it is the most important
 *      line in this file. `toolRowState.ts` holds the rule and the reasoning:
 *      a partial or failed call is tinted, ruled, explicitly labelled, opened
 *      by default, and offers a retry. Quiet is the default; quiet is never the
 *      default for a failure.
 *
 *  (d) IT FAKED SEQUENCE. Calls batch because the SDK runs them in parallel, so
 *      nothing in this component numbers, orders or sequences anything. There
 *      is no `index` prop and no stagger delay: a presentation stagger is the
 *      caller's to apply to the list, and an invented order is not available
 *      here at any price.
 *
 * X2: every string this renders is either a constant from this file or a field
 * of the real invocation (`title`, `name`, `summary`, `note`, `reason`). There
 * is no prop through which model prose could reach the screen dressed as a
 * status.
 *
 * ── STRUCTURE ────────────────────────────────────────────────────────────────
 *
 * Renders an `<li>`. It must be placed inside a `<ul>` (or `<ol>`), which is
 * both what it replaces and what gives a screen reader "list, 3 items" before
 * it starts reading them.
 */

import { useId, useState, type JSX } from 'react'
import { Icon } from '../../../components/Icon'
import { toolRowAppearance, type ToolRowData, type ToolTone } from './toolRowState'

export type { ToolPhase, ToolRowData } from './toolRowState'

/**
 * The "still going" indicator.
 *
 * A travelling ring, not a pulse, for the reason `theme.css` gives for the
 * launcher's waking ring: a pulse has a bottom of its cycle that is
 * indistinguishable from a thing that has stopped, and somebody will be looking
 * at exactly that frame.
 *
 * REDUCE: the ring stops travelling and closes into a complete static ring at
 * reduced opacity — the same trade the launcher makes. It is safe to remove the
 * motion here, and only here, because this row is not the surface responsible
 * for proving the app is alive; `ThinkingRow`'s elapsed counter is, and that
 * counter is text, not motion, so it keeps ticking under reduce.
 */
function BusyRing() {
  return (
    <span
      aria-hidden="true"
      className={[
        'mt-[5px] h-[9px] w-[9px] shrink-0 rounded-full border-2 border-current border-t-transparent',
        'motion-safe:animate-spin',
        'motion-reduce:border-t-current motion-reduce:opacity-60',
      ].join(' ')}
    />
  )
}

/**
 * Ruled and tinted, per R8's rule that a status row earns chrome only when it
 * is genuinely a different kind of thing. A failure is.
 *
 * THE TINT CAME DOWN when the state moved into a pill. Photographed, a
 * `bg-warning/10` band across 700px of a chat panel is a brown slab with one
 * short sentence in it — the row shouted the tone and then said the words
 * quietly, which is backwards. The colour now lives in the pill, where it is
 * two inches from the noun it modifies, and the row keeps a rule and a whisper
 * of tint to say "this block is different" without being the loudest thing in
 * the panel. It is still, by a distance, the loudest thing on a good turn.
 *
 * `py-[6px]` on the tinted tones only: a band needs its content off its own
 * edges, and a quiet row must stay flush with the text above and below it.
 */
/*
 * ── AND THEY ARE ROUNDED NOW, ON ALL FOUR CORNERS ────────────────────────────
 *
 * *"Let's think about the design of these errors. They just don't feel like
 * anything else in the app really. They're not like rounded."*
 *
 * He was looking at `rounded-r-[6px] border-l-2` — a flat left edge with a 2px
 * accent bar, the callout every documentation site ships. It is a perfectly good
 * pattern and it belongs to a different design system. Nothing else in DeckPal
 * has a square edge: the composer is a 14px card, the approval card is the same
 * card, `Sheet`, `Button` and every surface in `theme.css` are radiused.
 *
 * So a failure is a small CARD in the row's own tone — 10px all round, a hairline
 * border in the tone rather than a bar on one side, and the same low-alpha fill.
 * It still reads as "this block is different" (that was never in doubt; it was
 * the loudest thing on the surface) and it now reads as part of this app.
 */
const TONE_ROW: Record<ToolTone, string> = {
  quiet: 'text-text-muted',
  running: 'text-text-muted',
  declined: 'text-text-muted',
  warn: 'rounded-[10px] border border-warning/35 bg-warning/[0.07] px-[11px] py-[8px] text-text-body',
  danger: 'rounded-[10px] border border-error/35 bg-error/[0.08] px-[11px] py-[8px] text-text-body',
}

const TONE_LABEL: Record<ToolTone, string> = {
  quiet: '',
  running: '',
  declined: 'text-error',
  warn: 'text-warning',
  danger: 'text-error',
}

/**
 * The state word, as a pill.
 *
 * IT WAS A BOLD RUN-ON. `{title}{' '}{label}` rendered "Writing a strategy
 * guide **Timed out — incomplete**" with nothing between the sentence and the
 * status but a space, so the eye read one phrase and had to reparse it. The
 * label already contains an em dash of its own, which rules out adding another
 * as a separator; a pill separates by SHAPE instead and needs no punctuation at
 * all. It is also the form beautiful-ui's Task Rows use for exactly this — a
 * status pill beside the label — which is what that reference is for.
 *
 * The rule that made this a word rather than a colour is unchanged and is the
 * reason the pill carries TEXT: somebody who cannot separate the amber from the
 * red still reads "Timed out — incomplete", which is the sentence the owner
 * needed and did not get.
 */
const TONE_PILL: Record<ToolTone, string> = {
  quiet: '',
  running: '',
  // NO FILL ON A CANCELLATION. A tinted pill would give the reader's own
  // decision the same visual weight as a failure; the word and the colour are
  // enough, and the row around it stays as quiet as a success.
  declined: 'border-error/35 text-error',
  warn: 'border-warning/40 bg-warning/[0.12] text-warning',
  danger: 'border-error/40 bg-error/[0.12] text-error',
}

function StatusPill({ label, tone }: { label: string; tone: ToolTone }): JSX.Element {
  return (
    <span
      className={[
        'ml-[6px] inline-block whitespace-nowrap rounded-full border px-[7px] py-[1px]',
        'align-[1px] text-[11px] font-semibold leading-[15px]',
        TONE_PILL[tone],
      ].join(' ')}
    >
      {label}
    </span>
  )
}

export function ToolRow({
  data,
  onRetry,
}: {
  data: ToolRowData
  onRetry?: (id: string) => void
}): JSX.Element {
  const a = toolRowAppearance(data)
  const detailId = useId()
  // `null` means "the reader has not decided", so the row follows the rule.
  // Once they have decided, their choice wins — including collapsing a failure
  // they have read, which is theirs to do; what is forbidden is US collapsing
  // it for them.
  const [chosen, setChosen] = useState<boolean | null>(null)
  const open = chosen ?? a.defaultExpanded

  const title = data.title.trim() || data.name

  return (
    <li className={['flex flex-col py-[2px] text-[12px] leading-[18px]', TONE_ROW[a.tone]].join(' ')}>
      {/*
        A live region that is ALWAYS MOUNTED. A region added to the DOM at the
        same moment its content appears is frequently not announced at all, and
        the one announcement that must never be missed is the failure.
      */}
      <span className="sr-only" aria-live={a.live === 'assertive' ? 'assertive' : 'polite'} aria-atomic="true">
        {a.live === 'off' ? '' : a.announce}
      </span>

      <div className="flex items-start gap-[6px]">
        {a.busy ? (
          <BusyRing />
        ) : (
          /*
            THE GLYPH IS THE FIRST THING READ AND IT MUST NOT LIE.

            `check` for a call that ran, `alert` for one that went wrong, and
            `close` — a ✗ — for one the reader refused. The third was the
            owner's note, verbatim: *"there's a check mark here and there
            shouldn't be. That should be like a little red x — nothing was
            written, you cancelled it."*

            It was ticked because `deny` emits the row as `phase: 'ok'`, which is
            the phase for a call that SUCCEEDED. See `toolRowFromChip`, which
            bridges that until the emitter can say `declined` itself.
          */
          <Icon
            name={a.tone === 'declined' ? 'close' : a.tone === 'quiet' ? 'check' : 'alert'}
            size={13}
            className={['mt-[3px] shrink-0', TONE_LABEL[a.tone] || 'text-icon-muted'].join(' ')}
          />
        )}

        {/*
          THE CHEVRON HUGS THE TITLE. It used to sit at the end of a `flex-1`
          button, which on a 700px panel put the only affordance on the row six
          hundred pixels from the words it belongs to, with a runway of dead
          grey between them — the row looked like a sentence with a stray glyph
          moored at the far margin. Hugging costs the wide invisible hit area
          and buys a control that is visibly attached to what it opens.
        */}
        {a.expandable ? (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={detailId}
            onClick={() => setChosen(!open)}
            // Focus ring is the app-wide `:focus-visible` outline from
            // theme.css; the radius is here so it traces the row.
            className="flex min-w-0 items-start gap-[4px] rounded-sm bg-transparent text-left hover:text-text-primary"
          >
            <RowTitle title={title} label={a.label} tone={a.tone} hint={a.hint} />
            <Icon
              name={open ? 'chevron-down' : 'chevron-right'}
              size={13}
              className="mt-[3px] shrink-0 text-icon-muted"
            />
          </button>
        ) : (
          <span className="min-w-0">
            <RowTitle title={title} label={a.label} tone={a.tone} hint={a.hint} />
          </span>
        )}

        {/*
          A CONTROL, NOT A LINK. This was `font-bold underline underline-offset-2`
          — a bold underlined phrase floating on a tinted band, which is the
          default rendering of an `<a>` and reads as one: an unstyled link is the
          single most reliable tell that a surface was never looked at. It is the
          one way out of a failed call, so it gets a real bordered chip in the
          row's own tone, and `ml-auto` puts it where the eye finishes rather
          than immediately after the words.
        */}
        {a.canRetry && onRetry ? (
          <button
            type="button"
            onClick={() => onRetry(data.id)}
            aria-label={`Try ${title} again`}
            className={[
              'ml-auto shrink-0 whitespace-nowrap rounded-[7px] border px-[9px] py-[2px]',
              'text-[11.5px] font-semibold leading-[16px] motion-safe:transition-colors',
              a.tone === 'danger'
                ? 'border-error/40 text-error hover:bg-error/[0.12]'
                : 'border-warning/40 text-warning hover:bg-warning/[0.12]',
            ].join(' ')}
          >
            Try again
          </button>
        ) : null}
      </div>

      {/*
        The region exists in the DOM only when open, but `aria-controls` points
        at it either way — that is the pattern assistive tech expects for a
        disclosure, and the id is stable across renders because it comes from
        `useId`.
      */}
      {a.expandable ? (
        <div id={detailId} hidden={!open} className="pl-[19px] pt-[2px]">
          <p className="text-text-secondary">{a.detail}</p>
          <p className="font-mono text-[10px] leading-[15px] text-text-muted">{data.name}</p>
        </div>
      ) : null}
    </li>
  )
}

function RowTitle({
  title,
  label,
  tone,
  hint,
}: {
  title: string
  label: string
  tone: ToolTone
  hint?: string
}) {
  return (
    <span className="min-w-0 flex-1">
      <span className="break-words">{title}</span>
      {/*
        A FEW REAL WORDS, so three calls to the same tool are three rows and not
        a stutter. Muted and after the title, so it is legible but does not
        compete — the answer is still the answer. It is a clipped copy of what
        the expander reveals, which means there is nothing here that did not
        come out of the tool.
      */}
      {hint ? <span className="text-text-muted"> · {hint}</span> : null}
      {label ? <StatusPill label={label} tone={tone} /> : null}
    </span>
  )
}
