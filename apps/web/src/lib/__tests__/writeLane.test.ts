// Pure unit tests for the write lane (lib/writeLane.ts) and the words for a
// failed write (lib/writeFailure.ts). No DB, no browser; the
// `node --import tsx --test` convention the other lib tests use.
//
// The lane is the whole answer to two audit findings, so both are pinned here as
// scenarios rather than only as properties:
//   QUAL-06 — rapid "+" taps on a deck row fired unordered requests, and a stale
//             answer landing last overwrote the newer quantity;
//   UXC-02  — the set grid disabled a counter during its write, so a second and
//             third tap were silently dropped.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DeadlineError, WriteLane, type WriteOutcome } from '../writeLane.js'
import { failureMessage, failureReason } from '../writeFailure.js'

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const tick = () => new Promise((r) => setTimeout(r, 0))

/** A fake endpoint whose every call is answered by hand, in whatever order the test likes. */
function endpoint<T>() {
  const calls: { arg: T; answer: ReturnType<typeof deferred<T>>; signal: AbortSignal }[] = []
  return {
    calls,
    send: (arg: T) => (signal: AbortSignal) => {
      const answer = deferred<T>()
      calls.push({ arg, answer, signal })
      return answer.promise
    },
  }
}

class ApiLikeError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'ApiError'
  }
}

test('one request at a time: the second write waits for the first to answer', async () => {
  const lane = new WriteLane()
  const api = endpoint<string>()
  const a = lane.write({ item: 'a', send: api.send('a') })
  const b = lane.write({ item: 'b', send: api.send('b') })
  assert.equal(api.calls.length, 1, 'b must not be sent while a is in flight')
  api.calls[0]!.answer.resolve('a')
  assert.deepEqual(await a, { status: 'saved', value: 'a', final: true })
  assert.equal(api.calls.length, 2)
  api.calls[1]!.answer.resolve('b')
  assert.deepEqual(await b, { status: 'saved', value: 'b', final: true })
})

test('the last intent wins: a waiting write for the same item is replaced, not queued', async () => {
  const lane = new WriteLane()
  const api = endpoint<number>()
  const first = lane.write({ item: 'qty', intent: 1, send: api.send(1) })
  const second = lane.write({ item: 'qty', intent: 2, send: api.send(2) })
  const third = lane.write({ item: 'qty', intent: 3, send: api.send(3) })
  assert.deepEqual(await second, { status: 'superseded' })
  assert.equal(lane.intent('qty'), 3, 'the control shows the newest intent')

  api.calls[0]!.answer.resolve(1)
  assert.deepEqual(await first, { status: 'saved', value: 1, final: false }, 'an answer with a newer intent behind it is not final')
  assert.equal(lane.intent('qty'), 3, 'still showing the newest intent while it is in flight')
  api.calls[1]!.answer.resolve(3)
  assert.deepEqual(await third, { status: 'saved', value: 3, final: true })
  assert.deepEqual(api.calls.map((c) => c.arg), [1, 3], 'three taps, two requests')
  assert.equal(lane.intent('qty'), undefined, 'settled: the cache takes over')
  assert.equal(lane.busy(), false)
})

test('answers are applied in the order sent, before the intent is dropped', async () => {
  const lane = new WriteLane()
  const api = endpoint<number>()
  const applied: { value: number; intentDuringApply: unknown }[] = []
  const onSaved = (value: number) => applied.push({ value, intentDuringApply: lane.intent('qty') })
  const writes = [1, 2].map((n) => lane.write({ item: 'qty', intent: n, send: api.send(n), onSaved }))
  api.calls[0]!.answer.resolve(1)
  await writes[0]
  api.calls[1]!.answer.resolve(2)
  await writes[1]
  assert.deepEqual(applied, [
    { value: 1, intentDuringApply: 2 },
    { value: 2, intentDuringApply: 2 },
  ], 'the final answer lands in the cache while the intent still masks it — no flash of the old value')
})

test('QUAL-06: five rapid taps against a jittery server settle on five', async () => {
  // Latency that would have reordered unserialised requests: each later one is FASTER.
  const lane = new WriteLane()
  let cache = 0
  let sends = 0
  const server = { qty: 0 }
  const set = (n: number) => () => {
    sends++
    return new Promise<number>((resolve) =>
      setTimeout(() => {
        server.qty = n
        resolve(n)
      }, 30 - sends * 5),
    )
  }
  const shown = () => lane.intent<number>('row') ?? cache
  const taps = [] as Promise<WriteOutcome<number>>[]
  for (let i = 0; i < 5; i++) {
    const target = shown() + 1
    taps.push(lane.write({ item: 'row', intent: target, send: set(target), onSaved: (v) => (cache = v) }))
    assert.equal(shown(), target, 'every tap shows immediately')
  }
  await Promise.all(taps)
  assert.equal(cache, 5)
  assert.equal(server.qty, 5)
  assert.ok(sends <= 2, `coalesced into ${sends} requests`)
})

test('UXC-02: a counter never drops a tap made while its write is in flight', async () => {
  const lane = new WriteLane()
  const api = endpoint<number>()
  lane.write({ item: 'v', intent: 1, send: api.send(1) })
  // The old counters were disabled here. A lane accepts the tap and remembers it.
  lane.write({ item: 'v', intent: 2, send: api.send(2) })
  const last = lane.write({ item: 'v', intent: 3, send: api.send(3) })
  api.calls[0]!.answer.resolve(1)
  await tick()
  api.calls[1]!.answer.resolve(3)
  assert.equal((await last).status, 'saved')
  assert.equal(api.calls.at(-1)!.arg, 3)
})

