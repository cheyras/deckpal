// The camera view — top ~55-60% of the stage (prototype.html's
// `#camera-view`). Live video, the reticle + tracked-quad overlay, the
// incoming stack docked on the right edge, a hint pill, and the permission-
// flow overlays (requesting/denied/error) ported from the previous Scan.tsx.
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Icon } from '../../components/Icon'
import { DURATION as TOKENS, EASE as TOKEN_EASE } from '../../lib/motion'
import { QuadOverlay } from './QuadOverlay'
import { canonicalSquareMap, framePointToCss, squareSide } from './coords'
import { IncomingStack } from './IncomingStack'
import { flashAnimation, prefersReducedMotion } from './motion'
import type { EngineState, Quad } from '../engine/contract'
import type { CamState } from './camera'
import type { StatusActionId, StatusMessage } from './statusLine'
import type { StackItem } from './types'

const ACTION_LABEL: Record<StatusActionId, string> = {
  'scan-again': 'Scan again',
  undo: 'Undo',
  'add-copy': 'Add copy',
  skip: 'Skip',
}

/** The pill's text, with the status line's "✓" drawn as the shared check Icon (AGENTS.md B13). */
function StatusText({ text }: { text: string }) {
  const parts = text.split('✓')
  return (
    <>
      {parts.map((p, i) => (
        <Fragment key={i}>
          {i > 0 && <Icon name="check" size={13} strokeWidth={3} className="inline-block align-[-2px] text-change-positive" />}
          {p}
        </Fragment>
      ))}
    </>
  )
}

