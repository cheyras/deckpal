/**
 * How the labeler's own seed (the shipping detector + refiner) compares with
 * the owner's finished labels, frame by frame.
 *
 *   node --import tsx scripts/label-assist/calibrate.ts
 *
 * Reads the labels pulled into $LABEL_ASSIST_DIR/labels (`pull.mjs`), runs the
 * detector on each saved frame (the exact square the owner labelled), and
 * writes calibration.json: per label, the owner's verdict, the detector's
 * presence score, and the corner error in canonical px. The summary says which
 * proposals can be trusted as they are and which need a reviewer.
 */
import fs from 'node:fs'
import path from 'node:path'

import sharp from 'sharp'

import type { Quad } from '../../apps/web/src/scan/engine/contract.js'
import { CANONICAL_SIZE, DATA, DEFAULT_ACQUIRE, Lc050, detect, quadError } from './cv.js'

const dir = path.join(DATA, 'labels')
const labels = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => ({ id: f.slice(0, -5), ...JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) }))
  .filter((l) => l.type === 'quad-label' && fs.existsSync(path.join(dir, `${l.id}.png`)))

const lc = new Lc050()
const rows: Record<string, unknown>[] = []
for (const l of labels) {
  const rgba = await sharp(path.join(dir, `${l.id}.png`)).resize(CANONICAL_SIZE, CANONICAL_SIZE).ensureAlpha().raw().toBuffer()
  const d = await detect(lc, rgba)
  const verdict = l.corners ? (l.face === 'back' ? 'back' : 'card') : `reject:${l.invalidReason}`
  const owner = l.corners ? (l.corners as Quad).map(([x, y]) => [x * CANONICAL_SIZE, y * CANONICAL_SIZE]) as Quad : null
  rows.push({
    id: l.id,
    source: l.source,
    verdict,
    hasObj: +d.hasObj.toFixed(3),
    err: owner && d.quad ? +quadError(owner, d.quad).toFixed(1) : null,
    detQuad: d.quad,
  })
}
await lc.close()
fs.writeFileSync(path.join(DATA, 'calibration.json'), JSON.stringify(rows, null, 1))

const pos = rows.filter((r) => r.verdict === 'card' || r.verdict === 'back')
const neg = rows.filter((r) => String(r.verdict).startsWith('reject'))
const errs = pos.map((r) => (r.err as number | null) ?? 999).sort((a, b) => a - b)
const within = (px: number) => pos.filter((r) => ((r.err as number | null) ?? 999) <= px).length
console.log(`labels ${rows.length}: ${pos.length} card/back, ${neg.length} rejected`)
console.log(`card corners from the detector vs yours (canonical px, 416 square): median ${errs[Math.floor(errs.length / 2)]}`)
for (const px of [3, 5, 8, 15]) console.log(`  within ${px}px: ${within(px)}/${pos.length}`)
const acq = (r: Record<string, unknown>) => (r.hasObj as number) >= DEFAULT_ACQUIRE
console.log(`detector says "card present" (hasObj >= ${DEFAULT_ACQUIRE}): cards ${pos.filter(acq).length}/${pos.length}, rejects ${neg.filter(acq).length}/${neg.length}`)
const byReason: Record<string, [number, number]> = {}
for (const r of neg) {
  const k = String(r.verdict)
  byReason[k] ??= [0, 0]
  byReason[k][0]++
  if (acq(r)) byReason[k][1]++
}
for (const [k, [n, a]] of Object.entries(byReason).sort((a, b) => b[1][0] - a[1][0])) console.log(`  ${k}: ${n} (detector fires on ${a})`)
