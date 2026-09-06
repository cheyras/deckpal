// The core of the tool: the frozen working frame on a pan/zoom canvas, four
// corner handles at constant screen size, a loupe for exactness, keyboard
// nudging on desktop. All high-frequency interaction (pan, pinch, drag) is
// REF-DRIVEN — direct DOM/canvas mutation, no React state per pointer event
// — the same "transform/opacity via refs, not a re-render per pixel"
// discipline the product scanner's own motion code (scan/ui/motion.ts,
// SwipeReview.tsx's drag) already uses. React state only changes at settled
// moments: a drag/pinch ending, a keyboard nudge, a corner gaining focus, the
// orientation anchor moving.
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
import { Loupe } from './Loupe'

const HANDLE_SIZE = 26
const TL_HANDLE_SIZE = 30
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
  saveStatus,
  saveMessage,
  onSaveLabel,
  onInvalid,
  onDiscard,
  onNext,
}: {
  workingFrame: WorkingFrame
  initialCorners: Quad
  /** The geometric guess (detectSeed.ts) — the reader usually only confirms. */
  initialTopLeftIndex: TopLeftIndex
  seededFrom: SeededFrom
  saving: boolean
  saveStatus: 'idle' | 'sent' | 'error'
  saveMessage: string | null
  onSaveLabel: (corners: Quad, topLeftIndex: TopLeftIndex, face: CardFace) => void
  onInvalid: (reason: InvalidReason) => void
  onDiscard: () => void
  onNext: () => void
}) {
  const refSize = workingFrame.reference.width

  const containerRef = useRef<HTMLDivElement>(null)
  const imgCanvasRef = useRef<HTMLCanvasElement>(null)
  const polyRef = useRef<SVGPolygonElement>(null)
  const topEdgeRef = useRef<SVGLineElement>(null)
  const handleRefs = useRef<(HTMLButtonElement | null)[]>([null, null, null, null])

  const viewRef = useRef<ViewState>({ scale: 1, tx: 0, ty: 0 })
  const cornersRef = useRef<Quad>(initialCorners)
  const [corners, setCorners] = useState<Quad>(initialCorners)
  const [selectedCorner, setSelectedCorner] = useState<number | null>(null)
  const [loupe, setLoupe] = useState<{ cornerIndex: number; screenX: number; screenY: number } | null>(null)
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
      const size = i === topLeftRef.current ? TL_HANDLE_SIZE : HANDLE_SIZE
      el.style.left = `${pts[i]![0] - size / 2}px`
      el.style.top = `${pts[i]![1] - size / 2}px`
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
    setLoupe({ cornerIndex: i, screenX: sx, screenY: sy })
  }
  const onHandlePointerUp = (i: number, e: React.PointerEvent) => {
    if (draggingCorner.current !== i) return
    e.stopPropagation()
    draggingCorner.current = null
    setCorners([...cornersRef.current] as Quad)
    setLoupe(null)
  }

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
      const step = (e.shiftKey ? 5 : 1) * NUDGE_FRAC
      const next = [...cornersRef.current] as Quad
      const [x, y] = next[selectedCorner]!
      next[selectedCorner] = [clamp(x + d[0] * step, -0.15, 1.15), clamp(y + d[1] * step, -0.15, 1.15)]
      cornersRef.current = next
      syncVisuals()
      setCorners(next)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectedCorner, syncVisuals, rotateAnchor, toggleFace])

  // While dragging, the loupe must sample the LIVE (ref-mutated) position,
  // not the last-committed React `corners` — read straight from the ref.
  const liveLoupeCorner = loupe ? cornersRef.current[loupe.cornerIndex] : null

  const reorientedFromSeed = topLeftIndex !== initialTopLeftIndex

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-neutral-950">
      <div className="flex shrink-0 flex-wrap items-center gap-[8px] border-b border-white/10 px-[12px] py-[6px] text-[11px] text-white/60">
        <span
          className={`rounded-full px-[8px] py-[2px] font-bold uppercase tracking-wide ${
            seededFrom === 'detector' ? 'bg-cyan-400/15 text-cyan-300' : 'bg-white/10 text-white/60'
          }`}
        >
          seed: {seededFrom}
        </span>
        <span
          className={`rounded-full px-[8px] py-[2px] font-bold uppercase tracking-wide ${
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
          <span className="rounded-full bg-violet-400/20 px-[8px] py-[2px] font-bold uppercase tracking-wide text-violet-300">
            card back
          </span>
        )}
        <span>drag corners · pinch/wheel to zoom · arrows nudge (shift = 5px) · R rotates the anchor · B = card back</span>
      </div>

      <div
        ref={containerRef}
        onPointerDown={onContainerPointerDown}
        onPointerMove={onContainerPointerMove}
        onPointerUp={onContainerPointerUp}
        onPointerCancel={onContainerPointerUp}
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
              // THE ORIENTATION ANCHOR IS DISTINCT IN SHAPE *AND* COLOUR, not
              // colour alone: a card face is a full-gamut illustration and any
              // single hue will collide with some card's art somewhere. So the
              // anchor is a SQUARE where the others are circles, amber where
              // they are white, and carries an outer dark ring so the amber
              // survives on a pale border as well as on dark art.
              className={`absolute z-10 flex touch-none items-center justify-center bg-black/55 backdrop-blur-sm ${
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
            </button>
          )
        })}
        {/* The legend for the distinct marker — the square is the shape cue,
            the amber is the colour cue, and this says what they mean without
            the reader having to remember. */}
        <span className="pointer-events-none absolute left-[10px] top-[10px] z-20 rounded-full bg-black/70 px-[8px] py-[3px] text-[10px] font-bold uppercase tracking-wide text-amber-300 ring-1 ring-amber-300/40">
          ■ = card's top-left
        </span>
        {loupe && liveLoupeCorner && (
          <Loupe
            source={workingFrame.reference}
            centerX={liveLoupeCorner[0] * refSize}
            centerY={liveLoupeCorner[1] * refSize}
            screenX={loupe.screenX}
            screenY={loupe.screenY}
            viewportW={containerRef.current?.clientWidth ?? 0}
            viewportH={containerRef.current?.clientHeight ?? 0}
          />
        )}
      </div>

      <div className="flex shrink-0 flex-col gap-[8px] border-t border-white/10 bg-neutral-900 p-[12px]">
        {saveMessage && (
          <div
            className={`rounded-lg px-[10px] py-[6px] text-[12px] ${
              saveStatus === 'error' ? 'bg-red-500/15 text-red-300' : 'bg-emerald-500/15 text-emerald-300'
            }`}
          >
            {saveMessage}
          </div>
        )}

        {/* ── ORIENTATION ROW ────────────────────────────────────────────────
            Rotate is the PRIMARY control and it is first, because it is the
            fastest thing a reader doing hundreds of these can do: one tap, no
            mode to enter, no aiming at a 30px target, and — the part that
            actually matters — no need to look away from the card to find the
            button again between frames. The anchor is already seeded from the
            same geometric rule production uses, so the common case is zero
            taps (confirm) and the correction case is one tap in the usual
            quarter-turn-wrong failure. "Set top-left" is kept as the second
            path for the rare two- or three-turn frame, where naming the corner
            beats tapping rotate three times. */}
        <div className="flex flex-wrap items-center gap-[8px] rounded-lg border border-amber-300/25 bg-amber-300/[0.06] px-[10px] py-[8px]">
          <span className="text-[11px] leading-[15px] text-white/60">
            <b className="text-amber-300">Top-left of the CARD</b> — its own top-left, whichever way the card is
            turned.
          </span>
          <div className="flex-1" />
          <button
            type="button"
            onClick={rotateAnchor}
            aria-label="Rotate the top-left anchor one corner clockwise"
            className="flex h-[34px] items-center gap-[7px] rounded-full bg-amber-300 px-[13px] text-[12px] font-bold text-amber-950 hover:bg-amber-200"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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
            className={`h-[34px] rounded-full border px-[13px] text-[12px] font-bold ${
              assigning
                ? 'border-amber-300 bg-amber-300/20 text-amber-200'
                : 'border-white/20 text-white/70 hover:bg-white/10'
            }`}
          >
            {assigning ? 'Tap a corner…' : 'Set top-left'}
          </button>
        </div>

        {/* ── FACE ───────────────────────────────────────────────────────────
            A back is SAVED, quad and all — it is not in the rejection picker
            below and must not read like it is, hence its own row up here with
            the positive controls, and its own colour (violet) distinct from
            both the amber orientation row and the picker's rejection chips.
            The subtitle is the classifier's own coaching copy, reviewed here
            like every other line in the taxonomy. */}
        <button
          type="button"
          aria-pressed={face === 'back'}
          onClick={toggleFace}
          className={`flex items-center gap-[10px] rounded-lg border px-[10px] py-[7px] text-left ${
            face === 'back'
              ? 'border-violet-400/60 bg-violet-500/15'
              : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06]'
          }`}
        >
          <span
            className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[4px] border-2 ${
              face === 'back' ? 'border-violet-300 bg-violet-300 text-violet-950' : 'border-white/30'
            }`}
          >
            {face === 'back' && <Icon name="check" size={11} />}
          </span>
          <span className="flex flex-col">
            <span className={`text-[11px] font-bold ${face === 'back' ? 'text-violet-200' : 'text-white/80'}`}>
              This is the {CARD_BACK_SPEC.label.toLowerCase()} <span className="font-mono text-[10px] opacity-60">B</span>
            </span>
            <span className="text-[10px] leading-[13px] text-white/45">
              Still a positive — pin the quad and the anchor as usual. Coaching: “{CARD_BACK_SPEC.coaching}”
            </span>
          </span>
        </button>

        {/* Owner's two deliberate borderline rules (2026-09-04, carried
            forward through the 2026-09-06 taxonomy rewrite) — kept small but
            always visible, right where the invalid-reason buttons are, since
            these are exactly the judgment calls that get made there. */}
        <div className="rounded-lg border border-white/10 bg-white/[0.03] px-[10px] py-[7px] text-[11px] leading-[16px] text-white/55">
          <b className="text-white/75">Borderline calls:</b> several cards but ONE is clearly the intended
          foreground subject → that's a <b className="text-emerald-300/90">positive</b>, label the foreground card
          (background-card suppression must stay trained in) — save it as usual, don't tap "Several cards" below.
          Blurry but you can still confidently place the corners → also a{' '}
          <b className="text-emerald-300/90">positive</b> (a valuable hard example). "Too blurry" is only for when{' '}
          <i>you</i> can't confidently place them.
        </div>

        {/* ── REJECTION TAXONOMY ─────────────────────────────────────────────
            One tap per verdict, grouped by the question each answers, and
            every button carries the COACHING PHRASE a realtime classifier
            would say for that class as its subtitle — so labelling the corpus
            is simultaneously reviewing that copy (types.ts REASON_SPECS). */}
        {REJECTION_GROUPS.map((group) => (
          <div key={group} className="flex flex-col gap-[5px]">
            <span className="text-[10px] font-bold uppercase tracking-wide text-white/35">{GROUP_TITLES[group]}</span>
            <div className="flex flex-wrap items-stretch gap-[6px]">
              {REASON_SPECS.filter((r) => r.group === group).map((r) => (
                <button
                  key={r.value}
                  type="button"
                  disabled={saving}
                  onClick={() => onInvalid(r.value)}
                  title={r.coaching}
                  className={`flex min-w-[132px] flex-col items-start gap-[1px] rounded-lg border px-[10px] py-[6px] text-left disabled:opacity-50 ${
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
                    className={`flex items-center gap-[5px] text-[11px] font-bold ${
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

        <div className="flex flex-wrap items-center gap-[8px]">
          <div className="flex-1" />
          <button
            type="button"
            disabled={saving}
            onClick={onDiscard}
            className="h-[36px] rounded-full border border-white/20 px-[14px] text-[12px] font-bold text-white/70 hover:bg-white/10 disabled:opacity-50"
          >
            Discard
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => onSaveLabel(corners, topLeftIndex, face)}
            className={`flex h-[36px] items-center gap-[6px] rounded-full px-[14px] text-[12px] font-bold disabled:opacity-50 ${
              face === 'back'
                ? 'bg-violet-300 text-violet-950 hover:bg-violet-200'
                : 'bg-cyan-400 text-cyan-950 hover:bg-cyan-300'
            }`}
          >
            <Icon name="check" size={14} />{' '}
            {saving ? 'Saving…' : face === 'back' ? 'Save label — card back' : 'Save label'}
          </button>
          <button
            type="button"
            onClick={onNext}
            className="h-[36px] rounded-full bg-white/10 px-[14px] text-[12px] font-bold text-white hover:bg-white/20"
          >
            Next →
          </button>
        </div>
      </div>
    </div>
  )
}
