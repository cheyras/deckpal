// Run: node --import tsx --test src/scan/voice/__tests__/*.test.ts
//
// THE RECOGNIZER ADAPTER against a fake engine and a fake clock: Safari's long
// continuous session, Chrome's session-per-utterance, iOS's silent death, a
// refusal, and an engine that ends every session the moment it starts.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  createVoiceRecognizer,
  recognitionLang,
  speechRecognitionCtor,
  WATCHDOG_MS,
  type HeardResult,
  type SpeechRecognitionLike,
  type SpeechResultEventLike,
  type Timers,
  type VoiceStatus,
} from '../recognizer'

class FakeClock implements Timers {
  t = 0
  private seq = 0
  private jobs = new Map<number, { at: number; fn: () => void }>()
  set = (fn: () => void, ms: number) => {
    const id = ++this.seq
    this.jobs.set(id, { at: this.t + ms, fn })
    return id
  }
  clear = (id: unknown) => {
    this.jobs.delete(id as number)
  }
  now = () => this.t
  advance(ms: number) {
    const end = this.t + ms
    for (;;) {
      const next = [...this.jobs.entries()].filter(([, j]) => j.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
      if (!next) break
      this.jobs.delete(next[0])
      this.t = next[1].at
      next[1].fn()
    }
    this.t = end
  }
}

/** A stand-in for one recognition session. Every instance is kept, so a test can
 *  see how many sessions the adapter opened and poke the live one. */
class FakeRecognition implements SpeechRecognitionLike {
  static all: FakeRecognition[] = []
  continuous = false
  interimResults = false
  maxAlternatives = 1
  lang = ''
  onstart: SpeechRecognitionLike['onstart'] = null
  onaudiostart: SpeechRecognitionLike['onaudiostart'] = null
  onspeechstart: SpeechRecognitionLike['onspeechstart'] = null
  onresult: SpeechRecognitionLike['onresult'] = null
  onerror: SpeechRecognitionLike['onerror'] = null
  onend: SpeechRecognitionLike['onend'] = null
  started = false
  aborted = false
  results: { isFinal: boolean; alts: string[] }[] = []
  constructor() {
    FakeRecognition.all.push(this)
  }
  start() {
    this.started = true
  }
  abort() {
    this.aborted = true
  }
  open() {
    this.onstart?.({})
    this.onaudiostart?.({})
  }
  /** Update (or append) result `index`, as the engines do while a phrase grows. */
  say(index: number, alts: string[], isFinal: boolean) {
    this.results[index] = { isFinal, alts }
    const results = this.results.map((r) => Object.assign(r.alts.map((transcript) => ({ transcript })), { isFinal: r.isFinal }))
    this.onresult?.({ resultIndex: index, results } as SpeechResultEventLike)
  }
  end() {
    this.onend?.({})
  }
  fail(error: string) {
    this.onerror?.({ error })
    this.onend?.({})
  }
}
const live = () => FakeRecognition.all.at(-1)!

function setup() {
  FakeRecognition.all = []
  const clock = new FakeClock()
  const statuses: [VoiceStatus, string | null][] = []
  const heard: HeardResult[] = []
  const rec = createVoiceRecognizer(
    { onStatus: (s, d) => statuses.push([s, d]), onResult: (r) => heard.push(r) },
    { ctor: FakeRecognition, timers: clock, lang: 'en-GB' },
  )
  return { clock, statuses, heard, rec, last: () => statuses.at(-1)?.[0] }
}

describe('the recognizer adapter', () => {
  it('finds the prefixed constructor Safari ships, and nothing on Firefox', () => {
    class A {}
    assert.equal(speechRecognitionCtor({ webkitSpeechRecognition: A }), A)
    assert.equal(speechRecognitionCtor({ SpeechRecognition: A, webkitSpeechRecognition: class {} }), A)
    assert.equal(speechRecognitionCtor({}), null)
  })

  it('asks for continuous, interim, several guesses, in English', () => {
    const { rec } = setup()
    rec.start()
    const r = live()
    assert.equal(r.started, true)
    assert.equal(r.continuous, true)
    assert.equal(r.interimResults, true)
    assert.equal(r.maxAlternatives, 3)
    assert.equal(r.lang, 'en-GB')
    assert.equal(recognitionLang('fr-FR'), 'en-US')
    assert.equal(recognitionLang('en-AU'), 'en-AU')
  })

  it('streams interim guesses and a final under one key per utterance', () => {
    const { rec, heard, last } = setup()
    rec.start()
    assert.equal(last(), 'starting')
    live().open()
    assert.equal(last(), 'listening')
    live().say(0, ['that one'], false)
    live().say(0, ["that one's a reverse"], false)
    live().say(0, ["that one's a reverse hollow", "that one's a reverse holo"], true)
    live().say(1, ['two of'], false)
    assert.deepEqual(
      heard.map((h) => [h.key, h.isFinal]),
      [['1:0', false], ['1:0', false], ['1:0', true], ['1:1', false]],
    )
    assert.deepEqual(heard[2].alternatives, ["that one's a reverse hollow", "that one's a reverse holo"])
  })

  it('re-arms when a session ends on its own (Chrome, one utterance per session)', () => {
    const { rec, clock, last } = setup()
    rec.start()
    live().open()
    live().say(0, ['two of those'], true)
    clock.advance(3_000)
    live().end()
    assert.equal(FakeRecognition.all.length, 1)
    clock.advance(300)
    assert.equal(FakeRecognition.all.length, 2)
    assert.equal(live().started, true)
    assert.equal(last(), 'listening', 'no flicker back to "starting" between sessions')
  })

  it('replaces a session that died without a word (iOS silent death)', () => {
    const { rec, clock } = setup()
    rec.start()
    live().open()
    const dead = live()
    // No result, no error, no end — the recognizer just stops talking.
    clock.advance(WATCHDOG_MS - 1)
    assert.equal(FakeRecognition.all.length, 1)
    clock.advance(1)
    assert.equal(dead.aborted, true)
    assert.equal(FakeRecognition.all.length, 2)
    assert.equal(live().started, true)
    // The corpse is detached: a late end from it re-arms nothing.
    dead.onend?.({})
    clock.advance(1_000)
    assert.equal(FakeRecognition.all.length, 2)
  })

  it('keeps the watchdog quiet while results keep arriving', () => {
    const { rec, clock } = setup()
    rec.start()
    live().open()
    for (let i = 0; i < 5; i++) {
      clock.advance(WATCHDOG_MS - 1_000)
      live().say(i, ['holo'], true)
    }
    assert.equal(FakeRecognition.all.length, 1)
  })

  it('reports a refusal as blocked, and stops asking', () => {
    const { rec, clock, last } = setup()
    rec.start()
    live().fail('not-allowed')
    assert.equal(last(), 'denied')
    assert.equal(rec.wanted, false)
    clock.advance(60_000)
    assert.equal(FakeRecognition.all.length, 1)
  })

  it('reads a refusal after the mic already worked as paused, not blocked', () => {
    const { rec, last } = setup()
    rec.start()
    live().open()
    rec.stop()
    rec.start()
    live().fail('not-allowed')
    assert.equal(last(), 'paused')
  })

  it('gives up on an engine that ends every session at once, and says why', () => {
    const { rec, clock, statuses } = setup()
    rec.start()
    for (let i = 0; i < 10; i++) {
      live().fail('network')
      clock.advance(300)
    }
    assert.deepEqual(statuses.at(-1), ['error', 'Speech recognition needs a network connection.'])
    assert.equal(FakeRecognition.all.length, 4)
    assert.equal(rec.wanted, false)
  })

  it('treats no-speech timeouts as ordinary and keeps listening', () => {
    const { rec, clock, last } = setup()
    rec.start()
    live().open()
    for (let i = 0; i < 6; i++) {
      clock.advance(8_000)
      live().fail('no-speech')
      clock.advance(300)
      live().open()
    }
    assert.equal(last(), 'listening')
    assert.equal(FakeRecognition.all.length, 7)
  })

  it('stops cleanly: aborts, detaches, and never re-arms', () => {
    const { rec, clock, heard, last } = setup()
    rec.start()
    live().open()
    const r = live()
    rec.stop()
    assert.equal(r.aborted, true)
    assert.equal(last(), 'idle')
    r.say(0, ['remove it'], true)
    r.end()
    clock.advance(60_000)
    assert.equal(heard.length, 0)
    assert.equal(FakeRecognition.all.length, 1)
  })

  it('reports an engine that throws on start', () => {
    FakeRecognition.all = []
    const statuses: [VoiceStatus, string | null][] = []
    class Throws extends FakeRecognition {
      start() {
        throw new Error('InvalidStateError')
      }
    }
    const rec = createVoiceRecognizer({ onStatus: (s, d) => statuses.push([s, d]), onResult: () => {} }, { ctor: Throws, timers: new FakeClock() })
    rec.start()
    assert.deepEqual(statuses.at(-1), ['error', 'Voice couldn’t start.'])
  })
})
