// A camera-free stage for the scanner's review motion (scanReviewMotion.mts):
// the scanning bin (newest first, VerifyFeed followTop), the swipe review, and
// — since 2026-11-27 — the camera → list hand-off itself: the real CameraStage
// (tray, flash, status pill) over a black <video>, the real VerifyFeed, and the
// shipping hand-off (scan/ui/handoff.ts deliverToTray / deliverToRow) and
// status arbiter (scan/ui/statusLine.ts), driven the way Scan.tsx drives them.
// Real components, real clock, so the recording shows exactly what a phone would.
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import '../../apps/web/src/theme.css'
import { VerifyFeed } from '../../apps/web/src/scan/ui/VerifyFeed'
import { SwipeReview } from '../../apps/web/src/scan/ui/SwipeReview'
import { CameraStage } from '../../apps/web/src/scan/ui/CameraStage'
import { addArrival, runningOwned } from '../../apps/web/src/scan/ui/feed'
import { initialIdentity } from '../../apps/web/src/scan/ui/identity'
import { createLaunchQueue, deliverToRow, deliverToTray, rectIn } from '../../apps/web/src/scan/ui/handoff'
import { DURATION } from '../../apps/web/src/scan/ui/motion'
import { initialStatus, nextStatus, type StatusFacts, type StatusMessage } from '../../apps/web/src/scan/ui/statusLine'
import type { FeedEntry, FeedVariant, StackItem } from '../../apps/web/src/scan/ui/types'

type Facts = Omit<StatusFacts, 'now'>

declare global {
  interface Window {
    harness: {
      land: (id: string, name: string, hue: number, variantId?: number) => void
      mode: (m: 'bin' | 'swipe' | 'handoff') => void
      clear: () => void
      feed: () => FeedEntry[]
      /** Hand-off: a capture's shutter — the flash, and the courier into the tray. */
      capture: (id: string, name: string, hue: number) => Promise<void>
      /** Hand-off: its identity settles — the tick, then the courier into the list. */
      settle: (id: string, flagged?: boolean) => Promise<void>
      /** The status line's facts, as Scan.tsx's detect tick writes them. */
      facts: (f: Partial<Facts>) => void
      status: () => StatusMessage
    }
  }
}

const variants = (base: number, owned = 0): FeedVariant[] => [
  { variantId: base, kind: 'normal', displayName: 'Normal', isPrimary: true, tier: 'standard', ownedQuantity: owned },
  { variantId: base + 1, kind: 'reverse', displayName: 'Reverse Holofoil', isPrimary: false, tier: 'special', ownedQuantity: 0 },
]
const art = (hue: number, label: string) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="63" height="88"><rect width="63" height="88" rx="4" fill="hsl(${hue} 55% 45%)"/><text x="31" y="48" font-size="9" fill="white" text-anchor="middle" font-family="sans-serif">${label}</text></svg>`,
  )}`

function row(id: string, name: string, hue: number, variantId: number, capturedAt = 0, repeatOf: string | null = null): FeedEntry {
  return {
    id, cardId: `card-${name}`, matched: true, name, setName: 'Fixture Set', setId: 'sv1', number: '018', rarity: 'Double Rare',
    images: null, capturePreviewUrl: art(hue, name), captureBlob: new Blob(), captureId: id, captureTrackId: null, identity: null,
    confidence: 0.97, distance: 2, quantity: 1, variantId, variants: variants(variantId - (variantId % 2 === 0 ? 0 : 1)),
    printingPicked: false, detectingPrinting: false, alternates: [], capturedAt, verified: false, repeatOf,
  }
}

