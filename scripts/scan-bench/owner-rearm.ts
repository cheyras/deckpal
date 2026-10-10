// THE LOOK RE-ARM ON THE OWNER'S OWN SESSIONS — what scan/ui/rearm.ts would
// have done on the three recorded phone sessions (2026-09-04/05/06), measured
// with the SHIPPING look (engine/look.ts) and the SHIPPING decision
// (scan/ui/autoCapture.ts decideAutoCapture over regions.ts and rearm.ts).
//
// PR #292 sized the re-arm on CC BY pack-opening videos. These are the only
// recordings of the owner actually scanning: his lighting, his table, his
// sleeves, one card held for many locks at a time.
//
// ── WHAT THE RECORDINGS ARE ─────────────────────────────────────────────────
//
// Per event a `<id>.json` (lock-event or capture-event; the quad is in the
// CANONICAL 416 frame) and a `<id>.png`: the WHOLE stream (960x1280 portrait)
// downscaled to 640 on its long side (flags.ts EVENT_FRAME_LONG_SIDE), read off
// the <video> when the recorder ran — a few tens of ms after the tick the quad
// was measured on, so a card in motion is slightly off its quad. The canonical
// frame is the stream's centre square (frame.ts), i.e. the PNG's own centre
// square. Every capture also carries the rectified crop capture() produced
// (CAPTURE_MARGIN 5%, re-encoded at 229x320). Lock events are throttled to one
// per 2 s by the recorder.
//
// A capture-event's `epochMs` is stamped when the record is POSTED, which since
// 2026-09-04 waits for the identify result: 0.2-3 s after the capture. The
// capture's real tick is recovered from its track's age (`track.age / hz` after
// the track's birth, which the lock events of the same track give).
//
// ── HOW EACH LOOK IS MADE ───────────────────────────────────────────────────
//
//   lock look      cardLook(work, quad): `work` is the PNG's centre square
//                  resized to 416x416 — the engine's working image
//                  (index.ts grabWork) — and `quad` the recorded canonical quad.
//   capture look   captureLook(crop, CAPTURE_MARGIN) on the stored rectified
//                  crop: the product computes it on those pixels (index.ts
//                  capture()), at full resolution and before the JPEG.
//
// ── GROUND TRUTH ────────────────────────────────────────────────────────────
//
// The measure owner session 1's analysis validated
// (`owner-session-1/analysis/card-identity.mjs`): each event's quad mapped into
// its 640 frame, rectified through the shipping warp to 126x176, reduced to a
// 16x16 grey + 8x8 RGB, scored by mean NCC. >= 0.75 is the same card, < 0.50 a
// different one, between is unknown. Reproduced here exactly and checked
// against session 1's card-identity.json. It is NOT independent of the look
// (both correlate a coarse picture of the same rectified card) and it calls a
// motion-blurred frame of one card "different", so every verdict that matters
// is written to a contact sheet (`--sheets`) to be checked by eye.
//
// ── THE REFUSALS AND WHAT THE RE-ARM SAYS TO THEM ───────────────────────────
//
// Which locks the shipping policy refuses as a repeat comes from the builds'
// own flags, narrowed to the shipping policy (refusersOf below says how, and
// why a geometric replay was not good enough). For each, the captures behind
// the refusal are what decideAutoCapture would hand the re-arm, and the
// SHIPPING judge (createLookRearm) decides. Nothing it would fire is fed back:
// each refused lock is judged against the memory the session really had.
//
// STEADINESS cannot be replayed: the re-arm asks that the lock's look held
// within REARM_STEADY_MAX since the track's previous LOCKED TICK (~120 ms), and
// recorded locks are 2 s apart. So two bounds:
//   upper  every lock counts as steady
//   lower  steadiness is judged against the track's previous RECORDED lock,
//          2 s back — far stricter than a tick — and a track's first recorded
//          lock can never re-arm. A floor, not an estimate.
//
// BY EYE. `owner-rearm-labels.json` labels every refused lock whose NCC to the
// captures behind it is below 0.9, from contact sheets of the lock beside each
// capture's own crop: `new <card>`, `same <card>`, or `motion`. The headline
// numbers are those labels; the NCC bands are printed beside them.
//
// ── WHAT IT MEASURED (2026-10-10, PR #292's constants) ──────────────────────
//
//   The look separates the owner's cards far worse than the videos' (one
//   card's ticks median 0.35, different cards 1.35 there). Here, event vs an
//   earlier capture: same card med 0.38-0.46, max 0.84; different cards med
//   1.21-1.41 but 13-27 % of pairs at or under 1.0. A card held still for up
//   to 39 s stays within 0.71 of itself.
//
//   On the refusals: 39 new cards refused; the re-arm (upper bound) fires on
//   23 — 8/11 on session 3, whose build ran the shipping region policy, with
//   Cinccino, Lillie's Pearl and Rellor taken 9-13 s sooner (Rellor only off a
//   lock whose quad held part of the card). It holds 16:
//   trainer after trainer, one type after the same type, washed-out colorless
//   cards (Skwovet after Cinccino at 0.35-0.55, refused for 20 s). Same-card
//   fires: 2 cards, both session 1 — a lock behind a capture that came out
//   sideways (the look is not rotation-invariant) and a lock whose quad held
//   part of the card. 3 motion frames would fire if steadiness let them.
//
//   REARM_NEW_MIN 0.9 takes 28/39 for the same 2 duplicates on this data; the
//   nearest same-card refusals sit at 0.83 and 0.87, so anything lower starts
//   adding them. No threshold reaches the other 11: the look itself cannot
//   tell those pairs apart.
//
// Run:  node --import tsx scripts/scan-bench/owner-rearm.ts [--sheets] [--out <dir>] [--labels <json>]
// Data: OWNER_SESSIONS (default: the main checkout's
//       roadmap/plans/card-scanner-redesign/p2-work, untracked — the frames are
//       the owner's). Output: owner-rearm.txt / .json (and the sheets) under
//       --out, default ~/deckpal-data/owner-rearm.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Quad } from '../../apps/web/src/scan/engine/contract'
import { polyIoU, type ImageDataLike } from '../../apps/web/src/scan/engine/geometry'
import { DEFAULT_CADENCE_MS } from '../../apps/web/src/scan/engine/index'
import { captureLook, cardLook, lookDistance, orderUndecided, type CardLook } from '../../apps/web/src/scan/engine/look'
import { CAPTURE_MARGIN, rectifyImageData } from '../../apps/web/src/scan/engine/rectify'
import { decideAutoCapture } from '../../apps/web/src/scan/ui/autoCapture'
import {
  createCapturedRegions,
  REGION_DEPARTURE_MS,
  REGION_LOOKS_ASKED,
  REGION_SAME_IOU,
  type RegionTrack,
} from '../../apps/web/src/scan/ui/regions'
import { createLookRearm, REARM_NEW_MIN, REARM_STEADY_MAX } from '../../apps/web/src/scan/ui/rearm'
import { contactSheet, type Tile } from './video/sheets'

