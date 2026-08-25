/**
 * Shrink the Deck-E environment map.
 *
 *   node apps/web/scripts/decke/optimize-hdri.mjs <in.hdr> <out.hdr> [--size=256]
 *
 * `studio_small_09_1k.hdr` is 1570 KB — after the glb was quantised it became the
 * single heaviest thing the chat opens with. It is a 1024x512 RGBE equirect, and
 * it is not optional: he is metallic 0.85 and renders near-black with nothing to
 * reflect.
 *
 * ---------------------------------------------------------------------------
 * CLAMP FIRST, THEN DOWNSAMPLE. THIS ORDER IS THE WHOLE SCRIPT.
 *
 * The runtime caps every source texel at `ENV_INDIRECT_CLAMP / ENV_INTENSITY`
 * (10.0 / 0.6 = 16.667) before PMREM, porting Blender's EEVEE firefly clamp —
 * `stage.ts`'s `clampEnvironmentTexels`, and `decke/README.md` explains why
 * capping the finished IBL lookup instead moves the scene by 0.08% while capping
 * the source texels changes it enormously.
 *
 * This HDRI runs to radiance 560 against a sphere mean of 0.86. Downsampling
 * FIRST averages a 560 into its neighbours and smears energy the clamp was about
 * to throw away — the result is a map that is too bright in a way no clamp can
 * undo, because by then the spike is a wide dim smear rather than a spike.
 * Clamping first is also exactly idempotent with what the runtime still does at
 * load, so no code changes and nothing to keep in sync: clamping already-clamped
 * texels is a no-op.
 *
 * ---------------------------------------------------------------------------
 * WHY DROPPING RESOLUTION IS SAFE HERE
 *
 * The map is never seen. `stage.ts` never assigns it as `scene.background` — he
 * composites over the DOM — so it exists only to be prefiltered by
 * `PMREMGenerator` into a roughness mip chain, and the surfaces reading it are
 * roughness 0.30 with a clearcoat over metalness 0.85. What survives that chain
 * is low-frequency by construction. Verify a candidate on
 * `/dev/decke-compare` anyway: lighting errors show up as a shading gradient
 * across a face, not as a visible change in the map.
 */
import { readFileSync, writeFileSync, statSync } from 'node:fs'

const argv = process.argv.slice(2)
const positional = argv.filter((a) => !a.startsWith('--'))
const flag = (n, d) => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`))
  return hit ? hit.slice(n.length + 3) : d
}
const [inPath, outPath] = positional
if (!inPath || !outPath) {
  console.error('usage: optimize-hdri.mjs <in.hdr> <out.hdr> [--size=256] [--clamp=16.667]')
  process.exit(1)
}
const TARGET_W = Number(flag('size', 256))
const CLAMP = Number(flag('clamp', 10.0 / 0.6))

// ---------------------------------------------------------------------------
// RGBE codec.
//
// The float<->byte convention matches three.js's `RGBELoader` exactly
// (`scale = 2^(E-128) / 255`), not Radiance's classic `/256`. They differ by
// 0.4%, which is invisible on its own and compounds if an encoder written to one
// convention feeds a decoder written to the other.
// ---------------------------------------------------------------------------
function decodeHDR(buf) {
  let p = 0
  const line = () => {
    let s = ''
    while (p < buf.length) {
      const c = buf[p++]
      if (c === 0x0a) break
      s += String.fromCharCode(c)
    }
    return s
  }
  if (!line().startsWith('#?')) throw new Error('not a radiance file')
  let l
  while ((l = line()) !== '') {
    if (l.startsWith('FORMAT=') && !l.includes('32-bit_rle_rgbe')) throw new Error(`unsupported ${l}`)
  }
  const res = line().trim().split(/\s+/)
  if (res[0] !== '-Y' || res[2] !== '+X') throw new Error(`unsupported orientation ${res.join(' ')}`)
  const h = Number(res[1])
  const w = Number(res[3])

  const out = new Float32Array(w * h * 3)
  const row = new Uint8Array(w * 4)

  for (let y = 0; y < h; y++) {
    // New-style RLE scanline: 0x02 0x02 <hi> <lo>, with hi<<8|lo === width.
    if (buf[p] === 2 && buf[p + 1] === 2 && ((buf[p + 2] << 8) | buf[p + 3]) === w && w >= 8 && w < 32768) {
      p += 4
      for (let c = 0; c < 4; c++) {
        let x = 0
        while (x < w) {
          let n = buf[p++]
          if (n > 128) {
            const v = buf[p++]
            n -= 128
            while (n-- > 0) row[(x++) * 4 + c] = v
          } else {
            while (n-- > 0) row[(x++) * 4 + c] = buf[p++]
          }
        }
      }
    } else {
      // Flat scanline (no RLE). Rare, but a legal .hdr.
      for (let x = 0; x < w; x++) {
        row[x * 4] = buf[p++]
        row[x * 4 + 1] = buf[p++]
        row[x * 4 + 2] = buf[p++]
        row[x * 4 + 3] = buf[p++]
      }
    }
    for (let x = 0; x < w; x++) {
      const e = row[x * 4 + 3]
      const s = e === 0 ? 0 : Math.pow(2, e - 128) / 255
      const i = (y * w + x) * 3
      out[i] = row[x * 4] * s
      out[i + 1] = row[x * 4 + 1] * s
      out[i + 2] = row[x * 4 + 2] * s
    }
  }
  return { w, h, data: out }
}

function encodeHDR(w, h, data) {
  const head = Buffer.from(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${h} +X ${w}\n`, 'latin1')
  const chunks = [head]
  const comp = [new Uint8Array(w), new Uint8Array(w), new Uint8Array(w), new Uint8Array(w)]

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3
      const r = data[i], g = data[i + 1], b = data[i + 2]
      const v = Math.max(r, g, b)
      if (v < 1e-32) {
        comp[0][x] = comp[1][x] = comp[2][x] = comp[3][x] = 0
        continue
      }
      // Smallest E with v / (2^(E-128)/255) <= 255.
      let E = 128 + Math.ceil(Math.log2(v / 255))
      let s = Math.pow(2, E - 128) / 255
      // log2 rounding can leave a component at 256; nudge the exponent rather
      // than clamping the byte, which would darken the brightest texel.
      while (Math.round(r / s) > 255 || Math.round(g / s) > 255 || Math.round(b / s) > 255) {
        E++
        s = Math.pow(2, E - 128) / 255
      }
      comp[0][x] = Math.min(255, Math.round(r / s))
      comp[1][x] = Math.min(255, Math.round(g / s))
      comp[2][x] = Math.min(255, Math.round(b / s))
      comp[3][x] = E
    }

    const sl = [Buffer.from([2, 2, (w >> 8) & 255, w & 255])]
    for (let c = 0; c < 4; c++) {
      const src = comp[c]
      const bytes = []
      let x = 0
      while (x < w) {
        let run = 1
        while (x + run < w && run < 127 && src[x + run] === src[x]) run++
        if (run >= 4) {
          bytes.push(128 + run, src[x])
          x += run
        } else {
          // Literal span, up to 128, stopping before a run worth encoding.
          const start = x
          let lit = 0
          while (x < w && lit < 128) {
            let ahead = 1
            while (x + ahead < w && ahead < 4 && src[x + ahead] === src[x]) ahead++
            if (ahead >= 4) break
            x++
            lit++
          }
          bytes.push(lit)
          for (let k = 0; k < lit; k++) bytes.push(src[start + k])
        }
      }
      sl.push(Buffer.from(bytes))
    }
    chunks.push(...sl)
  }
  return Buffer.concat(chunks)
}

