// The scrollable verify feed — header with the running total, then rows.
// New entries are prepended (newest on top, mirroring the incoming stack);
// existing rows FLIP-shift to make room (prototype.html's `flipPlay`, applied
// here as a plain useLayoutEffect since every row already carries a stable
// `key={entry.id}` — the reveal of a genuinely NEW row lives in
// FeedEntryCard's own mount effect, not here, so this only ever moves rows
// that already existed).
import type { ReactNode } from 'react'
import { useEffect, useLayoutEffect, useRef } from 'react'
import type { ScanMatch } from '../../lib/api'
import { Icon } from '../../components/Icon'
import { unresolvedCount } from './feed'
import { DURATION, EASE, flipReflow } from './motion'
import type { FeedEntry } from './types'
import { FeedEntryCard } from './FeedEntryCard'

export function VerifyFeed({
  entries,
  title = 'Cards',
  headerExtra,
  onQuantityChange,
  onVariantChange,
  onCorrect,
  onRemove,
  onDiscard,
  onReport,
  onOpenDetail,
  onPickerOpenChange,
  registerThumbNode,
  scrollToId,
  scrollSignal = 0,
}: {
  entries: FeedEntry[]
  /** "Cards" in Step 1's collapsed bin, "Verify" as the Step-2 screen title —
   *  same list, framed by whichever step is showing it. */
  title?: string
  /** The bin's expand/collapse control (Step 1) — kept a caller-supplied slot
   *  so this component stays ignorant of the two-step flow above it. */
  headerExtra?: ReactNode
  onQuantityChange: (id: string, quantity: number) => void
  onVariantChange: (id: string, variantId: number) => void
  onCorrect: (id: string, match: ScanMatch) => void
  onRemove: (id: string) => void
  onDiscard?: (entry: FeedEntry) => void
  onReport: (entry: FeedEntry) => Promise<void>
  onOpenDetail: (cardId: string) => void
  onPickerOpenChange?: (id: string, open: boolean) => void
  registerThumbNode: (id: string, el: HTMLDivElement | null) => void
  /**
   * Bring one row into view — the commit gate's "Go back to them".
   *
   * The gate names the FIRST unresolved row (`feed.firstUnresolvedId`) and the
   * list is the only thing that knows where that row is on screen, so the scroll
   * belongs here rather than in a `querySelector` from the route. `scrollSignal`
   * is what makes pressing it twice work: the id has not changed, so nothing
   * else in the dependency list would.
   */
  scrollToId?: string | null
  scrollSignal?: number
}) {
  const rowRefs = useRef(new Map<string, HTMLDivElement>())
  const prevRectsRef = useRef(new Map<string, DOMRect>())

  useLayoutEffect(() => {
    const flipEntries: { el: HTMLElement; first: DOMRect }[] = []
    for (const [id, el] of rowRefs.current) {
      const first = prevRectsRef.current.get(id)
      if (first) flipEntries.push({ el, first })
    }
    flipReflow(flipEntries, DURATION.stackReflow, EASE.swift)

    const next = new Map<string, DOMRect>()
    for (const [id, el] of rowRefs.current) next.set(id, el.getBoundingClientRect())
    prevRectsRef.current = next
  }, [entries])

  useEffect(() => {
    if (!scrollToId) return
    rowRefs.current.get(scrollToId)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollToId, scrollSignal])

  const totalCards = entries.reduce((n, e) => n + e.quantity, 0)
  // The header used to be able to say "14 cards" about a list only twelve of
  // which could commit, and before 2026-09-06 that was survivable because the
  // other two were not in this list at all. They are now, so the count says how
  // many of them are still questions rather than leaving the reader to find the
  // discrepancy in the Add button.
  const needing = unresolvedCount(entries)

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="sticky top-0 z-[5] flex items-center justify-between gap-[10px] bg-gradient-to-b from-surface-primary to-transparent px-[14px] pb-[10px] pt-[12px] backdrop-blur-[6px]">
        <span className="text-[13px] font-extrabold uppercase tracking-wide text-text-primary">{title}</span>
        <div className="flex items-center gap-[8px]">
          <span className="inline-flex h-[26px] items-center gap-[8px] rounded-full bg-surface-tertiary px-[10px] text-[11px] font-bold text-text-body">
            <b className="text-[13px] text-action-primary-strong">{totalCards}</b> card{totalCards === 1 ? '' : 's'}
            <span className="text-icon-muted">·</span>
            <b className="text-[13px] text-action-primary-strong">{entries.length}</b> unique
          </span>
          {needing > 0 && (
            <span
              data-needs-input-count={needing}
              className="inline-flex h-[26px] items-center gap-[4px] rounded-full bg-warning/15 px-[10px] text-[11px] font-bold text-warning"
            >
              <Icon name="alert" size={12} /> {needing} need{needing === 1 ? 's' : ''} you
            </span>
          )}
          {headerExtra}
        </div>
      </div>

      {entries.length === 0 ? (
        <div className="px-[14px] pb-[24px] pt-[8px] text-center text-[13px] text-text-muted">
          Point the camera at a card to start building your batch.
        </div>
      ) : (
        <div className="flex flex-col gap-[10px] px-[14px] pb-[18px] pt-[4px]">
          {entries.map((entry) => (
            <div
              key={entry.id}
              ref={(el) => {
                if (el) rowRefs.current.set(entry.id, el)
                else rowRefs.current.delete(entry.id)
              }}
            >
              <FeedEntryCard
                entry={entry}
                onQuantityChange={onQuantityChange}
                onVariantChange={onVariantChange}
                onCorrect={onCorrect}
                onRemove={onRemove}
                onDiscard={onDiscard}
                onReport={onReport}
                onOpenDetail={onOpenDetail}
                onPickerOpenChange={onPickerOpenChange}
                registerThumbNode={registerThumbNode}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
