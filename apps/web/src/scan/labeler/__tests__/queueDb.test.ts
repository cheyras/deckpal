// The queue's two invariants after it moved to the server.
//
// ── WHAT CHANGED, AND WHY THE OLD TEST NO LONGER APPLIES ───────────────────
//
// The queue was IndexedDB with `Date.now()` keys, and the test here pinned that
// a hundred same-millisecond inserts did not overwrite each other. The server
// stamps ids now — one clock for every device, which is the only way "the order
// they were shot" means anything when a laptop and a phone fill one queue — so
// that collision is the server's problem and this file no longer simulates it.
//
// What remains local is the OUTBOX: photos taken with no signal, held until
// they can be uploaded. Its ids must never be mistaken for server ids, and must
// still survive a stalled or backward clock.
import { test } from 'node:test'
import assert from 'node:assert/strict'

/** The outbox allocator, extracted exactly as `queueDb.nextLocalId` implements
 *  it: negative, monotonic, and immune to a clock that does not move. */
function makeLocalAllocator() {
  let last = 0
  return (now: number) => {
    last = now > last ? now : last + 1
    return -last
  }
}

test('outbox ids are NEGATIVE, so they can never collide with a server id', () => {
  // The server's are positive epoch milliseconds. The sign is also the routing:
  // `removeQueued` sends negatives to IndexedDB and positives to the API.
  const next = makeLocalAllocator()
  for (const now of [1, 1_700_000_000_000, 1_699_999_000_000]) {
    assert.ok(next(now) < 0, 'an outbox id must be negative')
  }
})

test('outbox ids are unique when the clock does not move', () => {
  // A hundred picked files enter the outbox inside one millisecond if the
  // network is down, and `keyPath: "id"` would silently overwrite all but the
  // last of them.
  const next = makeLocalAllocator()
  const ids = Array.from({ length: 100 }, () => next(1_700_000_000_000))
  assert.equal(new Set(ids).size, 100)
})

test('outbox ids sort BEFORE every uploaded photo', () => {
  // The queue is oldest-first, and a photo that has not uploaded yet is the
  // oldest thing the reader knows about — it was taken before anything the
  // server has finished accepting.
  const next = makeLocalAllocator()
  const local = [next(1_700_000_000_000), next(1_700_000_000_000)]
  const server = [1_700_000_000_001, 1_700_000_000_002]
  const merged = [...local, ...server].sort((a, b) => a - b)
  assert.deepEqual(merged.slice(0, 2).sort((a, b) => a - b), [...local].sort((a, b) => a - b))
  assert.ok(merged[2]! > 0, 'server ids follow the outbox')
})

test('a clock that jumps backward does not reissue an outbox id', () => {
  const next = makeLocalAllocator()
  const a = next(1_700_000_000_000)
  const b = next(1_699_999_000_000) // an hour earlier
  assert.notEqual(a, b)
  assert.ok(b < a, 'ids keep descending, so ordering and uniqueness both hold')
})
