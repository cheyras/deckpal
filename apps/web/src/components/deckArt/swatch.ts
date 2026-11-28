// One colour from a card's artwork — the "palette from the main attacker's
// art" half of the deck-box rules (derive.ts is the other half).
//
// Cost: one off-thread decode of the 245×342 low.webp the tile is about to
// show anyway (same URL and same CORS mode as the tile's <img>, so the tile's
// own request is then a cache hit, not a second download), one drawImage into
// a 20×16 canvas and 320 pixel conversions. Once per deck per device — the
// result is cached with the spec.
//
// It can fail, and that is fine: a canvas that a non-CORS response has tainted
// throws on read, an image can 404, an old browser can lack decode(). Every
// failure is `null`, and derivePalette() then colours the deck from its energy
// types alone.

import { directArtUrl } from '../../lib/cardArt'
import { rgbToOklch, type Oklch } from './color'

/**
 * The artwork window of a modern card, as fractions of the card: inside the
 * frame, below the name bar, above the attack text. Sampling the whole card
 * would mostly measure the frame (already the type's colour) and the text box.
 */
const ART = { x: 0.09, y: 0.11, w: 0.82, h: 0.37 }
const W = 20
const H = 16
const BINS = 24

function loadImage(src: string, cors: boolean): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    if (cors) img.crossOrigin = 'anonymous'
    img.decoding = 'async'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`image failed: ${src}`))
    img.src = src
  })
}

/** Dominant vivid colour of an RGBA pixel buffer, or null if it is essentially grey. */
export function dominantColor(data: Uint8ClampedArray | readonly number[]): Oklch | null {
  const weight = new Array<number>(BINS).fill(0)
  const sumL = new Array<number>(BINS).fill(0)
  const sumC = new Array<number>(BINS).fill(0)
  const sumA = new Array<number>(BINS).fill(0)
  const sumB = new Array<number>(BINS).fill(0)
  for (let i = 0; i + 3 < data.length; i += 4) {
    if (data[i + 3] < 200) continue
    const c = rgbToOklch({ r: data[i], g: data[i + 1], b: data[i + 2] })
    // Greys say nothing about colour; near-black and near-white are shading.
    if (c.c < 0.03 || c.l < 0.2 || c.l > 0.94) continue
    // Favour colourful mid-tones — but cap the chroma that counts. OKLCH lets
    // reds and magentas reach far higher chroma than cyans or greens, so an
    // uncapped weight hands nearly every artwork to its red patches; capped,
    // a large teal sky outvotes a small red flame, which is what the eye sees.
    const w = Math.min(c.c, 0.09) * Math.max(0.1, 1 - Math.abs(c.l - 0.62) * 1.4)
    const bin = Math.floor((c.h / 360) * BINS) % BINS
    weight[bin] += w
    sumL[bin] += c.l * w
    sumC[bin] += c.c * w
    const hr = (c.h * Math.PI) / 180
    sumA[bin] += Math.cos(hr) * w
    sumB[bin] += Math.sin(hr) * w
  }
  // A bin and its neighbours, so a hue that straddles a boundary still wins.
  let best = -1
  let bestW = 0
  for (let b = 0; b < BINS; b++) {
    const w = weight[b] + 0.5 * (weight[(b + BINS - 1) % BINS] + weight[(b + 1) % BINS])
    if (w > bestW) {
      bestW = w
      best = b
    }
  }
  if (best < 0 || weight[best] <= 0) return null
  const w = weight[best]
  let h = (Math.atan2(sumB[best], sumA[best]) * 180) / Math.PI
  if (h < 0) h += 360
  return { l: sumL[best] / w, c: sumC[best] / w, h }
}

/**
 * Sample the art of the card at `low` (a `/deckpal/images/…` path). Tries the
 * direct Storage URL first — the same one the tile's <img> uses — and the
 * image tier second, exactly like CardImage.
 */
export async function sampleArtSwatch(low: string): Promise<Oklch | null> {
  if (typeof document === 'undefined') return null
  const sources = [directArtUrl(low), low].filter((s): s is string => !!s)
  for (const src of sources) {
    try {
      const img = await loadImage(src, true)
      // Decode off the main thread first; drawImage on an undecoded image
      // decodes it synchronously, a frame-sized stall on a slow phone.
      await img.decode?.().catch(() => {})
      const canvas = document.createElement('canvas')
      canvas.width = W
      canvas.height = H
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) return null
      const iw = img.naturalWidth
      const ih = img.naturalHeight
      if (!iw || !ih) continue
      ctx.drawImage(img, iw * ART.x, ih * ART.y, iw * ART.w, ih * ART.h, 0, 0, W, H)
      return dominantColor(ctx.getImageData(0, 0, W, H).data)
    } catch {
      // next source; a SecurityError (tainted canvas) lands here too
    }
  }
  return null
}
