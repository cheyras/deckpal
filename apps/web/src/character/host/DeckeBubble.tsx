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
import { highlighted } from '../../components/ui/elementHighlight'
import { ChatMarkdown } from './chat/ChatMarkdown'

export type Rect = { left: number; top: number; right: number; bottom: number; width: number; height: number }

const GAP = 14
const MARGIN = 8
/** Clear of the app header, and of the minimised chat bar, for the docked slots. */
const DOCK_TOP = 72
const DOCK_BOTTOM = 88

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
  // Order IS the preference (see `SIDES`): above first, where a speech bubble
  // belongs and furthest from what he usually stands beside; the screen-docked
  // slots last. HIM COUNTS TOO, double: a bubble covering the character saying
  // the words reads as the bubble erasing him. A target covering everything
  // still gets the least-bad slot, because some of the words beat none.
  return slot(chooseSide(bubble, him, avoid, vw, vh), bubble, him, vw, vh, avoid)
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
/** How long a change of side takes. Eased, never a jump. */
const SWITCH_MS = 260
/** The soonest a side may change again after it last changed. */
const SWITCH_COOLDOWN_MS = 700
/** The size a side is chosen for: a typical two-line remark. See `pick`. */
const PLAN_W = 240
const PLAN_H = 56
/** How much of the bubble's own area may overlap before its side is blocked. */
const BLOCKED_SHARE = 0.12

/** Where the bubble sits relative to him. The order is `place`'s preference. */
export type BubbleSide = 'above' | 'below' | 'left' | 'right' | 'over' | 'under' | 'dock-bottom' | 'dock-top'
const SIDES: BubbleSide[] = ['above', 'below', 'left', 'right', 'over', 'under', 'dock-bottom', 'dock-top']

/** A bubble's top-left for a side, clamped into the viewport. Exported for tests. */
export function slot(
  side: BubbleSide,
  bubble: { width: number; height: number },
  him: Rect,
  vw: number,
  vh: number,
  avoid: Rect | null = null,
): { left: number; top: number } {
  const cx = him.left + him.width / 2
  const cy = him.top + him.height / 2
  // `over` and `under` are a caption's places: just above or below the thing he
  // is showing, still centred on him. On a phone he stands in the gutter
  // between two cards and every slot beside him lands on one of them; these
  // keep the line next to him without covering what he is pointing at.
  const shown = avoid ?? him
  const raw =
    side === 'above' ? { left: cx - bubble.width / 2, top: him.top - bubble.height - GAP }
    : side === 'below' ? { left: cx - bubble.width / 2, top: him.bottom + GAP }
    : side === 'over' ? { left: cx - bubble.width / 2, top: Math.min(him.top, shown.top) - bubble.height - GAP }
    : side === 'under' ? { left: cx - bubble.width / 2, top: Math.max(him.bottom, shown.bottom) + GAP }
    : side === 'left' ? { left: him.left - bubble.width - GAP, top: cy - bubble.height / 2 }
    : side === 'right' ? { left: him.right + GAP, top: cy - bubble.height / 2 }
    : side === 'dock-bottom' ? { left: vw / 2 - bubble.width / 2, top: vh - bubble.height - DOCK_BOTTOM }
    : { left: vw / 2 - bubble.width / 2, top: DOCK_TOP }
  return {
    left: Math.max(MARGIN, Math.min(vw - bubble.width - MARGIN, raw.left)),
    top: Math.max(MARGIN, Math.min(vh - bubble.height - MARGIN, raw.top)),
  }
}

/** How much a bubble at `at` covers what must stay visible. 0 is clear. */
function cost(at: { left: number; top: number }, bubble: { width: number; height: number }, him: Rect, avoid: Rect | null) {
  const r: Rect = { left: at.left, top: at.top, right: at.left + bubble.width, bottom: at.top + bubble.height, width: bubble.width, height: bubble.height }
  return 2 * overlap(r, him) + (avoid ? overlap(r, avoid) : 0)
}

/**
 * The side `place` would choose. Exported for tests.
 *
 * With `near` — where the bubble is drawn now — the choice among clear slots is
 * the one it has least far to travel to, not the first in preference order:
 * a bubble already on screen that has to move should move as little as it can.
 */
export function chooseSide(
  bubble: { width: number; height: number },
  him: Rect,
  avoid: Rect | null,
  vw: number,
  vh: number,
  near: { left: number; top: number } | null = null,
): BubbleSide {
  let best: BubbleSide = SIDES[0]
  let bestScore = Infinity
  let nearest: BubbleSide | null = null
  let nearestD = Infinity
  for (const side of SIDES) {
    const at = slot(side, bubble, him, vw, vh, avoid)
    const score = cost(at, bubble, him, avoid)
    if (score === 0) {
      if (!near) return side
      const d = Math.hypot(at.left - near.left, at.top - near.top)
      if (d < nearestD) {
        nearestD = d
        nearest = side
      }
    }
    if (score < bestScore) {
      bestScore = score
      best = side
    }
  }
  return nearest ?? best
}

