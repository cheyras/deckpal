// Synthetic cards for the look and the capture policy's tests: a canonical
// frame with a "card" whose layout (a colour field and a few blobs) is its art,
// read through the shipping `cardLook`. Not a test file itself.
import type { Quad } from '../../engine/contract'
import type { ImageDataLike } from '../../engine/geometry'
import * as rect from '../../engine/rectify'
import { cardLook, lookDistance, type CardLook } from '../../engine/look'

export const N = 416

/** A canonical frame with a "card" in the quad's box: a colour field and a few
 *  blobs whose placement is the card's layout (its art). */
export function scene(seed: number, opts: { exposure?: number; shift?: number } = {}): { img: ImageDataLike; quad: Quad } {
  const data = new Uint8ClampedArray(N * N * 4)
  const rnd = (() => {
    let s = seed * 9301 + 49297
    return () => ((s = (s * 9301 + 49297) % 233280) / 233280)
  })()
  const base = [rnd() * 255, rnd() * 255, rnd() * 255]
  const blobs = Array.from({ length: 6 }, () => ({
    x: 120 + rnd() * 170,
    y: 60 + rnd() * 290,
    r: 20 + rnd() * 40,
    c: [rnd() * 255, rnd() * 255, rnd() * 255],
  }))
  const k = opts.exposure ?? 1
  const dx = opts.shift ?? 0
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const o = (y * N + x) * 4
      let c = [40, 40, 40]
      if (x >= 108 + dx && x < 308 + dx && y >= 40 && y < 376) {
        c = base
        for (const b of blobs) if ((x - dx - b.x) ** 2 + (y - b.y) ** 2 < b.r ** 2) c = b.c
      }
      data[o] = c[0]! * k
      data[o + 1] = c[1]! * k
      data[o + 2] = c[2]! * k
      data[o + 3] = 255
    }
  }
  const q: Quad = [
    [108 + dx, 40],
    [308 + dx, 40],
    [308 + dx, 376],
    [108 + dx, 376],
  ]
  return { img: { width: N, height: N, data }, quad: q }
}

const cache = new Map<string, CardLook>()
/** The tick look of card `seed`. */
export function lookOf(seed: number, opts?: { exposure?: number; shift?: number }): CardLook {
  const key = `${seed}:${opts?.exposure ?? 1}:${opts?.shift ?? 0}`
  const hit = cache.get(key)
  if (hit) return hit
  const s = scene(seed, opts)
  const l = cardLook(s.img, s.quad)
  if (!l) throw new Error('scene has no look')
  cache.set(key, l)
  return l
}

/** Byte-wise blend: w = 0 is `a`, w = 1 is `b`. */
export function mix(a: CardLook, b: CardLook, w: number): CardLook {
  return Uint8Array.from(a, (x, i) => Math.round(x * (1 - w) + b[i]! * w))
}

/**
 * A look at about `target` from `base` (within 0.02), made by blending `base`
 * towards an unrelated card — the shape a card part-covered, or a different
 * card of the same frame and type, takes.
 */
export function lookAt(base: CardLook, target: number, toward: CardLook = lookOf(97)): CardLook {
  let lo = 0
  let hi = 1
  for (let i = 0; i < 40; i++) {
    const w = (lo + hi) / 2
    if (lookDistance(mix(base, toward, w), base) < target) lo = w
    else hi = w
  }
  const out = mix(base, toward, (lo + hi) / 2)
  const d = lookDistance(out, base)
  if (Math.abs(d - target) > 0.02) throw new Error(`lookAt(${target}) reached ${d.toFixed(3)}`)
  return out
}

/** The capture() of scene `seed` when the corner order came out `turn` quarter
 *  turns off (orderQuadForCard picks the top-left by position, so a card lying
 *  past 45° is warped sideways or upside down): the expanded quad warped from
 *  corner `turn` instead of the card's own top-left, at the device's 480x670. */
export function capturedTurned(seed: number, turn: number) {
  const s = scene(seed)
  const q = rect.expandQuad(s.quad, rect.CAPTURE_MARGIN)
  const ordered = [0, 1, 2, 3].map((i) => q[(i + turn) % 4]) as Quad
  return rect.warpQuad(s.img, ordered, 480, 670)!
}

/** The quad every scene's card sits in. */
export const CARD_QUAD: Quad = scene(1).quad
