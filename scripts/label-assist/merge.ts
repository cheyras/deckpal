/**
 * Fleet answers -> labeler suggestions (and, for validation, a score against
 * the owner's own labels).
 *
 *   node --import tsx scripts/label-assist/merge.ts validate
 *   node --import tsx scripts/label-assist/merge.ts queue
 *
 * Reads $LABEL_ASSIST_DIR/fleet/<mode>/batch-*.json (RULEBOOK.md's output) and
 * work/<mode>/<id>.json (the detector proposal), and writes
 * suggestions-<mode>.json: { [queueId]: QuadSuggestion }, the shape
 * `PUT /api/dev/scan-queue/suggestions` stores.
 *
 * An agent's own corners are read off a grid, so they are snapped to the card's
 * edges by the shipping refiner (engine/refine.ts), the same step the
 * labeler's detector seed takes.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import sharp from 'sharp'

import type { Quad } from '../../apps/web/src/scan/engine/contract.js'
import { CANONICAL_SIZE, DATA, Lc050, detect, quadError, refineOn, squareOf, type Crop } from './cv.js'

const mode = process.argv[2] === 'validate' ? 'validate' : 'queue'
const FLEET = path.join(DATA, 'fleet', mode)
const WORK = path.join(DATA, 'work', mode)
const RAW = path.join(os.homedir(), 'deckpal-data', 'quad-queue', 'raw')
const CARD_FILL = 0.68
const REASONS = new Set([
  'no_card', 'not_a_card', 'multiple_no_clear_foreground', 'cut_off', 'too_obscured', 'too_blurry',
  'too_far', 'too_dark', 'glare_washout', 'too_oblique', 'too_bent',
])

interface Answer {
  id: string
  verdict: 'card' | 'back' | 'reject'
  reason: string | null
  proposal: 'accept' | 'fix' | 'none'
  top_left: number | null
  corners: [number, number][] | null
  crop: 'ok' | 'card_cut_off_by_square'
  photo_corners: [number, number][] | null
  confidence: 'high' | 'medium' | 'low'
  note?: string
}

export interface QuadSuggestion {
  v: 1
  id: number
  by: string
  createdAt: string
  verdict: 'card' | 'back' | 'reject'
  invalidReason?: string
  /** Source-photo px; null = the centre square. */
  crop: Crop | null
  /** Fractions of the canonical square, as QuadLabel.corners. */
  corners?: Quad
  topLeftIndex?: 0 | 1 | 2 | 3
  confidence: 'high' | 'medium' | 'low'
  note?: string
}

const answers: Answer[] = fs
  .readdirSync(FLEET)
  .filter((f) => /^batch-\d+\.json$/.test(f))
  .flatMap((f) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(FLEET, f), 'utf8')) as Answer[]
    } catch (e) {
      console.warn(`unreadable ${f}: ${(e as Error).message}`)
      return []
    }
  })

const pct = (p: [number, number][]) => p.map(([x, y]) => [x / 100, y / 100]) as unknown as Quad
const toPx = (q: Quad) => q.map(([x, y]) => [x * CANONICAL_SIZE, y * CANONICAL_SIZE]) as Quad
const toFrac = (q: Quad) => q.map(([x, y]) => [+(x / CANONICAL_SIZE).toFixed(5), +(y / CANONICAL_SIZE).toFixed(5)]) as Quad
const valid4 = (c: unknown): c is [number, number][] =>
  Array.isArray(c) && c.length === 4 && c.every((p) => Array.isArray(p) && p.length === 2 && p.every((v) => typeof v === 'number' && v >= -5 && v <= 105))

