// Contact sheets: the captures as a reader would see them, and a timeline of
// what the virtual phone was looking at — so "why was this card never
// captured?" can be answered by eye instead of by reading frames.jsonl.

import { sharp } from '../../../apps/web/src/scan/engine/__tests__/offline-harness'

export interface Tile {
  /** Encoded image (JPEG/PNG) or raw RGBA with its size. */
  image: Buffer | { data: Uint8ClampedArray | Buffer; width: number; height: number; channels: 3 | 4 }
  lines: string[]
  /** Optional frame colour, e.g. to mark a capture tick on the timeline. */
  border?: string
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * Grid of tiles with up to two caption lines under each and a title bar.
 * Text is ONE svg composited over the whole sheet (librsvg renders it), which
 * is far cheaper than an svg per tile.
 */
export async function contactSheet(
  tiles: readonly Tile[],
  opts: { thumbW: number; thumbH: number; cols: number; title: string[]; out: string },
): Promise<void> {
  const S = await sharp()
  const pad = 6
  const capH = 30
  const titleH = 18 * opts.title.length + 12
  const cols = Math.max(1, Math.min(opts.cols, tiles.length || 1))
  const rows = Math.max(1, Math.ceil(tiles.length / cols))
  const cellW = opts.thumbW + pad
  const cellH = opts.thumbH + capH + pad
  const W = pad + cols * cellW
  const H = titleH + pad + rows * cellH
  const composites: Array<Record<string, unknown>> = []
  const text: string[] = []
  opts.title.forEach((t, i) =>
    text.push(`<text x="${pad}" y="${20 + i * 18}" font-size="15" fill="#eee">${esc(t)}</text>`),
  )
  for (let k = 0; k < tiles.length; k++) {
    const tile = tiles[k]
    const x = pad + (k % cols) * cellW
    const y = titleH + pad + Math.floor(k / cols) * cellH
    const src = Buffer.isBuffer(tile.image)
      ? S(tile.image)
      : S(Buffer.from(tile.image.data.buffer, tile.image.data.byteOffset, tile.image.data.byteLength), {
          raw: { width: tile.image.width, height: tile.image.height, channels: tile.image.channels },
        })
    const thumb = await src.resize({ width: opts.thumbW, height: opts.thumbH, fit: 'fill' }).png().toBuffer()
    composites.push({ input: thumb, left: x, top: y })
    if (tile.border) {
      text.push(
        `<rect x="${x - 2}" y="${y - 2}" width="${opts.thumbW + 4}" height="${opts.thumbH + 4}" fill="none" stroke="${tile.border}" stroke-width="3"/>`,
      )
    }
    tile.lines.slice(0, 2).forEach((l, i) =>
      text.push(
        `<text x="${x + 1}" y="${y + opts.thumbH + 12 + i * 13}" font-size="11" fill="${i === 0 ? '#ffd400' : '#bbb'}">${esc(l)}</text>`,
      ),
    )
  }
  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg" font-family="Consolas, monospace">${text.join('')}</svg>`
  composites.push({ input: Buffer.from(svg), left: 0, top: 0 })
  await S({ create: { width: W, height: H, channels: 3, background: { r: 24, g: 24, b: 28 } } })
    .composite(composites)
    .png()
    .toFile(opts.out)
}
