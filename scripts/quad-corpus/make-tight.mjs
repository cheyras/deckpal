#!/usr/bin/env node
/**
 * Build a TIGHT-FRAMING test corpus from a split of the real one.
 *
 *   node scripts/quad-corpus/make-tight.mjs [--split test] [--fill 0.85,0.92] [--out <dir>]
 *
 * The labelled corpus has few close-ups (card bounding box spanning >= 80% of
 * the square's side, metrics.ts TIGHT_EXTENT), which is exactly where LC050
 * outlines the text panel instead of the card (HARVEST.md §5). Until more real
 * tight framings are labelled, this crops each positive of the chosen split so
 * the card's bounding box spans a target share of a new square's side,
 * resamples it to the canonical size, and maps the corners exactly. Two crops
 * per card (one per --fill value; a side share, not an area).
 *
 * CAVEAT, and it matters: the pixels are UPSCALED from a card that filled ~30%
 * of a 416 px frame, so they are softer than a real phone photo taken close up.
 * A model that wins here has learned the margin regime; a real tight-framing
 * test set is still the arbiter.
 *
 * Writes <out>/manifest.jsonl + <out>/raw/*.png in the harvest's format, so
 * `eval.ts --corpus <out> --split all` scores it like any corpus.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..')
const arg = (k, d) => {
  const i = process.argv.indexOf(k)
  return i >= 0 ? process.argv[i + 1] : d
}
const SRC = process.env.QUAD_CORPUS_DIR ?? path.join(os.homedir(), 'deckpal-data', 'quad-corpus')
const SPLIT = arg('--split', 'test')
const FILLS = arg('--fill', '0.85,0.92').split(',').map(Number)
const OUT = arg('--out', path.join(path.dirname(SRC), `quad-corpus-tight-${SPLIT}`))
const SIZE = 416

let sharp
try {
  sharp = createRequire(path.join(REPO, 'package.json'))('sharp')
} catch {
  sharp = createRequire(path.resolve(REPO, '..', '..', 'deckpal', 'package.json'))('sharp')
}

const split = JSON.parse(fs.readFileSync(path.join(SRC, 'split.json'), 'utf8'))
const manifestBytes = fs.readFileSync(path.join(SRC, split.manifest?.file ?? 'manifest.jsonl'))
// The same check split.ts and dataset.py make: a split frozen from another
// manifest could hand this script TRAIN cards labelled as test.
const digest = (await import('node:crypto')).createHash('sha256').update(manifestBytes).digest('hex')
if (digest !== split.manifest?.sha256) {
  console.error(`split.json was frozen from a different manifest (${split.manifest?.sha256?.slice(0, 12)} vs ${digest.slice(0, 12)}); rerun split.ts --extend`)
  process.exit(1)
}
const rows = manifestBytes.toString('utf8').trim().split('\n').map((l) => JSON.parse(l))
const pick = rows.filter((r) => r.corners && (SPLIT === 'all' || split.assignments[String(r.id)] === SPLIT))
fs.mkdirSync(path.join(OUT, 'raw'), { recursive: true })

const out = []
let n = 0
for (const r of pick) {
  const xs = r.corners.map((p) => p[0] * SIZE)
  const ys = r.corners.map((p) => p[1] * SIZE)
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  const long = Math.max(x1 - x0, y1 - y0)
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  for (const [k, fill] of FILLS.entries()) {
    const side = long / fill // crop square side in source px
    const left = cx - side / 2
    const top = cy - side / 2
    // Mirror-pad only as far as this crop leaves the image (mirror cannot reach
    // further than the image's own size; beyond that, repeat the edge).
    const need = Math.ceil(Math.max(0, -left, -top, left + side - SIZE, top + side - SIZE)) + 2
    const pad = need
    const id = r.id * 10 + k + 1 // keeps ids unique and traceable to the source row
    // Two passes: inside one sharp pipeline `extract` runs BEFORE `extend`
    // whatever the call order, so the padded image is materialized first.
    const padded = await sharp(path.join(SRC, r.png))
      .extend({ top: pad, bottom: pad, left: pad, right: pad, extendWith: pad < SIZE ? 'mirror' : 'copy' })
      .png()
      .toBuffer()
    const buf = await sharp(padded)
      .extract({ left: Math.round(left + pad), top: Math.round(top + pad), width: Math.round(side), height: Math.round(side) })
      .resize(SIZE, SIZE, { kernel: 'lanczos3' })
      .png()
      .toBuffer()
    fs.writeFileSync(path.join(OUT, 'raw', `${id}.png`), buf)
    const ox = Math.round(left + pad) - pad
    const oy = Math.round(top + pad) - pad
    const s = Math.round(side)
    const corners = r.corners.map(([x, y]) => [(x * SIZE - ox) / s, (y * SIZE - oy) / s])
    let area = 0
    for (let i = 0; i < 4; i++) area += corners[i][0] * corners[(i + 1) % 4][1] - corners[(i + 1) % 4][0] * corners[i][1]
    out.push({
      ...r,
      id,
      png: `raw/${id}.png`,
      corners,
      fill: Math.abs(area) / 2,
      dupGroup: r.dupGroup ?? r.id,
      // The recorded presence score belongs to the uncropped frame; carrying it
      // over would make eval's presence-parity table describe a different image.
      hasObj: null,
      seedFallback: null,
      tightFrom: r.id,
      tightFill: fill,
      tightSplit: SPLIT,
      tightSplitManifest: digest,
    })
    n++
  }
}
fs.writeFileSync(path.join(OUT, 'manifest.jsonl'), out.map((o) => JSON.stringify(o)).join('\n') + '\n')
console.log(`${n} tight crops from ${pick.length} '${SPLIT}' positives (fills ${FILLS.join(', ')}) -> ${OUT}`)
