/**
 * Find the card in a frame and crop to its interior.
 *
 * Why this exists: the first measurement pass scored at chance, and the cause was
 * framing rather than the phenomenon — the crop was ~40% hand, table and
 * background, while production crops to an on-screen guide and sees almost pure
 * card. Measuring a card-local effect over a mostly-not-card region cannot work.
 *
 * The method is deliberately blunt, because it only has to be good enough to make
 * frames comparable: threshold for "bright", take the largest connected blob,
 * take its bounding box, then INSET hard. The inset is the important part — it
 * throws away the sleeve edge, the white card border and any background that
 * leaked into the box, and what remains is card face. A tight, slightly-too-small
 * crop of guaranteed card beats a generous crop of maybe-card.
 */
import { readdirSync, mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const sharp = createRequire('/home/cheyras/deckpal/package.json')('sharp')

const DIR = '/tmp/claude-1000/-home-cheyras/b64a0301-b0e7-4e67-976e-46366638fbd3/scratchpad/foil'
const WORK = 240          // detection resolution — small is fine and fast
const INSET = 0.16        // fraction of the box trimmed off each side

/** Otsu's threshold over a 256-bin histogram. */
function otsu(hist, total) {
  let sum = 0
  for (let i = 0; i < 256; i++) sum += i * hist[i]
  let sumB = 0, wB = 0, best = 0, thr = 128
  for (let t = 0; t < 256; t++) {
    wB += hist[t]
    if (!wB) continue
    const wF = total - wB
    if (!wF) break
    sumB += t * hist[t]
    const mB = sumB / wB, mF = (sum - sumB) / wF
    const between = wB * wF * (mB - mF) * (mB - mF)
    if (between > best) { best = between; thr = t }
  }
  return thr
}

/** Largest 4-connected blob of `mask`, as a bounding box. */
function largestBlob(mask, W, H) {
  const seen = new Uint8Array(W * H)
  let best = null
  const stack = new Int32Array(W * H)
  for (let s = 0; s < W * H; s++) {
    if (!mask[s] || seen[s]) continue
    let sp = 0, n = 0
    stack[sp++] = s; seen[s] = 1
    let x0 = W, y0 = H, x1 = 0, y1 = 0
    while (sp) {
      const i = stack[--sp], x = i % W, y = (i / W) | 0
      n++
      if (x < x0) x0 = x; if (x > x1) x1 = x
      if (y < y0) y0 = y; if (y > y1) y1 = y
      if (x > 0 && mask[i - 1] && !seen[i - 1]) { seen[i - 1] = 1; stack[sp++] = i - 1 }
      if (x < W - 1 && mask[i + 1] && !seen[i + 1]) { seen[i + 1] = 1; stack[sp++] = i + 1 }
      if (y > 0 && mask[i - W] && !seen[i - W]) { seen[i - W] = 1; stack[sp++] = i - W }
      if (y < H - 1 && mask[i + W] && !seen[i + W]) { seen[i + W] = 1; stack[sp++] = i + W }
    }
    if (!best || n > best.n) best = { n, x0, y0, x1, y1 }
  }
  return best
}

export async function findCard(file) {
  const meta = await sharp(file).metadata()
  const { data, info } = await sharp(file)
    .resize({ width: WORK }).greyscale().raw().toBuffer({ resolveWithObject: true })
  const W = info.width, H = info.height
  const hist = new Uint32Array(256)
  for (let i = 0; i < W * H; i++) hist[data[i]]++
  const thr = otsu(hist, W * H)
  const mask = new Uint8Array(W * H)
  for (let i = 0; i < W * H; i++) mask[i] = data[i] > thr ? 1 : 0
  const blob = largestBlob(mask, W, H)
  if (!blob) return null
  const frac = blob.n / (W * H)
  if (frac < 0.08) return null                       // nothing card-sized found

  const scale = meta.width / W
  const bw = blob.x1 - blob.x0, bh = blob.y1 - blob.y0
  const left = Math.round((blob.x0 + bw * INSET) * scale)
  const top = Math.round((blob.y0 + bh * INSET) * scale)
  const width = Math.round(bw * (1 - 2 * INSET) * scale)
  const height = Math.round(bh * (1 - 2 * INSET) * scale)
  if (width < 60 || height < 60) return null
  return { left, top, width, height, frac }
}

if (process.argv[1].endsWith('cardcrop.mjs')) {
  mkdirSync(`${DIR}/cards`, { recursive: true })
  const files = readdirSync(`${DIR}/set`).filter((f) => f.endsWith('.png')).sort()
  const report = {}
  let ok = 0, fail = 0
  for (const f of files) {
    const box = await findCard(`${DIR}/set/${f}`)
    if (!box) { fail++; report[f] = null; continue }
    await sharp(`${DIR}/set/${f}`).extract(box).toFile(`${DIR}/cards/${f}`)
    report[f] = box
    ok++
  }
  writeFileSync(`${DIR}/cardboxes.json`, JSON.stringify(report, null, 2))
  console.log(`located ${ok}, failed ${fail}`)
}
