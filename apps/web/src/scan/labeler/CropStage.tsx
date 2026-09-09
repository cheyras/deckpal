// Choose the square an upload is cropped to, before the editor opens.
//
// ── WHY THIS EXISTS (owner request, 2026-09-08) ─────────────────────────────
//
// Uploads used to take the CENTRE square, unconditionally, because that is
// what the live path does and the whole design goal of workingFrame.ts was
// that a camera frame and an upload become indistinguishable. The camera has a
// real reason for it — the working-frame invariant makes the canonical frame a
// pure function of the stream, so a frame the reader could re-aim afterwards
// would break the guarantee that a label and a runtime detection describe the
// same square. An upload has no such reason: the photo is already taken, and
// forcing the centre square silently discarded every card that happened to sit
// off-centre, or cropped a landscape photo to a strip through the middle of it.
//
// So: same draw path, same canonical square, one thing chosen by hand. The
// chosen square lands in `QuadLabelBase.crop`, which every row has carried
// since the schema was written, so a harvest can tell a hand-framed row from a
// centred one without a new field.
//
// ── THE CARD-ASPECT GUIDE IS NOT A CONSTRAINT ───────────────────────────────
//
// The dashed card rectangle inside the square is the SAME `reticleForAspect`
// the capture stage and the product scanner draw. It is there so the reader can
// see how the card will sit relative to what the detector aims at — not to
// force them to fill it. Labelling a card that is small in frame, or rotated,
// or half out of it, is a legitimate and useful row; a crop tool that refused
// those would quietly bias the corpus toward the easy ones.
import { useLayoutEffect, useRef, useState } from 'react'
import { Icon } from '../../components/Icon'
import { reticleForAspect, squareCrop, type SquareCrop } from '../engine/frame'
import { buildPaddedPreview, clampCropAllowingPad, cropPad, isPadded } from './workingFrame'

/** How small the square may get, as a fraction of the shorter source edge. A
 *  crop below this is upscaling a handful of pixels into a 416 px canonical
 *  frame, which produces a label the detector can never reproduce. */
const MIN_CROP_FRACTION = 0.12

