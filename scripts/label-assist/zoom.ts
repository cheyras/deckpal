/**
 * Pass 2: corner close-ups for every card/back suggestion, so the fleet can
 * place each corner to about a pixel.
 *
 *   node --import tsx scripts/label-assist/zoom.ts <validate|queue>   # render
 *
 * Pass 1 (a whole-square view) gets the verdict right, but its corners land a
 * median ~9.5 px (of 416) from the owner's, and the shipping refiner only
 * moves a corner 1–3 px, so it cannot close that gap. Here each corner gets a
 * 100x100 canonical-px window, magnified 3x, with a grid where 1 unit is 1 px
 * of the square. The current corner sits at the window's centre (50,50).
 *
 * Reads suggestions-<mode>.json (merge.ts) and work/<mode>/<id>.frame.png, and
 * writes work/<mode>/<id>.corners.png plus work/<mode>/<id>.corners.json
 * (each window's origin, in canonical px).
 */
import fs from 'node:fs'
import path from 'node:path'

import sharp from 'sharp'

import { CANONICAL_SIZE, DATA, squareOf } from './cv.js'

const mode = process.argv[2] === 'validate' ? 'validate' : 'queue'
const WORK = path.join(DATA, 'work', mode)
const WIN = Number(process.env.WIN ?? 100)
const S = 300
const Z = S / WIN
const NAMES = ['card TOP-LEFT', 'card TOP-RIGHT', 'card BOTTOM-RIGHT', 'card BOTTOM-LEFT']

const SUGG = process.env.SUGG ?? `suggestions-${mode}.json`
const sugg: Record<string, { verdict: string; crop: { x: number; y: number; size: number } | null; corners?: number[][]; topLeftIndex?: number }> =
  JSON.parse(fs.readFileSync(path.join(DATA, SUGG), 'utf8'))

function overlay(title: string): string {
  const parts: string[] = []
  for (let i = 0; i <= 10; i++) {
    const g = i * (S / 10)
    const op = i === 5 ? 0.0 : i % 5 === 0 ? 0.6 : 0.3
    parts.push(`<line x1="${g}" y1="0" x2="${g}" y2="${S}" stroke="#00e5ff" stroke-opacity="${op}"/><line x1="0" y1="${g}" x2="${S}" y2="${g}" stroke="#00e5ff" stroke-opacity="${op}"/>`)
    if (i < 10) parts.push(`<text x="${g + 2}" y="10" font-size="9" font-family="Arial" fill="#00e5ff" stroke="#000" stroke-width="0.3">${i * 10}</text><text x="2" y="${g + 10}" font-size="9" font-family="Arial" fill="#00e5ff" stroke="#000" stroke-width="0.3">${i * 10}</text>`)
  }
  // the current corner: a small ring at the centre, never covering the pixels under it
  parts.push(`<circle cx="${S / 2}" cy="${S / 2}" r="7" fill="none" stroke="#ff2020" stroke-width="1.5"/>`)
  parts.push(`<rect x="0" y="${S - 16}" width="${S}" height="16" fill="#000" fill-opacity="0.65"/><text x="4" y="${S - 4}" font-size="11" font-family="Arial" fill="#fff">${title}</text>`)
  return `<svg width="${S}" height="${S}" xmlns="http://www.w3.org/2000/svg">${parts.join('')}</svg>`
}

let n = 0
for (const [id, s] of Object.entries(sugg)) {
  if (s.verdict === 'reject' || !s.corners) continue
  // The frame the suggestion's corners are in (merge.ts may have re-cropped).
  let frame = await sharp(path.join(WORK, `${id}.frame.png`)).ensureAlpha().raw().toBuffer()
  const prop = JSON.parse(fs.readFileSync(path.join(WORK, `${id}.json`), 'utf8'))
  if (mode === 'queue' && s.crop && JSON.stringify(s.crop) !== JSON.stringify(prop.crop)) {
    const raw = path.join(process.env.USERPROFILE ?? '', 'deckpal-data', 'quad-queue', 'raw', `${id}.jpg`)
    frame = await squareOf(fs.readFileSync(raw), s.crop, CANONICAL_SIZE)
  }
  const tl = s.topLeftIndex ?? 0
  const origins: number[][] = []
  const tiles: sharp.OverlayOptions[] = []
  for (let k = 0; k < 4; k++) {
    const idx = (tl + k) % 4
    const [cx, cy] = [s.corners[idx]![0]! * CANONICAL_SIZE, s.corners[idx]![1]! * CANONICAL_SIZE]
    const ox = Math.round(cx - WIN / 2)
    const oy = Math.round(cy - WIN / 2)
    origins.push([ox, oy])
    const left = Math.max(0, -ox), top = Math.max(0, -oy)
    const right = Math.max(0, ox + WIN - CANONICAL_SIZE), bottom = Math.max(0, oy + WIN - CANONICAL_SIZE)
    let tile = sharp(frame, { raw: { width: CANONICAL_SIZE, height: CANONICAL_SIZE, channels: 4 } })
    if (left || top || right || bottom) tile = sharp(await tile.extend({ left, top, right, bottom, background: '#000000' }).png().toBuffer())
    const img = await tile.extract({ left: ox + left, top: oy + top, width: WIN, height: WIN }).resize(S, S, { kernel: 'lanczos3' }).png().toBuffer()
    tiles.push({ input: await sharp(img).composite([{ input: Buffer.from(overlay(`${k + 1}: ${NAMES[k]} (red ring = current guess)`)) }]).png().toBuffer(), left: (k % 2) * (S + 6), top: Math.floor(k / 2) * (S + 6) })
  }
  // Context: the whole square, the current quad, corners numbered as the tiles are.
  const C = S * 2 + 6
  const k = C / CANONICAL_SIZE
  const ordered = [0, 1, 2, 3].map((j) => s.corners![(tl + j) % 4]!.map((v) => v * CANONICAL_SIZE * k))
  const ctxSvg = `<svg width="${C}" height="${C}" xmlns="http://www.w3.org/2000/svg"><polygon points="${ordered.map((p) => p.join(',')).join(' ')}" fill="none" stroke="#ff2020" stroke-width="2"/>${ordered
    .map(([x, y], j) => `<circle cx="${x}" cy="${y}" r="10" fill="#ff2020"/><text x="${x! - 4}" y="${y! + 5}" font-size="13" font-family="Arial" font-weight="bold" fill="#fff">${j + 1}</text>`)
    .join('')}<rect x="0" y="${C - 18}" width="${C}" height="18" fill="#000" fill-opacity="0.65"/><text x="4" y="${C - 5}" font-size="12" font-family="Arial" fill="#fff">CONTEXT: the whole square; red = current quad; numbers match the close-ups</text></svg>`
  const ctx = await sharp(frame, { raw: { width: CANONICAL_SIZE, height: CANONICAL_SIZE, channels: 4 } }).resize(C, C).composite([{ input: Buffer.from(ctxSvg) }]).png().toBuffer()
  for (const t of tiles) t.left = (t.left as number) + C + 10
  const sheet = await sharp({ create: { width: C * 2 + 10, height: C, channels: 3, background: '#ffffff' } }).composite([{ input: ctx, left: 0, top: 0 }, ...tiles]).png().toBuffer()
  fs.writeFileSync(path.join(WORK, `${id}.corners.png`), sheet)
  fs.writeFileSync(path.join(WORK, `${id}.corners.json`), JSON.stringify({ origins, win: WIN, order: [0, 1, 2, 3].map((k) => (tl + k) % 4) }))
  n++
}
console.log(`corner sheets: ${n} -> ${WORK}`)
