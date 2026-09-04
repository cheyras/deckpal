// The core of the tool: the frozen working frame on a pan/zoom canvas, four
// corner handles at constant screen size, a loupe for exactness, keyboard
// nudging on desktop. All high-frequency interaction (pan, pinch, drag) is
// REF-DRIVEN — direct DOM/canvas mutation, no React state per pointer event
// — the same "transform/opacity via refs, not a re-render per pixel"
// discipline the product scanner's own motion code (scan/ui/motion.ts,
// SwipeReview.tsx's drag) already uses. React state only changes at settled
// moments: a drag/pinch ending, a keyboard nudge, a corner gaining focus.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Icon } from '../../components/Icon'
import { CANONICAL_SIZE } from '../engine/frame'
import type { Quad } from '../engine/contract'
import type { InvalidReason, SeededFrom } from './types'
import type { WorkingFrame } from './workingFrame'
import { Loupe } from './Loupe'

const HANDLE_SIZE = 26
const MIN_SCALE = 0.4
const MAX_SCALE = 10
const NUDGE_FRAC = 1 / CANONICAL_SIZE // "1px working-frame units"

const INVALID_REASONS: { value: InvalidReason; label: string }[] = [
  { value: 'no_card', label: 'Invalid — no card' },
  { value: 'multiple_cards', label: 'Invalid — multiple cards' },
  { value: 'too_blurry', label: 'Invalid — too blurry' },
]

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
  seededFrom: SeededFrom
  saving: boolean
  saveStatus: 'idle' | 'sent' | 'error'
  saveMessage: string | null
  onSaveLabel: (corners: Quad) => void
  onInvalid: (reason: InvalidReason) => void
  onDiscard: () => void
  onNext: () => void
}) {
  const refSize = workingFrame.reference.width

  const containerRef = useRef<HTMLDivElement>(null)
  const imgCanvasRef = useRef<HTMLCanvasElement>(null)
  const polyRef = useRef<SVGPolygonElement>(null)
  const handleRefs = useRef<(HTMLButtonElement | null)[]>([null, null, null, null])

  const viewRef = useRef<ViewState>({ scale: 1, tx: 0, ty: 0 })
  const cornersRef = useRef<Quad>(initialCorners)
  const [corners, setCorners] = useState<Quad>(initialCorners)
  const [selectedCorner, setSelectedCorner] = useState<number | null>(null)
  const [loupe, setLoupe] = useState<{ cornerIndex: number; screenX: number; screenY: number } | null>(null)
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
      el.style.left = `${pts[i]![0] - HANDLE_SIZE / 2}px`
      el.style.top = `${pts[i]![1] - HANDLE_SIZE / 2}px`
    })
    polyRef.current?.setAttribute('points', pts.map((p) => `${p[0]},${p[1]}`).join(' '))
  }, [refSize])

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

  // Desktop wheel-zoom. A native listener with {passive:false}: React's own
  // onWheel cannot reliably preventDefault (wheel is passive by default),
  // and this needs to stop the page from scrolling under the editor.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const sx = e.clientX - rect.left
      const sy = e.clientY - rect.top
      const v = viewRef.current
      const [wx, wy] = screenToRef(sx, sy)
      const factor = Math.exp(-e.deltaY * 0.0015)
      v.scale = clamp(v.scale * factor, MIN_SCALE, MAX_SCALE)
      v.tx = sx - wx * v.scale
      v.ty = sy - wy * v.scale
      syncVisuals()
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [screenToRef, syncVisuals])

  // ── corner handles ──
  const onHandlePointerDown = (i: number, e: React.PointerEvent) => {
    e.stopPropagation()
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

  // ── keyboard nudging (desktop) ──
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
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
  }, [selectedCorner, syncVisuals])

  // While dragging, the loupe must sample the LIVE (ref-mutated) position,
  // not the last-committed React `corners` — read straight from the ref.
  const liveLoupeCorner = loupe ? cornersRef.current[loupe.cornerIndex] : null

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-neutral-950">
      <div className="flex shrink-0 items-center gap-[8px] border-b border-white/10 px-[12px] py-[6px] text-[11px] text-white/60">
        <span
          className={`rounded-full px-[8px] py-[2px] font-bold uppercase tracking-wide ${
            seededFrom === 'detector' ? 'bg-cyan-400/15 text-cyan-300' : 'bg-white/10 text-white/60'
          }`}
        >
          seed: {seededFrom}
        </span>
        <span>drag corners · pinch/wheel to zoom · drag to pan · arrows to nudge (shift = 5px)</span>
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
        </svg>
        {([0, 1, 2, 3] as const).map((i) => (
          <button
            key={i}
            type="button"
            ref={(el) => {
              handleRefs.current[i] = el
            }}
            tabIndex={0}
            aria-label={`Corner ${i + 1}`}
            onFocus={() => setSelectedCorner(i)}
            onPointerDown={(e) => onHandlePointerDown(i, e)}
            onPointerMove={(e) => onHandlePointerMove(i, e)}
            onPointerUp={(e) => onHandlePointerUp(i, e)}
            onPointerCancel={(e) => onHandlePointerUp(i, e)}
            className={`absolute z-10 flex touch-none items-center justify-center rounded-full border-2 bg-black/40 backdrop-blur-sm ${
              selectedCorner === i ? 'border-cyan-300 ring-2 ring-cyan-300/50' : 'border-white/80'
            }`}
            style={{ width: HANDLE_SIZE, height: HANDLE_SIZE }}
          >
            <span className="h-[8px] w-[8px] rounded-full bg-white" />
          </button>
        ))}
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
        {/* Owner's two deliberate borderline rules (2026-09-04) — kept small
            but always visible, right where the invalid-reason buttons are,
            since these are exactly the judgment calls that get made there. */}
        <div className="rounded-lg border border-white/10 bg-white/[0.03] px-[10px] py-[7px] text-[11px] leading-[16px] text-white/55">
          <b className="text-white/75">Borderline calls:</b> several cards but ONE is clearly the intended
          foreground subject → that's a <b className="text-emerald-300/90">positive</b>, label the foreground card
          (background-card suppression must stay trained in) — save it as usual, don't tap "multiple cards" below.
          Blurry but you can still confidently place the corners → also a{' '}
          <b className="text-emerald-300/90">positive</b> (a valuable hard example). "Too blurry" is only for when{' '}
          <i>you</i> can't confidently place them.
        </div>

        <div className="flex flex-wrap items-center gap-[6px]">
          {INVALID_REASONS.map((r) => (
            <button
              key={r.value}
              type="button"
              disabled={saving}
              onClick={() => onInvalid(r.value)}
              className="flex h-[32px] items-center gap-[6px] rounded-full border border-white/20 px-[11px] text-[11px] font-bold text-white/80 hover:bg-white/10 disabled:opacity-50"
            >
              <Icon name="close" size={12} /> {r.label}
            </button>
          ))}
        </div>

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
            onClick={() => onSaveLabel(corners)}
            className="flex h-[36px] items-center gap-[6px] rounded-full bg-cyan-400 px-[14px] text-[12px] font-bold text-cyan-950 hover:bg-cyan-300 disabled:opacity-50"
          >
            <Icon name="check" size={14} /> {saving ? 'Saving…' : 'Save label'}
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
