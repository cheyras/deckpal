// The incoming stack — docked on the camera view's right edge, newest capture
// on top. Ported from prototype.html's `#incoming-stack`: older thumbnails
// FLIP push down (200ms) the moment a new capture's courier launches
// (overlap, not queue), and a freshly-inserted slot gets its own entrance
// (opacity + translateX/scale), never a FLIP of its own arrival.
//
// ── WHAT THE STACK IS FOR, AFTER TWO RULINGS ────────────────────────────────
//
// It held ONE state for most of its life: waiting. Every thumbnail was dimmed
// with a spinner and left the moment `/scan` answered, whatever the answer was.
//
// 2026-09-05 gave it a second job — hold the capture until its identity settles,
// so nothing flies while the answer is still unknown — and a third that did not
// survive contact: park the FAILURES here indefinitely, amber and tappable, as
// "needs-you" thumbnails. The owner used that and ruled against it on
// 2026-09-06: "I do not like the change where ones that need my input stay in
// the side. If the resolution is 'needs your input' they should still go down to
// the list."
//
// So the stack is transient again, and it draws three states rather than one:
//
//   pending    unchanged — the dim + spinner this file always drew, and the one
//              state a thumbnail can be in without a verdict.
//   confident  a tick, held for `DURATION.confirmTick`, then Scan.tsx's courier
//              takes it to the list.
//   needs-you  THE TICK'S MIRROR — the same beat, the same duration, amber
//              instead of green — then the SAME courier, to the same list. The
//              reader sees the scanner give up in the same place and with the
//              same rhythm it says yes, and then sees where the question went.
//
// NOTHING IN HERE IS TAPPABLE, and that is back to being an invariant rather
// than an exception. The picker moved to the row (`FeedEntryCard`), which is
// where the capture now is by the time anyone can act on it, and a thumbnail
// that cannot be tapped cannot swallow a tap meant for the camera behind it.
import { useEffect, useLayoutEffect, useRef } from 'react'
import { Icon } from '../../components/Icon'
import { Spinner } from '../../components/ui'
import { DURATION, EASE, flipReflow, prefersReducedMotion } from './motion'
import type { StackItem } from './types'

export function IncomingStack({
  items,
  onNodeRef,
}: {
  items: StackItem[]
  /** Mirrors every mount/unmount into the parent's own node map, so Scan.tsx
   *  can measure a slot's rect at flight time without owning this list's
   *  render loop. */
  onNodeRef: (id: string, el: HTMLDivElement | null) => void
}) {
  const nodesRef = useRef(new Map<string, HTMLDivElement>())
  const prevRectsRef = useRef(new Map<string, DOMRect>())
  const prevIdsRef = useRef(new Set<string>())

  useLayoutEffect(() => {
    const flipEntries: { el: HTMLElement; first: DOMRect }[] = []
    for (const [id, el] of nodesRef.current) {
      const first = prevRectsRef.current.get(id)
      if (first) {
        flipEntries.push({ el, first })
      } else if (!prevIdsRef.current.has(id) && !prefersReducedMotion()) {
        // Brand-new slot this render — its own entrance, not a FLIP.
        const anim = el.animate(
          [
            { opacity: 0, transform: 'translateX(14px) scale(0.92)' },
            { opacity: 1, transform: 'none' },
          ],
          { duration: 180, easing: EASE.swift, fill: 'backwards' },
        )
        anim.finished.then(() => anim.cancel()).catch(() => {})
      }
    }
    flipReflow(flipEntries, DURATION.stackReflow, EASE.swift)

    const nextRects = new Map<string, DOMRect>()
    const nextIds = new Set<string>()
    for (const [id, el] of nodesRef.current) {
      nextRects.set(id, el.getBoundingClientRect())
      nextIds.add(id)
    }
    prevRectsRef.current = nextRects
    prevIdsRef.current = nextIds
  }, [items])

  return (
    // NO SCROLL, AND NO SCROLL CAP. Both were added for the parked needs-you
    // thumbnails of 2026-09-05: those waited for the reader, a run through a box
    // of sleeved cards could leave several, and past the cap the column had to
    // scroll to stay reachable. Nothing waits here now — every capture leaves
    // within a couple of seconds of settling — so the column is back to what it
    // was: a `pointer-events-none` strip that clips at the camera's height and
    // can never swallow a tap meant for the camera.
    <div className="pointer-events-none absolute right-[8px] top-[10px] z-20 flex max-h-[calc(100%-20px)] w-[54px] flex-col items-end gap-[8px] overflow-hidden">
      {items.map((item) => (
        <div
          key={item.id}
          ref={(el) => {
            if (el) nodesRef.current.set(item.id, el)
            else nodesRef.current.delete(item.id)
            onNodeRef(item.id, el)
          }}
          data-stack-phase={item.identity.phase}
          className={`relative w-[54px] shrink-0 overflow-hidden rounded-md shadow-panel ${
            item.identity.phase === 'needs-you'
              ? 'ring-2 ring-warning'
              : item.identity.phase === 'confident'
                ? 'ring-1 ring-change-positive'
                : 'ring-1 ring-surface-tertiary'
          }`}
          style={{ aspectRatio: '63 / 88' }}
        >
          <img src={item.previewUrl} alt="" className="h-full w-full object-cover" />
          <StackPhaseOverlay item={item} />
        </div>
      ))}
    </div>
  )
}

/**
 * The one part of a thumbnail that differs by phase.
 *
 * Its own component so the marker can be a mount effect: a settled phase is
 * entered once and lasts `DURATION.confirmTick` before the courier takes the
 * thumbnail away, so the animation belongs to the element's LIFETIME rather than
 * to a `useEffect` in the list that would have to diff phases to know when to
 * fire.
 */
function StackPhaseOverlay({ item }: { item: StackItem }) {
  const markRef = useRef<HTMLDivElement>(null)
  const phase = item.identity.phase

  useEffect(() => {
    const el = markRef.current
    if (!el || prefersReducedMotion()) return
    // Transform + opacity only, WAAPI, per motion.ts's hard rule. A scale-in
    // with the snap easing — the same overshoot the quad uses when it locks, so
    // "the scanner decided" reads the same in both places. BOTH verdicts get it:
    // giving up is a decision too, and the reader is about to watch the
    // thumbnail fly on it.
    const anim = el.animate(
      [
        { opacity: 0, transform: 'scale(0.4)' },
        { opacity: 1, transform: 'scale(1)' },
      ],
      { duration: 160, easing: EASE.snap, fill: 'backwards' },
    )
    anim.finished.then(() => anim.cancel()).catch(() => {})
  }, [])

  if (phase === 'pending') {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-black/45 backdrop-blur-[1px]">
        <Spinner inline size={18} className="text-action-primary-strong" />
      </div>
    )
  }

  if (phase === 'confident') {
    return (
      <div ref={markRef} className="absolute inset-0 flex items-center justify-center bg-change-positive/75">
        <Icon name="check" size={22} strokeWidth={3} className="text-surface-primary" />
      </div>
    )
  }

  // needs-you — the mirror. Same wash, same beat, amber, and an alert glyph
  // where the tick goes. It is a departure notice, not a question: the question
  // is asked on the row this thumbnail is about to become, so there is nothing
  // here to tap and nothing to read beyond "this one is going down marked".
  return (
    <div ref={markRef} className="absolute inset-0 flex items-center justify-center bg-warning/75">
      <Icon name="alert" size={20} strokeWidth={3} className="text-surface-primary" />
    </div>
  )
}
