/**
 * The Jev client's one promise: an answer, or `null` meaning "do what you did
 * before". Every path to null is driven here through an injected fetch —
 * nothing in this file reaches the network.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EVALUATION } from '../models.js'
import {
  JEV_TIMEOUT_DEFAULT_MS,
  JEV_VAR,
  JEV_TIMEOUT_VAR,
  evaluate,
  jevHealth,
  jevStatus,
  jevWarning,
  type Question,
} from '../jev.js'

const QUESTIONS = {
  intent: { type: 'choice', instructions: 'What?', criteria: { a: 'first', b: 'second' } },
  refuses: { type: 'boolean', instructions: 'No?' },
} satisfies Record<string, Question>

const GOOD = {
  answers: {
    intent: { type: 'choice', choice: 'a', probabilities: { a: 0.93, b: 0.07 }, confidence: 0.9 },
    refuses: { type: 'boolean', probability: 0.04 },
  },
  usage: { inputTokens: 420, outputTokens: 20 },
  providerMetadata: { gateway: { cost: '0.00001764' }, typesafe: { confidence: { intent: 0.9 } } },
}

function withEnv(vars: Record<string, string | undefined>, fn: () => Promise<void> | void) {
  const before = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]))
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  const restore = () => {
    for (const [k, v] of Object.entries(before)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
  try {
    const out = fn()
    return out instanceof Promise ? out.finally(restore) : (restore(), out)
  } catch (e) {
    restore()
    throw e
  }
}

const reply = (body: unknown, status = 200): typeof fetch =>
  (async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })) as typeof fetch

test('off unless switched on, and off costs no request', () =>
  withEnv({ [JEV_VAR]: undefined }, async () => {
    let called = 0
    const r = await evaluate({ m: 'x' }, QUESTIONS, { key: 'k', label: 't', fetchImpl: (async () => { called++; throw new Error('no') }) as never })
    assert.equal(r, null)
    assert.equal(called, 0)
    assert.equal(jevStatus(), 'off')
    assert.equal(jevWarning(), null, 'unset is a normal state, not a warning')
  }))

test('a value nobody meant is invalid, OFF, and loud', () =>
  withEnv({ [JEV_VAR]: 'yes please' }, async () => {
    assert.equal(jevStatus(), 'invalid')
    assert.match(String(jevWarning()), /DECKE_JEV/)
    assert.equal(await evaluate({}, QUESTIONS, { key: 'k', label: 't', fetchImpl: reply(GOOD) }), null)
  }))

test('/health reports the switch, the model and the deadline, never a key', () =>
  withEnv({ [JEV_VAR]: 'on', [JEV_TIMEOUT_VAR]: '650' }, () => {
    assert.deepEqual(jevHealth(), { status: 'on', model: EVALUATION.id, timeoutMs: 650 })
  }))

test('a deadline outside 100–5000 ms falls back to the default', () =>
  withEnv({ [JEV_VAR]: 'on', [JEV_TIMEOUT_VAR]: '99999' }, () => {
    assert.equal(jevHealth().timeoutMs, JEV_TIMEOUT_DEFAULT_MS)
  }))

test('on: the answer is parsed, and the request asks for zero retention from TypeSafe only', () =>
  withEnv({ [JEV_VAR]: 'on' }, async () => {
    let sent: Record<string, unknown> = {}
    let auth = ''
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body))
      auth = new Headers(init.headers).get('authorization') ?? ''
      return new Response(JSON.stringify(GOOD), { status: 200 })
    }) as never
    const r = await evaluate({ m: 'x' }, QUESTIONS, { key: 'secret-key', label: 't', fetchImpl })
    assert.ok(r)
    assert.deepEqual(r.answers.intent, { type: 'choice', choice: 'a', probabilities: { a: 0.93, b: 0.07 }, confidence: 0.9 })
    assert.deepEqual(r.answers.refuses, { type: 'boolean', probability: 0.04 })
    assert.equal(r.inputTokens, 420)
    assert.equal(r.costUsd, '0.00001764')
    assert.equal(sent.model, 'typesafe-ai/jev')
    assert.deepEqual(sent.providerOptions, { gateway: { zeroDataRetention: true, only: ['typesafe-ai'] } })
    assert.equal(auth, 'Bearer secret-key')
  }))

test('every failure is the same null: HTTP error, malformed, wrong type, unknown option, no key', () =>
  withEnv({ [JEV_VAR]: 'on' }, async () => {
    const bad = [
      reply({ error: 'rate limited' }, 429),
      reply({ error: 'down' }, 503),
      reply({ answers: { intent: GOOD.answers.intent } }),
      reply({ answers: { ...GOOD.answers, refuses: { type: 'choice', choice: 'a', probabilities: {} } } }),
      reply({ answers: { ...GOOD.answers, intent: { type: 'choice', choice: 'c', probabilities: { c: 1 } } } }),
      reply({ answers: { ...GOOD.answers, refuses: { type: 'boolean', probability: 1.7 } } }),
      (async () => new Response('<html>', { status: 200 })) as never,
      (async () => { throw new TypeError('fetch failed') }) as never,
    ]
    for (const fetchImpl of bad) {
      assert.equal(await evaluate({}, QUESTIONS, { key: 'k', label: 't', fetchImpl }), null)
    }
    assert.equal(await evaluate({}, QUESTIONS, { key: null, label: 't', fetchImpl: reply(GOOD) }), null)
  }))

test('past the deadline it answers null on time, and the reader is not kept waiting', () =>
  withEnv({ [JEV_VAR]: 'on' }, async () => {
    const hang = ((_u: string, init: RequestInit) =>
      new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))) as never
    const started = Date.now()
    assert.equal(await evaluate({}, QUESTIONS, { key: 'k', label: 't', timeoutMs: 120, fetchImpl: hang }), null)
    const took = Date.now() - started
    assert.ok(took >= 110 && took < 1_000, `took ${took} ms`)
  }))

test('the turn\'s own abort stops it, and an already-aborted turn never asks', () =>
  withEnv({ [JEV_VAR]: 'on' }, async () => {
    const ac = new AbortController()
    const hang = ((_u: string, init: RequestInit) =>
      new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))) as never
    const pending = evaluate({}, QUESTIONS, { key: 'k', label: 't', timeoutMs: 5_000, signal: ac.signal, fetchImpl: hang })
    ac.abort()
    assert.equal(await pending, null)
    let called = 0
    assert.equal(await evaluate({}, QUESTIONS, { key: 'k', label: 't', signal: ac.signal, fetchImpl: (async () => { called++ }) as never }), null)
    assert.equal(called, 0)
  }))

test('the log line carries no reader text and no answer', () =>
  withEnv({ [JEV_VAR]: 'on' }, async () => {
    const lines: string[] = []
    const info = console.info
    console.info = (...a: unknown[]) => { lines.push(a.join(' ')) }
    try {
      await evaluate({ message: 'my secret Charizard stash' }, QUESTIONS, { key: 'k', label: 'reflex', fetchImpl: reply(GOOD) })
      await evaluate({ message: 'my secret Charizard stash' }, QUESTIONS, { key: 'k', label: 'reflex', fetchImpl: reply({}, 500) })
    } finally {
      console.info = info
    }
    assert.equal(lines.length, 2)
    assert.match(lines[0]!, /^\[deck-e\] jev reflex ok \d+ms in=420 cost=0\.00001764$/)
    assert.match(lines[1]!, /^\[deck-e\] jev reflex http_500 \d+ms$/)
    for (const l of lines) assert.doesNotMatch(l, /Charizard|secret|0\.93|choice/)
  }))
