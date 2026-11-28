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
//
// ── A REMOVE HITS THE ROW THE READER IS LOOKING AT (owner session 2026-11-27) ─
//
// A tap meant for the Herdier removed the Galvantula below it. Two things in
// here are half of the fix (FeedEntryCard has the other half — where the
// control is):
//
//   * THE LIST KNOWS WHEN ITS ROWS LAST MOVED UNDER THE READER. A row closing
//     up after a remove, a scan landing at the top of the bin, the header
//     wrapping, the list resizing, a scroll we started: each one stamps
//     `shiftedAt`, and a remove pressed before the rows have been still for
//     `SETTLE_MS` is not honoured — the finger was aimed at where a row USED to
//     be. That is the second tap of a quick double tap, which used to remove
//     the next row as it slid up into the first one's place.
//   * IT DOES NOT MOVE ITSELF UNDER A FINGER. The bin's follow-the-newest scroll
//     waits until the reader has let go and been idle for a second.
//
// ── AND A SWIPE STAYS IN THE LIST ───────────────────────────────────────────
//
// `overscroll-y-contain`: a swipe that runs off either end of the list no
// longer carries on into the document behind the screen — see
// lib/fixedScreen.ts for why that document scrolling cost the reader a second
// of a list that would not move.
import type { ReactNode } from 'react'
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import type { ScanMatch } from '../../lib/api'
import { Icon } from '../../components/Icon'
import { feedTotals, repeatedLabel, unresolvedCount } from './feed'
import { DURATION, EASE, prefersReducedMotion } from './motion'
import { parseSortValue, sortValue, SORT_OPTIONS, type FeedSort } from './sort'
import type { FeedEntry } from './types'
import { FeedEntryCard } from './FeedEntryCard'
import type { VoiceAction } from '../voice/actions'

/** How long the rows must have been still before a remove pressed on one is
 *  honoured. Long enough to outlast a reader's aim at a row that has just
 *  moved; short enough that nobody waiting to tap the next remove notices. */
export const SETTLE_MS = 300
/** The bin follows the newest scan only once the reader has been hands-off
 *  this long. */
