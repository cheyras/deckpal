// The incoming stack — docked on the camera view's right edge, newest capture
// on top. Ported from prototype.html's `#incoming-stack`: older thumbnails
// FLIP push down (200ms) the moment a new capture's courier launches
// (overlap, not queue), and a freshly-inserted slot gets its own entrance
// (opacity + translateX/scale), never a FLIP of its own arrival.
//
// ── WHAT CHANGED ON 2026-09-05, AND WHY IT IS HERE AND NOT IN THE ROUTE ─────
//
// The stack used to hold one state: waiting. Every thumbnail was dimmed with a
// spinner over it and it left the moment `/scan` answered, whatever the answer
// was. Under the flow ruling it holds three (`identity.ts`):
//
//   pending    unchanged — the dim + spinner this file always drew.
//   confident  a tick, held for `DURATION.confirmTick`, then Scan.tsx's courier
//              takes it to the list. The reader sees the decision happen.
//   needs-you  it stays. Amber, undimmed (the reader is being asked to look at
//              the picture, so covering it with a scrim would be perverse), and
//              tappable — the ruling's "tappable to pick/retake".
//
// The picker is rendered by this file rather than by the thumbnail, as a sibling
// pinned to the camera box's own right edge. A dropdown hanging off a 54 px
// thumbnail would be clipped by the camera view's `overflow-hidden` the moment
// the stack held more than one card, and the reader would be tapping a card they
// cannot see the options for.
import { useEffect, useLayoutEffect, useRef } from 'react'
import { Icon } from '../../components/Icon'
import { Spinner } from '../../components/ui'
import type { ScanMatch } from '../../lib/api'
import { AlternatesPopover } from './AlternatesPopover'
import { ocrHintLabel } from './identity'
import { DURATION, EASE, flipReflow, prefersReducedMotion } from './motion'
import type { StackItem } from './types'

export function IncomingStack({
  items,
  picking,
  onNodeRef,
  onNeedsYou,
  onPick,
  onRetake,
  onClosePicker,
}: {
  items: StackItem[]
  /** Which thumbnail has the picker open, if any. Owned by the route, because
   *  the route also has to stop late answers overruling the reader while it is
   *  open (`identity.ts`'s `engaged`). */
  picking: string | null
  /** Mirrors every mount/unmount into the parent's own node map, so Scan.tsx
   *  can measure a slot's rect at flight time without owning this list's
   *  render loop. */
  onNodeRef: (id: string, el: HTMLDivElement | null) => void
  onNeedsYou: (id: string) => void
  onPick: (id: string, match: ScanMatch) => void
  onRetake: (id: string) => void
  onClosePicker: () => void
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

  const open = picking ? items.find((i) => i.id === picking) : undefined
  const hintLabel = open ? ocrHintLabel(open.identity.read) : null

  return (
    <>
      {/* THE COLUMN IS CAPPED NOW THAT THUMBNAILS PERSIST. A pending capture
          cleared itself in a second or two, so four of them never fitted at
          once; a needs-you capture waits for the reader, and a run through a
          box of sleeved cards can leave several. Past the cap it scrolls —
          reachable because a touch that starts on a needs-you thumbnail (the
          only `pointer-events-auto` thing in here) scrolls its ancestor, which
          is exactly the case that can fill the column. The column itself stays
          `pointer-events-none` so a stack of captures can never swallow a tap
          meant for the camera. */}
      <div className="pointer-events-none absolute right-[8px] top-[10px] z-20 flex max-h-[calc(100%-20px)] w-[54px] flex-col items-end gap-[8px] overflow-y-auto overscroll-contain">
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
            <StackPhaseOverlay item={item} onNeedsYou={onNeedsYou} />
          </div>
        ))}
      </div>

      {open && (
        <AlternatesPopover
          matches={open.identity.candidates}
          currentCardId={null}
          onPick={(m) => onPick(open.id, m)}
          onClose={onClosePicker}
          // Pinned to the camera box, not hung off the 54 px thumbnail — see the
          // file header. `max-h` + its own scroll so a full top-5 plus a hint and
          // a retake never runs off the bottom of a short camera box.
          className="pointer-events-auto absolute right-[70px] top-[10px] z-30 max-h-[calc(100%-20px)] w-[218px] overflow-y-auto"
          title="Which card is this?"
          hint={
            hintLabel ? (
              <div className="mx-[6px] mb-[6px] inline-flex items-center gap-[5px] rounded-full bg-surface-tertiary px-[8px] py-[3px] text-[11px] font-semibold text-text-secondary">
                <Icon name="search" size={11} /> {hintLabel}
              </div>
            ) : null
          }
          footer={
            <div className="mt-[4px] border-t border-divider-subtle pt-[6px]">
              <button
                type="button"
                onClick={() => onRetake(open.id)}
                className="flex w-full items-center justify-center gap-[6px] rounded-lg p-[7px] text-[12px] font-semibold text-text-muted hover:bg-surface-tertiary hover:text-text-primary"
              >
                <Icon name="close" size={12} /> Discard and retake
              </button>
            </div>
          }
        />
      )}
    </>
  )
}

/**
 * The one part of a thumbnail that differs by phase.
 *
 * Its own component so the tick can be a mount effect: `confident` is entered
 * once and lasts `DURATION.confirmTick` before the courier takes the thumbnail
 * away, so the animation belongs to the element's LIFETIME rather than to a
 * `useEffect` in the list that would have to diff phases to know when to fire.
 */
function StackPhaseOverlay({ item, onNeedsYou }: { item: StackItem; onNeedsYou: (id: string) => void }) {
  const tickRef = useRef<HTMLDivElement>(null)
  const phase = item.identity.phase

  useEffect(() => {
    const el = tickRef.current
    if (!el || prefersReducedMotion()) return
    // Transform + opacity only, WAAPI, per motion.ts's hard rule. A scale-in
    // with the snap easing — the same overshoot the quad uses when it locks, so
    // "the scanner decided" reads the same in both places.
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
      <div ref={tickRef} className="absolute inset-0 flex items-center justify-center bg-change-positive/75">
        <Icon name="check" size={22} strokeWidth={3} className="text-surface-primary" />
      </div>
    )
  }

  // needs-you. NO SCRIM: the reader is being asked to look at the capture, so
  // the capture stays legible and only the badge and the ring say what is being
  // asked. `pointer-events-auto` against the column's `pointer-events-none` —
  // this is the only thing in the stack that has ever been tappable.
  return (
    <button
      type="button"
      onClick={() => onNeedsYou(item.id)}
      aria-label="Pick a match for this capture, or retake it"
      className="pointer-events-auto absolute inset-0 flex items-end justify-center bg-gradient-to-t from-black/70 to-transparent pb-[4px]"
    >
      <span className="inline-flex items-center gap-[3px] rounded-full bg-warning px-[5px] py-[2px] text-[9px] font-extrabold uppercase tracking-wide text-surface-primary">
        <Icon name="alert" size={9} /> you
      </span>
    </button>
  )
}
