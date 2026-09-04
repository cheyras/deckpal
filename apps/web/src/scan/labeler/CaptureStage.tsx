// Live camera + the standardized reticle, per the owner's 2026-09-04 ruling
// (engine/frame.ts): a dashed square showing the centre-crop the working
// frame will be drawn from, and inside it the standardized card-aspect
// reticle (`reticleForAspect`) — the SAME guide the product scanner draws
// once it adopts frame.ts (see workingFrame.ts's header for why that
// migration isn't finished yet, and why this tool leads with the target
// format rather than the currently-shipped one).
//
// No live detection here on purpose — the detector runs ONCE, on the frozen
// frame, after the shutter (detectSeed.ts). Running it continuously during
// framing would burn the model for a view nobody is about to save.
import { useLayoutEffect, useRef, useState } from 'react'
import { Icon } from '../../components/Icon'
import { useCamera } from '../ui/camera'
import { coverMap, framePointToCss } from '../ui/coords'
import { squareCrop, reticleForAspect } from '../engine/frame'
import { buildWorkingFrame, type WorkingFrame } from './workingFrame'

export function CaptureStage({ active, onCaptured }: { active: boolean; onCaptured: (frame: WorkingFrame) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ width: 0, height: 0 })
  const { camState, error, start, supportsCamera } = useCamera(videoRef, active)

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
    onCaptured(buildWorkingFrame(video, video.videoWidth, video.videoHeight))
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
      <div className="flex shrink-0 items-center justify-center border-t border-white/10 bg-neutral-900 p-[12px]">
        <button
          type="button"
          onClick={shutter}
          disabled={camState !== 'live'}
          aria-label="Capture frame"
          className="flex h-[58px] w-[58px] items-center justify-center rounded-full border-4 border-white/70 bg-white/10 hover:bg-white/20 disabled:opacity-30"
        >
          <span className="h-[44px] w-[44px] rounded-full bg-white" />
        </button>
      </div>
    </div>
  )
}
