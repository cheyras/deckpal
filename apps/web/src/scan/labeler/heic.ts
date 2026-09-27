import { decodeForCanvas } from '../ui/uploadNormalize'

const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs'])

/** Inspect bytes: older queue objects say image/jpeg even when they contain HEIC. */
export async function isHeic(blob: Blob): Promise<boolean> {
  const head = new Uint8Array(await blob.slice(0, 32).arrayBuffer())
  if (head.length < 12 || String.fromCharCode(...head.slice(4, 8)) !== 'ftyp') return false
  for (let i = 8; i + 4 <= head.length; i += 4) {
    if (HEIC_BRANDS.has(String.fromCharCode(...head.slice(i, i + 4)))) return true
  }
  return false
}

/** Native decode first (Safari); only a HEIC that needs help loads the decoder. */
export async function decodeQueueImage(blob: Blob, name: string): ReturnType<typeof decodeForCanvas> {
  const file = new File([blob], name, { type: blob.type || 'image/jpeg' })
  try {
    return await decodeForCanvas(file)
  } catch (originalError) {
    if (!(await isHeic(blob))) throw originalError
    const { default: heic2any } = await import('heic2any')
    const converted = await heic2any({ blob, toType: 'image/png' })
    const png = Array.isArray(converted) ? converted[0] : converted
    if (!png) throw new Error('that HEIC photo contains no image')
    return decodeForCanvas(new File([png], `${name}.png`, { type: 'image/png' }))
  }
}
