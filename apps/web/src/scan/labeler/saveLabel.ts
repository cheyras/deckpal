// Saves one label through the SAME choke point the product scanner's report
// affordance and the /dev/scan-harness "Flag frame" button both use —
// `api.scanFlag` (lib/api.ts) -> POST /dev/scan-flags. No new endpoint, no
// hand-rolled fetch (scripts/check-api-base.mjs would refuse one anyway).
//
// SPLIT IN TWO, 2026-09-07, so a failed send can be RETRIED WITHOUT THE FRAME.
// Encoding and posting used to be one call, which meant a label whose POST
// failed could only be retried by holding the source canvas alive — and the
// canvas belongs to the frame the reader has already moved on from. A
// `PendingLabel` is plain data (a base64 string and a JSON object), so the
// retry queue in QuadLabeler.tsx can hold several of them across as many frames
// as the reader labels while the network is away, and nothing it holds keeps a
// canvas, a stream or a decoded image alive.
import { api } from '../../lib/api'
import type { QuadLabel } from './types'

/** One label, fully serialized and ready to POST — nothing here references the
 *  DOM, so it survives the frame that produced it. */
export interface PendingLabel {
  /** The canonical working frame, base64 PNG (no data: prefix). */
  png: string
  label: QuadLabel
}

export function canvasToPngBase64(canvas: HTMLCanvasElement): Promise<string> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('this browser could not export the working frame'))
        return
      }
      const reader = new FileReader()
      reader.onload = () => {
        const s = String(reader.result || '')
        const i = s.indexOf(',')
        resolve(i >= 0 ? s.slice(i + 1) : s)
      }
      reader.onerror = () => reject(reader.error ?? new Error('could not read the working frame'))
      reader.readAsDataURL(blob)
    }, 'image/png')
  })
}

/** Freeze one label + its frame into retryable data. Done BEFORE the POST is
 *  attempted, so a send that fails has something to queue. */
export async function pendingLabel(canonical: HTMLCanvasElement, label: QuadLabel): Promise<PendingLabel> {
  return { png: await canvasToPngBase64(canonical), label }
}

/** Uploads the canonical working frame + its label. `meta.type` is what
 *  distinguishes this from the harness's live-camera flags and the product
 *  scanner's per-entry/per-moment reports in the same `/dev/scan-flags`
 *  bucket — all three are frame+annotation records, just different
 *  annotations. */
export async function sendLabel(pending: PendingLabel): Promise<{ id: string }> {
  return api.scanFlag(pending.png, { type: 'quad-label', ...pending.label })
}

/** Encode and send in one step — the straight-through path. */
export async function saveLabel(canonical: HTMLCanvasElement, label: QuadLabel): Promise<{ id: string }> {
  return sendLabel(await pendingLabel(canonical, label))
}
