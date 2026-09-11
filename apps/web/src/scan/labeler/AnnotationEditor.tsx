// The core of the tool: the frozen working frame on a pan/zoom canvas, four
// corner handles at constant screen size, a loupe for exactness, keyboard
// nudging on desktop. All high-frequency interaction (pan, pinch, drag) is
// REF-DRIVEN — direct DOM/canvas mutation, no React state per pointer event
// — the same "transform/opacity via refs, not a re-render per pixel"
// discipline the product scanner's own motion code (scan/ui/motion.ts,
// SwipeReview.tsx's drag) already uses. React state changes only for things
// that actually change what RENDERS: a corner gaining focus, the orientation
// anchor moving, the face flag, the rejection sheet. The quad itself is
// ref-only — see `cornersRef`.
//
// ── SIZED FOR A THUMB, 2026-09-07 ───────────────────────────────────────────
//
// Two things about the first layout only fail on a phone, and both were
// measured rather than guessed (round 9 items 22-27, driven at 430x980):
//
//   THE CORNER HANDLES WERE 26 AND 30 px. Every touch-target guideline puts the
//   floor at 44, and a corner handle is the single most precision-critical
//   thing in the tool. They are now 44 px of HIT AREA around a 26/30 px VISUAL
//   marker — the target grows, the thing you aim at does not, and the card edge
//   underneath stays visible.
//
//   THE CONTROL PANEL WAS TALLER THAN THE PICTURE. Nine rejection chips, their
//   coaching subtitles, a four-line borderline-rules paragraph and two more
//   rows sat permanently below the canvas; round 9 item 26 measured the
//   card-back toggle 425 px above Save, with all nine chips between them. On a
//   390 px-wide phone that left almost nothing for the frame the reader is
//   supposed to be looking at. The rejection taxonomy — every word of it,
//   coaching phrases and borderline rules included — now lives in a sheet one
//   tap away, and what stays on screen is the four controls a POSITIVE needs:
//   rotate, card-back, save, discard. Positives are the common case and now
//   cost one tap; a rejection costs two.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Icon } from '../../components/Icon'
import { CANONICAL_SIZE } from '../engine/frame'
import type { Quad } from '../engine/contract'
import { assignTopLeft, orientedCorners, rotateTopLeft, type TopLeftIndex } from './orientation'
import {
  CARD_BACK_SPEC,
  REASON_SPECS,
  type CardFace,
  type InvalidReason,
  type ReasonGroup,
  type SeededFrom,
} from './types'
import type { WorkingFrame } from './workingFrame'
import { LOUPE_CARD_FRACTION, LOUPE_DEFAULT_STEP, LOUPE_STEPS } from './Loupe'
import { LoupePad } from './LoupePad'

/** The VISUAL markers — unchanged, because their size is an aiming decision. */
const HANDLE_SIZE = 26
const TL_HANDLE_SIZE = 30
/** The TOUCH TARGET around them. The 44 px floor, applied to the control that
 *  needs it most; the button is transparent, so this costs no pixels of the
 *  card. Positioning now uses this for every handle, which is also why
 *  `syncVisuals` no longer has to know which corner is the anchor. */
const HIT_SIZE = 44
const MIN_SCALE = 0.4
const MAX_SCALE = 10
const NUDGE_FRAC = 1 / CANONICAL_SIZE // "1px working-frame units"

/**
 * Picker headings, keyed by the FULL `ReasonGroup` union so a group added
 * later cannot silently vanish from the UI — tsc demands a decision for it
 * here. `null` means "not a rejection, not in this picker": 'quaddable'
 * (`card_back`) is a face flag on a positive and lives beside Save instead.
 */
const GROUP_TITLES: Record<ReasonGroup, string | null> = {
  absent: 'No card to quad',
  unquaddable: 'A card — but no quad can be pinned',
  quaddable: null,
}

const REJECTION_GROUPS = (Object.keys(GROUP_TITLES) as ReasonGroup[]).filter((g) => GROUP_TITLES[g] !== null)

function clamp(v: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, v))
}

interface ViewState {
  scale: number
  tx: number
  ty: number
}

