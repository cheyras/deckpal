// THE RECOGNIZER ADAPTER — one steady "listening" out of two browsers' very
// different Web Speech implementations. Framework-free so the tests can drive it
// with a fake engine and fake timers.
//
// ── WHAT THE ENGINES ACTUALLY DO (measured / source-verified) ───────────────
//
//   Safari (macOS, iOS 18.6)  `webkitSpeechRecognition` only — no unprefixed
//       name. `continuous = true` holds: WebKit allows an hour and many
//       utterances per session. Interim results stream word by word and a final
//       lands about 3 s after speech ends. iOS asks twice: an OS prompt that
//       says speech data goes to Apple, then the site's microphone prompt.
//   Chrome  `continuous` is not honoured everywhere — a session can end after
//       each utterance — and audio goes to Google's servers.
//   Firefox  No API at all. The feature is hidden, not broken.
//
// So the adapter always asks for continuous results and simply RE-ARMS whenever
// a session ends while the reader still wants to be heard. That one rule covers
// Chrome's per-utterance sessions, Safari's rare ends, and `no-speech` timeouts.
//
// ── SILENT DEATH, AND THE WATCHDOG ──────────────────────────────────────────
//
// Any audio playback on iOS kills the recognizer with no error and no `end`
// (WICG/speech-api#96), and it has been seen to stop on its own. Nothing in the
// event stream says so, which is why the scanner makes no sound while listening
// and why this adapter keeps a watchdog: no sign of life for `watchdogMs` and the
// session is aborted and replaced. Handlers are detached before every abort, so
// a late event from a session we already gave up on can never be mistaken for
// the new one's.
//
// ── A RESTART LOOP IS NOT LISTENING ─────────────────────────────────────────
//
// Re-arming on `end` would spin forever against an engine that ends every
// session immediately (a missing network in Chrome, a microphone held by
// something else). Sessions that end within `FAST_FAIL_MS` having heard
// nothing are counted, and after `MAX_FAST_FAILS` in a row the adapter stops and
// says why, instead of pretending.

export type VoiceStatus = 'idle' | 'starting' | 'listening' | 'paused' | 'denied' | 'error'

/** The slice of the Web Speech API this adapter uses, declared structurally:
 *  TypeScript's DOM lib does not ship these types, and the tests supply a fake. */
export interface SpeechRecognitionLike {
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  lang: string
  onstart: ((ev: unknown) => void) | null
  onaudiostart: ((ev: unknown) => void) | null
  onspeechstart: ((ev: unknown) => void) | null
  onresult: ((ev: SpeechResultEventLike) => void) | null
  onerror: ((ev: { error: string }) => void) | null
  onend: ((ev: unknown) => void) | null
  start(): void
  abort(): void
}
export interface SpeechResultEventLike {
  resultIndex: number
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>
}
export type SpeechRecognitionCtor = new () => SpeechRecognitionLike

export function speechRecognitionCtor(scope: object = globalThis): SpeechRecognitionCtor | null {
  const s = scope as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor }
  return s.SpeechRecognition ?? s.webkitSpeechRecognition ?? null
}

/** One utterance's current guesses. `key` is stable for the life of the
 *  utterance — interim updates and its final share it — so a caller can pin
 *  what "that one" meant at the moment the reader started speaking. */
export interface HeardResult {
  key: string
  alternatives: string[]
  isFinal: boolean
}

export interface RecognizerCallbacks {
  onStatus: (status: VoiceStatus, detail: string | null) => void
  onResult: (result: HeardResult) => void
}

export interface Timers {
  set: (fn: () => void, ms: number) => unknown
  clear: (id: unknown) => void
  now: () => number
}

export interface RecognizerOptions {
  ctor: SpeechRecognitionCtor
  lang?: string
  watchdogMs?: number
  timers?: Timers
}

/** No result, start or audio for this long means the session died quietly. */
export const WATCHDOG_MS = 20_000
const REARM_DELAY_MS = 250
const FAST_FAIL_MS = 1_000
const MAX_FAST_FAILS = 4

const REAL_TIMERS: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
}

/** English, in the reader's own variant when their browser is set to one; the
 *  grammar is English either way. */
export function recognitionLang(language: string | undefined): string {
  return language && /^en(-|$)/i.test(language) ? language : 'en-US'
}

export interface VoiceRecognizer {
  start(): void
  stop(): void
  readonly status: VoiceStatus
  /** Whether the reader currently wants to be heard. */
  readonly wanted: boolean
}

