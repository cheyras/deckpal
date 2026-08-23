/**
 * The pause that turns a sequence of steps into a walk.
 *
 * ── WHAT THIS CAN AND CANNOT REACH ───────────────────────────────────────────
 *
 * `runJourney` itself needs a DOM — `waitForLandmark`, `visibleLandmark` and
 * `resolveTarget` all query `document` — and there is no jsdom in this suite, so
 * the runner has never had a test and does not get one here. What IS reachable
 * is the part that can hang the walk forever and the part that decides how long
 * to hold, plus a source pin on the two properties of the wiring that a reader
 * would otherwise have to take on trust.
 *
 * That limit is stated rather than papered over: passing this file does NOT
 * prove a journey paces correctly in a browser. Gate 22 is the authority.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { LOOK_BEAT_MS, LOOK_BEAT_REDUCED_MS, WORTH_A_LOOK, dwell, lookBeatMs } from '../journey'

const SRC = readFileSync(fileURLToPath(new URL('../journey.ts', import.meta.url)), 'utf8')

/** Swap `window` for the duration of one check, and always put it back. */
function withMatchMedia<T>(impl: unknown, fn: () => T): T {
  const had = 'window' in globalThis
  const prev = (globalThis as { window?: unknown }).window
  ;(globalThis as { window?: unknown }).window = impl
  try {
    return fn()
  } finally {
    if (had) (globalThis as { window?: unknown }).window = prev
    else delete (globalThis as { window?: unknown }).window
  }
}

test('a beat actually elapses', async () => {
  const started = Date.now()
  await dwell(40, new AbortController().signal)
  assert.ok(Date.now() - started >= 35, 'dwell returned without waiting')
})

test('aborting mid-beat stops the hold instead of stranding the walk', async () => {
  // A dwell that ignored its signal would leave the character frozen partway
  // through an escort the person had already cancelled, with the runner's own
  // cancellation checks unreachable behind an un-resolved promise.
  const ac = new AbortController()
  const started = Date.now()
  const held = dwell(5_000, ac.signal)
  setTimeout(() => ac.abort(), 20)
  await held
  assert.ok(Date.now() - started < 1_000, 'the beat outlived its cancellation')
})

test('a signal already aborted is not waited on at all', async () => {
  const ac = new AbortController()
  ac.abort()
  const started = Date.now()
  await dwell(5_000, ac.signal)
  assert.ok(Date.now() - started < 100)
})

test('reduced motion shortens the beat, and does NOT remove it', () => {
  // X1's shape: the flight is gone under `reduce`, so there is no travel to wait
  // out — but the ring still has to be READ, and zero would make the walk
  // hardest to follow for the person who asked for less movement.
  const reduced = withMatchMedia({ matchMedia: () => ({ matches: true }) }, lookBeatMs)
  const normal = withMatchMedia({ matchMedia: () => ({ matches: false }) }, lookBeatMs)
  assert.equal(reduced, LOOK_BEAT_REDUCED_MS)
  assert.equal(normal, LOOK_BEAT_MS)
  assert.ok(reduced > 0, 'reduced motion removed the beat entirely')
  assert.ok(reduced < normal)
})

test('a missing or throwing matchMedia falls back to the LONGER beat', () => {
  // Embedded webviews and this very test runner have no `matchMedia`. Erring
  // toward the long beat costs a second; erring toward zero costs the arc.
  assert.equal(withMatchMedia(undefined, lookBeatMs), LOOK_BEAT_MS)
  assert.equal(
    withMatchMedia({ matchMedia: () => { throw new Error('nope') } }, lookBeatMs),
    LOOK_BEAT_MS,
  )
})

test('only the verbs whose point is to be LOOKED at earn a beat', () => {
  // `goTo`, `ensure`, `say` and `click` all already wait on something real — a
  // route commit, a landmark, a press. Holding after those would be dead time.
  assert.deepEqual([...WORTH_A_LOOK].sort(), ['flyTo', 'highlight'])
})

test('the runner holds for those verbs, and never after the last step', () => {
  // A SOURCE PIN, not a behaviour test — see the header. It exists because the
  // "never after the last step" half has no user-visible symptom when wrong: it
  // would simply add a second of stillness to the end of every walk, which reads
  // as sluggishness rather than as a bug, and nothing else would catch it.
  assert.match(
    SRC,
    /WORTH_A_LOOK\.has\(s\.verb\)\s*&&\s*i\s*<\s*steps\.length\s*-\s*1/,
    'the runner no longer gates its beat on a look verb and a following step',
  )
  assert.match(SRC, /await dwell\(lookBeatMs\(\), signal\)/, 'the beat is not awaited')
})
