// The evidence channel. Sends a frame + its detection state to the same
// endpoint `apps/web/src/routes/dev/scan-harness.html`'s `uploadFlag()`
// posts to (`GET/POST /dev/scan-flags`) via `api.scanFlag` — the SAME
// `{ png, meta }` shape, so the harness and the shipped scanner feed one
// fix-bench. Routed through `lib/api.ts` (not a hand-rolled fetch) so it
// carries the app's real auth and survives the cloud/self-host base-path
// split; see `scripts/check-api-base.mjs`'s header for why that matters.
import { api } from '../../lib/api'

/** Re-encode any image blob through a canvas so the upload is always a real
 *  PNG regardless of the source type — a capture is a JPEG; the sidecar
 *  format the fix bench reads assumes PNG (see scan-harness.html's own
 *  `flagCurrentFrame`, which does the same re-encode from raw pixels). */
async function blobToPngBase64(blob: Blob): Promise<string> {
  const bitmap = await createImageBitmap(blob)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('this browser could not prepare the report image')
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close?.()
  const pngBlob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!pngBlob) throw new Error('this browser could not prepare the report image')
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const s = String(reader.result || '')
      const i = s.indexOf(',')
      resolve(i >= 0 ? s.slice(i + 1) : s)
    }
    reader.onerror = () => reject(reader.error ?? new Error('could not read the report image'))
    reader.readAsDataURL(pngBlob)
  })
}

export async function uploadScanFlag(blob: Blob, meta: Record<string, unknown>): Promise<{ id: string }> {
  const png = await blobToPngBase64(blob)
  return api.scanFlag(png, meta)
}

// ---------------------------------------------------------------------------
// The capture-event recorder — the acceptance mechanism for the scanner rebuild
// ---------------------------------------------------------------------------
//
// WHY. Every number this engine has been tuned against comes from ONE corpus of
// 87 frames shot in one house on one evening, and the 2026-09-03 field test
// showed the product failing in ways that corpus cannot express: a reticle
// mis-sized against a viewport the corpus has no concept of, auto-captures of
// table clutter the corpus never contained, and a capture pipeline that could
// wedge on a network the corpus never used. Fixes measured against a proxy are
// how a "67.9% offline engine delivered a 32.1% experience" (PHASE0-CLOSEOUT
// §2.8) happened the first time.
//
// So the product records its OWN evidence: on every capture, the frame the
// engine actually saw, the thumbnail the reader actually got, and the full gate
// state that produced them. The next session is then self-documenting, and the
// next fix is measured against the OWNER'S captures rather than against ours.
//
// PRIVACY AND COST, STATED PLAINLY. This posts camera frames to the dev flag
// endpoint. It is therefore behind the same dev-flag channel `uploadScanFlag`
// already uses (`/dev/scan-flags`, owner-visible), it never fires unless that
// channel is enabled, and every failure is swallowed: instrumentation that can
// break a capture is worse than no instrumentation.

/** Downscale a frame before upload — the endpoint caps a post at ~3 MB and a
 *  full-resolution PNG of a 1080p frame is well past it. 640 on the long side
 *  keeps every quad judgeable by eye at a fraction of the bytes. */
const EVENT_FRAME_LONG_SIDE = 640

/** Lock events are throttled to this interval: `locked` goes non-null on most
 *  ticks of a good presentation, and one post per tick would be a flood. */
const LOCK_EVENT_MIN_GAP_MS = 2_000

let lastLockEventAt = 0

/**
 * THE RECORDER'S OWN GATE. `/dev/scan-flags` is already owner-only server-side
 * (apps/api/src/dev/scanFlags.ts `isOwner`), so a non-owner's post would be
 * refused anyway — but "refused" still means encoding a PNG and making a
 * request per capture on someone else's phone and data plan. So the client asks
 * once, caches the answer for the tab, and stays silent unless it is the owner.
 *
 * Fails CLOSED: any error answering the question means no recording.
 */