export function CameraStage({
  videoRef,
  camState,
  engineState,
  engineError,
  status,
  onStatusAction,
  stackItems,
  onStackNodeRef,
  onRetry,
  onReportCamera,
  flash,
  onBoxChange,
  overlay,
  currentEpisodeId = null,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>
  camState: CamState
  engineState: EngineState | null
  engineError: string | null
  /** The status line's current message (statusLine.ts) — the pill under the picture. */
  status: StatusMessage
  /** One of the pill's buttons was pressed. */
  onStatusAction?: (id: StatusActionId) => void
  /** The capture the pill's "Scanned ✓" is about: its tray thumbnail is ringed. */
  currentEpisodeId?: string | null
  /** Captures still waiting on a verdict, plus the one or two showing theirs on
   *  the way out. Nothing in the stack is interactive — the 2026-09-06 ruling
   *  sends every settled capture down to the list, where the reader acts on it —
   *  so this component passes the items through and nothing else. */
  stackItems: StackItem[]
  onStackNodeRef: (id: string, el: HTMLDivElement | null) => void
  onRetry: () => void
  onReportCamera: () => void
  /**
   * THE CAPTURE FLASH: `seq` changes once per capture that becomes (or may
   * become) a row, at the moment capture() is called — the whole camera to
   * white and back (motion.ts FLASH, 540 ms; gentler under reduced motion), and
   * the captured quad's outline solid white for the hold, then back to the
   * lock's green. `quad` is canonical; null for a capture with no quad on
   * screen (a promoted drift probe).
   */
  flash: { seq: number; quad: Quad | null }
  /** Reports this box's rendered CSS size up to Scan.tsx, which needs it (plus
   *  the engine's own `frame` and `stream` dimensions) to place the
   *  capture-flight courier at the captured quad's actual on-screen pose —
   *  through `coords.canonicalSquareMap`, the SAME call this component's own
   *  overlay makes, just needed one level up for a courier that must fly
   *  OUTSIDE this box. They diverged once (the overlay on contain math, the
   *  courier on cover) and every thumbnail launched ~54 px from the quad that
   *  had been highlighted; one helper, called twice, is what stops that. */
  onBoxChange?: (box: { width: number; height: number }) => void
  /** Drawn over the live picture, above the hint — the voice caption, which
   *  belongs where the reader is looking while they scan. */
  overlay?: ReactNode
}) {
  const slotRef = useRef<HTMLDivElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const flashRef = useRef<HTMLDivElement>(null)
  const outlineRef = useRef<SVGPolygonElement>(null)
  const pillTextRef = useRef<HTMLSpanElement>(null)
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

  // THE FLASH — opacity only, WAAPI. Under reduced motion it stays, gentler.
  // A LAYOUT effect: started in the commit that carries the new seq, before
  // the browser paints it, so the white is up within one frame of the shutter.
  useLayoutEffect(() => {
    if (flash.seq === 0 || !flashRef.current) return
    const reduced = prefersReducedMotion()
    const { keyframes, options } = flashAnimation(reduced)
    const anim = flashRef.current.animate(keyframes, options)
    anim.finished.then(() => anim.cancel()).catch(() => {})
    // ...and the captured outline, white over the lock's green for the hold.
    const outline = outlineRef.current
    if (outline && flash.quad) {
      const o = outline.animate(
        [
          { opacity: 1, offset: 0 },
          { opacity: 1, offset: reduced ? 0 : TOKENS.instant / (TOKENS.instant + TOKENS.slow), easing: TOKEN_EASE.enter },
          { opacity: 0, offset: 1 },
        ],
        { duration: reduced ? TOKENS.fast : TOKENS.instant + TOKENS.slow },
      )
      o.finished.then(() => o.cancel()).catch(() => {})
    }
  }, [flash])

  // The pill's text cross-fades on a change (DURATION.instant, opacity only).
  useEffect(() => {
    const el = pillTextRef.current
    if (!el || prefersReducedMotion()) return
    const a = el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: TOKENS.instant, easing: TOKEN_EASE.standard })
    a.finished.then(() => a.cancel()).catch(() => {})
  }, [status.text])

  const live = camState === 'live'
  const flashPoints = (() => {
    const s = engineState
    if (!flash.quad || !s || !box.width || !box.height || !s.frame.width) return null
    const map = canonicalSquareMap(box.width, box.height, s.stream?.width ?? 0, s.stream?.height ?? 0, s.frame.width)
    return flash.quad.map(([x, y]) => framePointToCss(map, x, y).join(',')).join(' ')
  })()

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
        {/* THE FLASH: above the quad overlay and the tray, below the pill. */}
        <div ref={flashRef} data-capture-flash className="pointer-events-none absolute inset-0 z-40 bg-white opacity-0" />
        {flashPoints && (
          <svg className="pointer-events-none absolute inset-0 z-[41] h-full w-full" aria-hidden="true">
            <polygon ref={outlineRef} points={flashPoints} fill="none" stroke="white" strokeWidth={4} strokeLinejoin="round" opacity={0} />
          </svg>
        )}
        {live && <QuadOverlay state={engineState} box={box} />}
        {live && <IncomingStack items={stackItems} onNodeRef={onStackNodeRef} currentEpisodeId={currentEpisodeId} />}

        {live && (
          <>
            {/* THE STATUS PILL (statusLine.ts decides what it says). One
                element whatever it says, so it never jumps: a fixed minimum
                width, the text cross-fading, and a button only when the
                message carries one. */}
            <div
              data-scan-status={status.key}
              role="status"
              aria-live="polite"
              className={`absolute bottom-[14px] left-1/2 z-50 flex min-w-[200px] max-w-[calc(100%-56px)] -translate-x-1/2 items-center justify-center gap-[8px] whitespace-nowrap rounded-full bg-black/60 py-[6px] text-[13px] font-semibold text-white backdrop-blur ${
                status.actions.length ? 'pl-[14px] pr-[6px]' : 'pointer-events-none px-[14px]'
              }`}
            >
              <span ref={pillTextRef} data-scan-status-text className="min-w-0 truncate">
                <StatusText text={status.text} />
              </span>
              {status.actions.map((a) => (
                <button
                  key={a}
                  type="button"
                  data-status-action={a}
                  onClick={() => onStatusAction?.(a)}
                  className={`shrink-0 rounded-full px-[10px] py-[3px] text-[12px] font-bold ${
                    a === 'skip' ? 'bg-white/15 text-white' : 'bg-action-primary text-action-primary-text'
                  }`}
                >
                  {ACTION_LABEL[a]}
                </button>
              ))}
            </div>
            {overlay}
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
