// foil/MaskEditor.tsx — Apple Pencil (and mouse) hand-mask drawing.
//
// A canvas overlay aligned exactly to the card face (cardScreenRect — the card
// is tilted flat while editing). The canvas's ALPHA channel is the mask
// (opaque = foil); RGB is just the on-screen tint. The same canvas is sampled
// by the shader as uMaskTex, so strokes are live on the foil immediately.
//
// Input rules (per the workbench spec):
//   - pointerType 'pen' (Apple Pencil) and 'mouse' draw by default; 'touch'
//     only when the allow-finger toggle is on — palms don't paint.
//   - touch-action: none while editing so a stroke never scrolls the page.
//   - pen pressure modulates brush width; coalesced events keep strokes smooth.
//   - undo keeps the last 12 stroke snapshots.
//
// PAN/ZOOM (foil/ViewTransform.tsx): the overlay lives inside a CSS-transformed
// wrapper, so `rect` stays in BASE (unzoomed) coords and the pointer→texel map
// needs no zoom term at all — getBoundingClientRect() already reports the
// transformed on-screen box. Two things do care about zoom:
//   - the brush is SCREEN-CONSTANT (see `brushSize` below), so the mask-space
//     line width is divided by the zoom;
//   - a pinch that lands mid-stroke calls cancelStroke(), which rolls the
//     stroke back off the canvas (a two-finger gesture must not leave a dab).
//
// Persistence: PUT/GET/DELETE via the branch api dev instance (foil/api.ts) —
// committed ground-truth artifacts under data/foil-masks/ (see
// .claude/skills/mask-pipeline/SKILL.md). The zoom NEVER touches the mask
// canvas itself, so a save from a zoomed view is byte-identical to one at 1×.

import { useCallback, useEffect, useRef, useState } from 'react'
import { rasterizeWindowRect } from './WindowEditor'
import type { ViewController } from './ViewTransform'

export const MASK_W = 490 // 2× the 245×337 card fraction — plenty for zone masks
export const MASK_H = Math.round((MASK_W * 337) / 245)

export type BrushMode = 'brush' | 'erase'

export const MASK_TINT = 'rgba(255, 45, 100, 1)' // display tint; only alpha matters to the shader
const TINT = MASK_TINT

export interface MaskEditorHandle {
  canvas: HTMLCanvasElement
  /** Rasterize the layout-tier rect into the canvas (start-from-prior). */
  loadLayoutRect: (rect: [number, number, number, number], invert: boolean, radiusFrac: number) => void
  loadImage: (img: HTMLImageElement | ImageBitmap) => void
  clear: () => void
  fill: () => void
  undo: () => boolean
  toDataUrl: () => string
}

export function createMaskCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = MASK_W
  c.height = MASK_H
  return c
}

