// Live camera + the standardized reticle, per the owner's 2026-09-04 ruling
// (engine/frame.ts): a dashed square showing the centre-crop the working
// frame will be drawn from, and inside it the standardized card-aspect
// reticle (`reticleForAspect`) — the SAME guide the product scanner draws
// once it adopts frame.ts (see workingFrame.ts's header for why that
// migration isn't finished yet, and why this tool leads with the target
// format rather than the currently-shipped one).
//
// ── LIVE DETECTION IS OPT-IN, AND OFF BY DEFAULT ───────────────────────────
//
// It used to be absent, with a good reason written here: the detector runs ONCE
// on the frozen frame after the shutter (detectSeed.ts), and running it
// continuously during framing burns the model for a view nobody is about to
// save. That reason still holds for LABELLING, which is what this stage is
// normally doing — a reader working through a stack of cards gets nothing from
// a detector opinion on the half-second before they press the button.
//
// It does NOT hold for the job the `live` prop exists for (owner request,
// 2026-09-08): walking around a room to find out what the shipping pipeline
// mistakes for a card. There the whole product IS the continuous opinion, and
// the frames worth capturing are precisely the ones the reader cannot identify
// by eye — a doorframe the presence head scores 0.42 looks exactly like a
// doorframe it scores 0.02. So the cost is paid deliberately, only while the
// toggle is on, and the readout says what it bought (SweepReadout).
//
// The engine drives the SAME `<video>` this stage already owns, so there is one
// camera and one stream whichever mode is running; `useScanEngine` starts and
// stops with the toggle and holds nothing when it is off.
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../../components/Icon'
import { useCamera } from '../ui/camera'
import { coverMap, framePointToCss } from '../ui/coords'
import { squareCrop, reticleForAspect } from '../engine/frame'
import { QuadOverlay } from '../ui/QuadOverlay'
import { useScanEngine } from '../ui/useScanEngine'
import { SweepReadout } from './SweepReadout'
import { sweepVerdict, type SweepVerdict } from './sweep'
import { buildWorkingFrame, type WorkingFrame } from './workingFrame'

