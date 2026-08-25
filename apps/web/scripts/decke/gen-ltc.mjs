/**
 * Emit the RectAreaLight LTC tables as a binary asset.
 *
 *   node apps/web/scripts/decke/gen-ltc.mjs
 *   # -> apps/web/public/models/decke/ltc.bin
 *
 * WHY THIS EXISTS. `three/examples/jsm/lights/RectAreaLightUniformsLib.js` pulls
 * in `RectAreaLightTexturesLib.js`, which is **307 KB of source and 25% of the
 * whole character chunk** — two 64x64 RGBA BRDF lookup tables written out as
 * plain JavaScript number literals. The character uses six `RectAreaLight`s
 * (Blender's area lights, trimmed rather than removed when the HDRI arrived), so
 * the tables are genuinely needed; what is not needed is shipping them as source
 * the browser has to parse.
 *
 * ONLY THE HALF TABLES ARE EMITTED, and that is a measured decision rather than
 * a shortcut. three ships each table twice, FP32 and FP16, and `WebGLLights`
 * picks FP32 wherever `OES_texture_float_linear` exists — which is most desktops.
 * Emitting both as binary is 192 KB raw / 151 KB brotli, which is WORSE than the
 * 108 KB the JS source compresses to: decimal text is more compressible than
 * float32. Half only is 64 KB raw / 51 KB brotli.
 *
 * The precision loss was measured, not assumed: pointing three's FP32 slots at
 * the FP16 tables and re-rendering six states moves the image by a worst mean of
 * **0.0081/255**, with a maximum difference of 2 and not one pixel off by more
 * than 8 — against a bit-exact A/A control. FP16 is also simply what every
 * mobile GPU without that extension has always been given.
 *
 * FORMAT. A 16-byte header then two 64x64 RGBA FP16 tables, little-endian:
 *
 *   magic   4 bytes  'LTC1'
 *   version 4 bytes  u32, currently 1
 *   size    4 bytes  u32, texture width == height (64)
 *   count   4 bytes  u32, number of tables (2)
 *   data             count * size * size * 4 * 2 bytes, Uint16 half-floats
 *
 * Re-run this after a three.js upgrade. `ltc.ts` checks the magic and the
 * dimensions and throws rather than rendering the lights wrong.
 */
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const { RectAreaLightTexturesLib } = await import(
  'three/examples/jsm/lights/RectAreaLightTexturesLib.js'
)
RectAreaLightTexturesLib.init()

const tables = ['LTC_HALF_1', 'LTC_HALF_2'].map((k) => {
  const tex = RectAreaLightTexturesLib[k]
  if (!tex) throw new Error(`${k} missing — has three's RectAreaLightTexturesLib changed?`)
  const { data, width, height } = tex.image
  if (!(data instanceof Uint16Array)) throw new Error(`${k} is ${data.constructor.name}, expected Uint16Array`)
  if (width !== 64 || height !== 64) throw new Error(`${k} is ${width}x${height}, expected 64x64`)
  if (data.length !== 64 * 64 * 4) throw new Error(`${k} has ${data.length} elements, expected ${64 * 64 * 4}`)
  return data
})

const header = Buffer.alloc(16)
header.write('LTC1', 0, 'latin1')
header.writeUInt32LE(1, 4)
header.writeUInt32LE(64, 8)
header.writeUInt32LE(tables.length, 12)

const out = Buffer.concat([
  header,
  ...tables.map((t) => Buffer.from(t.buffer, t.byteOffset, t.byteLength)),
])

const here = dirname(fileURLToPath(import.meta.url))
const dest = join(here, '..', '..', 'public', 'models', 'decke', 'ltc.bin')
writeFileSync(dest, out)
console.log(`wrote ${dest}\n  ${tables.length} tables, 64x64 RGBA FP16, ${(out.length / 1024).toFixed(0)} KB`)
