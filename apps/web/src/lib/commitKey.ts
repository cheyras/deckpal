// THE IDEMPOTENCY KEY FOR A COLLECTION WRITE FROM A LIST OF ROWS (the scanner's
// "Add cards", a pack rip): one key per ATTEMPT, not per content.
//
// It used to be the content alone — `scan-` + the sorted variant x delta lines,
// cut to 200 characters. The server honours a caller's key FOREVER (it is
// UNIQUE per user in `mutation_batch`, with no time window: collection.ts
// /batch, mutations.ts findCommittedBatch), so any later batch with the same
// contents was answered as a replay of the first: nothing written, and the
// scanner said "Added 1 card". One copy of a printing scan-added once could
// never be scan-added again. The 200-character cut made two LONG batches that
// differed only past it collide the same way.
//
// What the key exists for is a retry: the request went out, the answer was
// lost, the reader presses Add again. So it is one random id per attempt plus a
// hash of the lines. The caller keeps the whole planned write (attempt AND
// lines) across a failure whose outcome is unknown and re-sends it exactly,
// whatever the list holds by then (scan/ui/commit.ts PlannedCommit): rebuilding
// it from an edited list would make a new key and could apply the first write
// twice. Once any definite answer comes back the attempt is dropped.

/**
 * True when the server definitely refused a write: nothing was applied, and
 * re-sending it would be refused again. A network failure, a timeout, a 5xx,
 * 409 ("an identical batch is being applied right now") or 429 leave the
 * outcome unknown, and such a write must be re-sent exactly as it was. Duck-
 * typed on `lib/api`'s ApiError so this module stays importable under node.
 */
export function isDefiniteRefusal(e: unknown): boolean {
  const status = (e as { name?: unknown; status?: unknown } | null)?.status
  return (
    (e as { name?: unknown } | null)?.name === 'ApiError' &&
    typeof status === 'number' &&
    status >= 400 &&
    status < 500 &&
    ![408, 409, 429].includes(status)
  )
}

/** A fresh attempt id. Keep it across a retry of a failed write; drop it once one lands. */
export function newCommitAttempt(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID().replace(/-/g, '')
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`
}

/** cyrb53: a fast 53-bit string hash, as 14 hex digits. Not cryptographic; it only separates contents. */
function hash53(s: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0')
}

/**
 * `<prefix>-<attempt>-<content hash>`, always well under the server's 200
 * characters. The content is the folded lines in any order (sorted here), so a
 * retry of the same list is the same key whatever order its rows resolved in.
 */
export function commitIdempotencyKey(
  prefix: string,
  attempt: string,
  items: ReadonlyArray<{ variantId: number; delta: number }>,
): string {
  const content = items
    .map((i) => `${i.variantId}x${i.delta}`)
    .sort()
    .join(',')
  return `${prefix}-${attempt.slice(0, 40)}-${hash53(content)}`
}
