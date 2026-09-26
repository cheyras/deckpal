// VOICE, WIRED INTO THE SCANNER — the recognizer adapter, the grammar and the
// pending queue, held together for one mounted `Scan` screen.
//
// Everything with a rule in it lives in the pure modules beside this one
// (`grammar.ts`, `actions.ts`, `printings.ts`, `recognizer.ts`); this hook owns
// only time, React state and the browser's lifecycle:
//
//   * "that one" is pinned per utterance, the moment its FIRST words arrive —
//     see actions.ts for why the moment the words finish is too late;
//   * pending actions tick toward their hold and apply through `setFeed`, the
//     same state the row's own select and stepper write;
//   * listening stops when the scan step ends (camera and mic go together),
//     when the page is hidden, and when the route unmounts — and comes back on
//     its own when the reader returns to a scan they left it on for.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { FeedEntry } from '../ui/types'
import {
  applyAction,
  cancel as cancelAction,
  EMPTY_QUEUE,
  enqueue,
  namedRows,
  propose,
  remember,
  revert,
  revertible,
  settleAll,
  tick,
  undoLatest,
  type VoiceAction,
  type VoiceQueue,
} from './actions'
import { parseAlternatives } from './grammar'
import { createVoiceRecognizer, recognitionLang, speechRecognitionCtor, type HeardResult, type VoiceRecognizer, type VoiceStatus } from './recognizer'

export interface VoiceCaption {
  id: number
  /** heard: a command is pending. done: a removal applied (its row is gone, so
   *  the caption is where Undo lives). refused: understood, not possible.
   *  ignored: not a command. info: anything else worth a line. */
  tone: 'heard' | 'done' | 'refused' | 'ignored' | 'info'
  text: string
  /** Offer Undo beside it. */
  undo?: boolean
}

const CAPTION_MS: Record<VoiceCaption['tone'], number> = { heard: 6_000, done: 6_000, refused: 4_500, ignored: 2_500, info: 6_000 }
const TICK_MS = 200
const VOICE_EXAMPLES = 'Say “reverse holo”, “two of those” or “remove it”'

export interface ScannerVoiceOptions {
  /** The feature is on for this reader AND the scan step is showing. */
  enabled: boolean
  feed: FeedEntry[]
  setFeed: Dispatch<SetStateAction<FeedEntry[]>>
  /** The capture "that one" would mean right now. */
  lastCaptureId: () => string | null
  /** Is this capture still being identified (in the stack, not yet a row)? */
  inFlight: (captureId: string) => boolean
  /** A command just landed on this row — bring it into view. */
  onTarget?: (rowId: string) => void
  /** Undo put a removed row back. Its printings may have been looked up while
   *  it was out of the list, and the lookup fills only rows that are present,
   *  so the caller asks again (from its cache). */
  onRowRestored?: (row: FeedEntry) => void
}

