import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearch, useNavigate } from '@tanstack/react-router'
import { api, type ScanMatch, type ScanResponse } from '../lib/api'
import { Icon } from '../components/Icon'
import { CardSheet } from './CardDetail'
import type { CaptureResult } from '../scan/engine/contract'
import { useCamera } from '../scan/ui/camera'
import { useScanEngine } from '../scan/ui/useScanEngine'
import { CameraStage } from '../scan/ui/CameraStage'
import { VerifyFeed } from '../scan/ui/VerifyFeed'
import { PrimaryActionBar } from '../scan/ui/PrimaryActionBar'
import { UploadFallback } from '../scan/ui/UploadFallback'
import { SwipeReview } from '../scan/ui/SwipeReview'
import { HelpModal } from '../scan/ui/HelpModal'
import { commitFeed } from '../scan/ui/commit'
import { OCR_ENABLED, uploadScanFlag, recordCaptureEvent, recordIdentityEvent, recordLockEvent } from '../scan/ui/flags'
import { narrowedIdentity, OCR_NARROW_TIMEOUT_MS, readCardFields, resolveWithOcr } from '../scan/ui/ocrNarrow'
import {
  commitGate,
  identityFromMatch,
  identityOutcome,
  identityRecord,
  initialIdentity,
  reduceIdentity,
  unresolvedCount,
  type Identity,
  type IdentityEvent,
  type IdentityState,
} from '../scan/ui/identity'
import { createOcrStage } from '../scan/ocr/staging'
import type { OcrRead } from '../scan/ocr/pipeline'
import {
  CAPTURE_TIMEOUT_MS,
  deadlineSignal,
  IDENTIFY_TIMEOUT_MS,
  IDENTITY_DEADLINE_MS,
  nextFrameSafe,
  settleWithin,
  withTimeout,
} from '../scan/ui/deadline'
import { toScanBytes } from '../scan/ui/uploadNormalize'
import { canonicalSquareMap, framePointToCss, quadPose } from '../scan/ui/coords'
import { bump, DURATION, flyArc, rectRelativeTo } from '../scan/ui/motion'
import type { FeedEntry, FeedVariant, StackItem } from '../scan/ui/types'
import type { Quad } from '../scan/engine/contract'
import { gateScanResponse, judgeTie } from '../scan/ui/tieGate'
import { createCapturedRegions, type CapturedRegions, type RegionTrack } from '../scan/ui/regions'

// The scanner (production rebuild — see roadmap/plans/card-scanner-redesign,
// PLAN.md D1-D6 — plus the owner's post-field-test UX round, 2026-09-03).
//
// A SINGLE-VIEWPORT APP SCREEN, not a scrolling page: this component owns a
// `position: fixed` region sized against AppShell's own published
// `--app-header-h`/`--app-sidebar-w` custom properties (theme.css / the
// inline <style> AppShell.tsx writes), so it fills exactly the space below
// the persistent nav without adding a second layout system. AppShell's
// header/sidebar stay — `isChromelessPathname` was deliberately NOT touched,
// because that mechanism also controls which routes skip AuthGuard
// (lib/landingRoute.ts), and /scan writing to the collection must stay
// behind sign-in. See scan/ui/camera.ts and useScanEngine.ts for the other
// half of "no page scroll": both hooks are driven by an explicit `active`
// flag now (not just mount/unmount), which is what lets Step 2 fully stop
// and release the camera without unmounting the route.
//
// TWO STEPS. Step 1 (Scan): camera live, captures accumulate in the bin
// below it (collapsible to a strip or expanded full-screen without touching
// the camera). Step 2 (Verify): the camera is torn down entirely and the
// list — or the card-by-card swipe review — takes the whole screen, ending
// in the one batched collection write.
type Step = 'scan' | 'verify'
type ReviewMode = 'list' | 'swipe'

let uidSeq = 0
function makeId(prefix: string): string {
  uidSeq += 1
  return `${prefix}-${Date.now()}-${uidSeq}`
}

/** Telemetry rounding. A raw float64 costs ~18 bytes in the JSON meta and says
 *  nothing the third decimal does not — the saturation gate's own margins are
 *  0.018 and 0.019 wide. */
function round3(n: number | null | undefined): number | null {
  return typeof n === 'number' && Number.isFinite(n) ? Math.round(n * 1000) / 1000 : null
}

/**
 * WHAT THE MATCHER SAID, for the capture record — the fix for the one thing the
 * 2026-09-04 owner session could not measure.
 *
 * That session produced 42 captures and matcher output for 21 of them: only the
 * rows the owner pressed *report* on carried a result, so every accuracy figure
 * it yielded was conditional on having been reported — i.e. measured on the
 * failure population by construction, and explicitly not quotable as a
 * session-wide rate. Reconstructing the rest meant cross-referencing report
 * flags against a collection whose 28 rows all shared one commit timestamp.
 * Attaching this to EVERY capture makes the next session self-scoring with no
 * cross-referencing at all.
 *
 * Small on purpose: the top-1's identity and distance, the TIE MARGIN that
 * decides whether the claim survives `tieGate`, and the distances of the
 * alternates. Deliberately NOT the full match objects — those carry names, set
 * names and two image URLs each, five deep, for numbers that add nothing. The
 * pre-gate `matched` is recorded next to the post-gate one because the gap
 * between them IS the gate's effect, and 70.8% of that session's results were
 * exact ties.
 */
function matcherOutcomeFor(raw: ScanResponse | null): Record<string, unknown> {
  if (!raw) return { match: null }
  const verdict = judgeTie(raw.matches)
  const top = raw.matches[0]
  return {
    match: {
      matchedRaw: raw.matched,
      matchedAfterTieGate: gateScanResponse(raw)?.matched ?? false,
      threshold: raw.threshold,
      indexSize: raw.indexSize,
      top: top ? { cardId: top.cardId, setId: top.setId, distance: top.distance, confidence: round3(top.confidence) } : null,
      // Infinity when every candidate is the same card — JSON would write that
      // as null, so it is said in words the reader cannot misread as "missing".
      tieMargin: Number.isFinite(verdict.margin) ? verdict.margin : 'no-rival',
      rivalCardId: verdict.rival?.cardId ?? null,
      alternates: raw.matches.slice(1).map((m) => ({ cardId: m.cardId, distance: m.distance })),
    },
  }
}

/** Two rAFs: the first fires once the browser is ready to paint the frame
 *  React just committed for; the second confirms that paint actually
 *  happened, so a caller reading layout right after this is measuring the
 *  real, current DOM rather than a state that hasn't been committed yet.
 *
 *  Now via `nextFrameSafe`, which races those rAFs against a timer: rAF does
 *  not fire in a backgrounded tab, and a phone screen locking mid-capture used
 *  to park this await forever — see scan/ui/deadline.ts. */
const nextFrame = nextFrameSafe

