import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
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
import { planCommit, writeCommit, type PlannedCommit } from '../scan/ui/commit'
import { isDefiniteRefusal, newCommitAttempt } from '../lib/commitKey'
import {
  flushTickTrace,
  ocrEnabledFor,
  uploadScanFlag,
  recordCaptureEvent,
  recordIdentityEvent,
  recordLockEvent,
  recordTick,
  recordTraceEvent,
} from '../scan/ui/flags'
import {
  EMBED_NOT_ASKED,
  type EmbedEvidence,
  embedCapture,
  latchesUnavailable,
  narrowedIdentity,
  OCR_NARROW_TIMEOUT_MS,
  readCardFields,
  resolveWithOcr,
} from '../scan/ui/ocrNarrow'
import {
  identityOutcome,
  identityRecord,
  initialIdentity,
  reduceIdentity,
  resolvedIdentity,
  rowMeter,
  type IdentityEvent,
  type IdentityState,
} from '../scan/ui/identity'
import { addArrival, commitGate, feedTotals, firstUnresolvedId, resolveRow, runningOwned, unresolvedCount } from '../scan/ui/feed'
import { loadSort, saveSort, sortRows, type FeedSort } from '../scan/ui/sort'
import { createOcrStage } from '../scan/ocr/staging'
import type { OcrRead } from '../scan/ocr/pipeline'
import {
  CAPTURE_TIMEOUT_MS,
  deadlineSignal,
  IDENTIFY_TIMEOUT_MS,
  IDENTITY_BACKSTOP_MS,
  nextFrameSafe,
  SCAN_WARM_INTERVAL_MS,
  settleWithin,
  withTimeout,
} from '../scan/ui/deadline'
import { toScanBytes } from '../scan/ui/uploadNormalize'
import { canonicalSquareMap, framePointToCss, quadPose } from '../scan/ui/coords'
import { DURATION } from '../scan/ui/motion'
import type { FeedEntry, FeedVariant, StackItem } from '../scan/ui/types'
import type { Quad } from '../scan/engine/contract'
import type { CardLook } from '../scan/engine/look'
import { gateScanResponse, judgeTie, TIE_MARGIN } from '../scan/ui/tieGate'
import { createCardBackHolds, decideAutoCapture } from '../scan/ui/autoCapture'
import { createPresentation, MIN_FIRE_GAP_MS, type FireKind, type Presentation } from '../scan/ui/presentation'
import {
  captureLookDistance,
  identityKeyOf,
  normName,
  normNumber,
  resolveRepeat,
  sameCard,
  type IdentityKey,
  type RepeatResolution,
} from '../scan/ui/repeat'
import { initialStatus, nextStatus, type StatusActionId, type StatusFacts, type StatusMessage } from '../scan/ui/statusLine'
import { createLaunchQueue, deliverToRow, deliverToTray, rectIn } from '../scan/ui/handoff'
import { createFocusGate } from '../scan/ui/focusGate'
import { cardSideFraction } from '../scan/ui/sizeGate'
import { useAccess } from '../lib/access'
import { useFixedScreen } from '../lib/fixedScreen'
import { dismissRemovalUndo, removeWithUndo } from '../scan/ui/undoRemove'
import { useScannerVoice } from '../scan/voice/useScannerVoice'
import { VoiceCaption, VoiceLiveRegion, VoicePrimer, VoiceToggle, VoiceVerifyWarning, voicePrimerSeen } from '../scan/voice/VoiceControls'

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
      // The server's same-art guard (2026-10-10) is what made `matchedRaw`
      // false on this capture: within the bar, picture shared by a reprint.
      printingOpen: raw.printingOpen === true,
      // The TIE gate alone, as this column has always meant (soloMax 64 turns the
      // 2026-10-09 distance gate off), so sessions either side stay comparable;
      // the distance gate's effect is its own column.
      matchedAfterTieGate: gateScanResponse(raw, TIE_MARGIN, 64)?.matched ?? false,
      matchedAfterSoloGate: gateScanResponse(raw)?.matched ?? false,
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
  // This route IS the screen: the document behind it must not scroll, or a
  // swipe that leaves the list scrolls it invisibly and iOS keeps the next
  // touch for it (lib/fixedScreen.ts — owner session 2026-11-27).
  useFixedScreen()

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
    watch: watchSpot,
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
  /** The capture flash (CameraStage): one per capture that becomes, or may become, a row. */
  const [flash, setFlash] = useState<{ seq: number; quad: Quad | null }>({ seq: 0, quad: null })
  /** What the status pill says (statusLine.ts), and which scan its "Scanned ✓" is about. */
  const [status, setStatus] = useState<StatusMessage>(() => initialStatus(0).shown)
  const [currentEpisodeId, setCurrentEpisodeId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [committing, setCommitting] = useState(false)
  /** The unresolved-rows confirm (`feed.commitGate`), and the row "Go back to
   *  them" should scroll to. Null when there is nothing to ask. */
  const [commitConfirm, setCommitConfirm] = useState<{ prompt: string; rowId: string | null } | null>(null)
  /** Which row the list should bring into view, and a nonce so pressing "Go
   *  back to them" twice scrolls twice. */
  const [scrollTo, setScrollTo] = useState<{ id: string | null; signal: number }>({ id: null, signal: 0 })

  /**
   * WHAT ORDER THE LIST IS IN — owned here, not in `VerifyFeed`.
   *
   * 2026-09-07 ruling: "default should be first one scanned is on top, in order
   * of scan", plus a control to change it. The choice lives at this level for
   * one structural reason: the same `feed` is rendered by TWO `VerifyFeed`s
   * (Step 1's collapsed bin, Step 2's full list) and the reader crosses between
   * them constantly, so a state inside the component would let two views of one
   * list disagree about its order. The rule and the persistence are `sort.ts`;
   * `loadSort` is passed as a lazy initialiser so the localStorage read happens
   * once, on mount, rather than on every render.
   */
  const [feedSort, setFeedSort] = useState<FeedSort>(loadSort)
  const changeSort = useCallback((next: FeedSort) => {
    setFeedSort(next)
    saveSort(next)
  }, [])

  /**
   * The list AS THE READER SEES IT, and the thing every consumer below gets.
   *
   * `feed` itself stays in scan order for ever — that IS the scan order the
   * `scan` key reads, and reconstructing it from `capturedAt` would break for
   * two captures in one millisecond. Sorting is a view over it.
   */
  const view = useMemo(() => sortRows(feed, feedSort), [feed, feedSort])
  /**
   * THE SCANNING BIN IS NEWEST FIRST, whatever the Verify screen is sorted by
   * (owner session 2026-11-26: "it doesn't really keep up with the most current
   * one ... the most current one should be at the top and push the others
   * down"). The bin is two or three rows tall and was in scan order, so each
   * new scan landed below the fold of a list that never scrolled. `sort.ts`
   * itself says newest-first is the camera step's story; the 2026-09-07 "first
   * scanned on top" ruling stays the Verify screen's default, where the list is
   * read through rather than watched.
   */
  const binView = useMemo(() => sortRows(feed, { key: 'scan', dir: 'desc' }), [feed])
  /** Each row's owned count with the earlier copies of its printing in this
   *  scan counted (feed.ts runningOwned), so three copies say 0->1, 1->2, 2->3. */
  const ownedRunning = useMemo(() => runningOwned(feed), [feed])

  const feedRef = useRef<FeedEntry[]>(feed)
  useEffect(() => {
    feedRef.current = feed
  }, [feed])
  /** The sorted view, for "Go back to them" — which has to name the first
   *  unresolved row THE READER WILL SEE, not the first one in scan order. */
  const viewRef = useRef<FeedEntry[]>(view)
  useEffect(() => {
    viewRef.current = view
  }, [view])
  // NO `stackRef`. It existed for one caller — the commit gate, reading how many
  // captures were parked on the camera. Since 2026-09-06 nothing parks there and
  // the gate reads the list (`feedRef`), so a mirror of a stack that empties
  // itself has no readers left.
  /**
   * How many ROWS are waiting on the reader — not thumbnails. Since 2026-09-06
   * an unnamed capture goes down to the list like any other, so the count the
   * camera's standing hint quotes has to come from the list too, or it would
   * report zero for a screen full of unanswered rows.
   *
   * In a ref because the hint is written from the detect-tick effect and adding
   * `feed` to THAT effect's dependencies would re-run the region ageing and the
   * auto-capture branch on every feed change. The effect fires ~8x/s, so the
   * line is current.
   */
  const unresolvedRef = useRef(0)
  useEffect(() => {
    unresolvedRef.current = unresolvedCount(feed)
  }, [feed])
  /**
   * WHICH ROW THE READER HAS A PICKER OPEN ON, if any.
   *
   * The 2026-09-06 successor to `identity.ts`'s `engaged`. That field stopped a
   * late confident answer swapping the card out from under a reader who was
   * looking at the candidates; the candidates are now on a list row, which the
   * reducer no longer owns, so the same protection has to be applied where the
   * narrowing patch lands (`setFeed` below). A ref rather than state because
   * nothing renders off it — it is read once, inside an updater.
   */
  const pickerRowRef = useRef<string | null>(null)
  const notePickerOpen = useCallback((id: string, open: boolean) => {
    pickerRowRef.current = open ? id : pickerRowRef.current === id ? null : pickerRowRef.current
  }, [])

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
  //   landingRef     which captures have a flight scheduled. Exactly one per
  //                  capture. It was load-bearing until 2026-09-07, when a
  //                  settled phase could still be MOVED (a late confident answer
  //                  overtaking the 6 s deadline) and the second move scheduled
  //                  a second flight — which is a second row for one card. Every
  //                  settled phase is terminal now, so this is a belt beside the
  //                  braces: kept because "exactly one flight per capture" is a
  //                  property worth holding here rather than inferring from a
  //                  reducer one module away.
  const identitiesRef = useRef(new Map<string, IdentityState>())
  const captureDataRef = useRef(new Map<string, StackItem>())
  const arrivalsRef = useRef(new Map<string, Promise<void>>())
  const landingRef = useRef(new Set<string>())

  // ── VOICE (scan/voice/**) ─────────────────────────────────────────────────
  //
  // An opt-in capability of the scanner itself: the reader talks while scanning
  // and the list corrects itself. OFF unless the reader opted into the
  // `scanner_voice` beta (Profile → Feature preferences), because transcription
  // on a real iPhone alongside this live camera is not yet verified; and hidden
  // outright where the browser has no speech recognition (Firefox).
  //
  // "That one" means the most recent CAPTURE — `lastCaptureIdRef`, written the
  // instant the shutter fires — not the most recent row: a card is usually still
  // being identified when the reader starts talking about it, and its row id is
  // this same capture id once it lands.
  const access = useAccess()
  // The OCR lane, decided from who is signed in (see `flags.ts`). A ref as
  // well, because the capture handler below outlives the render that created it
  // and must read the current answer, not a stale closure's.
  const ocrOn = ocrEnabledFor(access.isOwner)
  const ocrOnRef = useRef(ocrOn)
  ocrOnRef.current = ocrOn
  const voiceFeature = access.features.some((f) => f.key === 'scanner_voice' && f.enabled)
  const lastCaptureIdRef = useRef<string | null>(null)
  const voice = useScannerVoice({
    enabled: voiceFeature && step === 'scan',
    feed,
    setFeed,
    lastCaptureId: () => lastCaptureIdRef.current,
    inFlight: (id) => identitiesRef.current.has(id),
    onTarget: (rowId) => setScrollTo((s) => ({ id: rowId, signal: s.signal + 1 })),
    // `loadVariants` answers from its cache, and fills only rows still waiting
    // for their printings — a row restored by Undo, here.
    onRowRestored: (row) => {
      if (row.cardId) void loadVariants(row.cardId)
    },
  })
  const [voicePrimerOpen, setVoicePrimerOpen] = useState(false)
  const requestVoice = () => {
    if (voicePrimerSeen()) voice.start()
    else setVoicePrimerOpen(true)
  }

  /** Tracks whose lock showed a card back (scan/ui/autoCapture.ts): never
   *  auto-captured until their look settles clear of the back, or they depart. */
  const cardBackRef = useRef(createCardBackHolds())
  // The focus gate (scan/ui/focusGate.ts): an auto-capture waits for a sharp tick.
  const focusGateRef = useRef(createFocusGate())

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
  // THE SECOND LATCH, and it works exactly like the one above it. `/scan/embed`
  // 404s on every deployment without `SCAN_EMBED_MATCH` — which is the default,
  // and which `pnpm dev`'s live backend may well be — so the FIRST capture of a
  // session finds out and no later one asks again. One upload to learn the
  // answer, not one per card.
  const embedUnavailableRef = useRef(false)
  useEffect(() => {
    ocrStageRef.current.update({ enabled: ocrOn, detectorReady: engineStatus === 'ready' })
  }, [engineStatus, ocrOn])

  // WARM THE IMAGE RUNG while the reader is still framing the first card.
  // Field telemetry (2026-09-07/08) put `/scan/embed` at ~1.5 s warm and 4-8 s
  // on the first captures of a session — the server loading and compiling an
  // 88 MB model on the capture being watched. One GET when the scanner opens
  // moves that cost off it, and one every few minutes keeps the instance from
  // idling back out while the scanner stays open — only while the page is
  // VISIBLE (a backgrounded tab would otherwise keep an instance alive for
  // nothing), and never again once the server says this deployment has no
  // matcher. Fire-and-forget: a failed warm-up costs nothing the cold capture
  // would not have paid anyway.
  useEffect(() => {
    let off = false
    const warm = () => {
      if (off || embedUnavailableRef.current || document.visibilityState !== 'visible') return
      void api
        .scanWarm()
        .then((r) => {
          if (r.embed === 'off') off = true
        })
        .catch(() => {})
    }
    warm()
    const timer = window.setInterval(warm, SCAN_WARM_INTERVAL_MS)
    // Coming back to the tab after a while is exactly when the instance has
    // gone cold, so a return to visible warms at once instead of waiting.
    document.addEventListener('visibilitychange', warm)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', warm)
    }
  }, [])

  /**
   * THE PRESENTATION EPISODE (scan/ui/presentation.ts) — when the scanner takes
   * a card again. A card that has stayed in view since it was taken is never
   * taken again; any break in that continuity followed by a steady card always
   * is, and whether it was the same card is asked afterwards, by identity
   * (scan/ui/repeat.ts). Until 2026-11-27 three geometric memories decided this
   * (the per-track refractory, the captured regions, the look re-arm) and their
   * "cannot tell" was shown as "Already scanned" on new cards — the owner's
   * Cheren, Lillipup and Gothorita. Lazily, exactly once: this component
   * re-renders on every detect tick.
   */
  const presentationRef = useRef<Presentation | null>(null)
  presentationRef.current ??= createPresentation()
  const presentation = presentationRef.current

  /** What each capture was, for deciding afterwards whether it was the same card as the one before. */
  interface CaptureMeta {
    kind: FireKind
    prevCaptureId: string | null
    /** Pressed from the "Scanned ✓" pill's "Scan again". */
    scanAgain: boolean
    /** A silent drift probe (presentation.ts): no flash, no tray, until identity says it is a card. */
    probe: boolean
    quad: Quad
    look: CardLook | null
  }
  const captureMetaRef = useRef(new Map<string, CaptureMeta>())
  /** Each settled capture's identity key (repeat.ts), kept for the next capture to be compared with. */
  const identityKeysRef = useRef(new Map<string, IdentityKey | null>())
  /** Resolves once a capture has settled (or failed, or been dropped): the next capture's comparison waits on it. */
  const settledRef = useRef(new Map<string, { done: Promise<void>; resolve: () => void }>())
  const settleSignal = useCallback((id: string) => {
    let s = settledRef.current.get(id)
    if (!s) {
      let resolve: () => void = () => {}
      const done = new Promise<void>((r) => (resolve = r))
      s = { done, resolve }
      settledRef.current.set(id, s)
    }
    return s
  }, [])

  /**
   * THE NAME THE PILL MAY USE, per capture — and only once it is FINAL.
   *
   * The scan-recognition lane (PR #416) found the hash can name a wrong card
   * first: a blurred Joltik hashed 5 bits from Raticate, cleared the tie gate,
   * and was on screen before the vector and the read agreed on Joltik, which
   * `narrowedIdentity` then corrected. The ROW keeps that behaviour (it is
   * that lane's call). The PILL does not repeat a provisional name: it says
   * "Scanned ✓ identifying…" until the capture's second answer has reported (or
   * none was asked for), then "Got it — {name}" with the name that stuck.
   */
  const finalNameRef = useRef(new Map<string, string | null>())
  const raceDoneRef = useRef(new Set<string>())
  const rowNameRef = useRef(new Map<string, string | null>())

  /**
   * THE STATUS LINE'S FACTS (scan/ui/statusLine.ts). The detect tick and the
   * capture pipeline write these; one 125 ms clock reads them into the arbiter,
   * which decides what the pill says. Nothing writes the pill directly any more:
   * that was the flicker (S2).
   */
  const statusFactsRef = useRef<Omit<StatusFacts, 'now' | 'watchingName' | 'unresolved'>>({
    notice: null,
    capture: null,
    landed: null,
    same: null,
    watching: false,
    aim: null,
    steady: false,
  })
  const statusSeqRef = useRef({ notice: 0, capture: 0, landed: 0, same: 0 })
  /** The last capture the reader SAW (a silent probe is not one until promoted): what "Scanned ✓" is about. */
  const visibleCaptureIdRef = useRef<string | null>(null)
  /** The row the "Same card again" pill's Undo removes. */
  const sameRowRef = useRef<string | null>(null)
  /** SAME_AFTER_BREAK 'ask': the capture held in the tray, and how to answer it. */
  const askRef = useRef<{ captureId: string; answer: (add: boolean) => void } | null>(null)
  const pushNotice = useCallback((text: string) => {
    statusFactsRef.current.notice = { seq: ++statusSeqRef.current.notice, text }
  }, [])

  const captureBusyRef = useRef(false)
  /** When the last capture started — a capture holds the busy flag for at least MIN_FIRE_GAP_MS. */
  const lastCaptureStartRef = useRef(0)
  /** Landings launch in settle order, at least 150 ms apart (handoff.ts). */
  const launchQueueRef = useRef(createLaunchQueue())
  // The tick trace posts every few seconds; what it holds when the page is
  // hidden or the scanner closes would otherwise be lost.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') flushTickTrace()
    }
    document.addEventListener('visibilitychange', onHide)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      flushTickTrace()
    }
  }, [])
  const stackNodesRef = useRef(new Map<string, HTMLDivElement>())
  const feedThumbNodesRef = useRef(new Map<string, HTMLDivElement>())
  /**
   * THE CATALOG'S ANSWER PER CARD, kept — not just the fact that it was asked.
   *
   * It was a `Set<string>` of card ids until 2026-09-07 and could not stay one.
   * That set was a "do not ask twice" guard and it worked because a card had
   * exactly one row: ask once, patch the one row, done. Every scan is its own
   * row now, so the SECOND scan of a card arrives at a guard that says "already
   * asked" and returns before patching anything — a row with `variants: []`,
   * whose printing slot is `resolved` by default (`printing.ts`) and which
   * therefore silently loses the printing selector that is the entire point of
   * the ruling. The answer is remembered instead of the question, so the fourth
   * scan of a card is filled in from memory, with no request.
   */
  const variantsCache = useRef(new Map<string, FeedVariant[]>())
  /** In-flight lookups, so N simultaneous captures of one card make one request
   *  and all N rows are filled when it lands. */
  const variantsInflight = useRef(new Map<string, Promise<void>>())
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

  /** Fill in every row of this card that has no printings yet — the rows the
   *  lookup was made for, and any row of the same card that landed while it was
   *  in flight. Rows that already have their printings are left alone, so a
   *  reader's own pick is never overwritten by a late second caller. */
  const applyVariants = useCallback((cardId: string, variants: FeedVariant[]) => {
    setFeed((prev) =>
      prev.map((e) => {
        if (e.cardId !== cardId || e.variants.length > 0) return e
        const primary = variants.find((v) => v.isPrimary) ?? variants[0]
        return { ...e, variants, variantId: e.variantId ?? primary?.variantId ?? null }
      }),
    )
  }, [])

  const loadVariants = useCallback(
    async (cardId: string) => {
      const cached = variantsCache.current.get(cardId)
      if (cached) {
        // A second scan of a card this session already looked up. It still needs
        // its OWN printings written onto its own row — see `variantsCache`.
        applyVariants(cardId, cached)
        return
      }
      const inflight = variantsInflight.current.get(cardId)
      if (inflight) {
        // `.catch` because the OWNER of this request handles its failure; a
        // second caller re-throwing it would be an unhandled rejection out of a
        // `void loadVariants(…)`.
        await inflight.catch(() => {})
        const now = variantsCache.current.get(cardId)
        if (now) applyVariants(cardId, now)
        return
      }
      const request = (async () => {
        const card = await api.card(cardId)
        variantsCache.current.set(
          cardId,
          card.variants.map((v) => ({
            variantId: v.variantId,
            displayName: v.displayName,
            isPrimary: v.isPrimary,
            kind: v.kind,
            tier: v.tier,
            // Straight off the same call — swipe-review's "resulting total"
            // reads this with no second (batch or per-entry) ownership request.
            ownedQuantity: v.quantity ?? 0,
          })),
        )
      })()
      variantsInflight.current.set(cardId, request)
      try {
        await request
        const variants = variantsCache.current.get(cardId)
        if (variants) applyVariants(cardId, variants)
      } catch {
        // Left silent, same reasoning the old rip list carried: the row still
        // commits (commit.ts falls back to the primary printing), so a failed
        // lookup costs the reader the CHOICE, not the card. Nothing is cached,
        // so the next scan of this card asks again.
      } finally {
        variantsInflight.current.delete(cardId)
      }
    },
    [applyVariants],
  )

  /** The stage's fly layer, and the coordinates every courier is placed in. */
  const flyLayer = () => flyLayerRef.current
  /** The bin's scroller (Step 1's VerifyFeed). */
  const binScroller = () => stageWrapRef.current?.querySelector<HTMLElement>('[data-verify-feed]') ?? null

  /**
   * The pill may name a capture once BOTH have happened: its row has landed,
   * and its second answer has reported (see `finalNameRef`). Then it says
   * "Got it — {name}" — if the reader is still looking at that card, and it was
   * not a flagged copy (that one has its own message, with Undo).
   */
  const flaggedRef = useRef(new Set<string>())
  const landedIdsRef = useRef(new Set<string>())
  const markFinal = useCallback((id: string) => {
    if (!landedIdsRef.current.has(id) || !raceDoneRef.current.has(id) || finalNameRef.current.has(id)) return
    const name = rowNameRef.current.get(id) ?? null
    finalNameRef.current.set(id, name)
    if (id !== visibleCaptureIdRef.current || !statusFactsRef.current.watching || flaggedRef.current.has(id)) return
    statusFactsRef.current.landed = {
      seq: ++statusSeqRef.current.landed,
      text: name ? `Got it — ${name}` : 'Needs you — it’s in the list',
    }
  }, [])

  /**
   * Writes a SETTLED capture into the feed — named or not.
   *
   * Under the 2026-09-05 ruling only the named ones reached here; the 2026-09-06
   * reversal ("if the resolution is 'needs your input' they should still go down
   * to the list") sends both, so this builds either row and hands it to
   * `feed.addArrival`, which is the one door into the list.
   *
   * Returns the id of the row the capture landed on, because the caller is about
   * to fly a thumbnail into that row's picture and cannot ask a `setFeed`
   * updater where it went. Since 2026-09-07 that is always A NEW ROW: every scan
   * is its own item, so there is no longer an existing row it could have merged
   * into and the answer is simply this capture's id.
   *
   * `repeatOf` (2026-11-27): the row this scan broke from, when identity named
   * the two the same card — the "Same as last scan" flag (repeat.ts).
   */
  const addFeedEntry = useCallback(
    (st: IdentityState, stackItem: StackItem, repeatOf: string | null = null): string => {
      const identity = st.match
      // THE CAPTURE'S OWN ID, named or not (2026-09-07). It used to be
      // `identity.cardId` for a named row, which was the dedupe key; with every
      // scan its own row a card id would collide the moment the same card was
      // scanned twice and hand React two children with one key. The capture id
      // is unique by construction and is already this row's telemetry key
      // (`FeedEntry.captureId`), so the row, its capture record and its identity
      // record are all one string.
      const rowId = stackItem.id
      const entry: FeedEntry = {
        id: rowId,
        cardId: identity?.cardId ?? null,
        matched: !!identity,
        name: identity?.name ?? 'Unidentified card',
        setName: identity?.setName ?? '',
        setId: identity?.setId ?? null,
        number: identity?.number ?? '',
        rarity: identity?.rarity ?? null,
        images: identity?.images ?? null,
        capturePreviewUrl: stackItem.previewUrl,
        captureBlob: stackItem.blob,
        captureId: stackItem.id,
        // The engine track this capture came off (telemetry only since
        // 2026-11-27: there is no per-track hold left to release).
        captureTrackId: identity ? null : stackItem.trackId,
        // The meter shows what NAMED the card (`rowMeter`): the hash's distance
        // on a hash-named row, the picture's cosine on a ladder-named one, and
        // `-1`/`0` on an unresolved row. FeedEntryCard reads the -1 and shows
        // the picture's match, provenance, or nothing instead of a hash meter.
        ...(identity ? rowMeter(identity, st.by) : { confidence: 0, distance: -1, similarity: null }),
        quantity: 1,
        variantId: null,
        variants: [],
        printingPicked: false,
        detectingPrinting: false,
        alternates: st.candidates,
        // The SHUTTER's clock, not this moment's — a capture now waits seconds
        // for its verdict, and `identityRecord`'s `msToResolve` measures from
        // the first.
        capturedAt: stackItem.capturedAt,
        verified: false,
        // THE RACE RIDES DOWN WITH AN UNRESOLVED CAPTURE and with nothing else:
        // the row needs the OCR read for its hint chip, and needs enough of the
        // machine to attribute the reader's eventual pick or discard back to
        // this capture (`recordRowOutcome`). A named row is not asking anything
        // and carries none of it.
        identity: identity ? null : st,
        repeatOf,
      }
      rowNameRef.current.set(rowId, identity?.name ?? null)
      setFeed((prev) => addArrival(prev, entry))
      if (identity) void loadVariants(identity.cardId)
      return rowId
    },
    [loadVariants],
  )

  /**
   * Take a capture off the camera. EVERY capture reaches this now — settled one
   * way or the other, it has flown to the list and the stack is done with it.
   *
   * The object URL is deliberately NOT revoked (see `objectUrlsRef`): the row it
   * landed on still shows it, and a session revokes everything once, on unmount.
   * The reducer state goes, though, and that is the point at which
   * `FeedEntry.identity` becomes the only copy — carried by the rows that still
   * have a question to ask, and by nothing else.
   */
  const dropStackItem = useCallback((id: string) => {
    identitiesRef.current.delete(id)
    captureDataRef.current.delete(id)
    arrivalsRef.current.delete(id)
    landingRef.current.delete(id)
    setStack((prev) => prev.filter((s) => s.id !== id))
  }, [])

  /**
   * THE TRAY → ROW HAND-OFF (scan/ui/handoff.ts): one capture, one image.
   *
   * The row goes in synchronously (flushSync), newest first, with its picture
   * HIDDEN; in the same frame a courier is cloned from the tray thumbnail —
   * ring, wash and tick included — and the thumbnail is hidden. The courier
   * homes on the row's picture every frame (the list may scroll, another row
   * may land above it), and on the frame it lands the picture is shown, the
   * courier removed, and the picture bumps. Then the tray item goes and the
   * thumbnails left in the tray slide up.
   *
   * No flight when the camera is hidden (the bin expanded): the row fades in on
   * its own. Under reduced motion: no travel, the thumbnail fades out and the
   * row's picture fades in.
   */
  const handOff = useCallback(
    async (item: StackItem, st: IdentityState, repeatOf: string | null) => {
      const layer = flyLayer()
      const insertRow = () =>
        flushSync(() => {
          addFeedEntry(st, item, repeatOf)
        })
      if (!layer) insertRow()
      else {
        await deliverToRow({
          id: item.id,
          layer,
          stackEl: stackNodesRef.current.get(item.id) ?? null,
          insertRow,
          // The row id IS the capture id (addFeedEntry).
          thumb: () => feedThumbNodesRef.current.get(item.id) ?? null,
          scroller: binScroller(),
        })
      }
      dropStackItem(item.id)
    },
    [addFeedEntry, dropStackItem],
  )

  /**
   * A drift probe identity named a DIFFERENT card (or could not say it was the
   * same): it was a capture after all. It flashes now and joins the tray, as
   * any capture does at its shutter (repeat.ts: "promoted").
   */
  const promoteProbe = useCallback(async (item: StackItem) => {
    const meta = captureMetaRef.current.get(item.id)
    if (meta) meta.probe = false
    setFlash((f) => ({ seq: f.seq + 1, quad: null }))
    statusFactsRef.current.capture = { seq: ++statusSeqRef.current.capture, at: performance.now() }
    visibleCaptureIdRef.current = item.id
    lastCaptureIdRef.current = item.id
    const shown = { ...item, identity: identitiesRef.current.get(item.id) ?? item.identity }
    flushSync(() => setStack((prev) => (prev.some((s) => s.id === item.id) ? prev : [shown, ...prev])))
    // The tray's own entrance for a slot (IncomingStack, 180 ms).
    await new Promise<void>((r) => window.setTimeout(r, 200))
  }, [])

  /**
   * A capture's identity has SETTLED — same card or not, then the courier to
   * the list.
   *
   * ONE FLIGHT FOR BOTH VERDICTS, which is the 2026-09-06 ruling in code: "if
   * the resolution is 'needs your input' they should still go down to the list".
   * A confident capture shows its tick, an unnamed one shows the amber mirror of
   * it, and then the identical courier takes both to the identical list.
   *
   * The order matters and is 2026-09-05's: the thumbnail states its verdict ON
   * THE CAMERA (`DURATION.confirmTick`) and only then moves down. A flight that
   * starts the instant the answer lands is a card that vanishes from under the
   * reader's eye with no statement that anything was decided.
   *
   * SAME CARD OR NOT (2026-11-27, scan/ui/repeat.ts) is asked here, by identity,
   * against the capture this one broke from — waiting for that one to settle
   * too (both are usually in the tray). A different card is a row; the same
   * card after a break is a row FLAGGED "Same as last scan" with an Undo; a
   * drift probe of the same card is the one capture ever dropped.
   */
  const landCapture = useCallback(
    async (item: StackItem) => {
      // Never fly out of a thumbnail the arrival courier has not delivered yet.
      await settleWithin(arrivalsRef.current.get(item.id) ?? Promise.resolve(), 3000)
      // THE VERDICT, READ FROM THE AUTHORITATIVE MAP rather than from the
      // `StackItem` this callback closed over — which may be a render behind.
      // Settled phases are terminal (2026-09-07), so this is the phase that was
      // there when the flight was scheduled.
      const st = identitiesRef.current.get(item.id) ?? item.identity
      const key = identityKeyOf(st)
      identityKeysRef.current.set(item.id, key)
      settleSignal(item.id).resolve()

      const meta = captureMetaRef.current.get(item.id)
      const prevId = meta && meta.kind !== 'first' ? meta.prevCaptureId : null
      let resolution: RepeatResolution = { action: 'row', promoted: false }
      let same: boolean | null = null
      if (meta && prevId) {
        await settleWithin(settleSignal(prevId).done, IDENTITY_BACKSTOP_MS)
        same = sameCard(identityKeysRef.current.get(item.id) ?? key, identityKeysRef.current.get(prevId) ?? null)
        resolution = resolveRepeat({
          kind: meta.kind,
          same,
          lookDistance: captureLookDistance(meta.look, captureMetaRef.current.get(prevId)?.look),
          scanAgain: meta.scanAgain,
        })
      }
      const outcome = {
        captureId: item.id,
        kind: meta?.kind ?? null,
        prevCaptureId: prevId,
        same,
        action: resolution.action as string,
        flagged: resolution.action === 'flagged',
        scanAgain: !!meta?.scanAgain,
        undone: false,
      }
      if (resolution.action === 'discard') {
        // The only capture ever dropped: a probe taken with NO disturbance seen,
        // named the same card, at a close look. Nobody saw it; nothing says so.
        recordTraceEvent('repeat-outcome', outcome)
        presentation.discardProbe(item.id)
        dropStackItem(item.id)
        return
      }
      if (meta?.probe) await promoteProbe(item)
      await new Promise<void>((r) => window.setTimeout(r, DURATION.confirmTick))

      let flagged = resolution.action === 'flagged'
      if (resolution.action === 'ask') {
        // SAME_AFTER_BREAK 'ask': held in the tray, nothing added until the
        // reader answers — and skipped if the next capture fires first.
        const add = await new Promise<boolean>((answer) => {
          askRef.current = { captureId: item.id, answer }
          statusFactsRef.current.same = { seq: ++statusSeqRef.current.same, ask: true }
        })
        askRef.current = null
        statusFactsRef.current.same = null
        if (!add) {
          recordTraceEvent('repeat-outcome', { ...outcome, action: 'skipped' })
          dropStackItem(item.id)
          return
        }
        flagged = true
        outcome.action = 'added'
      }
      outcome.flagged = flagged
      recordTraceEvent('repeat-outcome', outcome)
      if (flagged) flaggedRef.current.add(item.id)

      await launchQueueRef.current.wait()
      await handOff(item, st, flagged ? prevId : null)
      if (flagged) {
        sameRowRef.current = item.id
        if (resolution.action !== 'ask') statusFactsRef.current.same = { seq: ++statusSeqRef.current.same }
      }
      landedIdsRef.current.add(item.id)
      markFinal(item.id)
    },
    [dropStackItem, handOff, markFinal, presentation, promoteProbe, settleSignal],
  )

  /**
   * The one way anything reaches the identity machine.
   *
   * Reduces against `identitiesRef` (synchronous, current), mirrors the result
   * into `stack` for rendering, and turns a settled phase into the flight it
   * means. Everything else — which answer arrived, in what order — is
   * `identity.ts`'s problem, not this component's.
   */
  const dispatchIdentity = useCallback(
    (id: string, ev: IdentityEvent) => {
      const cur = identitiesRef.current.get(id)
      if (!cur) return
      const next = reduceIdentity(cur, ev)
      if (next === cur) return
      identitiesRef.current.set(id, next)
      setStack((prev) => prev.map((s) => (s.id === id ? { ...s, identity: next } : s)))

      // THE IDENTITY RECORD — the 26 device-unknown outcomes of the earlier
      // drives, written down this time. Posted on a CHANGE OF OUTCOME, not on
      // every transition: a `read` landing moves the state but not the answer,
      // and two identical records would say the machine changed its mind when it
      // did not.
      //
      // A capture emits at most two, and only the FIRST comes from here. The
      // second — `picked` or `retaken` — is the reader's, and by the time they
      // give it the capture is a row and this reducer has let go; see
      // `recordRowOutcome`.
      //
      // SINCE 2026-09-07 THE MACHINE'S HALF IS EXACTLY ONE RECORD. The outcome
      // could change under the old rules — round 10b's `r10bs59` capture 3 posted
      // `needs-you` at +91.7 s and `confident-resolve` at +92.0 s — and that pair
      // was the visible form of the defect the owner ruled against. Settled
      // phases are terminal, so the outcome cannot move again.
      //
      // `lateAnswerDropped` is the second trigger and it is the ALARM, not a
      // second outcome: it fires when an answer arrived after the fuse had
      // already settled the capture, which is the one thing this design claims
      // cannot otherwise happen. Without it the drop would be invisible for the
      // same reason round 10b's timed-out embeds were (§2, unknown 49) — the
      // outcome does not change, so nothing re-posts.
      //
      // It is an UNDER-count and deliberately not more than that: the capture is
      // dropped from `identitiesRef` once its flight lands (~560-640 ms, round
      // 10b §5), and a dispatch after that finds nothing to reduce. So this
      // catches an answer that arrives in the beat after the fuse blew and not
      // one that arrives a second later. `backstopped` is the column that counts
      // the faults; this one only says whether the fuse also threw away an
      // answer, and buying the rest would mean keeping every capture's state
      // alive after it has left the camera to record a thing that should never
      // happen.
      if (
        identityOutcome(next) !== identityOutcome(cur) ||
        (next.lateAnswerDropped && !cur.lateAnswerDropped)
      ) {
        const item = captureDataRef.current.get(id)
        const record = item ? identityRecord(next, Date.now() - item.capturedAt) : null
        if (item && record) {
          void recordIdentityEvent({ rectified: item.blob, captureId: id, detail: record })
        }
      }

      if (next.phase === 'discarded') {
        // Nothing for a later capture to be compared with.
        identityKeysRef.current.set(id, null)
        settleSignal(id).resolve()
        dropStackItem(id)
        return
      }
      // BOTH SETTLEMENTS FLY, which is the 2026-09-06 reversal. `pending` is the
      // only phase that stays, and it is the only one that has nothing to say
      // yet.
      //
      // ONCE PER CAPTURE, and `landingRef` is what makes that true rather than
      // the phase comparison this used to do. It was written for two orderings
      // that could move a capture already on its way down — a late confident
      // answer overtaking a deadline-driven needs-you, and an OCR read landing
      // on a settled state — either of which scheduled a second flight, which is
      // a second row for one card.
      //
      // The 2026-09-07 ruling removed the first ordering at the source: a
      // capture reaches a settled phase once and stays there, so there is no
      // second transition to schedule anything. The guard stays anyway, because
      // "one flight per capture" is cheaper to hold here than to re-derive from
      // the reducer's terminality every time either file changes.
      if ((next.phase === 'confident' || next.phase === 'needs-you') && !landingRef.current.has(id)) {
        const item = captureDataRef.current.get(id)
        if (item) {
          landingRef.current.add(id)
          void landCapture(item)
        }
      }
      // No pill text is set here: the status line (statusLine.ts) reads its
      // facts on its own clock, and "Got it — {name}" waits for the capture's
      // name to be final (`markFinal`).
    },
    [dropStackItem, landCapture, settleSignal],
  )

  // ── the needs-input row's affordances, one screen down from where they were ──
  //
  // Until 2026-09-06 these hung off a needs-you THUMBNAIL and went through
  // `dispatchIdentity`, because the capture was still the reducer's. It is a row
  // now and the reducer has finished with it, so the row's own state is what the
  // reader's answer is reduced against — not to drive anything, but so the
  // answer is still ATTRIBUTED to the capture that asked the question.

  /**
   * Post the reader's half of this capture's identity record.
   *
   * The pair is the interesting record: "the machine said needs-you and the
   * reader picked the phash top hit anyway" is a different finding from either
   * half alone (`flags.ts`). Losing it was the cost of moving the picker into
   * the list, and carrying `FeedEntry.identity` down with the capture is what
   * buys it back — the row has the state, the blob and the capture id, so
   * nothing has to be kept alive on the side.
   */
  const recordRowOutcome = useCallback((entry: FeedEntry, ev: IdentityEvent) => {
    if (!entry.identity || !entry.captureId) return
    const record = identityRecord(reduceIdentity(entry.identity, ev), Date.now() - entry.capturedAt)
    if (record) {
      void recordIdentityEvent({ rectified: entry.captureBlob, captureId: entry.captureId, detail: record })
    }
  }, [])

  /** The full capture → stack → identify → feed pipeline for one engine capture. */
  const handleCaptured = useCallback(
    async (result: CaptureResult, trigger: 'auto' | 'manual', captureId: string) => {
      const previewUrl = trackUrl(URL.createObjectURL(result.blob))
      // Minted BEFORE the shutter (by the caller, so the presentation episode
      // and both halves of this capture's telemetry carry it: the
      // `capture-event` posted below, and the `identity-event` posted minutes
      // later when the reader finally decides what the card was). Without a
      // shared key the second is unattributable — which is the shape round 7's
      // 26 unknown outcomes already had.
      const meta = captureMetaRef.current.get(captureId)
      // The look the drift discard compares (repeat.ts): the captured pixels'.
      if (meta) meta.look = result.look
      const probe = !!meta?.probe
      if (!probe) lastCaptureIdRef.current = captureId
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
          // Why the presentation machine fired (scan/ui/presentation.ts):
          // first, disturbed (a card after a break), drift (a silent probe), or
          // manual — and the capture it broke from, for the same-card check.
          kind: meta?.kind ?? null,
          prevCaptureId: meta?.prevCaptureId ?? null,
          probe,
          scanAgain: !!meta?.scanAgain,
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
          // The lock's focus measure on the tick before the capture
          // (scan/ui/focusGate.ts), so a blurred capture can be told from a
          // sharp one without looking at it.
          sharpness:
            engineStateRef.current?.sharpness == null ? null : Math.round(engineStateRef.current.sharpness),
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
      // Into the tray HIDDEN, in this very frame, with the courier that carries
      // its picture there made in the same task below (handoff.ts). A silent
      // drift probe is not shown at all until identity promotes it.
      if (!probe) flushSync(() => setStack((prev) => [{ ...stackItem, arriving: true }, ...prev]))

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
      const ocrReadPromise: Promise<OcrRead | null> = ocrOnRef.current
        ? withTimeout(readCardFields(result.blob), OCR_NARROW_TIMEOUT_MS, 'ocr').catch(() => null)
        : Promise.resolve(null)

      // ── AND THE IMAGE RUNG, BESIDE IT, ON THE SAME TERMS ──────────────────
      //
      // Started at the same instant and awaited in the same place: nothing on
      // the capture path touches this promise either. It is the OCR read's
      // opposite in cost — the model runs on the SERVER (2026-09-05 ruling), so
      // the phone pays an upload and no download at all, which is why it is not
      // behind `ocrEnabledFor` (scan/ui/flags.ts). That flag guards 15.6 MB of ONNX weights and a
      // second WASM session on a runtime with live iOS crash reports; none of
      // that applies here, and tying the two would switch the vector off in
      // production, which is the deployment it was built for.
      //
      // What DOES guard it is the deployment's own answer: no matcher, a 404,
      // the latch above, and every capture after the first behaves exactly as it
      // did before this existed.
      //
      // `embedCapture` never throws and holds its own 8 s budget
      // (`vectorEvidence.ts`), so there is no `.catch` and no `withTimeout`
      // wrapper here — both would be a second copy of a guarantee the function
      // already makes.
      const embedPromise: Promise<EmbedEvidence> = embedUnavailableRef.current
        ? Promise.resolve(EMBED_NOT_ASKED)
        : embedCapture(result.blob)

      // ── THE RACE, AND IT IS DETACHED FROM THE CAPTURE PATH ────────────────
      //
      // This is the structural half of the 2026-09-05 ruling. It used to be
      // straight-line code below the arrival flight: await identify, write the
      // row, fly to the list — all inside `handleCaptured`, which `runCapture`
      // awaits while holding `captureBusyRef`. Waiting for a CONFIDENT answer in
      // that position would have held the busy flag for up to
      // IDENTITY_BACKSTOP_MS and auto-capture with it, which is precisely the
      // thing the ruling forbids: "never blocks scanning".
      //
      // So the capture path now ends at the arrival flight, and everything that
      // decides what the thumbnail becomes runs out here, dispatching into the
      // machine. The reader may take the next card the moment the first one has
      // landed on the stack. That detachment is what makes the 2026-09-07 ruling
      // affordable: a capture may now wait as long as its own signals need,
      // because the only thing waiting with it is its own thumbnail.
      //
      // ── THE ONE CLOCK LEFT, AND IT IS A FUSE ──────────────────────────────
      //
      // This used to be `IDENTITY_DEADLINE_MS`, 6 s, and it DECIDED things: it
      // flipped a still-waiting capture to needs-you and let a later answer
      // promote it back. Round 10b measured six of thirty-one captures taking
      // that path with their embed still in flight, and the owner ruled against
      // the result ("it should NOT land as needs you and then upgrade itself").
      //
      // What is left fires at IDENTITY_BACKSTOP_MS (12 s = the embed's own 8 s
      // budget plus a 4 s resolve tail; the arithmetic is in `deadline.ts`) and
      // means only "a request has outlived the sum of its budgets". The machine
      // treats what is still out as failed and settles the capture FINALLY. In a
      // healthy session this timer is cleared in the `finally` below, unfired,
      // every single time — which is the point: a fuse that blows regularly is a
      // deadline wearing a different name.
      const backstopTimer = window.setTimeout(
        () => dispatchIdentity(stackItem.id, { type: 'backstop' }),
        IDENTITY_BACKSTOP_MS,
      )
      void (async () => {
        let res: ScanResponse | null = null
        // Hoisted so the `catch` below can still report what the image rung did.
        // A capture that failed somewhere in this block is exactly the capture
        // whose telemetry wants to say whether the vector was part of the story.
        let embed: EmbedEvidence | undefined
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
          // the paths where no call is made at all — the endpoint already known
          // missing, or NEITHER rung producing anything to ask about.
          // `resolved: null` is how the machine hears "no second answer is
          // coming", and without it a thumbnail that could flip to needs-you
          // immediately would instead sit spinning until the deadline for an
          // answer that was never in flight.
          //
          // The `if (!read)` that used to stand here is gone, not weakened:
          // "nothing to ask about" is now one decision in one place
          // (`toResolveBody`), because a silent read and an absent vector are
          // two conditions and only their conjunction means no request.
          //
          // THE VECTOR, COLLECTED HERE AND WAITED FOR ONLY IN WHAT IS LEFT OF
          // ITS OWN BUDGET. It has been running since the shutter, alongside the
          // read that just landed, so in the warm case (733-824 ms, round 10)
          // this await is already settled and costs nothing. In the cold case
          // (4.6-7.6 s) it is the remainder of eight seconds and then the
          // evidence is DROPPED — `resolveWithOcr`'s header says why there is no
          // second attempt.
          embed = await embedPromise
          // Only a 404 latches — `latchesUnavailable` holds the reason, which is
          // that a slow request and an absent endpoint are not the same fact.
          if (latchesUnavailable(embed.outcome)) embedUnavailableRef.current = true

          if (ocrUnavailableRef.current) {
            dispatchIdentity(stackItem.id, { type: 'resolve', resolved: null, embed })
            return
          }
          const { signal, done } = deadlineSignal(OCR_NARROW_TIMEOUT_MS)
          let outcome
          try {
            // `read` may be NULL here now, and that is the image rung's whole
            // point: a crop OCR could not read is the crop the vector answers.
            // `toResolveBody` is the one place that decides whether the pair is
            // worth a round trip, and with no vector it decides exactly what
            // this line used to decide on its own.
            outcome = await resolveWithOcr(read, res?.matches ?? [], embed.vectorMatches, signal)
          } finally {
            done()
          }
          // One 404 is enough. The endpoint either exists on this backend or it
          // does not, and asking again every capture would spend a round trip
          // per card to learn the same thing.
          if (outcome.unavailable) ocrUnavailableRef.current = true
          dispatchIdentity(stackItem.id, { type: 'resolve', resolved: outcome.resolved, embed })

          // AND THE OLD JOB, UNCHANGED: a row that already landed on PHASH's
          // answer can still be corrected by this. The race consumed the same
          // verdict a moment ago, but only to name a capture that had NOT been
          // named; where phash got there first the row exists, the reader may
          // have touched it, and `narrowedIdentity` is the policy that decides
          // whether a badge read gets to overrule any of that.
          setFeed((prev) => {
            // THE SETTLED-NEEDS-YOU GUARD (round 10c §4). If the machine
            // settled this capture needs-you, the backstop fired and this
            // answer was DROPPED — the amber row is final, and this patch
            // does not get to be the second path that upgrades it anyway
            // (replaced-not-mutated is still a self-change, and telemetry
            // would say lateAnswerDropped while the screen applied it). The
            // patch's one job stays: correcting a row that landed on
            // phash's answer — a capture whose race settled CONFIDENT.
            const settled = identitiesRef.current.get(stackItem.id)
            if (settled?.phase === 'needs-you') return prev
            const row = prev.find((e) => e.capturePreviewUrl === previewUrl)
            if (!row) return prev
            // THE PICKER-OPEN GUARD — `identity.ts`'s `engaged`, one screen
            // down. The reader is looking at this row's candidates right now,
            // and a round trip that finally came back does not get to change
            // the card under their finger. Same principle `narrowedIdentity`
            // already enforces with `verified`.
            if (pickerRowRef.current === row.id) return prev
            const identity = narrowedIdentity(row, outcome.resolved)
            if (!identity) return prev
            // THROUGH `resolveRow`, NOT AN IN-PLACE PATCH. Round 9 forced the
            // difference: hold this round trip 8 s while the same card is
            // captured twice more, and an in-place rename leaves three rows of
            // one card where the fast path merges them. resolveRow is the one
            // rule for "this row is now that card" — name or merge, same as a
            // pick and same as an arrival.
            const top = resolvedIdentity(outcome.resolved)
            if (!top) return prev
            // The ladder named it, so its meter is the ladder's (`rowMeter`).
            const next = resolveRow(prev, row.id, { ...top, ...rowMeter({ ...top, similarity: top.similarity ?? null }, 'printing') })
            // The name that stuck, for the pill (`finalNameRef`), and the key a
            // later capture is compared with. A "Same as last scan" flag set on
            // the hash's name is re-asked on this one: a corrected row that is
            // no longer the card before loses its flag (repeat.ts).
            rowNameRef.current.set(row.id, top.name)
            const key: IdentityKey = { cardId: top.cardId, name: normName(top.name), number: normNumber(top.number) }
            identityKeysRef.current.set(row.id, key)
            if (!row.repeatOf) return next
            const still = sameCard(key, identityKeysRef.current.get(row.repeatOf) ?? null)
            if (still !== false) return next
            flaggedRef.current.delete(row.id)
            return next.map((e) => (e.id === row.id ? { ...e, repeatOf: null } : e))
          })
        } catch {
          // An enrichment that can break a capture is worse than no enrichment —
          // the same rule the capture recorder is written under. But the machine
          // must still be told, or the pair never completes.
          //
          // TWO EVENTS, AND THE SECOND IS THE IMPORTANT ONE NOW. The `resolve`
          // carries the embed telemetry and closes the second-answer leg; the
          // `backstop` closes WHATEVER ELSE this throw skipped past. Before
          // 2026-09-07 a phash that never dispatched was survivable — the 6 s
          // deadline settled the capture regardless — and the `finally` below
          // cancels the real fuse, so without this line a throw above the phash
          // dispatch would leave a thumbnail spinning on the camera with no
          // clock left to end it. The reducer makes it a no-op whenever the
          // capture has already settled honestly.
          dispatchIdentity(stackItem.id, { type: 'resolve', resolved: null, embed })
          dispatchIdentity(stackItem.id, { type: 'backstop' })
        } finally {
          window.clearTimeout(backstopTimer)
          // The second answer has reported (or none was asked for): the name
          // the pill may now use, once the row has landed and any late
          // correction above has been applied.
          void nextFrame().then(() => {
            raceDoneRef.current.add(stackItem.id)
            markFinal(stackItem.id)
          })
        }
      })()

      // THE CAPTURE → TRAY COURIER (handoff.ts): the slot went in hidden, above;
      // the courier is made in the same task, at the captured quad's pose, and
      // homes on the slot (which may slide as other captures arrive). On the
      // frame it lands the slot is shown and the courier removed. No separate
      // bump: the landing IS the beat.
      const stackEl = probe ? null : stackNodesRef.current.get(stackItem.id)
      const layer = flyLayerRef.current
      const camBox = stageWrapRef.current?.querySelector<HTMLElement>('[data-scan-camera-view]') ?? null
      if (stackEl && layer && camBox && camBox.getBoundingClientRect().width > 0) {
        const box = cameraBoxRef.current
        const frame = frameSizeRef.current
        const stream = streamSizeRef.current
        // Start pose from the captured quad's frame-space pose, mapped through
        // THE SAME `canonicalSquareMap` the reticle/quad overlay uses (they once
        // diverged — contain vs cover — and every thumbnail launched ~54 px off
        // the quad that had just been highlighted), then into the fly layer's
        // coordinates from the camera box's own place on the stage. Falls back
        // to a plausible centre-of-frame card if nothing is measured yet.
        let pose = { cx: box.width / 2, cy: box.height * 0.42, rotDeg: 0, width: 130, height: (130 * 88) / 63 }
        if (box.width && box.height && frame.width && frame.height) {
          const map = canonicalSquareMap(box.width, box.height, stream.width, stream.height, frame.width)
          const q = quadPose(result.quad)
          const [cx, cy] = framePointToCss(map, q.cx, q.cy)
          pose = { cx, cy, rotDeg: q.rotDeg, width: q.width * map.scale, height: q.height * map.scale }
        }
        const origin = rectIn(camBox, layer)
        // Never allowed to block: it carries its own deadline (rAF is
        // suspended while the document is hidden).
        await deliverToTray({
          id: stackItem.id,
          previewUrl,
          layer,
          from: { left: origin.left + pose.cx - pose.width / 2, top: origin.top + pose.cy - pose.height / 2, width: pose.width, height: pose.height },
          fromRotDeg: pose.rotDeg,
          slot: () => stackNodesRef.current.get(stackItem.id) ?? null,
        })
      }
      if (!probe) setStack((prev) => prev.map((s) => (s.id === stackItem.id ? { ...s, arriving: false } : s)))
      // THE CAPTURE PATH ENDS HERE. The thumbnail is on the stack, the race is
      // running behind it, and `runCapture`'s `finally` is about to release
      // `captureBusyRef` — the next card can be scanned now. Whether this one
      // ever reaches the list is `dispatchIdentity`'s business, not this
      // function's, and no longer anything the reader has to wait through.
      markArrived()
    },
    [dispatchIdentity, markFinal, trackUrl, step],
  )

  /** What a capture is, from the moment its shutter fires (the presentation episode's side of it). */
  interface CaptureStart {
    captureId: string
    kind: FireKind
    prevCaptureId: string | null
    probe: boolean
    scanAgain: boolean
    quad: Quad
    look: CardLook | null
  }

  const runCapture = useCallback(
    async (trackId: number, trigger: 'auto' | 'manual', start: CaptureStart) => {
      captureBusyRef.current = true
      lastCaptureStartRef.current = performance.now()
      captureMetaRef.current.set(start.captureId, {
        kind: start.kind,
        prevCaptureId: start.prevCaptureId,
        scanAgain: start.scanAgain,
        probe: start.probe,
        quad: start.quad,
        look: start.look,
      })
      settleSignal(start.captureId)
      if (!start.probe) {
        // THE FLASH AND "Captured ✓", AT THE SHUTTER — not when the capture
        // resolves (S1: "there's no question that it captured just now").
        setFlash((f) => ({ seq: f.seq + 1, quad: start.quad }))
        statusFactsRef.current.capture = { seq: ++statusSeqRef.current.capture, at: performance.now() }
        visibleCaptureIdRef.current = start.captureId
        // SAME_AFTER_BREAK 'ask': a question still open when the next card is
        // taken is answered "skip".
        askRef.current?.answer(false)
      }
      try {
        // ONE BACKSTOP OVER THE WHOLE PIPELINE. Every await inside now has its
        // own deadline, but this is the guarantee that does not depend on
        // having found them all: whatever happens in there, this call settles,
        // and the `finally` below runs. `captureBusyRef` staying true is the
        // difference between one lost capture and a scanner that is dead until
        // the page is reloaded.
        const result = await withTimeout(capture(trackId), CAPTURE_TIMEOUT_MS, 'capture')
        await withTimeout(handleCaptured(result, trigger, start.captureId), CAPTURE_TIMEOUT_MS, 'capture')
      } catch (e) {
        // The track vanished, the engine refused, or something ran past its
        // deadline — put the presentation machine back as it was, so the SAME
        // presentation retries rather than being taken as watched.
        presentation.failed(start.captureId)
        settleSignal(start.captureId).resolve()
        setNotice(e instanceof Error ? e.message : 'that capture did not go through')
        pushNotice('That capture didn’t go through — try again')
      } finally {
        // A capture holds the busy flag for at least the photosensitivity gap
        // (presentation.ts MIN_FIRE_GAP_MS): a manual press straight after an
        // automatic capture cannot flash twice inside it.
        const left = MIN_FIRE_GAP_MS - (performance.now() - lastCaptureStartRef.current)
        if (left > 0) await new Promise<void>((r) => window.setTimeout(r, left))
        captureBusyRef.current = false
      }
    },
    [capture, handleCaptured, presentation, pushNotice, settleSignal],
  )

  // Leaving Step 1 forgets the episode and the last capture; expanding the bin
  // suspends the episode (the camera is hidden, so continuity is unknown).
  useEffect(() => {
    if (step !== 'scan') {
      presentation.reset({ forget: true })
      watchSpot(null)
    } else if (binExpanded) {
      presentation.reset()
      watchSpot(null)
    }
    statusFactsRef.current.watching = false
  }, [step, binExpanded, presentation, watchSpot])

  // ── AUTO-CAPTURE: the presentation episode (scan/ui/presentation.ts) ──
  //
  // A card held still is never taken again. Any break in its continuity — a
  // hand over it, the card leaving, the look moving off it — followed by a
  // steady card always is, and identity decides afterwards whether it was the
  // same card (landCapture). Only runs in Step 1.
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
    cardBackRef.current.prune(presentIds)
    focusGateRef.current.prune(presentIds)
    const locked = engineState.locked
    const now = performance.now()
    // THE DECISION (scan/ui/autoCapture.ts — the offline replay runs the same
    // function): the presentation machine says whether this lock MAY fire, and
    // the gates — busy, a card back, too far to read (sizeGate.ts), not sharp
    // yet (focusGate.ts) — whether it does now. Every tick, lock or not: the
    // machine classes every tick of the episode it is watching.
    const verdict = decideAutoCapture(locked, engineState.look, {
      presentation,
      spotLook: engineState.spotLook,
      now,
      busy: captureBusyRef.current,
      cardBacks: cardBackRef.current,
      focus: { gate: focusGateRef.current, sharpness: engineState.sharpness, now },
      size: { frameSide: engineState.frame.width },
    })
    const p = verdict.presentation
    // EVERY TICK into the trace (flags.ts recordTick, v2): the per-tick state
    // the 2 s lock recorder cannot show — what the tracker and the look did
    // while one card was slid off a stack and the next showed.
    recordTick({
      locked: locked?.id ?? null,
      tracks: engineState.stable,
      frameSide: engineState.frame.width,
      verdict: `${verdict.fire ? 'F' : ''}${verdict.cardBack ? 'B' : ''}${verdict.tooFar ? 'T' : ''}${verdict.focusWait ? 'W' : ''}${captureBusyRef.current ? 'Y' : ''}`,
      state: p.state,
      d: p.d,
      cls: p.cls,
      fromSpot: p.fromSpot,
      episode: p.episode,
      breakKind: p.breakKind,
      steadyDistance: p.sd,
      hasObj: engineState.hasObj,
      sharpness: engineState.sharpness,
    })
    if (locked) {
      // Every lock, not just the ones that become captures — a lock the
      // episode holds is still the engine saying "I would fire at this", and
      // those are exactly the ones no capture record would show. Throttled to
      // 1 per 2s inside the recorder.
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
        // The machine would fire this lock now, gates aside, and nothing is busy.
        wouldCapture: verdict.kind !== null && !captureBusyRef.current && !verdict.cardBack,
        // THE PRESENTATION EPISODE (2026-11-27), replacing the region fields:
        // the machine's state, the look distance it classed this tick by, and
        // the kind it would fire.
        presentation: p.state,
        episode: p.episode,
        lookDistance: p.d === null ? null : round3(p.d),
        fireKind: verdict.kind,
        // The clutter gate's own input, for the track this lock is about. See
        // EngineState.saturation: 0.13 has never been shown a low-saturation
        // card, and this is how a real device tells us where real cards sit.
        // Rounded — three decimals is far finer than the gate's own margins
        // (0.018 above the mail, 0.019 below the least colourful card) and
        // keeps the payload a handful of bytes.
        saturation: round3(engineState.saturation),
        // Whether the card-back gate (engine/cardBack.ts) refused this lock —
        // the field count of what it catches, and of any card it should not.
        cardBack: verdict.cardBack,
        // Whether this tick let go of the track's card-back hold (its look
        // settled clear of the back). One tick per release, so throttled too.
        backReleased: verdict.backReleased,
        // The focus gate's input and verdict (focusGate.ts): how sharp the lock
        // was, and whether it held the capture for it. The floor was set from
        // one session; this is how the next ones re-measure it.
        sharpness: engineState.sharpness == null ? null : Math.round(engineState.sharpness),
        focusWait: verdict.focusWait,
        // The size gate's input and verdict (sizeGate.ts): the card's long side
        // as a fraction of the frame, and whether it held the capture for it.
        // The floor was set from a simulated sweep; this is the field's answer.
        cardSide: round3(cardSideFraction(locked.quad, engineState.frame.width)),
        tooFar: verdict.tooFar,
      })
    }
    if (locked && verdict.fire && verdict.kind) {
      const captureId = makeId('cap')
      const rec = presentation.fire({ kind: verdict.kind, now, captureId, trackId: locked.id, quad: locked.quad, look: engineState.look })
      recordTraceEvent('episode-fire', { ...rec })
      void runCapture(locked.id, 'auto', {
        captureId,
        kind: verdict.kind,
        prevCaptureId: rec.prevCaptureId,
        // A drift (the look moved off the card with nothing seen to cover it)
        // fires a SILENT probe: no flash, no tray, until identity says it is a
        // different card (repeat.ts).
        probe: verdict.kind === 'drift',
        scanAgain: false,
        quad: locked.quad,
        look: engineState.look,
      })
    }
    // The spot the engine reports the look of next tick: where the episode's
    // card lies (EngineState.spotLook).
    watchSpot(presentation.watchQuad())
    // THE STATUS LINE'S FACTS from this tick (its own clock reads them).
    const f = statusFactsRef.current
    f.watching = presentation.current()?.state === 'watching'
    f.aim = !locked ? null : verdict.cardBack ? 'back' : verdict.tooFar ? 'closer' : verdict.focusWait ? 'focus' : null
    f.steady = !!locked || engineState.stable.length > 0
  }, [engineState, step, runCapture, binExpanded, presentation, watchSpot])

  // THE STATUS LINE'S CLOCK (scan/ui/statusLine.ts): one decision every 125 ms
  // from the facts above, with memory — enter delays, dwells, exit holds — so
  // the pill says one thing long enough to be read.
  useEffect(() => {
    if (step !== 'scan') return
    let line = initialStatus(performance.now())
    const timer = window.setInterval(() => {
      const visible = visibleCaptureIdRef.current
      line = nextStatus(line, {
        ...statusFactsRef.current,
        now: performance.now(),
        watchingName: visible ? (finalNameRef.current.get(visible) ?? null) : null,
        unresolved: unresolvedRef.current,
      })
      const shown = line.shown
      setStatus((prev) => (prev === shown ? prev : shown))
      setCurrentEpisodeId(shown.key === 'scanned' ? visible : null)
    }, 125)
    return () => window.clearInterval(timer)
  }, [step])

  const manualCapture = useCallback(
    (scanAgain = false) => {
      if (!engineState || captureBusyRef.current) {
        setNotice('The scanner is not ready yet.')
        return
      }
      const candidate = engineState.locked ?? engineState.stable.find((q) => !q.coasting) ?? engineState.stable[0]
      if (!candidate) {
        setNotice('No card in view yet — line one up in the frame.')
        return
      }
      // A manual capture fires in any state but busy, and opens an episode like
      // any other: a card held still after it is not taken again.
      const captureId = makeId('cap')
      const look = engineState.locked?.id === candidate.id ? engineState.look : null
      const rec = presentation.fire({ kind: 'manual', now: performance.now(), captureId, trackId: candidate.id, quad: candidate.quad, look })
      recordTraceEvent('episode-fire', { ...rec, scanAgain })
      void runCapture(candidate.id, 'manual', {
        captureId,
        kind: 'manual',
        prevCaptureId: rec.prevCaptureId,
        probe: false,
        scanAgain,
        quad: candidate.quad,
        look,
      })
    },
    [engineState, presentation, runCapture],
  )

  /** The status pill's buttons. */
  const onStatusAction = useCallback(
    (a: StatusActionId) => {
      if (a === 'scan-again') manualCapture(true)
      else if (a === 'add-copy') askRef.current?.answer(true)
      else if (a === 'skip') askRef.current?.answer(false)
      else if (a === 'undo') {
        // UNDO "Same card again": the flagged row goes, through the scanner's
        // one door for a remove (undoRemove.ts, #417) — so the toast names
        // what went ("Removed Herdier") and itself offers it back. The label
        // that calibrates the rule: a flagged copy undone was a false break.
        const rowId = sameRowRef.current
        if (!rowId) return
        sameRowRef.current = null
        const row = feedRef.current.find((e) => e.id === rowId)
        removeWithUndo(feedRef.current, rowId, setFeed, {
          onRestored: () => recordTraceEvent('repeat-outcome', { captureId: rowId, undone: false, restored: true }),
        })
        recordTraceEvent('repeat-outcome', { captureId: rowId, undone: true, flagged: true, same: true })
        // The card in view is the scan it was flagged against; the pill's
        // "Same card again" has nothing left to say.
        if (row?.repeatOf && visibleCaptureIdRef.current === rowId) visibleCaptureIdRef.current = row.repeatOf
        statusFactsRef.current.same = null
      }
    },
    [manualCapture],
  )

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

  /**
   * A row leaves the list by the reader's hand — and can come back.
   *
   * Owner session 2026-11-27: a tap meant for one row removed another, silently,
   * and the card had to be found and scanned again. Every remove now names what
   * it took and offers Undo (scan/ui/undoRemove.ts, the app's own toast), which
   * puts the row back in its place in scan order exactly as it was.
   */
  const removeEntry = useCallback((id: string) => {
    removeWithUndo(feedRef.current, id, setFeed)
  }, [])

  /** The stepper. Going below one is a remove — the list's (where the button
   *  says so) and swipe review's — so it takes the same undoable path. */
  const changeQuantity = useCallback(
    (id: string, quantity: number) => {
      if (quantity <= 0) {
        removeEntry(id)
        return
      }
      setFeed((prev) => prev.map((e) => (e.id === id ? { ...e, quantity } : e)))
    },
    [removeEntry],
  )

  /** The reader naming the printing is what moves the slot out of `needs-pick`
   *  — `printingPicked`, not `variantId`, because `loadVariants` already sets a
   *  variantId (the primary) the moment the catalog answers and that is a
   *  default, not a decision. */
  const changeVariant = useCallback((id: string, variantId: number) => {
    setFeed((prev) => prev.map((e) => (e.id === id ? { ...e, variantId, printingPicked: true } : e)))
  }, [])

  /**
   * "Discard and retake" from a needs-input row's picker.
   *
   * The row goes, and — the part `removeEntry` cannot do — if the card is the
   * one the presentation episode is still watching, the episode is let go, so
   * the same card held there is taken again (as a fresh capture, not as "the
   * same as last scan": the last scan was thrown away).
   *
   * Undoable like every other remove. Undo brings the ROW back and nothing
   * else: the episode stays let go (the engine may already have captured the
   * card again), and the retake already recorded in the capture's identity
   * record stays — it is what the reader said at the time.
   */
  const discardEntry = useCallback(
    (entry: FeedEntry) => {
      recordRowOutcome(entry, { type: 'retake' })
      if (entry.captureId && presentation.current()?.captureId === entry.captureId) presentation.reset({ forget: true })
      removeWithUndo(feedRef.current, entry.id, setFeed, { verb: 'Discarded' })
    },
    [presentation, recordRowOutcome],
  )
  // An Undo for a list that has gone (the reader left /scan) must not stay up.
  useEffect(() => () => dismissRemovalUndo(), [])

  /**
   * The reader naming a row — from a needs-input row's picker, or from a matched
   * row's "wrong card?".
   *
   * The merge itself is `feed.resolveRow`, beside `feed.addArrival`, so
   * resolving a needs-input row into a card the list already holds produces
   * exactly what a confident capture of that card would have: one row, both
   * quantities, one printing to pick.
   *
   * `markVerified` is true only when the correction came out of swipe-review
   * (an explicit resolution the reader just made there) — the list view's own
   * pickers leave it false, matching `FeedEntry.verified`'s contract: "verified"
   * means confirmed BY SWIPE, not merely edited.
   */
  const correctEntry = useCallback(
    (id: string, match: ScanMatch, markVerified = false) => {
      // The reader's half of the identity record, and only for a row that was
      // still a question — a "wrong card?" on an already-named row is a
      // correction, which `narrowedIdentity`'s channel already covers.
      const before = feedRef.current.find((e) => e.id === id)
      if (before?.identity) recordRowOutcome(before, { type: 'pick', match })
      setFeed((prev) => resolveRow(prev, id, match, markVerified))
      void loadVariants(match.cardId)
    },
    [loadVariants, recordRowOutcome],
  )

  const confirmEntry = useCallback((id: string) => {
    setFeed((prev) => prev.map((e) => (e.id === id ? { ...e, verified: true } : e)))
  }, [])

  /**
   * The upload fallback — no camera, so no stack, no flight and no waiting: the
   * row lands the moment `/scan` answers.
   *
   * It reaches the list through the SAME reducer and the same `addFeedEntry`
   * anyway, driven straight to a settled state by the two events it does have.
   * That is not ceremony — it is what stops this path from re-deriving the tie
   * gate, "is the ladder sure", and the shape of an unresolved row for itself,
   * which it used to do (a local `gateScanResponse` and a second row literal)
   * and which is exactly how two paths drift apart. `resolve: null` is the
   * honest event here: there is no OCR lane behind an upload, and the reducer's
   * own contract says that is how a caller says "no second answer is coming".
   */
  const handleUploadFile = useCallback(
    async (file: File) => {
      const { bytes, type } = await toScanBytes(file)
      const res = await api.scan(bytes, type, 5, 'low')
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
      const settled = [{ type: 'phash' as const, res }, { type: 'resolve' as const, resolved: null }].reduce(
        reduceIdentity,
        initialIdentity(),
      )
      addFeedEntry(settled, stackItem)
    },
    [addFeedEntry, trackUrl],
  )

  const [celebration, setCelebration] = useState<string | null>(null)
  useEffect(() => {
    if (!celebration) return
    const t = window.setTimeout(() => setCelebration(null), 4000)
    return () => window.clearTimeout(t)
  }, [celebration])

  /**
   * A WRITE WHOSE OUTCOME IS UNKNOWN (scan/ui/commit.ts PlannedCommit): the
   * request failed without a definite answer, so it may have been applied. The
   * next press of Add re-sends exactly it, same lines and same key, which the
   * server replays rather than applies twice, whatever the list holds by then.
   * Cleared by any definite answer, so every other press of Add is a new write
   * even when the list holds exactly what an earlier one did (lib/commitKey.ts).
   */
  const pendingCommitRef = useRef<PlannedCommit | null>(null)
  const doCommit = useCallback(async (acknowledgedUnresolved = false) => {
    const gate = commitGate(feedRef.current, acknowledgedUnresolved, voice.hasVerifyWarnings())
    if (!gate.proceed) {
      setCommitConfirm(gate.prompt ? { prompt: gate.prompt, rowId: firstUnresolvedId(viewRef.current) } : null)
      return
    }
    setCommitConfirm(null)
    setCommitting(true)
    try {
      const plan = pendingCommitRef.current ?? (await planCommit(feedRef.current, newCommitAttempt()))
      pendingCommitRef.current = plan
      let result
      try {
        result = await writeCommit(plan)
      } catch (e) {
        if (isDefiniteRefusal(e)) pendingCommitRef.current = null
        throw e
      }
      pendingCommitRef.current = null
      // Only the rows this write was made of leave the list: a row added (or
      // still unresolved) since stays for the next press of Add.
      const sent = new Set(plan.rowIds)
      const remaining = feedRef.current.filter((e) => !sent.has(e.id))
      setFeed((prev) => prev.filter((e) => !sent.has(e.id)))
      // THE WHOLE CACHE, not a filtered one. `FeedVariant.ownedQuantity` is a
      // reading of the collection taken before this write, and this write just
      // changed it — swipe review quotes it as "resulting total", so a stale
      // entry would understate every printing the reader just committed. The old
      // line tried to keep the entries for rows that survived and could not even
      // do that any more: it filtered CARD ids against ROW ids, which have been
      // different things since 2026-09-07.
      variantsCache.current.clear()
      if (result.applied > 0) {
        setCelebration(
          result.unresolved.length
            ? `Added ${result.applied} card${result.applied === 1 ? '' : 's'}. ${result.unresolved.length} still need a printing picked.`
            : `Added ${result.applied} card${result.applied === 1 ? '' : 's'} to your collection.`,
        )
      }
      // Nothing left to review — head back to a fresh scan rather than
      // leaving the reader stranded on an empty Verify screen.
      if (remaining.length === 0) setStep('scan')
    } catch (e) {
      setNotice(
        pendingCommitRef.current
          ? 'Couldn’t confirm that saved. Tap Add again to retry those same cards; nothing will be added twice.'
          : e instanceof Error
            ? e.message
            : 'that did not save',
      )
    } finally {
      setCommitting(false)
    }
  }, [voice.hasVerifyWarnings])

  /**
   * Pressing Add. Between the press and the write sits `commitGate` — the
   * 2026-09-05 ruling's "batch commit reminds [about unresolved ones]".
   *
   * IT COUNTS ROWS NOW, not stack thumbnails. Under the previous ruling the
   * captures it protected were on a camera Step 2 does not render, so the drop
   * was invisible by construction; since 2026-09-06 they are rows in the list
   * the reader is looking at, and the reminder is a smaller thing — but "Add 12
   * cards" over a list of fourteen still leaves two behind without saying which,
   * so it stays. Left counting the stack it would have found an empty one every
   * time and never fired at all.
   *
   * One acknowledgement, then it proceeds — "yes, those two were card backs" is
   * a perfectly good answer.
   */
  const handleCommit = useCallback(() => {
    void doCommit(false)
  }, [doCommit])

  const openDetail = useCallback(
    (cardId: string) => {
      navigate({ search: ((prev: { card?: string }) => ({ ...prev, card: cardId })) as never, resetScroll: false })
    },
    [navigate],
  )

  const goToVerify = useCallback(() => {
    voice.settlePending()
    setReviewMode('list')
    setStep('verify')
  }, [voice])
  const backToScan = useCallback(() => {
    setCommitConfirm(null)
    setStep('scan')
    setBinExpanded(false)
  }, [])

  const totalQuantity = feedTotals(feed).cards
  const commitCount = feed.reduce((n, e) => n + (e.cardId ? e.quantity : 0), 0)
  // Only a hard 'unavailable' (no getUserMedia at all) falls back to upload.
  // 'denied' still renders CameraStage — its own overlay offers "Try camera
  // again", which is the more useful next step than jumping straight to a
  // file picker for a permission the reader might simply re-grant.
  const showCamera = supportsCamera && camState !== 'unavailable'
  const showVoice = voiceFeature && voice.supported && showCamera

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
                      status={status}
                      onStatusAction={onStatusAction}
                      currentEpisodeId={currentEpisodeId}
                      stackItems={stack}
                      onStackNodeRef={(id, el) => {
                        if (el) stackNodesRef.current.set(id, el)
                        else stackNodesRef.current.delete(id)
                      }}
                      onRetry={() => void retryCamera()}
                      onReportCamera={() => void reportCamera()}
                      flash={flash}
                      overlay={showVoice ? <VoiceCaption voice={voice} /> : null}
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
                        onClick={() => manualCapture()}
                        className="flex h-[30px] shrink-0 items-center gap-[6px] rounded-full bg-action-primary px-[14px] text-[13px] font-bold text-action-primary-text hover:bg-action-primary-hover"
                      >
                        <Icon name="plus" size={14} /> Capture
                      </button>
                      <span data-scan-engine-status={engineStatus} className="min-w-0 flex-1 truncate text-[12px] text-text-muted">
                        {engineStatus === 'loading' && 'Loading the scanner…'}
                        {engineStatus === 'error' && (engineError ?? 'The scanner could not start.')}
                        {engineStatus === 'ready' && !engineState && 'Warming up…'}
                      </span>
                      {showVoice && <VoiceToggle voice={voice} onRequestStart={requestVoice} />}
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
                entries={binView}
                sort={{ key: 'scan', dir: 'desc' }}
                followTop
                clearFab={totalQuantity === 0}
                currentEpisodeId={currentEpisodeId}
                title="Cards"
                headerExtra={
                  <>
                    {/* The capture bar hides with the camera; the microphone
                        does not stop, so its switch comes up here with the list. */}
                    {showVoice && binExpanded && <VoiceToggle voice={voice} onRequestStart={requestVoice} compact />}
                    <button
                      type="button"
                      onClick={() => setBinExpanded((v) => !v)}
                      aria-label={binExpanded ? 'Collapse the card list' : 'Expand the card list to full screen'}
                      className="flex h-[26px] w-[26px] items-center justify-center rounded-full bg-surface-tertiary text-icon-default hover:text-icon-hover"
                    >
                      <Icon name="chevron-down" size={14} className={binExpanded ? '' : 'rotate-180'} />
                    </button>
                  </>
                }
                onQuantityChange={changeQuantity}
                onVariantChange={changeVariant}
                onCorrect={(id, match) => correctEntry(id, match)}
                onRemove={removeEntry}
                onDiscard={discardEntry}
                onReport={reportEntry}
                onOpenDetail={openDetail}
                onPickerOpenChange={notePickerOpen}
                registerThumbNode={(id, el) => {
                  if (el) feedThumbNodesRef.current.set(id, el)
                  else feedThumbNodesRef.current.delete(id)
                }}
                scrollToId={scrollTo.id}
                scrollSignal={scrollTo.signal}
                voicePending={voice.pendingByRow}
                onVoiceCancel={voice.cancel}
              />
            </div>

            <PrimaryActionBar label={`Verify (${totalQuantity})`} icon="check" count={totalQuantity} onClick={goToVerify} />
            {showVoice && binExpanded && <VoiceCaption voice={voice} placement="list" />}
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
                entries={view}
                sort={feedSort}
                onSortChange={changeSort}
                // No Add bar under the list when nothing in it can commit yet.
                clearFab={commitCount === 0}
                title="Verify"
                onQuantityChange={changeQuantity}
                onVariantChange={changeVariant}
                onCorrect={(id, match) => correctEntry(id, match)}
                onRemove={removeEntry}
                onDiscard={discardEntry}
                onReport={reportEntry}
                onOpenDetail={openDetail}
                onPickerOpenChange={notePickerOpen}
                registerThumbNode={(id, el) => {
                  if (el) feedThumbNodesRef.current.set(id, el)
                  else feedThumbNodesRef.current.delete(id)
                }}
                scrollToId={scrollTo.id}
                scrollSignal={scrollTo.signal}
              />
            ) : (
              <SwipeReview
                // The reader's order, here too — swipe review works `queue[0]`
                // forward, so the order it is handed IS the order it asks about,
                // and it must be the one the list beside it is showing.
                entries={view}
                owned={ownedRunning}
                onQuantityChange={changeQuantity}
                onVariantChange={changeVariant}
                onConfirm={confirmEntry}
                onCorrect={(id, match) => correctEntry(id, match, true)}
                onSkip={() => {}}
                onOpenDetail={openDetail}
              />
            )}

            <VoiceVerifyWarning voice={voice} />
            <PrimaryActionBar label={`Add ${commitCount} card${commitCount === 1 ? '' : 's'}`} icon="plus" count={commitCount} busy={committing} disabled={voice.verifyWarnings.length > 0} onClick={handleCommit} />
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

        {/* THE UNRESOLVED-ROWS CONFIRM. Deliberately not a `window.confirm`:
            the answer "go back" has to put the reader in front of the rows it is
            about — and since 2026-09-06 that is a scroll rather than a trip back
            to Step 1, because the rows are in whatever list they are already
            looking at. Swipe review is the one place they are not, so it hands
            the reader back to the list first. */}
        {commitConfirm && (
          <div data-fab-lift className="absolute inset-x-[14px] bottom-[14px] z-[61] rounded-xl border border-warning/60 bg-surface-secondary p-[12px] shadow-elevated motion-safe:animate-[sheet-panel-in_180ms_cubic-bezier(0.22,0.61,0.36,1)_both]">
            <div className="flex items-start gap-[8px]">
              <Icon name="alert" size={16} className="mt-[2px] shrink-0 text-warning" />
              <span className="flex-1 text-[13px] font-semibold text-text-primary">{commitConfirm.prompt}</span>
            </div>
            <div className="mt-[10px] flex gap-[8px]">
              <button
                type="button"
                onClick={() => {
                  const rowId = commitConfirm.rowId
                  setCommitConfirm(null)
                  setReviewMode('list')
                  setScrollTo((s) => ({ id: rowId, signal: s.signal + 1 }))
                }}
                className="h-[34px] flex-1 rounded-full border border-border-default text-[13px] font-bold text-text-body hover:bg-surface-tertiary"
              >
                Go back to them
              </button>
              <button
                type="button"
                onClick={() => void doCommit(true)}
                className="h-[34px] flex-1 rounded-full bg-action-primary text-[13px] font-bold text-action-primary-text hover:bg-action-primary-hover"
              >
                Commit without them
              </button>
            </div>
          </div>
        )}

        {notice && (
          <div data-fab-lift className="absolute inset-x-[14px] bottom-[14px] z-[60] flex items-center gap-[8px] rounded-xl border border-border-default bg-surface-secondary p-[10px] text-[13px] text-text-muted shadow-elevated">
            <Icon name="alert" size={15} />
            <span className="flex-1">{notice}</span>
            <button type="button" onClick={() => setNotice(null)} className="text-text-muted hover:text-text-primary">
              <Icon name="close" size={14} />
            </button>
          </div>
        )}
      </div>

      {helpOpen && <HelpModal voice={showVoice} onClose={() => setHelpOpen(false)} />}

      {voicePrimerOpen && (
        <VoicePrimer
          onClose={() => setVoicePrimerOpen(false)}
          onAccept={() => {
            setVoicePrimerOpen(false)
            // Inside the tap, so the browser's own prompts see a user gesture.
            voice.start()
          }}
        />
      )}
      {showVoice && <VoiceLiveRegion text={voice.announcement} />}

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
