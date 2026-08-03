// foil/WindowEditor.tsx — draggable handles for adjusting the layout window
// rect per card (foil/mask-refine: Chey's "handles to adjust the window mask,
// then that can be flattened to a mask that can be refined by hand").
//
// An overlay aligned to the card face (cardScreenRect, card tilted flat while
// adjusting — same convention as MaskEditor). The geometry model is the SAME
// rounded axis-aligned rect the layout tier uses (UV y-up [x,y,w,h] + corner
// radius, maskForScope's output space) — so an adjusted window flows unchanged
// into the shader uniforms, the flatten rasterizer, and the persisted sidecar.
// Deliberately NO perspective/skew handles: cache scans are straightened, and
// anything a rect can't express is exactly what the hand-refine paint pass
// after Flatten is for.
//
// Touch rules: handles are 44px hit targets (finger-sized at 390px width);
// FINGERS DRAG BY DESIGN — unlike painting, dragging a handle is a coarse
// gesture, so there is no pen-only gate here. touch-action: none while
// adjusting so a drag never scrolls the page.

import { useRef } from 'react'

/** Adjusted window geometry — UV y-up rect + corner radius (fraction of card width). */
export interface WindowGeom {
  rect: [number, number, number, number]
  radius: number
}

type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'move'

/** Minimum window width/height, fraction of the card face. */
const MIN_FRAC = 0.05

/** y-down fractional box (origin top-left — screen space math is simpler here). */
interface Box {
  x: number
  y: number
  w: number
  h: number
}

const toBox = (r: [number, number, number, number]): Box => ({ x: r[0], y: 1 - r[1] - r[3], w: r[2], h: r[3] })
const fromBox = (b: Box): [number, number, number, number] => [b.x, 1 - b.y - b.h, b.w, b.h]
const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi)

function applyDrag(b: Box, id: HandleId, dx: number, dy: number): Box {
  if (id === 'move') {
    return { ...b, x: clamp(b.x + dx, 0, 1 - b.w), y: clamp(b.y + dy, 0, 1 - b.h) }
  }
  let { x, y, w, h } = b
  const right = x + w
  const bottom = y + h
  if (id.includes('w')) {
    const nx = clamp(x + dx, 0, right - MIN_FRAC)
    w = right - nx
    x = nx
  }
  if (id.includes('e')) {
    const nr = clamp(right + dx, x + MIN_FRAC, 1)
    w = nr - x
  }
  if (id.includes('n')) {
    const ny = clamp(y + dy, 0, bottom - MIN_FRAC)
    h = bottom - ny
    y = ny
  }
  if (id.includes('s')) {
    const nb = clamp(bottom + dy, y + MIN_FRAC, 1)
    h = nb - y
  }
  return { x, y, w, h }
}

const CURSORS: Record<HandleId, string> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
  move: 'move',
}

