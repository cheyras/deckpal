// The pending-photo queue, in IndexedDB.
//
// ── WHY IT HAD TO LEAVE MEMORY (owner request, 2026-09-08) ─────────────────
//
// The upload queue was a `useRef<File[]>` inside `QuadLabeler`. That was right
// for what it was built for — one picker interaction, worked through in one
// sitting — and wrong for what was asked for next: *"take a bunch of photos one
// after another and they all end up in a persistent queue… pull each image in
// the queue at my leisure"*. At leisure means across a reload, a backgrounded
// tab, a phone that slept, and a session that ends and resumes. A ref survives
// none of those, and the failure is silent and total: the photos are simply
// gone, and they were photos of physical cards that may not still be on the
// desk.
//
// ── WHY IndexedDB AND NOT localStorage ─────────────────────────────────────
//
// The queue holds IMAGE BYTES. `localStorage` stores strings, so a photo would
// have to be base64'd — a third larger, synchronous on the main thread, and
// against a quota (~5 MB in most browsers) that a single phone photo can
// exceed on its own. IndexedDB stores `Blob`s natively, asynchronously, under a
// quota measured in hundreds of megabytes or more. A `File` IS a `Blob`, so an
// upload is stored as its own original bytes with no re-encode at all.
//
// This is the app's only IndexedDB user. It is deliberately ~200 lines of the
// raw API rather than a dependency: one store, five operations, no migrations
// beyond the first version, and `apps/web` carrying a wrapper library for that
// would be more code shipped than saved.
//
// ── WHAT IS NOT STORED, AND WHY ────────────────────────────────────────────
//
// Not the crop, not the quad, not the tags. A queued item is a photo that has
// not been worked yet; the moment it IS worked it becomes a label and goes to
// the server through the existing path (`saveLabel.ts`). Keeping half-finished
// annotations here would create a second source of truth for a row's contents
// and a merge problem the moment the same photo were opened twice.

/** One photo waiting to be labelled. */
export interface QueuedPhoto {
  /** Monotonic within a device: `Date.now()` at enqueue, plus a disambiguator
   *  for the mass-upload case, where a hundred files are added in the same
   *  millisecond. Also the display order — this is a FIFO the reader works
   *  through, and the order they arrived is the order they were shot. */
  id: number
  /** The image's own bytes. For an upload this is the picked `File` unchanged
   *  — original resolution, original EXIF — so the crop step later has every
   *  pixel the camera recorded. */
  blob: Blob
  /** Filename for an upload, or a generated one for a camera frame. Shown in
   *  the queue list so a reader can tell two photos of the same card apart. */
  name: string
  /** Where it came from. Becomes the label's `source`, so a row's provenance
   *  survives the queue rather than being re-guessed at label time. */
  source: 'camera' | 'upload'
  addedAt: number
}

const DB_NAME = 'deckpal-labeler'
const DB_VERSION = 1
const STORE = 'queue'

let dbPromise: Promise<IDBDatabase> | null = null

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        // `id` is the key AND the sort order, so a cursor over the store is
        // already the queue in the order the photos were taken. No index.
        db.createObjectStore(STORE, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('could not open the labeler queue'))
    // A second tab holding an older version open would block the upgrade
    // forever with no error. There is only one version today, so this can only
    // fire on a future migration — but a silent hang is the worst possible
    // failure for a queue whose whole promise is "your photos are still here".
    req.onblocked = () => reject(new Error('another tab is holding the labeler queue open — close it and reload'))
  })
  // A failed open must not be cached: the next call should try again rather
  // than inherit a rejection forever (a denied storage permission can be
  // granted, and a blocked upgrade resolves when the other tab closes).
  dbPromise.catch(() => {
    dbPromise = null
  })
  return dbPromise
}

function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode)
        const req = fn(tx.objectStore(STORE))
        req.onsuccess = () => resolve(req.result)
        // Both are wired: a request can fail on its own (a constraint), and a
        // transaction can abort under the request's radar (quota exceeded mid
        // -write is the one that matters here, and it surfaces on the tx).
        req.onerror = () => reject(req.error ?? new Error('the labeler queue rejected that operation'))
        tx.onabort = () => reject(tx.error ?? new Error('the labeler queue transaction was aborted'))
      }),
  )
}

/** Is IndexedDB usable at all? Private-mode Firefox and a few locked-down
 *  configurations expose the object and throw on use, so callers degrade to an
 *  in-memory session rather than presenting a queue that silently forgets. */
export function queueSupported(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null
  } catch {
    return false
  }
}

let lastId = 0

/** Ids are `Date.now()`, nudged forward when the clock has not moved — a mass
 *  upload adds a hundred files inside one millisecond, and `keyPath: 'id'`
 *  would silently overwrite all but the last of them. */
function nextId(): number {
  const now = Date.now()
  lastId = now > lastId ? now : lastId + 1
  return lastId
}

export async function enqueue(items: Array<Omit<QueuedPhoto, 'id' | 'addedAt'>>): Promise<QueuedPhoto[]> {
  const added: QueuedPhoto[] = items.map((it) => ({ ...it, id: nextId(), addedAt: Date.now() }))
  const db = await open()
  await new Promise<void>((resolve, reject) => {
    // ONE transaction for the whole batch. A hundred separate transactions is a
    // hundred round trips through the event loop, and — worse — a partially
    // committed batch if the quota runs out halfway. This way the mass upload
    // either lands or does not.
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    for (const rec of added) store.put(rec)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('could not save to the labeler queue'))
    tx.onabort = () =>
      reject(
        tx.error?.name === 'QuotaExceededError'
          ? new Error('this device is out of storage for the queue — label or clear some photos first')
          : (tx.error ?? new Error('the labeler queue refused the batch')),
      )
  })
  return added
}

/** Everything waiting, oldest first — the order they were shot, which is the
 *  order a reader works a stack of cards in. */
export async function listQueue(): Promise<QueuedPhoto[]> {
  const all = await run<QueuedPhoto[]>('readonly', (s) => s.getAll() as IDBRequest<QueuedPhoto[]>)
  return all.sort((a, b) => a.id - b.id)
}

export async function removeQueued(id: number): Promise<void> {
  await run('readwrite', (s) => s.delete(id))
}

export async function clearQueue(): Promise<void> {
  await run('readwrite', (s) => s.clear())
}

/**
 * Bytes held, and what the browser will allow.
 *
 * Reported rather than enforced. The queue's own limit is the device's, the
 * numbers are estimates by specification, and a hard cap invented here would
 * either stop a reader who had room or fail to stop one who did not — so the
 * honest thing is to show the figure and let the quota error (which `enqueue`
 * translates) be the actual boundary.
 */
export async function queueUsage(): Promise<{ bytes: number; quota: number | null }> {
  const items = await listQueue()
  const bytes = items.reduce((n, i) => n + i.blob.size, 0)
  let quota: number | null = null
  try {
    const est = await navigator.storage?.estimate?.()
    quota = typeof est?.quota === 'number' ? est.quota : null
  } catch {
    // `storage.estimate` is absent or blocked — the byte count still means
    // something on its own.
  }
  return { bytes, quota }
}