const lc = mode === 'queue' ? new Lc050() : null
const out: Record<string, QuadSuggestion> = {}
const problems: string[] = []
for (const a of answers) {
  const propFile = path.join(WORK, `${a.id}.json`)
  if (!fs.existsSync(propFile)) {
    problems.push(`${a.id}: no proposal`)
    continue
  }
  const prop = JSON.parse(fs.readFileSync(propFile, 'utf8')) as { crop: Crop | null; quad: Quad | null; photo: { width: number; height: number } | null }
  const base = { v: 1 as const, id: Number(a.id), by: 'agent:claude-sonnet-5.5+lc050', createdAt: new Date().toISOString(), confidence: a.confidence, note: a.note }
  if (a.verdict === 'reject') {
    if (!a.reason || !REASONS.has(a.reason)) {
      problems.push(`${a.id}: reject without a known reason (${a.reason})`)
      continue
    }
    out[a.id] = { ...base, verdict: 'reject', invalidReason: a.reason, crop: prop.crop }
    continue
  }
  let crop = prop.crop
  let frame: Buffer
  let corners: Quad | null = null
  let topLeftIndex: 0 | 1 | 2 | 3 = 0
  if (mode === 'queue' && a.crop === 'card_cut_off_by_square' && valid4(a.photo_corners) && prop.photo) {
    // Re-crop around the card the agent placed in the whole photo, the owner's way.
    const { width: w, height: h } = prop.photo
    const pq = a.photo_corners.map(([x, y]) => [(x / 100) * w, (y / 100) * h]) as Quad
    const cx = pq.reduce((s, p) => s + p[0], 0) / 4
    const cy = pq.reduce((s, p) => s + p[1], 0) / 4
    const d = (p: number[], q: number[]) => Math.hypot(p[0]! - q[0]!, p[1]! - q[1]!)
    const long = Math.max((d(pq[0], pq[1]) + d(pq[2], pq[3])) / 2, (d(pq[1], pq[2]) + d(pq[3], pq[0])) / 2)
    const size = Math.round(long / CARD_FILL)
    crop = { x: Math.round(cx - size / 2), y: Math.round(cy - size / 2), size }
    frame = await squareOf(fs.readFileSync(path.join(RAW, `${a.id}.jpg`)), crop, CANONICAL_SIZE)
    corners = pq.map(([x, y]) => [((x - crop!.x) / size) * CANONICAL_SIZE, ((y - crop!.y) / size) * CANONICAL_SIZE]) as Quad
    corners = refineOn(frame, corners)
  } else {
    frame = await sharp(path.join(WORK, `${a.id}.frame.png`)).resize(CANONICAL_SIZE, CANONICAL_SIZE).ensureAlpha().raw().toBuffer()
    if (a.proposal === 'accept' && prop.quad && a.top_left && a.top_left >= 1 && a.top_left <= 4) {
      corners = toPx(prop.quad)
      topLeftIndex = (a.top_left - 1) as 0 | 1 | 2 | 3
    } else if (valid4(a.corners)) {
      corners = refineOn(frame, toPx(pct(a.corners)))
    }
  }
  if (!corners) {
    problems.push(`${a.id}: ${a.verdict} without usable corners`)
    continue
  }
  out[a.id] = { ...base, verdict: a.verdict, crop, corners: toFrac(corners), topLeftIndex }
}
lc && (await lc.close())
fs.writeFileSync(path.join(DATA, `suggestions-${mode}.json`), JSON.stringify(out, null, 1))
console.log(`${answers.length} answers -> ${Object.keys(out).length} suggestions; ${problems.length} unusable`)
for (const p of problems.slice(0, 20)) console.log('  ' + p)

// ── Validation: score against the owner's own labels ─────────────────────────
if (mode === 'validate') {
  const verdictOf = (l: { corners?: unknown; face?: string; invalidReason?: string }) =>
    l.corners ? (l.face === 'back' ? 'back' : 'card') : `reject:${l.invalidReason}`
  let n = 0
  let verdictOk = 0
  let kindOk = 0
  let cardN = 0
  const errs: number[] = []
  let tlOk = 0
  const byConf: Record<string, [number, number]> = {}
  const misses: string[] = []
  for (const a of answers) {
    const lf = path.join(DATA, 'labels', `${a.id}.json`)
    if (!fs.existsSync(lf)) continue // an id the fleet mistyped; counted above as unusable
    const l = JSON.parse(fs.readFileSync(lf, 'utf8'))
    const s = out[a.id]
    n++
    const owner = verdictOf(l)
    const mine = s ? (s.verdict === 'reject' ? `reject:${s.invalidReason}` : s.verdict) : 'unusable'
    const ok = owner === mine
    if (ok) verdictOk++
    if (owner.split(':')[0] === mine.split(':')[0]) kindOk++
    byConf[a.confidence] ??= [0, 0]
    byConf[a.confidence][0]++
    if (ok) byConf[a.confidence][1]++
    if (!ok) misses.push(`${a.id}: owner ${owner}, fleet ${mine} (${a.confidence}) ${a.note ?? ''}`)
    if (l.corners && s?.corners) {
      cardN++
      const ownerPx = toPx(l.corners as Quad)
      const e = quadError(ownerPx, toPx(s.corners))
      errs.push(e)
      const ownerTL = ownerPx[l.topLeftIndex ?? 0]!
      const mineTL = toPx(s.corners)[s.topLeftIndex ?? 0]!
      if (Math.hypot(ownerTL[0] - mineTL[0], ownerTL[1] - mineTL[1]) < 40) tlOk++
    }
  }
  errs.sort((a, b) => a - b)
  console.log(`\nVALIDATION vs the owner's labels (${n} frames, blind)`)
  console.log(`  exact verdict (incl. reason): ${verdictOk}/${n}`)
  console.log(`  card/back vs reject right:    ${kindOk}/${n}`)
  for (const [c, [t, k]] of Object.entries(byConf)) console.log(`    ${c} confidence: ${k}/${t} exact`)
  if (errs.length) {
    const within = (px: number) => errs.filter((e) => e <= px).length
    console.log(`  corners on ${cardN} cards both called card: median ${errs[Math.floor(errs.length / 2)]!.toFixed(1)}px (of 416); within 3px ${within(3)}, 5px ${within(5)}, 8px ${within(8)}, 15px ${within(15)}`)
    console.log(`  top-left corner agrees: ${tlOk}/${cardN}`)
  }
  for (const m of misses) console.log('  MISS ' + m)
}
