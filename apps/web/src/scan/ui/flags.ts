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