const SharpP = import('sharp').then((m) => m.default)

const ROOT = process.env.OWNER_SESSIONS ?? 'E:/users/cheyr/deckpal/roadmap/plans/card-scanner-redesign/p2-work'
const args = process.argv.slice(2)
const opt = (n: string, d: string) => {
  const i = args.indexOf(n)
  return i >= 0 && args[i + 1] ? args[i + 1] : d
}
const OUT = opt('--out', path.join(os.homedir(), 'deckpal-data', 'owner-rearm'))
const SHEETS = args.includes('--sheets')

const SAME = 0.75
const DIFFERENT = 0.5
const CANON = 416
const TICK_MS = DEFAULT_CADENCE_MS

// ── sessions ────────────────────────────────────────────────────────────────

interface RawEv {
  type: string
  epochMs: number
  quad: Quad
  trackId: number
  trigger?: 'auto' | 'manual'
  wouldCapture?: boolean
  suppressedByRegion?: boolean
  age?: number
  track?: { age: number }
  perf?: { hz: number }
  file?: string
  id?: number
}
interface Ev extends RawEv {
  key: string
  frame: string
  crop: string | null
  /** The tick the event describes: `epochMs` for a lock, the recovered capture
   *  tick for a capture (see the header). */
  t: number
}

function loadSession(name: string): Ev[] | null {
  const s1 = name === 's1'
  const dir = s1 ? path.join(ROOT, 'owner-session-1') : path.join(ROOT, `owner-session-${name.slice(1)}`, 'harvest')
  const f = path.join(dir, 'events.json')
  if (!fs.existsSync(f)) return null
  const raw = (JSON.parse(fs.readFileSync(f, 'utf8')) as RawEv[]).filter(
    (e) => e.type === 'lock-event' || e.type === 'capture-event',
  )
  const evs: Ev[] = raw.map((e) => {
    const key = s1 ? e.file!.replace(/\.json$/, '') : String(e.id)
    const crop = s1 ? path.join(dir, 'analysis', 'crops', `cap_${key}.png`) : path.join(dir, 'rectified', `${key}.png`)
    return {
      ...e,
      key,
      frame: s1 ? path.join(dir, `${key}.png`) : path.join(dir, 'raw', `${key}.png`),
      crop: e.type === 'capture-event' && fs.existsSync(crop) ? crop : null,
      t: e.epochMs,
    }
  })
  // Recover each capture's tick: birth (from the same track's lock nearest in
  // age) + capture age / hz. Captures on a track with no recorded lock take
  // the session's median posting delay.
  const locks = evs.filter((e) => e.type === 'lock-event')
  const delays: number[] = []
  const pending: Ev[] = []
  for (const c of evs) {
    if (c.type !== 'capture-event' || !c.track || !c.perf) continue
    const same = locks.filter((l) => l.trackId === c.trackId && l.age !== undefined && l.perf)
    if (!same.length) {
      pending.push(c)
      continue
    }
    const l = same.reduce((a, b) => (Math.abs(b.age! - c.track!.age) < Math.abs(a.age! - c.track!.age) ? b : a))
    const t = l.epochMs + ((c.track.age - l.age!) / l.perf!.hz) * 1000
    c.t = Math.min(c.epochMs, t)
    delays.push(c.epochMs - c.t)
  }
  const med = delays.length ? [...delays].sort((a, b) => a - b)[Math.floor(delays.length / 2)] : 0
  for (const c of pending) c.t = c.epochMs - med
  return evs.sort((a, b) => a.t - b.t)
}

// ── per-event measurements ──────────────────────────────────────────────────

interface Meas {
  /** cardLook on the 416 working image at the recorded quad. */
  look: CardLook | null
  /** captureLook on the stored rectified crop (captures only). */
  capLook: CardLook | null
  /** card-identity.mjs's signature. */
  gray: number[]
  rgb: number[]
  /** 126x176 rectified card off the 640 frame, for the sheets. */
  card: { data: Uint8ClampedArray; width: number; height: number }
  undecided: boolean
}