export function CropStage({
  image,
  sourceWidth,
  sourceHeight,
  queued,
  onConfirm,
  onSkip,
}: {
  image: CanvasImageSource
  sourceWidth: number
  sourceHeight: number
  /** How many photos are still behind this one — the reader's place in the run. */
  queued: number
  onConfirm: (crop: SquareCrop) => void
  /** Take the centre square, the pre-2026-09-08 behaviour, in one tap. */
  onSkip: () => void
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [box, setBox] = useState({ width: 0, height: 0 })
  const [crop, setCrop] = useState<SquareCrop>(() => squareCrop(sourceWidth, sourceHeight))

  const minSize = Math.max(16, Math.round(Math.min(sourceWidth, sourceHeight) * MIN_CROP_FRACTION))

  useLayoutEffect(() => {
    const el = boxRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const r = entry?.contentRect
      if (r) setBox({ width: r.width, height: r.height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // The whole photo, letterboxed into the box — `contain`, not `cover`, because
  // the reader is choosing a region and cannot choose one they cannot see.
  const fit = box.width && box.height ? Math.min(box.width / sourceWidth, box.height / sourceHeight) : 0
  const drawW = sourceWidth * fit
  const drawH = sourceHeight * fit
  const offX = (box.width - drawW) / 2
  const offY = (box.height - drawH) / 2

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx || !drawW || !drawH) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.round(drawW * dpr)
    canvas.height = Math.round(drawH * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, drawW, drawH)
    ctx.drawImage(image, 0, 0, sourceWidth, sourceHeight, 0, 0, drawW, drawH)
  }, [image, sourceWidth, sourceHeight, drawW, drawH])

  /** Source px -> CSS px inside the box. */
  const sx = (v: number) => offX + v * fit
  const sy = (v: number) => offY + v * fit

  // ── the gesture ───────────────────────────────────────────────────────────
  // One pointer moves the square; a second pinches its size. The whole region
  // is the drag target rather than a 44 px grab strip, because on a phone a
  // handle small enough not to hide the photo is too small to hit.
  const drag = useRef<{ id: number; sxp: number; syp: number; start: SquareCrop } | null>(null)
  const pinch = useRef<{ ids: [number, number]; dist: number; start: SquareCrop } | null>(null)
  const points = useRef(new Map<number, { x: number; y: number }>())

  // THE SQUARE MAY LEAVE THE PHOTO NOW (owner ruling, 2026-09-08). What used to
  // be `clampCrop` — pull it back inside — is `clampCropAllowingPad`, which
  // only keeps enough of each axis over real pixels for the mirror to have
  // something to mirror. The gap is filled by reflection, drawn live below, so
  // the reader is choosing against the thing they will actually get.
  const apply = (next: SquareCrop) =>
    setCrop(clampCropAllowingPad({ ...next, size: Math.max(minSize, next.size) }, sourceWidth, sourceHeight))

  const onDown = (e: React.PointerEvent) => {
    const target = e.target as Element
    target.setPointerCapture?.(e.pointerId)
    points.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (points.current.size === 2) {
      const entries = [...points.current.entries()]
      const a = entries[0]
      const b = entries[1]
      if (!a || !b) return
      pinch.current = {
        ids: [a[0], b[0]],
        dist: Math.hypot(a[1].x - b[1].x, a[1].y - b[1].y),
        start: crop,
      }
      drag.current = null
      return
    }
    drag.current = { id: e.pointerId, sxp: e.clientX, syp: e.clientY, start: crop }
  }

  const onMove = (e: React.PointerEvent) => {
    if (!points.current.has(e.pointerId)) return
    points.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const p = pinch.current
    if (p) {
      const a = points.current.get(p.ids[0])
      const b = points.current.get(p.ids[1])
      if (!a || !b || !p.dist) return
      const ratio = Math.hypot(a.x - b.x, a.y - b.y) / p.dist
      // Fingers apart => a SMALLER crop, i.e. the photo magnifies, matching the
      // pinch-to-zoom every other surface in this app uses.
      const size = p.start.size / ratio
      // Grow/shrink about the square's own centre, so what the reader is
      // looking at stays under their fingers.
      const cx = p.start.x + p.start.size / 2
      const cy = p.start.y + p.start.size / 2
      apply({ size, x: cx - size / 2, y: cy - size / 2 })
      return
    }
    const d = drag.current
    if (!d || !fit) return
    // The square follows the finger: dragging left moves the crop window left
    // over the photo, which means its x DECREASES as clientX increases.
    apply({ ...d.start, x: d.start.x - (e.clientX - d.sxp) / fit, y: d.start.y - (e.clientY - d.syp) / fit })
  }

  const onUp = (e: React.PointerEvent) => {
    points.current.delete(e.pointerId)
    if (points.current.size < 2) pinch.current = null
    if (drag.current?.id === e.pointerId) drag.current = null
  }

  const onWheel = (e: React.WheelEvent) => {
    const size = crop.size * (e.deltaY > 0 ? 1.06 : 1 / 1.06)
    const cx = crop.x + crop.size / 2
    const cy = crop.y + crop.size / 2
    apply({ size, x: cx - size / 2, y: cy - size / 2 })
  }

  const r = reticleForAspect()
  const cropCss = { left: sx(crop.x), top: sy(crop.y), width: crop.size * fit, height: crop.size * fit }
  const pct = Math.round((crop.size / Math.min(sourceWidth, sourceHeight)) * 100)
  const pad = cropPad(crop, sourceWidth, sourceHeight)
  const padded = isPadded(pad)

  // ── THE MIRRORED FILL, DRAWN LIVE ────────────────────────────────────────
  //
  // Rendered by the SAME `drawSquarePadded` the working frame uses (through
  // `buildPaddedPreview`), never a second renderer — the point of showing it is
  // to decide a crop by looking at the result, and a preview that could
  // disagree with the result is worse than no preview.
  //
  // Small and upscaled on purpose: 256 px is plenty to judge a reflection seam
  // at this size, and it keeps a redraw-per-drag-frame cheap on a phone.
  const padPreviewRef = useRef<HTMLCanvasElement>(null)
  useLayoutEffect(() => {
    const host = padPreviewRef.current
    if (!host) return
    const ctx = host.getContext('2d')
    if (!ctx) return
    if (!padded) {
      ctx.clearRect(0, 0, host.width, host.height)
      return
    }
    try {
      const built = buildPaddedPreview(image, sourceWidth, sourceHeight, crop, 256)
      host.width = built.width
      host.height = built.height
      ctx.drawImage(built, 0, 0)
    } catch {
      // The only throw is "no overlap", which `clampCropAllowingPad` already
      // prevents. Leave the last good frame rather than flashing an empty one.
    }
  }, [image, sourceWidth, sourceHeight, crop, padded])

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-neutral-950">
      <div className="flex shrink-0 items-center gap-[8px] px-[12px] py-[6px] text-[11px] leading-[15px] text-white/60">
        <Icon name="camera" size={13} className="shrink-0 text-cyan-300" />
        <span className="min-w-0 flex-1">
          Drag to move the crop · pinch or scroll to resize · the dashed card is where the scanner aims
        </span>
        {queued > 0 && <span className="shrink-0 text-white/40">{queued} more queued</span>}
      </div>

      <div
        ref={boxRef}
        className="relative min-h-0 flex-1 touch-none overflow-hidden bg-black"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onWheel={onWheel}
      >
        <canvas
          ref={canvasRef}
          className="pointer-events-none absolute"
          style={{ left: offX, top: offY, width: drawW, height: drawH }}
        />
        {fit > 0 && (
          <>
            {/* Everything OUTSIDE the square, dimmed — four rects rather than a
                huge box-shadow so the dimming is clipped to the photo and never
                painted over the letterbox, where there is nothing to dim. */}
            <div
              className="pointer-events-none absolute bg-black/55"
              style={{ left: offX, top: offY, width: drawW, height: Math.max(0, cropCss.top - offY) }}
            />
            <div
              className="pointer-events-none absolute bg-black/55"
              style={{
                left: offX,
                top: cropCss.top + cropCss.height,
                width: drawW,
                height: Math.max(0, offY + drawH - (cropCss.top + cropCss.height)),
              }}
            />
            <div
              className="pointer-events-none absolute bg-black/55"
              style={{ left: offX, top: cropCss.top, width: Math.max(0, cropCss.left - offX), height: cropCss.height }}
            />
            <div
              className="pointer-events-none absolute bg-black/55"
              style={{
                left: cropCss.left + cropCss.width,
                top: cropCss.top,
                width: Math.max(0, offX + drawW - (cropCss.left + cropCss.width)),
                height: cropCss.height,
              }}
            />
            {/* The mirrored fill, positioned exactly under the crop square, so
                the parts of it that hang off the photo show reflected pixels
                instead of the black the stage would otherwise leave. Drawn
                before the outline and the guide so both stay on top. */}
            {padded && (
              <canvas
                ref={padPreviewRef}
                className="pointer-events-none absolute"
                style={{ ...cropCss, imageRendering: 'auto' }}
              />
            )}
            {/* The square itself, and the card-aspect guide inside it. */}
            <div className="pointer-events-none absolute border border-cyan-300/90" style={cropCss}>
              <div
                className="absolute rounded-[6px] border border-dashed border-cyan-300/45"
                style={{
                  left: r.x * cropCss.width,
                  top: r.y * cropCss.height,
                  width: r.w * cropCss.width,
                  height: r.h * cropCss.height,
                }}
              />
              {/* Corner ticks — the affordance that says "this is a region",
                  sized to read without competing with the card guide. */}
              {[
                'left-[-1px] top-[-1px] border-l-2 border-t-2',
                'right-[-1px] top-[-1px] border-r-2 border-t-2',
                'left-[-1px] bottom-[-1px] border-l-2 border-b-2',
                'right-[-1px] bottom-[-1px] border-r-2 border-b-2',
              ].map((c) => (
                <span key={c} className={`absolute h-[14px] w-[14px] border-cyan-300 ${c}`} />
              ))}
            </div>
          </>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-[8px] border-t border-white/10 bg-neutral-900 p-[10px]">
        <button
          type="button"
          onClick={() => setCrop(squareCrop(sourceWidth, sourceHeight))}
          className="h-[44px] rounded-full bg-white/10 px-[14px] text-[12px] font-bold text-white/70 hover:bg-white/15"
        >
          Centre
        </button>
        <span className="font-mono text-[11px] text-white/40">
          {crop.size}px · {pct}%
        </span>
        {padded && (
          <span
            className="rounded bg-amber-400/15 px-[6px] py-[2px] text-[10px] font-bold text-amber-300"
            title="Part of this square is outside the photo and is filled by mirroring the photo's own pixels. It is recorded on the label."
          >
            mirrored edge
          </span>
        )}
        <div className="flex-1" />
        <button
          type="button"
          onClick={onSkip}
          title="Take the centre square, as uploads did before this step existed"
          className="h-[44px] rounded-full bg-white/10 px-[14px] text-[12px] font-bold text-white/70 hover:bg-white/15"
        >
          Skip
        </button>
        <button
          type="button"
          onClick={() => onConfirm(clampCropAllowingPad(crop, sourceWidth, sourceHeight))}
          className="h-[44px] rounded-full bg-cyan-400 px-[20px] text-[12px] font-bold text-cyan-950 hover:bg-cyan-300"
        >
          Use this crop
        </button>
      </div>
    </div>
  )
}