// In-out, not out: a switch that starts at full speed reads as a jump.
function reducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

/**
 * His line while he is out on the page, riding him.
 *
 * ── WHAT THE OWNER SAW, AND WHY IT HAPPENED ──────────────────────────────────
 *
 * "His speech bubble overall doesn't follow him in an acceptable manner. It's
 * choppy and it often changes position in ways that don't feel deliberate."
 * And on a phone: "it's still saying 'let me show you' when he arrives at the
 * card, and then when it updates, it moves down the page." Three mechanisms:
 *
 *   - it was placed from his position POLLED at 8 Hz through React state, so
 *     it moved in 125 ms steps behind a character drawn at 60;
 *   - every one of those polls re-ran the whole placement solve, so it could
 *     change sides at any moment, mid-flight, for a pixel of difference;
 *   - it showed the turn's WHOLE reply, so the arrival line was appended to the
 *     departure line, the box grew, and the grown box was re-solved somewhere
 *     else on the page.
 *
 * ── WHAT IT DOES NOW ─────────────────────────────────────────────────────────
 *
 *   - It follows him from `DeckE.onFrame`: the frame he is drawn in is the
 *     frame it moves in, written as a transform, with no React render.
 *   - Its SIDE is chosen at deliberate beats only — when it appears, and when
 *     he lands — plus when the side it is on would cover him or the thing he is
 *     showing, at most once per `SWITCH_COOLDOWN_MS`. A change of side is eased
 *     over `SWITCH_MS`, never a jump.
 *   - Its size is measured by a ResizeObserver, whose callback runs after
 *     layout and before paint, and the slot is re-applied there — so new text
 *     grows the box AWAY from him, from the edge that faces him, in the same
 *     frame, instead of moving it. The host now hands it only the line he is
 *     saying NOW (see `currentLine` in `DeckeHost.tsx`).
 */
