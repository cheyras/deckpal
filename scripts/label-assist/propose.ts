/**
 * Detector proposals + review images for the Sonnet labelling fleet.
 *
 *   node --import tsx scripts/label-assist/propose.ts queue        # every queued photo
 *   node --import tsx scripts/label-assist/propose.ts validate     # the owner's labelled frames, blind
 *
 * QUEUE MODE, per photo ($LABEL_ASSIST_DIR/queue.json, photos in
 * ~/deckpal-data/quad-queue/raw):
 *   1. the whole photo as one mirrored square, through the detector, to find a card;
 *   2. if it found one: a crop the way the owner crops (card centred, its long
 *      side ~68% of the square: 71 owner positives, p10 45%, p90 84%);
 *      otherwise the centre square, the owner's other habit (60 of 133 uploads);
 *   3. the detector again on that crop, for the proposal's corners.
 * VALIDATE MODE uses the owner's own saved frames (the crop is theirs), so the
 * fleet's verdicts and corners can be scored against the owner before it is
 * trusted with the queue.
 *
 * Writes, per item: work/<mode>/<id>.json (proposal), <id>.frame.png (the 416
 * canonical square), <id>.review.png (what an agent looks at).
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import sharp from 'sharp'

import type { Quad } from '../../apps/web/src/scan/engine/contract.js'
import { CANONICAL_SIZE, DATA, DEFAULT_ACQUIRE, Lc050, centreSquare, detect, photoSize, squareOf, type Crop } from './cv.js'

const mode = process.argv[2] === 'validate' ? 'validate' : 'queue'
const RAW = path.join(os.homedir(), 'deckpal-data', 'quad-queue', 'raw')
const OUT = path.join(DATA, 'work', mode)
fs.mkdirSync(OUT, { recursive: true })

/** Owner convention: the card's long side over the crop's side (median of 71 positives). */
const CARD_FILL = 0.68
const P = 520 // review panel size

function quadLongSide(q: Quad): number {
  const d = (a: number[], b: number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!)
  return Math.max((d(q[0], q[1]) + d(q[2], q[3])) / 2, (d(q[1], q[2]) + d(q[3], q[0])) / 2)
}

/** Grid + quad overlay for one square panel. `quad` in panel px. */
function panelSvg(quad: Quad | null, title: string, cropBox?: { x: number; y: number; w: number; h: number }, gridBox = { x: 0, y: 0, w: P, h: P }): string {
  const lines: string[] = []
  for (let i = 0; i <= 10; i++) {
    const gx = gridBox.x + (gridBox.w * i) / 10
    const gy = gridBox.y + (gridBox.h * i) / 10
    const op = i % 5 === 0 ? 0.55 : 0.28
    lines.push(`<line x1="${gx}" y1="${gridBox.y}" x2="${gx}" y2="${gridBox.y + gridBox.h}" stroke="#00e5ff" stroke-opacity="${op}" stroke-width="1"/>`)
    lines.push(`<line x1="${gridBox.x}" y1="${gy}" x2="${gridBox.x + gridBox.w}" y2="${gy}" stroke="#00e5ff" stroke-opacity="${op}" stroke-width="1"/>`)
    lines.push(`<text x="${gx + 2}" y="${gridBox.y + 11}" font-size="10" font-family="Arial" fill="#00e5ff" stroke="#000" stroke-width="0.4">${i * 10}</text>`)
    if (i > 0) lines.push(`<text x="${gridBox.x + 2}" y="${gy - 2}" font-size="10" font-family="Arial" fill="#00e5ff" stroke="#000" stroke-width="0.4">${i * 10}</text>`)
  }
  if (cropBox) lines.push(`<rect x="${cropBox.x}" y="${cropBox.y}" width="${cropBox.w}" height="${cropBox.h}" fill="none" stroke="#ffd400" stroke-width="2" stroke-dasharray="6 4"/>`)
  if (quad) {
    lines.push(`<polygon points="${quad.map((p) => p.join(',')).join(' ')}" fill="none" stroke="#ff2020" stroke-width="2"/>`)
    quad.forEach(([x, y], i) => {
      lines.push(`<circle cx="${x}" cy="${y}" r="9" fill="#ff2020"/><text x="${x - 3.5}" y="${y + 4}" font-size="12" font-family="Arial" font-weight="bold" fill="#fff">${i + 1}</text>`)
    })
  }
  lines.push(`<rect x="0" y="${P - 18}" width="${P}" height="18" fill="#000" fill-opacity="0.6"/><text x="4" y="${P - 5}" font-size="12" font-family="Arial" fill="#fff">${title}</text>`)
  return `<svg width="${P}" height="${P}" xmlns="http://www.w3.org/2000/svg">${lines.join('')}</svg>`
}

async function rgbaPng(rgba: Buffer, size: number, to: number): Promise<Buffer> {
  return sharp(rgba, { raw: { width: size, height: size, channels: 4 } }).resize(to, to).png().toBuffer()
}

interface Item {
  id: string
  photo?: string
  frame?: string
}

