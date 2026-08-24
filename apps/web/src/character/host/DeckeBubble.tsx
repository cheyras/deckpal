/**
 * What he says when the chat is minimised and he is out on the page.
 *
 * One bubble, near him, and **never covering the thing he is pointing at —
 * or him**. The owner, on an earlier build that only checked the highlight:
 * *"this is like covering him up… we need to be a lot more smart about where
 * this is going."* The bug was exactly that literal: a bubble landing squarely
 * on top of his own sprite, because the solve scored candidates against the
 * highlighted element and nothing else — if there was nothing to avoid, the
 * very first candidate ("above him") won unconditionally, overlap with HIM be
 * damned. The repo's own "he is at the top of the screen" fixture reproduced
 * it: `avoid` null, and the winning rect landed fully inside his rect.
 *
 * The placement solve reads three rectangles: his own, the highlighted
 * element's, and the viewport. It scores every candidate against BOTH his rect
 * and the highlight's — a bubble may never overlap either — weighting overlap
 * with him at least as heavily as overlap with the highlight, because standing
 * on top of the character saying the words is the worse of the two failures.
 * It prefers above him, then below, then whichever side has more room,
 * clamping the winner into the viewport. If every candidate overlaps
 * something — a highlight filling the screen — it takes the one that overlaps
 * least, because some of the words visible beats none of them.
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
    // HIM COUNTS TOO. `avoid` is the thing he is pointing at; `him` is HIM —
    // and a candidate that covers his own sprite is a worse failure than one
    // that covers the highlight, because it reads as the bubble erasing the
    // character speaking it. Weighting his overlap 2x is what makes that
    // preference stick even when a `him`-clean candidate costs a little
    // highlight overlap that a `him`-covering candidate would have avoided.
    const score = 2 * overlap(r, him) + (avoid ? overlap(r, avoid) : 0)
    // Zero is zero: an early return here is also the tiebreak — candidates
    // are tried in preference order (above, below, left, right), so the
    // first fully-clear one wins over a later one that's equally clear.
    if (score === 0) return { left, top }
    if (score < bestScore) {
      bestScore = score
      best = { left, top }
    }
  }
  return best ?? { left: MARGIN, top: MARGIN }
}

/** Small pop-in/out travel distance, in px. Shared by the enter and leave
 *  beats so the bubble reads as arriving from — and retreating toward — the
 *  same direction: him. */
const POP = 8
/** Enter beat: quick and gentle, matched to `decke-chat-in`'s old duration. */
const ENTER_MS = 180
/** Leave beat: the host tears the bubble down 260ms after flipping `leaving`
 *  (see `DeckeHost.tsx`'s retire effect) — this has to finish inside that
 *  window with room to spare, not race it. */
const LEAVE_MS = 240