export function createVoiceRecognizer(callbacks: RecognizerCallbacks, options: RecognizerOptions): VoiceRecognizer {
  const timers = options.timers ?? REAL_TIMERS
  const watchdogMs = options.watchdogMs ?? WATCHDOG_MS
  const lang = options.lang ?? 'en-US'

  let wanted = false
  let rec: SpeechRecognitionLike | null = null
  let session = 0
  let startedAt = 0
  let heardThisSession = false
  /** Has a session ever opened the microphone? A `not-allowed` after one did
   *  is not a refusal — iOS wants a fresh tap to start again after the page has
   *  been away — so it reads as "paused", not "blocked". */
  let everOpened = false
  let fastFails = 0
  let lastError: string | null = null
  let watchdog: unknown = null
  let rearm: unknown = null
  let status: VoiceStatus = 'idle'

  function setStatus(next: VoiceStatus, detail: string | null = null) {
    if (next === status && detail === null) return
    status = next
    callbacks.onStatus(next, detail)
  }

  function detach(r: SpeechRecognitionLike) {
    r.onstart = r.onaudiostart = r.onspeechstart = r.onresult = r.onerror = r.onend = null
  }

  function clearWatchdog() {
    if (watchdog !== null) timers.clear(watchdog)
    watchdog = null
  }

  /** Drop the current session without waiting for it: detached first, so
   *  nothing it says afterwards is heard. */
  function kill() {
    clearWatchdog()
    const r = rec
    rec = null
    if (!r) return
    detach(r)
    try {
      r.abort()
    } catch {
      // Already stopped. The session is gone either way.
    }
  }

  function kick() {
    clearWatchdog()
    if (!wanted) return
    watchdog = timers.set(() => {
      watchdog = null
      if (!wanted) return
      kill()
      arm()
    }, watchdogMs)
  }

  function fail(next: 'paused' | 'denied' | 'error', detail: string | null) {
    wanted = false
    if (rearm !== null) timers.clear(rearm)
    rearm = null
    kill()
    setStatus(next, detail)
  }

  function arm() {
    rearm = null
    if (!wanted || rec) return
    const r = new options.ctor()
    r.continuous = true
    r.interimResults = true
    r.maxAlternatives = 3
    r.lang = lang
    session += 1
    const tag = session
    heardThisSession = false
    startedAt = timers.now()

    const alive = () => {
      everOpened = true
      setStatus('listening')
      kick()
    }
    r.onstart = () => rec === r && alive()
    r.onaudiostart = () => rec === r && alive()
    r.onspeechstart = () => rec === r && kick()
    r.onresult = (ev) => {
      if (rec !== r) return
      heardThisSession = true
      fastFails = 0
      alive()
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const result = ev.results[i]
        const alternatives: string[] = []
        for (let j = 0; j < result.length; j++) {
          const t = result[j]?.transcript?.trim()
          if (t) alternatives.push(t)
        }
        if (alternatives.length) callbacks.onResult({ key: `${tag}:${i}`, alternatives, isFinal: result.isFinal })
      }
    }
    r.onerror = (ev) => {
      if (rec !== r) return
      lastError = ev.error
      if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') {
        fail(everOpened ? 'paused' : 'denied', null)
      } else if (ev.error === 'audio-capture') {
        fail('error', 'No microphone is available.')
      } else if (ev.error === 'language-not-supported') {
        fail('error', 'This browser can’t recognise English speech.')
      }
      // Everything else (`no-speech`, `aborted`, `network`) is followed by an
      // `end`, and the end decides whether to go again.
    }
    r.onend = () => {
      if (rec !== r) return
      rec = null
      detach(r)
      clearWatchdog()
      if (!wanted) return
      // Only a CONSECUTIVE run of instant failures counts: any session that
      // heard something, or simply lasted, resets it.
      if (!heardThisSession && timers.now() - startedAt < FAST_FAIL_MS) fastFails += 1
      else fastFails = 0
      if (fastFails >= MAX_FAST_FAILS) {
        fail('error', lastError === 'network' ? 'Speech recognition needs a network connection.' : 'Voice keeps stopping.')
        return
      }
      rearm = timers.set(arm, REARM_DELAY_MS)
    }

    rec = r
    if (status !== 'listening') setStatus('starting')
    try {
      r.start()
    } catch {
      fail('error', 'Voice couldn’t start.')
      return
    }
    kick()
  }

  return {
    start() {
      if (wanted) return
      wanted = true
      fastFails = 0
      lastError = null
      arm()
    },
    stop() {
      wanted = false
      if (rearm !== null) timers.clear(rearm)
      rearm = null
      kill()
      setStatus('idle')
    },
    get status() {
      return status
    },
    get wanted() {
      return wanted
    },
  }
}