export function CaptureStage({
  active,
  live,
  rapid,
  queued,
  onCaptured,
  onQueued,
}: {
  active: boolean
  /** Run the shipping engine continuously against the preview. See the header. */
  live: boolean
  /**
   * RAPID MODE (owner request, 2026-09-08): the shutter files the frame in the
   * persistent queue and stays live, instead of freezing it and opening the
   * editor. For shooting a stack of cards in one pass and labelling later.
   *
   * The frame is kept at the CAMERA'S OWN RESOLUTION, as a JPEG, not as a
   * canonical square — because the crop step comes later and cannot invent
   * pixels a 416 px square already threw away. That is the whole reason this
   * path does not just call `buildWorkingFrame` early.
   */
  rapid: boolean
  /** How many photos are already waiting — the count on the shutter. */
  queued: number
  /** The frozen frame, plus what the LIVE detector was saying at the instant the
   *  shutter fired — null when the sweep was off. That verdict is the reason to
   *  capture this frame at all, so it travels with it rather than being
   *  re-derived (it could not be: the engine has moved on by then). */
  onCaptured: (frame: WorkingFrame, verdict: SweepVerdict | null) => void
  /** Rapid mode's shutter: the full-resolution frame, for the queue. */
  onQueued: (blob: Blob, verdict: SweepVerdict | null) => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ width: 0, height: 0 })
  const { camState, error, start, supportsCamera } = useCamera(videoRef, active)
  // Gated on `camState` as well as `live`: starting the engine against a
  // <video> with no stream attached is the failure `useScanEngine` reports as
  // "camera stream is not attached yet", and the toggle can be flipped before
  // the camera has finished coming up.
  const engine = useScanEngine(videoRef, live && active && camState === 'live')
  const verdict = useMemo(() => (engine.state ? sweepVerdict(engine.state) : null), [engine.state])

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

  const shutter = () => {
    const video = videoRef.current
    if (!video || !video.videoWidth || !video.videoHeight) return
    if (!rapid) {
      onCaptured(buildWorkingFrame(video, video.videoWidth, video.videoHeight), verdict)
      return
    }
    // FULL SENSOR FRAME, not the canonical square: this photo will be cropped
    // by hand later, and a square taken now would decide that in advance.
    const full = document.createElement('canvas')
    full.width = video.videoWidth
    full.height = video.videoHeight
    const ctx = full.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, 0, 0)
    // JPEG at 0.92: a 1080p frame lands around 300 KB, so a hundred-card run is
    // tens of megabytes rather than the hundreds a PNG of the same frame would
    // hold. The detector never sees these bytes — it sees the 416 px canonical
    // square built from them after cropping — so the quality that matters is
    // "can a human place corners on it", and 0.92 is well clear of that.
    full.toBlob((blob) => blob && onQueued(blob, verdict), 'image/jpeg', 0.92)
  }

  // Reticle overlay geometry: video-native pixels -> CSS pixels under
  // object-fit: cover (scan/ui/coords.ts, reused verbatim — the same math
  // the product scanner's QuadOverlay uses for its own reticle).
  let reticleStyle: React.CSSProperties | null = null
  let squareStyle: React.CSSProperties | null = null
  const vw = videoRef.current?.videoWidth ?? 0
  const vh = videoRef.current?.videoHeight ?? 0
  if (vw && vh && box.width && box.height) {
    const map = coverMap(box.width, box.height, vw, vh)
    const crop = squareCrop(vw, vh)
    const r = reticleForAspect()
    const [sx, sy] = framePointToCss(map, crop.x, crop.y)
    const squareCss = crop.size * map.scale
    squareStyle = { left: sx, top: sy, width: squareCss, height: squareCss }
    const rx = crop.x + r.x * crop.size
    const ry = crop.y + r.y * crop.size
    const [px, py] = framePointToCss(map, rx, ry)
    reticleStyle = { left: px, top: py, width: r.w * crop.size * map.scale, height: r.h * crop.size * map.scale }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div ref={boxRef} className="relative min-h-0 flex-1 overflow-hidden bg-black">
        <video ref={videoRef} playsInline muted autoPlay className="absolute inset-0 h-full w-full object-cover" />
        {squareStyle && (
          <div
            className="pointer-events-none absolute border border-dashed border-white/25"
            style={squareStyle}
            aria-hidden="true"
          />
        )}
        {reticleStyle && (
          <div
            className="pointer-events-none absolute rounded-[10px] border-2 border-cyan-300/80"
            style={reticleStyle}
            aria-hidden="true"
          />
        )}
        {/* The engine's own view, drawn through the SAME mapping the product
            scanner uses — `diagnostic` adds the two layers /scan deliberately
            hides (the off-reticle drop and the below-gate near miss). It sits
            above the static reticle so a detected quad is never hidden by the
            aiming guide. */}
        {live && <QuadOverlay state={engine.state} box={box} diagnostic />}
        {camState === 'requesting' && (
          <div className="absolute inset-0 flex items-center justify-center text-[13px] text-white/70">
            Starting camera…
          </div>
        )}
        {(camState === 'denied' || camState === 'error') && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-[8px] p-[16px] text-center text-[13px] text-white/80">
            <Icon name="alert" size={22} />
            <span>{camState === 'denied' ? 'Camera access was blocked.' : (error ?? 'Camera failed to start.')}</span>
            <button
              type="button"
              onClick={() => void start()}
              className="rounded-full bg-white/15 px-[12px] py-[6px] text-[12px] font-bold text-white hover:bg-white/25"
            >
              Retry
            </button>
          </div>
        )}
        {!supportsCamera && (
          <div className="absolute inset-0 flex items-center justify-center p-[16px] text-center text-[13px] text-white/70">
            No camera on this device — use Upload instead.
          </div>
        )}
      </div>
      {live && <SweepReadout verdict={verdict} status={engine.status} error={engine.error} />}
      <div className="relative flex shrink-0 items-center justify-center border-t border-white/10 bg-neutral-900 p-[12px]">
        <button
          type="button"
          onClick={shutter}
          disabled={camState !== 'live'}
          aria-label={rapid ? 'Add frame to the queue' : 'Capture frame'}
          className={`flex h-[58px] w-[58px] items-center justify-center rounded-full border-4 bg-white/10 hover:bg-white/20 disabled:opacity-30 ${
            rapid ? 'border-cyan-300' : 'border-white/70'
          }`}
        >
          <span className={`h-[44px] w-[44px] rounded-full ${rapid ? 'bg-cyan-300' : 'bg-white'}`} />
        </button>
        {/* The queue depth, beside the shutter rather than in the header: in
            rapid mode the screen never changes when you press it, and a count
            that does is the only feedback that the press landed. */}
        {rapid && (
          <span className="absolute right-[16px] font-mono text-[13px] font-bold text-cyan-300">{queued}</span>
        )}
      </div>
    </div>
  )
}