const asImage = (buf: Buffer, width: number, height: number): ImageDataLike => ({
  width,
  height,
  data: new Uint8ClampedArray(buf.buffer, buf.byteOffset, buf.length),
})

async function measure(e: Ev): Promise<Meas> {
  const S = await SharpP
  const { data, info } = await S(e.frame).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const side = Math.min(info.width, info.height)
  const ox = (info.width - side) / 2
  const oy = (info.height - side) / 2
  // THE WORKING IMAGE: the centre square at CANONICAL_SIZE (index.ts grabWork).
  const work = await S(e.frame)
    .extract({ left: Math.round(ox), top: Math.round(oy), width: side, height: side })
    .resize({ width: CANON, height: CANON, fit: 'fill', kernel: 'lanczos3' })
    .ensureAlpha()
    .raw()
    .toBuffer()
  const look = cardLook(asImage(work, CANON, CANON), e.quad)

  // card-identity.mjs, reproduced exactly (quad mapped into the 640 frame).
  const s = side / CANON
  const q640 = e.quad.map(([x, y]) => [ox + x * s, oy + y * s]) as Quad
  const r = rectifyImageData(asImage(data, info.width, info.height), q640, 126, 176)!
  const raw = { raw: { width: 126, height: 176, channels: 4 as const } }
  const rb = Buffer.from(r.data.buffer)
  const gray = [...(await S(rb, raw).greyscale().resize(16, 16, { fit: 'fill' }).raw().toBuffer())]
  const rgb = [...(await S(rb, raw).removeAlpha().resize(8, 8, { fit: 'fill' }).raw().toBuffer())]

  let capLook: CardLook | null = null
  if (e.crop) {
    const c = await S(e.crop).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    capLook = captureLook(asImage(c.data, c.info.width, c.info.height), CAPTURE_MARGIN)
  }
  return { look, capLook, gray, rgb, card: r, undecided: orderUndecided(e.quad) }
}

function ncc(a: number[], b: number[]): number {
  const n = a.length
  let ma = 0
  let mb = 0
  for (let i = 0; i < n; i++) {
    ma += a[i]
    mb += b[i]
  }
  ma /= n
  mb /= n
  let sa = 0
  let sb = 0
  let sab = 0
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma
    const y = b[i] - mb
    sa += x * x
    sb += y * y
    sab += x * y
  }
  return sa && sb ? sab / Math.sqrt(sa * sb) : 0
}

// ── stats ───────────────────────────────────────────────────────────────────

const qtl = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))]
}
const f2 = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : '-')
const dist = (xs: number[]) =>
  xs.length
    ? `n=${String(xs.length).padStart(3)}  p05 ${f2(qtl(xs, 0.05))}  med ${f2(qtl(xs, 0.5))}  p95 ${f2(qtl(xs, 0.95))}  max ${f2(Math.max(...xs))}`
    : 'n=  0'
const frac = (xs: number[], pred: (x: number) => boolean) =>
  `${xs.filter(pred).length}/${xs.length}${xs.length ? ` (${((100 * xs.filter(pred).length) / xs.length).toFixed(0)}%)` : ''}`

// ── presence (owner-session-regressions.test.ts presence(), every event) ────

const LOCK_THROTTLE_MS = 2_000
const CONTINUOUS_MS = 3_000
function presence(P: Ev[]): Array<{ t: number; tracks: RegionTrack[] }> {
  const out: Array<{ t: number; tracks: RegionTrack[] }> = []
  let li = 0
  for (let t = P[0].t; t <= P[P.length - 1].t + TICK_MS; t += TICK_MS) {
    while (li + 1 < P.length && P[li + 1].t <= t) li++
    const cur = P[li]
    const nxt = P[li + 1]
    let present = t - cur.t <= LOCK_THROTTLE_MS
    let e = cur
    if (nxt && nxt.t - cur.t <= CONTINUOUS_MS) {
      present = true
      e = t - cur.t < nxt.t - t ? cur : nxt
    }
    out.push({ t, tracks: present ? [{ id: e.trackId, quad: e.quad }] : [] })
  }
  return out
}

interface Verdict {
  repeat: boolean
  region: boolean
  /** The captures (event indices) whose looks the re-arm compared against;
   *  -1 for a refuser with no look. */
  refusers: number[]
  dists: number[]
  newByLook: boolean
}

/** The region REPLAY the header rejects, kept to print its agreement: the
 *  recorded captures replayed into createCapturedRegions over the rebuilt
 *  presence, every recorded lock put to decideAutoCapture. */
function judgeRecordedLocks(E: Ev[], M: Meas[]): Map<number, Verdict> {
  const regions = createCapturedRegions()
  const rearm = createLookRearm()
  const refractory = new Set<number>()
  const owner = new Map<CardLook, number>()
  const trackCap = new Map<number, number>()
  const out = new Map<number, Verdict>()
  let ei = 0
  for (const tk of presence(E)) {
    regions.tick(tk.t, tk.tracks)
    while (ei < E.length && E[ei].t <= tk.t + TICK_MS) {
      const e = E[ei]
      const m = M[ei]
      if (e.type === 'capture-event') {
        const l = m.capLook ?? m.look
        refractory.add(e.trackId)
        regions.note(e.quad, e.trackId, e.t, l)
        rearm.note(l, e.trackId)
        if (l) owner.set(l, ei)
        trackCap.set(e.trackId, ei)
      } else {
        const refusers: number[] = []
        if (refractory.has(e.trackId)) refusers.push(trackCap.get(e.trackId) ?? -1)
        const regionLooks = regions.suppressingLooks(e.quad)
        for (const l of regionLooks) refusers.push(l ? (owner.get(l) ?? -1) : -1)
        const v = decideAutoCapture({ id: e.trackId, quad: e.quad }, m.look, { refractory, busy: false, regions, rearm })
        const dists = refusers.map((c) =>
          c >= 0 && m.look ? lookDistance(m.look, (M[c].capLook ?? M[c].look)!) : NaN,
        )
        out.set(ei, { repeat: v.repeat, region: regionLooks.length > 0, refusers, dists, newByLook: v.newByLook })
      }
      ei++
    }
  }
  return out
}

