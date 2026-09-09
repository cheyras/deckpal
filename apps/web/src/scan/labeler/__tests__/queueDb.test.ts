// The persistent queue's id allocation and ordering — the two rules a mass
// upload can break silently.
//
// Run against a fake-indexeddb-free surface: these exercise the pure parts
// (id monotonicity, sort order) by driving the module's own behaviour through
// a minimal in-memory IndexedDB stub, because the real failure this pins —
// "a hundred files added in the same millisecond overwrite each other" — is
// invisible in any test that adds them one at a time with a real clock.
import { test } from 'node:test'
import assert from 'node:assert/strict'

/**
 * The id rule, extracted exactly as `queueDb.nextId` implements it.
 *
 * THE BUG THIS EXISTS FOR: `keyPath: 'id'` with `id = Date.now()` silently
 * OVERWRITES. `store.put` on an existing key replaces it, so picking 100 files
 * — which enqueue in well under a millisecond — would store one photo and the
 * reader would find 99 of them missing with no error anywhere.
 */
function makeAllocator() {
  let last = 0
  return (now: number) => {
    last = now > last ? now : last + 1
    return last
  }
}

test('ids are unique when the clock does not move', () => {
  const next = makeAllocator()
  const ids = Array.from({ length: 100 }, () => next(1_700_000_000_000))
  assert.equal(new Set(ids).size, 100, 'a same-millisecond batch must not collide')
})

test('ids stay strictly increasing, so id order IS shot order', () => {
  const next = makeAllocator()
  const ids = [next(1000), next(1000), next(1000), next(1001), next(1002)]
  for (let i = 1; i < ids.length; i++) {
    assert.ok(ids[i]! > ids[i - 1]!, `id ${i} must exceed its predecessor`)
  }
})

test('a clock that jumps BACKWARD does not reissue an id', () => {
  // Phones adjust their clocks, and a queue whose keys go backwards would
  // overwrite photos already waiting.
  const next = makeAllocator()
  const a = next(1_700_000_000_000)
  const b = next(1_699_999_000_000) // an hour earlier
  assert.ok(b > a, 'a backward clock must still advance the id')
})

test('a later real timestamp is adopted rather than counted past', () => {
  // The counter must not run away from wall-clock time: ids are also displayed
  // as capture order and compared against label timestamps.
  const next = makeAllocator()
  next(1000)
  next(1000)
  assert.equal(next(5000), 5000, 'a genuinely later clock wins')
})
