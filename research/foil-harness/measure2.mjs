/**
 * Measure normal vs reverse holo in canonical card space.
 *
 * Compared WITHIN each (lighting × card) pair rather than pooled. Pooling was
 * the flaw that made pass 1 uninterpretable: a Ninetales is a red card and a
 * Kakuna is a green one, so a pooled comparison of "saturation" mostly measures
 * which Pokémon is in front of the lens. Held against itself under one light, the
 * only thing left varying is the print.
 *
 * The feature set follows the finding that overturned the first hypothesis: foil
 * sheen does not ADD sparkle at these resolutions, it BLEACHES — luminance up,
 * saturation down, local contrast flattened — and it does so intermittently as
 * the card tilts. So the per-frame values matter less than how far they SWING
 * across a segment, which is what `rng` and `std` capture.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const sharp = createRequire('/home/cheyras/deckpal/package.json')('sharp')

const DIR = '/tmp/claude-1000/-home-cheyras/b64a0301-b0e7-4e67-976e-46366638fbd3/scratchpad/foil'
const spec = JSON.parse(readFileSync(`${DIR}/segments.json`, 'utf8'))
const LABEL = new Map()
for (const c of spec.clips) for (const s of c.segments) LABEL.set(s.id, { ...s, light: c.light })

/** Inner 80% — the canonical box still carries a fringe of hand at its edges. */
async function features(file) {
  const { data, info } = await sharp(file)
    .extract({ left: 32, top: 45, width: 256, height: 358 })
    .raw().toBuffer({ resolveWithObject: true })
  const { width: W, height: H, channels: C } = info
  const N = W * H
  const L = new Float32Array(N), S = new Float32Array(N)
  const hist = new Uint32Array(256)
  for (let i = 0, p = 0; i < N; i++, p += C) {
    const r = data[p], g = data[p + 1], b = data[p + 2]
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b
    L[i] = l; hist[Math.min(255, l | 0)]++
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
    S[i] = mx === 0 ? 0 : (mx - mn) / mx
  }
  const q = (f) => { let a = 0, t = f * N; for (let v = 0; v < 256; v++) { a += hist[v]; if (a >= t) return v } return 255 }
  const med = q(0.5) || 1, p95 = q(0.95), p05 = q(0.05)

  let satSum = 0
  for (let i = 0; i < N; i++) satSum += S[i]
  const bright = q(0.90)
  let bSat = 0, bN = 0
  for (let i = 0; i < N; i++) if (L[i] >= bright) { bSat += S[i]; bN++ }

  let lap = 0
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x
    lap += Math.abs(4 * L[i] - L[i - 1] - L[i + 1] - L[i - W] - L[i + W])
  }
  return {
    meanSat: satSum / N,              // bleaching desaturates the whole face
    brightSat: bN ? bSat / bN : 0,    // ...and the highlight most of all
    dynRange: (p95 - p05) / med,      // sheen compresses local contrast
    contrast: p95 / med,
    hf: lap / ((W - 2) * (H - 2) * med),
  }
}

const KEYS = ['meanSat', 'brightSat', 'dynRange', 'contrast', 'hf']
const files = readdirSync(`${DIR}/canon`).filter((f) => f.endsWith('.png')).sort()
const rows = []
for (const f of files) {
  const id = f.split('__')[0]
  rows.push({ id, ...LABEL.get(id), ...(await features(`${DIR}/canon/${f}`)) })
}
writeFileSync(`${DIR}/frames2.json`, JSON.stringify(rows, null, 2))

// ── within-pair comparison ────────────────────────────────────────────────────
const pairs = new Map()
for (const r of rows) {
  const key = `${r.light}|${r.card}`
  if (!pairs.has(key)) pairs.set(key, { normal: [], reverse: [] })
  pairs.get(key)[r.variant].push(r)
}

const auc = (R, N, k) => {
  let w = 0
  for (const r of R) for (const n of N) w += r[k] > n[k] ? 1 : r[k] === n[k] ? 0.5 : 0
  return w / (R.length * N.length)
}
const mean = (a, k) => a.reduce((s, r) => s + r[k], 0) / a.length

console.log('\nWITHIN-PAIR  (AUC: 1.0 = reverse always higher, 0.0 = always lower, 0.5 = nothing)')
const collected = {}
for (const [key, p] of pairs) {
  if (!p.normal.length || !p.reverse.length) { console.log(`  ${key}  — skipped (n=${p.normal.length}, r=${p.reverse.length})`); continue }
  console.log(`\n  ${key}   n=${p.normal.length} normal, ${p.reverse.length} reverse`)
  for (const k of KEYS) {
    const a = auc(p.reverse, p.normal, k)
    collected[k] = collected[k] || []
    collected[k].push(a)
    const arrow = a >= 0.8 ? ' ++' : a <= 0.2 ? ' --' : ''
    console.log(`    ${k.padEnd(10)} AUC=${a.toFixed(2)}  normal=${mean(p.normal, k).toFixed(4)}  reverse=${mean(p.reverse, k).toFixed(4)}${arrow}`)
  }
}
console.log('\nCONSISTENCY across pairs (mean AUC, and how many pairs agree on direction):')
for (const k of KEYS) {
  const a = collected[k] || []
  if (!a.length) continue
  const m = a.reduce((s, v) => s + v, 0) / a.length
  const hi = a.filter((v) => v > 0.5).length
  console.log(`  ${k.padEnd(10)} mean=${m.toFixed(2)}  ${hi}/${a.length} pairs above 0.5  [${a.map((v) => v.toFixed(2)).join(' ')}]`)
}