export function WindowEditor({
  rect,
  value,
  onChange,
}: {
  /** Card-face rect within the viewer host (px) — cardScreenRect output. */
  rect: { left: number; top: number; width: number; height: number }
  value: WindowGeom
  /** Fired live during a drag with the updated geometry. */
  onChange: (v: WindowGeom) => void
}) {
  const drag = useRef<{ id: HandleId; startX: number; startY: number; box: Box } | null>(null)

  const box = toBox(value.rect)
  const px = {
    left: box.x * rect.width,
    top: box.y * rect.height,
    width: box.w * rect.width,
    height: box.h * rect.height,
  }
  const radiusPx = value.radius * rect.width

  const onDown = (id: HandleId) => (e: React.PointerEvent<HTMLElement>) => {
    e.preventDefault()
    e.stopPropagation()
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* synthetic events (tests) — capture is best-effort */
    }
    drag.current = { id, startX: e.clientX, startY: e.clientY, box }
  }
  const onMove = (e: React.PointerEvent<HTMLElement>) => {
    const d = drag.current
    if (!d) return
    const dx = (e.clientX - d.startX) / rect.width
    const dy = (e.clientY - d.startY) / rect.height
    onChange({ ...value, rect: fromBox(applyDrag(d.box, d.id, dx, dy)) })
  }
  const onUp = (e: React.PointerEvent<HTMLElement>) => {
    if (!drag.current) return
    drag.current = null
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* already released */
    }
  }

  // Handle anchor positions on the box (fractions of the BOX).
  const anchors: { id: HandleId; ax: number; ay: number; corner: boolean }[] = [
    { id: 'nw', ax: 0, ay: 0, corner: true },
    { id: 'ne', ax: 1, ay: 0, corner: true },
    { id: 'se', ax: 1, ay: 1, corner: true },
    { id: 'sw', ax: 0, ay: 1, corner: true },
    { id: 'n', ax: 0.5, ay: 0, corner: false },
    { id: 'e', ax: 1, ay: 0.5, corner: false },
    { id: 's', ax: 0.5, ay: 1, corner: false },
    { id: 'w', ax: 0, ay: 0.5, corner: false },
  ]

  const handleProps = (id: HandleId) => ({
    onPointerDown: onDown(id),
    onPointerMove: onMove,
    onPointerUp: onUp,
    onPointerCancel: onUp,
  })

  return (
    <div
      className="absolute"
      style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height, pointerEvents: 'none' }}
    >
      {/* The window box: dashed outline + faint fill; interior drags to move. */}
      <div
        {...handleProps('move')}
        data-window-handle="move"
        className="absolute border-[1.5px] border-dashed border-[rgba(255,45,100,0.95)] bg-[rgba(255,45,100,0.08)]"
        style={{
          left: px.left,
          top: px.top,
          width: px.width,
          height: px.height,
          borderRadius: radiusPx,
          pointerEvents: 'auto',
          touchAction: 'none',
          cursor: CURSORS.move,
        }}
      />
      {/* Edge bars first, corner dots after (corners win overlap at small sizes). */}
      {anchors.map(({ id, ax, ay, corner }) => (
        <div
          key={id}
          {...handleProps(id)}
          data-window-handle={id}
          className="absolute flex items-center justify-center"
          style={{
            left: px.left + ax * px.width,
            top: px.top + ay * px.height,
            width: 44,
            height: 44,
            transform: 'translate(-50%, -50%)',
            pointerEvents: 'auto',
            touchAction: 'none',
            cursor: CURSORS[id],
            zIndex: corner ? 2 : 1,
          }}
        >
          {corner ? (
            <span className="block h-[16px] w-[16px] rounded-full border-2 border-white bg-[rgb(255,45,100)] shadow-[0_1px_4px_rgba(0,0,0,0.6)]" />
          ) : (
            <span
              className="block rounded-full border border-white/80 bg-[rgb(255,45,100)] shadow-[0_1px_4px_rgba(0,0,0,0.6)]"
              style={id === 'n' || id === 's' ? { width: 22, height: 8 } : { width: 8, height: 22 }}
            />
          )}
        </div>
      ))}
    </div>
  )
}

/**
 * Rasterize a rounded window rect into a mask canvas (alpha = foil coverage)
 * — the Flatten action and MaskEditor's loadLayoutRect share this so a baked
 * mask is pixel-identical to what the editor would start from.
 */
export function rasterizeWindowRect(
  canvas: HTMLCanvasElement,
  rect: [number, number, number, number],
  invert: boolean,
  radiusFrac: number,
  tint: string,
): void {
  const W = canvas.width
  const H = canvas.height
  const c = canvas.getContext('2d')!
  c.clearRect(0, 0, W, H)
  c.fillStyle = tint
  const [x, yUp, w, h] = rect
  // layout rects are UV y-up; canvas is y-down
  const pxX = x * W
  const pxY = (1 - yUp - h) * H
  const pxW = w * W
  const pxH = h * H
  const rad = radiusFrac * W
  if (invert) {
    c.fillRect(0, 0, W, H)
    c.globalCompositeOperation = 'destination-out'
  }
  c.beginPath()
  c.roundRect(pxX, pxY, pxW, pxH, rad)
  c.fill()
  c.globalCompositeOperation = 'source-over'
}
