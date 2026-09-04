// The parity corpus, generated rather than committed.
//
// A binary fixture would work and would be worse: nobody can read a PNG in a
// diff, and the Python half would need its own decoder (whose own rounding then
// becomes part of the contract being tested, which is backwards). A 32-bit LCG
// is four lines in both languages and produces the same bytes on every platform
// with no decoder in the path at all.
//
// The two cases are the two REAL producers, at their real sizes:
//   * 480x670 with a 0.05 margin — a live capture out of `rectify.ts`.
//   * 245x337 with no margin — a catalog `low.webp`.
// If the spec ever stops handling one of those shapes correctly, the golden
// digest moves.

/** Numerical Recipes' LCG, the exact constants CPython's mirror uses. `>>> 0`
 *  keeps it in uint32 where Python's `& 0xFFFFFFFF` does. */
export function syntheticRgba(seed: number, width: number, height: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4)
  let s = seed >>> 0
  for (let i = 0; i < width * height; i++) {
    const o = i * 4
    for (let c = 0; c < 3; c++) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0
      // The top byte, because an LCG's low bits are the weakly-random ones and
      // a resampler averaging weak noise is a less interesting test.
      out[o + c] = s >>> 24
    }
    out[o + 3] = 255
  }
  return out
}

export interface ParityCase {
  name: string
  seed: number
  width: number
  height: number
  marginFrac: number
}

export const PARITY_CASES: readonly ParityCase[] = [
  { name: 'capture-480x670-margin5', seed: 20260904, width: 480, height: 670, marginFrac: 0.05 },
  { name: 'catalog-245x337-nomargin', seed: 7, width: 245, height: 337, marginFrac: 0 },
]