test('a failure is only final when nothing newer is waiting — and final failures roll back', async () => {
  const lane = new WriteLane()
  const api = endpoint<number>()
  const first = lane.write({ item: 'qty', intent: 1, send: api.send(1) })
  const second = lane.write({ item: 'qty', intent: 2, send: api.send(2) })
  api.calls[0]!.answer.reject(new Error('blip'))
  const one = await first
  assert.equal(one.status, 'failed')
  assert.equal(one.status === 'failed' && one.final, false, 'superseded by the user already; nothing to report')
  assert.equal(lane.intent('qty'), 2)

  api.calls[1]!.answer.reject(new Error('down'))
  const two = await second
  assert.equal(two.status === 'failed' && two.final, true, 'the user’s last intent failed: report it')
  assert.equal(lane.intent('qty'), undefined, 'the control falls back to the server value')
})

test('independent items keep going after a neighbour fails', async () => {
  const lane = new WriteLane()
  const api = endpoint<string>()
  const a = lane.write({ item: 'a', send: api.send('a') })
  const b = lane.write({ item: 'b', send: api.send('b') })
  api.calls[0]!.answer.reject(new Error('nope'))
  assert.equal((await a).status, 'failed')
  api.calls[1]!.answer.resolve('b')
  assert.equal((await b).status, 'saved')
})

test('a request that never answers is abandoned at the deadline, aborted, and the lane moves on', async () => {
  const lane = new WriteLane(20)
  const api = endpoint<string>()
  const stuck = lane.write({ item: 'a', send: api.send('a') })
  const next = lane.write({ item: 'b', send: api.send('b') })
  const outcome = await stuck
  assert.equal(outcome.status, 'failed')
  assert.ok(outcome.status === 'failed' && outcome.error instanceof DeadlineError)
  assert.equal(api.calls[0]!.signal.aborted, true, 'the fetch itself is cancelled')
  assert.equal(api.calls.length, 2)
  api.calls[1]!.answer.resolve('b')
  assert.equal((await next).status, 'saved')
})

test('a bug applying an answer, or a send that throws, cannot wedge the lane', async () => {
  const lane = new WriteLane()
  const original = console.error
  console.error = () => {}
  try {
    const a = await lane.write({ item: 'a', send: async () => 'a', onSaved: () => { throw new Error('bad apply') } })
    assert.equal(a.status, 'saved', 'the server has it; the outcome says so')
    const b = await lane.write({ item: 'b', send: () => { throw new Error('sync throw') } })
    assert.equal(b.status, 'failed')
    const c = await lane.write({ item: 'c', send: async () => 'c' })
    assert.equal(c.status, 'saved')
  } finally {
    console.error = original
  }
})

test('busy() and subscribers track outstanding items', async () => {
  const lane = new WriteLane()
  const api = endpoint<string>()
  let notified = 0
  const unsubscribe = lane.subscribe(() => notified++)
  const v0 = lane.getVersion()
  const a = lane.write({ item: 'a', send: api.send('a') })
  assert.equal(lane.busy('a'), true)
  assert.equal(lane.busy('b'), false)
  assert.equal(lane.busy(), true)
  assert.ok(lane.getVersion() > v0)
  api.calls[0]!.answer.resolve('a')
  await a
  assert.equal(lane.busy(), false)
  assert.ok(notified >= 2)
  unsubscribe()
})

// ── The words ───────────────────────────────────────────────────────────────

const HEADLINE = 'Couldn’t add Charizard ex to “Trade binder”.'

test('offline outranks every other explanation', () => {
  assert.equal(failureMessage(HEADLINE, new TypeError('Failed to fetch'), false), `${HEADLINE} You're offline.`)
  assert.equal(failureReason(new ApiLikeError('boom', 500), false), "You're offline.")
})

test('a server error adds nothing the headline did not already say', () => {
  assert.equal(failureMessage(HEADLINE, new ApiLikeError('Internal error', 500), true), HEADLINE)
  assert.equal(failureMessage(HEADLINE, new Error('something odd'), true), HEADLINE)
})

test('a 4xx passes the server’s own explanation through, as a sentence', () => {
  assert.equal(
    failureReason(new ApiLikeError('This is a smart list: its cards come from its rule', 400), true),
    'This is a smart list: its cards come from its rule.',
  )
  assert.equal(failureReason(new ApiLikeError('Name taken.', 409), true), 'Name taken.')
  assert.equal(failureReason(new ApiLikeError('   ', 400), true), null)
})

test('the statuses a person can act on get plain words', () => {
  assert.equal(failureReason(new ApiLikeError('No list', 404), true), 'It may have been deleted.')
  assert.equal(failureReason(new ApiLikeError('slow down', 429), true), 'Too many changes at once. Wait a moment, then try again.')
  assert.equal(failureReason(new ApiLikeError('x', 401), true), 'Your session has expired. Sign in again.')
  assert.equal(failureReason(new DeadlineError(), true), "DeckPal didn't answer in time.")
  assert.equal(failureReason(new TypeError('Load failed'), true), "DeckPal couldn't be reached. Check your connection.")
})
