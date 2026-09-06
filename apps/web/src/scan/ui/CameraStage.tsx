// The camera view — top ~55-60% of the stage (prototype.html's
// `#camera-view`). Live video, the reticle + tracked-quad overlay, the
// incoming stack docked on the right edge, a hint pill, and the permission-
// flow overlays (requesting/denied/error) ported from the previous Scan.tsx.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Icon } from '../../components/Icon'
import { QuadOverlay } from './QuadOverlay'
import { squareSide } from './coords'
import { IncomingStack } from './IncomingStack'
import { DURATION, prefersReducedMotion } from './motion'
import type { EngineState } from '../engine/contract'
import type { ScanMatch } from '../../lib/api'
import type { CamState } from './camera'
import type { StackItem } from './types'

export function CameraStage({
  videoRef,
  camState,
  engineState,
  engineError,
  hint,
  stackItems,
  picking,
  onStackNodeRef,
  onNeedsYou,
  onPick,
  onRetake,
  onClosePicker,
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
  /** Which stack thumbnail has its needs-you picker open. Passed straight
   *  through — this component owns the camera box, not the identity flow. */
  picking: string | null
  onStackNodeRef: (id: string, el: HTMLDivElement | null) => void
  onNeedsYou: (id: string) => void
  onPick: (id: string, match: ScanMatch) => void
  onRetake: (id: string) => void
  onClosePicker: () => void
  onRetry: () => void
  onReportCamera: () => void
  /** Incremented once per capture — pulses a brief white flash across the
   *  stage (prototype.html's `.quad-flash`, applied to the whole camera box
   *  rather than threaded per-quad into the SVG overlay: same beat, simpler
   *  wiring, and just as legible since a capture already freezes nothing
   *  else on screen). */
  flashSignal: number
  /** Reports this box's rendered CSS size up to Scan.tsx, which needs it (plus
   *  the engine's own `frame` and `stream` dimensions) to place the
   *  capture-flight courier at the captured quad's actual on-screen pose —
   *  through `coords.canonicalSquareMap`, the SAME call this component's own
   *  overlay makes, just needed one level up for a courier that must fly
   *  OUTSIDE this box. They diverged once (the overlay on contain math, the
   *  courier on cover) and every thumbnail launched ~54 px from the quad that
   *  had been highlighted; one helper, called twice, is what stops that. */
  onBoxChange?: (box: { width: number; height: number }) => void
}) {
  const slotRef = useRef<HTMLDivElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const flashRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ width: 0, height: 0 })
  /**
   * THE SQUARE, SIZED EXPLICITLY — because `aspect-square` did not deliver one.
   *
   * The box used to be `aspect-square w-full` with `max-height: 100%`, and it
   * was never square: in CSS a `max-height` constraint OVERRIDES `aspect-ratio`,
   * so the width held at `w-full` and the height collapsed to whatever room the
   * phone had left. Through the whole 2026-09-04 owner session the box measured
   * 428x319 — 109 px off square — and 926x136 when he turned the phone. Both
   * this file and `coords.ts` asserted squareness in prose while the layout
   * quietly refused it.
   *
   * So it is measured instead of asserted: an outer SLOT takes whatever space
   * the flex parent gives it, and the box is `min(slotW, slotH)` on a side. The
   * slot's own size cannot depend on the box's (it is a flex child with
   * `min-h-0`), so there is no loop for the ResizeObserver to chase.
   *
   * The overlay does NOT depend on this — `QuadOverlay` maps through the stream
   * under `object-fit: cover` and is correct at any box shape, which is the
   * lesson of that session. This is about the other half: a square box shows the
   * whole canonical square, so nothing the engine looks at is off screen and
   * none of the sensor's square is wasted.
   */
  const [side, setSide] = useState(0)

  useLayoutEffect(() => {
    const slot = slotRef.current
    const el = boxRef.current
    if (!slot || !el) return
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const r = entry.contentRect
        if (!r) continue
        if (entry.target === slot) setSide(squareSide(r.width, r.height))
        else setBox({ width: r.width, height: r.height })
      }
    })
    ro.observe(slot)
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
    // The SLOT: whatever space the flex parent has for the camera. It exists
    // only to be measured — see `side` above — so the square inside it can be
    // sized from real numbers instead of from an `aspect-square` the layout
    // overrides.
    <div ref={slotRef} data-scan-camera-slot className="flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden">
      {/* A SQUARE box, because the engine's canonical frame is the stream's
          centre square (scan/engine/frame.ts). Showing exactly that square means
          `object-fit: cover` crops the stream to its centre square — which IS
          the canonical frame — so the whole of what detection looks at is on
          screen and none of the sensor's square is thrown away. It still shrinks
          to whatever room the phone has; only its ASPECT is fixed, and now
          actually fixed. Before the first measurement it falls back to the old
          `aspect-square` so there is no zero-sized flash. */}
      <div
        ref={boxRef}
        data-scan-camera-view
        className={`relative shrink-0 overflow-hidden bg-black ${side ? '' : 'aspect-square w-full'}`}
        style={side ? { width: side, height: side } : { maxHeight: '100%' }}
      >
        <video ref={videoRef} playsInline muted autoPlay className="absolute inset-0 h-full w-full object-cover" />
        <div ref={flashRef} className="pointer-events-none absolute inset-0 z-40 bg-white opacity-0" />
        {live && <QuadOverlay state={engineState} box={box} />}
        {live && (
          <IncomingStack
            items={stackItems}
            picking={picking}
            onNodeRef={onStackNodeRef}
            onNeedsYou={onNeedsYou}
            onPick={onPick}
            onRetake={onRetake}
            onClosePicker={onClosePicker}
          />
        )}

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
    </div>
  )
}
