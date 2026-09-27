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

// ── Routing must ASK the store, never infer from the id ────────────────────
//
// The shipped version routed on `id < 0`: negative meant outbox, positive meant
// server. True of every row that version wrote, and false of every row already
// on disk — the previous queue used positive `Date.now()` ids in the SAME
// database, store and version. Upgrading mid-session therefore produced a queue
// of local photos whose ids claimed to be the server's: every one rendered
// `unreadable`, and deleting one deleted nothing.
//
// A source assertion because the failure is a whole-module behaviour against a
// database written by code that no longer exists; there is no seam where a unit
// test could observe it.
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const QUEUE_SRC = fs.readFileSync(fileURLToPath(new URL('../queueDb.ts', import.meta.url)), 'utf8')
const SERVER_SRC = fs.readFileSync(fileURLToPath(new URL('../../../../../api/src/dev/scanQueue.ts', import.meta.url)), 'utf8')
const LABELER_SRC = fs.readFileSync(fileURLToPath(new URL('../QuadLabeler.tsx', import.meta.url)), 'utf8')

test('the outbox is consulted by lookup, not by the sign of the id', () => {
  assert.match(QUEUE_SRC, /async function inOutbox\(/, 'a lookup helper must exist')
  assert.match(QUEUE_SRC, /const local = await inOutbox\(id\)/, 'queuedPhotoBlob must look the id up')
  assert.match(QUEUE_SRC, /if \(await inOutbox\(id\)\)/, 'removeQueued must look the id up')
  assert.doesNotMatch(QUEUE_SRC, /if \(id < 0\)/, 'routing on the sign is the bug — it cannot come back')
})

test('every upload is normalized to one format before it goes out', () => {
  // Mislabelled objects (the route stores everything as .jpg regardless), HEIC
  // that no browser will decode back, and 12 MP frames the body parser refuses
  // are one problem with one fix.
  assert.match(QUEUE_SRC, /async function normalizeForUpload\(/, 'the normalizer must exist')
  const calls = QUEUE_SRC.match(/normalizeForUpload\(/g) ?? []
  assert.ok(calls.length >= 3, 'both enqueue and flushOutbox must normalize, not just one of them')
})

test('the normalizer decodes EXIF-aware, or it bakes in the wrong rotation', () => {
  // Re-encoding through a canvas STRIPS EXIF. A phone photo carries its
  // rotation there rather than in its pixels, so decoding without applying it
  // first lands every portrait photo permanently sideways in the corpus.
  assert.match(QUEUE_SRC, /decodeForCanvas/, 'normalization must reuse the EXIF-aware decode')
})

// ── One bad photo must not hold the rest hostage ───────────────────────────
//
// The flush used to `break` on the first failure, reasoning that a dead network
// should not be hammered with the rest of the batch. That reasoning only holds
// when failures are about the NETWORK. An undecodable HEIC fails every time,
// forever — and one at the head of the queue held thirty-one other photos
// hostage, including two this browser could read perfectly well. Measured on
// the owner's own queue: 32 items, 30 HEIC, zero uploaded.

test('a per-item failure skips that item and the loop continues', () => {
  assert.doesNotMatch(
    QUEUE_SRC,
    /error = e instanceof Error \? e\.message : 'the upload was refused'\s*\n\s*break/,
    'an unconditional break on the first failure is the bug — one bad photo blocks the queue',
  )
  assert.match(QUEUE_SRC, /failed \+= 1/, 'failures must be counted, not just stopped on')
  assert.match(QUEUE_SRC, /if \(looksOffline\(\)\)/, 'only a genuine outage may short-circuit the run')
})

test('an undecodable photo is REFUSED, never uploaded as-is', () => {
  // The route stores everything as image/jpeg. Uploading bytes that failed to
  // decode manufactures a server row as broken as the local one — the previous
  // "fall back to the original blob" path did exactly that.
  assert.match(QUEUE_SRC, /throw new Error\(\s*`this photo could not be decoded/, 'decode failure must throw')
  assert.doesNotMatch(
    QUEUE_SRC,
    /async function normalizeForUpload[\s\S]*?\n  \} catch \{\n    return blob\n  \}/,
    'normalizeForUpload must not fall back to the undecodable original',
  )
})

test('an older server HEIC is replaced before its original is deleted', () => {
  assert.match(QUEUE_SRC, /if \(!\(await isHeic\(blob\)\)\) return blob/)
  const post = QUEUE_SRC.indexOf('await api.scanQueueAdd({', QUEUE_SRC.indexOf('const repairs ='))
  const cleanup = QUEUE_SRC.indexOf('await cleanupOriginal(id)', post)
  assert.ok(post > 0 && cleanup > post, 'repair must POST the JPEG before DELETE of the HEIC')
  assert.match(QUEUE_SRC, /replacementIds\.set\(id, added\.id\)/)
  assert.match(QUEUE_SRC, /const original = \[\.\.\.replacementIds\]\.find/)
  assert.match(QUEUE_SRC, /if \(replacement\) await api\.scanQueueDelete\(replacement\)[\s\S]*?await api\.scanQueueDelete\(original\)/,
    'finishing either an old row or its replacement must retire both objects')
  assert.match(QUEUE_SRC, /const newerReplacement = replacementIds\.get\(id\)/,
    'an overlapping fetch must recheck whether another read already repaired the original')
  assert.match(QUEUE_SRC, /removedIds\.add\(original\)[\s\S]*?await repairs\.get\(original\)/,
    'discard must wait for an in-flight repair')
  assert.match(QUEUE_SRC, /pendingCleanups\.set\(id, added\.id\)/,
    'a failed original deletion must remain available for a later retry')
})

test('a temporary storage failure is not reported as a missing photo', () => {
  assert.match(SERVER_SRC, /upstream\.status === 404 \|\| upstream\.status === 400/)
  assert.match(SERVER_SRC, /new ApiError\(502, 'queue_storage_unavailable'/)
})

test('the server refuses HEIC bytes disguised as JPEG', () => {
  assert.match(SERVER_SRC, /bytes\[0\] !== 0xff \|\| bytes\[1\] !== 0xd8 \|\| bytes\[2\] !== 0xff/)
})

test('a genuinely missing server photo leaves the grid with a useful message', () => {
  assert.match(LABELER_SRC, /e instanceof ApiError && e\.status === 404/)
  assert.match(LABELER_SRC, /items\.filter\(\(photo\) => photo\.id !== item\.id\)/)
  assert.match(LABELER_SRC, /may have been labeled on another device/)
})

test('the upload budget is sized under the limit that actually bites', () => {
  // Vercel rejects a function request body over 4.5 MB BEFORE the handler runs.
  // The body is base64, so the decoded budget is three quarters of that, less
  // the JSON wrapper. Caps above it (12 MB, then 8 MB) could never fire.
  const m = /const MAX_UPLOAD_BYTES = (\d+) \* 1024 \* 1024/.exec(QUEUE_SRC)
  assert.ok(m, 'the client must declare an upload budget')
  const decodedMb = Number(m[1])
  const wireMb = (decodedMb * 4) / 3
  assert.ok(wireMb < 4.5, `${decodedMb} MB decoded is ${wireMb.toFixed(1)} MB on the wire — over Vercel's 4.5 MB cap`)
})

test('the normalizer steps down until it fits, rather than giving up at one size', () => {
  assert.match(QUEUE_SRC, /UPLOAD_LADDER/, 'a single quality/size attempt cannot guarantee the budget')
  assert.match(QUEUE_SRC, /if \(out\.size <= MAX_UPLOAD_BYTES\) break/, 'the ladder must stop at the first fit')
})
