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
// Persistence: PUT/GET/DELETE via the branch api dev instance (foil/api.ts) —
// committed ground-truth artifacts under data/foil-masks/ (see
// .claude/skills/mask-pipeline/SKILL.md).

import { useCallback, useEffect, useRef, useState } from 'react'

export const MASK_W = 490 // 2× the 245×337 card fraction — plenty for zone masks
export const MASK_H = Math.round((MASK_W * 337) / 245)

export type BrushMode = 'brush' | 'erase'

const TINT = 'rgba(255, 45, 100, 1)' // display tint; only alpha matters to the shader

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
  onStrokeEnd,
  registerHandle,
}: {
  /** The persistent mask canvas (owned by FoilLab so it outlives edit mode). */
  canvas: HTMLCanvasElement
  /** Card-face rect within the viewer host (px). */
  rect: { left: number; top: number; width: number; height: number }
  mode: BrushMode
  brushSize: number // px at mask resolution
  allowTouch: boolean
  onStrokeEnd: () => void
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
        c.clearRect(0, 0, MASK_W, MASK_H)
        c.fillStyle = TINT
        const [x, yUp, w, h] = r
        // layout rects are UV y-up; canvas is y-down
        const px = x * MASK_W
        const py = (1 - yUp - h) * MASK_H
        const pw = w * MASK_W
        const ph = h * MASK_H
        const rad = radiusFrac * MASK_W
        if (invert) {
          c.fillRect(0, 0, MASK_W, MASK_H)
          c.globalCompositeOperation = 'destination-out'
        }
        c.beginPath()
        c.roundRect(px, py, pw, ph, rad)
        c.fill()
        c.globalCompositeOperation = 'source-over'
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
    e.pointerType === 'pen' || e.pointerType === 'mouse' || (allowTouch && e.pointerType === 'touch')

  const strokeTo = (pts: { x: number; y: number; pressure: number }[]) => {
    const c = ctx()
    c.globalCompositeOperation = mode === 'erase' ? 'destination-out' : 'source-over'
    c.strokeStyle = TINT
    c.lineCap = 'round'
    c.lineJoin = 'round'
    for (const p of pts) {
      const w = brushSize * (p.pressure > 0 ? 0.5 + p.pressure : 1)
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

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!accepts(e)) return
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
      width={MASK_W}
      height={MASK_H}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endStroke}
      onPointerCancel={endStroke}
      className="absolute rounded-[4.7%/3.4%] opacity-45"
      style={{
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        touchAction: 'none',
        cursor: 'crosshair',
      }}
    />
  )
}
