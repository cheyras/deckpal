/**
 * What he says when the chat is minimised and he is out on the page.
 *
 * One bubble, near him, and **never covering the thing he is pointing at** —
 * which is the whole constraint, because a speech bubble that hides the element
 * it is describing defeats the entire travel feature.
 *
 * The placement solve reads three rectangles: his own, the highlighted
 * element's, and the viewport. It prefers above him, then below, then whichever
 * side has more room, rejecting any candidate that overlaps the highlight, and
 * clamping the winner into the viewport. If every candidate overlaps — a
 * highlight filling the screen — it takes the one that overlaps least, because
 * some of the words visible beats none of them.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ChatMarkdown } from './chat/ChatMarkdown'

export type Rect = { left: number; top: number; right: number; bottom: number; width: number; height: number }

const GAP = 14
const MARGIN = 8

function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left)
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
  return w > 0 && h > 0 ? w * h : 0
}

export function place(
  bubble: { width: number; height: number },
  him: Rect,
  avoid: Rect | null,
  vw: number,
  vh: number,
): { left: number; top: number } {
  const cx = him.left + him.width / 2
  // Order IS the preference. Above first: it is where a speech bubble belongs,
  // and it is furthest from the element he is usually standing beside.
  const candidates = [
    { left: cx - bubble.width / 2, top: him.top - bubble.height - GAP },
    { left: cx - bubble.width / 2, top: him.bottom + GAP },
    { left: him.left - bubble.width - GAP, top: him.top + him.height / 2 - bubble.height / 2 },
    { left: him.right + GAP, top: him.top + him.height / 2 - bubble.height / 2 },
  ]

  let best: { left: number; top: number } | null = null
  let bestScore = Infinity
  for (const c of candidates) {
    const left = Math.max(MARGIN, Math.min(vw - bubble.width - MARGIN, c.left))
    const top = Math.max(MARGIN, Math.min(vh - bubble.height - MARGIN, c.top))
    const r: Rect = {
      left, top,
      right: left + bubble.width,
      bottom: top + bubble.height,
      width: bubble.width,
      height: bubble.height,
    }
    const score = avoid ? overlap(r, avoid) : 0
    if (score === 0) return { left, top }
    if (score < bestScore) {
      bestScore = score
      best = { left, top }
    }
  }
  return best ?? { left: MARGIN, top: MARGIN }
}

export function DeckeBubble({
  text,
  himRect,
  avoidSelector,
}: {
  /** What he is saying. Empty hides the bubble entirely. */
  text: string
  /** Where he is on screen, in viewport pixels. */
  himRect: Rect | null
  /** The element he is presenting, which must stay visible. */
  avoidSelector: string | null
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  // Measured AFTER paint but BEFORE the browser shows it: the bubble's size
  // depends on its text, and placing it needs that size. `useLayoutEffect` is
  // what keeps it from being drawn once in the wrong place and corrected.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !himRect || !text) return
    const b = el.getBoundingClientRect()
    const avoidEl = avoidSelector ? document.querySelector(avoidSelector) : null
    const avoid = avoidEl ? (avoidEl.getBoundingClientRect() as unknown as Rect) : null
    setPos(place({ width: b.width, height: b.height }, himRect, avoid, window.innerWidth, window.innerHeight))
  }, [text, himRect, avoidSelector])

  // Re-place on scroll and resize. He is pinned to the page while presenting, so
  // both move him and the element he is beside.
  useEffect(() => {
    if (!text) return
    const on = () => setPos((p) => (p ? { ...p } : p))
    window.addEventListener('scroll', on, { passive: true })
    window.addEventListener('resize', on)
    return () => {
      window.removeEventListener('scroll', on)
      window.removeEventListener('resize', on)
    }
  }, [text])

  if (!text) return null

  return (
    <div
      ref={ref}
      role="status"
      aria-live="polite"
      // z-31: ABOVE the canvas (30), because a bubble behind him is not a
      // bubble. Still below modals and toasts.
      className={[
        'pointer-events-none fixed z-[31] max-w-[280px] rounded-[14px]',
        'border border-border-default bg-surface-raised px-[12px] py-[8px]',
        'text-[13px] leading-[19px] text-text-primary shadow-xl',
        'motion-safe:animate-[decke-chat-in_200ms_cubic-bezier(0.2,0.9,0.3,1)_both]',
      ].join(' ')}
      style={{
        left: pos?.left ?? -9999,
        top: pos?.top ?? -9999,
        // Hidden until placed, so it never flashes at the measuring position.
        visibility: pos ? 'visible' : 'hidden',
      }}
    >
      {/*
        MARKDOWN HERE TOO, and this is the half that gets forgotten.

        The transcript rendered `{m.text}` raw and so did this, and only the
        transcript was in the original complaint — because this surface is only
        used while he is out on the page, which the owner saw less of. That is
        about to invert: the wayfinding work routes MORE text through the
        bubble, not less, since a character escorting someone across the app
        says what he is doing from beside the thing he is pointing at.

        `tone="bubble"` is the tight treatment. A bubble is two sentences over a
        live page, not a document: no heading larger than the body, no big
        margins, and tables stay literal rather than trying to lay out a grid in
        280 pixels.
      */}
      <ChatMarkdown text={text} tone="bubble" />
    </div>
  )
}