/** No "help"/"question" glyph exists in the shared `Icon` set (checked
 *  components/Icon.tsx's `IconName` union) — authored locally rather than
 *  widening a shared file this task doesn't own for one badge. */
function HelpIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9.25" />
      <path d="M9.3 9.3a2.7 2.7 0 1 1 3.6 2.55c-.7.28-.9.66-.9 1.4v.3" />
      <circle cx="12" cy="17" r="0.15" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function Scan() {
  const search = useSearch({ from: '/scan' })
  const navigate = useNavigate({ from: '/scan' })

  // ── two-step flow + review chrome ────────────────────────────────────────
  const [step, setStep] = useState<Step>('scan')
  const [binExpanded, setBinExpanded] = useState(false)
  const [reviewMode, setReviewMode] = useState<ReviewMode>('list')
  const [helpOpen, setHelpOpen] = useState(false)

  const videoRef = useRef<HTMLVideoElement>(null)
  const stageWrapRef = useRef<HTMLDivElement>(null)
  const flyLayerRef = useRef<HTMLDivElement>(null)
  const cameraBoxRef = useRef({ width: 0, height: 0 })
  const frameSizeRef = useRef({ width: 0, height: 0 })
  /** The SENSOR's own dimensions, not the canonical frame's. The capture-flight
   *  courier needs both to place the thumbnail where the video is actually
   *  showing the card — see `coords.canonicalSquareMap`. */
  const streamSizeRef = useRef({ width: 0, height: 0 })

  // Camera + engine are both driven by whether Step 1 is showing — "Verify"
  // COMPLETELY dismisses the camera (stream stopped, hardware released), not
  // just hides its UI; going back resumes it. `camState==='live'` further
  // gates the engine so it never spins up against a stream that failed.
  const { camState, supportsCamera, start: retryCamera } = useCamera(videoRef, step === 'scan')
  const engineActive = step === 'scan' && camState === 'live'
  const {
    status: engineStatus,
    error: engineError,
    state: engineState,
    capture,
  } = useScanEngine(videoRef, engineActive)

  // Mirrored into a ref so the capture pipeline can attach the gate state that
  // produced a capture without taking `engineState` (which changes every detect
  // tick, ~8x/s) as a dependency and rebuilding the whole callback chain.
  const engineStateRef = useRef(engineState)
  useEffect(() => {
    engineStateRef.current = engineState
    if (engineState) {
      frameSizeRef.current = engineState.frame
      streamSizeRef.current = engineState.stream
    }
  }, [engineState])

  const [stack, setStack] = useState<StackItem[]>([])
  const [feed, setFeed] = useState<FeedEntry[]>([])
  const [flashSignal, setFlashSignal] = useState(0)
  const [hint, setHint] = useState('Point the camera at a card')
  const [notice, setNotice] = useState<string | null>(null)
  const [committing, setCommitting] = useState(false)
  /** Which needs-you thumbnail has its picker open. */
  const [picking, setPicking] = useState<string | null>(null)
  /** The unresolved-scans confirm (commit.ts's `commitGate`), or null. */
  const [commitConfirm, setCommitConfirm] = useState<string | null>(null)

  const feedRef = useRef<FeedEntry[]>(feed)
  useEffect(() => {
    feedRef.current = feed
  }, [feed])
  const stackRef = useRef<StackItem[]>(stack)
  useEffect(() => {
    stackRef.current = stack
  }, [stack])
  /** How many thumbnails are waiting on the reader, in a ref because the hint
   *  is written from the detect-tick effect and adding `stack` to THAT effect's
   *  dependencies would re-run the region ageing and the auto-capture branch on
   *  every stack change. The effect fires ~8x/s, so the line is current. */
  const unresolvedRef = useRef(0)
  useEffect(() => {
    unresolvedRef.current = unresolvedCount(stack)
  }, [stack])

  // ── THE IDENTITY RACE'S BOOKKEEPING ───────────────────────────────────────
  //
  // Three ref maps, and the split between them is deliberate.
  //
  //   identitiesRef  THE AUTHORITATIVE PHASE, written synchronously. The race
  //                  dispatches from detached async chains and the reader
  //                  dispatches from event handlers, and both need to read the
  //                  CURRENT state to reduce against it — a `stack` snapshot
  //                  closed over by a callback is one render behind, which is
  //                  exactly how "the deadline fired after the pick" becomes a
  //                  card the reader chose being replaced by one they didn't.
  //   captureDataRef the capture's immutable half (blob, preview URL, track),
  //                  so a dispatch can land a row without waiting for `stack`
  //                  to have re-rendered.
  //   arrivalsRef    resolves once the capture→stack courier has landed. The
  //                  stack→list flight awaits it, so a very fast identify can
  //                  never launch the second courier out of a thumbnail the
  //                  first one has not put on screen yet.
  const identitiesRef = useRef(new Map<string, IdentityState>())
  const captureDataRef = useRef(new Map<string, StackItem>())
  const arrivalsRef = useRef(new Map<string, Promise<void>>())

  const refractoryRef = useRef(new Set<number>())

  // ── THE ON-DEVICE OCR LANE (scan/ocr/**), STAGED BEHIND THE DETECTOR ──────
  //
  // Two separate things live here and they are deliberately not the same thing:
  //
  //   ocrStageRef      WHEN the 15.6 MB starts downloading — only once the
  //                    camera is live and LC050 is ready. `scan/ocr/staging.ts`
  //                    carries the reasoning and the tests; the short version is
  //                    that started together the two downloads are one 35 MB
  //                    wait in which the detector finishes last.
  //   ocrUnavailable   whether POST /scan/resolve exists on this backend. The
  //                    API lane ships independently of this one and `pnpm dev`
  //                    talks to the LIVE backend by default, so "app has the
  //                    code, server does not" is the ordinary case, not an edge
  //                    one. First 404 turns the narrowing off for the session;
  //                    the READ still runs, because the fields are the thing
  //                    this lane exists to measure and they go into the capture
  //                    record either way.
  const ocrStageRef = useRef(
    createOcrStage(() => {
      // Swallowed, like `warmOcr`'s own failure: a chunk that will not load
      // leaves the scanner exactly as it is without this lane, and telling a
      // reader who never asked for OCR that OCR failed is noise. The next
      // capture retries — the session cache clears itself on rejection.
      void import('../scan/ocr')
        .then((m) => m.warmOcr())
        .catch(() => {})
    }),
  )
  const ocrUnavailableRef = useRef(false)
  useEffect(() => {
    ocrStageRef.current.update({ enabled: OCR_ENABLED, detectorReady: engineStatus === 'ready' })
  }, [engineStatus])

  /**
   * THE CAPTURED-REGION REFRACTORY — duplicate captures. The policy, its
   * constants and the evidence that sized them live in `scan/ui/regions.ts`,
   * so the regression replay drives the SHIPPING object rather than a copy of
   * it. This route only feeds it ticks and asks it questions.
   */
  const regionsRef = useRef<CapturedRegions | null>(null)
  // Lazily, and exactly once. `useRef(createCapturedRegions())` would re-run the
  // factory on EVERY render and throw the result away, and this component
  // re-renders on every detect tick.
  regionsRef.current ??= createCapturedRegions()
  const regions = regionsRef.current

  const ageRegions = useCallback(
    (tracks: readonly RegionTrack[]) => {
      regions.tick(Date.now(), tracks)
    },
    [regions],
  )

  const alreadyCapturedHere = useCallback((quad: Quad): boolean => regions.suppressed(quad), [regions])
  const noteCapture = useCallback(
    (quad: Quad, trackId: number) => {
      regions.note(quad, trackId, Date.now())
    },
    [regions],
  )
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
        // Straight off the same call — swipe-review's "resulting total"
        // reads this with no second (batch or per-entry) ownership request.
        ownedQuantity: v.quantity ?? 0,
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

  /**
   * Writes a settled identity into the feed — a new row, or a quantity bump on
   * an existing one by cardId. Pure state; the caller owns the flight around it.
   *
   * `identity === null` is still reachable, but only from the UPLOAD fallback,
   * which has no camera, no stack and therefore nowhere for a needs-you
   * thumbnail to live. On the camera path an unnamed capture no longer lands
   * here at all — it stays on the stack, which is the whole of the 2026-09-05
   * ruling.
   */
  const addFeedEntry = useCallback(
    (identity: Identity | null, alternates: ScanMatch[], stackItem: StackItem) => {
      setFeed((prev) => {
        const existing = identity ? prev.find((e) => e.cardId === identity.cardId) : undefined
        if (existing) {
          return prev.map((e) => (e.id === existing.id ? { ...e, quantity: e.quantity + 1, mergeTick: e.mergeTick + 1 } : e))
        }
        const entry: FeedEntry = identity
          ? {
              id: identity.cardId,
              cardId: identity.cardId,
              matched: true,
              name: identity.name,
              setName: identity.setName,
              number: identity.number,
              rarity: identity.rarity,
              images: identity.images,
              capturePreviewUrl: stackItem.previewUrl,
              captureBlob: stackItem.blob,
              // `-1`/`0` when the PRINTED-NUMBER ladder named this card: phash
              // never nominated it, so there is no distance and none is
              // invented. FeedEntryCard reads the -1 and shows provenance
              // instead of a meter.
              confidence: identity.confidence ?? 0,
              distance: identity.distance ?? -1,
              quantity: 1,
              variantId: null,
              variants: [],
              printingPicked: false,
              detectingPrinting: false,
              alternates,
              capturedAt: Date.now(),
              mergeTick: 0,
              verified: false,
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
              printingPicked: false,
              detectingPrinting: false,
              alternates,
              capturedAt: Date.now(),
              mergeTick: 0,
              verified: false,
            }
        return [entry, ...prev]
      })
      if (identity) void loadVariants(identity.cardId)
      setHint(identity ? `Got it — ${identity.name}` : 'Needs a closer look')
    },
    [loadVariants],
  )

  /** Take a capture off the camera — landed, or discarded by a retake. The
   *  object URL is deliberately NOT revoked (see `objectUrlsRef`): a landed row
   *  still shows it, and a session revokes everything once, on unmount. */
  const dropStackItem = useCallback((id: string) => {
    identitiesRef.current.delete(id)
    captureDataRef.current.delete(id)
    arrivalsRef.current.delete(id)
    setPicking((p) => (p === id ? null : p))
    setStack((prev) => prev.filter((s) => s.id !== id))
  }, [])

  /**
   * A capture has been named — the tick, then the courier to the list.
   *
   * The order matters and is the ruling's: the thumbnail confirms ON THE CAMERA
   * (`DURATION.confirmTick`), and only then does it move down. A flight that
   * starts the instant the answer lands is a card that vanishes from under the
   * reader's eye with no statement that anything was decided.
   */
  const landIdentity = useCallback(
    async (item: StackItem, st: IdentityState) => {
      const identity = st.match
      if (!identity) return
      // Never fly out of a thumbnail the arrival courier has not delivered yet.
      await settleWithin(arrivalsRef.current.get(item.id) ?? Promise.resolve(), 3000)
      await new Promise<void>((r) => window.setTimeout(r, DURATION.confirmTick))
      addFeedEntry(identity, st.candidates, item)
      await nextFrame()
      const wrap = stageWrapRef.current
      const stackEl = stackNodesRef.current.get(item.id)
      // A matched row's id IS its cardId (see `addFeedEntry`), including when
      // this capture merged into a row that was already there.
      const thumbEl = feedThumbNodesRef.current.get(identity.cardId)
      if (thumbEl && wrap) {
        const fromRect = rectRelativeTo(stackEl ?? thumbEl, wrap)
        await settleWithin(
          flyToTarget(
            item.previewUrl,
            { cx: fromRect.cx, cy: fromRect.cy, width: fromRect.width || 54, height: fromRect.height || 75 },
            thumbEl,
          ),
          2000,
        )
      }
      dropStackItem(item.id)
    },
    [addFeedEntry, dropStackItem, flyToTarget],
  )

  /**
   * The one way anything reaches the identity machine.
   *
   * Reduces against `identitiesRef` (synchronous, current), mirrors the result
   * into `stack` for rendering, and turns the two terminal phases into the
   * effects they mean. Everything else — which answer arrived, in what order,
   * whether the reader got there first — is `identity.ts`'s problem, not this
   * component's.
   */
  const dispatchIdentity = useCallback(
    (id: string, ev: IdentityEvent) => {
      const cur = identitiesRef.current.get(id)
      if (!cur) return
      const next = reduceIdentity(cur, ev)
      if (next === cur) return
      identitiesRef.current.set(id, next)
      setStack((prev) => prev.map((s) => (s.id === id ? { ...s, identity: next } : s)))

      // THE IDENTITY RECORD — round 7's 26 device-unknown outcomes, written down
      // this time. Posted on a CHANGE OF OUTCOME, not on every transition: a
      // reader opening the picker on a needs-you thumbnail moves the state but
      // not the answer, and two identical records would say the machine changed
      // its mind when it did not. `confident` and `discarded` are terminal in the
      // reducer, so a capture emits at most two — needs-you, then whatever the
      // reader made of it.
      if (identityOutcome(next) !== identityOutcome(cur)) {
        const item = captureDataRef.current.get(id)
        const record = item ? identityRecord(next, Date.now() - item.capturedAt) : null
        if (item && record) {
          void recordIdentityEvent({ rectified: item.blob, captureId: id, detail: record })
        }
      }

      if (next.phase === 'discarded') {
        dropStackItem(id)
        return
      }
      if (next.phase === 'confident' && cur.phase !== 'confident') {
        const item = captureDataRef.current.get(id)
        if (item) void landIdentity({ ...item, identity: next }, next)
      }
      // No hint is set here on purpose. The auto-capture effect rewrites the
      // hint on every detect tick (~8x/s), so anything announced from a
      // one-shot callback is gone before it is read; the standing "N need you"
      // line lives in that effect instead, off `unresolvedRef`.
    },
    [dropStackItem, landIdentity],
  )

  // ── the needs-you affordances ─────────────────────────────────────────────
  //
  // `engage` is dispatched with the picker OPEN, not with the pick: from the
  // moment the reader is looking at the candidates, a late confident answer
  // stops being allowed to swap the card out from under them (identity.ts).
  const openPicker = useCallback(
    (id: string) => {
      dispatchIdentity(id, { type: 'engage' })
      // Opens, never toggles. `useDismiss` inside the popover already closes it
      // on an outside mousedown — and a second tap on the thumbnail IS an
      // outside mousedown — so a toggle here would fight it and read as a
      // thumbnail that cannot be closed by tapping it twice.
      setPicking(id)
    },
    [dispatchIdentity],
  )
  const pickForStackItem = useCallback(
    (id: string, match: ScanMatch) => {
      setPicking(null)
      dispatchIdentity(id, { type: 'pick', match })
    },
    [dispatchIdentity],
  )
  const retakeStackItem = useCallback(
    (id: string) => {
      // Release the refractory hold on the track this capture came from, so the
      // same card presenting again is a capture rather than a suppression. The
      // captured REGION is left alone on purpose: it retires on its own clock
      // once the card leaves (regions.ts), and a card still lying in frame is
      // one the reader is about to move anyway — which is what a retake is.
      const trackId = captureDataRef.current.get(id)?.trackId
      if (typeof trackId === 'number') refractoryRef.current.delete(trackId)
      dispatchIdentity(id, { type: 'retake' })
    },
    [dispatchIdentity],
  )

  /** The full capture → stack → identify → feed pipeline for one engine capture. */
  const handleCaptured = useCallback(
    async (result: CaptureResult, trigger: 'auto' | 'manual') => {
      const previewUrl = trackUrl(URL.createObjectURL(result.blob))
      // Minted BEFORE the capture record so both halves of this capture's
      // telemetry carry it: the `capture-event` posted below, and the
      // `identity-event` posted minutes later when the reader finally decides
      // what the card was. Without a shared key the second is unattributable —
      // which is the shape round 7's 26 unknown outcomes already had.
      const captureId = makeId('cap')
      // The matcher's verdict, handed to the recorder below as a promise so the
      // capture record can carry it (scan/ui/flags.ts `CaptureEventInput.outcome`).
      // The record's frame and crop are snapshotted before this ever settles.
      let publishMatcherOutcome: (v: Record<string, unknown> | null) => void = () => {}
      const matcherOutcome = new Promise<Record<string, unknown> | null>((resolve) => {
        publishMatcherOutcome = resolve
      })
      // THE ACCEPTANCE RECORD (scan/ui/flags.ts). Fire-and-forget, owner-only,
      // and deliberately taken BEFORE any await that could change the scene:
      // the frame recorded here is the one this quad was measured against.
      void recordCaptureEvent({
        video: videoRef.current,
        rectified: result.blob,
        outcome: matcherOutcome,
        detail: {
          captureId,
          trigger,
          quad: result.quad,
          trackId: result.trackId,
          // THE UNITS THIS QUAD IS IN — canonical 416 space, from the engine's
          // own state, the same field and the same source the lock recorder
          // uses. The recorder used to fill this in itself from the <video>'s
          // dimensions, which put 960x1280 beside a canonical quad in one
          // record; the sensor size is now recorded as `stream` instead.
          frame: engineStateRef.current?.frame ?? null,
          hasObj: engineStateRef.current?.hasObj ?? null,
          reticle: engineStateRef.current?.reticle ?? null,
          cameraBox: cameraBoxRef.current,
          track: (() => {
            const t =
              engineStateRef.current?.stable.find((s) => s.id === result.trackId) ??
              engineStateRef.current?.pending.find((s) => s.id === result.trackId)
            return t ? { age: t.age, coasting: t.coasting } : null
          })(),
          step,
          perf: engineStateRef.current?.perf ?? null,
          // THE ONE PATH THAT CAN MEASURE A CARD BELOW THE CLUTTER GATE. A card
          // whose signature sits under DEFAULT_LOCK_MIN_SATURATION never locks,
          // so it produces no lock-event and is invisible to that channel — but
          // the reader can still take it with the manual Capture button, and
          // this is that capture's record. A `trigger: 'manual'` event with a
          // low `saturation` is exactly the evidence round 3 §9.7 says nobody
          // has: a real card the 0.13 threshold refuses.
          saturation: round3(engineStateRef.current?.saturation),
        },
      })
      const stackItem: StackItem = {
        id: captureId,
        trackId: result.trackId,
        previewUrl,
        blob: result.blob,
        capturedAt: Date.now(),
        identity: initialIdentity(),
      }
      // Synchronously, BEFORE any await: the race below dispatches into these
      // maps and a `setState` that has not flushed is not somewhere to look a
      // capture up.
      identitiesRef.current.set(stackItem.id, stackItem.identity)
      captureDataRef.current.set(stackItem.id, stackItem)
      let markArrived: () => void = () => {}
      arrivalsRef.current.set(
        stackItem.id,
        new Promise<void>((r) => {
          markArrived = r
        }),
      )
      setStack((prev) => [stackItem, ...prev])

      // Identify runs CONCURRENTLY with the fly-to-stack visual — the
      // network round trip overlaps travel time instead of waiting behind a
      // fixed simulated delay, so the reader sees the real latency, not more.
      // A DEADLINE, NOT AN OPTIMISATION. `api.scan` sets no timeout of its own
      // (lib/api.ts `request`), so before this an identify that never came back
      // parked the await below forever — and with it `captureBusyRef`, which is
      // the "Got it — hold on…" wedge. Both an abort signal (so the socket is
      // released) and a `withTimeout` (so the AWAIT ends even if the abort is
      // ignored): the ref must clear on every path, not on the polite ones.
      const identifyPromise: Promise<ScanResponse | null> = (async () => {
        const { signal, done } = deadlineSignal(IDENTIFY_TIMEOUT_MS)
        try {
          const bytes = await result.blob.arrayBuffer()
          return await withTimeout(api.scan(bytes, 'image/jpeg', 5, 'low', signal), IDENTIFY_TIMEOUT_MS, 'identify')
        } catch {
          // A failed or timed-out identify is NOT a failed capture: the JPEG is
          // good and the row still lands, as "Unidentified card" for the reader
          // to resolve. Losing the capture too would be the worse outcome.
          return null
        } finally {
          done()
        }
      })()

      // ── OCR, IN PARALLEL, AND NOTHING WAITS FOR IT ─────────────────────────
      //
      // Started here so it overlaps the identify round trip and the fly-to-stack
      // animation, and deliberately NOT awaited anywhere above the feed write:
      // REPORT.md §6.3 measured the whole capture at 0.67 s and projects this at
      // 1.8-3.4 s on the owner's iPhone, so an OCR read on the capture path
      // would cost more than the entire scanner rebuild's latency win.
      //
      // The READ only. The narrowing round trip runs behind the identify, once
      // there are `priorMatches` for it to re-rank — see below.
      const ocrReadPromise: Promise<OcrRead | null> = OCR_ENABLED
        ? withTimeout(readCardFields(result.blob), OCR_NARROW_TIMEOUT_MS, 'ocr').catch(() => null)
        : Promise.resolve(null)

      // ── THE RACE, AND IT IS DETACHED FROM THE CAPTURE PATH ────────────────
      //
      // This is the structural half of the 2026-09-05 ruling. It used to be
      // straight-line code below the arrival flight: await identify, write the
      // row, fly to the list — all inside `handleCaptured`, which `runCapture`
      // awaits while holding `captureBusyRef`. Waiting for a CONFIDENT answer in
      // that position would have held the busy flag for up to
      // IDENTITY_DEADLINE_MS and auto-capture with it, which is precisely the
      // thing the ruling forbids: "never blocks scanning".
      //
      // So the capture path now ends at the arrival flight, and everything that
      // decides what the thumbnail becomes runs out here, dispatching into the
      // machine. The reader may take the next card the moment the first one has
      // landed on the stack.
      const deadlineTimer = window.setTimeout(
        () => dispatchIdentity(stackItem.id, { type: 'deadline' }),
        IDENTITY_DEADLINE_MS,
      )
      void (async () => {
        let res: ScanResponse | null = null
        try {
          res = await identifyPromise
          // Hand the verdict to the capture record, which has been holding its
          // snapshot for it. Before any early return below could skip it.
          publishMatcherOutcome(matcherOutcomeFor(res))
          // THE TIE GATE is applied inside the reducer (`identity.ts` calls
          // `gateScanResponse`), not here, so the one place that decides whether
          // phash may claim a card is the same place that decides whether the
          // ladder may. A top hit tied within TIE_MARGIN of a DIFFERENT card
          // still fills the picker; it just does not get to name the row.
          dispatchIdentity(stackItem.id, { type: 'phash', res })

          const read = await ocrReadPromise
          dispatchIdentity(stackItem.id, { type: 'read', read })

          // EVERY PATH BELOW REPORTS THE RESOLVE EVENT EXACTLY ONCE, including
          // the paths where no call is made at all — OCR off, nothing read, the
          // endpoint already known missing. `resolved: null` is how the machine
          // hears "no second answer is coming", and without it a thumbnail that
          // could flip to needs-you immediately would instead sit spinning until
          // the deadline for an answer that was never in flight.
          if (!read || ocrUnavailableRef.current) {
            dispatchIdentity(stackItem.id, { type: 'resolve', resolved: null })
            return
          }
          const { signal, done } = deadlineSignal(OCR_NARROW_TIMEOUT_MS)
          let outcome
          try {
            outcome = await resolveWithOcr(read, res?.matches ?? [], signal)
          } finally {
            done()
          }
          // One 404 is enough. The endpoint either exists on this backend or it
          // does not, and asking again every capture would spend a round trip
          // per card to learn the same thing.
          if (outcome.unavailable) ocrUnavailableRef.current = true
          dispatchIdentity(stackItem.id, { type: 'resolve', resolved: outcome.resolved })

          // AND THE OLD JOB, UNCHANGED: a row that already landed on PHASH's
          // answer can still be corrected by this. The race consumed the same
          // verdict a moment ago, but only to name a capture that had NOT been
          // named; where phash got there first the row exists, the reader may
          // have touched it, and `narrowedIdentity` is the policy that decides
          // whether a badge read gets to overrule any of that.
          setFeed((prev) =>
            prev.map((e) => {
              if (e.capturePreviewUrl !== previewUrl) return e
              const identity = narrowedIdentity(e, outcome.resolved)
              return identity ? { ...e, ...identity } : e
            }),
          )
        } catch {
          // An enrichment that can break a capture is worse than no enrichment —
          // the same rule the capture recorder is written under. But the machine
          // must still be told, or the pair never completes.
          dispatchIdentity(stackItem.id, { type: 'resolve', resolved: null })
        } finally {
          window.clearTimeout(deadlineTimer)
        }
      })()

      await nextFrame()
      const stackEl = stackNodesRef.current.get(stackItem.id)
      const wrap = stageWrapRef.current
      if (stackEl && wrap) {
        const box = cameraBoxRef.current
        const frame = frameSizeRef.current
        const stream = streamSizeRef.current
        // Approximate start pose from the captured quad's frame-space pose,
        // mapped through THE SAME `canonicalSquareMap` the reticle/quad overlay
        // uses — and this comment used to say that while the two had silently
        // diverged, which the 2026-09-04 owner session caught: the overlay was
        // on contain math and the courier on cover, so every thumbnail launched
        // ~54 px right of the quad that had just been highlighted. One helper,
        // one call, both places. Falls back to a plausible center-of-frame card
        // size if the box/frame haven't been measured yet (should not happen in
        // practice — start() only runs once a video frame exists).
        let from = { cx: box.width / 2, cy: box.height * 0.42, rotDeg: 0, width: 130, height: (130 * 88) / 63 }
        if (box.width && box.height && frame.width && frame.height) {
          const map = canonicalSquareMap(box.width, box.height, stream.width, stream.height, frame.width)
          const pose = quadPose(result.quad)
          const [cx, cy] = framePointToCss(map, pose.cx, pose.cy)
          from = { cx, cy, rotDeg: pose.rotDeg, width: pose.width * map.scale, height: pose.height * map.scale }
        }
        // Animations are awaited but never allowed to block: `anim.finished`
        // is also suspended while the document is hidden.
        await settleWithin(flyToTarget(previewUrl, from, stackEl), 2000)
        await settleWithin(bump(stackEl, 1.04, DURATION.settle), 1000)
      }
      // THE CAPTURE PATH ENDS HERE. The thumbnail is on the stack, the race is
      // running behind it, and `runCapture`'s `finally` is about to release
      // `captureBusyRef` — the next card can be scanned now. Whether this one
      // ever reaches the list is `dispatchIdentity`'s business, not this
      // function's, and no longer anything the reader has to wait through.
      markArrived()
    },
    [dispatchIdentity, flyToTarget, trackUrl, step],
  )

  const runCapture = useCallback(
    async (trackId: number, trigger: 'auto' | 'manual' = 'auto') => {
      captureBusyRef.current = true
      setFlashSignal((n) => n + 1)
      try {
        // ONE BACKSTOP OVER THE WHOLE PIPELINE. Every await inside now has its
        // own deadline, but this is the guarantee that does not depend on
        // having found them all: whatever happens in there, this call settles,
        // and the `finally` below runs. `captureBusyRef` staying true is the
        // difference between one lost capture and a scanner that is dead until
        // the page is reloaded.
        const result = await withTimeout(capture(trackId), CAPTURE_TIMEOUT_MS, 'capture')
        // Record WHERE this capture happened — and WHICH TRACK it was — before
        // the slow half of the pipeline runs, so a second lock arriving 200 ms
        // later on a fresh track id is already suppressed by the time it asks.
        // The track id is the region's identity handle from here on: it is what
        // decides whether the card is still there, so a region can no longer be
        // kept alive by the next card put down in the same place (regions.ts).
        noteCapture(result.quad, result.trackId)
        await withTimeout(handleCaptured(result, trigger), CAPTURE_TIMEOUT_MS, 'capture')
      } catch (e) {
        // The track vanished, the engine refused, or something ran past its
        // deadline — release the refractory hold so the SAME presence can retry
        // rather than being silently ignored for the rest of its dwell.
        refractoryRef.current.delete(trackId)
        setNotice(e instanceof Error ? e.message : 'that capture did not go through')
        // Put the reader back in a scanning state explicitly. Without this the
        // hint keeps whatever "Got it — hold on…" it was showing when the
        // capture died, which reads as a hang even though the engine is fine.
        setHint('Point the camera at a card')
      } finally {
        captureBusyRef.current = false
      }
    },
    [capture, handleCaptured, noteCapture],
  )

  // ── auto-capture: a persisted lock, refractory until the track departs
  //    and returns (ripSession.ts's departure-then-return precedent, applied
  //    to track ids instead of card ids). Only runs in Step 1. ──
  useEffect(() => {
    // `binExpanded` hides the camera without stopping it (the stream and the
    // engine deliberately survive an expand/collapse — see the CameraStage
    // comment). Auto-capture must NOT survive it: the reader is looking at
    // their card list, cannot see the preview, cannot aim it, and every frame
    // the engine locks onto while they do is by definition something they never
    // pointed at. Manual Capture is unreachable here too, so this suspends
    // automatic firing only, and collapsing the bin resumes it.
    if (!engineState || step !== 'scan' || binExpanded) return
    const presentIds = new Set(engineState.stable.map((q) => q.id))
    for (const id of refractoryRef.current) {
      if (!presentIds.has(id)) refractoryRef.current.delete(id)
    }
    // ONCE PER DETECT TICK, and this is what makes the presence signal dense
    // enough to be the refractory's clock: every remembered capture region is
    // refreshed against what is on screen right now, and retired only when
    // nothing has overlapped it for REGION_DEPARTURE_MS. Pending tracks count —
    // a card that briefly drops below the stability bar has not departed.
    ageRegions([...engineState.stable, ...engineState.pending])
    const locked = engineState.locked
    if (locked) {
      // Every lock, not just the ones that become captures — a lock the
      // refractory set swallows is still the engine saying "I would fire at
      // this", and those are exactly the ones no capture record would show.
      // Throttled to 1 per 2s inside the recorder.
      void recordLockEvent(videoRef.current, {
        quad: locked.quad,
        trackId: locked.id,
        age: locked.age,
        coasting: locked.coasting,
        hasObj: engineState.hasObj,
        reticle: engineState.reticle,
        frame: engineState.frame,
        cameraBox: cameraBoxRef.current,
        perf: engineState.perf,
        wouldCapture: !refractoryRef.current.has(locked.id) && !captureBusyRef.current,
        // So the NEXT drive can measure the refractory instead of inferring it:
        // how many regions are live, and whether this lock was one of them.
        regionCount: regions.count,
        suppressedByRegion: alreadyCapturedHere(locked.quad),
        // ── REGION GRACE EXPIRY, round 4's instrument ────────────────────────
        // Round 3 could see THAT a lock was free (`suppressedByRegion: false`)
        // but not WHY, and the why turned out to be the whole finding: the
        // region had expired during a multi-second detector dropout. These two
        // integers say it directly instead of making the next reader
        // reconstruct it from gaps between event timestamps — which is what
        // round 3 had to do, at a 2 s recorder throttle that blurs everything
        // shorter than that. `regionsExpired` is cumulative for the page;
        // `sinceRegionExpiryMs` is null until the first expiry, so "this free
        // lock came 40 ms after a region retired" is one subtraction away.
        regionsExpired: regions.expired,
        sinceRegionExpiryMs: regions.msSinceExpiry(Date.now()),
        // The clutter gate's own input, for the track this lock is about. See
        // EngineState.saturation: 0.13 has never been shown a low-saturation
        // card, and this is how a real device tells us where real cards sit.
        // Rounded — three decimals is far finer than the gate's own margins
        // (0.018 above the mail, 0.019 below the least colourful card) and
        // keeps the payload a handful of bytes.
        saturation: round3(engineState.saturation),
      })
    }
    if (
      locked &&
      !refractoryRef.current.has(locked.id) &&
      !captureBusyRef.current &&
      !alreadyCapturedHere(locked.quad)
    ) {
      refractoryRef.current.add(locked.id)
      void runCapture(locked.id, 'auto')
    }
    if (locked) setHint((h) => (h.startsWith('Got it') ? h : 'Got it — hold on…'))
    else if (engineState.stable.length > 0) setHint('Hold steady…')
    // THE STANDING NEEDS-YOU LINE. Only in the idle branch — while the reader is
    // aiming at something the hint belongs to that card, and interrupting a lock
    // to mention an older capture would be the scanner talking over itself. But
    // with nothing in frame there is nothing better to say, and "tap it" is the
    // only instruction the amber thumbnail does not give by itself.
    else if (unresolvedRef.current > 0)
      setHint(
        unresolvedRef.current === 1
          ? 'One scan needs you — tap it on the right'
          : `${unresolvedRef.current} scans need you — tap them on the right`,
      )
    else setHint('Point the camera at a card')
  }, [engineState, step, runCapture, binExpanded, ageRegions, alreadyCapturedHere, regions])

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
    void runCapture(candidate.id, 'manual')
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

  /** The reader naming the printing is what moves the slot out of `needs-pick`
   *  — `printingPicked`, not `variantId`, because `loadVariants` already sets a
   *  variantId (the primary) the moment the catalog answers and that is a
   *  default, not a decision. */
  const changeVariant = useCallback((id: string, variantId: number) => {
    setFeed((prev) => prev.map((e) => (e.id === id ? { ...e, variantId, printingPicked: true } : e)))
  }, [])

  const removeEntry = useCallback((id: string) => {
    setFeed((prev) => prev.filter((e) => e.id !== id))
  }, [])

  /**
   * `markVerified` is true only when the correction came out of swipe-review
   * (an explicit resolution the reader just made there) — the list view's
   * own "wrong card?" popover leaves it false, matching `FeedEntry.verified`'s
   * contract: "verified" means confirmed BY SWIPE, not merely edited.
   */
  const correctEntry = useCallback(
    (id: string, match: ScanMatch, markVerified = false) => {
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
            .map((e) =>
              e.id === target.id
                ? { ...e, quantity: e.quantity + current.quantity, mergeTick: e.mergeTick + 1, verified: e.verified || markVerified }
                : e,
            )
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
                // A different card has different printings, so the previous
                // row's pick means nothing here — the slot goes back to
                // needs-pick once the new card's variants land.
                printingPicked: false,
                verified: markVerified,
              }
            : e,
        )
      })
      void loadVariants(match.cardId)
    },
    [loadVariants],
  )

  const confirmEntry = useCallback((id: string) => {
    setFeed((prev) => prev.map((e) => (e.id === id ? { ...e, verified: true } : e)))
  }, [])

  /**
   * The upload fallback — no camera, so no stack and nowhere for a needs-you
   * thumbnail to live. This path therefore keeps the OLD behaviour on purpose:
   * an unnamed upload lands in the list as a "needs attention" row with its
   * top-5, which is the same ask in the only place this screen has to make it.
   * The tie gate still applies; it is applied here rather than in the reducer
   * because there is no capture in a race to reduce.
   */
  const handleUploadFile = useCallback(
    async (file: File) => {
      const { bytes, type } = await toScanBytes(file)
      const res = gateScanResponse(await api.scan(bytes, type, 5, 'low'))
      const blob = new Blob([bytes], { type })
      const previewUrl = trackUrl(URL.createObjectURL(blob))
      const stackItem: StackItem = {
        id: makeId('up'),
        trackId: -1,
        previewUrl,
        blob,
        capturedAt: Date.now(),
        identity: initialIdentity(),
      }
      const top = res?.matched ? res.matches[0] : undefined
      addFeedEntry(top ? identityFromMatch(top) : null, res?.matches ?? [], stackItem)
    },
    [addFeedEntry, trackUrl],
  )

  const [celebration, setCelebration] = useState<string | null>(null)
  useEffect(() => {
    if (!celebration) return
    const t = window.setTimeout(() => setCelebration(null), 4000)
    return () => window.clearTimeout(t)
  }, [celebration])

  const doCommit = useCallback(async () => {
    setCommitConfirm(null)
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
      // Nothing left to review — head back to a fresh scan rather than
      // leaving the reader stranded on an empty Verify screen.
      if (unresolvedIds.size === 0) setStep('scan')
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'that did not save')
    } finally {
      setCommitting(false)
    }
  }, [])

  /**
   * Pressing Add. Between the press and the write sits `commitGate` — the
   * 2026-09-05 ruling's "batch commit reminds [about unresolved ones]".
   *
   * The captures it is reminding about are NOT in the list: they are needs-you
   * thumbnails still on the camera, which is exactly why the reminder has to
   * exist. Committing ends the session and takes them with it, and the list the
   * reader is looking at does not show them, so without this the drop is
   * invisible by construction. One acknowledgement, then it proceeds — "yes,
   * those two were card backs" is a perfectly good answer.
   */
  const handleCommit = useCallback(() => {
    const gate = commitGate(stackRef.current, false)
    if (!gate.proceed) {
      setCommitConfirm(gate.prompt)
      return
    }
    void doCommit()
  }, [doCommit])

  const openDetail = useCallback(
    (cardId: string) => {
      navigate({ search: ((prev: { card?: string }) => ({ ...prev, card: cardId })) as never, resetScroll: false })
    },
    [navigate],
  )

  const goToVerify = useCallback(() => {
    setReviewMode('list')
    setStep('verify')
  }, [])
  const backToScan = useCallback(() => {
    setStep('scan')
    setBinExpanded(false)
  }, [])

  const totalQuantity = feed.reduce((n, e) => n + e.quantity, 0)
  const commitCount = feed.reduce((n, e) => n + (e.cardId ? e.quantity : 0), 0)
  // Only a hard 'unavailable' (no getUserMedia at all) falls back to upload.
  // 'denied' still renders CameraStage — its own overlay offers "Try camera
  // again", which is the more useful next step than jumping straight to a
  // file picker for a permission the reader might simply re-grant.
  const showCamera = supportsCamera && camState !== 'unavailable'

  return (
    // Fixed against AppShell's own published offsets — see the file header
    // for why this, not `isChromelessPathname`. `overflow-hidden` here is
    // the outer half of "no page scroll"; every scrollable region below is
    // its own, explicit `overflow-y-auto` (VerifyFeed's list; nothing else).
    <div
      className="fixed bottom-0 right-0 flex flex-col overflow-hidden bg-surface-primary"
      style={{ top: 'var(--app-header-h, 64px)', left: 'var(--app-sidebar-w, 0px)' }}
    >
      {/* ── minimal title bar: icon + name + help ── */}
      <div className="flex h-[46px] shrink-0 items-center gap-[8px] border-b border-divider-subtle bg-surface-secondary px-[14px]">
        <Icon name="camera" size={18} className="text-action-primary" />
        <span className="text-[14px] font-bold text-text-primary">Scan</span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => setHelpOpen(true)}
          aria-label="How scanning works"
          className="flex h-[30px] w-[30px] items-center justify-center rounded-full text-icon-default hover:bg-surface-tertiary hover:text-icon-hover"
        >
          <HelpIcon size={18} />
        </button>
      </div>

      <div ref={stageWrapRef} className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        {step === 'scan' ? (
          <>
            {
              // `hidden`, never unmounted. The stream (useCamera's
              // `streamRef`) lives independently of this DOM subtree, but
              // the <video>'s `srcObject` binding does not survive its own
              // element being destroyed and recreated — unmounting
              // CameraStage here would leave a fresh, blank <video> the
              // moment the bin collapses again, with the camera hardware
              // still running behind it. CSS-hiding keeps the element (and
              // the binding) alive across every expand/collapse.
            }
            <div className={`flex min-h-[180px] flex-[3] flex-col overflow-hidden ${binExpanded ? 'hidden' : ''}`}>
                {showCamera ? (
                  <>
                    <CameraStage
                      videoRef={videoRef}
                      camState={camState}
                      engineState={engineState}
                      engineError={engineError}
                      hint={hint}
                      stackItems={stack}
                      picking={picking}
                      onStackNodeRef={(id, el) => {
                        if (el) stackNodesRef.current.set(id, el)
                        else stackNodesRef.current.delete(id)
                      }}
                      onNeedsYou={openPicker}
                      onPick={pickForStackItem}
                      onRetake={retakeStackItem}
                      onClosePicker={() => setPicking(null)}
                      onRetry={() => void retryCamera()}
                      onReportCamera={() => void reportCamera()}
                      flashSignal={flashSignal}
                      onBoxChange={(b) => {
                        // Recorded for the capture-flight courier's start pose
                        // ONLY, and deliberately NOT reported to the engine:
                        // under EngineState.frame's working-frame invariant the
                        // canonical frame and reticle are a pure function of the
                        // camera stream, so nothing measured from this box may
                        // reach detection.
                        cameraBoxRef.current = b
                      }}
                    />
                    <div className="flex h-[44px] shrink-0 items-center gap-[8px] overflow-x-auto border-b border-divider-subtle bg-surface-secondary px-[12px]">
                      <button
                        type="button"
                        onClick={manualCapture}
                        className="flex h-[30px] shrink-0 items-center gap-[6px] rounded-full bg-action-primary px-[14px] text-[13px] font-bold text-action-primary-text hover:bg-action-primary-hover"
                      >
                        <Icon name="plus" size={14} /> Capture
                      </button>
                      <span className="truncate text-[12px] text-text-muted">
                        {engineStatus === 'loading' && 'Loading the scanner…'}
                        {engineStatus === 'error' && (engineError ?? 'The scanner could not start.')}
                        {engineStatus === 'ready' && !engineState && 'Warming up…'}
                      </span>
                    </div>
                  </>
                ) : (
                  <div className="min-h-0 flex-1 overflow-y-auto p-[14px]">
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
            </div>

            <div
              className={
                binExpanded
                  ? 'flex min-h-0 flex-1 flex-col overflow-hidden'
                  : 'flex min-h-[140px] flex-[2] flex-col overflow-hidden border-t border-divider-subtle'
              }
            >
              <VerifyFeed
                entries={feed}
                title="Cards"
                headerExtra={
                  <button
                    type="button"
                    onClick={() => setBinExpanded((v) => !v)}
                    aria-label={binExpanded ? 'Collapse the card list' : 'Expand the card list to full screen'}
                    className="flex h-[26px] w-[26px] items-center justify-center rounded-full bg-surface-tertiary text-icon-default hover:text-icon-hover"
                  >
                    <Icon name="chevron-down" size={14} className={binExpanded ? '' : 'rotate-180'} />
                  </button>
                }
                onQuantityChange={changeQuantity}
                onVariantChange={changeVariant}
                onCorrect={(id, match) => correctEntry(id, match)}
                onRemove={removeEntry}
                onReport={reportEntry}
                onOpenDetail={openDetail}
                registerThumbNode={(id, el) => {
                  if (el) feedThumbNodesRef.current.set(id, el)
                  else feedThumbNodesRef.current.delete(id)
                }}
              />
            </div>

            <PrimaryActionBar label={`Verify (${totalQuantity})`} icon="check" count={totalQuantity} onClick={goToVerify} />
          </>
        ) : (
          <>
            <div className="flex h-[46px] shrink-0 items-center gap-[10px] border-b border-divider-subtle bg-surface-secondary px-[10px]">
              <button
                type="button"
                onClick={backToScan}
                className="flex h-[32px] items-center gap-[4px] rounded-full px-[10px] text-[13px] font-semibold text-text-body hover:bg-surface-tertiary hover:text-text-primary"
              >
                <Icon name="chevron-left" size={16} /> Scan more
              </button>
              <div className="flex-1" />
              <div className="inline-flex h-[32px] items-center rounded-full bg-surface-primary p-[3px]">
                {(['list', 'swipe'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setReviewMode(m)}
                    className={`h-[26px] rounded-full px-[12px] text-[12px] font-bold capitalize ${
                      reviewMode === m ? 'bg-surface-tertiary text-text-primary' : 'text-text-muted hover:text-text-body'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>

            {reviewMode === 'list' ? (
              <VerifyFeed
                entries={feed}
                title="Verify"
                onQuantityChange={changeQuantity}
                onVariantChange={changeVariant}
                onCorrect={(id, match) => correctEntry(id, match)}
                onRemove={removeEntry}
                onReport={reportEntry}
                onOpenDetail={openDetail}
                registerThumbNode={(id, el) => {
                  if (el) feedThumbNodesRef.current.set(id, el)
                  else feedThumbNodesRef.current.delete(id)
                }}
              />
            ) : (
              <SwipeReview
                entries={feed}
                onQuantityChange={changeQuantity}
                onVariantChange={changeVariant}
                onConfirm={confirmEntry}
                onCorrect={(id, match) => correctEntry(id, match, true)}
                onSkip={() => {}}
                onOpenDetail={openDetail}
              />
            )}

            <PrimaryActionBar label={`Add ${commitCount} card${commitCount === 1 ? '' : 's'}`} icon="plus" count={commitCount} busy={committing} onClick={handleCommit} />
          </>
        )}

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

        {/* THE UNRESOLVED-SCANS CONFIRM. Deliberately not a `window.confirm`:
            the answer "go back" has to be able to put the reader somewhere they
            can act on those captures, and the only place the needs-you
            thumbnails exist is Step 1. */}
        {commitConfirm && (
          <div className="absolute inset-x-[14px] bottom-[14px] z-[61] rounded-xl border border-warning/60 bg-surface-secondary p-[12px] shadow-elevated motion-safe:animate-[sheet-panel-in_180ms_cubic-bezier(0.22,0.61,0.36,1)_both]">
            <div className="flex items-start gap-[8px]">
              <Icon name="alert" size={16} className="mt-[2px] shrink-0 text-warning" />
              <span className="flex-1 text-[13px] font-semibold text-text-primary">{commitConfirm}</span>
            </div>
            <div className="mt-[10px] flex gap-[8px]">
              <button
                type="button"
                onClick={() => {
                  setCommitConfirm(null)
                  backToScan()
                }}
                className="h-[34px] flex-1 rounded-full border border-border-default text-[13px] font-bold text-text-body hover:bg-surface-tertiary"
              >
                Go back to them
              </button>
              <button
                type="button"
                onClick={() => void doCommit()}
                className="h-[34px] flex-1 rounded-full bg-action-primary text-[13px] font-bold text-action-primary-text hover:bg-action-primary-hover"
              >
                Commit without them
              </button>
            </div>
          </div>
        )}

        {notice && (
          <div className="absolute inset-x-[14px] bottom-[14px] z-[60] flex items-center gap-[8px] rounded-xl border border-border-default bg-surface-secondary p-[10px] text-[13px] text-text-muted shadow-elevated">
            <Icon name="alert" size={15} />
            <span className="flex-1">{notice}</span>
            <button type="button" onClick={() => setNotice(null)} className="text-text-muted hover:text-text-primary">
              <Icon name="close" size={14} />
            </button>
          </div>
        )}
      </div>

      {helpOpen && <HelpModal onClose={() => setHelpOpen(false)} />}

      {search.card && (
        <CardSheet
          cardId={search.card}
          onClose={() =>
            navigate({ search: ((prev: { card?: string }) => ({ ...prev, card: undefined })) as never, resetScroll: false })
          }
        />
      )}
    </div>
  )
}