const lc = new Lc050()
let items: Item[]
if (mode === 'queue') {
  const q: { id: number }[] = JSON.parse(fs.readFileSync(path.join(DATA, 'queue.json'), 'utf8'))
  items = q.map((p) => ({ id: String(p.id), photo: path.join(RAW, `${p.id}.jpg`) })).filter((i) => fs.existsSync(i.photo!))
} else {
  const ids: string[] = JSON.parse(fs.readFileSync(path.join(DATA, 'validate-ids.json'), 'utf8'))
  items = ids.map((id) => ({ id, frame: path.join(DATA, 'labels', `${id}.png`) }))
}
const limit = Number(process.env.LIMIT ?? Infinity)
let done = 0
for (const it of items.slice(0, limit)) {
  const outJson = path.join(OUT, `${it.id}.json`)
  if (fs.existsSync(outJson) && fs.existsSync(path.join(OUT, `${it.id}.review.png`))) {
    done++
    continue
  }
  let frame: Buffer
  let crop: Crop | null = null
  let photoInfo: { width: number; height: number } | null = null
  let firstObj: number | null = null
  let photoPanel: Buffer | null = null
  if (it.photo) {
    const bytes = fs.readFileSync(it.photo)
    photoInfo = await photoSize(bytes)
    const { width: w, height: h } = photoInfo
    const L = Math.max(w, h)
    const whole: Crop = { x: Math.round((w - L) / 2), y: Math.round((h - L) / 2), size: L }
    const d1 = await detect(lc, await squareOf(bytes, whole, CANONICAL_SIZE))
    firstObj = d1.hasObj
    if (d1.hasObj >= DEFAULT_ACQUIRE && d1.quad) {
      const k = L / CANONICAL_SIZE
      const qp = d1.quad.map(([x, y]) => [whole.x + x * k, whole.y + y * k]) as Quad
      const cx = qp.reduce((s, p) => s + p[0], 0) / 4
      const cy = qp.reduce((s, p) => s + p[1], 0) / 4
      const size = Math.round(Math.min(quadLongSide(qp) / CARD_FILL, L * 1.2))
      crop = { x: Math.round(cx - size / 2), y: Math.round(cy - size / 2), size }
    } else crop = centreSquare(w, h)
    frame = await squareOf(bytes, crop, CANONICAL_SIZE)
    // The photo panel: the whole photo fitted into P, with the crop drawn.
    const s = Math.min(P / w, P / h)
    const pw = Math.round(w * s)
    const ph = Math.round(h * s)
    const ox = Math.round((P - pw) / 2)
    const oy = Math.round((P - ph) / 2)
    const base = await sharp(await sharp(bytes).rotate().toBuffer()).resize(pw, ph).toBuffer()
    const svg = panelSvg(null, 'WHOLE PHOTO (yellow = proposed square); grid = % of photo', { x: ox + crop.x * s, y: oy + crop.y * s, w: crop.size * s, h: crop.size * s }, { x: ox, y: oy, w: pw, h: ph })
    photoPanel = await sharp({ create: { width: P, height: P, channels: 3, background: '#202020' } })
      .composite([{ input: base, left: ox, top: oy }, { input: Buffer.from(svg), left: 0, top: 0 }])
      .png()
      .toBuffer()
  } else {
    frame = await sharp(it.frame!).resize(CANONICAL_SIZE, CANONICAL_SIZE).ensureAlpha().raw().toBuffer()
  }
  const d2 = await detect(lc, frame)
  const k = P / CANONICAL_SIZE
  // Drawn only when the detector actually fires: a proposal it does not believe
  // in is noise, and noise on the picture anchors a reviewer.
  const quadPanel = d2.quad && d2.hasObj >= 0.5 ? (d2.quad.map(([x, y]) => [x * k, y * k]) as Quad) : null
  const framePanel = await sharp(await rgbaPng(frame, CANONICAL_SIZE, P))
    .composite([{ input: Buffer.from(panelSvg(quadPanel, `SQUARE TO LABEL; red = detector proposal (presence ${d2.hasObj.toFixed(2)}); grid = %`)), left: 0, top: 0 }])
    .png()
    .toBuffer()
  const review = await sharp({ create: { width: photoPanel ? P * 2 + 8 : P, height: P, channels: 3, background: '#ffffff' } })
    .composite([{ input: framePanel, left: 0, top: 0 }, ...(photoPanel ? [{ input: photoPanel, left: P + 8, top: 0 }] : [])])
    .png()
    .toBuffer()
  fs.writeFileSync(path.join(OUT, `${it.id}.review.png`), review)
  fs.writeFileSync(path.join(OUT, `${it.id}.frame.png`), await rgbaPng(frame, CANONICAL_SIZE, CANONICAL_SIZE))
  fs.writeFileSync(
    outJson,
    JSON.stringify({
      id: it.id,
      photo: photoInfo,
      crop,
      wholePhotoPresence: firstObj,
      presence: +d2.hasObj.toFixed(3),
      // canonical fractions, the label's own units
      quad: d2.quad ? d2.quad.map(([x, y]) => [x / CANONICAL_SIZE, y / CANONICAL_SIZE]) : null,
    }),
  )
  if (++done % 50 === 0) console.log(`${done}/${items.length}`)
}
await lc.close()
console.log(`done ${done} -> ${OUT}`)
