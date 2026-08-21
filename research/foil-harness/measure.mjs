/**
 * Does reverse-holo foil leave a measurable trace at the resolution the scanner
 * actually works at?
 *
 * Every feature here is RELATIVE, and that is the whole methodological point.
 * The phone's auto-exposure fights back against a bright specular highlight —
 * it darkens the whole frame to protect the highlight — so an absolute
 * brightness threshold measures the camera's gain control rather than the card.
 * Ratios and within-frame distributions survive that; raw luminance does not.
 *
 * Frames are pushed through sharp at the size AND jpeg quality the live scanner
 * uses (`Scan.tsx`: 480px wide, q0.85), because the question is not whether foil
 * is visible — it plainly is at 4K — but whether it is still there after the
 * pipeline has finished discarding detail.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const sharp = createRequire('/home/cheyras/deckpal/package.json')('sharp')

const DIR = '/tmp/claude-1000/-home-cheyras/b64a0301-b0e7-4e67-976e-46366638fbd3/scratchpad/foil'
const spec = JSON.parse(readFileSync(`${DIR}/segments.json`, 'utf8'))
const LABEL = new Map()
for (const c of spec.clips) for (const s of c.segments) LABEL.set(s.id, { ...s, light: c.light })

/** Per-frame features at one working resolution. */
async function features(file, width, quality) {
  let pipe = sharp(file).resize({ width, fit: 'inside' })
  if (quality) pipe = sharp(await pipe.jpeg({ quality }).toBuffer())
  const { data, info } = await pipe.raw().toBuffer({ resolveWithObject: true })
  const { width: W, height: H, channels: C } = info
  const N = W * H

  const L = new Float32Array(N)
  const S = new Float32Array(N)
  const hist = new Uint32Array(256)
  for (let i = 0, p = 0; i < N; i++, p += C) {
    const r = data[p], g = data[p + 1], b = data[p + 2]
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b
    L[i] = l
    hist[Math.min(255, l | 0)]++
    const mx = r > g ? (r > b ? r : b) : g > b ? g : b
    const mn = r < g ? (r < b ? r : b) : g < b ? g : b
    S[i] = mx === 0 ? 0 : (mx - mn) / mx
  }

  const q = (frac) => {
    let acc = 0, target = frac * N
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= target) return v }
    return 255
  }
  const med = q(0.5) || 1
  const p99 = q(0.99)

  // Specular coverage: pixels far above the frame's own middle. Scale-free, so
  // it does not move when auto-exposure shifts the whole frame.
  const specCut = Math.min(250, med * 1.6)
  let spec = 0, blow = 0
  for (let i = 0; i < N; i++) { if (L[i] > specCut) spec++; if (L[i] >= 250) blow++ }

  // Saturation of the brightest 2%. A foil highlight washes toward white; a
  // bright patch of ordinary card art keeps its colour.
  const brightCut = q(0.98)
  let sSum = 0, sN = 0
  for (let i = 0; i < N; i++) if (L[i] >= brightCut) { sSum += S[i]; sN++ }

  // High-frequency energy — the sparkle itself, normalised so it is texture and
  // not just contrast.
  let lap = 0
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x
      lap += Math.abs(4 * L[i] - L[i - 1] - L[i + 1] - L[i - W] - L[i + W])
    }

  return {
    specCov: spec / N,
    blowout: blow / N,
    topSat: sN ? sSum / sN : 0,
    contrast: p99 / med,
    hf: lap / ((W - 2) * (H - 2) * med),
  }
}

const KEYS = ['specCov', 'blowout', 'topSat', 'contrast', 'hf']
const files = readdirSync(`${DIR}/set`).filter((f) => f.endsWith('.png')).sort()

const RES = [
  { name: 'live-480-q85', width: 480, quality: 85 },
  { name: 'photo-1400', width: 1400, quality: null },
]

const out = {}
for (const res of RES) {
  const bySeg = new Map()
  for (const f of files) {
    const id = f.split('__')[0]
    const v = await features(`${DIR}/set/${f}`, res.width, res.quality)
    if (!bySeg.has(id)) bySeg.set(id, [])
    bySeg.get(id).push(v)
  }
  out[res.name] = {}
  for (const [id, rows] of bySeg) {
    const agg = { n: rows.length, ...LABEL.get(id) }
    for (const k of KEYS) {
      const vals = rows.map((r) => r[k]).sort((a, b) => a - b)
      agg[`${k}_max`] = vals[vals.length - 1]
      agg[`${k}_med`] = vals[Math.floor(vals.length / 2)]
      agg[`${k}_rng`] = vals[vals.length - 1] - vals[0]
    }
    out[res.name][id] = agg
  }
  process.stdout.write(`${res.name} done\n`)
}
writeFileSync(`${DIR}/features.json`, JSON.stringify(out, null, 2))
console.log('wrote features.json')
