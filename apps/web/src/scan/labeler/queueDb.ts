// The pending-photo queue — SERVER-BACKED, with a local outbox for uploads that
// have not landed yet.
//
// ── WHY IT MOVED OFF THE DEVICE (owner report, 2026-09-10) ─────────────────
//
// *"I added a whole bunch of images in the quad labeler on my macbook. They're
// in the queue there, but they are NOT in the queue when I bring it up on
// mobile."*
//
// This file used to be IndexedDB and nothing else. That was a real reading of
// "persistent" — the queue survived a reload, a backgrounded tab, a phone that
// slept, the end of a session — and it was the wrong one for the workflow the
// request described: photograph a stack on whatever camera is to hand, label it
// wherever you happen to be sitting. IndexedDB is per-origin PER DEVICE, so the
// queue could only ever be worked on the machine that filled it, which is the
// constraint the feature existed to remove. The cross-device reading was never
// flagged as a choice; it should have been.
//
// The queue is now `POST/GET/DELETE /dev/scan-queue` (see
// `apps/api/src/dev/scanQueue.ts`), which puts pending photos in the object
// store beside the labels they become — reachable from any device that may open
// the labeler at all.
//
// ── WHAT INDEXEDDB IS STILL FOR ────────────────────────────────────────────
//
// An OUTBOX, and only that. A shutter press must not fail because the network
// did; a photo taken in a shop with no signal is exactly the photo worth
// keeping. So a failed upload is stored locally and retried, and the queue the
// reader sees is the server's list plus whatever is still waiting to reach it.
// This is the same shape as the label retry queue in `QuadLabeler` and for the
// same reason.
//
// Nothing here holds a finished annotation. A queued photo has no verdict, no
// crop and no quad; the moment it acquires them it becomes a label, goes out
// through `saveLabel.ts`, and is deleted from the queue.
import { api } from '../../lib/api'

/** One photo waiting to be labelled, as the queue reports it. */
export interface QueuedPhoto {
  /** The SERVER's clock at upload. Two devices filling one queue cannot agree
   *  on a millisecond, and the id is also the sort order — "the order they were
   *  shot" only means anything if one clock stamps it. Negative for an item
   *  still in the outbox: see `pending`. */
  id: number
  name: string
  source: 'camera' | 'upload'
  addedAt: string
  size: number
  /** True while this photo is still local — uploaded on the next flush. It
   *  shows in the queue immediately regardless, because a photo the reader has
   *  taken exists whether or not the network agrees yet. */
  pending: boolean
}

// ── the outbox ─────────────────────────────────────────────────────────────

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
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('could not open the labeler outbox'))
    req.onblocked = () => reject(new Error('another tab is holding the labeler outbox open — close it and reload'))
  })
  dbPromise.catch(() => {
    dbPromise = null
  })
  return dbPromise
}

interface OutboxItem {
  id: number
  blob: Blob
  name: string
  source: 'camera' | 'upload'
  addedAt: number
}

function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode)
        const req = fn(tx.objectStore(STORE))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error ?? new Error('the labeler outbox rejected that operation'))
        tx.onabort = () => reject(tx.error ?? new Error('the labeler outbox transaction was aborted'))
      }),
  )
}

export function queueSupported(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null
  } catch {
    return false
  }
}

let lastLocalId = 0

/**
 * Outbox ids are NEGATIVE, and that is load-bearing rather than cute: the
 * server's ids are positive epoch milliseconds, so a negative id can never
 * collide with one, sorts before every uploaded photo (oldest-first is the
 * queue's order and an un-uploaded photo is the oldest thing the reader knows
 * about), and tells every caller at a glance which side of the wire an item is
 * on. They still step past a stalled clock — a mass upload writes a hundred
 * items inside one millisecond and `keyPath: 'id'` would silently overwrite all
 * but the last.
 */
function nextLocalId(): number {
  const now = Date.now()
  lastLocalId = now > lastLocalId ? now : lastLocalId + 1
  return -lastLocalId
}

async function outbox(): Promise<OutboxItem[]> {
  if (!queueSupported()) return []
  try {
    const all = await run<OutboxItem[]>('readonly', (s) => s.getAll() as IDBRequest<OutboxItem[]>)
    return all.sort((a, b) => a.addedAt - b.addedAt)
  } catch {
    return []
  }
}

async function stash(items: OutboxItem[]): Promise<void> {
  const db = await open()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    for (const rec of items) store.put(rec)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('could not hold those photos locally'))
    tx.onabort = () =>
      reject(
        tx.error?.name === 'QuotaExceededError'
          ? new Error('this device is out of storage for photos waiting to upload')
          : (tx.error ?? new Error('the outbox refused the batch')),
      )
  })
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const s = String(reader.result || '')
      const i = s.indexOf(',')
      resolve(i >= 0 ? s.slice(i + 1) : s)
    }
    reader.onerror = () => reject(reader.error ?? new Error('could not read that photo'))
    reader.readAsDataURL(blob)
  })
}

