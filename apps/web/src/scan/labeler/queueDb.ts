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
import { api, ApiError } from '../../lib/api'
import { decodeQueueImage, HeicDecoderLoadError, isHeic } from './heic'

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
  /** A photo that cannot be converted or uploaded, even after reconnecting. */
  failureReason?: string
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
  failureReason?: string
}

class PermanentUploadError extends Error {}

function isPermanentUploadError(error: unknown): boolean {
  return error instanceof PermanentUploadError ||
    (error instanceof ApiError && [400, 413, 415, 422].includes(error.status))
}

async function isJxl(blob: Blob, name: string): Promise<boolean> {
  if (/\.jxl$/i.test(name) || blob.type === 'image/jxl') return true
  const head = new Uint8Array(await blob.slice(0, 12).arrayBuffer())
  return (head[0] === 0xff && head[1] === 0x0a) ||
    [0, 0, 0, 12, 74, 88, 76, 32, 13, 10, 135, 10].every((byte, i) => head[i] === byte)
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

/** A discard can finish while a retry is decoding. Read and update in one
 * transaction so that late failure cannot recreate the deleted photo. */
async function markPermanentIfPresent(id: number, failureReason: string): Promise<void> {
  const db = await open()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    const get = store.get(id) as IDBRequest<OutboxItem | undefined>
    get.onsuccess = () => {
      if (get.result) store.put({ ...get.result, failureReason })
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('could not update the photo in the outbox'))
    tx.onabort = () => reject(tx.error ?? new Error('the outbox update was aborted'))
  })
}

/**
 * The longest edge an uploaded photo keeps.
 *
 * `workingFrame.MAX_REFERENCE_SIZE` is 1600: the editor's sharp canvas — the
 * thing the reader zooms into and the loupe samples — is capped there whatever
 * the source resolution. 2048 leaves every pixel that cap can use, with room
 * for a crop that takes less than the whole frame. The original 12 MP frame was
 * never reaching the editor; it was only ever making the upload fail.
 */
const MAX_UPLOAD_EDGE = 2048

/** JPEG quality to try first. Matches the rapid shutter's own 0.92. */
const UPLOAD_QUALITY = 0.92

/**
 * The decoded size an upload has to fit under.
 *
 * ── THE CEILING I MISSED, TWICE, IN A REPO THAT DOCUMENTS IT ───────────────
 *
 * **Vercel rejects a serverless function's request body over 4.5 MB before the
 * handler runs.** `scan/router.ts` says so and sizes itself at 4 MB;
 * `ui/uploadNormalize.ts` says so in its first paragraph; DECISIONS records it
 * three times. This queue route shipped with a 12 MB cap, then an 8 MB one —
 * both above a limit the platform enforces first, so neither could ever be the
 * thing that refused a photo, and the refusal that did happen arrived as a
 * platform error about nothing in particular.
 *
 * The body is base64, so the DECODED budget is three quarters of the wire
 * budget, less the JSON wrapper. 3 MB is the same number `dev-flags` already
 * uses and leaves comfortable headroom.
 */
const MAX_UPLOAD_BYTES = 3 * 1024 * 1024

/** Successively smaller attempts, tried in order until one fits the budget. A
 *  card only has to be legible enough to place four corners on; 1280 px still
 *  puts a card's short edge near 900 px, which is more than the 416 px
 *  canonical frame will ever use. */
const UPLOAD_LADDER: Array<{ edge: number; quality: number }> = [
  { edge: MAX_UPLOAD_EDGE, quality: UPLOAD_QUALITY },
  { edge: MAX_UPLOAD_EDGE, quality: 0.8 },
  { edge: 1600, quality: 0.8 },
  { edge: 1280, quality: 0.75 },
]