export function useScannerVoice({ enabled, feed, setFeed, lastCaptureId, inFlight, onTarget, onRowRestored }: ScannerVoiceOptions) {
  const supported = useMemo(() => typeof window !== 'undefined' && speechRecognitionCtor(window) !== null, [])
  const [status, setStatus] = useState<VoiceStatus>('idle')
  const [detail, setDetail] = useState<string | null>(null)
  const [interim, setInterim] = useState('')
  const [caption, setCaption] = useState<VoiceCaption | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const [queue, setQueueState] = useState<VoiceQueue>(EMPTY_QUEUE)

  const queueRef = useRef<VoiceQueue>(EMPTY_QUEUE)
  const feedRef = useRef(feed)
  const recRef = useRef<VoiceRecognizer | null>(null)
  const resumeRef = useRef(false)
  const enabledRef = useRef(enabled)
  const anchorsRef = useRef(new Map<string, string | null>())
  const finalsRef = useRef(new Set<string>())
  const captionSeq = useRef(0)
  const actionSeq = useRef(0)
  const greetedRef = useRef(false)
  // The latest callbacks, read from inside recognizer events that were bound
  // once — the same reason Scan.tsx mirrors its feed into a ref.
  const cbRef = useRef({ lastCaptureId, inFlight, onTarget, onRowRestored, setFeed })
  useLayoutEffect(() => {
    feedRef.current = feed
    enabledRef.current = enabled
    cbRef.current = { lastCaptureId, inFlight, onTarget, onRowRestored, setFeed }
  })

  const commitQueue = useCallback((next: VoiceQueue) => {
    if (next === queueRef.current) return
    queueRef.current = next
    setQueueState(next)
  }, [])

  /** Say it to a screen reader. Cleared first so the same sentence twice is
   *  still announced twice. */
  const announce = useCallback((text: string) => {
    setAnnouncement('')
    window.setTimeout(() => setAnnouncement(text), 50)
  }, [])

  const show = useCallback(
    (tone: VoiceCaption['tone'], text: string, undo = false) => {
      captionSeq.current += 1
      setCaption({ id: captionSeq.current, tone, text, undo })
      if (tone !== 'ignored') announce(text)
    },
    [announce],
  )

  useEffect(() => {
    if (!caption) return
    const t = window.setTimeout(() => setCaption((c) => (c?.id === caption.id ? null : c)), CAPTION_MS[caption.tone])
    return () => window.clearTimeout(t)
  }, [caption])

  /** Apply due actions against the list as it is now, and remember how to
   *  undo each one. The update goes through `setFeed` as a function of the
   *  CURRENT state, so a row landing in the same instant is not lost. */
  const applyDue = useCallback(
    (due: readonly VoiceAction[]) => {
      let q = queueRef.current
      for (const action of due) {
        const r = applyAction(feedRef.current, action)
        if (!r.record) {
          show('refused', r.outcome.message)
          continue
        }
        feedRef.current = r.feed
        cbRef.current.setFeed((prev) => applyAction(prev, action).feed)
        q = remember(q, r.record)
        // A printing or a count changes in place on a row the reader can see
        // and edit; a removal takes the row away, so its Undo has to live here.
        if (action.kind === 'remove') show('done', r.outcome.message, true)
        else announce(r.outcome.message)
      }
      commitQueue(q)
    },
    [announce, commitQueue, show],
  )

  const runTick = useCallback(() => {
    const t = tick(queueRef.current, feedRef.current, Date.now(), (id) => cbRef.current.inFlight(id))
    commitQueue(t.queue)
    for (const d of t.dropped) show('refused', d.message)
    for (const rowId of t.attached) cbRef.current.onTarget?.(rowId)
    if (t.due.length) applyDue(t.due)
  }, [applyDue, commitQueue, show])

  const hasPending = queue.pending.length > 0
  useEffect(() => {
    if (!hasPending) return
    runTick()
    const id = window.setInterval(runTick, TICK_MS)
    return () => window.clearInterval(id)
  }, [hasPending, runTick])

  const undo = useCallback(() => {
    const r = undoLatest(queueRef.current)
    commitQueue(r.queue)
    if (r.cancelled) show('info', 'Cancelled')
    else if (r.reverted && !revertible(feedRef.current, r.reverted)) {
      show('refused', 'Can’t undo that — the card has changed since')
    } else if (r.reverted) {
      const record = r.reverted
      feedRef.current = revert(feedRef.current, record)
      cbRef.current.setFeed((prev) => revert(prev, record))
      if (record.kind === 'remove') cbRef.current.onRowRestored?.(record.row)
      show('info', `Undid: ${record.label}`)
    } else show('refused', 'Nothing to undo')
  }, [commitQueue, show])

  const stop = useCallback(() => {
    resumeRef.current = false
    recRef.current?.stop()
  }, [])

  const onResult = useCallback(
    (r: HeardResult) => {
      // Pin "that one" on the utterance's FIRST words, not its last.
      if (!anchorsRef.current.has(r.key)) anchorsRef.current.set(r.key, cbRef.current.lastCaptureId())
      if (!r.isFinal) {
        setInterim(r.alternatives[0] ?? '')
        return
      }
      if (finalsRef.current.has(r.key)) return
      finalsRef.current.add(r.key)
      const anchor = anchorsRef.current.get(r.key) ?? null
      anchorsRef.current.delete(r.key)
      setInterim('')

      const parsed = parseAlternatives(r.alternatives, namedRows(feedRef.current))
      const command = parsed.command
      if (parsed.unresolvedName) {
        show('refused', `Couldn’t find “${parsed.unresolvedName}” in the list`)
        return
      }
      if (!command) {
        show('ignored', parsed.heard)
        return
      }
      if (command.kind === 'undo') return undo()
      if (command.kind === 'stop') {
        stop()
        show('info', 'Voice off')
        return
      }
      const rowId = command.target.kind === 'row' ? command.target.rowId : anchor
      if (!rowId) {
        show('refused', 'Scan a card first, then tell me about it')
        return
      }
      const { actions, outcome } = propose(command, rowId, feedRef.current, Date.now(), () => `va-${++actionSeq.current}`)
      if (!actions.length) {
        show('refused', outcome.message)
        return
      }
      commitQueue(enqueue(queueRef.current, actions))
      show('heard', outcome.message, true)
      // A tap you can feel where the platform allows one (not iOS Safari). Never
      // a sound: audio playback silently kills the iOS recognizer.
      if ('vibrate' in navigator) navigator.vibrate(12)
      if (feedRef.current.some((e) => e.id === rowId)) cbRef.current.onTarget?.(rowId)
    },
    [commitQueue, show, stop, undo],
  )

  const onStatus = useCallback((next: VoiceStatus, why: string | null) => {
    setStatus(next)
    setDetail(why)
    if (next !== 'listening' && next !== 'starting') setInterim('')
  }, [])

  const start = useCallback(() => {
    if (!supported || !enabledRef.current) return
    if (!recRef.current) {
      const ctor = speechRecognitionCtor(window)
      if (!ctor) return
      recRef.current = createVoiceRecognizer({ onStatus, onResult }, { ctor, lang: recognitionLang(navigator.language) })
    }
    if (!greetedRef.current) {
      greetedRef.current = true
      show('info', VOICE_EXAMPLES)
    }
    recRef.current.start()
  }, [onResult, onStatus, show, supported])

  // The scan step ends: the mic goes with the camera, and every pending change
  // the reader has already seen and not objected to applies now.
  useEffect(() => {
    const rec = recRef.current
    if (enabled) {
      // Not while the page is hidden (a commit can return the reader to the
      // scan step after they have switched away): the flag stays set, and the
      // visibility handler below resumes when they come back.
      if (resumeRef.current && rec && document.visibilityState === 'visible') {
        resumeRef.current = false
        rec.start()
      }
      return
    }
    if (rec?.wanted) {
      resumeRef.current = true
      rec.stop()
    }
    if (queueRef.current.pending.length) {
      const s = settleAll(queueRef.current)
      commitQueue(s.queue)
      if (s.due.length) applyDue(s.due)
    }
    setInterim('')
    setCaption(null)
  }, [enabled, applyDue, commitQueue])

  // The page goes away — app switch, lock screen, another tab. iOS would kill
  // the recognizer anyway; stopping it ourselves means it is restarted
  // deliberately on return rather than left for the watchdog to find.
  useEffect(() => {
    const onVisibility = () => {
      const rec = recRef.current
      if (!rec) return
      if (document.visibilityState === 'hidden') {
        if (rec.wanted) {
          resumeRef.current = true
          rec.stop()
        }
      } else if (resumeRef.current && enabledRef.current) {
        resumeRef.current = false
        rec.start()
      }
    }
    const onPageHide = () => recRef.current?.stop()
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', onPageHide)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', onPageHide)
    }
  }, [])

  // Leaving the route.
  useEffect(
    () => () => {
      resumeRef.current = false
      recRef.current?.stop()
    },
    [],
  )

  const cancel = useCallback(
    (actionId: string) => {
      commitQueue(cancelAction(queueRef.current, actionId))
      show('info', 'Cancelled')
    },
    [commitQueue, show],
  )

  /** Pending actions whose row is in the list, by row — what the chips draw. */
  const pendingByRow = useMemo(() => {
    const map = new Map<string, VoiceAction[]>()
    for (const a of queue.pending) {
      if (a.settleAt === null) continue
      const list = map.get(a.rowId) ?? []
      list.push(a)
      map.set(a.rowId, list)
    }
    return map
  }, [queue])

  return {
    supported,
    status,
    detail,
    listening: status === 'listening' || status === 'starting',
    interim,
    caption,
    announcement,
    pendingByRow,
    start,
    stop,
    cancel,
    undo,
  }
}

export type ScannerVoice = ReturnType<typeof useScannerVoice>