// ── the queue ──────────────────────────────────────────────────────────────

/**
 * Add photos. Each is uploaded immediately; one that fails goes to the outbox
 * and is retried by `flushOutbox`.
 *
 * Sequential on purpose. A hundred-file pick uploading in parallel is a hundred
 * simultaneous multi-megabyte POSTs, which on a phone is how you discover the
 * connection's real limit — and the queue is ordered, so finishing them in
 * order is also what makes the server's ids match the order they were picked.
 */
export async function enqueue(
  items: Array<{ blob: Blob; name: string; source: 'camera' | 'upload' }>,
): Promise<{ uploaded: number; held: number }> {
  let uploaded = 0
  const held: OutboxItem[] = []
  for (const it of items) {
    try {
      const jpg = await blobToBase64(it.blob)
      await api.scanQueueAdd({ jpg, name: it.name, source: it.source })
      uploaded += 1
    } catch {
      held.push({ id: nextLocalId(), blob: it.blob, name: it.name, source: it.source, addedAt: Date.now() })
    }
  }
  if (held.length) await stash(held)
  return { uploaded, held: held.length }
}

/** Push whatever is in the outbox. Returns how many landed. */
export async function flushOutbox(): Promise<number> {
  const items = await outbox()
  let sent = 0
  for (const it of items) {
    try {
      const jpg = await blobToBase64(it.blob)
      await api.scanQueueAdd({ jpg, name: it.name, source: it.source })
      await run('readwrite', (s) => s.delete(it.id))
      sent += 1
    } catch {
      // Still down. Stop at the first failure rather than hammering a dead
      // network with the rest of the batch; the next flush picks up here.
      break
    }
  }
  return sent
}

/**
 * Everything waiting, oldest first — the server's list, with anything still in
 * the outbox ahead of it.
 *
 * Outbox items sort first because their ids are negative, which is the same
 * thing as "taken before anything that has finished uploading".
 */
export async function listQueue(): Promise<QueuedPhoto[]> {
  const [local, remote] = await Promise.all([
    outbox(),
    api
      .scanQueueList()
      .then((r) => r.photos)
      .catch(() => {
        // Offline, or the gate refused. The outbox is still real and still the
        // reader's work; showing it beats showing an empty queue.
        return [] as Array<{ id: number; name: string; source: 'camera' | 'upload'; addedAt: string; size: number }>
      }),
  ])
  return [
    ...local.map((it) => ({
      id: it.id,
      name: it.name,
      source: it.source,
      addedAt: new Date(it.addedAt).toISOString(),
      size: it.blob.size,
      pending: true,
    })),
    ...remote.map((p) => ({ ...p, pending: false })),
  ]
}

/** Remove one — labelled, or discarded. Local ids hit the outbox; server ids
 *  hit the API. The sign of the id is the routing. */
export async function removeQueued(id: number): Promise<void> {
  if (id < 0) {
    await run('readwrite', (s) => s.delete(id))
    return
  }
  await api.scanQueueDelete(id)
}

export async function clearQueue(): Promise<void> {
  const items = await listQueue()
  // Sequential, and failures do not stop the rest: "clear" should clear as much
  // as it can rather than abandoning the job over one stubborn row.
  for (const it of items) {
    await removeQueued(it.id).catch(() => {})
  }
}

/**
 * Bytes the queue is holding, and the device's own quota where the browser will
 * say. The quota only bounds the OUTBOX now — the server's share is not this
 * device's problem — so it is reported beside the local figure rather than as
 * a limit on the whole queue.
 */
export async function queueUsage(): Promise<{ bytes: number; localBytes: number; quota: number | null }> {
  const items = await listQueue()
  const bytes = items.reduce((n, i) => n + i.size, 0)
  const localBytes = items.filter((i) => i.pending).reduce((n, i) => n + i.size, 0)
  let quota: number | null = null
  try {
    const est = await navigator.storage?.estimate?.()
    quota = typeof est?.quota === 'number' ? est.quota : null
  } catch {
    // Absent or blocked; the byte counts still mean something on their own.
  }
  return { bytes, localBytes, quota }
}

/** One queued photo's bytes. A local item already has them; a server one is
 *  fetched through the authenticated client — an `<img src>` cannot carry a
 *  bearer token, which is the lesson the harvest thumbnails taught. */
export async function queuedPhotoBlob(id: number, signal?: AbortSignal): Promise<Blob> {
  if (id < 0) {
    const it = (await outbox()).find((o) => o.id === id)
    if (!it) throw new Error('that photo is no longer in the outbox')
    return it.blob
  }
  return api.scanQueueBlob(id, signal)
}
