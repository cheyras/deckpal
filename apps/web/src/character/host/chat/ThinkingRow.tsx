/**
 * A real thinking state, because today there is none.
 *
 * Between pressing send and the first token the transcript renders NOTHING —
 * the assistant message is inserted with `text: ''` and no bubble is drawn for
 * empty text. The owner sat through 210 seconds of that, 61 of them with the
 * panel pixel-identical. This row appears immediately and is incapable of
 * looking stalled.
 *
 * ── WHY IT CANNOT LOOK STALLED ───────────────────────────────────────────────
 *
 * Two independent signals, and the second is the load-bearing one:
 *
 *  1. A ring that TRAVELS. Not a pulse: `theme.css` rejected a pulse for the
 *     launcher's waking chip because a pulse has a bottom of its cycle that is
 *     indistinguishable from a thing that has stopped, and on a slow connection
 *     somebody is looking at exactly that frame. Same argument, same solve.
 *     Not a progress bar either, for the same reason given there — there is no
 *     total to measure against, and a bar that guesses is worse than no bar.
 *
 *  2. AN ELAPSED COUNTER, which is text. This is the one that survives
 *     `prefers-reduced-motion: reduce`. Under reduce the ring stops travelling
 *     (it closes into a static ring, as the launcher's does) and the counter
 *     keeps ticking twice a second — so a reader who asked for less motion
 *     still cannot be shown an unchanged screen, which is the actual failure
 *     being fixed. "Remove the animation" would have re-created the bug for
 *     exactly the people least able to tolerate it.
 *
 * ── WHY THE LABEL IS NOT A CYCLE ─────────────────────────────────────────────
 *
 * beautifului.dev's Thinking component cycles "Thought for 4 seconds" → "Ran 3
 * tools" → "Searched the web" on a canned 5-stage timer. That is a showcase; a
 * timer that narrates work it cannot see is a fabricated status surface, which
 * X2 forbids outright. So the shape is adapted and the mechanism is not: labels
 * arrive from the server and the newest one is shown. With no labels it says
 * `THINKING_FALLBACK_LABEL`, which claims nothing.
 *
 * Its tokens are not adopted either — `bg-field`, `text-ink` and
 * `shadow-hairline` do not exist in this app, and inventing them here would put
 * a second design system in the chat panel.
 */

import { useEffect, useId, useState, type JSX } from 'react'
import { Icon } from '../../../components/Icon'
import { ToolRow } from './ToolRow'
import type { ToolRowData } from './toolRowState'
import { describeElapsed, formatElapsed, pickThinkingLabel, shouldAutoExpandSteps } from './thinkingState'

/**
 * Twice a second.
 *
 * Fast enough that the tenths digit is visibly moving rather than stepping, slow
 * enough that a three-minute wait costs ~420 renders of one small row. The
 * reference implementation ticks at 100ms; that buys nothing a reader can see
 * and costs five times the work.
 */
const TICK_MS = 500

export function ThinkingRow({
  startedAt,
  labels,
  steps,
  onRetryStep,
}: {
  /** Epoch ms, for the elapsed counter. */
  startedAt: number
  /** Truthful status lines, newest last; may be empty. */
  labels: string[]
  /** Optional detail rows: already-happened facts, never predictions. */
  steps?: ToolRowData[]
  /**
   * ADDED TO THE AGREED PROP LIST, and optional so nothing breaks by omitting
   * it. Without it a step that FAILED inside this row gets its loud tone and its
   * explicit label but no way back — and "a distinct tone, an explicit label,
   * and a retry affordance" is one requirement, not three. Omitting it is a
   * deliberate choice to ship two thirds of that.
   */
  onRetryStep?: (id: string) => void
}): JSX.Element {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(id)
  }, [])

  const elapsed = Math.max(0, now - startedAt)
  const label = pickThinkingLabel(labels)
  const hasSteps = Boolean(steps && steps.length > 0)
  const stepsId = useId()

  // `null` = the reader has not decided, so the rule decides: collapsed, unless
  // one of the steps has failed or come back partial.
  const [chosen, setChosen] = useState<boolean | null>(null)
  const open = chosen ?? shouldAutoExpandSteps(steps)

  return (
    <div className="flex flex-col gap-[4px] text-[12px] leading-[18px] text-text-muted">
      <div className="flex items-center gap-[8px]">
        <TravellingRing />

        {hasSteps ? (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={stepsId}
            onClick={() => setChosen(!open)}
            className="flex min-w-0 items-center gap-[4px] rounded-sm bg-transparent text-left hover:text-text-primary"
          >
            <ThinkingLabel label={label} />
            <Icon name={open ? 'chevron-down' : 'chevron-right'} size={13} className="shrink-0" />
          </button>
        ) : (
          <ThinkingLabel label={label} />
        )}

        {/*
          The timer is NOT inside the live region. A polite region that changes
          twice a second is a screen reader that never stops talking; the label
          is what deserves announcing, and the duration is there to be read when
          somebody goes looking for it.

          `tabular-nums` because a proportional "1" is narrower than a "0", and a
          counter whose width breathes is its own small distraction.
        */}
        <span className="ml-auto shrink-0 font-mono tabular-nums" aria-hidden="true">
          {formatElapsed(elapsed)}
        </span>
        <span className="sr-only">{describeElapsed(elapsed)}</span>
      </div>

      {hasSteps ? (
        <ul id={stepsId} hidden={!open} className="flex flex-col gap-[2px] pl-[22px]">
          {steps?.map((s) => (
            <ToolRow key={s.id} data={s} onRetry={onRetryStep} />
          ))}
        </ul>
      ) : null}
    </div>
  )
}

/**
 * The status line, and the only live region in this component.
 *
 * `aria-atomic` so a label change is read as a whole phrase rather than as a
 * diff of two phrases.
 */
function ThinkingLabel({ label }: { label: string }) {
  return (
    <span role="status" aria-live="polite" aria-atomic="true" className="min-w-0 truncate">
      {label}
    </span>
  )
}

/**
 * See (1) and (2) in the header. Travelling under `motion-safe`, a closed
 * static ring under reduce.
 */
function TravellingRing() {
  return (
    <span
      aria-hidden="true"
      className={[
        'h-[13px] w-[13px] shrink-0 rounded-full border-2 border-action-primary border-t-transparent',
        'motion-safe:animate-spin',
        'motion-reduce:border-t-action-primary motion-reduce:opacity-60',
      ].join(' ')}
    />
  )
}
