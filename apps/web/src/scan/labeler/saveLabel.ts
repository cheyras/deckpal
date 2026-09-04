// Saves one label through the SAME choke point the product scanner's report
// affordance and the /dev/scan-harness "Flag frame" button both use —
// `api.scanFlag` (lib/api.ts) -> POST /dev/scan-flags. No new endpoint, no
// hand-rolled fetch (scripts/check-api-base.mjs would refuse one anyway).
import { api } from '../../lib/api'
import type { QuadLabel } from './types'

function canvasToPngBase64(canvas: HTMLCanvasElement): Promise<string> {
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

/** Uploads the canonical working frame + its label. `meta.type` is what
 *  distinguishes this from the harness's live-camera flags and the product
 *  scanner's per-entry/per-moment reports in the same `/dev/scan-flags`
 *  bucket — all three are frame+annotation records, just different
 *  annotations. */
export async function saveLabel(canonical: HTMLCanvasElement, label: QuadLabel): Promise<{ id: string }> {
  const png = await canvasToPngBase64(canonical)
  return api.scanFlag(png, { type: 'quad-label', ...label })
}