export function DeckeBubble({
  text,
  himRect,
  avoidSelector,
  leaving,
}: {
  /** What he is saying. Empty hides the bubble entirely. */
  text: string
  /** Where he is on screen, in viewport pixels. */
  himRect: Rect | null
  /** The element he is presenting, which must stay visible. */
  avoidSelector: string | null
  /** True for the beat between "he's done talking" and "he leaves" — the
   *  bubble animates away instead of vanishing under him. Undefined behaves
   *  like `false`; there is no third state. */
  leaving?: boolean
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  // Which way "toward him" is, from the bubble's own placement — above him,
  // below, left or right of it — so the pop-in can travel from that side
  // instead of a fixed direction that would be wrong for three of the four
  // candidates `place()` can choose. Only recomputed when the bubble is
  // (re)placed for a new line, not on every scroll/resize tick — see below.
  const [dir, setDir] = useState({ x: 0, y: 1 })
  // Plays the enter transition once per mount, the same beat
  // `decke-chat-in`'s `both` fill used to give it before this replaced it.
  const [entered, setEntered] = useState(false)

  // Measured AFTER paint but BEFORE the browser shows it: the bubble's size
  // depends on its text, and placing it needs that size. `useLayoutEffect` is
  // what keeps it from being drawn once in the wrong place and corrected.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !himRect || !text) return
    const b = el.getBoundingClientRect()
    const avoidEl = avoidSelector ? document.querySelector(avoidSelector) : null
    const avoid = avoidEl ? (avoidEl.getBoundingClientRect() as unknown as Rect) : null
    const next = place({ width: b.width, height: b.height }, himRect, avoid, window.innerWidth, window.innerHeight)
    setPos(next)
    const bubbleCx = next.left + b.width / 2
    const bubbleCy = next.top + b.height / 2
    const himCx = himRect.left + himRect.width / 2
    const himCy = himRect.top + himRect.height / 2
    const dx = himCx - bubbleCx
    const dy = himCy - bubbleCy
    setDir(Math.abs(dy) >= Math.abs(dx) ? { x: 0, y: dy > 0 ? 1 : -1 } : { x: dx > 0 ? 1 : -1, y: 0 })
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

  // Flip to the settled state a frame after the first placement, so the
  // browser has actually painted the offset/faded starting frame before the
  // transition has anything to animate FROM. A single effect can race React's
  // batching; two nested rAFs is the reliable version of "next frame, for
  // real" without reaching for a timer.
  //
  // NO ONCE-GUARD REF, and this was a bug caught on camera: StrictMode's dev
  // mount runs effect → cleanup → effect, and a ref that latched on the first
  // run survived into the second, whose early-return meant the rAF the
  // cleanup had just cancelled was never rescheduled — `entered` stayed
  // false and the bubble rendered at opacity 0, mounted and invisible, for
  // its whole life. Re-running on a later placement is harmless: `entered`
  // is already true and the extra `setEntered(true)` is a no-op. "Once per
  // mount" is the `key`'s job, not a ref's.
  useEffect(() => {
    if (!pos) return
    let raf2 = 0
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setEntered(true))
    })
    return () => {
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
    }
  }, [pos])

  if (!text) return null

  // Entering and leaving share one visual: small, faded, and shifted `dir *
  // POP` toward him — the bubble reads as emerging from him on the way in and
  // retreating into him on the way out, rather than two unrelated effects.
  const settled = { opacity: 1, transform: 'translate(0px, 0px) scale(1)' }
  const off = {
    opacity: 0,
    transform: `translate(${dir.x * POP}px, ${dir.y * POP}px) scale(0.94)`,
  }
  const anim = leaving || !entered ? off : settled

  return (
    <div
      ref={ref}
      role="status"
      aria-live="polite"
      // z-31: ABOVE the canvas (30), because a bubble behind him is not a
      // bubble. Still below modals and toasts.
      //
      // `max-h-[38vh] overflow-y-auto`: a seven-line reply once squatted over
      // the page, unread, for 63 seconds, because nothing capped its height.
      // The copy itself is a prompt-side fix owned elsewhere; this is the
      // backstop that makes a long reply scroll inside its own box instead of
      // burying whatever it was supposed to be pointing at.
      //
      // Motion is a transition, not the old `decke-chat-in` keyframe: a
      // keyframe's `transform` is a literal value that would fight the
      // per-render `dir`-based offset below (two different sources both
      // wanting to own `transform` on the same element), and it can't reverse
      // for `leaving` without a second keyframe. `motion-reduce:transition-none`
      // makes both directions instant under reduced motion — the position is
      // still correct immediately, only the travel between positions is gone.
      className={[
        // `w-max` for the same photographed reason as `DeckeFarewell`: a
        // fixed element's auto width shrink-wraps against the viewport edge
        // before the transform is applied, so near the right edge the box
        // collapsed to a one-word-per-line column. Words size the box, up to
        // the max; the placement solve then measures the truth.
        'pointer-events-none fixed z-[31] w-max max-w-[280px] max-h-[38vh] overflow-y-auto rounded-[14px]',
        'border border-border-default bg-surface-raised px-[12px] py-[8px]',
        'text-[13px] leading-[19px] text-text-primary shadow-xl',
        'motion-safe:transition-[opacity,transform] motion-safe:ease-[cubic-bezier(0.2,0.9,0.3,1)]',
        'motion-reduce:transition-none',
      ].join(' ')}
      style={{
        left: pos?.left ?? -9999,
        top: pos?.top ?? -9999,
        // Hidden until placed, so it never flashes at the measuring position.
        visibility: pos ? 'visible' : 'hidden',
        opacity: anim.opacity,
        transform: anim.transform,
        transitionDuration: `${leaving ? LEAVE_MS : ENTER_MS}ms`,
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
