// How often the offline banner's reachability probe asks (owner session
// 2026-11-27). The probe is an uncredentialed `GET /api/me`, so every probe is
// a 401 in a network trace; the scan session showed them repeating on /decks and
// /scan. A window focus — which iOS fires every time the page gets the screen
// back — re-asks only when the last answer is stale or was not "reachable", and
// the re-asks while offline back off.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { FOCUS_RECHECK_MS, offlineRetryDelay, shouldProbeOnFocus } from '../connectivity'

test('a focus right after a reachable answer does not probe again', () => {
  assert.equal(shouldProbeOnFocus({ outcome: 'settled', at: 1_000 }, false, 1_000 + 500), false)
  assert.equal(shouldProbeOnFocus({ outcome: 'settled', at: 1_000 }, false, 1_000 + FOCUS_RECHECK_MS - 1), false)
})

test('a focus after the answer has gone stale does', () => {
  assert.equal(shouldProbeOnFocus({ outcome: 'settled', at: 1_000 }, false, 1_000 + FOCUS_RECHECK_MS), true)
})

test('a focus always re-asks after anything short of reachable', () => {
  assert.equal(shouldProbeOnFocus(null, false, 0), true)
  assert.equal(shouldProbeOnFocus({ outcome: 'errored', at: 1_000 }, false, 1_001), true)
  assert.equal(shouldProbeOnFocus({ outcome: 'timed-out', at: 1_000 }, false, 1_001), true)
})

test('never a second probe while one is in flight', () => {
  assert.equal(shouldProbeOnFocus(null, true, 0), false)
  assert.equal(shouldProbeOnFocus({ outcome: 'errored', at: 0 }, true, 99_999), false)
})

test('offline re-probes back off from the old 5s to a minute', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 9].map((n) => offlineRetryDelay(n)), [5000, 10000, 20000, 40000, 60000, 60000, 60000])
})