export function MaskEditor({
  canvas,
  rect,
  mode,
  brushSize,
  allowTouch,
  view,
  onStrokeEnd,
  onStrokeCancel,
  registerHandle,
}: {
  /** The persistent mask canvas (owned by FoilLab so it outlives edit mode). */
  canvas: HTMLCanvasElement
  /** Card-face rect within the viewer host (px) — BASE coords, pre-zoom. */
  rect: { left: number; top: number; width: number; height: number }
  mode: BrushMode
  /**
   * Brush width in mask px AT 1× ZOOM. The brush is deliberately
   * SCREEN-CONSTANT: at zoom z the mask-space width is brushSize/z, so the tip
   * keeps the same apparent size on screen and zooming in buys finer control —
   * which is the point of zooming while tracing a printed edge. (Mask-constant
   * would make a 4× zoom paint a 4×-fatter-looking stroke and defeat the
   * feature.)
   */
  brushSize: number
  allowTouch: boolean
  /** Pan/zoom controller — brush scaling + stroke/gesture arbitration. */
  view?: ViewController
  onStrokeEnd: () => void
  /** A gesture aborted the stroke — pixels were rolled back, nothing painted. */
  onStrokeCancel?: () => void
  registerHandle?: (h: MaskEditorHandle) => void
}) {
  const displayRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const last = useRef<{ x: number; y: number } | null>(null)
  const undoStack = useRef<ImageData[]>([])
  const [, bump] = useState(0)

  const ctx = useCallback(() => canvas.getContext('2d')!, [canvas])

  // Blit the data canvas onto the visible one (cheap at 490×674).
  const repaint = useCallback(() => {
    const disp = displayRef.current
    if (!disp) return
    const dctx = disp.getContext('2d')!
    dctx.clearRect(0, 0, disp.width, disp.height)
    dctx.drawImage(canvas, 0, 0)
  }, [canvas])

  useEffect(() => {
    repaint()
  })

  // Expose imperative ops to FoilLab.
  useEffect(() => {
    if (!registerHandle) return
    const c = ctx()
    registerHandle({
      canvas,
      loadLayoutRect: (r, invert, radiusFrac) => {
        // Shared rasterizer (WindowEditor.tsx) — the Flatten action bakes the
        // exact same pixels this editor would start from.
        rasterizeWindowRect(canvas, r, invert, radiusFrac, TINT)
        undoStack.current = []
        repaint()
        bump((n) => n + 1)
      },
      loadImage: (img) => {
        c.clearRect(0, 0, MASK_W, MASK_H)
        c.drawImage(img, 0, 0, MASK_W, MASK_H)
        undoStack.current = []
        repaint()
        bump((n) => n + 1)
      },
      clear: () => {
        pushUndo()
        c.clearRect(0, 0, MASK_W, MASK_H)
        repaint()
        onStrokeEnd()
      },
      fill: () => {
        pushUndo()
        c.fillStyle = TINT
        c.fillRect(0, 0, MASK_W, MASK_H)
        repaint()
        onStrokeEnd()
      },
      undo: () => {
        const prev = undoStack.current.pop()
        if (!prev) return false
        c.putImageData(prev, 0, 0)
        repaint()
        onStrokeEnd()
        return true
      },
      toDataUrl: () => canvas.toDataURL('image/png'),
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvas, registerHandle, onStrokeEnd])

  const pushUndo = () => {
    const c = ctx()
    undoStack.current.push(c.getImageData(0, 0, MASK_W, MASK_H))
    if (undoStack.current.length > 12) undoStack.current.shift()
  }

  const toMask = (e: { clientX: number; clientY: number }) => {
    const disp = displayRef.current!
    const r = disp.getBoundingClientRect()
    return {
      x: ((e.clientX - r.left) / r.width) * MASK_W,
      y: ((e.clientY - r.top) / r.height) * MASK_H,
    }
  }

  const accepts = (e: React.PointerEvent) =>
    !view?.gesturing() &&
    (e.pointerType === 'pen' || e.pointerType === 'mouse' || (allowTouch && e.pointerType === 'touch'))

  const strokeTo = (pts: { x: number; y: number; pressure: number }[]) => {
    const c = ctx()
    const zoom = view?.view.current.zoom ?? 1
    c.globalCompositeOperation = mode === 'erase' ? 'destination-out' : 'source-over'
    c.strokeStyle = TINT
    c.lineCap = 'round'
    c.lineJoin = 'round'
    for (const p of pts) {
      // Screen-constant brush: mask-space width shrinks with zoom.
      const w = (brushSize * (p.pressure > 0 ? 0.5 + p.pressure : 1)) / zoom
      c.lineWidth = w
      c.beginPath()
      const from = last.current ?? p
      c.moveTo(from.x, from.y)
      c.lineTo(p.x, p.y)
      c.stroke()
      last.current = { x: p.x, y: p.y }
    }
    c.globalCompositeOperation = 'source-over'
  }

  /**
   * A pan/pinch started mid-stroke: undo the partial stroke so a two-finger
   * gesture never leaves a stray dab (the undo snapshot pushed at pointerdown
   * is popped, not kept — the stroke never happened).
   */
  const cancelStroke = useCallback(() => {
    if (!drawing.current) return
    drawing.current = false
    last.current = null
    const prev = undoStack.current.pop()
    if (prev) {
      canvas.getContext('2d')!.putImageData(prev, 0, 0)
      repaint()
    }
    onStrokeCancel?.()
  }, [canvas, repaint, onStrokeCancel])

  useEffect(() => {
    if (!view) return
    view.setStrokeAbort(cancelStroke)
    return () => view.setStrokeAbort(null)
  }, [view, cancelStroke])

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!accepts(e)) return
    // No selection, no drag ghost, no iOS callout from a paint gesture.
    e.preventDefault()
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* synthetic events (tests) have no active pointer — capture is best-effort */
    }
    pushUndo()
    drawing.current = true
    last.current = null
    const p = toMask(e)
    strokeTo([{ ...p, pressure: e.pressure }])
    repaint()
  }
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || !accepts(e)) return
    const native = e.nativeEvent as PointerEvent
    const events = typeof native.getCoalescedEvents === 'function' ? native.getCoalescedEvents() : [native]
    strokeTo(events.map((ev) => ({ ...toMask(ev), pressure: ev.pressure })))
    repaint()
  }
  const endStroke = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return
    drawing.current = false
    last.current = null
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* already released */
    }
    onStrokeEnd()
  }

  return (
    <canvas
      ref={displayRef}
      data-testid="mask-canvas"
      width={MASK_W}
      height={MASK_H}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endStroke}
      onPointerCancel={endStroke}
      onDragStart={(e) => e.preventDefault()}
      draggable={false}
      className="absolute rounded-[4.7%/3.4%] opacity-45"
      style={{
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        touchAction: 'none',
        pointerEvents: 'auto',
        // 'grab'/'grabbing' while Space is held — the controller sets the var.
        cursor: 'var(--foil-cursor, crosshair)',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none',
        WebkitUserDrag: 'none',
      } as React.CSSProperties}
    />
  )
}
