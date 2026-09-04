// Quad labeler — owner tooling to build a human-verified corpus of correct
// quads (or explicit, reason-coded invalid verdicts — types.ts InvalidReason)
// for the shipping detector. Two entry modes
// converge on one working-frame format (workingFrame.ts), one seeding step
// (detectSeed.ts — the real detector, run once), and one editor
// (AnnotationEditor.tsx). Instrument-grade register on purpose: dark,
// utilitarian, no product chrome — this is the harness's register, not
// Scan.tsx's.
import { useCallback, useRef, useState } from 'react'
import { Icon } from '../../components/Icon'
import type { Quad } from '../engine/contract'
import { CaptureStage } from './CaptureStage'
import { UploadStage } from './UploadStage'
import { AnnotationEditor } from './AnnotationEditor'
import { seedQuad } from './detectSeed'
import { saveLabel } from './saveLabel'
import type { InvalidReason, LabelSource, QuadLabel, SeededFrom, SessionStats } from './types'
import type { WorkingFrame } from './workingFrame'

type EntryMode = 'capture' | 'upload'

export function QuadLabeler() {
  const [entryMode, setEntryMode] = useState<EntryMode>('capture')
  const [editing, setEditing] = useState(false)
  const [workingFrame, setWorkingFrame] = useState<WorkingFrame | null>(null)
  // A real identity for AnnotationEditor's `key` — the canvas ELEMENT itself
  // is not a valid React key (it would stringify to the same
  // "[object HTMLCanvasElement]" for every frame, defeating the remount the
  // editor's fresh-interaction-state-per-frame design relies on).
  const frameSeq = useRef(0)
  const [frameKey, setFrameKey] = useState(0)
  const [source, setSource] = useState<LabelSource>('camera')
  const [seed, setSeed] = useState<{ corners: Quad; seededFrom: SeededFrom; pipeline: QuadLabel['pipeline'] } | null>(
    null,
  )
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'sent' | 'error'>('idle')
  const [saveMessage, setSaveMessage] = useState<string | null>(null)
  const [stats, setStats] = useState<SessionStats>({ total: 0, positive: 0, negativeByReason: {} })
  const messageTimer = useRef<number | null>(null)

  const flashMessage = useCallback((status: 'sent' | 'error', text: string) => {
    setSaveStatus(status)
    setSaveMessage(text)
    if (messageTimer.current) window.clearTimeout(messageTimer.current)
    messageTimer.current = window.setTimeout(() => setSaveMessage(null), 4000)
  }, [])

  const beginEditing = useCallback((frame: WorkingFrame, from: LabelSource) => {
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
  }, [])

  const labelBase = useCallback(() => {
    if (!workingFrame || !seed) return null
    return {
      dims: { width: workingFrame.canonical.width, height: workingFrame.canonical.height },
      source,
      seededFrom: seed.seededFrom,
      pipeline: seed.pipeline,
      savedAt: new Date().toISOString(),
    }
  }, [workingFrame, seed, source])

  const REASON_TEXT: Record<InvalidReason, string> = {
    no_card: 'no card',
    multiple_cards: 'multiple cards',
    too_blurry: 'too blurry',
  }

  const doSave = useCallback(
    async (label: QuadLabel | null) => {
      if (!label || !workingFrame) return
      setSaving(true)
      try {
        await saveLabel(workingFrame.canonical, label)
        setStats((s) =>
          label.corners
            ? { ...s, total: s.total + 1, positive: s.positive + 1 }
            : {
                ...s,
                total: s.total + 1,
                negativeByReason: {
                  ...s.negativeByReason,
                  [label.invalidReason]: (s.negativeByReason[label.invalidReason] ?? 0) + 1,
                },
              },
        )
        flashMessage(
          'sent',
          label.corners ? 'Saved ✓ — label recorded' : `Saved ✓ — recorded as invalid (${REASON_TEXT[label.invalidReason]})`,
        )
      } catch (e) {
        flashMessage('error', e instanceof Error ? e.message : 'that did not save')
      } finally {
        setSaving(false)
      }
    },
    [workingFrame, flashMessage],
  )

  const savePositive = useCallback(
    (corners: Quad) => {
      const base = labelBase()
      if (!base) return
      void doSave({ ...base, corners })
    },
    [labelBase, doSave],
  )

  const saveInvalid = useCallback(
    (reason: InvalidReason) => {
      const base = labelBase()
      if (!base) return
      void doSave({ ...base, corners: null, invalidReason: reason })
    },
    [labelBase, doSave],
  )

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-neutral-950 text-white">
      <div className="flex shrink-0 items-center gap-[10px] border-b border-white/10 px-[14px] py-[8px]">
        <Icon name="camera" size={16} className="text-cyan-300" />
        <span className="text-[13px] font-bold">Quad labeler</span>
        <span className="rounded bg-white/10 px-[6px] py-[1px] text-[10px] font-mono text-white/50">/dev</span>
        <div className="flex-1" />
        <span
          className="text-[11px] text-white/50"
          title="Labeled this session — negatives broken out by reason"
        >
          <b className="text-white/80">{stats.total}</b> this session · <b className="text-emerald-300">{stats.positive}</b>{' '}
          positive
          {(Object.keys(stats.negativeByReason) as InvalidReason[]).map((reason) => (
            <span key={reason}>
              {' · '}
              <b className="text-red-300">{stats.negativeByReason[reason]}</b> {REASON_TEXT[reason]}
            </span>
          ))}
        </span>
      </div>

      {!editing && (
        <div className="flex shrink-0 items-center gap-[6px] border-b border-white/10 px-[10px] py-[6px]">
          {(['capture', 'upload'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setEntryMode(m)}
              className={`h-[30px] rounded-full px-[14px] text-[12px] font-bold capitalize ${
                entryMode === m ? 'bg-cyan-400 text-cyan-950' : 'bg-white/10 text-white/70 hover:bg-white/15'
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      )}

      {!editing &&
        (entryMode === 'capture' ? (
          <CaptureStage active={entryMode === 'capture'} onCaptured={(f) => beginEditing(f, 'camera')} />
        ) : (
          <UploadStage onCaptured={(f) => beginEditing(f, 'upload')} />
        ))}

      {editing && workingFrame && (
        seed ? (
          <AnnotationEditor
            key={frameKey}
            workingFrame={workingFrame}
            initialCorners={seed.corners}
            seededFrom={seed.seededFrom}
            saving={saving}
            saveStatus={saveStatus}
            saveMessage={saveMessage}
            onSaveLabel={savePositive}
            onInvalid={saveInvalid}
            onDiscard={reset}
            onNext={reset}
          />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-[10px] text-white/60">
            <span className="h-[26px] w-[26px] animate-spin rounded-full border-2 border-white/20 border-t-cyan-300" />
            <span className="text-[12px]">Seeding from the current detector…</span>
          </div>
        )
      )}
    </div>
  )
}