/**
 * Normalize a picked photo to ONE format before it is uploaded: upright JPEG,
 * no EXIF, at most `MAX_UPLOAD_EDGE` on its long side.
 *
 * ── THREE THINGS THIS FIXES, AND THEY ARE THE SAME THING ───────────────────
 *
 * **1. The stored object was mislabelled.** `dev/scanQueue.ts` writes every
 * upload as `<id>.jpg` with `content-type: image/jpeg`, unconditionally. A PNG
 * was stored under a lie, and an iPhone HEIC was stored under a lie that most
 * browsers then refuse to decode at all — so the photo came back unreadable
 * from the server as well as from the outbox.
 *
 * **2. Large photos never uploaded, silently.** The body is base64, 33% larger
 * than the bytes, behind `express.json({ limit: '12mb' })` — so a 10 MB phone
 * photo becomes a 13.3 MB body and the PARSER rejects it before the route's own
 * size check can say anything useful. `enqueue` caught that, held the photo and
 * said nothing, which is how a queue of `local` rows that would never upload
 * came to look like a queue that was merely waiting for signal.
 *
 * **3. EXIF ORIENTATION, which is the trap in fixing 1 and 2.** Re-encoding
 * through a canvas STRIPS EXIF. A phone photo carries its rotation there rather
 * than in its pixels, so a naive re-encode bakes in the unrotated pixels and
 * throws away the flag that said which way was up — every portrait photo lands
 * sideways, permanently, in the corpus. `decodeForCanvas` is the project's
 * EXIF-aware decode (`createImageBitmap(file, {imageOrientation: 'from-image'})`)
 * and is reused here precisely so the rotation is APPLIED before it is lost.
 *
 * An undecodable photo stays in the local outbox. Uploading its original bytes
 * would label them JPEG without making them readable.
 */
async function normalizeForUpload(blob: Blob, name = 'queued'): Promise<Blob> {
  if (await isJxl(blob, name)) {
    throw new PermanentUploadError("JPEG XL isn't supported yet — export as JPEG or HEIC")
  }
  // THROWS RATHER THAN FALLING BACK. The previous version returned the original
  // bytes when it could not decode them, which manufactured broken rows: the
  // route stores everything as `image/jpeg`, so an undecodable HEIC went up
  // labelled as a JPEG and came back just as unreadable from the server as it
  // had been locally. If even the HEIC decoder cannot read the picture, no
  // upload of it can be correct, and saying so is the useful thing to do.
  const src = await decodeQueueImage(blob, name).catch((error: unknown) => {
    if (error instanceof HeicDecoderLoadError) throw error
    throw new PermanentUploadError(
      `this photo could not be decoded (${name}). Try exporting it as JPEG.`,
    )
  })
  const w = 'width' in src ? src.width : 0
  const h = 'height' in src ? src.height : 0
  if (!w || !h) throw new PermanentUploadError('that file decoded to an empty image')

  try {
    let best: Blob | null = null
    for (const { edge, quality } of UPLOAD_LADDER) {
      const scale = Math.min(1, edge / Math.max(w, h))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(w * scale))
      canvas.height = Math.max(1, Math.round(h * scale))
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new PermanentUploadError('this browser could not prepare the photo')
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(src as CanvasImageSource, 0, 0, canvas.width, canvas.height)
      const out = await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', quality))
      if (out) {
        best = out
        if (out.size <= MAX_UPLOAD_BYTES) break
      }
    }
    if (!best) throw new PermanentUploadError('this browser could not re-encode that photo')
    if (best.size > MAX_UPLOAD_BYTES) {
      throw new PermanentUploadError(
        `this photo is still ${(best.size / 1024 / 1024).toFixed(1)} MB after downscaling — over the ` +
          `${MAX_UPLOAD_BYTES / 1024 / 1024} MB upload limit`,
      )
    }
    return best
  } catch (error) {
    if (error instanceof PermanentUploadError) throw error
    throw new PermanentUploadError('this browser could not prepare the photo')
  } finally {
    ;(src as { close?: () => void }).close?.()
  }
}

/** Is the browser telling us the network is gone? `navigator.onLine` is only
 *  trustworthy in the negative direction — `false` really does mean no
 *  connection — which is exactly the direction this needs. */