const FOLLOW_IDLE_MS = 1000
/** A smooth scroll we start is still moving the rows for about this long. */
const PROGRAMMATIC_SCROLL_MS = 450

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
  voicePending,
  onVoiceCancel,
  followTop = false,
  clearFab = false,
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
  /** Omitted where the order is fixed (Step 1's bin, newest first while
   *  scanning): no control is drawn. */
  onSortChange?: (sort: FeedSort) => void
  /** Keep the top of the list in view when a row lands there (the scanning
   *  bin, newest first): the reader is looking at what they just scanned. */
  followTop?: boolean
  /** Nothing sits under this list at the bottom of the screen (no action bar),
   *  so its last row needs room to scroll clear of Deck-E's launcher. */
  clearFab?: boolean
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
  /** Spoken changes not yet applied, by row id — Step 1 only, where voice is. */
  voicePending?: ReadonlyMap<string, readonly VoiceAction[]>
  onVoiceCancel?: (actionId: string) => void
}) {
  const rowRefs = useRef(new Map<string, HTMLDivElement>())
  const scrollerRef = useRef<HTMLDivElement>(null)
  /** Each row's LAYOUT position (`offsetTop`) at the last update. */
  const prevTopRef = useRef(new Map<string, number>())
  const firstIdRef = useRef<string | null>(null)
  /** When the rows last moved under the reader (`performance.now()` time; may
   *  be in the future — the END of a slide that is still running). */
  const shiftedAtRef = useRef(-Infinity)
  /** When the reader last touched, wheeled or scrolled the list themselves. */
  const touchedAtRef = useRef(-Infinity)
  const touchingRef = useRef(false)
  /** Until when a scroll event is one we caused, not the reader. */
  const ourScrollUntilRef = useRef(-Infinity)
  const markShift = (until = performance.now()) => {
    shiftedAtRef.current = Math.max(shiftedAtRef.current, until)
  }
  /** Have the rows been still long enough for a remove to mean the row under
   *  the finger? Asked by each row at the moment a remove is pressed. */
  const rowsSettled = useCallback(() => performance.now() - shiftedAtRef.current >= SETTLE_MS, [])

  // THE READER'S HANDS, and every other thing that moves the rows. Passive
  // listeners only: nothing here may hold a touch scroll for the main thread.
  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    const touch = () => {
      touchingRef.current = true
      touchedAtRef.current = performance.now()
    }
    const release = () => {
      touchingRef.current = false
      touchedAtRef.current = performance.now()
    }
    const scrolled = () => {
      const now = performance.now()
      if (now > ourScrollUntilRef.current) touchedAtRef.current = now
      else markShift(now)
    }
    const resized = () => markShift()
    const opts = { passive: true } as const
    scroller.addEventListener('touchstart', touch, opts)
    scroller.addEventListener('pointerdown', touch, opts)
    scroller.addEventListener('wheel', touch, opts)
    scroller.addEventListener('touchend', release, opts)
    scroller.addEventListener('touchcancel', release, opts)
    scroller.addEventListener('pointerup', release, opts)
    scroller.addEventListener('pointercancel', release, opts)
    scroller.addEventListener('scroll', scrolled, opts)
    // The list changing size moves its rows when it is scrolled to the end (the
    // scroll position is clamped) — the bin opening, the iOS toolbar.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resized)
    observer?.observe(scroller)
    return () => {
      scroller.removeEventListener('touchstart', touch)
      scroller.removeEventListener('pointerdown', touch)
      scroller.removeEventListener('wheel', touch)
      scroller.removeEventListener('touchend', release)
      scroller.removeEventListener('touchcancel', release)
      scroller.removeEventListener('pointerup', release)
      scroller.removeEventListener('pointercancel', release)
      scroller.removeEventListener('scroll', scrolled)
      observer?.disconnect()
    }
  }, [])

  /** A scroll WE start (follow-the-newest, "Go back to them") moves the rows
   *  under the reader just as a slide does, and is not the reader's scrolling. */
  const scrollOurselves = (go: () => void) => {
    const until = performance.now() + PROGRAMMATIC_SCROLL_MS
    ourScrollUntilRef.current = until
    markShift(until)
    go()
  }

  // ROWS SLIDE TO WHERE THEY NOW ARE (FLIP), measured so nothing jumps.
  //
  // It used to save each row's getBoundingClientRect after starting the
  // animations, and diff the next update against that. A screen rect moves with
  // the scroll and with any transform in flight, so a scroll, the bin opening,
  // or a slide still running at the next update (a scan lands every few
  // seconds) made every row leap by that offset and then slide back. `offsetTop`
  // is the row's place in the layout: it ignores the scroll and every
  // transform. A slide still running is carried over from where it visibly is
  // rather than restarted.
  useLayoutEffect(() => {
    const reduced = prefersReducedMotion()
    const next = new Map<string, number>()
    for (const [id, el] of rowRefs.current) {
      const last = el.offsetTop
      next.set(id, last)
      const first = prevTopRef.current.get(id)
      if (first === undefined) continue
      // A row that moved is a row the reader may have been aiming at — under
      // reduced motion too, where it jumps instead of sliding.
      if (Math.abs(first - last) >= 0.5) markShift(performance.now() + (reduced ? 0 : DURATION.stackReflow))
      if (reduced) continue
      let carried = 0
      const running = el.getAnimations().filter((a) => a.id === 'flip')
      if (running.length) {
        const t = getComputedStyle(el).transform
        if (t && t !== 'none') carried = new DOMMatrixReadOnly(t).m42
        for (const a of running) a.cancel()
      }
      const dy = first - last + carried
      if (Math.abs(dy) < 0.5) continue
      const anim = el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], {
        duration: DURATION.stackReflow,
        easing: EASE.swift,
      })
      anim.id = 'flip'
    }
    prevTopRef.current = next

    // A new row at the top while the reader is at (or near) the top: keep it
    // in view. Further down they are reading something else; leave them there.
    //
    // AND NEVER UNDER A FINGER (owner session 2026-11-27, "I won't be able to
    // start scrolling"). This used to fire whenever a scan landed and the list
    // was within 160px of the top — including while the reader was dragging it,
    // so a scan landing mid-swipe smooth-scrolled the list back to the top
    // against their thumb. On WebKit, which has no scroll anchoring, that is
    // every swipe that starts near the top while scans are landing. It now
    // waits until they have let go and been idle for a second.
    const firstId = entries[0]?.id ?? null
    const scroller = scrollerRef.current
    const idle = !touchingRef.current && performance.now() - touchedAtRef.current > FOLLOW_IDLE_MS
    if (followTop && scroller && firstId && firstId !== firstIdRef.current && scroller.scrollTop > 0 && scroller.scrollTop < 160 && idle) {
      scrollOurselves(() => scroller.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' }))
    }
    firstIdRef.current = firstId
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, followTop])

  useEffect(() => {
    if (!scrollToId) return
    const row = rowRefs.current.get(scrollToId)
    if (row) scrollOurselves(() => row.scrollIntoView({ block: 'center', behavior: 'smooth' }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollToId, scrollSignal])

  // THE CHIP, COUNTING HONESTLY (feed.feedTotals). It used to read
  // `entries.length` as "unique", which was true only while a row was a card.
  // Since 2026-09-07 a row is one scan, so "unique" has to mean distinct cards
  // and be derived — otherwise a reader who scanned one card four times would be
  // told they had four unique ones.
  //
  // AND IT NAMES THE REPEAT instead of counting uniques (owner session
  // 2026-11-27, pin 7): "9 cards · 8 unique" made him stop and work out that he
  // had two Durants. "9 cards · 2× Durant" says it — `feed.repeatedLabel`.
  const totals = feedTotals(entries)
  const totalCards = totals.cards
  const repeated = repeatedLabel(totals)
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
    // `overscroll-y-contain` keeps a swipe that runs off either end in the list
    // (see the file header and lib/fixedScreen.ts).
    <div ref={scrollerRef} data-verify-feed className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-y-contain">
      {/* WRAPS. At 390 px the title, both chips, the sort control and the bin's
          expand button do not fit on one line, and the previous single
          non-wrapping row is one of the two things that was actually overflowing
          the list. `justify-end` on the control group keeps it right-aligned on
          the wide case and tidy on the wrapped one. */}
      <div className="sticky top-0 z-[5] flex flex-wrap items-center justify-between gap-x-[10px] gap-y-[6px] bg-gradient-to-b from-surface-primary to-transparent px-[14px] pb-[10px] pt-[12px] backdrop-blur-[6px]">
        <span className="shrink-0 text-[13px] font-extrabold uppercase tracking-wide text-text-primary">{title}</span>
        {/* ONE LINE WHILE IT CAN BE: the count chip truncates before this
            group wraps. A header that changes height when the count changes
            moves every row under the reader's finger — removing one of two
            Herdiers shortened the chip, the header lost a line, and the next
            remove landed 32px off. The outer row still wraps, as a last resort
            for a screen too narrow for the controls themselves. */}
        <div className="flex min-w-0 flex-1 items-center justify-end gap-[8px]">
          <span
            data-feed-count
            className="inline-flex h-[26px] min-w-0 max-w-full items-center gap-[6px] rounded-full bg-surface-tertiary px-[10px] text-[11px] font-bold text-text-body"
          >
            <span className="shrink-0">
              <b className="text-[13px] text-action-primary-strong">{totalCards}</b> card{totalCards === 1 ? '' : 's'}
            </span>
            {repeated && (
              <>
                <span className="shrink-0 text-icon-muted">·</span>
                <span className="truncate" data-feed-repeated>
                  {repeated}
                </span>
              </>
            )}
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
          {onSortChange && (
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
          )}
          {headerExtra}
        </div>
      </div>

      {entries.length === 0 ? (
        <div className="px-[14px] pb-[24px] pt-[8px] text-center text-[13px] text-text-muted">
          Point the camera at a card to start building your batch.
        </div>
      ) : (
        <div data-fab-clear={clearFab || undefined} className="flex flex-col gap-[10px] px-[14px] pb-[18px] pt-[4px]">
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
                voicePending={voicePending?.get(entry.id)}
                onVoiceCancel={onVoiceCancel}
                rowsSettled={rowsSettled}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