function Stage() {
  const [feed, setFeed] = useState<FeedEntry[]>([])
  const [mode, setMode] = useState<'bin' | 'swipe' | 'handoff'>('bin')
  const [stack, setStack] = useState<StackItem[]>([])
  const [flash, setFlash] = useState<{ seq: number; quad: null }>({ seq: 0, quad: null })
  const [status, setStatus] = useState<StatusMessage>(() => initialStatus(0).shown)
  const binView = useMemo(() => [...feed].reverse(), [feed])
  const owned = useMemo(() => runningOwned(feed), [feed])
  const videoRef = useRef<HTMLVideoElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const layerRef = useRef<HTMLDivElement>(null)
  const stackNodes = useRef(new Map<string, HTMLDivElement>())
  const thumbs = useRef(new Map<string, HTMLDivElement>())
  const items = useRef(new Map<string, StackItem>())
  const queue = useRef(createLaunchQueue())
  const facts = useRef<Facts>({ watching: false, watchingName: null, aim: null, steady: false, unresolved: 0 })
  const statusRef = useRef(status)
  statusRef.current = status

  // The status line's clock, exactly as Scan.tsx runs it.
  useEffect(() => {
    let line = initialStatus(performance.now())
    const t = window.setInterval(() => {
      line = nextStatus(line, { ...facts.current, now: performance.now() })
      const shown = line.shown
      setStatus((p) => (p === shown ? p : shown))
    }, 125)
    return () => window.clearInterval(t)
  }, [])

  window.harness = {
    land: (id, name, hue, variantId = 500) => setFeed((f) => [...f, row(id, name, hue, variantId)]),
    mode: setMode,
    clear: () => setFeed([]),
    feed: () => feed,
    async capture(id, name, hue) {
      ;(window as unknown as { shutterAt: number }).shutterAt = performance.now()
      const item: StackItem = { id, trackId: 1, previewUrl: art(hue, name), blob: new Blob(), capturedAt: Date.now(), identity: initialIdentity(), arriving: true }
      items.current.set(id, item)
      setFlash((f) => ({ seq: f.seq + 1, quad: null }))
      flushSync(() => setStack((s) => [item, ...s]))
      const layer = layerRef.current!
      const cam = stageRef.current!.querySelector<HTMLElement>('[data-scan-camera-view]')!
      const box = rectIn(cam, layer)
      // A card held in the middle of the camera, as the quad's pose would put it.
      const w = box.width * 0.45
      const h = (w * 88) / 63
      await deliverToTray({
        id,
        previewUrl: item.previewUrl,
        layer,
        from: { left: box.left + box.width / 2 - w / 2, top: box.top + box.height / 2 - h / 2, width: w, height: h },
        fromRotDeg: -4,
        slot: () => stackNodes.current.get(id) ?? null,
      })
      setStack((s) => s.map((x) => (x.id === id ? { ...x, arriving: false } : x)))
    },
    async settle(id, flagged = false) {
      const item = items.current.get(id)!
      const confident = { ...initialIdentity(), phase: 'confident' as const }
      setStack((s) => s.map((x) => (x.id === id ? { ...x, identity: confident } : x)))
      await new Promise((r) => setTimeout(r, DURATION.confirmTick))
      await queue.current.wait()
      const name = decodeURIComponent(item.previewUrl).match(/>([^<]+)<\/text>/)?.[1] ?? id
      const hue = Number(decodeURIComponent(item.previewUrl).match(/hsl\((\d+)/)?.[1] ?? 0)
      await deliverToRow({
        id,
        layer: layerRef.current!,
        stackEl: stackNodes.current.get(id) ?? null,
        insertRow: () => flushSync(() => setFeed((f) => addArrival(f, row(id, name, hue, 600, item.capturedAt, flagged ? 'prev' : null)))),
        thumb: () => thumbs.current.get(id) ?? null,
        scroller: stageRef.current!.querySelector<HTMLElement>('[data-verify-feed]'),
      })
      setStack((s) => s.filter((x) => x.id !== id))
    },
    facts(f) {
      facts.current = { ...facts.current, ...f }
    },
    status: () => statusRef.current,
  }
  const noop = () => {}
  const bin = (
    <VerifyFeed
      entries={binView}
      sort={{ key: 'scan', dir: 'desc' }}
      followTop
      title="Cards"
      onQuantityChange={noop}
      onVariantChange={noop}
      onCorrect={noop}
      onRemove={noop}
      onReport={async () => {}}
      onOpenDetail={noop}
      registerThumbNode={(id, el) => {
        if (el) thumbs.current.set(id, el)
        else thumbs.current.delete(id)
      }}
    />
  )
  return (
    <div className="flex h-screen w-full flex-col bg-surface-primary">
      {mode === 'handoff' ? (
        <div ref={stageRef} className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="flex min-h-[180px] flex-[3] flex-col overflow-hidden">
            <CameraStage
              videoRef={videoRef}
              camState="live"
              engineState={null}
              engineError={null}
              status={status}
              stackItems={stack}
              onStackNodeRef={(id, el) => {
                if (el) stackNodes.current.set(id, el)
                else stackNodes.current.delete(id)
              }}
              onRetry={noop}
              onReportCamera={noop}
              flash={flash}
            />
          </div>
          <div className="flex min-h-[140px] flex-[2] flex-col overflow-hidden border-t border-divider-subtle">{bin}</div>
          <div ref={layerRef} className="pointer-events-none absolute inset-0 z-[55]" />
        </div>
      ) : mode === 'bin' ? (
        <>
          <div className="h-[430px] shrink-0 bg-black" />
          <div className="flex h-[300px] min-h-0 flex-col border-t border-divider-subtle">{bin}</div>
        </>
      ) : (
        <SwipeReview
          entries={feed}
          owned={owned}
          onQuantityChange={noop}
          onVariantChange={noop}
          onConfirm={(id) => setFeed((f) => f.map((e) => (e.id === id ? { ...e, verified: true } : e)))}
          onCorrect={noop}
          onSkip={noop}
          onOpenDetail={noop}
        />
      )}
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<Stage />)