export function AnnotationEditor({
  workingFrame,
  initialCorners,
  initialTopLeftIndex,
  seededFrom,
  saving,
  onSaveLabel,
  onInvalid,
  onDiscard,
}: {
  workingFrame: WorkingFrame
  initialCorners: Quad
  /** The geometric guess (detectSeed.ts) — the reader usually only confirms. */
  initialTopLeftIndex: TopLeftIndex
  seededFrom: SeededFrom
  saving: boolean
  onSaveLabel: (corners: Quad, topLeftIndex: TopLeftIndex, face: CardFace) => void
  onInvalid: (reason: InvalidReason) => void
  /** Throw this frame away and land on the next one — the same landing a save
   *  makes, which is why the labeler passes its own `advance` for both. */
  onDiscard: () => void
}) {
  const refSize = workingFrame.reference.width

  const containerRef = useRef<HTMLDivElement>(null)
  const imgCanvasRef = useRef<HTMLCanvasElement>(null)
  const polyRef = useRef<SVGPolygonElement>(null)
  const topEdgeRef = useRef<SVGLineElement>(null)
  const handleRefs = useRef<(HTMLButtonElement | null)[]>([null, null, null, null])

  const viewRef = useRef<ViewState>({ scale: 1, tx: 0, ty: 0 })
  /**
   * THE QUAD, ref-only. There is deliberately no `corners` state beside this
   * any more: nothing rendered is derived from the corner positions — the
   * polygon, the top edge and the four handles are all positioned by
   * `syncVisuals` writing to the DOM, and Save reads this ref (see `submit`).
   * A mirrored state existed to mark the "settled moment" after a drag, and
   * once Save stopped reading it, it was a re-render per drag-end that changed
   * not one pixel.
   */
  const cornersRef = useRef<Quad>(initialCorners)
  const [selectedCorner, setSelectedCorner] = useState<number | null>(null)
  /**
   * A REDRAW TICK, not a loupe position.
   *
   * This was `loupe: {cornerIndex, screenX, screenY} | null`, set on every
   * pointer move and cleared on pointer up — so the magnifier existed only
   * while a finger was down, which is exactly when the finger is covering the
   * corner. Selection owns it now (`selectedCorner`), and this only exists to
   * re-render while `cornersRef` is being mutated: the corners are a ref on
   * purpose (see their declaration), so nothing would otherwise tell React that
   * the magnified view is stale.
   */
  const [tick, setTick] = useState(0)
  const bumpLoupe = useCallback(() => setTick((t) => (t + 1) % 1_000_000), [])
  /**
   * How far the loupe is stepped from its derived window — an index into
   * `LOUPE_STEPS`, remembered across frames and sessions.
   *
   * The derived default comes from the card's geometry and is an estimate; the
   * reader's is measured by eye on their own device, mid-session, on real
   * cards. Persisted for the obvious reason: a preference re-set on every one
   * of two hundred frames is not a preference.
   */
  const [loupeStep, setLoupeStep] = useState<number>(() => {
    try {
      const raw = Number(localStorage.getItem('deckpal.labeler.loupeStep'))
      return Number.isInteger(raw) && raw >= 0 && raw < LOUPE_STEPS.length ? raw : LOUPE_DEFAULT_STEP
    } catch {
      // Private mode, or storage blocked. The default is a working value.
      return LOUPE_DEFAULT_STEP
    }
  })
  const stepLoupe = useCallback((delta: number) => {
    setLoupeStep((cur) => {
      const next = Math.min(LOUPE_STEPS.length - 1, Math.max(0, cur + delta))
      try {
        localStorage.setItem('deckpal.labeler.loupeStep', String(next))
      } catch {
        // Not being able to remember it is not a reason to refuse the change.
      }
      return next
    })
  }, [])
  // The orientation anchor lives in BOTH a ref and state, for the same reason
  // the corners do: `syncVisuals` is a stable callback that stale ResizeObserver
  // closures also call, so it must read the anchor from a ref that is never
  // stale — while the handles' own appearance (square vs round, amber vs white)
  // is a settled-moment re-render like any other.
  const [topLeftIndex, setTopLeftIndexState] = useState<TopLeftIndex>(initialTopLeftIndex)
  const topLeftRef = useRef<TopLeftIndex>(initialTopLeftIndex)
  // "Set top-left" mode: the SECOND way to reassign (see the rotate button's
  // comment for why it is second). While armed, a tap on any corner marker
  // assigns rather than drags.
  const [assigning, setAssigning] = useState(false)
  const assigningRef = useRef(false)
  // THE FACE FLAG, not a mode. A card back is a positive with corners and an
  // anchor like any other — the only difference is that the classifier has
  // something to say about it ("flip the card"), so it rides as one boolean
  // beside Save rather than as a separate flow the reader has to choose
  // BEFORE they know what they are looking at.
  const [face, setFace] = useState<CardFace>('front')
  const faceRef = useRef<CardFace>('front')
  /** The rejection taxonomy, as a sheet. See this file's header for why it is
   *  no longer permanently on screen. */
  const [rejecting, setRejecting] = useState(false)
  // A REF, not state: the ResizeObserver callback below is created ONCE (the
  // effect's deps are `[refSize]`, not this flag) and closes over whatever
  // this was AT THAT TIME. React state read inside it would stay permanently
  // stale at `false` — `setFitted(true)` re-renders the component without
  // re-running the effect, so the closure would never see the flip and the
  // "only fit once" guard would silently re-fit (discarding the reader's own
  // pan/zoom) on every later resize. A ref has no such staleness: reading
  // `.current` always sees the latest write.
  const fittedRef = useRef(false)

  // Draw the sharp reference into a React-owned canvas once — the ELEMENT
  // then gets CSS-transformed for pan/zoom; the PIXELS never change.
  useLayoutEffect(() => {
    const ctx = imgCanvasRef.current?.getContext('2d')
    if (ctx) ctx.drawImage(workingFrame.reference, 0, 0)
  }, [workingFrame])

  const syncVisuals = useCallback(() => {
    const v = viewRef.current
    if (imgCanvasRef.current) {
      imgCanvasRef.current.style.transform = `translate(${v.tx}px, ${v.ty}px) scale(${v.scale})`
    }
    const pts = cornersRef.current.map(([nx, ny]) => [v.tx + nx * refSize * v.scale, v.ty + ny * refSize * v.scale])
    handleRefs.current.forEach((el, i) => {
      if (!el) return
      // Every handle is the same 44 px box now, centred on its corner — the
      // VISUAL marker inside it is what differs between the anchor and the rest.
      el.style.left = `${pts[i]![0] - HIT_SIZE / 2}px`
      el.style.top = `${pts[i]![1] - HIT_SIZE / 2}px`
    })
    polyRef.current?.setAttribute('points', pts.map((p) => `${p[0]},${p[1]}`).join(' '))
    // THE CARD'S TOP EDGE, drawn thick and amber over the cyan outline. The
    // marker says which corner; this says which way up, readable in one glance
    // from across the room — the thing a reader doing hundreds of these is
    // actually scanning for.
    const line = topEdgeRef.current
    if (line) {
      const ordered = orientedCorners(cornersRef.current, topLeftRef.current)
      const toScreen = ([nx, ny]: [number, number]) => [
        v.tx + nx * refSize * v.scale,
        v.ty + ny * refSize * v.scale,
      ]
      const [ax, ay] = toScreen(ordered[0])
      const [bx, by] = toScreen(ordered[1])
      line.setAttribute('x1', String(ax))
      line.setAttribute('y1', String(ay))
      line.setAttribute('x2', String(bx))
      line.setAttribute('y2', String(by))
    }
  }, [refSize])

  const setTopLeft = useCallback(
    (next: TopLeftIndex) => {
      topLeftRef.current = next
      setTopLeftIndexState(next)
      syncVisuals()
    },
    [syncVisuals],
  )

  // Fit-to-container on mount (and if the container is resized before any
  // interaction has moved it off that default).
  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const r = entry?.contentRect
      if (!r || !r.width || !r.height) return
      if (!fittedRef.current) {
        const scale = clamp(Math.min(r.width / refSize, r.height / refSize) * 0.92, MIN_SCALE, MAX_SCALE)
        viewRef.current = {
          scale,
          tx: (r.width - refSize * scale) / 2,
          ty: (r.height - refSize * scale) / 2,
        }
        fittedRef.current = true
      }
      syncVisuals()
    })
    ro.observe(el)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refSize])

  useEffect(() => {
    syncVisuals()
  }, [syncVisuals])

  const screenToRef = useCallback(
    (screenX: number, screenY: number): [number, number] => {
      const v = viewRef.current
      return [(screenX - v.tx) / v.scale, (screenY - v.ty) / v.scale]
    },
    [],
  )

  // ── container gestures: 1 pointer = pan, 2 = pinch-zoom (touch); wheel +
  //    drag on desktop go through the same pointer path (a mouse is one
  //    pointer). ──
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const draggingCorner = useRef<number | null>(null)

  const onContainerPointerDown = (e: React.PointerEvent) => {
    if (draggingCorner.current !== null) return
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
  }
  const onContainerPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    const entries = [...pointers.current.entries()]
    if (entries.length === 2) {
      const otherEntry = entries.find(([id]) => id !== e.pointerId)!
      const other = otherEntry[1]
      const prevSelf = pointers.current.get(e.pointerId)!
      const oldDist = Math.hypot(prevSelf.x - other.x, prevSelf.y - other.y)
      const oldMidX = (prevSelf.x + other.x) / 2 - rect.left
      const oldMidY = (prevSelf.y + other.y) / 2 - rect.top
      const newDist = Math.hypot(e.clientX - other.x, e.clientY - other.y)
      const newMidX = (e.clientX + other.x) / 2 - rect.left
      const newMidY = (e.clientY + other.y) / 2 - rect.top
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (oldDist > 4) {
        const v = viewRef.current
        const [wx, wy] = screenToRef(oldMidX, oldMidY)
        const factor = clamp(newDist / oldDist, 0.8, 1.25)
        v.scale = clamp(v.scale * factor, MIN_SCALE, MAX_SCALE)
        v.tx = newMidX - wx * v.scale
        v.ty = newMidY - wy * v.scale
        syncVisuals()
      }
    } else if (entries.length === 1) {
      const prev = pointers.current.get(e.pointerId)!
      const dx = e.clientX - prev.x
      const dy = e.clientY - prev.y
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
      viewRef.current.tx += dx
      viewRef.current.ty += dy
      syncVisuals()
    }
  }
  const onContainerPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId)
  }

  // ── corner handles ──
  const onHandlePointerDown = (i: number, e: React.PointerEvent) => {
    e.stopPropagation()
    // Armed "set top-left": this tap NAMES the corner, it does not move it.
    // Checked before pointer capture so the handle never enters a drag the
    // reader did not ask for.
    if (assigningRef.current) {
      assigningRef.current = false
      setAssigning(false)
      setTopLeft(assignTopLeft(i))
      return
    }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    draggingCorner.current = i
    setSelectedCorner(i)
  }
  const onHandlePointerMove = (i: number, e: React.PointerEvent) => {
    if (draggingCorner.current !== i) return
    e.stopPropagation()
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    const sx = e.clientX - rect.left
    const sy = e.clientY - rect.top
    const [wx, wy] = screenToRef(sx, sy)
    const next = [...cornersRef.current] as Quad
    next[i] = [clamp(wx / refSize, -0.15, 1.15), clamp(wy / refSize, -0.15, 1.15)]
    cornersRef.current = next
    syncVisuals()
    // The magnified view has to follow the drag; the PAD does not move (see
    // LoupePad's placement rule), so this is a redraw, not a reposition.
    bumpLoupe()
  }
  const onHandlePointerUp = (i: number, e: React.PointerEvent) => {
    if (draggingCorner.current !== i) return
    e.stopPropagation()
    draggingCorner.current = null
    // The selection — and therefore the loupe and its pad — SURVIVES the
    // release. That is the whole point: the corner is now visible because the
    // finger has left it, and the arrows are there to place it exactly.
  }

  /**
   * SAVE READS THE REFS, NOT THE STATE — and it is the same reason the loupe
   * does. `cornersRef` is mutated on every pointer move and `setCorners` only
   * at a settled moment, so the ref is what the screen is currently DRAWING
   * from. They agree at rest, but any path that ends a drag without a
   * pointerup/pointercancel (the browser reclaiming the gesture, a handle
   * unmounting under the finger) leaves the state one drag behind while the
   * quad on screen has moved. Posting the state there would silently record a
   * quad the reader never saw — the one failure mode a corpus cannot detect
   * later, because the row looks perfectly well-formed.
   */
  /**
   * Move the selected corner by whole working-frame pixels.
   *
   * Extracted from the keyboard handler so the pad's arrows and the arrow keys
   * are the SAME operation — including the clamp, which is what stops a corner
   * being nudged somewhere the frame cannot represent. Two implementations of
   * "nudge" would drift the moment one of them learned about a new bound.
   */
  const nudgeCorner = useCallback(
    (dx: number, dy: number, multiplier = 1) => {
      setSelectedCorner((sel) => {
        if (sel === null) return sel
        const step = NUDGE_FRAC * multiplier
        const next = [...cornersRef.current] as Quad
        const [x, y] = next[sel]!
        next[sel] = [clamp(x + dx * step, -0.15, 1.15), clamp(y + dy * step, -0.15, 1.15)]
        cornersRef.current = next
        syncVisuals()
        return sel
      })
      bumpLoupe()
    },
    [syncVisuals, bumpLoupe],
  )

  const submit = useCallback(() => {
    // SAVING CONFIRMS. The owner's rule, and it costs nothing to honour: a row
    // is written from `cornersRef` either way, so clearing the selection only
    // decides whether the next frame opens with a pad floating over it.
    setSelectedCorner(null)
    onSaveLabel([...cornersRef.current] as Quad, topLeftRef.current, faceRef.current)
  }, [onSaveLabel])

  const rotateAnchor = useCallback(() => {
    setTopLeft(rotateTopLeft(cornersRef.current, topLeftRef.current))
  }, [setTopLeft])

  const toggleFace = useCallback(() => {
    const next: CardFace = faceRef.current === 'back' ? 'front' : 'back'
    faceRef.current = next
    setFace(next)
  }, [])

  // ── keyboard: nudging, and R for the anchor (desktop) ──
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Escape closes the rejection sheet before anything else looks at the key
      // — while it is open it is the only thing on screen the reader is aiming
      // at, so the other shortcuts would be answering a question nobody asked.
      if (e.key === 'Escape') {
        if (rejecting) {
          e.preventDefault()
          setRejecting(false)
        }
        return
      }
      if (rejecting) return
      // The anchor key comes FIRST and needs no selected corner: on desktop a
      // reader confirming orientation has not necessarily touched a handle.
      if ((e.key === 'r' || e.key === 'R') && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        rotateAnchor()
        return
      }
      if ((e.key === 'b' || e.key === 'B') && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        toggleFace()
        return
      }
      // SAVE FROM THE KEYBOARD. The one control a desktop session used every
      // single frame and still had to reach for the mouse to press.
      if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !e.altKey && !saving) {
        e.preventDefault()
        submit()
        return
      }
      if (selectedCorner === null) return
      const deltas: Record<string, [number, number]> = {
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
      }
      const d = deltas[e.key]
      if (!d) return
      e.preventDefault()
      nudgeCorner(d[0], d[1], e.shiftKey ? 5 : 1)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectedCorner, nudgeCorner, rotateAnchor, toggleFace, rejecting, saving, submit])

  // The loupe samples the LIVE (ref-mutated) quad, not a last-committed React
  // copy — `tick` is what re-renders this, and reading the ref here is what
  // makes the magnified view current. `tick` is referenced so the dependency is
  // honest rather than incidental.
  void tick
  const liveQuad = cornersRef.current

  /**
   * THE LOUPE'S WINDOW, in reference pixels, measured off the card itself.
   *
   * The quad's shorter side IS the card's short edge — that is what a correct
   * quad means — so the corner radius it has to display is a known fraction of
   * it (3 mm of 63 mm, `lib/cardGeometry.ts`). Sizing the window this way is
   * what makes the loupe show the same amount of CARD whatever the photo's
   * resolution, which a fixed pixel multiplier could not: see the note on
   * `LOUPE_CARD_FRACTION`.
   *
   * Falls back to a quarter of the frame if the quad is degenerate (a fresh
   * default seed, a quad dragged onto itself) — a usable window beats none.
   */
  const loupeWindowPx = (() => {
    const q = cornersRef.current
    const side = (a: number, b: number) => {
      const [ax, ay] = q[a]!
      const [bx, by] = q[b]!
      return Math.hypot((ax - bx) * refSize, (ay - by) * refSize)
    }
    // Adjacent sides only; the shorter PAIR is the card's width.
    const shortEdge = Math.min((side(0, 1) + side(2, 3)) / 2, (side(1, 2) + side(3, 0)) / 2)
    const base = shortEdge > 8 ? shortEdge * LOUPE_CARD_FRACTION : refSize * 0.25
    return base * (LOUPE_STEPS[loupeStep] ?? 1)
  })()

  const reorientedFromSeed = topLeftIndex !== initialTopLeftIndex

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-neutral-950">
      <div className="flex shrink-0 flex-wrap items-center gap-[6px] border-b border-white/10 px-[10px] py-[5px] text-[10px] text-white/60">
        <span
          className={`rounded-full px-[7px] py-[2px] font-bold uppercase tracking-wide ${
            seededFrom === 'detector' ? 'bg-cyan-400/15 text-cyan-300' : 'bg-white/10 text-white/60'
          }`}
          title={
            seededFrom === 'detector'
              ? 'The quad below is the shipping detector’s own proposal for this frame.'
              : 'The detector produced nothing here, so this is the centred fallback rectangle — the anchor guess it carries is about that rectangle, not about a detection.'
          }
        >
          seed: {seededFrom}
        </span>
        <span
          className={`rounded-full px-[7px] py-[2px] font-bold uppercase tracking-wide ${
            reorientedFromSeed ? 'bg-amber-400/20 text-amber-300' : 'bg-white/10 text-white/60'
          }`}
          title={
            reorientedFromSeed
              ? "You moved the anchor off the detector's guess — this frame is one production would have rectified a quarter turn wrong."
              : "The anchor is still where the geometric rule put it — production would orient this card correctly."
          }
        >
          {reorientedFromSeed ? 'orientation: corrected' : 'orientation: as seeded'}
        </span>
        {face === 'back' && (
          <span className="rounded-full bg-violet-400/20 px-[7px] py-[2px] font-bold uppercase tracking-wide text-violet-300">
            card back
          </span>
        )}
        <span className="hidden sm:inline">drag corners · pinch/wheel to zoom · arrows nudge (shift = 5px) · R rotates · B = back · Enter saves</span>
      </div>

      <div
        ref={containerRef}
        onPointerDown={onContainerPointerDown}
        onPointerMove={onContainerPointerMove}
        onPointerUp={onContainerPointerUp}
        onPointerCancel={onContainerPointerUp}
        // `touch-none` is load-bearing: without it a pinch inside the frame is
        // taken by the BROWSER as a page zoom and the editor's own zoom never
        // sees it, which is exactly the fight the owner would hit first on a
        // phone. It sets `touch-action: none` on the element the gestures land
        // on, so the page cannot claim them.
        className="relative min-h-0 flex-1 touch-none overflow-hidden bg-[repeating-conic-gradient(#111_0%_25%,#161616_0%_50%)] bg-[length:20px_20px]"
      >
        <canvas
          ref={imgCanvasRef}
          width={refSize}
          height={refSize}
          className="absolute left-0 top-0 origin-top-left"
          style={{ willChange: 'transform' }}
        />
        <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
          <polygon
            ref={polyRef}
            fill="rgba(83,234,253,0.12)"
            stroke="rgba(83,234,253,0.9)"
            strokeWidth={2}
            strokeLinejoin="round"
          />
          {/* The card's TOP edge (anchor -> next corner). Drawn after the
              polygon so it sits on top of the cyan stroke. */}
          <line
            ref={topEdgeRef}
            stroke="rgba(251,191,36,0.95)"
            strokeWidth={4}
            strokeLinecap="round"
          />
        </svg>
        {([0, 1, 2, 3] as const).map((i) => {
          const isTL = i === topLeftIndex
          const size = isTL ? TL_HANDLE_SIZE : HANDLE_SIZE
          return (
            <button
              key={i}
              type="button"
              ref={(el) => {
                handleRefs.current[i] = el
              }}
              tabIndex={0}
              aria-label={
                isTL
                  ? `Corner ${i + 1} — the card's top-left`
                  : assigning
                    ? `Make corner ${i + 1} the card's top-left`
                    : `Corner ${i + 1}`
              }
              aria-pressed={isTL}
              onFocus={() => setSelectedCorner(i)}
              onPointerDown={(e) => onHandlePointerDown(i, e)}
              onPointerMove={(e) => onHandlePointerMove(i, e)}
              onPointerUp={(e) => onHandlePointerUp(i, e)}
              onPointerCancel={(e) => onHandlePointerUp(i, e)}
              // THE HIT AREA IS 44 px AND INVISIBLE; the marker inside it is the
              // 26/30 px the reader aims with. Growing the visible disc to 44
              // would have hidden the card corner underneath it, which is the
              // one pixel that matters here.
              className="absolute z-10 flex touch-none items-center justify-center bg-transparent"
              style={{ width: HIT_SIZE, height: HIT_SIZE }}
            >
              {/* THE ORIENTATION ANCHOR IS DISTINCT IN SHAPE *AND* COLOUR, not
                  colour alone: a card face is a full-gamut illustration and any
                  single hue will collide with some card's art somewhere. So the
                  anchor is a SQUARE where the others are circles, amber where
                  they are white, and carries an outer dark ring so the amber
                  survives on a pale border as well as on dark art. */}
              <span
                className={`flex items-center justify-center bg-black/55 backdrop-blur-sm ${
                  isTL
                    ? 'rounded-[5px] border-[3px] border-amber-300 shadow-[0_0_0_2px_rgba(0,0,0,0.75)]'
                    : `rounded-full border-2 ${
                        selectedCorner === i ? 'border-cyan-300 ring-2 ring-cyan-300/50' : 'border-white/80'
                      }`
                } ${assigning && !isTL ? 'ring-2 ring-amber-300/70' : ''}`}
                style={{ width: size, height: size }}
              >
                {isTL ? (
                  <span className="h-[9px] w-[9px] rounded-[2px] bg-amber-300" />
                ) : (
                  <span className="h-[8px] w-[8px] rounded-full bg-white" />
                )}
              </span>
            </button>
          )
        })}
        {/* The legend for the distinct marker — the square is the shape cue,
            the amber is the colour cue, and this says what they mean without
            the reader having to remember. */}
        <span className="pointer-events-none absolute left-[10px] top-[10px] z-20 rounded-full bg-black/70 px-[8px] py-[3px] text-[10px] font-bold uppercase tracking-wide text-amber-300 ring-1 ring-amber-300/40">
          ■ = card's top-left
        </span>
        {/* ── THE LOUPE'S ZOOM, tunable in place ──────────────────────────
            Top-right, opposite the orientation legend, and OUT of the way of
            the bottom-left corner handle — which is the one a right-handed
            reader's thumb covers this control with otherwise.

            It is here rather than in the controls row below because it is
            adjusted while looking at the loupe, and a control you have to look
            away from to find is a control you stop using. `-` widens the
            window (less magnification), `+` narrows it. */}
        <div // z-40: the nudge pad (z-30) is inset 50 px from the edges and can reach
            // under this when it anchors top-right. The zoom control wins that
            // overlap on purpose — it is adjusted WHILE a corner is selected, so
            // being covered by the pad would make it unreachable exactly when it
            // is wanted.
            className="pointer-events-auto absolute right-[10px] top-[10px] z-40 flex items-center gap-[1px] overflow-hidden rounded-full bg-black/70 ring-1 ring-white/20">
          {/* MIND THE SIGN. A larger step is a WIDER window, which is LESS
              magnification — so "zoom out" walks the index UP, not down. */}
          <button
            type="button"
            onClick={() => stepLoupe(1)}
            disabled={loupeStep === LOUPE_STEPS.length - 1}
            aria-label="Zoom the loupe out — show more of the card"
            className="flex h-[30px] w-[30px] items-center justify-center text-[15px] font-bold text-white/80 hover:bg-white/15 disabled:opacity-25"
          >
            −
          </button>
          <span
            className="min-w-[34px] text-center font-mono text-[10px] text-white/50"
            title="How much of the card's width the loupe shows. Lower is more magnified."
          >
            {Math.round(LOUPE_CARD_FRACTION * (LOUPE_STEPS[loupeStep] ?? 1) * 100)}%
          </span>
          <button
            type="button"
            onClick={() => stepLoupe(-1)}
            disabled={loupeStep === 0}
            aria-label="Zoom the loupe in — show less of the card, larger"
            className="flex h-[30px] w-[30px] items-center justify-center text-[15px] font-bold text-white/80 hover:bg-white/15 disabled:opacity-25"
          >
            +
          </button>
        </div>
        {/* SELECTION SHOWS IT, not a finger being down. A corner is selected by
            tapping it, by dragging it, or by tabbing to it, and the pad stays
            until the reader confirms — which is what makes the arrows reachable
            at all. Selecting a DIFFERENT corner implicitly confirms this one:
            the handle's own pointerdown sets `selectedCorner`, so there is no
            second rule to keep in step. */}
        {selectedCorner !== null && (
          <LoupePad
            source={workingFrame.reference}
            quad={liveQuad}
            sourceSize={refSize}
            cornerIndex={selectedCorner}
            windowPx={loupeWindowPx}
            onNudge={(dx, dy) => nudgeCorner(dx, dy)}
            onConfirm={() => setSelectedCorner(null)}
          />
        )}
      </div>

      {/* ── THE PERMANENT CONTROLS ──────────────────────────────────────────
          Everything a POSITIVE needs and nothing else. Kept to two rows so the
          frame above keeps the screen; every button is >= 44 px. */}
      <div className="flex shrink-0 flex-col gap-[7px] border-t border-white/10 bg-neutral-900 p-[10px]">
        {/* ORIENTATION. Rotate is the PRIMARY control and it is first, because
            it is the fastest thing a reader doing hundreds of these can do: one
            tap, no mode to enter, no aiming at a 30px target, and — the part
            that actually matters — no need to look away from the card to find
            the button again between frames. The anchor is already seeded from
            the same geometric rule production uses, so the common case is zero
            taps (confirm) and the correction case is one tap in the usual
            quarter-turn-wrong failure. "Set top-left" is kept as the second
            path for the rare two- or three-turn frame, where naming the corner
            beats tapping rotate three times. */}
        <div className="flex items-center gap-[6px]">
          <button
            type="button"
            onClick={rotateAnchor}
            aria-label="Rotate the top-left anchor one corner clockwise"
            className="flex h-[44px] flex-1 items-center justify-center gap-[7px] rounded-xl bg-amber-300 px-[12px] text-[13px] font-bold text-amber-950 hover:bg-amber-200"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M20 12a8 8 0 1 1-2.3-5.6" />
              <path d="M20 4v4.5h-4.5" />
            </svg>
            Rotate <span className="font-mono text-[10px] opacity-70">R</span>
          </button>
          <button
            type="button"
            aria-pressed={assigning}
            onClick={() => {
              const next = !assigningRef.current
              assigningRef.current = next
              setAssigning(next)
            }}
            className={`h-[44px] shrink-0 rounded-xl border px-[12px] text-[12px] font-bold ${
              assigning
                ? 'border-amber-300 bg-amber-300/20 text-amber-200'
                : 'border-white/20 text-white/70 hover:bg-white/10'
            }`}
          >
            {assigning ? 'Tap a corner…' : 'Set TL'}
          </button>
          {/* THE FACE FLAG, and it now sits in the SAME ROW as Save rather than
              425 px above it (round 9 item 26). A back is SAVED, quad and all —
              violet, distinct from both the amber orientation control and the
              rejection sheet's chips, so it can never read as a rejection. */}
          <button
            type="button"
            aria-pressed={face === 'back'}
            onClick={toggleFace}
            title={`A card back is still a positive — pin the quad as usual. Coaching: “${CARD_BACK_SPEC.coaching}”`}
            className={`flex h-[44px] shrink-0 items-center gap-[7px] rounded-xl border px-[12px] text-[12px] font-bold ${
              face === 'back'
                ? 'border-violet-400/60 bg-violet-500/20 text-violet-200'
                : 'border-white/20 text-white/70 hover:bg-white/10'
            }`}
          >
            <span
              className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[4px] border-2 ${
                face === 'back' ? 'border-violet-300 bg-violet-300 text-violet-950' : 'border-white/30'
              }`}
            >
              {face === 'back' && <Icon name="check" size={11} />}
            </span>
            Back <span className="font-mono text-[10px] opacity-60">B</span>
          </button>
        </div>

        <div className="flex items-center gap-[6px]">
          <button
            type="button"
            disabled={saving}
            onClick={onDiscard}
            className="h-[48px] shrink-0 rounded-xl border border-white/20 px-[14px] text-[12px] font-bold text-white/70 hover:bg-white/10 disabled:opacity-50"
          >
            Skip
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => setRejecting(true)}
            className="h-[48px] shrink-0 rounded-xl border border-rose-400/45 bg-rose-500/10 px-[14px] text-[12px] font-bold text-rose-200 hover:bg-rose-500/20 disabled:opacity-50"
          >
            No quad…
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={submit}
            className={`flex h-[48px] flex-1 items-center justify-center gap-[6px] rounded-xl text-[14px] font-bold disabled:opacity-50 ${
              face === 'back'
                ? 'bg-violet-300 text-violet-950 hover:bg-violet-200'
                : 'bg-cyan-400 text-cyan-950 hover:bg-cyan-300'
            }`}
          >
            <Icon name="check" size={15} />{' '}
            {saving ? 'Saving…' : face === 'back' ? 'Save — back' : 'Save label'}
          </button>
        </div>

        {/* The owner's two deliberate borderline rules (2026-09-04, carried
            forward through the 2026-09-06 taxonomy rewrite), compressed to the
            one line that changes a decision. The full text is at the top of the
            rejection sheet, which is where the call actually gets made. */}
        <div className="text-[10px] leading-[14px] text-white/40">
          One clear foreground card, or blurry-but-placeable → still a{' '}
          <b className="text-emerald-300/80">positive</b>. Save it.
        </div>
      </div>

      {/* ── THE REJECTION SHEET ─────────────────────────────────────────────
          One tap per verdict once it is open, grouped by the question each
          answers, and every button carries the COACHING PHRASE a realtime
          classifier would say for that class as its subtitle — so labelling the
          corpus is simultaneously reviewing that copy (types.ts REASON_SPECS).
          It overlays the whole editor rather than pushing the frame up, and it
          scrolls, so nine reasons and their subtitles fit a 390 px phone
          without the layout having to shrink anything. */}
      {rejecting && (
        <div className="absolute inset-0 z-30 flex flex-col bg-neutral-950/95 backdrop-blur-sm">
          <div className="flex shrink-0 items-center gap-[8px] border-b border-white/10 px-[12px] py-[8px]">
            <span className="text-[13px] font-bold text-white">Why is there no quad?</span>
            <div className="flex-1" />
            <button
              type="button"
              onClick={() => setRejecting(false)}
              aria-label="Back to the editor"
              className="flex h-[44px] items-center gap-[6px] rounded-xl border border-white/20 px-[14px] text-[12px] font-bold text-white/70 hover:bg-white/10"
            >
              <Icon name="close" size={13} /> Back
            </button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-[10px] overflow-y-auto p-[12px]">
            {/* THE ONE RULE, and then the calls people actually get wrong.
                Every gate here is stated in terms of PLACING THE CORNERS,
                because that is what a `corners: null` row trains — see
                types.ts on the 2026-09-08 classes, and HARVEST.md for the
                measured version. The asymmetry is the reason it is worth
                spelling out: a wrong rejection teaches the detector to give up
                and nothing downstream can undo a quad that was never emitted,
                while a quad that turns out unidentifiable costs one round trip
                and the next frame fixes it. */}
            <div className="flex flex-col gap-[6px] rounded-lg border border-white/10 bg-white/[0.03] px-[10px] py-[8px] text-[11px] leading-[16px] text-white/55">
              <span>
                <b className="text-white/75">The rule:</b> reject only when <i>you</i> cannot confidently place the
                four corners. If you can place them, it's a{' '}
                <b className="text-emerald-300/90">positive</b> — a hard one, and those are the valuable ones. When
                in doubt, place them.
              </span>
              <span>
                <b className="text-white/75">Blurry</b> — can you put each corner in the same spot twice? Mushy
                artwork with a crisp border is a positive; the identifier's problems are not the detector's.
              </span>
              <span>
                <b className="text-white/75">Obscured</b> — a corner you can't <i>see</i>, or an edge more than
                about a third hidden. Fingers across the art with four corners clear → positive. Don't infer a
                corner under a thumb: labelling a guess teaches the model to guess.
              </span>
              <span>
                <b className="text-white/75">Bent</b> — sight the straight line between two corners; if the card's
                edge visibly bows off it, the quad has stopped describing the card. A gentle bow is a positive.
              </span>
              <span>
                <b className="text-white/75">Several cards</b> — one clearly-intended foreground subject → positive,
                label the foreground card. Background-card suppression must stay trained in.
              </span>
            </div>
            {REJECTION_GROUPS.map((group) => (
              <div key={group} className="flex flex-col gap-[6px]">
                <span className="text-[10px] font-bold uppercase tracking-wide text-white/35">
                  {GROUP_TITLES[group]}
                </span>
                <div className="flex flex-col gap-[6px]">
                  {REASON_SPECS.filter((r) => r.group === group).map((r) => (
                    <button
                      key={r.value}
                      type="button"
                      disabled={saving}
                      onClick={() => onInvalid(r.value)}
                      title={r.coaching}
                      className={`flex min-h-[48px] flex-col items-start justify-center gap-[1px] rounded-lg border px-[12px] py-[7px] text-left disabled:opacity-50 ${
                        r.coachable
                          ? 'border-white/20 hover:bg-white/10'
                          : // The hard-negative class gets its own weight: it is
                            // the most valuable negative in the set (the current
                            // build's known false positive is a shipping
                            // envelope), so it must not read as one more chip in
                            // a row of eight.
                            'border-rose-400/50 bg-rose-500/10 hover:bg-rose-500/20'
                      }`}
                    >
                      <span
                        className={`flex items-center gap-[6px] text-[12px] font-bold ${
                          r.coachable ? 'text-white/85' : 'text-rose-200'
                        }`}
                      >
                        <Icon name="close" size={11} /> {r.label}
                      </span>
                      <span className="text-[10px] leading-[13px] text-white/45">{r.coaching}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