/**
 * WHAT THE SHIPPING POLICY REFUSES, and the captures behind each refusal —
 * what decideAutoCapture hands the re-arm.
 *
 * WHICH locks: the build's own flags, narrowed to the shipping policy. A
 * geometric estimate from the recorded quads alone was tried and is printed
 * for the record; on session 3, whose build ran the shipping region policy, it
 * agrees with the flags on only ~70 % of locks, mostly by refusing the first
 * lock of a card put down after a capture — the build's region had followed
 * the previous card off the table as the hand lifted it, a motion the 2 s
 * recorder never sees. So:
 *
 *   refractory  `!wouldCapture` (Scan.tsx refractory, unchanged since session
 *               1): the newest capture on this track. Its look is
 *               rearm.lookOfTrack.
 *   region      `suppressedByRegion`, AND a capture whose region would still
 *               be live under the shipping policy overlaps the lock — its track
 *               (regions follow their track by id) last seen within
 *               REGION_DEPARTURE_MS (+2 s, the recorder's throttle), standing
 *               at REGION_SAME_IOU. The newest REGION_LOOKS_ASKED of them.
 *               Session 3's build ran the shipping policy, so when none is
 *               found there the newest capture stands in. Sessions 1 and 2 ran
 *               12 s windows: a region refusal with no capture live under 5 s
 *               is a lock the shipping policy captures without the re-arm, and
 *               is not counted.
 */
const RECORDER_SLACK_MS = 2_000
function refusersOf(E: Ev[], i: number, shippingBuild: boolean): { refractory: number; regions: number[]; refusers: number[] } {
  const e = E[i]
  let refractory = -1
  if (!e.wouldCapture)
    for (let j = i - 1; j >= 0; j--)
      if (E[j].type === 'capture-event' && E[j].trackId === e.trackId) {
        refractory = j
        break
      }
  const regions: number[] = []
  if (e.suppressedByRegion) {
    for (let j = i - 1; j >= 0 && regions.length < REGION_LOOKS_ASKED && e.t - E[j].t <= 120_000; j--) {
      if (E[j].type !== 'capture-event') continue
      let k = i - 1
      while (k > j && E[k].trackId !== E[j].trackId) k--
      if (e.t - E[k].t > REGION_DEPARTURE_MS + RECORDER_SLACK_MS) continue
      if (polyIoU(E[k].quad, e.quad) >= REGION_SAME_IOU) regions.push(j)
    }
    if (!regions.length && shippingBuild)
      for (let j = i - 1; j >= 0; j--)
        if (E[j].type === 'capture-event') {
          regions.push(j)
          break
        }
    regions.reverse()
  }
  return { refractory, regions, refusers: [...new Set([...(refractory >= 0 ? [refractory] : []), ...regions])] }
}

/** The flag-free estimate the header rejects, kept to print its agreement. */
function estimatedRefused(E: Ev[], i: number): boolean {
  const e = E[i]
  for (let j = i - 1; j >= 0 && e.t - E[j].t <= 120_000; j--) {
    if (E[j].type !== 'capture-event' || e.t - E[j].t <= 400) continue
    if (E[j].trackId === e.trackId) return true
    let k = i - 1
    while (k > j && E[k].trackId !== E[j].trackId) k--
    if (e.t - E[k].t <= REGION_DEPARTURE_MS + RECORDER_SLACK_MS && polyIoU(E[k].quad, e.quad) >= REGION_SAME_IOU) return true
  }
  return false
}

// ── main ────────────────────────────────────────────────────────────────────

const report: string[] = []
const say = (s = '') => {
  report.push(s)
  console.log(s)
}
fs.mkdirSync(OUT, { recursive: true })
const dump: Record<string, unknown> = {}
const LABELS_FILE = opt('--labels', fileURLToPath(new URL('./owner-rearm-labels.json', import.meta.url)))
const LABELS: Record<string, Record<string, string>> = fs.existsSync(LABELS_FILE) ? JSON.parse(fs.readFileSync(LABELS_FILE, 'utf8')) : {}
const TOTAL: Record<number, { cards: number; rescued: number; sameLocks: number; sameCards: number; motion: number }> = {}
const LOWER = { cards: 0, rescued: 0, sameLocks: 0 }

