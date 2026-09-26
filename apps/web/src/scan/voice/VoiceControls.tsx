// THE VOICE SURFACES — the mic toggle, the caption on the camera, the pending
// chip on a row, the screen-reader line, and the one-time explainer.
//
// Where each one lives follows the reader's eyes while scanning. They are on
// the CAMERA, so what the recognizer heard is captioned there, live, word by
// word; the change it made is on the ROW, as a chip that drains while it can
// still be called back; and the switch sits in the capture bar beside Capture,
// the other thing a reader reaches for mid-scan. Nothing here makes a sound —
// audio playback silently kills the iOS recognizer (recognizer.ts) — so every
// acknowledgement is visual, plus a vibration where the platform has one.
import { useState, type ReactNode } from 'react'
import { Icon } from '../../components/Icon'
import { Button } from '../../components/ui/Button'
import { Sheet } from '../../components/ui/Sheet'
import type { FeedEntry } from '../ui/types'
import { describeAction, HOLD_MS, type VoiceAction } from './actions'
import type { ScannerVoice } from './useScannerVoice'

const PRIMER_KEY = 'deckpal.scan.voicePrimer.v1'

/** Has this device already been shown the explainer? Storage can be absent or
 *  throw (private mode); then the explainer simply shows again. */
export function voicePrimerSeen(): boolean {
  try {
    return localStorage.getItem(PRIMER_KEY) === '1'
  } catch {
    return false
  }
}
function markVoicePrimerSeen() {
  try {
    localStorage.setItem(PRIMER_KEY, '1')
  } catch {
    // Shown again next time; nothing else depends on it.
  }
}

const TOGGLE_LABEL: Record<ScannerVoice['status'], string> = {
  idle: 'Voice',
  starting: 'Starting…',
  listening: 'Listening',
  paused: 'Paused',
  denied: 'Blocked',
  error: 'Voice off',
}

/**
 * The switch. `compact` is the icon-only form for the expanded list's header,
 * where the capture bar (and the camera) are hidden but the microphone may still
 * be open — a reader must always be able to see that, and turn it off.
 */
export function VoiceToggle({ voice, onRequestStart, compact = false }: { voice: ScannerVoice; onRequestStart: () => void; compact?: boolean }) {
  const { status, listening } = voice
  const trouble = status === 'paused' || status === 'denied' || status === 'error'
  const tone = listening
    ? 'border-action-primary bg-action-primary/15 text-action-primary-strong'
    : trouble
      ? 'border-warning/70 text-warning'
      : 'border-border-default text-text-body hover:bg-surface-tertiary hover:text-text-primary'
  return (
    <button
      type="button"
      aria-pressed={listening}
      aria-label="Voice commands"
      title={voice.detail ?? undefined}
      data-voice-status={status}
      onClick={() => (listening ? voice.stop() : onRequestStart())}
      className={`flex shrink-0 items-center justify-center rounded-full border font-bold ${tone} ${
        compact ? 'h-[26px] w-[26px]' : 'h-[30px] gap-[6px] px-[12px] text-[13px]'
      }`}
    >
      <span className="relative flex">
        <Icon name="mic" size={compact ? 14 : 15} />
        {listening && (
          <span className="absolute -right-[2px] -top-[2px] h-[6px] w-[6px] rounded-full bg-action-primary motion-safe:animate-pulse" />
        )}
      </span>
      {!compact && <span>{TOGGLE_LABEL[status]}</span>}
    </button>
  )
}

const TROUBLE_COPY: Partial<Record<ScannerVoice['status'], string>> = {
  denied: 'Voice is blocked. Allow the microphone and speech recognition for this site in your settings, then tap Voice.',
  paused: 'Voice paused. Tap Voice to keep listening.',
}

/**
 * The caption over the camera: a problem if there is one, else the words
 * arriving right now, else the last thing voice did. Pointer-transparent except
 * for its Undo, so it never steals a tap meant for the scanner.
 */
export function VoiceCaption({ voice }: { voice: ScannerVoice }) {
  const { status, interim, caption } = voice
  const trouble = status === 'paused' || status === 'denied' || status === 'error'
  let body: ReactNode = null
  if (trouble) {
    body = (
      <>
        <Icon name="alert" size={15} className="mt-[1px] shrink-0 text-warning" />
        <span>{TROUBLE_COPY[status] ?? `${voice.detail ?? 'Voice stopped.'} Tap Voice to try again.`}</span>
      </>
    )
  } else if (interim) {
    body = (
      <>
        <Icon name="mic" size={15} className="mt-[1px] shrink-0 text-action-primary motion-safe:animate-pulse" />
        <span data-voice-interim className="italic text-white/85">
          “{interim}”
        </span>
      </>
    )
  } else if (caption) {
    const icon =
      caption.tone === 'heard' ? (
        <Icon name="mic" size={15} className="mt-[1px] shrink-0 text-action-primary" />
      ) : caption.tone === 'done' ? (
        <Icon name="check-circle" size={15} className="mt-[1px] shrink-0 text-change-positive" />
      ) : caption.tone === 'refused' ? (
        <Icon name="alert" size={15} className="mt-[1px] shrink-0 text-warning" />
      ) : null
    body = (
      <>
        {icon}
        <span className={caption.tone === 'ignored' ? 'italic text-white/55' : 'font-semibold'}>
          {caption.tone === 'ignored' ? `“${caption.text}”` : caption.text}
        </span>
        {caption.actionIds && (
          <button
            type="button"
            onClick={() => voice.undoCaption(caption.actionIds!)}
            className="pointer-events-auto -my-[3px] ml-[2px] shrink-0 rounded-full bg-white/15 px-[10px] py-[3px] text-[12px] font-bold text-white hover:bg-white/25"
          >
            Undo
          </button>
        )}
      </>
    )
  }
  if (!body) return null
  return (
    <div className="pointer-events-none absolute inset-x-[12px] bottom-[50px] z-30 flex justify-center">
      <div
        data-voice-caption={trouble ? status : interim ? 'interim' : caption?.tone}
        className="flex max-w-full items-start gap-[7px] rounded-2xl bg-black/65 px-[12px] py-[7px] text-[13px] leading-[18px] text-white shadow-elevated backdrop-blur"
      >
        {body}
      </div>
    </div>
  )
}

