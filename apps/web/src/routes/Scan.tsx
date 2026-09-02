import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearch, useNavigate } from '@tanstack/react-router'
import { api, type ScanMatch, type ScanResponse } from '../lib/api'
import { Content } from '../components/ui'
import { Icon } from '../components/Icon'
import { CardSheet } from './CardDetail'
import type { CaptureResult } from '../scan/engine/contract'
import { useCamera } from '../scan/ui/camera'
import { useScanEngine } from '../scan/ui/useScanEngine'
import { CameraStage } from '../scan/ui/CameraStage'
import { VerifyFeed } from '../scan/ui/VerifyFeed'
import { CommitBar } from '../scan/ui/CommitBar'
import { UploadFallback } from '../scan/ui/UploadFallback'
import { commitFeed } from '../scan/ui/commit'
import { uploadScanFlag } from '../scan/ui/flags'
import { toScanBytes } from '../scan/ui/uploadNormalize'
import { coverMap, framePointToCss, quadPose } from '../scan/ui/coords'
import { bump, DURATION, flyArc, rectRelativeTo } from '../scan/ui/motion'
import type { FeedEntry, FeedVariant, StackItem } from '../scan/ui/types'

// The scanner (production rebuild — see roadmap/plans/card-scanner-redesign,
// PLAN.md D1-D6). Camera view on top, a loose reticle gates detection
// (FIELD-TEST-1.md's central request — forgiving on rotation/perspective,
// refusing everything outside it), a locked card auto-captures a rectified
// snapshot into the incoming stack, identify swaps it into a reviewable
// verify feed (quantity, printing, "wrong card?" correction, duplicates
// merged), and one batch commit writes the whole feed to the collection.
// Replaces BOTH the old single-card guide-box mode and rip mode.

let uidSeq = 0
function makeId(prefix: string): string {
  uidSeq += 1
  return `${prefix}-${Date.now()}-${uidSeq}`
}

/** Two rAFs: the first fires once the browser is ready to paint the frame
 *  React just committed for; the second confirms that paint actually
 *  happened, so a caller reading layout right after this is measuring the
 *  real, current DOM rather than a state that hasn't been committed yet. */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
}