for (const name of ['s1', 's2', 's3']) {
  const E = loadSession(name)
  if (!E) {
    say(`${name}: not found under ${ROOT}`)
    continue
  }
  const M: Meas[] = []
  for (const e of E) M.push(await measure(e))
  const sim = (i: number, j: number) => 0.5 * ncc(M[i].gray, M[j].gray) + 0.5 * ncc(M[i].rgb, M[j].rgb)
  /** The look an event is compared with: a capture's own pixels, else its frame. */
  const lookOf = (i: number) => (E[i].type === 'capture-event' ? (M[i].capLook ?? M[i].look) : M[i].look)
  const t0 = E[0].t
  const ts = (i: number) => `${((E[i].t - t0) / 1000).toFixed(1)}s`

  const caps = E.filter((e) => e.type === 'capture-event')
  say(`\n════ ${name}: ${E.length} events (${E.length - caps.length} locks, ${caps.length} captures, ${caps.filter((c) => c.trigger === 'manual').length} manual)`)
  say(`  null looks: ${M.filter((m) => !m.look).length} (corner order undecided near 45°: ${M.filter((m) => m.undecided).length})`)

  // ── A. validation ──
  if (name === 's1') {
    const idf = path.join(ROOT, 'owner-session-1', 'card-identity.json')
    if (fs.existsSync(idf)) {
      // card-identity.json is in epochMs order; compare by key.
      const ID = JSON.parse(fs.readFileSync(idf, 'utf8')) as { events: Array<{ file: string; simToPrev: number | null }> }
      const byKey = new Map(E.map((e, i) => [e.key, i]))
      let maxErr = 0
      for (let k = 1; k < ID.events.length; k++) {
        const a = byKey.get(ID.events[k - 1].file.replace(/\.json$/, ''))!
        const b = byKey.get(ID.events[k].file.replace(/\.json$/, ''))!
        maxErr = Math.max(maxErr, Math.abs((ID.events[k].simToPrev ?? 0) - sim(a, b)))
      }
      say(`  ground truth reproduces card-identity.json: max |Δ| = ${maxErr.toFixed(4)} over ${ID.events.length - 1} pairs`)
    }
  }
  const self: number[] = []
  for (let i = 0; i < E.length; i++) if (M[i].capLook && M[i].look) self.push(lookDistance(M[i].capLook!, M[i].look!))
  say(`  one capture, captureLook(crop) vs cardLook(its recorded frame): ${dist(self)}`)

  // ── B. distributions ──
  const consSame: number[] = []
  const consDiff: number[] = []
  const steady2s: number[] = []
  for (let i = 1; i < E.length; i++) {
    const a = lookOf(i - 1)
    const b = lookOf(i)
    if (!a || !b) continue
    const s = sim(i - 1, i)
    const d = lookDistance(a, b)
    if (s >= SAME) consSame.push(d)
    else if (s < DIFFERENT) consDiff.push(d)
    if (s >= SAME && E[i].trackId === E[i - 1].trackId && E[i].type === 'lock-event' && E[i - 1].type === 'lock-event') steady2s.push(d)
  }
  const vsSame: number[] = []
  const vsDiff: number[] = []
  for (let c = 0; c < E.length; c++) {
    if (E[c].type !== 'capture-event' || !lookOf(c)) continue
    for (let i = c + 1; i < E.length && E[i].t - E[c].t <= 60_000; i++) {
      const l = lookOf(i)
      if (!l) continue
      const s = sim(i, c)
      const d = lookDistance(l, lookOf(c)!)
      if (s >= SAME) vsSame.push(d)
      else if (s < DIFFERENT) vsDiff.push(d)
    }
  }
  say(`  B. look distance by ground truth (re-arm fires above ${REARM_NEW_MIN}):`)
  say(`    consecutive events  same ${dist(consSame)}   > ${REARM_NEW_MIN}: ${frac(consSame, (x) => x > REARM_NEW_MIN)}`)
  say(`                        diff ${dist(consDiff)}   <= ${REARM_NEW_MIN}: ${frac(consDiff, (x) => x <= REARM_NEW_MIN)}`)
  say(`    event vs an earlier capture (<= 60 s), against its captureLook:`)
  say(`                        same ${dist(vsSame)}   > ${REARM_NEW_MIN}: ${frac(vsSame, (x) => x > REARM_NEW_MIN)}`)
  say(`                        diff ${dist(vsDiff)}   <= ${REARM_NEW_MIN}: ${frac(vsDiff, (x) => x <= REARM_NEW_MIN)}`)
  for (const th of [0.7, 0.8, 0.9, 1.0, 1.1, 1.2])
    say(`      threshold ${th.toFixed(1)}: same > t ${frac(vsSame, (x) => x > th).padEnd(12)} diff <= t ${frac(vsDiff, (x) => x <= th)}`)
  say(`    steadiness proxy, same track + same card, recorded locks ~2 s apart: ${dist(steady2s)}   <= ${REARM_STEADY_MAX}: ${frac(steady2s, (x) => x <= REARM_STEADY_MAX)}`)

  // ── C. long presentations: every same-card chain of >= 5 events ──
  const chains: Array<{ a: number; b: number; toFirst: number; anyPair: number; over: number }> = []
  for (let a = 0; a < E.length; ) {
    let b = a
    while (b + 1 < E.length && sim(b, b + 1) >= SAME) b++
    if (b - a >= 4) {
      const ls = [] as CardLook[]
      let toFirst = 0
      let anyPair = 0
      let over = 0
      for (let i = a; i <= b; i++) {
        const l = lookOf(i)
        if (!l) continue
        for (const o of ls) anyPair = Math.max(anyPair, lookDistance(l, o))
        if (ls.length) {
          const d = lookDistance(l, ls[0])
          toFirst = Math.max(toFirst, d)
          if (d > REARM_NEW_MIN) over++
        }
        ls.push(l)
      }
      chains.push({ a, b, toFirst, anyPair, over })
    }
    a = b + 1
  }
  say(`  C. same-card chains of >= 5 consecutive events (one card held): ${chains.length}`)
  for (const c of chains)
    say(
      `    ${ts(c.a).padStart(7)} ${String(c.b - c.a + 1).padStart(2)} events over ${((E[c.b].t - E[c.a].t) / 1000).toFixed(1).padStart(5)} s, ${E.slice(c.a, c.b + 1).filter((e) => e.type === 'capture-event').length} captures: max to first ${f2(c.toFirst)} (> ${REARM_NEW_MIN}: ${c.over}), max any pair ${f2(c.anyPair)}`,
    )

  // ── D. the locks the shipping policy refuses, judged ──
  const lockIdx = E.map((e, i) => (e.type === 'lock-event' ? i : -1)).filter((i) => i >= 0)
  const shippingBuild = name === 's3'
  const est = new Map(lockIdx.map((i) => [i, refusersOf(E, i, shippingBuild)]))
  const refused = lockIdx.filter((i) => est.get(i)!.refusers.length > 0)
  const recRefused = (i: number) => !!E[i].suppressedByRegion || !E[i].wouldCapture
  let agreeEst = 0
  for (const i of lockIdx) if (estimatedRefused(E, i) === recRefused(i)) agreeEst++
  const Vr = judgeRecordedLocks(E, M)
  let agreeReplay = 0
  for (const i of lockIdx) if (Vr.get(i)!.repeat === recRefused(i)) agreeReplay++
  say(`  D. refused as a repeat: the build ${lockIdx.filter(recRefused).length} of ${lockIdx.length} locks [${shippingBuild ? 'shipping region policy' : name === 's2' ? '12 s departure' : 'overlap follow, 12 s departure'}]; under the shipping policy ${refused.length} (${refused.filter((i) => est.get(i)!.refractory >= 0).length} by the refractory)`)
  say(`    (flag-free estimates of the refusals agree with the build on ${agreeEst}/${lockIdx.length} (quads) and ${agreeReplay}/${lockIdx.length} (region replay) — not used)`)

  /** The previous recorded lock of the same track — the lower bound's steadiness reference. */
  const prevLock = (i: number) => {
    for (let j = i - 1; j >= 0; j--) if (E[j].type === 'lock-event' && E[j].trackId === E[i].trackId) return j
    return -1
  }
  /** The SHIPPING judge (rearm.ts), on this lock and these refusers. */
  const fires = (i: number, refusers: number[], newMin: number, steady: 'upper' | 'lower') => {
    const look = M[i].look
    const r = createLookRearm({ newMin })
    if (steady === 'upper') {
      if (look) r.judge(E[i].trackId, look, [])
    } else {
      const p = prevLock(i)
      if (p >= 0 && M[p].look) r.judge(E[i].trackId, M[p].look!, [])
    }
    return r.judge(E[i].trackId, look, refusers.map((c) => (c >= 0 ? lookOf(c) : null)))
  }

  interface Row {
    i: number
    why: string
    refusers: number[]
    kind: 'new' | 'same' | 'unk' | 'nolook' | 'nocap'
    sims: number[]
    dists: number[]
    upper: boolean
    lower: boolean
    /** For a new card: the first later recorded capture of it (NCC >= SAME), or -1. */
    capturedAt: number
  }
  const rows: Row[] = []
  for (const i of refused) {
    const { refusers, refractory } = est.get(i)!
    const sims = refusers.map((c) => (c >= 0 ? sim(i, c) : NaN))
    const dists = refusers.map((c) => (c >= 0 && M[i].look ? lookDistance(M[i].look!, lookOf(c)!) : NaN))
    const kind: Row['kind'] = refusers.some((c) => c < 0)
      ? 'nocap'
      : !M[i].look
        ? 'nolook'
        : sims.some((s) => s >= SAME)
          ? 'same'
          : sims.every((s) => s < DIFFERENT)
            ? 'new'
            : 'unk'
    let capturedAt = -1
    if (kind === 'new')
      for (let j = i + 1; j < E.length; j++)
        if (E[j].type === 'capture-event' && sim(i, j) >= SAME) {
          capturedAt = j
          break
        }
    rows.push({
      i,
      why: `${refractory >= 0 ? 'F' : ''}${est.get(i)!.regions.length ? 'R' : ''}`,
      refusers,
      kind,
      sims,
      dists,
      upper: fires(i, refusers, REARM_NEW_MIN, 'upper'),
      lower: fires(i, refusers, REARM_NEW_MIN, 'lower'),
      capturedAt,
    })
  }
  say(`    by NCC vs the capture(s) behind the refusal (>= ${SAME} same, < ${DIFFERENT} new); re-arm fires: upper = steady, lower = steady over the 2 s between recorded locks:`)
  for (const k of ['new', 'same', 'unk', 'nolook', 'nocap'] as const) {
    const xs = rows.filter((r) => r.kind === k)
    if (!xs.length) continue
    const mins = xs.filter((r) => r.dists.some(Number.isFinite)).map((r) => Math.min(...r.dists.filter(Number.isFinite)))
    say(`      ${k.padEnd(6)} ${String(xs.length).padStart(3)}   upper ${frac(xs.map((r) => +r.upper), (x) => x === 1).padEnd(12)} lower ${frac(xs.map((r) => +r.lower), (x) => x === 1).padEnd(12)} nearest refuser d ${dist(mins)}`)
  }

  // ── BY EYE: owner-rearm-labels.json, which the NCC bands cannot replace —
  // they call a blurred frame of one card "new", and two washed-out trainers
  // "unknown". NCC >= 0.9 is taken as the same card unlabelled.
  const lab = LABELS[name] ?? {}
  const eye = (r: Row) => {
    if (r.kind === 'nocap' || r.kind === 'nolook') return { cls: r.kind as string, card: '', note: '' }
    const l = lab[E[r.i].key]
    if (l) {
      const [head, ...rest] = l.split(':')
      const [cls, ...words] = head.trim().split(' ')
      return { cls, card: words.join(' '), note: rest.join(':').trim() }
    }
    if (r.sims.some((s) => s >= 0.9)) return { cls: 'same', card: '', note: 'NCC >= 0.9' }
    return { cls: 'unlabelled', card: '', note: '' }
  }
  const E2 = rows.map((r) => ({ r, ...eye(r) }))
  say(`    BY EYE (${Object.keys(lab).length} labels):`)
  for (const k of ['new', 'same', 'motion', 'nolook', 'nocap', 'unlabelled']) {
    const xs = E2.filter((x) => x.cls === k)
    if (!xs.length) continue
    say(`      ${k.padEnd(10)} ${String(xs.length).padStart(3)} refused locks   fire: upper ${String(xs.filter((x) => x.r.upper).length).padStart(2)}, lower ${String(xs.filter((x) => x.r.lower).length).padStart(2)}`)
  }
  const byCard = new Map<string, typeof E2>()
  for (const x of E2.filter((y) => y.cls === 'new')) {
    if (!byCard.has(x.card)) byCard.set(x.card, [])
    byCard.get(x.card)!.push(x)
  }
  /** When the card is taken WITHOUT the re-arm: its first later recorded
   *  capture, or its first later lock the shipping policy does not refuse
   *  (sessions 1-2, whose builds refused more) — the card found by picture. */
  const refusedSet = new Set(refused)
  const firstCaptureOf = (xs: typeof E2) => {
    for (let j = xs[0].r.i + 1; j < E.length; j++) {
      if (!xs.some((x) => sim(x.r.i, j) >= SAME)) continue
      if (E[j].type === 'capture-event' || !refusedSet.has(j)) return j
    }
    return -1
  }
  say(`    new cards the shipping policy refuses: ${byCard.size}; the re-arm fires on ${[...byCard.values()].filter((xs) => xs.some((x) => x.r.upper)).length} (upper), ${[...byCard.values()].filter((xs) => xs.some((x) => x.r.lower)).length} (lower)`)
  for (const [card, xs] of byCard) {
    const up = xs.find((x) => x.r.upper)
    const lo = xs.find((x) => x.r.lower)
    const cap = firstCaptureOf(xs)
    const ds = xs.map((x) => Math.min(...x.r.dists.filter(Number.isFinite)))
    say(
      `      ${card.padEnd(26)} ${ts(xs[0].r.i).padStart(7)} ${String(xs.length).padStart(2)} lock(s)  nearest-refuser d ${f2(Math.min(...ds))}-${f2(Math.max(...ds))}  ${up ? `FIRES at ${ts(up.r.i)}${up.note ? ` (${up.note})` : ''}` : 'held'}${lo ? `, lower at ${ts(lo.r.i)}` : ''}  | without the re-arm: ${cap >= 0 ? `${E[cap].type === 'capture-event' ? 'captured' : 'free lock'} at ${ts(cap)}${up ? ` (${((E[cap].t - E[up.r.i].t) / 1000).toFixed(1)} s later)` : ''}` : 'not found by picture'}`,
    )
  }
  const falseFires = E2.filter((x) => x.cls === 'same' && x.r.upper)
  const motionFires = E2.filter((x) => x.cls === 'motion' && x.r.upper)
  say(`    same-card locks the re-arm fires on (duplicates): ${falseFires.length} locks, ${new Set(falseFires.map((x) => x.card)).size} cards`)
  for (const x of falseFires)
    say(`      ${ts(x.r.i).padStart(7)} ${x.card}: d ${x.r.dists.map(f2).join('/')}${x.r.lower ? ' (lower too)' : ''} — ${x.note}`)
  say(`    motion frames it fires on (steadiness should hold them; if not, a junk capture): ${motionFires.length}${motionFires.length ? ` at ${motionFires.map((x) => ts(x.r.i)).join(', ')}` : ''}${motionFires.some((x) => x.r.lower) ? ' (some even at the lower bound)' : ''}`)
  say(`    REARM_NEW_MIN sweep, by eye (upper bound): new cards rescued / same-card locks firing (cards) / motion frames firing`)
  for (const th of [0.6, 0.7, 0.8, 0.85, 0.9, 0.95, 1.0, 1.1, 1.2]) {
    const nc = [...byCard.values()].filter((xs) => xs.some((x) => fires(x.r.i, x.r.refusers, th, 'upper'))).length
    const sf = E2.filter((x) => x.cls === 'same' && fires(x.r.i, x.r.refusers, th, 'upper'))
    const mf = E2.filter((x) => x.cls === 'motion' && fires(x.r.i, x.r.refusers, th, 'upper')).length
    say(`      ${th.toFixed(2)}${th === REARM_NEW_MIN ? '*' : ' '} ${String(nc).padStart(2)}/${byCard.size}   ${String(sf.length).padStart(2)} (${new Set(sf.map((x) => x.card)).size})   ${mf}`)
    const T = (TOTAL[th] ??= { cards: 0, rescued: 0, sameLocks: 0, sameCards: 0, motion: 0 })
    T.cards += byCard.size
    T.rescued += nc
    T.sameLocks += sf.length
    T.sameCards += new Set(sf.map((x) => `${name}:${x.card}`)).size
    T.motion += mf
  }
  LOWER.cards += byCard.size
  LOWER.rescued += [...byCard.values()].filter((xs) => xs.some((x) => x.r.lower)).length
  LOWER.sameLocks += E2.filter((x) => x.cls === 'same' && x.r.lower).length
  say(`    every refused lock the re-arm fires on (upper) — [capture behind it: t, track, ncc, d]:`)
  for (const x of E2.filter((y) => y.r.upper)) {
    const r = x.r
    const text = r.refusers.map((c, k) => `[${ts(c)} t${E[c].trackId} ${f2(r.sims[k])} ${f2(r.dists[k])}]`).join(' ')
    say(`      ${ts(r.i).padStart(7)} t${E[r.i].trackId} ${E[r.i].key} ${x.cls.padEnd(6)} ${x.card.padEnd(22)}${r.lower ? ' lower' : '      '}  ${text}`)
  }

  dump[name] = {
    events: E.map((e, i) => ({ key: e.key, type: e.type, trigger: e.trigger ?? null, t: e.t, trackId: e.trackId, lookNull: !M[i].look })),
    rows: rows.map((r) => ({ ...r, key: E[r.i].key, refuserKeys: r.refusers.map((c) => (c >= 0 ? E[c].key : null)) })),
    chains,
  }

  // ── sheets ──
  if (SHEETS) {
    const tile = (i: number, l1: string, l2: string, border?: string): Tile => ({
      image: { data: M[i].card.data, width: 126, height: 176, channels: 4 },
      lines: [l1, l2],
      border,
    })
    const all = E.map((e, i) =>
      tile(
        i,
        `${ts(i)} ${e.type === 'capture-event' ? (e.trigger === 'manual' ? 'MAN' : 'CAP') : 'lk'} t${e.trackId}`,
        `s${i ? sim(i - 1, i).toFixed(2) : '-'} d${i && lookOf(i) && lookOf(i - 1) ? lookDistance(lookOf(i)!, lookOf(i - 1)!).toFixed(2) : '-'}${e.suppressedByRegion ? ' R' : ''}${e.type === 'lock-event' && !e.wouldCapture ? ' F' : ''}`,
        e.type === 'capture-event' ? (e.trigger === 'manual' ? '#3af' : '#f33') : undefined,
      ),
    )
    for (let p = 0; p * 60 < all.length; p++)
      await contactSheet(all.slice(p * 60, p * 60 + 60), {
        thumbW: 84,
        thumbH: 117,
        cols: 12,
        title: [`${name} events in tick order: s = NCC, d = look distance, to the previous event; red CAP, blue MAN; R region, F refractory`],
        out: path.join(OUT, `${name}-events-${p}.png`),
      })
    // Every refused lock the re-arm fires on, every new card's refused lock,
    // and every unknown one: the capture(s) behind the refusal, then the lock.
    const pairs: Tile[] = []
    for (const r of rows.filter((x) => x.upper || x.kind === 'new' || x.kind === 'unk')) {
      r.refusers.forEach((c, k) => {
        if (c >= 0) pairs.push(tile(c, `${ts(c)} cap t${E[c].trackId}`, `ncc ${f2(r.sims[k])}`))
      })
      pairs.push(
        tile(
          r.i,
          `${ts(r.i)} ${r.kind} ${r.upper ? 'FIRE' : 'hold'}`,
          `d ${r.dists.map((d) => (Number.isFinite(d) ? d.toFixed(2).replace(/^0/, '') : '-')).join('/')}`,
          r.upper ? (r.kind === 'new' ? '#3f3' : r.kind === 'same' ? '#f33' : '#fa0') : '#777',
        ),
      )
    }
    for (let p = 0; p * 60 < pairs.length; p++)
      await contactSheet(pairs.slice(p * 60, p * 60 + 60), {
        thumbW: 96,
        thumbH: 134,
        cols: 12,
        title: [`${name}: refused locks (bordered), each after the capture(s) behind its refusal. Green FIRE new, red FIRE same, orange FIRE unknown, grey hold`],
        out: path.join(OUT, `${name}-refused-${p}.png`),
      })
  }
}

say(`\n════ ALL SESSIONS, by eye: REARM_NEW_MIN -> new cards rescued of those refused / same-card locks firing (distinct cards) / motion frames firing`)
for (const th of Object.keys(TOTAL).map(Number).sort((a, b) => a - b)) {
  const T = TOTAL[th]
  say(`  ${th.toFixed(2)}${th === REARM_NEW_MIN ? '*' : ' '} ${String(T.rescued).padStart(2)}/${T.cards}   ${String(T.sameLocks).padStart(2)} (${T.sameCards})   ${T.motion}`)
}
say(`  lower bound at ${REARM_NEW_MIN}: ${LOWER.rescued}/${LOWER.cards} rescued, ${LOWER.sameLocks} same-card locks firing`)

fs.writeFileSync(path.join(OUT, 'owner-rearm.json'), JSON.stringify(dump))
fs.writeFileSync(path.join(OUT, 'owner-rearm.txt'), report.join('\n') + '\n')
console.log(`\nwrote ${OUT}`)
