// The scrollable verify feed — header with the running total and the sort
// control, then rows.
//
// ── ORDER (owner ruling, 2026-09-07) ────────────────────────────────────────
//
// "Default should be first one scanned is on top, in order of scan." Entries
// arrive here ALREADY SORTED — `Scan.tsx` owns the choice and hands down both
// the ordered array and the control's current value — because the same list is
// rendered by two of these (Step 1's collapsed bin, Step 2's full screen) and a
// per-component sort state would let the two disagree about one list. The rule
// itself is `sort.ts`.
//
// Existing rows FLIP-shift when the order changes (prototype.html's `flipPlay`,
// applied here as a plain useLayoutEffect). A RE-SORT IS EXACTLY THE CASE THAT
// MUST NOT LOOK LIKE AN ARRIVAL: every row already carries a stable
// `key={entry.id}` — a capture id since 2026-09-07, so it survives being named
// as well as being moved — which means React reorders the same component
// instances and the entrance reveal in FeedEntryCard's mount effect does not
// replay. All this effect does is slide them from where they were to where they
// now are.
//
// ── NO LATERAL SCROLL (owner ruling, 2026-09-07) ────────────────────────────
//
// "We are able to scroll to the side in the verify list, which feels really bad
// on mobile." `overflow-y-auto` alone is the trap: per CSS overflow, a box with
// one axis `visible` and the other not computes the visible one to `auto`, so
// asking for a vertical scroller silently asked for a horizontal one too, and
// anything wider than the column got a sideways drag. The explicit
// `overflow-x-hidden` below closes that — but on its own it would only HIDE the
// overflow, so the two things that were actually too wide are fixed where they
// are wide: this header (which could not wrap, and now does) and the row's
// printing `<select>` (whose intrinsic width is its longest option; see
// FeedEntryCard).
import type { ReactNode } from 'react'
import { useEffect, useLayoutEffect, useRef } from 'react'
import type { ScanMatch } from '../../lib/api'
import { Icon } from '../../components/Icon'
import { feedTotals, unresolvedCount } from './feed'
import { DURATION, EASE, flipReflow } from './motion'
import { parseSortValue, sortValue, SORT_OPTIONS, type FeedSort } from './sort'
import type { FeedEntry } from './types'
import { FeedEntryCard } from './FeedEntryCard'

export function VerifyFeed({
  entries,
  title = 'Cards',
  headerExtra,
  sort,
  onSortChange,
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
  /** Already in the reader's chosen order — see the file header for why the
   *  sorting happens above this component rather than inside it. */
  entries: FeedEntry[]
  /** "Cards" in Step 1's collapsed bin, "Verify" as the Step-2 screen title —
   *  same list, framed by whichever step is showing it. */
  title?: string
  /** The bin's expand/collapse control (Step 1) — kept a caller-supplied slot
   *  so this component stays ignorant of the two-step flow above it. */
  headerExtra?: ReactNode
  sort: FeedSort
  onSortChange: (sort: FeedSort) => void
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
   * The gate names the FIRST unresolved row (`feed.firstUnresolvedId`, asked of
   * the SORTED list, so "first" is first on this screen) and the list is the
   * only thing that knows where that row is, so the scroll belongs here rather
   * than in a `querySelector` from the route. `scrollSignal` is what makes
   * pressing it twice work: the id has not changed, so nothing else in the
   * dependency list would.
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

  // THE CHIP, COUNTING HONESTLY (feed.feedTotals). It used to read
  // `entries.length` as "unique", which was true only while a row was a card.
  // Since 2026-09-07 a row is one scan, so "unique" has to mean distinct cards
  // and be derived — otherwise a reader who scanned one card four times would be
  // told they had four unique ones.
  const { cards: totalCards, unique } = feedTotals(entries)
  // The header used to be able to say "14 cards" about a list only twelve of
  // which could commit, and before 2026-09-06 that was survivable because the
  // other two were not in this list at all. They are now, so the count says how
  // many of them are still questions rather than leaving the reader to find the
  // discrepancy in the Add button.
  const needing = unresolvedCount(entries)

  return (
    // `overflow-x-hidden` is not decoration — see the file header. Without it
    // `overflow-y-auto` computes the x axis to `auto` and the list drags
    // sideways, which is the 2026-09-07 ruling's complaint verbatim.
    <div data-verify-feed className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
      {/* WRAPS. At 390 px the title, both chips, the sort control and the bin's
          expand button do not fit on one line, and the previous single
          non-wrapping row is one of the two things that was actually overflowing
          the list. `justify-end` on the control group keeps it right-aligned on
          the wide case and tidy on the wrapped one. */}
      <div className="sticky top-0 z-[5] flex flex-wrap items-center justify-between gap-x-[10px] gap-y-[6px] bg-gradient-to-b from-surface-primary to-transparent px-[14px] pb-[10px] pt-[12px] backdrop-blur-[6px]">
        <span className="shrink-0 text-[13px] font-extrabold uppercase tracking-wide text-text-primary">{title}</span>
        <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-[8px]">
          <span className="inline-flex h-[26px] shrink-0 items-center gap-[8px] rounded-full bg-surface-tertiary px-[10px] text-[11px] font-bold text-text-body">
            <b className="text-[13px] text-action-primary-strong">{totalCards}</b> card{totalCards === 1 ? '' : 's'}
            <span className="text-icon-muted">·</span>
            <b className="text-[13px] text-action-primary-strong">{unique}</b> unique
          </span>
          {needing > 0 && (
            <span
              data-needs-input-count={needing}
              className="inline-flex h-[26px] shrink-0 items-center gap-[4px] rounded-full bg-warning/15 px-[10px] text-[11px] font-bold text-warning"
            >
              <Icon name="alert" size={12} /> {needing} need{needing === 1 ? 's' : ''} you
            </span>
          )}
          {/* ONE NATIVE SELECT, four options. A native control because this is a
              phone-first screen and the platform's own picker beats a bespoke
              popover in a 26 px header; ONE of them rather than a key toggle
              beside a direction toggle because two pills cost the width the
              header does not have. `max-w-[126px]` keeps a long option label
              from setting the control's intrinsic width — the same trap the
              printing select fell into. */}
          <select
            data-feed-sort
            aria-label="Sort the list"
            value={sortValue(sort)}
            onChange={(ev) => onSortChange(parseSortValue(ev.target.value))}
            className="h-[26px] max-w-[126px] shrink-0 truncate rounded-full border border-border-default bg-surface-tertiary px-[8px] text-[11px] font-bold text-text-body"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
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
              className="min-w-0"
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
