/**
 * Rectify the card: find its four corners, warp to a canonical fronto-parallel
 * card, sample in card space.
 *
 * THIS EXISTS BECAUSE THE PREVIOUS PASS SELECTED AGAINST ITS OWN SIGNAL. Filtering
 * blobs by "is the bounding box card-shaped" keeps cards held FLAT and rejects
 * cards held at an angle — but foil sheen only fires at an angle, so the filter
 * was quietly throwing away every frame where the effect was visible. The tell was
 * `led-weedle-reverse` keeping 0 of 15 frames: that is the segment with the most
 * obvious sheen in the entire dataset.
 *
 * A tilted card is not a bad frame to be discarded, it is the frame that carries
 * the information. So instead of rejecting the tilt, undo it: four corners give a
 * homography, the homography gives card space, and in card space a given pixel is
 * the same place on the card no matter how the card was held.
 */
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const sharp = createRequire('/home/cheyras/deckpal/package.json')('sharp')

const DIR = '/tmp/claude-1000/-home-cheyras/b64a0301-b0e7-4e67-976e-46366638fbd3/scratchpad/foil'
const WORK = 300
const OUT_W = 320, OUT_H = 448

function otsu(hist, total) {
  let sum = 0
  for (let i = 0; i < 256; i++) sum += i * hist[i]
  let sumB = 0, wB = 0, best = 0, thr = 128
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (!wB) continue
    const wF = total - wB; if (!wF) break
    sumB += t * hist[t]
    const mB = sumB / wB, mF = (sum - sumB) / wF
    const b = wB * wF * (mB - mF) * (mB - mF)
    if (b > best) { best = b; thr = t }
  }
  return thr
}

/** Largest 4-connected blob, returned as its member pixel list. */
function largestBlob(mask, W, H) {
  const seen = new Uint8Array(W * H)
  const stack = new Int32Array(W * H)
  let best = null
  for (let s = 0; s < W * H; s++) {
    if (!mask[s] || seen[s]) continue
    let sp = 0
    const pts = []
    stack[sp++] = s; seen[s] = 1
    while (sp) {
      const i = stack[--sp], x = i % W, y = (i / W) | 0
      pts.push(x, y)
      if (x > 0 && mask[i - 1] && !seen[i - 1]) { seen[i - 1] = 1; stack[sp++] = i - 1 }
      if (x < W - 1 && mask[i + 1] && !seen[i + 1]) { seen[i + 1] = 1; stack[sp++] = i + 1 }
      if (y > 0 && mask[i - W] && !seen[i - W]) { seen[i - W] = 1; stack[sp++] = i - W }
      if (y < H - 1 && mask[i + W] && !seen[i + W]) { seen[i + W] = 1; stack[sp++] = i + W }
    }
    if (!best || pts.length > best.length) best = pts
  }
  return best
}

/**
 * Four corners of a quadrilateral blob.
 *
 * The extremes of (x+y) and (x−y) land on the corners of a rotated rectangle,
 * which is what a card is. It degrades gracefully: at 45° the two measures tie
 * and the quad is still the card's, just relabelled — and relabelling is harmless
 * because a rotated card rectifies to a rotated canonical card, and every feature
 * downstream is rotation-invariant.
 */
function corners(pts) {
  let tl = 0, br = 0, tr = 0, bl = 0
  let tlV = Infinity, brV = -Infinity, trV = -Infinity, blV = Infinity
  for (let i = 0; i < pts.length; i += 2) {
    const x = pts[i], y = pts[i + 1]
    const s = x + y, d = x - y
    if (s < tlV) { tlV = s; tl = i }
    if (s > brV) { brV = s; br = i }
    if (d > trV) { trV = d; tr = i }
    if (d < blV) { blV = d; bl = i }
  }
  return [tl, tr, br, bl].map((i) => [pts[i], pts[i + 1]])
}