/** What a screen reader hears: each command's outcome, politely, and never the
 *  interim words — reading those out as they stream would talk over the
 *  reader. */
export function VoiceLiveRegion({ text }: { text: string }) {
  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
      {text}
    </div>
  )
}

/**
 * The row's pending chips: what was heard for this card, draining toward the
 * moment it applies, with the way to call it back. A removal says "Removing"
 * and offers Keep; the row itself is struck through by its card.
 */
export function VoicePendingChips({ entry, actions, onCancel }: { entry: FeedEntry; actions: readonly VoiceAction[]; onCancel: (id: string) => void }) {
  return (
    <div className="mt-[5px] flex flex-wrap items-center gap-[6px]">
      {actions.map((a) => (
        <PendingChip key={a.id} action={a} entry={entry} onCancel={onCancel} />
      ))}
    </div>
  )
}

function PendingChip({ action, entry, onCancel }: { action: VoiceAction; entry: FeedEntry; onCancel: (id: string) => void }) {
  const removing = action.kind === 'remove'
  const label = removing ? 'Removing' : describeAction(action, entry)
  const hold = HOLD_MS[action.kind]
  // How far into the hold this chip first appeared, read ONCE. The animation
  // keeps its own clock from mount; recomputing a negative delay on every
  // re-render (the scanner re-renders several times a second) would count the
  // elapsed time twice and drain the bar in half the real window.
  const [startOffset] = useState(() => (action.settleAt === null ? 0 : Math.max(0, hold - (action.settleAt - Date.now()))))
  return (
    <span
      data-voice-pending={action.kind}
      className="relative inline-flex h-[26px] min-w-0 max-w-full items-center gap-[5px] overflow-hidden rounded-full border border-action-primary/60 bg-action-primary/10 pl-[8px] pr-[2px] text-[12px] font-semibold text-text-primary"
    >
      <Icon name="mic" size={12} className="shrink-0 text-action-primary" />
      <span className="truncate">{label}</span>
      <button
        type="button"
        onClick={() => onCancel(action.id)}
        aria-label={removing ? `Keep ${entry.name}` : `Cancel voice change: ${label}`}
        className={`flex h-[22px] shrink-0 items-center justify-center rounded-full text-text-secondary hover:bg-surface-tertiary hover:text-text-primary ${
          removing ? 'px-[8px] text-[12px] font-bold' : 'w-[22px]'
        }`}
      >
        {removing ? 'Keep' : <Icon name="close" size={10} />}
      </button>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[2px] origin-left bg-action-primary motion-safe:animate-[voice-hold_1s_linear_forwards]"
        style={{ animationDuration: `${hold}ms`, animationDelay: `-${startOffset}ms` }}
      />
    </span>
  )
}

/**
 * The first time a device turns voice on: what it does, and exactly where the
 * audio goes. Shown BEFORE the browser's own prompts, so that when iOS says
 * "speech data will be sent to Apple" the reader has already read it from us.
 *
 * The claim made here is the narrow true one. DeckPal's code never sends,
 * records or stores audio or transcripts; the browser's recognizer does send
 * audio to Apple or Google, and nothing here pretends otherwise.
 */
export function VoicePrimer({ onAccept, onClose }: { onAccept: () => void; onClose: () => void }) {
  return (
    <Sheet
      title="Voice commands"
      onClose={onClose}
      size="sm"
      footer={
        <div className="flex gap-[8px]">
          <Button variant="ghost" className="flex-1" onClick={onClose}>
            Not now
          </Button>
          <Button
            className="flex-1"
            onClick={() => {
              markVoicePrimerSeen()
              onAccept()
            }}
          >
            <Icon name="mic" size={16} /> Turn on voice
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-[14px] text-[14px] leading-[21px] text-text-body">
        <p>Keep scanning and say what the scanner can’t see. The list fixes itself.</p>
        <ul className="flex flex-col gap-[6px]">
          <li>
            <b className="text-text-primary">“Reverse holo”</b>, <b className="text-text-primary">“first edition”</b> — sets
            the printing of the card you just scanned
          </li>
          <li>
            <b className="text-text-primary">“Two of those”</b> — sets how many
          </li>
          <li>
            <b className="text-text-primary">“Remove it”</b> — strikes it out
          </li>
          <li>
            <b className="text-text-primary">“The Charizard is a holo”</b> — a card’s name reaches back to an earlier scan
          </li>
        </ul>
        <p>
          Each change waits a few seconds on its card before it applies. Tap it away or say{' '}
          <b className="text-text-primary">“undo”</b>.
        </p>
        <p className="rounded-xl bg-surface-tertiary p-[12px] text-[13px] leading-[19px] text-text-secondary">
          Your browser does the listening. Safari sends your speech to Apple, and Chrome to Google, to turn it into text.
          DeckPal never receives, records or stores your audio or what you said. The scanner stays silent while it
          listens, and the Voice button turns the microphone off.
        </p>
      </div>
    </Sheet>
  )
}
