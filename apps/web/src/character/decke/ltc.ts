/**
 * The RectAreaLight BRDF tables, as a binary asset rather than as source.
 *
 * He is lit by six `RectAreaLight`s — Blender's area lights, trimmed rather than
 * removed when the HDRI arrived — and three.js cannot render one until
 * `UniformsLib` has been handed the LTC lookup textures. The stock way to do
 * that is `RectAreaLightUniformsLib.init()`, which drags in
 * `RectAreaLightTexturesLib.js`: **307 KB of source, 25% of the character
 * chunk**, being two 64x64 tables written out as JavaScript number literals.
 *
 * This loads the same data from `models/decke/ltc.bin` (64 KB, 51 KB over the
 * wire) and installs it in the same place, which keeps that module — and its
 * parse cost — out of the bundle entirely. `scripts/decke/gen-ltc.mjs` emits the
 * file and documents the format; re-run it after a three.js upgrade.
 *
 * FP16 ONLY, for both of three's slots. `WebGLLights` picks the FP32 tables
 * wherever `OES_texture_float_linear` exists and the FP16 ones otherwise, so
 * both slots are pointed at the same FP16 textures. Two reasons, both measured:
 * emitting FP32 as binary is 151 KB brotli against the 108 KB the JS source
 * compresses to (decimal text compresses better than float32, so the "obvious"
 * version of this optimisation is a regression), and the precision costs a worst
 * mean of 0.0081/255 across six states — maximum difference 2, not one pixel off
 * by more than 8, against a bit-exact control.
 *
 * MUST BE INSTALLED BEFORE THE FIRST RENDER. `WebGLLights` reads these uniforms
 * while building the light state; with the slots empty the area lights sample
 * nothing. `DeckE.load()` awaits this alongside the glb, which puts it well
 * before `precompile()` and `start()`.
 */
import {
  ClampToEdgeWrapping,
  DataTexture,
  HalfFloatType,
  LinearFilter,
  NearestFilter,
  RGBAFormat,
  UniformsLib,
  UVMapping,
} from 'three'

const MAGIC = 'LTC1'
const SIZE = 64

let installed = false

/**
 * Fetch `ltc.bin` and install it into `UniformsLib`. Idempotent — a second
 * controller on the same page reuses the first one's textures, because
 * `UniformsLib` is a module singleton in three and installing twice would
 * allocate a second pair of GPU textures for identical data.
 */
export async function installLtcTables(baseUrl: string): Promise<void> {
  if (installed) return
  // Spelled out as a literal so `scripts/check-precache.mjs` can see it — that
  // gate scans this directory for `models/decke/<file>` and proves the asset is
  // in the build. A missing one is a 404 in production and nowhere else.
  const res = await fetch(`${baseUrl}models/decke/ltc.bin`)
  if (!res.ok) throw new Error(`decke ltc: ${res.status} fetching ltc.bin`)
  const buf = await res.arrayBuffer()

  const head = new DataView(buf)
  const magic = String.fromCharCode(head.getUint8(0), head.getUint8(1), head.getUint8(2), head.getUint8(3))
  if (magic !== MAGIC) throw new Error(`decke ltc: bad magic "${magic}" — regenerate with scripts/decke/gen-ltc.mjs`)
  const size = head.getUint32(8, true)
  const count = head.getUint32(12, true)
  if (size !== SIZE || count !== 2) {
    throw new Error(`decke ltc: expected 2 tables of ${SIZE}x${SIZE}, got ${count} of ${size}x${size}`)
  }
  const texels = size * size * 4
  const expected = 16 + count * texels * 2
  if (buf.byteLength !== expected) {
    throw new Error(`decke ltc: file is ${buf.byteLength} bytes, expected ${expected}`)
  }

  // The parameter list is three's own, copied from `RectAreaLightTexturesLib`:
  // NearestFilter on the MIN slot is not a typo there and is not one here.
  const make = (i: number) => {
    const data = new Uint16Array(buf, 16 + i * texels * 2, texels)
    const tex = new DataTexture(
      data, size, size, RGBAFormat, HalfFloatType, UVMapping,
      ClampToEdgeWrapping, ClampToEdgeWrapping, LinearFilter, NearestFilter, 1,
    )
    tex.needsUpdate = true
    return tex
  }
  const t1 = make(0)
  const t2 = make(1)

  const U = UniformsLib as unknown as Record<string, unknown>
  U.LTC_HALF_1 = t1
  U.LTC_HALF_2 = t2
  // Both slots, deliberately — see the header.
  U.LTC_FLOAT_1 = t1
  U.LTC_FLOAT_2 = t2
  installed = true
}
