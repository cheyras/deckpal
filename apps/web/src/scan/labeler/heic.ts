import { decodeForCanvas } from '../ui/uploadNormalize'

const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs'])

export class HeicDecoderLoadError extends Error {
  constructor(cause: unknown) {
    super('the HEIC converter could not load — try again when this device is online', { cause })
  }
}

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
    // The CSP build uses a blob worker without eval. Only failed native HEIC
    // decodes pay its download and conversion cost.
    // A failed chunk download is a connection/deployment problem, not a bad
    // photo. Keep it retryable instead of marking the outbox row permanent.
    const { heicTo } = await import('heic-to/csp').catch((error: unknown) => {
      throw new HeicDecoderLoadError(error)
    })
    const png = await heicTo({ blob, type: 'image/png' })
    return decodeForCanvas(new File([png], `${name}.png`, { type: 'image/png' }))
  }
}