let ownerCheck: Promise<boolean> | null = null
function isRecordingEnabled(): Promise<boolean> {
  if (!ownerCheck) {
    ownerCheck = api
      .me()
      .then((m) => m.owner === true)
      .catch(() => false)
  }
  return ownerCheck
}

async function downscaledPngBase64(source: CanvasImageSource, w: number, h: number, longSide: number): Promise<string | null> {
  if (!w || !h) return null
  const s = Math.min(1, longSide / Math.max(w, h))
  const cw = Math.max(1, Math.round(w * s))
  const ch = Math.max(1, Math.round(h * s))
  const canvas = document.createElement('canvas')
  canvas.width = cw
  canvas.height = ch
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(source, 0, 0, cw, ch)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) return null
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const str = String(reader.result || '')
      const i = str.indexOf(',')
      resolve(i >= 0 ? str.slice(i + 1) : str)
    }
    reader.onerror = () => reject(reader.error ?? new Error('could not read the event image'))
    reader.readAsDataURL(blob)
  })
}

export interface CaptureEventInput {
  /** The live <video>, read at capture time — the frame the engine saw. */
  video: HTMLVideoElement | null
  /** The rectified JPEG the reader is actually shown in the incoming stack. */
  rectified: Blob | null
  /** Everything that produced the decision. */
  detail: Record<string, unknown>
}

/**
 * Record ONE capture — auto or manual — as `meta.type = 'capture-event'`.
 *
 * `png` is the raw working frame; the rectified thumbnail rides along as
 * `meta.rectifiedPng` so a reviewer can put "what the camera saw" and "what the
 * reader got" side by side, which is the single comparison that would have
 * caught the raw-looking thumbnails immediately.
 */
export async function recordCaptureEvent(input: CaptureEventInput): Promise<void> {
  try {
    if (!(await isRecordingEnabled())) return
    const v = input.video
    if (!v || !v.videoWidth || !v.videoHeight) return
    const framePng = await downscaledPngBase64(v, v.videoWidth, v.videoHeight, EVENT_FRAME_LONG_SIDE)
    if (!framePng) return
    let rectifiedPng: string | null = null
    if (input.rectified) {
      try {
        const bmp = await createImageBitmap(input.rectified)
        rectifiedPng = await downscaledPngBase64(bmp, bmp.width, bmp.height, 320)
        bmp.close?.()
      } catch {
        rectifiedPng = null
      }
    }
    await api.scanFlag(framePng, {
      type: 'capture-event',
      epochMs: Date.now(),
      source: 'scan-capture-event',
      frame: { width: v.videoWidth, height: v.videoHeight },
      rectifiedPng,
      ...input.detail,
    })
  } catch {
    // Instrumentation must never take a capture down with it.
  }
}

/**
 * Record a LOCK — the moment auto-capture becomes possible — as
 * `meta.type = 'lock-event'`, throttled to one every LOCK_EVENT_MIN_GAP_MS.
 *
 * This is the record that answers "what was it looking at when it decided to
 * fire", including for the locks that DON'T become captures because the
 * refractory set already holds the track.
 */
export async function recordLockEvent(video: HTMLVideoElement | null, detail: Record<string, unknown>): Promise<void> {
  const now = Date.now()
  if (now - lastLockEventAt < LOCK_EVENT_MIN_GAP_MS) return
  lastLockEventAt = now
  try {
    if (!(await isRecordingEnabled())) return
    const v = video
    if (!v || !v.videoWidth || !v.videoHeight) return
    const png = await downscaledPngBase64(v, v.videoWidth, v.videoHeight, EVENT_FRAME_LONG_SIDE)
    if (!png) return
    await api.scanFlag(png, {
      type: 'lock-event',
      epochMs: now,
      source: 'scan-lock-event',
      frame: { width: v.videoWidth, height: v.videoHeight },
      ...detail,
    })
  } catch {
    // As above.
  }
}
