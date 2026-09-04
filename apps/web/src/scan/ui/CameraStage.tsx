// The camera view — top ~55-60% of the stage (prototype.html's
// `#camera-view`). Live video, the reticle + tracked-quad overlay, the
// incoming stack docked on the right edge, a hint pill, and the permission-
// flow overlays (requesting/denied/error) ported from the previous Scan.tsx.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Icon } from '../../components/Icon'
import { QuadOverlay } from './QuadOverlay'
import { IncomingStack } from './IncomingStack'
import { DURATION, prefersReducedMotion } from './motion'
import type { EngineState } from '../engine/contract'
import type { CamState } from './camera'
import type { StackItem } from './types'

export function CameraStage({
  videoRef,
  camState,
  engineState,
  engineError,
  hint,
  stackItems,
  onStackNodeRef,
  onRetry,
  onReportCamera,
  flashSignal,
  onBoxChange,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>
  camState: CamState
  engineState: EngineState | null
  engineError: string | null
  hint: string
  stackItems: StackItem[]
  onStackNodeRef: (id: string, el: HTMLDivElement | null) => void
  onRetry: () => void
  onReportCamera: () => void
  /** Incremented once per capture — pulses a brief white flash across the
   *  stage (prototype.html's `.quad-flash`, applied to the whole camera box
   *  rather than threaded per-quad into the SVG overlay: same beat, simpler
   *  wiring, and just as legible since a capture already freezes nothing
   *  else on screen). */
  flashSignal: number
  /** Reports this box's rendered CSS size up to Scan.tsx, which needs it (plus
   *  the engine's own `frame` dimensions) to place the capture-flight
   *  courier at the captured quad's actual on-screen pose — the same
   *  object-fit: cover math this component uses for its own overlay, just
   *  needed one level up for a courier that must fly OUTSIDE this box. */
  onBoxChange?: (box: { width: number; height: number }) => void
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  const flashRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ width: 0, height: 0 })

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

  useEffect(() => {
    onBoxChange?.(box)
    // `onBoxChange` is expected to be a stable callback (a ref-writer); only
    // the measured size should re-trigger this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [box.width, box.height])

  useEffect(() => {
    if (flashSignal === 0 || !flashRef.current || prefersReducedMotion()) return
    const anim = flashRef.current.animate([{ opacity: 0 }, { opacity: 0.75, offset: 0.3 }, { opacity: 0 }], {
      duration: DURATION.flash,
      easing: 'ease-out',
    })
    anim.finished.then(() => anim.cancel()).catch(() => {})
  }, [flashSignal])

  const live = camState === 'live'

  return (
    // A SQUARE box, because the engine's canonical frame is the stream's centre
    // square (scan/engine/frame.ts). Showing exactly that square means the
    // overlay maps by one scale factor, and — the point of the 2026-09-04
    // ruling — the box's size can no longer influence anything detection does:
    // `object-fit: cover` on a square box crops the stream to its centre square,
    // which IS the canonical frame. It still shrinks to whatever room the phone
    // has; only its ASPECT is now fixed.
    <div
      ref={boxRef}
      data-scan-camera-view
      className="relative mx-auto aspect-square min-h-0 w-full max-w-full shrink overflow-hidden bg-black"
      style={{ maxHeight: '100%' }}
    >
      <video ref={videoRef} playsInline muted autoPlay className="absolute inset-0 h-full w-full object-cover" />
      <div ref={flashRef} className="pointer-events-none absolute inset-0 z-40 bg-white opacity-0" />
      {live && <QuadOverlay state={engineState} box={box} />}
      {live && <IncomingStack items={stackItems} onNodeRef={onStackNodeRef} />}

      {live && (
        <>
          <div className="pointer-events-none absolute bottom-[14px] left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-black/55 px-[14px] py-[6px] text-[13px] font-semibold text-white backdrop-blur">
            {hint}
          </div>
          <button
            type="button"
            onClick={onReportCamera}
            title="Flag this camera moment for review"
            className="absolute right-[8px] bottom-[8px] z-30 flex h-[30px] w-[30px] items-center justify-center rounded-full bg-black/45 text-white/80 backdrop-blur hover:text-white"
          >
            <Icon name="bug" size={15} />
          </button>
        </>
      )}

      {camState === 'requesting' && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-[14px] text-white">Starting camera…</div>
      )}
      {camState === 'denied' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-[10px] bg-black/70 p-[20px] text-center text-[14px] text-white">
          <Icon name="camera" size={30} />
          <div>Camera access was blocked. Allow it in your browser, or upload an image below.</div>
          <button onClick={onRetry} className="rounded-full bg-white/15 px-[16px] py-[8px] text-[14px] font-bold text-white hover:bg-white/25">
            Try camera again
          </button>
        </div>
      )}
      {camState === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-[10px] bg-black/70 p-[20px] text-center text-[14px] text-white">
          <Icon name="alert" size={28} />
          <div>Couldn't start the camera.{engineError ? ` (${engineError})` : ''}</div>
          <button onClick={onRetry} className="rounded-full bg-white/15 px-[16px] py-[8px] text-[14px] font-bold text-white hover:bg-white/25">
            Retry
          </button>
        </div>
      )}
    </div>
  )
}