function looksOffline(): boolean {
  try {
    return typeof navigator !== 'undefined' && navigator.onLine === false
  } catch {
    return false
  }
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
/** The stored object IS a jpg (see dev/scanQueue.ts), so the displayed name
 *  should not still claim `.heic` or `.png` — a name that disagrees with the
 *  bytes is the same small lie this normalization exists to stop telling. */
function jpgName(name: string): string {
  return name.replace(/\.[A-Za-z0-9]+$/, '') + '.jpg'
}

export async function enqueue(
  items: Array<{ blob: Blob; name: string; source: 'camera' | 'upload' }>,
): Promise<{ uploaded: number; held: number; error: string | null }> {
  let uploaded = 0
  let lastError: string | null = null
  const held: OutboxItem[] = []
  for (const it of items) {
    try {
      const jpg = await blobToBase64(await normalizeForUpload(it.blob, it.name))
      await api.scanQueueAdd({ jpg, name: jpgName(it.name), source: it.source })
      uploaded += 1
    } catch (e) {
      lastError = e instanceof Error ? e.message : 'the upload was refused'
      held.push({ id: nextLocalId(), blob: it.blob, name: it.name, source: it.source, addedAt: Date.now(),
        failureReason: isPermanentUploadError(e) ? lastError : undefined })
    }
  }
  if (held.length) await stash(held)
  return { uploaded, held: held.length, error: held.length ? lastError : null }
}

/**
 * Push whatever is in the outbox.
 *
 * REPORTS WHY IT STOPPED. The first version returned a count and swallowed the
 * reason, so a photo that could never upload — too large for the body parser,
 * say — looked exactly like a photo waiting for signal, forever. A queue that
 * cannot explain itself is a queue the reader has to guess about.
 */
export async function flushOutbox(): Promise<{
  sent: number
  failed: number
  remaining: number
  error: string | null
}> {
  const items = await outbox()
  let sent = 0
  let failed = 0
  let error: string | null = null
  // ── ONE BAD PHOTO MUST NOT BLOCK THE REST ───────────────────────────────
  //
  // This used to `break` on the first failure, on the reasoning that a dead
  // network should not be hammered with the rest of the batch. That reasoning
  // only holds when failures are about the NETWORK. They are not: an
  // undecodable HEIC fails every time, forever, and one of them at the head of
  // the queue held thirty-one other photos hostage — including two the browser
  // could read perfectly well. Measured on the owner's own queue: 32 items, 30
  // HEIC, zero uploaded.
  //
  // So a per-item failure skips that item and the loop continues. A genuine
  // network outage still short-circuits, because `looksOffline` stops the run
  // rather than retrying thirty times against a connection that is gone.
  for (const it of items) {
    if (it.failureReason) continue
    try {
      const jpg = await blobToBase64(await normalizeForUpload(it.blob, it.name))
      await api.scanQueueAdd({ jpg, name: jpgName(it.name), source: it.source })
      await run('readwrite', (s) => s.delete(it.id))
      sent += 1
    } catch (e) {
      const message = e instanceof Error ? e.message : 'the upload was refused'
      failed += 1
      if (!error) error = message
      if (isPermanentUploadError(e)) {
        await markPermanentIfPresent(it.id, message)
        continue
      }
      if (looksOffline()) {
        error = 'no connection — the queue will finish uploading when you are back online'
        break
      }
    }
  }
  return { sent, failed, remaining: items.length - sent, error }
}

/**
 * Everything waiting, oldest first — the server's list, with anything still in
 * the outbox ahead of it.
 *
 * Outbox items sort first because their ids are negative, which is the same
 * thing as "taken before anything that has finished uploading".
 */
export class QueueReadError extends Error {
  constructor(public readonly local: QueuedPhoto[], cause: unknown) {
    super('Could not refresh the shared queue. The list may be out of date; try again.', { cause })
  }
}

export async function listQueue(): Promise<QueuedPhoto[]> {
  const local = (await outbox()).map((it) => ({
    id: it.id,
    name: it.name,
    source: it.source,
    addedAt: new Date(it.addedAt).toISOString(),
    size: it.blob.size,
    pending: true,
    failureReason: it.failureReason,
  }))
  try {
    const remote = (await api.scanQueueList()).photos
    return [...local, ...remote.map((p) => ({ ...p, pending: false }))]
  } catch (error) {
    // An unavailable listing is not an empty queue. The UI can retain its
    // last server snapshot and still show newly captured local photos.
    throw new QueueReadError(local, error)
  }
}

/**
 * Is this id an outbox row? ASKED, never inferred.
 *
 * ── THE BUG THIS REPLACED ──────────────────────────────────────────────────
 *
 * Routing was `id < 0`: negative meant outbox, positive meant server. True of
 * every row THIS code writes, and false of every row already on disk when it
 * shipped — the previous queue stored outbox items under positive `Date.now()`
 * ids, in the same database, under the same store name and the same version.
 *
 * So a reader upgrading mid-session had a queue full of local photos whose ids
 * claimed to be the server's. `queuedPhotoBlob` asked the API for bytes it had
 * never been given and every one rendered `unreadable`; `removeQueued` deleted
 * them from a server that did not have them, so nothing was deleted at all.
 *
 * Entirely self-inflicted: a schema whose MEANING changed without its version
 * changing. Asking the store is a lookup rather than a guess, and it is right
 * for rows written by either version.
 */
async function inOutbox(id: number): Promise<OutboxItem | null> {
  if (!queueSupported()) return null
  try {
    const it = await run<OutboxItem | undefined>('readonly', (s) => s.get(id) as IDBRequest<OutboxItem | undefined>)
    return it ?? null
  } catch {
    return null
  }
}

/** Remove one — labelled, or discarded. The outbox is consulted first; anything
 *  it does not hold is the server's. */
export async function removeQueued(id: number): Promise<void> {
  if (await inOutbox(id)) {
    await run('readwrite', (s) => s.delete(id))
    return
  }
  removedIds.add(id)
  try {
    await repairs.get(id)?.catch(() => {})
    // The server owns the whole original/replacement family. One deletion is
    // enough, including when another device performed the repair.
    await api.scanQueueDelete(id)
  } catch (error) {
    removedIds.delete(id)
    throw error
  }
}

export async function clearQueue(): Promise<void> {
  let items: QueuedPhoto[]
  let sharedUnavailable = false
  try {
    items = await listQueue()
  } catch (error) {
    if (!(error instanceof QueueReadError)) throw error
    // The shared list is unknown, but this device's outbox is known. Clear
    // those rows while leaving the last visible shared snapshot alone.
    items = error.local
    sharedUnavailable = true
  }
  // Sequential, and failures do not stop the rest: "clear" should clear as much
  // as it can rather than abandoning the job over one stubborn row.
  let failed = 0
  for (const it of items) {
    try { await removeQueued(it.id) } catch { failed += 1 }
  }
  if (sharedUnavailable) {
    const localFailure = failed ? `${failed} local photo${failed === 1 ? '' : 's'} could not be discarded. ` : ''
    throw new Error(`${localFailure}Could not clear the shared queue. Try again.`)
  }
  if (failed) throw new Error(`${failed} photo${failed === 1 ? '' : 's'} could not be discarded. Try again.`)
}

/**
 * Bytes the queue is holding, and the device's own quota where the browser will
 * say. The quota only bounds the OUTBOX now — the server's share is not this
 * device's problem — so it is reported beside the local figure rather than as
 * a limit on the whole queue.
 */
export async function queueUsage(knownItems?: QueuedPhoto[]): Promise<{ bytes: number; localBytes: number; quota: number | null }> {
  const items = knownItems ?? await listQueue()
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
const repairs = new Map<number, Promise<Blob>>()
const removedIds = new Set<number>()
let repairsChanged = false
let repairNoticeTimer: number | undefined
// Older clients persisted cleanup hints and hid originals based on them.
// Ignore those hints: only the server can know which copy still exists.

export async function queuedPhotoBlob(
  id: number,
  signal?: AbortSignal,
  details?: Pick<QueuedPhoto, 'name' | 'source'>,
): Promise<Blob> {
  const local = await inOutbox(id)
  if (local) {
    return (await isHeic(local.blob)) ? normalizeForUpload(local.blob, local.name) : local.blob
  }
  if (removedIds.has(id)) throw new Error('that photo has already been removed')
  const repaired = repairs.get(id)
  if (repaired) return repaired
  const blob = await api.scanQueueBlob(id, signal)
  if (removedIds.has(id)) throw new Error('that photo has already been removed')
  const alreadyRepaired = repairs.get(id)
  if (alreadyRepaired) return alreadyRepaired
  if (!(await isHeic(blob))) return blob
  // A former client could upload HEIC bytes under a .jpg path. Keep the old
  // object until the authenticated replacement has landed; a failed repair
  // must never cost the reader the only copy of their photo.
  let repair = repairs.get(id)
  if (!repair) {
    window.clearTimeout(repairNoticeTimer)
    repair = (async () => {
      const jpg = await normalizeForUpload(blob, details?.name)
      if (removedIds.has(id)) throw new Error('that photo has already been removed')
      const added = await api.scanQueueAdd({
        jpg: await blobToBase64(jpg),
        name: jpgName(details?.name ?? `photo-${id}.heic`),
        source: details?.source ?? 'upload',
        repairOf: id,
      })
      if (added.id !== id) await api.scanQueueDelete(id, true).catch(() => {})
      repairsChanged = true
      return jpg
    })()
    repairs.set(id, repair)
    void repair.finally(() => {
      repairs.delete(id)
      // A thumbnail batch needs one new listing, not one full listing per
      // repaired photo. Include successes even when the last repair fails.
      if (repairs.size === 0 && repairsChanged) {
        repairNoticeTimer = window.setTimeout(() => {
          repairsChanged = false
          window.dispatchEvent(new Event('deckpal:scan-queue-repaired'))
        }, 250)
      }
    }).catch(() => {})
  }
  return repair
}
