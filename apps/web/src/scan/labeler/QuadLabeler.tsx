// Quad labeler — owner tooling to build a human-verified corpus of correct
// quads (or explicit, reason-coded invalid verdicts — types.ts InvalidReason)
// for the shipping detector. Two entry modes
// converge on one working-frame format (workingFrame.ts), one seeding step
// (detectSeed.ts — the real detector, run once), and one editor
// (AnnotationEditor.tsx). Instrument-grade register on purpose: dark,
// utilitarian, no product chrome — this is the harness's register, not
// Scan.tsx's.
//
// ── BUILT FOR A SESSION OF HUNDREDS, ON A PHONE (2026-09-07) ────────────────
//
// The first build was correct and slow to use. Three things about it only show
// up at volume, and all three are fixed here:
//
//   THE CAMERA WAS TORN DOWN AND RE-ACQUIRED FOR EVERY SINGLE FRAME, because
//   `CaptureStage` unmounted whenever the editor opened. `getUserMedia` costs
//   the better part of a second on a phone, so a 200-frame session paid ~3
//   minutes of black screen for nothing. The stage now stays MOUNTED and live
//   behind the editor; only its visibility changes.
//
//   EVERY LABEL COST A "NEXT" TAP that had exactly one possible meaning. Saving
//   now advances by itself — straight back to the live camera, or straight on
//   to the next queued upload — and the confirmation moved up into this
//   component's own chrome so it survives that advance. Upload mode takes a
//   WHOLE FOLDER at once, so a hundred frames cost one picker interaction
//   rather than a hundred.
//
//   A FAILED POST LOST THE LABEL. It now goes to a retry queue as plain data
//   (saveLabel.ts PendingLabel — no canvas retained), flushed on reconnect, and
//   the reader carries on labelling instead of stopping to babysit a phone that
//   walked out of wifi range.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from '../../components/Icon'
import type { Quad } from '../engine/contract'
import { decodeForCanvas } from '../ui/uploadNormalize'
import { CaptureStage } from './CaptureStage'
import { CropStage } from './CropStage'
import { QueueStage } from './QueueStage'
import {
  clearQueue,
  enqueue,
  listQueue,
  queueSupported,
  queueUsage,
  removeQueued,
  type QueuedPhoto,
} from './queueDb'
import { UploadStage } from './UploadStage'
import { AnnotationEditor } from './AnnotationEditor'
import { seedQuad, warmSeed, type SeedResult } from './detectSeed'
import { pendingLabel, sendLabel, type PendingLabel } from './saveLabel'
import type { TopLeftIndex } from './orientation'
import {
  LABEL_SCHEMA_VERSION,
  REASON_BY_VALUE,
  type CardFace,
  type InvalidReason,
  type LabelSource,
  type QuadLabel,
  type SessionStats,
} from './types'
import { buildWorkingFrame, isPadded, type WorkingFrame } from './workingFrame'
import type { SquareCrop } from '../engine/frame'
import type { SweepVerdict } from './sweep'

/**
 * `queue` joined `capture`/`upload` on 2026-09-08. The other two are ways to
 * ACQUIRE photos; this one is where they wait and where they are worked. Upload
 * now feeds it rather than opening the editor directly, and capture feeds it
 * whenever Rapid is on.
 */
type EntryMode = 'capture' | 'upload' | 'queue'

/**
 * How many un-sent labels may pile up before the reader is made to stop.
 *
 * Each held label is a base64 PNG of the canonical square — call it ~250 KB —
 * so 25 is ~6 MB of retained strings, which a phone will carry without
 * complaint. Past that the honest thing is to say so rather than to keep
 * accepting work that may not survive: a queue big enough to lose is worse than
 * a queue that admits it is full.
 */
const MAX_QUEUE = 25

/** How often to retry a stuck queue. Long enough not to hammer a dead network,
 *  short enough that a walk back into wifi drains it before the reader notices.
 *  The `online` event drains it immediately and this is only the backstop for
 *  the case that event lies (it routinely does on iOS). */