/** Solve the 8×8 system for H mapping DEST → SRC (inverse warp). */
function homography(dst, src) {
  const A = [], b = []
  for (let i = 0; i < 4; i++) {
    const [u, v] = dst[i], [x, y] = src[i]
    A.push([u, v, 1, 0, 0, 0, -u * x, -v * x]); b.push(x)
    A.push([0, 0, 0, u, v, 1, -u * y, -v * y]); b.push(y)
  }
  for (let c = 0; c < 8; c++) {
    let piv = c
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r
    if (Math.abs(A[piv][c]) < 1e-9) return null
    ;[A[c], A[piv]] = [A[piv], A[c]]; [b[c], b[piv]] = [b[piv], b[c]]
    for (let r = 0; r < 8; r++) {
      if (r === c) continue
      const f = A[r][c] / A[c][c]
      if (!f) continue
      for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k]
      b[r] -= f * b[c]
    }
  }
  const h = b.map((v, i) => v / A[i][i])
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1]
}

export async function rectify(file) {
  const meta = await sharp(file).metadata()
  const small = await sharp(file).resize({ width: WORK }).greyscale().raw().toBuffer({ resolveWithObject: true })
  const W = small.info.width, H = small.info.height
  const hist = new Uint32Array(256)
  for (let i = 0; i < W * H; i++) hist[small.data[i]]++
  const thr = otsu(hist, W * H)
  const mask = new Uint8Array(W * H)
  for (let i = 0; i < W * H; i++) mask[i] = small.data[i] > thr ? 1 : 0
  const blob = largestBlob(mask, W, H)
  if (!blob || blob.length / 2 < W * H * 0.06) return null

  const scale = meta.width / W
  const src = corners(blob).map(([x, y]) => [x * scale, y * scale])
  // Reject degenerate quads (a sliver, or corners that collapsed together).
  const side = (a, b) => Math.hypot(src[a][0] - src[b][0], src[a][1] - src[b][1])
  const w = (side(0, 1) + side(3, 2)) / 2, h = (side(0, 3) + side(1, 2)) / 2
  if (w < 40 || h < 40) return null
  const ratio = w / h
  if (ratio > 1.6 || ratio < 0.25) return null

  const dst = [[0, 0], [OUT_W - 1, 0], [OUT_W - 1, OUT_H - 1], [0, OUT_H - 1]]
  const Hm = homography(dst, src)
  if (!Hm) return null

  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true })
  const C = info.channels, SW = info.width, SH = info.height
  const out = Buffer.alloc(OUT_W * OUT_H * 3)
  for (let v = 0; v < OUT_H; v++) {
    for (let u = 0; u < OUT_W; u++) {
      const d = Hm[6] * u + Hm[7] * v + Hm[8]
      const x = (Hm[0] * u + Hm[1] * v + Hm[2]) / d
      const y = (Hm[3] * u + Hm[4] * v + Hm[5]) / d
      const o = (v * OUT_W + u) * 3
      if (x < 0 || y < 0 || x >= SW - 1 || y >= SH - 1) continue
      const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0
      for (let c = 0; c < 3; c++) {
        const p00 = data[(y0 * SW + x0) * C + c], p10 = data[(y0 * SW + x0 + 1) * C + c]
        const p01 = data[((y0 + 1) * SW + x0) * C + c], p11 = data[((y0 + 1) * SW + x0 + 1) * C + c]
        out[o + c] = (p00 * (1 - fx) * (1 - fy) + p10 * fx * (1 - fy) + p01 * (1 - fx) * fy + p11 * fx * fy) | 0
      }
    }
  }
  return { buf: out, ratio }
}

if (process.argv[1].endsWith('rectify.mjs')) {
  mkdirSync(`${DIR}/rect`, { recursive: true })
  const files = readdirSync(`${DIR}/full`).filter((f) => f.endsWith('.png')).sort()
  const report = {}
  let ok = 0
  for (const f of files) {
    const r = await rectify(`${DIR}/full/${f}`)
    report[f] = r ? { ratio: r.ratio } : null
    if (!r) continue
    await sharp(r.buf, { raw: { width: OUT_W, height: OUT_H, channels: 3 } }).toFile(`${DIR}/rect/${f}`)
    ok++
  }
  writeFileSync(`${DIR}/rectboxes.json`, JSON.stringify(report, null, 2))
  const bySeg = {}
  for (const f of files) {
    const id = f.split('__')[0]
    bySeg[id] = bySeg[id] || { kept: 0, total: 0 }
    bySeg[id].total++
    if (report[f]) bySeg[id].kept++
  }
  console.log(`rectified ${ok}/${files.length}`)
  for (const [id, v] of Object.entries(bySeg)) console.log(`  ${id.padEnd(24)} ${v.kept}/${v.total}`)
}
