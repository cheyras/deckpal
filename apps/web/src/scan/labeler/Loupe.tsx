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

export const LOUPE_SIZE = 156

/**
 * ── THE ZOOM IS SIZED AGAINST THE CARD, NOT AGAINST PIXELS ─────────────────
 *
 * It used to be `LOUPE_ZOOM = 5` — a fixed multiplier on `reference` pixels —
 * and that was measurably the wrong instrument. `reference` is up to 1600 px
 * of whatever resolution the photo happened to be, so a constant multiplier
 * shows a constant number of PIXELS and a wildly varying amount of CARD.
 *
 * Worked through against the real geometry (`lib/cardGeometry.ts`: a 3 mm
 * radius on a 63 mm short edge, i.e. 4.76% of it), the old 132/5 = 26.4 px
 * window came out like this:
 *
 *   reference   card short edge   corner radius   window / radius
 *        800               560 px        26.7 px            0.99
 *       1200               840 px        40.0 px            0.66
 *       1600              1120 px        53.3 px            0.49
 *
 * In every realistic case the window was SMALLER THAN THE CORNER RADIUS. The
 * reader saw the tip of the arc and none of either straight edge — which is
 * the exact complaint that produced this change: *"it's so zoomed in that I
 * can't even see the actual edges that I'm trying to line it up with."*
 * Placing a corner means aligning two LINES, and the tool for it was showing
 * neither.
 *
 * So the window is now a fraction of the card's own short edge, measured off
 * the live quad. That number is constant across every resolution above (0.238
 * for "the arc plus about two radii of each edge"), which is the tell that the
 * card — not the pixel — was always the right unit.
 */
export const LOUPE_CARD_FRACTION = 0.24

/** How far the reader may step the window either way, and in what increments.
 *  The default above is an estimate from geometry; theirs is measured by eye,
 *  and this is what lets the two disagree without a code change. */
export const LOUPE_STEPS = [0.5, 0.7, 1, 1.4, 2, 2.8] as const
/** Index into `LOUPE_STEPS` — 1 means the derived window, unscaled. */
export const LOUPE_DEFAULT_STEP = 2
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
  windowPx,
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
  /**
   * How many SOURCE pixels the loupe spans, derived from the card's own size
   * by the caller. Replaces the old fixed `LOUPE_ZOOM`; see the note on
   * `LOUPE_CARD_FRACTION` for why a pixel multiplier could not work.
   */
  windowPx: number
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
    // The window the caller asked for, in source px, and the magnification that
    // implies. Guarded: a degenerate quad must not divide by zero.
    const span = Math.max(4, windowPx)
    const zoom = LOUPE_SIZE / span
    const half = span / 2
    /** Source pixel -> loupe canvas, in CSS px. The sample window is centred on
     *  the dragged corner, so the corner itself always lands on `mid`. */
    const toLoupe = (px: number, py: number): [number, number] => [
      mid + (px - centerX) * zoom,
      mid + (py - centerY) * zoom,
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
  }, [source, quad, sourceSize, cornerIndex, windowPx, centerX, centerY])

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