// ---------------------------------------------------------------------------
const src = readFileSync(inPath)
const { w, h, data } = decodeHDR(src)
console.log(`in:  ${w}x${h}  ${(src.length / 1024).toFixed(0)} KB`)

let maxBefore = 0
for (let i = 0; i < data.length; i++) if (data[i] > maxBefore) maxBefore = data[i]

// 1. Clamp — per channel, exactly as `clampEnvironmentTexels` does at load.
let clamped = 0
for (let i = 0; i < data.length; i++) {
  if (data[i] > CLAMP) { data[i] = CLAMP; clamped++ }
}

// 2. Box-downsample in LINEAR radiance. Averaging must not happen in any
//    perceptual space — this is light, not colour.
const scale = Math.max(1, Math.round(w / TARGET_W))
const nw = Math.round(w / scale)
const nh = Math.round(h / scale)
const out = new Float32Array(nw * nh * 3)
for (let y = 0; y < nh; y++) {
  for (let x = 0; x < nw; x++) {
    let r = 0, g = 0, b = 0, n = 0
    for (let dy = 0; dy < scale; dy++) {
      const sy = y * scale + dy
      if (sy >= h) break
      for (let dx = 0; dx < scale; dx++) {
        const sx = x * scale + dx
        if (sx >= w) break
        const i = (sy * w + sx) * 3
        r += data[i]; g += data[i + 1]; b += data[i + 2]; n++
      }
    }
    const o = (y * nw + x) * 3
    out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n
  }
}

const enc = encodeHDR(nw, nh, out)
writeFileSync(outPath, enc)

// Round-trip check: decode what we just wrote and compare means. A codec bug
// here would show up on screen as a global brightness shift, which is exactly
// the kind of error that gets mistaken for "the downsample was too aggressive".
const back = decodeHDR(readFileSync(outPath))
const mean = (a) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s / a.length }
const mSrc = mean(data)
const mOut = mean(out)
const mBack = mean(back.data)

console.log(`clamped ${clamped} channel samples at ${CLAMP.toFixed(3)} (max was ${maxBefore.toFixed(1)})`)
console.log(`out: ${nw}x${nh}  ${(statSync(outPath).size / 1024).toFixed(0)} KB  (${((1 - enc.length / src.length) * 100).toFixed(1)}% smaller)`)
console.log(`mean radiance  clamped source ${mSrc.toFixed(5)}  ->  downsampled ${mOut.toFixed(5)}  ->  re-decoded ${mBack.toFixed(5)}`)
const drift = Math.abs(mBack - mOut) / (mOut || 1)
console.log(`codec round-trip drift: ${(drift * 100).toFixed(3)}%`)
if (drift > 0.01) {
  console.error('FAIL: RGBE round-trip drifted more than 1% — the encoder is wrong, not the resolution')
  process.exit(1)
}
