// The incoming stack — docked on the camera view's right edge, newest capture
// on top. Ported from prototype.html's `#incoming-stack`: older thumbnails
// FLIP push down (200ms) the moment a new capture's courier launches
// (overlap, not queue), and a freshly-inserted slot gets its own entrance
// (opacity + translateX/scale), never a FLIP of its own arrival.
import { useLayoutEffect, useRef } from 'react'
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
    <div className="pointer-events-none absolute right-[8px] top-[10px] z-20 flex w-[54px] flex-col items-end gap-[8px]">
      {items.map((item) => (
        <div
          key={item.id}
          ref={(el) => {
            if (el) nodesRef.current.set(item.id, el)
            else nodesRef.current.delete(item.id)
            onNodeRef(item.id, el)
          }}
          className="relative w-[54px] shrink-0 overflow-hidden rounded-md shadow-panel ring-1 ring-surface-tertiary"
          style={{ aspectRatio: '63 / 88' }}
        >
          <img src={item.previewUrl} alt="" className="h-full w-full object-cover" />
          <div className="absolute inset-0 flex items-center justify-center bg-black/45 backdrop-blur-[1px]">
            <Spinner inline size={18} className="text-action-primary-strong" />
          </div>
        </div>
      ))}
    </div>
  )
}
