// The evidence channel. Sends a frame + its detection state to the same
// endpoint `apps/web/src/routes/dev/scan-harness.html`'s `uploadFlag()`
// posts to (`GET/POST /dev/scan-flags`) via `api.scanFlag` — the SAME
// `{ png, meta }` shape, so the harness and the shipped scanner feed one
// fix-bench. Routed through `lib/api.ts` (not a hand-rolled fetch) so it
// carries the app's real auth and survives the cloud/self-host base-path
// split; see `scripts/check-api-base.mjs`'s header for why that matters.
import { api } from '../../lib/api'
import { PIPELINE_VERSION } from '../engine/frame'
import { ocrEnabled, readOcrOverride } from '../ocr/flag'
import { postEvent, recorderSuspended } from './eventPost'

// ---------------------------------------------------------------------------
// FEATURE FLAGS
// ---------------------------------------------------------------------------
//
// A collision of vocabulary worth naming, because this file now holds two
// unrelated meanings of the word. Everything BELOW this block is about *scan
// flags* — the evidence channel, a reader pressing "report" on a bad capture.
// This one constant is a *feature flag*. They share a filename and nothing else.

/**
 * THE ON-DEVICE OCR LANE (`scan/ocr/**`) — ON in dev and in Vercel previews,
 * OFF in production and self-host.
 *
 * Read ONCE at module load, so no capture can straddle a change: the lane is
 * either running for this page or it is not. The rule, its reasoning and its
 * tests live in `scan/ocr/flag.ts` (a pure predicate, because this module
 * imports `lib/api.ts` and so cannot be loaded by a plain Node test process —
 * the same reason `eventPost.ts` was split out of it).
 *
 * What it gates is 15.6 MB of lazily-fetched ONNX weights (REPORT.md §5.2) and a
 * second inference session on a WASM runtime with live iOS crash reports against
 * it (`engine/model.ts`'s header), running alongside a capture that currently
 * completes in 0.67 s. None of it has ever been timed in a browser (§8.3). Until
 * it has, production stays off — and `localStorage['deckpal.ocr'] = '1'` is how
 * the owner turns it on for the phone that does the timing.
 */
export const OCR_ENABLED: boolean = ocrEnabled({
  dev: !!import.meta.env.DEV,
  hostname: typeof location === 'undefined' ? '' : location.hostname,
  override: readOcrOverride(),
})

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

// The posting POLICY — the owner-gate removal and the backoff that replaced it
// — lives in ./eventPost so it can be unit-tested without dragging `lib/api`
// (and its `import.meta.env` read) into a node process. Re-exported here so
// callers still have one import for the recorder.
export { MAX_CONSECUTIVE_FAILURES, postEvent, recorderSuspended, __setFlagPoster } from './eventPost'

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

/**
 * How long the recorder will hold a snapshotted capture waiting for its
 * `outcome` before posting without one.
 *
 * Must comfortably exceed `deadline.IDENTIFY_TIMEOUT_MS`, because the outcome it
 * waits for is that identify's result — but it is a hard local cap all the same:
 * a caller's promise must never be able to wedge the recorder and lose the
 * capture record entirely. Late is acceptable; missing is not.
 */
const OUTCOME_WAIT_MS = 15_000

export interface CaptureEventInput {
  /** The live <video>, read at capture time — the frame the engine saw. */
  video: HTMLVideoElement | null
  /** The rectified JPEG the reader is actually shown in the incoming stack. */
  rectified: Blob | null
  /** Everything that produced the decision. */
  detail: Record<string, unknown>
  /**
   * WHAT THE MATCHER SAID — merged into the record once it answers.
   *
   * The 2026-09-04 owner session could not be scored: 42 captures, and matcher
   * output existed only for the 21 the owner happened to press *report* on, so
   * every accuracy number the session produced was conditional on having been
   * reported — measured on the failure population by construction. The unbiased
   * top-1 rate was simply unmeasurable.
   *
   * The frame and the rectified crop are still snapshotted BEFORE this is
   * awaited, so the scene the record describes is the one the quad was measured
   * against; only the POST waits. Resolve with null (or never resolve, and eat
   * the `OUTCOME_WAIT_MS` cap) and the record lands exactly as it did before.
   */
  outcome?: Promise<Record<string, unknown> | null>
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
    // No pre-flight permission check — see MAX_CONSECUTIVE_FAILURES. The only
    // thing consulted before doing work is our own backoff.
    if (recorderSuspended()) return
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
    // THE SNAPSHOT IS DONE; only the POST waits. See `CaptureEventInput.outcome`.
    let outcome: Record<string, unknown> | null = null
    if (input.outcome) {
      outcome = await Promise.race([
        input.outcome.catch(() => null),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), OUTCOME_WAIT_MS)),
      ])
    }
    await postEvent(framePng, {
      type: 'capture-event',
      epochMs: Date.now(),
      source: 'scan-capture-event',
      // UNITS. `frame` is the CANONICAL frame and comes from the caller's engine
      // state, exactly as the lock recorder's does — it used to be set here from
      // `v.videoWidth/videoHeight`, which put the sensor's 960x1280 next to a
      // quad in canonical 416 space in one record, so any reader normalising a
      // capture quad by its own `frame` got garbage. The sensor dimensions are
      // still worth having (they are what maps a canonical quad back to sensor
      // pixels, and what says which way the phone was held), so they are here
      // under their own name instead of impersonating the frame.
      stream: { width: v.videoWidth, height: v.videoHeight },
      // Which frame spec these coordinates are in. `frame.PIPELINE_VERSION`
      // exists so a recorded quad can be read against the pipeline that produced
      // it; a record that does not carry it makes the next reader guess.
      pipelineVersion: PIPELINE_VERSION,
      rectifiedPng,
      ...input.detail,
      ...(outcome ?? {}),
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
    if (recorderSuspended()) return
    const v = video
    if (!v || !v.videoWidth || !v.videoHeight) return
    const png = await downscaledPngBase64(v, v.videoWidth, v.videoHeight, EVENT_FRAME_LONG_SIDE)
    if (!png) return
    await postEvent(png, {
      type: 'lock-event',
      epochMs: now,
      source: 'scan-lock-event',
      // `frame` (canonical) arrives in `detail` from the engine state; the
      // sensor's own dimensions ride along under their own name. Same units
      // discipline as the capture recorder above.
      stream: { width: v.videoWidth, height: v.videoHeight },
      pipelineVersion: PIPELINE_VERSION,
      ...detail,
    })
  } catch {
    // As above.
  }
}