const RETRY_EVERY_MS = 15_000

export function QuadLabeler() {
  const [entryMode, setEntryMode] = useState<EntryMode>('capture')
  /**
   * ── SWEEP MODE (owner request, 2026-09-08) ────────────────────────────────
   *
   * Runs the SHIPPING engine live against the preview so the reader can point
   * the phone around a room and see what the product mistakes for a card —
   * then capture exactly those frames as negatives. Without it, mining "not a
   * card" means guessing which of the things in front of the lens the detector
   * has an opinion about, and the guess is uncorrelated with the answer.
   *
   * OFF BY DEFAULT, and the default is the load-bearing part: a normal
   * labelling session works through a stack of real cards, where a continuous
   * detector opinion costs battery and inference time and tells the reader
   * nothing they cannot see. See CaptureStage's header.
   */
  /**
   * THE DECODED PHOTO WAITING FOR A CROP (owner request, 2026-09-08).
   *
   * Upload mode used to go decode -> centre square -> editor. It now stops
   * here so the reader can say WHICH square, because a photo's card is not
   * reliably in the middle of it and the centre crop silently threw the rest
   * away. Camera mode does not stop: the working-frame invariant requires the
   * live canonical frame to be a pure function of the stream.
   *
   * Held as state rather than passed straight through because the choice is a
   * user interaction with its own screen, and the source bitmap has to outlive
   * the decode that produced it.
   */
  const [pendingCrop, setPendingCrop] = useState<{
    image: CanvasImageSource
    width: number
    height: number
    /** Where the photo came from, carried WITH it — `source` state is set at
     *  the same moment and reading it back here would be a second copy that
     *  can be one render stale. */
    source: LabelSource
  } | null>(null)
  const [live, setLive] = useState(false)
  /**
   * RAPID CAPTURE. The shutter files the frame in the persistent queue and the
   * camera stays live, so a stack of cards is one continuous pass instead of
   * one shoot-then-label round trip per card. Off by default: a reader
   * labelling as they go still wants the editor, and losing that flow to a mode
   * they did not ask for would be worse than not having the mode.
   */
  const [rapid, setRapid] = useState(false)
  // ── THE PERSISTENT QUEUE (queueDb.ts) ─────────────────────────────────────
  // Mirrored into state for rendering; IndexedDB is the source of truth and is
  // re-read after every mutation rather than patched in two places.
  const [queueItems, setQueueItems] = useState<QueuedPhoto[]>([])
  const [queueUsageInfo, setQueueUsageInfo] = useState<{ bytes: number; quota: number | null } | null>(null)
  const [queueError, setQueueError] = useState<string | null>(null)
  /** The queue item currently being opened, and the one being labelled — kept
   *  so a save can retire exactly the row it came from. */
  const [openingId, setOpeningId] = useState<number | null>(null)
  const workingId = useRef<number | null>(null)
  /** The live verdict for the frame currently being edited — captured at the
   *  shutter, held across the editor, and stamped onto the row. Null for
   *  uploads and for captures taken with the sweep off. */
  const [sweep, setSweep] = useState<SweepVerdict | null>(null)
  const [editing, setEditing] = useState(false)
  const [workingFrame, setWorkingFrame] = useState<WorkingFrame | null>(null)
  // A real identity for AnnotationEditor's `key` — the canvas ELEMENT itself
  // is not a valid React key (it would stringify to the same
  // "[object HTMLCanvasElement]" for every frame, defeating the remount the
  // editor's fresh-interaction-state-per-frame design relies on).
  const frameSeq = useRef(0)
  const [frameKey, setFrameKey] = useState(0)
  const [source, setSource] = useState<LabelSource>('camera')
  const [seed, setSeed] = useState<SeedResult | null>(null)
  const [saving, setSaving] = useState(false)
  // THE DOUBLE-POST GUARD, and it is a REF rather than the `saving` state above
  // for the reason double-taps exist at all: `setSaving(true)` does not take
  // effect until React re-renders, and two taps 40 ms apart both read the old
  // `false` and both post. A ref flips synchronously inside the handler, so the
  // second tap sees the first one's write. `saving` stays for the disabled
  // styling, which is a different job.
  const inFlight = useRef(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'sent' | 'error' | 'queued'>('idle')
  const [saveMessage, setSaveMessage] = useState<string | null>(null)
  const [stats, setStats] = useState<SessionStats>({
    total: 0,
    positive: 0,
    negativeByReason: {},
    reorientedPositives: 0,
    cardBacks: 0,
  })
  const messageTimer = useRef<number | null>(null)

  // ── the retry queue ───────────────────────────────────────────────────────
  // Mirrored ref + state for the usual reason: the flush runs from timers and
  // window events whose closures must never read a stale queue, while the
  // banner is a render.
  const queueRef = useRef<PendingLabel[]>([])
  const [queueLen, setQueueLen] = useState(0)
  const flushing = useRef(false)

  // ── the upload queue ──────────────────────────────────────────────────────
  // Lives HERE, not in UploadStage, because UploadStage is unmounted for the
  // whole time the editor is open — a queue held there would be destroyed by
  // the first frame it was meant to survive.
  // (The in-memory `fileQueue` ref that used to live here is gone — the queue
  // is `queueDb.ts` now, and it survives a reload. See that file's header.)
  const [decodeError, setDecodeError] = useState<string | null>(null)
  /** True while a picked batch is being written to IndexedDB. A hundred phone
   *  photos is a real wait, and a picker that looks idle through it invites a
   *  second pick on top of the first. */
  const [adding, setAdding] = useState(false)

  const flashMessage = useCallback((status: 'sent' | 'error' | 'queued', text: string) => {
    setSaveStatus(status)
    setSaveMessage(text)
    if (messageTimer.current) window.clearTimeout(messageTimer.current)
    // An error stays put. A confirmation is a receipt for something that
    // already worked and the reader is on the next frame; a failure is the one
    // thing they must actually read.
    if (status !== 'error') {
      messageTimer.current = window.setTimeout(() => setSaveMessage(null), 3500)
    }
  }, [])

  // THE MODEL STARTS LOADING NOW, not at the first shutter. It is the only slow
  // part of a seed (round 9c measured a 9.07 s first frame, nearly all of it
  // here) and it needs no frame to begin, so it happens while the reader is
  // still pointing the camera at the first card.
  useEffect(() => {
    warmSeed()
  }, [])

  const beginEditing = useCallback((frame: WorkingFrame, from: LabelSource, verdict: SweepVerdict | null = null) => {
    setSweep(verdict)
    frameSeq.current += 1
    setFrameKey(frameSeq.current)
    setWorkingFrame(frame)
    setSource(from)
    setSeed(null)
    setEditing(true)
    void seedQuad(frame.canonical).then(setSeed)
  }, [])

  const reset = useCallback(() => {
    setEditing(false)
    setWorkingFrame(null)
    setSeed(null)
    // A half-made crop decision must not survive into the next photo — it would
    // show the previous image's square over a new one.
    setPendingCrop(null)
  }, [])

  // ── the persistent queue ──────────────────────────────────────────────────

  /** Re-read the queue from IndexedDB. Called after every mutation: the store
   *  is the source of truth and patching a mirrored array in parallel is how
   *  the two drift. */
  const refreshQueue = useCallback(async () => {
    if (!queueSupported()) return
    try {
      const [items, usage] = await Promise.all([listQueue(), queueUsage()])
      setQueueItems(items)
      setQueueUsageInfo(usage)
      setQueueError(null)
    } catch (e) {
      setQueueError(e instanceof Error ? e.message : 'the photo queue could not be read')
    }
  }, [])

  useEffect(() => {
    void refreshQueue()
  }, [refreshQueue])

  /** Add photos to the queue. One transaction for the whole batch (see
   *  queueDb.enqueue) so a mass upload either lands or does not. */
  const addToQueue = useCallback(
    async (items: Array<{ blob: Blob; name: string; source: 'camera' | 'upload' }>) => {
      if (!items.length) return
      if (!queueSupported()) {
        setQueueError('This browser has no storage for the queue — label photos one at a time instead.')
        return
      }
      setAdding(true)
      try {
        await enqueue(items)
        await refreshQueue()
      } catch (e) {
        setQueueError(e instanceof Error ? e.message : 'those photos could not be queued')
      } finally {
        setAdding(false)
      }
    },
    [refreshQueue],
  )

  const acceptFiles = useCallback(
    (files: File[]) => {
      if (!files.length) return
      // Straight to the queue, and the reader stays where they are. Uploads
      // used to open the first file's editor immediately, which was right when
      // the queue died with the tab and wrong now: a hundred-file pick is a
      // batch to work through, not a hundred-deep stack of modal state.
      void addToQueue(files.map((f) => ({ blob: f, name: f.name, source: 'upload' as const })))
      setEntryMode('queue')
    },
    [addToQueue],
  )

  /** Decode one queued photo and hand it to the CROP stage. The editor opens
   *  only once the reader has chosen a square (or skipped to the centre one). */
  const openQueued = useCallback(
    async (item: QueuedPhoto) => {
      setDecodeError(null)
      setOpeningId(item.id)
      try {
        const src = await decodeForCanvas(new File([item.blob], item.name, { type: item.blob.type }))
        workingId.current = item.id
        setPendingCrop({ image: src, width: src.width, height: src.height, source: item.source })
      } catch (e) {
        setDecodeError(e instanceof Error ? e.message : 'that image could not be read')
        setEditing(false)
      } finally {
        setOpeningId(null)
      }
    },
    [],
  )

  const discardQueued = useCallback(
    async (id: number) => {
      try {
        await removeQueued(id)
        await refreshQueue()
      } catch (e) {
        setQueueError(e instanceof Error ? e.message : 'that photo could not be discarded')
      }
    },
    [refreshQueue],
  )

  const discardAll = useCallback(async () => {
    try {
      await clearQueue()
      await refreshQueue()
    } catch (e) {
      setQueueError(e instanceof Error ? e.message : 'the queue could not be cleared')
    }
  }, [refreshQueue])

  /** The crop is settled — build the working frame and open the editor.
   *  `crop` undefined means "the centre square", i.e. Skip. */
  const acceptCrop = useCallback(
    (crop?: SquareCrop) => {
      const p = pendingCrop
      if (!p) return
      setPendingCrop(null)
      // `source` was set when the item was opened; a camera frame that went
      // through the queue is still a camera frame and its rows must say so.
      beginEditing(buildWorkingFrame(p.image, p.width, p.height, crop), p.source)
    },
    [pendingCrop, beginEditing],
  )

  /**
   * Land ready for the next frame.
   *
   * A row that came off the queue RETIRES FROM IT HERE, after the label is
   * counted — not when it was opened. Removing it on open would lose the photo
   * if the reader backed out, reloaded, or the save failed, which is precisely
   * the loss the persistent queue exists to prevent.
   */
  const advance = useCallback(() => {
    const id = workingId.current
    workingId.current = null
    if (id !== null) {
      void (async () => {
        await removeQueued(id).catch(() => {})
        const items = await listQueue().catch(() => [] as QueuedPhoto[])
        setQueueItems(items)
        void queueUsage().then(setQueueUsageInfo).catch(() => {})
        reset()
        // Straight on to the next one: the whole point of a worked queue is
        // that finishing a photo puts the following photo in front of you.
        const next = items[0]
        if (next) void openQueued(next)
        else setEntryMode('queue')
      })()
      return
    }
    reset()
  }, [reset, openQueued])

  // ── flushing the retry queue ──────────────────────────────────────────────
  const flushQueue = useCallback(async () => {
    if (flushing.current || !queueRef.current.length) return
    flushing.current = true
    try {
      // One at a time, oldest first, and STOP at the first failure — the corpus
      // is time-ordered by the id the server stamps, and a queue that skips
      // past a stuck row to send newer ones would scramble that for no gain.
      while (queueRef.current.length) {
        const head = queueRef.current[0]!
        await sendLabel(head)
        queueRef.current = queueRef.current.slice(1)
        setQueueLen(queueRef.current.length)
      }
      flashMessage('sent', 'The waiting labels went out ✓')
    } catch {
      // Still down. The timer and the `online` event will come back to it.
    } finally {
      flushing.current = false
    }
  }, [flashMessage])

  useEffect(() => {
    if (!queueLen) return
    const timer = window.setInterval(() => void flushQueue(), RETRY_EVERY_MS)
    const onOnline = () => void flushQueue()
    window.addEventListener('online', onOnline)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('online', onOnline)
    }
  }, [queueLen, flushQueue])

  // A queue held only in memory dies with the tab, and a backgrounded tab on a
  // phone is killed routinely. This cannot prevent that — it can only refuse to
  // let it happen SILENTLY, which is the difference between losing work and
  // knowing you lost it.
  useEffect(() => {
    if (!queueLen) return
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [queueLen])

  const countLabel = useCallback((label: QuadLabel) => {
    setStats((s) =>
      label.corners
        ? {
            ...s,
            total: s.total + 1,
            positive: s.positive + 1,
            reorientedPositives:
              s.reorientedPositives + (label.topLeftIndex !== label.seededTopLeftIndex ? 1 : 0),
            cardBacks: s.cardBacks + (label.face === 'back' ? 1 : 0),
          }
        : {
            ...s,
            total: s.total + 1,
            negativeByReason: {
              ...s.negativeByReason,
              [label.invalidReason]: (s.negativeByReason[label.invalidReason] ?? 0) + 1,
            },
          },
    )
  }, [])

  const labelBase = useCallback(() => {
    if (!workingFrame || !seed) return null
    return {
      // Stamped on EVERY row this build writes — the flag that lets the
      // training harvest mix these with the schema-1 rows already recorded
      // instead of choosing between them. See types.ts.
      labelSchema: LABEL_SCHEMA_VERSION,
      dims: { width: workingFrame.canonical.width, height: workingFrame.canonical.height },
      // The provenance `dims` alone cannot carry: every row's `dims` is the
      // canonical square, so without these two a harvest cannot tell a 12 MP
      // phone frame from a 640x480 webcam one, nor map a corner back to a pixel
      // in the photo the reader was actually looking at.
      stream: { width: workingFrame.sourceWidth, height: workingFrame.sourceHeight },
      crop: { x: workingFrame.crop.x, y: workingFrame.crop.y, size: workingFrame.crop.size },
      source,
      seededFrom: seed.seededFrom,
      // The seed's own pipeline block, plus the live verdict when there was one
      // and the mirrored-edge record when the crop left the photo. Spread in
      // this order deliberately: both are additive provenance and must never
      // overwrite a field the seed measured.
      pipeline: {
        ...seed.pipeline,
        ...(sweep ? { sweep } : {}),
        // Only when there IS one. An all-zero block on every unpadded row would
        // be noise in the corpus and would make "was this padded?" a numeric
        // test rather than a presence test.
        ...(isPadded(workingFrame.pad) ? { pad: { ...workingFrame.pad, mode: 'mirror' as const } } : {}),
      },
      savedAt: new Date().toISOString(),
    } satisfies Omit<QuadLabel, 'corners' | 'invalidReason'>
  }, [workingFrame, seed, source, sweep])

  const doSave = useCallback(
    async (label: QuadLabel | null) => {
      if (!label || !workingFrame) return
      if (inFlight.current) return // see the ref's declaration
      inFlight.current = true
      setSaving(true)

      const verdict = label.corners
        ? label.face === 'back'
          ? 'card BACK'
          : 'label'
        : `invalid (${REASON_BY_VALUE[label.invalidReason].label.toLowerCase()})`

      try {
        // Serialize FIRST, and only then send. If the send fails, the frozen
        // label is already in hand and can be queued — which is the whole
        // reason saveLabel.ts is two functions.
        const pending = await pendingLabel(workingFrame.canonical, label)
        try {
          await sendLabel(pending)
          countLabel(label)
          flashMessage('sent', `Saved ✓ — ${verdict} recorded`)
          advance()
        } catch (sendErr) {
          if (queueRef.current.length >= MAX_QUEUE) {
            flashMessage(
              'error',
              `Could not send, and ${MAX_QUEUE} labels are already waiting — stop and get back online before labelling more.`,
            )
            return
          }
          queueRef.current = [...queueRef.current, pending]
          setQueueLen(queueRef.current.length)
          // COUNTED AND ADVANCED ANYWAY, deliberately. The label is safe, held
          // as data, and will go out on reconnect; making the reader stop and
          // stare at a network error for every frame of a bad-signal stretch
          // would cost far more than the small risk that the tab dies with the
          // queue in it — which the beforeunload guard at least makes loud.
          countLabel(label)
          flashMessage(
            'queued',
            `Held ✓ — ${verdict} saved locally (${queueRef.current.length} waiting to send). ${
              sendErr instanceof Error ? sendErr.message : 'the network refused it'
            }`,
          )
          advance()
        }
      } catch (e) {
        // Encoding failed — there is nothing to queue and nothing was written.
        // The frame stays open so the reader can try again on it.
        flashMessage('error', e instanceof Error ? e.message : 'that frame could not be prepared')
      } finally {
        inFlight.current = false
        setSaving(false)
      }
    },
    [workingFrame, flashMessage, countLabel, advance],
  )

  const savePositive = useCallback(
    (corners: Quad, topLeftIndex: TopLeftIndex, face: CardFace) => {
      const base = labelBase()
      if (!base || !seed) return
      void doSave({ ...base, corners, topLeftIndex, seededTopLeftIndex: seed.topLeftIndex, face })
    },
    [labelBase, doSave, seed],
  )

  const saveInvalid = useCallback(
    (reason: InvalidReason) => {
      const base = labelBase()
      if (!base) return
      void doSave({ ...base, corners: null, invalidReason: reason })
    },
    [labelBase, doSave],
  )

  const negatives = (Object.keys(stats.negativeByReason) as InvalidReason[]).filter(
    (r) => (stats.negativeByReason[r] ?? 0) > 0,
  )

  return (
    <div
      className="flex flex-col overflow-hidden bg-neutral-950 text-white"
      // NOT `h-dvh`. This route renders INSIDE AppShell, which pins a 64 px
      // (78 px at >=1068) header above it and pads `.app-content` down by
      // exactly that much — so a full-viewport-height child starts below the
      // fold and ends below it too. Measured at 390x844: the Save row was
      // partly off-screen, on the one control a 200-frame session presses every
      // single frame. The shell publishes its own height as `--app-header-h`
      // (AppShell's inline <style>, defaulted in theme.css) precisely so a
      // child can subtract it, which is what this does; the safe-area term is
      // the notch, added to the same padding by `.app-content`.
      style={{ height: 'calc(100dvh - var(--app-header-h, 0px) - env(safe-area-inset-top, 0px))' }}
    >
      <div className="flex shrink-0 items-center gap-[8px] border-b border-white/10 px-[12px] py-[7px]">
        <Icon name="camera" size={15} className="shrink-0 text-cyan-300" />
        <span className="shrink-0 text-[12px] font-bold">Quad labeler</span>
        {/* Into the corpus this session is filling. A plain link, not a router
            <Link>, so the labeler keeps no dependency on the route tree — and
            leaving mid-session is deliberate: the retry queue's beforeunload
            guard is what makes an unsent label loud on the way out. */}
        <a
          href="/dev/quad-harvest"
          className="shrink-0 rounded-full bg-white/10 px-[10px] py-[3px] text-[10px] font-bold text-white/60 hover:bg-white/15 hover:text-white"
        >
          harvest →
        </a>
        <div className="flex-1" />
        {/* THE SESSION COUNTER, as wrapping chips rather than one long sentence.
            At 390 px the sentence form ran off the edge and took the title with
            it; chips reflow, and each one is legible on its own at a glance
            between frames — which is the only way this ever gets read. */}
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-[4px] text-[10px] leading-[14px]">
          <span className="rounded bg-white/10 px-[6px] py-[1px] font-mono" title="Labels saved this session">
            <b className="text-white/90">{stats.total}</b> saved
          </span>
          {stats.positive > 0 && (
            <span className="rounded bg-emerald-400/15 px-[6px] py-[1px] text-emerald-300">
              <b>{stats.positive}</b> pos
            </span>
          )}
          {stats.cardBacks > 0 && (
            <span className="rounded bg-violet-400/15 px-[6px] py-[1px] text-violet-300">
              <b>{stats.cardBacks}</b> back
            </span>
          )}
          {stats.reorientedPositives > 0 && (
            <span
              className="rounded bg-amber-400/15 px-[6px] py-[1px] text-amber-300"
              title="Positives where you moved the top-left anchor off the detector's geometric guess — production would have rectified these a quarter turn wrong"
            >
              <b>{stats.reorientedPositives}</b> reor
            </span>
          )}
          {negatives.map((reason) => (
            <span key={reason} className="rounded bg-red-400/15 px-[6px] py-[1px] text-red-300">
              <b>{stats.negativeByReason[reason]}</b> {REASON_BY_VALUE[reason].label.toLowerCase()}
            </span>
          ))}
        </div>
      </div>

      {/* THE STATUS LINE LIVES HERE, not inside the editor, because the editor
          is unmounted by the very advance the message is confirming. A receipt
          the reader never sees is not a receipt. */}
      {(saveMessage || queueLen > 0) && (
        <div
          className={`flex shrink-0 items-center gap-[8px] px-[12px] py-[6px] text-[11px] leading-[15px] ${
            saveStatus === 'error'
              ? 'bg-red-500/15 text-red-200'
              : queueLen > 0
                ? 'bg-amber-500/15 text-amber-200'
                : 'bg-emerald-500/15 text-emerald-200'
          }`}
        >
          <span className="min-w-0 flex-1">
            {saveMessage ?? `${queueLen} label${queueLen === 1 ? '' : 's'} waiting to send.`}
          </span>
          {queueLen > 0 && (
            <button
              type="button"
              onClick={() => void flushQueue()}
              className="h-[44px] shrink-0 rounded-full bg-white/15 px-[14px] text-[12px] font-bold text-white hover:bg-white/25"
            >
              Retry now
            </button>
          )}
        </div>
      )}

      {/* Hidden while cropping as well as while editing: switching entry mode
          mid-decision would strand a decoded photo nothing can reach. */}
      {!editing && !pendingCrop && (
        <div className="flex shrink-0 items-center gap-[6px] border-b border-white/10 px-[10px] py-[6px]">
          {(['capture', 'upload', 'queue'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setEntryMode(m)}
              className={`flex h-[44px] items-center gap-[5px] rounded-full px-[16px] text-[12px] font-bold capitalize ${
                entryMode === m ? 'bg-cyan-400 text-cyan-950' : 'bg-white/10 text-white/70 hover:bg-white/15'
              }`}
            >
              {m}
              {m === 'queue' && queueItems.length > 0 && (
                <span
                  className={`rounded-full px-[5px] font-mono text-[10px] ${
                    entryMode === m ? 'bg-cyan-950/25' : 'bg-cyan-400/20 text-cyan-300'
                  }`}
                >
                  {queueItems.length}
                </span>
              )}
            </button>
          ))}
          {entryMode === 'capture' && (
            <button
              type="button"
              onClick={() => setLive((v) => !v)}
              aria-pressed={live}
              title="Run the shipping detector continuously against the preview, and show every quad it proposes — including the ones the product throws away. For finding what the scanner mistakes for a card."
              className={`flex h-[44px] items-center gap-[6px] rounded-full px-[14px] text-[12px] font-bold ${
                live ? 'bg-rose-400 text-rose-950' : 'bg-white/10 text-white/70 hover:bg-white/15'
              }`}
            >
              <span
                className={`h-[7px] w-[7px] rounded-full ${live ? 'animate-pulse bg-rose-950' : 'bg-white/40'}`}
                aria-hidden="true"
              />
              Sweep
            </button>
          )}
          {entryMode === 'capture' && (
            <button
              type="button"
              onClick={() => setRapid((v) => !v)}
              aria-pressed={rapid}
              title="Shutter files each frame in the queue and stays live, so you can shoot a whole stack in one pass and label them later."
              className={`h-[44px] rounded-full px-[14px] text-[12px] font-bold ${
                rapid ? 'bg-cyan-400 text-cyan-950' : 'bg-white/10 text-white/70 hover:bg-white/15'
              }`}
            >
              Rapid
            </button>
          )}
        </div>
      )}

      {/* CAPTURE MODE STAYS MOUNTED AND LIVE UNDER THE EDITOR. `active` follows
          the MODE, not the editor, so the camera is acquired once per session
          instead of once per label — see this file's header. Hiding it with
          `hidden` keeps the <video> and its MediaStream attached. */}
      {entryMode === 'capture' && (
        <div className={editing ? 'hidden' : 'flex min-h-0 flex-1 flex-col'}>
          <CaptureStage
            active={entryMode === 'capture'}
            live={live}
            rapid={rapid}
            queued={queueItems.length}
            onCaptured={(f, verdict) => beginEditing(f, 'camera', verdict)}
            onQueued={(blob) =>
              void addToQueue([
                // Named by capture time so the queue list can tell two shots of
                // the same card apart, and so name order and shot order agree.
                { blob, name: `capture-${new Date().toISOString().replace(/[:.]/g, '-')}.jpg`, source: 'camera' },
              ])
            }
          />
        </div>
      )}

      {entryMode === 'upload' && !editing && !pendingCrop && (
        <UploadStage busy={adding} error={queueError ?? decodeError} queued={queueItems.length} onFiles={acceptFiles} />
      )}

      {entryMode === 'queue' && !editing && !pendingCrop && (
        <QueueStage
          items={queueItems}
          usage={queueUsageInfo}
          busy={openingId}
          error={queueError ?? decodeError}
          onOpen={(item) => void openQueued(item)}
          onRemove={(id) => void discardQueued(id)}
          onClear={() => void discardAll()}
          onAddFiles={acceptFiles}
        />
      )}

      {/* CHOOSE THE SQUARE, for uploads only. Rendered ahead of the editor
          because until this resolves there is no working frame to edit. */}
      {pendingCrop && !editing && (
        <CropStage
          image={pendingCrop.image}
          sourceWidth={pendingCrop.width}
          sourceHeight={pendingCrop.height}
          queued={Math.max(0, queueItems.length - 1)}
          onConfirm={(crop) => acceptCrop(crop)}
          onSkip={() => acceptCrop()}
        />
      )}

      {editing &&
        workingFrame &&
        (seed ? (
          <AnnotationEditor
            key={frameKey}
            workingFrame={workingFrame}
            initialCorners={seed.corners}
            initialTopLeftIndex={seed.topLeftIndex}
            seededFrom={seed.seededFrom}
            saving={saving}
            onSaveLabel={savePositive}
            onInvalid={saveInvalid}
            onDiscard={advance}
          />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-[10px] text-white/60">
            <span className="h-[26px] w-[26px] animate-spin rounded-full border-2 border-white/20 border-t-cyan-300" />
            <span className="text-[12px]">Seeding from the current detector…</span>
          </div>
        ))}
    </div>
  )
}
