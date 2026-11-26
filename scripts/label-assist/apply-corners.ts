/**
 * Pass 2 answers -> final corners on the suggestions.
 *
 *   node --import tsx scripts/label-assist/apply-corners.ts <validate|queue>
 *
 * Each close-up (zoom.ts) is a 100x100 canonical-px window, so an answer of
 * (x, y) in its grid IS window origin + (x, y) in canonical px. The corners go
 * back in their original array order with the same top-left index. A verdict
 * the close-ups overturned replaces the suggestion's. Validation mode also
 * scores against the owner's labels, raw and after the shipping refiner.
 */
import fs from 'node:fs'
import path from 'node:path'

import sharp from 'sharp'

import type { Quad } from '../../apps/web/src/scan/engine/contract.js'
import { CANONICAL_SIZE, DATA, quadError, refineOn, squareOf } from './cv.js'

const mode = process.argv[2] === 'validate' ? 'validate' : 'queue'
const WORK = path.join(DATA, 'work', mode)
// FLEET=fleet2,fleet2b averages independent readings of the same close-ups:
// per corner, the mean of the readers' answers.
const FLEETS = (process.env.FLEET ?? 'fleet2').split(',').map((f) => path.join(DATA, f, mode))
const REFINE = process.env.REFINE !== 'off'
const sugFile = path.join(DATA, `suggestions-${mode}.json`)
const sugg = JSON.parse(fs.readFileSync(sugFile, 'utf8'))
const runs = FLEETS.map((F2) =>
  fs
    .readdirSync(F2)
    .filter((f) => /^batch-\d+\.json$/.test(f))
    .flatMap((f) => JSON.parse(fs.readFileSync(path.join(F2, f), 'utf8'))),
)
const byId = new Map<string, any[]>()
for (const run of runs) for (const a of run) byId.set(String(a.id), [...(byId.get(String(a.id)) ?? []), a])
const answers = [...byId.values()].map((group) => {
  const usable = group.filter((a) => Array.isArray(a.corners) && a.corners.length === 4)
  const rejects = group.filter((a) => a.verdict === 'reject' && a.reason)
  // A reject wins only when most readers said so.
  if (rejects.length * 2 > group.length) return rejects[0]
  if (!usable.length) return group[0]
  const corners = [0, 1, 2, 3].map((k) => [0, 1].map((d) => usable.reduce((s, a) => s + a.corners[k][d], 0) / usable.length))
  return { ...usable[0], corners }
})

const px = (q: number[][]) => q.map(([x, y]) => [x! * CANONICAL_SIZE, y! * CANONICAL_SIZE]) as Quad
let applied = 0
let overturned = 0
const errRaw: number[] = []
const errRef: number[] = []
const errBefore: number[] = []
for (const a of answers) {
  const s = sugg[a.id]
  const metaFile = path.join(WORK, `${a.id}.corners.json`)
  if (!s || !s.corners || !fs.existsSync(metaFile)) continue
  if (a.verdict === 'reject' && a.reason) {
    sugg[a.id] = { ...s, verdict: 'reject', invalidReason: a.reason, corners: undefined, topLeftIndex: undefined, confidence: a.confidence, note: a.note }
    overturned++
    continue
  }
  if (!Array.isArray(a.corners) || a.corners.length !== 4) continue
  const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8')) as { origins: number[][]; order: number[]; win?: number }
  const unit = (meta.win ?? 100) / 100
  const before = px(s.corners)
  const raw = [...before] as Quad
  a.corners.forEach(([x, y]: number[], k: number) => {
    raw[meta.order[k]!] = [meta.origins[k]![0]! + x! * unit, meta.origins[k]![1]! + y! * unit]
  })
  let frame: Buffer
  const prop = JSON.parse(fs.readFileSync(path.join(WORK, `${a.id}.json`), 'utf8'))
  if (mode === 'queue' && s.crop && JSON.stringify(s.crop) !== JSON.stringify(prop.crop)) {
    frame = await squareOf(fs.readFileSync(path.join(process.env.USERPROFILE ?? '', 'deckpal-data', 'quad-queue', 'raw', `${a.id}.jpg`)), s.crop, CANONICAL_SIZE)
  } else frame = await sharp(path.join(WORK, `${a.id}.frame.png`)).ensureAlpha().raw().toBuffer()
  const refined = refineOn(frame, raw)
  // The refiner snaps to the strongest nearby edge; keep its answer only when it
  // stayed close to where the reviewer put the corner.
  const final = REFINE && quadError(raw, refined) <= 3 ? refined : raw
  sugg[a.id] = {
    ...s,
    corners: final.map(([x, y]) => [+(x / CANONICAL_SIZE).toFixed(5), +(y / CANONICAL_SIZE).toFixed(5)]),
    confidence: a.confidence ?? s.confidence,
    note: [s.note, a.note].filter(Boolean).join(' | '),
  }
  applied++
  if (mode === 'validate') {
    const l = JSON.parse(fs.readFileSync(path.join(DATA, 'labels', `${a.id}.json`), 'utf8'))
    if (l.corners) {
      const owner = px(l.corners)
      errBefore.push(quadError(owner, before))
      errRaw.push(quadError(owner, raw))
      errRef.push(quadError(owner, final))
    }
  }
}
fs.writeFileSync(sugFile, JSON.stringify(sugg, null, 1))
console.log(`pass 2: ${applied} corner sets applied, ${overturned} verdicts overturned -> ${sugFile}`)
if (errRaw.length) {
  const show = (name: string, e: number[]) => {
    const s = [...e].sort((a, b) => a - b)
    const w = (p: number) => s.filter((x) => x <= p).length
    console.log(`  ${name.padEnd(22)} median ${s[Math.floor(s.length / 2)]!.toFixed(1)}px  within 3px ${w(3)}/${s.length}, 5px ${w(5)}, 8px ${w(8)}`)
  }
  show('before (pass 1)', errBefore)
  show('pass 2, as placed', errRaw)
  show('pass 2 + refiner', errRef)
}
