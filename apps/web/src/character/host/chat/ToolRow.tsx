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

const TONE_ROW: Record<ToolTone, string> = {
  quiet: 'text-text-muted',
  running: 'text-text-muted',
  // Ruled and tinted, per R8's rule that a status row earns chrome only when it
  // is genuinely a different kind of thing. A failure is.
  warn: 'rounded-r-md border-l-2 border-warning bg-warning/10 pl-[8px] pr-[8px] text-text-body',
  danger: 'rounded-r-md border-l-2 border-error bg-halo-error pl-[8px] pr-[8px] text-text-body',
}

const TONE_LABEL: Record<ToolTone, string> = {
  quiet: '',
  running: '',
  warn: 'text-warning',
  danger: 'text-error',
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
          <Icon
            name={a.tone === 'quiet' ? 'check' : 'alert'}
            size={13}
            className={['mt-[3px] shrink-0', TONE_LABEL[a.tone] || 'text-icon-muted'].join(' ')}
          />
        )}

        {a.expandable ? (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={detailId}
            onClick={() => setChosen(!open)}
            // Focus ring is the app-wide `:focus-visible` outline from
            // theme.css; the radius is here so it traces the row.
            className="flex min-w-0 flex-1 items-start gap-[4px] rounded-sm bg-transparent text-left hover:text-text-primary"
          >
            <RowTitle title={title} label={a.label} tone={a.tone} hint={a.hint} />
            <Icon name={open ? 'chevron-down' : 'chevron-right'} size={13} className="mt-[3px] shrink-0" />
          </button>
        ) : (
          <span className="min-w-0 flex-1">
            <RowTitle title={title} label={a.label} tone={a.tone} hint={a.hint} />
          </span>
        )}

        {a.canRetry && onRetry ? (
          <button
            type="button"
            onClick={() => onRetry(data.id)}
            aria-label={`Try ${title} again`}
            className="shrink-0 rounded-sm px-[4px] font-bold underline underline-offset-2 hover:text-text-primary"
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
      {label ? (
        <>
          {' '}
          {/*
            The state is a WORD, not a colour. Someone who cannot separate the
            amber from the red still reads "Timed out — incomplete", which is
            the sentence the owner needed and did not get.
          */}
          <span className={['font-bold', TONE_LABEL[tone]].join(' ')}>{label}</span>
        </>
      ) : null}
    </span>
  )
}