export function DeckeBubble({
  text,
  follow,
  leaving,
  waiting,
}: {
  /** What he is saying. Empty hides the bubble unless `waiting`. */
  text: string
  /** The character to ride — his viewport box, and his frame clock. */
  follow: {
    viewportRect: () => Rect | null
    onFrame: (fn: () => void) => () => void
    getState: () => { flying: boolean }
    /** His clock, so an eased change of side runs at his pace, not the wall's. */
    clockMs: () => number
  } | null
  /** True for the beat between "he's done talking" and "he leaves" — the
   *  bubble animates away instead of vanishing under him. */
  leaving?: boolean
  /** He has arrived and his next line is on its way: show that, in place. */
  waiting?: boolean
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const shown = !!text || !!waiting
  // Which way "toward him" is, for the pop-in and pop-out: set from the side.
  const [side, setSide] = useState<BubbleSide | null>(null)
  const [entered, setEntered] = useState(false)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !follow || !shown) return
    let size = { width: el.offsetWidth, height: el.offsetHeight }
    let current: BubbleSide | null = null
    let switchedAt = -Infinity
    let from: { left: number; top: number } | null = null
    let blendStart = 0
    let wasFlying = follow.getState().flying
    let last: { left: number; top: number } | null = null
    const written = { transform: '', side: '', switching: false, visible: false }

    const avoidRect = (): Rect | null => {
      const a = highlighted()
      return a ? (a.getBoundingClientRect() as unknown as Rect) : null
    }
    // CHOSEN FOR THE LINE IT WILL HOLD, not the one it holds now. At a beat the
    // box is often three dots or half a sentence; a side chosen for that size
    // is blocked a moment later by the full line and the bubble moves again —
    // on a phone it went right, then below, then docked, inside a second.
    const pick = (him: Rect, near: { left: number; top: number } | null) =>
      chooseSide(
        { width: Math.max(size.width, PLAN_W), height: Math.max(size.height, PLAN_H) },
        him,
        avoidRect(),
        window.innerWidth,
        window.innerHeight,
        near,
      )

    const apply = () => {
      const him = follow.viewportRect()
      if (!him || him.height < 1) return
      const vw = window.innerWidth
      const vh = window.innerHeight
      const now = follow.clockMs()
      const flying = follow.getState().flying
      if (!current) {
        current = pick(him, null)
        setSide(current)
      } else {
        // THE BEATS: he has just landed, or where it sits now covers what it
        // must not. Never simply because a different side scores a pixel
        // better mid-flight.
        const landed = wasFlying && !flying
        // Blocked means covering a real share of him or of what he is showing,
        // not grazing a corner: a sliver is not worth a move the reader sees.
        const avoid = avoidRect()
        const blocked = cost(slot(current, size, him, vw, vh, avoid), size, him, avoid) > size.width * size.height * BLOCKED_SHARE
        if ((landed || blocked) && now - switchedAt > SWITCH_COOLDOWN_MS) {
          const next = pick(him, last)
          if (next !== current) {
            // Under reduced motion the new side is simply taken; the fade is
            // the only change the reader sees.
            from = reducedMotion() ? null : last
            blendStart = now
            switchedAt = now
            current = next
            setSide(next)
          }
        }
      }
      wasFlying = flying
      let at = slot(current, size, him, vw, vh, avoidRect())
      if (from) {
        const t = Math.min(1, (now - blendStart) / SWITCH_MS)
        const e = easeInOut(t)
        at = { left: from.left + (at.left - from.left) * e, top: from.top + (at.top - from.top) * e }
        if (t >= 1) from = null
      }
      last = at
      // Only what changed is written: this runs every frame he is drawn, and an
      // attribute rewritten to the same value still invalidates style.
      const transform = `translate3d(${Math.round(at.left)}px, ${Math.round(at.top)}px, 0)`
      if (transform !== written.transform) el.style.transform = written.transform = transform
      if (current !== written.side) el.dataset.side = written.side = current
      // Said out loud for anything measuring it: while set, the bubble is
      // making a deliberate eased move of its own, not riding him.
      const switching = !!from
      if (switching !== written.switching) {
        written.switching = switching
        if (switching) el.dataset.switching = ''
        else delete el.dataset.switching
      }
      if (!written.visible) {
        written.visible = true
        el.style.visibility = 'visible'
      }
    }

    // New text resizes the box; re-apply before that frame paints, so the edge
    // facing him stays where it was.
    const ro = new ResizeObserver(() => {
      size = { width: el.offsetWidth, height: el.offsetHeight }
      apply()
    })
    ro.observe(el)
    const off = follow.onFrame(apply)
    apply()
    return () => {
      off()
      ro.disconnect()
    }
  }, [follow, shown])

  // Flip to the settled state a frame after the first placement, so the
  // browser has painted the offset/faded starting frame before the transition
  // has anything to animate FROM. Re-running is harmless; "once per mount" is
  // the `key`'s job, not a ref's (a latched ref broke this under StrictMode).
  useEffect(() => {
    if (!side) return
    let raf2 = 0
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setEntered(true))
    })
    return () => {
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
    }
  }, [side])

  if (!shown) return null

  const dir =
    side === 'below' || side === 'under' || side === 'dock-top' ? { x: 0, y: -1 }
    : side === 'left' ? { x: 1, y: 0 }
    : side === 'right' ? { x: -1, y: 0 }
    : { x: 0, y: 1 }
  // Entering and leaving share one visual: small, faded, and shifted toward
  // him, on an INNER element — the outer one's transform is his position, and
  // two writers of one `transform` is how the old keyframe fought the offset.
  const settled = { opacity: 1, transform: 'translate(0px, 0px) scale(1)' }
  const offState = { opacity: 0, transform: `translate(${dir.x * POP}px, ${dir.y * POP}px) scale(0.94)` }
  const anim = leaving || !entered ? offState : settled

  return (
    <div
      data-decke-ui
      data-decke-bubble
      ref={ref}
      role="status"
      aria-live="polite"
      // Positioned by transform from `apply`, never by left/top, so following
      // him is a compositor move. Hidden until the first placement so it never
      // flashes at the corner.
      className="pointer-events-none fixed left-0 top-0 z-[31]"
      style={{ visibility: 'hidden', willChange: 'transform' }}
    >
      <div
        // z-31 on the outer: ABOVE the canvas (30), because a bubble behind
        // him is not a bubble. Still below modals and toasts.
        //
        // `max-h-[38vh] overflow-y-auto`: a seven-line reply once squatted over
        // the page, unread, for 63 seconds, because nothing capped its height.
        //
        // REDUCED MOTION KEEPS THE FADE AND DROPS THE TRAVEL (issue #49's
        // lesson): opacity still transitions, and `transform` goes at the
        // source — theme.css neutralises `--decke-speech-pop` under `reduce`.
        //
        // `w-max` so words size the box, up to the max; the slot is solved from
        // the measured truth.
        className={[
          'w-max max-w-[280px] max-h-[38vh] overflow-y-auto rounded-[14px]',
          'border border-border-default bg-surface-raised px-[12px] py-[8px]',
          'text-[13px] leading-[19px] text-text-primary shadow-xl',
          'decke-speech-pop',
          'motion-safe:transition-[opacity,transform] motion-safe:ease-[cubic-bezier(0.2,0.9,0.3,1)]',
          'motion-reduce:transition-[opacity] motion-reduce:ease-out',
        ].join(' ')}
        style={{
          opacity: anim.opacity,
          '--decke-speech-pop': anim.transform,
          transitionDuration: `${leaving ? LEAVE_MS : ENTER_MS}ms`,
        } as React.CSSProperties}
      >
        {text ? (
          // MARKDOWN HERE TOO: the transcript and the bubble render the same
          // words the same way. `tone="bubble"` is the tight treatment — two
          // sentences over a live page, not a document.
          <ChatMarkdown text={text} tone="bubble" />
        ) : (
          <span className="decke-bubble-dots" aria-label="Deck-E is typing">
            <span />
            <span />
            <span />
          </span>
        )}
      </div>
    </div>
  )
}
