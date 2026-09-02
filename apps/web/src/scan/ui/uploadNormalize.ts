// Upload normalisation — REUSED verbatim (logic unchanged) from the previous
// Scan.tsx (lines 54–105 there), which this file replaces as the scanner's
// upload-fallback path (no live camera: desktop, or a non-secure http://
// origin where getUserMedia is blocked).
//
// Two hard limits meet here: the hosted API rejects a request body over
// 4.5 MB before our handler ever sees it, and an iPhone's photo library hands
// out HEIC, which the server-side decoder does not read. Both are the same
// fix — draw the picture into a canvas and re-encode it as a modest JPEG,
// which also strips EXIF and bakes in the rotation. Files that are already
// small and in a format we decode go over the wire byte-for-byte, so scanning
// a catalog image still lands at distance 0.
const DIRECT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const DIRECT_MAX_BYTES = 3 * 1024 * 1024
const NORMALIZED_EDGE = 1400

/** Decode a picked file to something drawable, honouring EXIF orientation. */
async function decodeForCanvas(file: File): Promise<CanvasImageSource & { width: number; height: number }> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' })
    } catch {
      /* Safari has refused blobs it can still render in an <img>; fall through. */
    }
  }
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('that file could not be read as an image'))
      img.src = url
    })
    return { ...(img as unknown as CanvasImageSource), width: img.naturalWidth, height: img.naturalHeight } as never
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** The bytes to POST for a picked file — original when safe, re-encoded when not. */
export async function toScanBytes(file: File): Promise<{ bytes: ArrayBuffer; type: string }> {
  if (DIRECT_TYPES.has(file.type) && file.size <= DIRECT_MAX_BYTES) {
    return { bytes: await file.arrayBuffer(), type: file.type || 'image/jpeg' }
  }
  const src = await decodeForCanvas(file)
  const scale = Math.min(1, NORMALIZED_EDGE / Math.max(src.width, src.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(src.width * scale))
  canvas.height = Math.max(1, Math.round(src.height * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('this browser could not prepare the image')
  ctx.drawImage(src as CanvasImageSource, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.85))
  if (!blob) throw new Error('this browser could not prepare the image')
  return { bytes: await blob.arrayBuffer(), type: 'image/jpeg' }
}
