// The corner loupe — a magnified inset sampled directly from the SHARP
// `reference` canvas (workingFrame.ts), independent of the main view's own
// zoom level. This is the exactness the owner asked for: dragging near a
// card edge shows the edge at a fixed high magnification no matter how far
// zoomed out the main view currently is.
//
// ── THE QUAD IS DRAWN INSIDE IT (owner request, 2026-09-08) ─────────────────
//
// Magnifying the pixels alone answers "where is the card's edge" and leaves
// the actually useful question — "where is MY edge relative to it" — to the
// main view, at 1x, which is the resolution the loupe exists to escape. A
// corner is placed correctly when the two LINES meeting at it lie along the
// card's printed border, and until those lines were in here the reader was
// aligning a crosshair against an edge by eye and hoping.
//
// The two edges MEETING AT THE DRAGGED CORNER are drawn bright; the far side
// of the quad is drawn faint. Both are hairlines — `lineWidth` is set in
// device pixels, not CSS pixels, so the line is genuinely one pixel wide on a
// phone rather than the 2-3 px smear a CSS-space stroke becomes. A thick line
// would cover the very boundary it is there to help you find.
import { useEffect, useRef } from 'react'
import type { Quad } from '../engine/contract'

export const LOUPE_SIZE = 132
export const LOUPE_ZOOM = 5
const CROSSHAIR = 'rgba(0, 211, 243, 0.95)'
/** The dragged corner's own two edges. Amber reads against card art (which is
 *  overwhelmingly not amber) and is the colour the editor already uses for
 *  "this is the one you are working on". */
const EDGE_LIVE = 'rgba(255, 190, 60, 0.95)'
/** The opposite edges. Present for context — a quad that has gone non-convex
 *  is visible here before it is anywhere else — without competing with the
 *  two lines being aimed. */
const EDGE_FAR = 'rgba(255, 255, 255, 0.38)'

export function Loupe({
  source,
  quad,
  sourceSize,
  cornerIndex,
  centerX,
  centerY,
  screenX,
  screenY,
  viewportW,
  viewportH,
}: {
  source: HTMLCanvasElement
  /** The whole quad, normalized [0,1] — the editor's own representation, so
   *  there is no second coordinate convention to keep in step. */
  quad: Quad
  /** `source`'s edge length in its own pixels; what `quad` is a fraction of. */
  sourceSize: number
  /** Which corner is being dragged — decides which two edges are the live ones. */
  cornerIndex: number
  /** Sample centre, in `source`'s own pixel space. */
  centerX: number
  centerY: number
  /** Where the dragged point currently sits on screen — the loupe offsets
   *  away from it so the finger/cursor never covers what it's magnifying. */
  screenX: number
  screenY: number
  viewportW: number
  viewportH: number
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    // BACKING STORE AT DEVICE RESOLUTION. Without this the loupe is a 132 px
    // bitmap stretched over 132 CSS px, which on a 3x phone is the one place
    // in this tool showing FEWER real pixels than the screen can — in the
    // component whose entire job is to show more of them.
    const dpr = Math.min(window.devicePixelRatio || 1, 3)
    if (canvas.width !== LOUPE_SIZE * dpr) {
      canvas.width = LOUPE_SIZE * dpr
      canvas.height = LOUPE_SIZE * dpr
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.imageSmoothingEnabled = true
    ctx.clearRect(0, 0, LOUPE_SIZE, LOUPE_SIZE)

    const mid = LOUPE_SIZE / 2
    const half = mid / LOUPE_ZOOM
    /** Source pixel -> loupe canvas, in CSS px. The sample window is centred on
     *  the dragged corner, so the corner itself always lands on `mid`. */
    const toLoupe = (px: number, py: number): [number, number] => [
      mid + (px - centerX) * LOUPE_ZOOM,
      mid + (py - centerY) * LOUPE_ZOOM,
    ]

    ctx.save()
    ctx.beginPath()
    ctx.arc(mid, mid, mid - 2, 0, Math.PI * 2)
    ctx.clip()
    ctx.drawImage(source, centerX - half, centerY - half, half * 2, half * 2, 0, 0, LOUPE_SIZE, LOUPE_SIZE)

    // The quad, INSIDE the clip so an edge cannot run out over the bezel.
    // A hairline: one device pixel, whatever the CSS transform above is.
    const pts = quad.map(([nx, ny]) => toLoupe(nx * sourceSize, ny * sourceSize))
    ctx.lineWidth = 1 / dpr
    ctx.lineCap = 'round'
    for (let i = 0; i < 4; i++) {
      const a = pts[i]!
      const b = pts[(i + 1) % 4]!
      // Edge i joins corner i to corner i+1, so the dragged corner's two edges
      // are i === cornerIndex and i === cornerIndex - 1 (mod 4).
      const live = i === cornerIndex || i === (cornerIndex + 3) % 4
      ctx.strokeStyle = live ? EDGE_LIVE : EDGE_FAR
      ctx.beginPath()
      ctx.moveTo(a[0], a[1])
      ctx.lineTo(b[0], b[1])
      ctx.stroke()
    }
    ctx.restore()

    // The crosshair last and on top: it marks the sample centre, which is the
    // corner itself, and it must stay findable against a busy full-art.
    ctx.strokeStyle = CROSSHAIR
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(mid - 8, mid)
    ctx.lineTo(mid + 8, mid)
    ctx.moveTo(mid, mid - 8)
    ctx.lineTo(mid, mid + 8)
    ctx.stroke()
  }, [source, quad, sourceSize, cornerIndex, centerX, centerY])

  // Prefer above-left of the touch point; flip to stay on screen near an edge.
  const margin = 16
  let left = screenX - LOUPE_SIZE - margin
  let top = screenY - LOUPE_SIZE - margin
  if (left < 0) left = screenX + margin
  if (top < 0) top = screenY + margin
  if (left + LOUPE_SIZE > viewportW) left = viewportW - LOUPE_SIZE - margin
  if (top + LOUPE_SIZE > viewportH) top = viewportH - LOUPE_SIZE - margin

  return (
    <canvas
      ref={canvasRef}
      width={LOUPE_SIZE}
      height={LOUPE_SIZE}
      // The CSS size is fixed; `width`/`height` above are re-set to the device
      // resolution in the effect. Both are needed: this is the first paint.
      style={{ left, top, width: LOUPE_SIZE, height: LOUPE_SIZE }}
      className="pointer-events-none absolute z-20 rounded-full shadow-[0_4px_16px_rgba(0,0,0,0.6)] ring-2 ring-cyan-300/80"
    />
  )
}
