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
//
// ── AND TWO KINDS OF CANDIDATE SINCE 2026-09-07 ────────────────────────────
//
// The owner's report, with a screenshot: a toploadered Ultra Ball landed
// needs-input, the chip above this list read `read "Ultra Ball"`, and the five
// rows under it were the phash ranking — Binding Mochi at 81 %, and not one
// Ultra Ball. "As silly as it gets."
//
// The list now carries the resolve ladder's candidates too, above the hash's,
// and the reason they were kept out before still holds: they have no Hamming
// distance, and a list ranked by distance must not contain entries that have
// none. So they are not ranked with them — they are a GROUP ABOVE, and the seam
// between the two is drawn (`SEAM_LABEL`) so the reader can see which question
// each half answers. A candidate with no distance shows no percentage at all
// rather than a 0 % it did not earn.
import type { ReactNode } from 'react'
import { CardImage } from '../../components/CardImage'
import { useDismiss } from '../../components/ui/useDismiss'
import { fmtNumber } from '../../lib/format'
import type { ScanCandidate, ScanMatch } from '../../lib/api'
import { toPickedMatch } from './identity'

/** Where it hangs by default: under the row that opened it, which is what the
 *  prototype did and what every list row still wants. */
const ANCHOR_UNDER_ROW = 'absolute left-0 top-[calc(100%+6px)] z-30 w-[240px]'

/** The seam between the two groups. Drawn only when there are two — a list that
 *  is all one kind is the list this popover always was and needs no caption. */
const SEAM_LABEL = 'Others that look similar'

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
  matches: ScanCandidate[]
  /** The row's current identity, if it has one — rendered non-clickable at
   *  the top. A "needs attention" row (no confident match) has none, so
   *  every guess below is a live choice. */
  currentCardId: string | null
  /**
   * The reader's choice, in the FEED ROW's shape.
   *
   * Converted here rather than at every call site: `toPickedMatch` translates
   * "no phash opinion" from the wire's `null` into the row's long-standing
   * `-1`/`0`, which is what `feed.resolveRow` writes and what `FeedEntryCard`
   * reads to draw provenance instead of a meter.
   */
  onPick: (m: ScanMatch) => void
  onClose: () => void
  /** Positioning + width. Defaults to hanging under the row that opened it. */
  className?: string
  title?: string
  /**
   * Evidence to show above the candidates — the OCR read, as a chip.
   *
   * Above and not among them: the read is not a candidate, it is the thing the
   * reader can check against the card in their hand in a second. The cards it
   * found are the first group below.
   */
  hint?: ReactNode
  /** An action below the candidates — retake, on a stack thumbnail. */
  footer?: ReactNode
}) {
  const ref = useDismiss<HTMLDivElement>(true, onClose)
  // The seam sits before the first candidate the read did not contribute, and
  // only when the read contributed any. `mergeCandidates` guarantees the groups
  // are contiguous and in this order, so one index is the whole of it.
  const readCount = matches.filter((m) => m.from === 'read').length
  const seamAt = readCount > 0 && readCount < matches.length ? readCount : -1

  return (
    <div
      ref={ref}
      role="menu"
      className={`${className} rounded-xl border border-border-default bg-surface-secondary p-[8px] shadow-elevated motion-safe:animate-[sheet-panel-in_180ms_cubic-bezier(0.22,0.61,0.36,1)_both]`}
    >
      <h4 className="px-[6px] pb-[6px] pt-[4px] text-[11px] font-bold uppercase tracking-wide text-text-muted">{title}</h4>
      {hint}
      {matches.map((m, i) => {
        const isCurrent = m.cardId === currentCardId
        return (
          <div key={m.cardId}>
            {i === seamAt && (
              <h5 className="mt-[6px] border-t border-divider-subtle px-[6px] pb-[4px] pt-[6px] text-[10px] font-bold uppercase tracking-wide text-text-muted">
                {SEAM_LABEL}
              </h5>
            )}
            <button
              type="button"
              role="menuitem"
              disabled={isCurrent}
              onClick={() => {
                onPick(toPickedMatch(m))
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
              {/* A percentage is a MEASUREMENT — the bit-similarity of a hash
                  that actually saw this card. A candidate the ladder found by
                  name has no such number, and printing 0 % beside it would read
                  as "certainly not this one" about the likeliest card here. */}
              {m.confidence != null && (
                <span className="shrink-0 text-[11px] font-extrabold tabular-nums text-text-secondary">
                  {Math.round(m.confidence * 100)}%
                </span>
              )}
            </button>
          </div>
        )
      })}
      {footer}
    </div>
  )
}
