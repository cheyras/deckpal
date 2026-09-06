// "Wrong card?" (or, on a needs-attention row, "pick a match") — the top-k
// alternates popover from prototype.html's `openAlternates`: an overlay, not
// a page, positioned under the entry that opened it.
//
// TWO CALLERS SINCE 2026-09-05. `FeedEntryCard` opens it under a list row, and
// `IncomingStack` opens it beside a needs-you thumbnail that never reached the
// list — the ruling's "tappable to pick/retake". Same list, same tap, same
// meaning, so it is the same component with three optional slots (`className`
// for where it hangs, `hint` for what OCR read, `footer` for retake) rather
// than a second popover that would drift from this one.
import type { ReactNode } from 'react'
import { CardImage } from '../../components/CardImage'
import { useDismiss } from '../../components/ui/useDismiss'
import { fmtNumber } from '../../lib/format'
import type { ScanMatch } from '../../lib/api'

/** Where it hangs by default: under the row that opened it, which is what the
 *  prototype did and what every list row still wants. */
const ANCHOR_UNDER_ROW = 'absolute left-0 top-[calc(100%+6px)] z-30 w-[240px]'

export function AlternatesPopover({
  matches,
  currentCardId,
  onPick,
  onClose,
  className = ANCHOR_UNDER_ROW,
  title = 'Top matches · tap to correct',
  hint,
  footer,
}: {
  matches: ScanMatch[]
  /** The row's current identity, if it has one — rendered non-clickable at
   *  the top. A "needs attention" row (no confident match) has none, so
   *  every guess below is a live choice. */
  currentCardId: string | null
  onPick: (m: ScanMatch) => void
  onClose: () => void
  /** Positioning + width. Defaults to hanging under the row that opened it. */
  className?: string
  title?: string
  /**
   * Evidence to show above the candidates — the OCR read, as a chip.
   *
   * Above and NOT among them, deliberately. `ocrNarrow.ts`'s header rules that
   * the resolve endpoint's own matches may not be merged into this list because
   * they carry `distance: null` and this list ranks by distance. The read is the
   * part of OCR that helps here anyway: the reader is holding the card and can
   * check a printed number against it in a second.
   */
  hint?: ReactNode
  /** An action below the candidates — retake, on a stack thumbnail. */
  footer?: ReactNode
}) {
  const ref = useDismiss<HTMLDivElement>(true, onClose)

  return (
    <div
      ref={ref}
      role="menu"
      className={`${className} rounded-xl border border-border-default bg-surface-secondary p-[8px] shadow-elevated motion-safe:animate-[sheet-panel-in_180ms_cubic-bezier(0.22,0.61,0.36,1)_both]`}
    >
      <h4 className="px-[6px] pb-[6px] pt-[4px] text-[11px] font-bold uppercase tracking-wide text-text-muted">{title}</h4>
      {hint}
      {matches.map((m) => {
        const isCurrent = m.cardId === currentCardId
        return (
          <button
            key={m.cardId}
            type="button"
            role="menuitem"
            disabled={isCurrent}
            onClick={() => {
              onPick(m)
              onClose()
            }}
            className={`flex w-full items-center gap-[8px] rounded-lg p-[7px] text-left ${
              isCurrent ? 'bg-halo-neutral' : 'hover:bg-surface-tertiary'
            }`}
          >
            <div className="w-[26px] shrink-0">
              <CardImage low={m.images.low} high={m.images.high} alt="" radius={4} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12px] font-bold leading-[16px] text-text-primary">{m.name}</div>
              <div className="truncate text-[10px] text-text-muted">
                {m.setName} · {fmtNumber(m.number)}
              </div>
            </div>
            <span className="shrink-0 text-[11px] font-extrabold tabular-nums text-text-secondary">
              {Math.round(m.confidence * 100)}%
            </span>
          </button>
        )
      })}
      {footer}
    </div>
  )
}
