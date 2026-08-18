/**
 * Compare a Blender reference render against a browser capture.
 *
 * Produces numbers first and an image second. The project log records FIVE
 * separate measurement instruments that gave confident wrong answers, and one
 * of the recorded failures was literally "reading two screenshots by eye" —
 * which got the sign of `bend` backwards. So this reports:
 *
 *   - silhouette IoU, from an alpha/background mask. Catches pose, scale and
 *     position error independently of any colour difference.
 *   - centroid and bounding-box deltas, in pixels.
 *   - a mean colour ratio over the pixels BOTH images agree are the subject,
 *     which is the transfer function between the two renderers. Brightness and
 *     saturation drift shows up here as a clean multiplier rather than as a
 *     vague "looks a bit off".
 *   - an amplified absolute-difference image, because vision models reason far
 *     better about a diff than about two separate frames.
 *
 * Usage: node compare.mjs <referencePng> <candidatePng> <outDir>
 */
import { createRequire } from 'node:module'
// sharp is a devDependency of the deckpal repo; pnpm keeps it under .pnpm, so
// resolve it the way Node would from inside that repo rather than guessing a path.
const sharp = createRequire(import.meta.url)('sharp')
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const [, , refPath, candPath, outDir = '.'] = process.argv
if (!refPath || !candPath) {
  console.error('usage: node compare.mjs <ref.png> <cand.png> [outDir]')
  process.exit(2)
}
mkdirSync(outDir, { recursive: true })

/** The flat backdrop Blender shows to camera rays, as 8-bit sRGB. Anything
 *  close to it is background, not character. */
const BG = [67, 69, 74]
const BG_TOL = 26

async function load(p, size) {
  let img = sharp(p).ensureAlpha()
  const meta = await img.metadata()
  if (size && (meta.width !== size.w || meta.height !== size.h)) {
    img = img.resize(size.w, size.h, { fit: 'fill', kernel: 'lanczos3' })
  }
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true })
  return { data, w: info.width, h: info.height, channels: info.channels }
}

const ref = await load(refPath)
const cand = await load(candPath, { w: ref.w, h: ref.h })

const n = ref.w * ref.h
const maskA = new Uint8Array(n)
const maskB = new Uint8Array(n)

const isSubject = (d, i) => {
  const a = d[i * 4 + 3]
  if (a < 24) return false // transparent => background
  const dr = d[i * 4] - BG[0]
  const dg = d[i * 4 + 1] - BG[1]
  const db = d[i * 4 + 2] - BG[2]
  return Math.hypot(dr, dg, db) > BG_TOL
}

for (let i = 0; i < n; i++) {
  maskA[i] = isSubject(ref.data, i) ? 1 : 0
  maskB[i] = isSubject(cand.data, i) ? 1 : 0
}

let inter = 0
let union = 0
let ax = 0, ay = 0, aN = 0
let bx = 0, by = 0, bN = 0
const bbA = [1e9, 1e9, -1, -1]
const bbB = [1e9, 1e9, -1, -1]

for (let y = 0; y < ref.h; y++) {
  for (let x = 0; x < ref.w; x++) {
    const i = y * ref.w + x
    if (maskA[i]) {
      aN++; ax += x; ay += y
      bbA[0] = Math.min(bbA[0], x); bbA[1] = Math.min(bbA[1], y)
      bbA[2] = Math.max(bbA[2], x); bbA[3] = Math.max(bbA[3], y)
    }
    if (maskB[i]) {
      bN++; bx += x; by += y
      bbB[0] = Math.min(bbB[0], x); bbB[1] = Math.min(bbB[1], y)
      bbB[2] = Math.max(bbB[2], x); bbB[3] = Math.max(bbB[3], y)
    }
    if (maskA[i] || maskB[i]) union++
    if (maskA[i] && maskB[i]) inter++
  }
}

// Colour transfer, measured only where both agree it is the character, so the
// background and the silhouette edge cannot pollute it.
let sr = 0, sg = 0, sb = 0, cr = 0, cg = 0, cb = 0, both = 0
for (let i = 0; i < n; i++) {
  if (!(maskA[i] && maskB[i])) continue
  both++
  sr += ref.data[i * 4]; sg += ref.data[i * 4 + 1]; sb += ref.data[i * 4 + 2]
  cr += cand.data[i * 4]; cg += cand.data[i * 4 + 1]; cb += cand.data[i * 4 + 2]
}

// Amplified absolute difference.
const diff = Buffer.alloc(n * 4)
let meanAbs = 0
for (let i = 0; i < n; i++) {
  const dr = Math.abs(ref.data[i * 4] - cand.data[i * 4])
  const dg = Math.abs(ref.data[i * 4 + 1] - cand.data[i * 4 + 1])
  const db = Math.abs(ref.data[i * 4 + 2] - cand.data[i * 4 + 2])
  meanAbs += (dr + dg + db) / 3
  diff[i * 4] = Math.min(255, dr * 3)
  diff[i * 4 + 1] = Math.min(255, dg * 3)
  diff[i * 4 + 2] = Math.min(255, db * 3)
  diff[i * 4 + 3] = 255
}
meanAbs /= n

await sharp(diff, { raw: { width: ref.w, height: ref.h, channels: 4 } })
  .png()
  .toFile(resolve(outDir, 'diff.png'))

// A side-by-side with the diff, which is what a vision model reads best.
await sharp({
  create: { width: ref.w * 3, height: ref.h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } },
})
  .composite([
    { input: await sharp(refPath).resize(ref.w, ref.h, { fit: 'fill' }).png().toBuffer(), left: 0, top: 0 },
    { input: await sharp(candPath).resize(ref.w, ref.h, { fit: 'fill' }).png().toBuffer(), left: ref.w, top: 0 },
    { input: resolve(outDir, 'diff.png'), left: ref.w * 2, top: 0 },
  ])
  .png()
  .toFile(resolve(outDir, 'triptych.png'))

const report = {
  size: [ref.w, ref.h],
  silhouette: {
    iou: union ? inter / union : 0,
    refPixels: aN,
    candPixels: bN,
    areaRatio: aN ? bN / aN : 0,
  },
  centroidDeltaPx: aN && bN ? [bx / bN - ax / aN, by / bN - ay / aN] : null,
  bboxRef: bbA,
  bboxCand: bbB,
  bboxDeltaPx: [bbB[0] - bbA[0], bbB[1] - bbA[1], bbB[2] - bbA[2], bbB[3] - bbA[3]],
  colour: both
    ? {
        refMean: [sr / both, sg / both, sb / both].map((v) => +v.toFixed(2)),
        candMean: [cr / both, cg / both, cb / both].map((v) => +v.toFixed(2)),
        ratio: [cr / sr, cg / sg, cb / sb].map((v) => +v.toFixed(4)),
      }
    : null,
  meanAbsDiff: +meanAbs.toFixed(3),
}

writeFileSync(resolve(outDir, 'report.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