export function Scan() {
  const search = useSearch({ from: '/scan' })
  const navigate = useNavigate({ from: '/scan' })

  const videoRef = useRef<HTMLVideoElement>(null)
  const stageWrapRef = useRef<HTMLDivElement>(null)
  const flyLayerRef = useRef<HTMLDivElement>(null)
  const cameraBoxRef = useRef({ width: 0, height: 0 })
  const frameSizeRef = useRef({ width: 0, height: 0 })

  const { camState, supportsCamera, start: retryCamera } = useCamera(videoRef)
  const engineActive = camState === 'live'
  const {
    status: engineStatus,
    error: engineError,
    state: engineState,
    capture,
  } = useScanEngine(videoRef, engineActive)

  useEffect(() => {
    if (engineState) frameSizeRef.current = engineState.frame
  }, [engineState])

  const [stack, setStack] = useState<StackItem[]>([])
  const [feed, setFeed] = useState<FeedEntry[]>([])
  const [flashSignal, setFlashSignal] = useState(0)
  const [hint, setHint] = useState('Point the camera at a card')
  const [notice, setNotice] = useState<string | null>(null)
  const [committing, setCommitting] = useState(false)

  const feedRef = useRef<FeedEntry[]>(feed)
  useEffect(() => {
    feedRef.current = feed
  }, [feed])

  const refractoryRef = useRef(new Set<number>())
  const captureBusyRef = useRef(false)
  const stackNodesRef = useRef(new Map<string, HTMLDivElement>())
  const feedThumbNodesRef = useRef(new Map<string, HTMLDivElement>())
  const variantsAsked = useRef(new Set<string>())
  const objectUrlsRef = useRef(new Set<string>())

  const trackUrl = useCallback((url: string) => {
    objectUrlsRef.current.add(url)
    return url
  }, [])

  // Every object URL this session ever created is revoked once, on unmount —
  // ownership of a capture's URL moves from the stack item to the feed entry
  // it lands on (never revoked mid-session), so a long scan run trades a
  // little memory for never yanking an image out from under a still-visible
  // "needs attention" row or an in-flight report upload.
  useEffect(
    () => () => {
      for (const url of objectUrlsRef.current) URL.revokeObjectURL(url)
    },
    [],
  )

  const loadVariants = useCallback(async (cardId: string) => {
    if (variantsAsked.current.has(cardId)) return
    variantsAsked.current.add(cardId)
    try {
      const card = await api.card(cardId)
      const variants: FeedVariant[] = card.variants.map((v) => ({
        variantId: v.variantId,
        displayName: v.displayName,
        isPrimary: v.isPrimary,
        kind: v.kind,
        tier: v.tier,
      }))
      setFeed((prev) =>
        prev.map((e) => {
          if (e.cardId !== cardId) return e
          const primary = variants.find((v) => v.isPrimary) ?? variants[0]
          return { ...e, variants, variantId: e.variantId ?? primary?.variantId ?? null }
        }),
      )
    } catch {
      // Left silent, same reasoning the old rip list carried: the row still
      // commits (commit.ts falls back to the primary printing), so a failed
      // lookup costs the reader the CHOICE, not the card.
      variantsAsked.current.delete(cardId)
    }
  }, [])

  /** Fly an <img> of `previewUrl`, sized `from`, into `targetEl`'s current
   *  rect — the shared courier used for both capture→stack and stack→feed. */
  const flyToTarget = useCallback(
    async (
      previewUrl: string,
      from: { cx: number; cy: number; rotDeg?: number; width: number; height: number },
      targetEl: HTMLElement,
    ) => {
      const layer = flyLayerRef.current
      const wrap = stageWrapRef.current
      if (!layer || !wrap || !from.width || !from.height) return
      const toRect = rectRelativeTo(targetEl, wrap)
      const img = document.createElement('img')
      img.src = previewUrl
      img.alt = ''
      Object.assign(img.style, {
        position: 'absolute',
        left: '0',
        top: '0',
        width: `${from.width}px`,
        height: `${from.height}px`,
        borderRadius: '6px',
        objectFit: 'cover',
        boxShadow: '0 10px 20px rgba(0,0,0,0.45)',
      })
      layer.appendChild(img)
      const scale = toRect.width ? toRect.width / from.width : 1
      await flyArc(
        img,
        { cx: from.cx, cy: from.cy, rotDeg: from.rotDeg ?? 0, scale: 1 },
        { cx: toRect.cx, cy: toRect.cy, rotDeg: 0, scale },
        from.width,
        from.height,
        { duration: DURATION.flyStack, arcPx: 20 },
      )
      img.remove()
    },
    [],
  )

  /** Writes the identify result into the feed — a new row, or a quantity
   *  bump on an existing one by cardId. Pure state; the caller is
   *  responsible for any flight animation around it. */
  const applyIdentifyResult = useCallback(
    (res: ScanResponse | null, stackItem: StackItem) => {
      const top = res?.matched ? res.matches[0] : undefined
      setFeed((prev) => {
        const existing = top ? prev.find((e) => e.cardId === top.cardId) : undefined
        if (existing) {
          return prev.map((e) => (e.id === existing.id ? { ...e, quantity: e.quantity + 1, mergeTick: e.mergeTick + 1 } : e))
        }
        const entry: FeedEntry = top
          ? {
              id: top.cardId,
              cardId: top.cardId,
              matched: true,
              name: top.name,
              setName: top.setName,
              number: top.number,
              rarity: top.rarity,
              images: top.images,
              capturePreviewUrl: stackItem.previewUrl,
              captureBlob: stackItem.blob,
              confidence: top.confidence,
              distance: top.distance,
              quantity: 1,
              variantId: null,
              variants: [],
              alternates: res?.matches ?? [],
              capturedAt: Date.now(),
              mergeTick: 0,
            }
          : {
              id: makeId('unmatched'),
              cardId: null,
              matched: false,
              name: 'Unidentified card',
              setName: '',
              number: '',
              rarity: null,
              images: null,
              capturePreviewUrl: stackItem.previewUrl,
              captureBlob: stackItem.blob,
              confidence: 0,
              distance: -1,
              quantity: 1,
              variantId: null,
              variants: [],
              alternates: res?.matches ?? [],
              capturedAt: Date.now(),
              mergeTick: 0,
            }
        return [entry, ...prev]
      })
      if (top) void loadVariants(top.cardId)
      setHint(top ? `Got it — ${top.name}` : 'Needs a closer look')
    },
    [loadVariants],
  )

  /** The full capture → stack → identify → feed pipeline for one engine capture. */
  const handleCaptured = useCallback(
    async (result: CaptureResult) => {
      const previewUrl = trackUrl(URL.createObjectURL(result.blob))
      const stackItem: StackItem = { id: makeId('cap'), trackId: result.trackId, previewUrl, blob: result.blob, capturedAt: Date.now() }
      setStack((prev) => [stackItem, ...prev])

      // Identify runs CONCURRENTLY with the fly-to-stack visual — the
      // network round trip overlaps travel time instead of waiting behind a
      // fixed simulated delay, so the reader sees the real latency, not more.
      const identifyPromise: Promise<ScanResponse | null> = (async () => {
        try {
          const bytes = await result.blob.arrayBuffer()
          return await api.scan(bytes, 'image/jpeg', 5, 'low')
        } catch {
          return null
        }
      })()

      await nextFrame()
      const stackEl = stackNodesRef.current.get(stackItem.id)
      const wrap = stageWrapRef.current
      if (stackEl && wrap) {
        const box = cameraBoxRef.current
        const frame = frameSizeRef.current
        // Approximate start pose from the captured quad's frame-space pose,
        // mapped through the same object-fit: cover math the reticle/quad
        // overlay uses. Falls back to a plausible center-of-frame card size
        // if the box/frame haven't been measured yet (should not happen in
        // practice — start() only runs once a video frame exists).
        let from = { cx: box.width / 2, cy: box.height * 0.42, rotDeg: 0, width: 130, height: (130 * 88) / 63 }
        if (box.width && box.height && frame.width && frame.height) {
          const map = coverMap(box.width, box.height, frame.width, frame.height)
          const pose = quadPose(result.quad)
          const [cx, cy] = framePointToCss(map, pose.cx, pose.cy)
          from = { cx, cy, rotDeg: pose.rotDeg, width: pose.width * map.scale, height: pose.height * map.scale }
        }
        await flyToTarget(previewUrl, from, stackEl)
        await bump(stackEl, 1.04, DURATION.settle)
      }

      const res = await identifyPromise
      applyIdentifyResult(res, stackItem)
      await nextFrame()

      const top = res?.matched ? res.matches[0] : undefined
      const latest = feedRef.current
      const entryId = top
        ? latest.find((e) => e.cardId === top.cardId)?.id
        : latest.find((e) => e.capturePreviewUrl === previewUrl)?.id
      const thumbEl = entryId ? feedThumbNodesRef.current.get(entryId) : undefined
      if (thumbEl && wrap) {
        const fromRect = rectRelativeTo(stackEl ?? thumbEl, wrap)
        await flyToTarget(
          previewUrl,
          { cx: fromRect.cx, cy: fromRect.cy, width: fromRect.width || 54, height: fromRect.height || 75 },
          thumbEl,
        )
      }
      setStack((prev) => prev.filter((s) => s.id !== stackItem.id))
    },
    [applyIdentifyResult, flyToTarget, trackUrl],
  )

  const runCapture = useCallback(
    async (trackId: number) => {
      captureBusyRef.current = true
      setFlashSignal((n) => n + 1)
      try {
        const result = await capture(trackId)
        await handleCaptured(result)
      } catch (e) {
        // The track vanished, or the engine refused — release the refractory
        // hold so the SAME presence can retry rather than being silently
        // ignored for the rest of its dwell.
        refractoryRef.current.delete(trackId)
        setNotice(e instanceof Error ? e.message : 'that capture did not go through')
      } finally {
        captureBusyRef.current = false
      }
    },
    [capture, handleCaptured],
  )

  // ── auto-capture: a persisted lock, refractory until the track departs
  //    and returns (ripSession.ts's departure-then-return precedent, applied
  //    to track ids instead of card ids). ──
  useEffect(() => {
    if (!engineState) return
    const presentIds = new Set(engineState.stable.map((q) => q.id))
    for (const id of refractoryRef.current) {
      if (!presentIds.has(id)) refractoryRef.current.delete(id)
    }
    const locked = engineState.locked
    if (locked && !refractoryRef.current.has(locked.id) && !captureBusyRef.current) {
      refractoryRef.current.add(locked.id)
      void runCapture(locked.id)
    }
    if (locked) setHint((h) => (h.startsWith('Got it') ? h : 'Got it — hold on…'))
    else if (engineState.stable.length > 0) setHint('Hold steady…')
    else setHint('Point the camera at a card')
  }, [engineState, runCapture])

  const manualCapture = useCallback(() => {
    if (!engineState || captureBusyRef.current) {
      setNotice('The scanner is not ready yet.')
      return
    }
    const candidate = engineState.locked ?? engineState.stable.find((q) => !q.coasting) ?? engineState.stable[0]
    if (!candidate) {
      setNotice('No card in view yet — line one up in the frame.')
      return
    }
    refractoryRef.current.add(candidate.id)
    void runCapture(candidate.id)
  }, [engineState, runCapture])

  const reportEntry = useCallback(async (entry: FeedEntry) => {
    await uploadScanFlag(entry.captureBlob, {
      epochMs: Date.now(),
      source: 'scan-feed-entry',
      cardId: entry.cardId,
      matched: entry.matched,
      confidence: entry.confidence,
      distance: entry.distance,
      alternates: entry.alternates.map((m) => ({ cardId: m.cardId, name: m.name, confidence: m.confidence, distance: m.distance })),
    })
  }, [])

  const reportCamera = useCallback(async () => {
    const video = videoRef.current
    if (!video || !video.videoWidth) return
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, 0, 0)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) return
    try {
      await uploadScanFlag(blob, {
        epochMs: Date.now(),
        source: 'scan-camera-view',
        dims: { width: video.videoWidth, height: video.videoHeight },
        engine: engineState
          ? {
              reticle: engineState.reticle,
              stable: engineState.stable,
              pending: engineState.pending,
              locked: engineState.locked,
              hasObj: engineState.hasObj,
              perf: engineState.perf,
            }
          : null,
      })
      setNotice('Reported — thanks.')
    } catch {
      setNotice('Could not send the report just now.')
    }
  }, [engineState])

  const changeQuantity = useCallback((id: string, quantity: number) => {
    setFeed((prev) => prev.flatMap((e) => (e.id !== id ? [e] : quantity <= 0 ? [] : [{ ...e, quantity }])))
  }, [])

  const changeVariant = useCallback((id: string, variantId: number) => {
    setFeed((prev) => prev.map((e) => (e.id === id ? { ...e, variantId } : e)))
  }, [])

  const removeEntry = useCallback((id: string) => {
    setFeed((prev) => prev.filter((e) => e.id !== id))
  }, [])

  const correctEntry = useCallback(
    (id: string, match: ScanMatch) => {
      setFeed((prev) => {
        const current = prev.find((e) => e.id === id)
        if (!current) return prev
        // Correcting INTO a card already sitting in the feed under its own
        // row merges quantities into that row instead of creating a second
        // row for the same card — the same corruption `ripSession.ts` avoids
        // by keying its dedupe on cardId.
        const target = prev.find((e) => e.cardId === match.cardId && e.id !== id)
        if (target) {
          return prev
            .map((e) => (e.id === target.id ? { ...e, quantity: e.quantity + current.quantity, mergeTick: e.mergeTick + 1 } : e))
            .filter((e) => e.id !== id)
        }
        return prev.map((e) =>
          e.id === id
            ? {
                ...e,
                id: match.cardId,
                cardId: match.cardId,
                matched: true,
                name: match.name,
                setName: match.setName,
                number: match.number,
                rarity: match.rarity,
                images: match.images,
                confidence: match.confidence,
                distance: match.distance,
                variantId: null,
                variants: [],
              }
            : e,
        )
      })
      void loadVariants(match.cardId)
    },
    [loadVariants],
  )

  const handleUploadFile = useCallback(
    async (file: File) => {
      const { bytes, type } = await toScanBytes(file)
      const res = await api.scan(bytes, type, 5, 'low')
      const blob = new Blob([bytes], { type })
      const previewUrl = trackUrl(URL.createObjectURL(blob))
      const stackItem: StackItem = { id: makeId('up'), trackId: -1, previewUrl, blob, capturedAt: Date.now() }
      applyIdentifyResult(res, stackItem)
    },
    [applyIdentifyResult, trackUrl],
  )

  const [celebration, setCelebration] = useState<string | null>(null)
  useEffect(() => {
    if (!celebration) return
    const t = window.setTimeout(() => setCelebration(null), 4000)
    return () => window.clearTimeout(t)
  }, [celebration])

  const handleCommit = useCallback(async () => {
    setCommitting(true)
    try {
      const snapshot = feedRef.current
      const result = await commitFeed(snapshot)
      const unresolvedIds = new Set(result.unresolved.map((u) => u.id))
      setFeed((prev) => prev.filter((e) => unresolvedIds.has(e.id)))
      variantsAsked.current = new Set([...variantsAsked.current].filter((id) => unresolvedIds.has(id)))
      if (result.applied > 0) {
        setCelebration(
          result.unresolved.length
            ? `Added ${result.applied} card${result.applied === 1 ? '' : 's'}. ${result.unresolved.length} still need a printing picked.`
            : `Added ${result.applied} card${result.applied === 1 ? '' : 's'} to your collection.`,
        )
      }
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'that did not save')
    } finally {
      setCommitting(false)
    }
  }, [])

  const openDetail = useCallback(
    (cardId: string) => {
      navigate({ search: ((prev: { card?: string }) => ({ ...prev, card: cardId })) as never, resetScroll: false })
    },
    [navigate],
  )

  const commitCount = feed.reduce((n, e) => n + (e.cardId ? e.quantity : 0), 0)
  const showCamera = supportsCamera && camState !== 'unavailable'

  return (
    <Content cap={1000}>
      <div className="mb-[8px] flex items-center gap-[10px]">
        <span className="flex h-[40px] w-[40px] items-center justify-center rounded-lg bg-action-primary text-action-primary-text">
          <Icon name="camera" size={22} />
        </span>
        <h1 className="text-[28px] font-bold leading-[34px] text-text-primary">Scan cards</h1>
      </div>
      <p className="mb-[16px] max-w-[560px] text-[14px] leading-[21px] text-text-muted">
        Line cards up in the frame — they capture on their own the moment they hold steady, and each one lands below to
        verify before it joins your collection.
      </p>

      <div
        ref={stageWrapRef}
        className="relative mx-auto flex w-full max-w-[440px] flex-col overflow-hidden rounded-2xl border border-border-default bg-surface-primary"
        style={{ height: 'min(80vh, 760px)' }}
      >
        {showCamera ? (
          <>
            <CameraStage
              videoRef={videoRef}
              camState={camState}
              engineState={engineState}
              engineError={engineError}
              hint={hint}
              stackItems={stack}
              onStackNodeRef={(id, el) => {
                if (el) stackNodesRef.current.set(id, el)
                else stackNodesRef.current.delete(id)
              }}
              onRetry={() => void retryCamera()}
              onReportCamera={() => void reportCamera()}
              flashSignal={flashSignal}
              onBoxChange={(b) => {
                cameraBoxRef.current = b
              }}
            />
            <div className="flex h-[48px] shrink-0 items-center gap-[8px] overflow-x-auto border-b border-divider-subtle bg-surface-secondary px-[12px]">
              <button
                type="button"
                onClick={manualCapture}
                className="flex h-[32px] shrink-0 items-center gap-[6px] rounded-full bg-action-primary px-[14px] text-[13px] font-bold text-action-primary-text hover:bg-action-primary-hover"
              >
                <Icon name="plus" size={14} /> Capture
              </button>
              <span className="text-[12px] text-text-muted">
                {engineStatus === 'loading' && 'Loading the scanner…'}
                {engineStatus === 'error' && (engineError ?? 'The scanner could not start.')}
                {engineStatus === 'ready' && !engineState && 'Warming up…'}
              </span>
            </div>
          </>
        ) : (
          <div className="p-[14px]">
            <UploadFallback
              unavailableReason={
                camState === 'denied'
                  ? 'Camera access was blocked.'
                  : 'Live camera isn’t available here (it needs a secure https connection and a rear camera).'
              }
              onFile={handleUploadFile}
            />
          </div>
        )}

        <VerifyFeed
          entries={feed}
          onQuantityChange={changeQuantity}
          onVariantChange={changeVariant}
          onCorrect={correctEntry}
          onRemove={removeEntry}
          onReport={reportEntry}
          onOpenDetail={openDetail}
          registerThumbNode={(id, el) => {
            if (el) feedThumbNodesRef.current.set(id, el)
            else feedThumbNodesRef.current.delete(id)
          }}
        />

        <CommitBar count={commitCount} committing={committing} onCommit={() => void handleCommit()} />

        {/* shared flight overlay — couriers live here, siblings of the
            camera view so they are never clipped by its overflow:hidden */}
        <div ref={flyLayerRef} className="pointer-events-none absolute inset-0 z-[55]" />

        {celebration && (
          <div className="pointer-events-none absolute inset-x-0 top-[10px] z-[60] flex justify-center px-[14px]">
            <div className="pointer-events-auto flex items-center gap-[8px] rounded-full bg-change-positive px-[14px] py-[8px] text-[13px] font-bold text-surface-primary shadow-elevated motion-safe:animate-[sheet-panel-in_220ms_cubic-bezier(0.22,0.61,0.36,1)_both]">
              <Icon name="check-circle" size={16} /> {celebration}
            </div>
          </div>
        )}
      </div>

      {notice && (
        <div className="mx-auto mt-[12px] flex max-w-[440px] items-center gap-[8px] rounded-xl border border-border-default bg-surface-secondary p-[10px] text-[13px] text-text-muted">
          <Icon name="alert" size={15} />
          <span className="flex-1">{notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="text-text-muted hover:text-text-primary">
            <Icon name="close" size={14} />
          </button>
        </div>
      )}

      {search.card && (
        <CardSheet
          cardId={search.card}
          onClose={() =>
            navigate({ search: ((prev: { card?: string }) => ({ ...prev, card: undefined })) as never, resetScroll: false })
          }
        />
      )}
    </Content>
  )
}
