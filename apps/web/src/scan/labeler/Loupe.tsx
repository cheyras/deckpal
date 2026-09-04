// The corner loupe — a magnified inset sampled directly from the SHARP
// `reference` canvas (workingFrame.ts), independent of the main view's own
// zoom level. This is the exactness the owner asked for: dragging near a
// card edge shows the edge at a fixed high magnification no matter how far
// zoomed out the main view currently is.
import { useEffect, useRef } from 'react'

export const LOUPE_SIZE = 132
export const LOUPE_ZOOM = 5
const CROSSHAIR = 'rgba(0, 211, 243, 0.95)'

export function Loupe({
  source,
  centerX,
  centerY,
  screenX,
  screenY,
  viewportW,
  viewportH,
}: {
  source: HTMLCanvasElement
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
    ctx.imageSmoothingEnabled = true
    ctx.clearRect(0, 0, LOUPE_SIZE, LOUPE_SIZE)
    const half = LOUPE_SIZE / 2 / LOUPE_ZOOM
    ctx.save()
    ctx.beginPath()
    ctx.arc(LOUPE_SIZE / 2, LOUPE_SIZE / 2, LOUPE_SIZE / 2 - 2, 0, Math.PI * 2)
    ctx.clip()
    ctx.drawImage(source, centerX - half, centerY - half, half * 2, half * 2, 0, 0, LOUPE_SIZE, LOUPE_SIZE)
    ctx.restore()
    ctx.strokeStyle = CROSSHAIR
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(LOUPE_SIZE / 2 - 8, LOUPE_SIZE / 2)
    ctx.lineTo(LOUPE_SIZE / 2 + 8, LOUPE_SIZE / 2)
    ctx.moveTo(LOUPE_SIZE / 2, LOUPE_SIZE / 2 - 8)
    ctx.lineTo(LOUPE_SIZE / 2, LOUPE_SIZE / 2 + 8)
    ctx.stroke()
  }, [source, centerX, centerY])

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
      className="pointer-events-none absolute z-20 rounded-full shadow-[0_4px_16px_rgba(0,0,0,0.6)] ring-2 ring-cyan-300/80"
      style={{ left, top }}
    />
  )
}
