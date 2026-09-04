// Offline AUTO-CAPTURE audit: which frames of the phase-0b corpus would fire a
// LOCK, and therefore an automatic capture, in the shipping product?
//
// WHY THIS EXISTS. BLIND-VERIFICATION.md judged the engine's drawn quad on all
// 87 session-2 frames and found a confident quad on 24 of the 26 frames with no
// card in them. That measured the DETECTOR. It did not measure the PRODUCT,
// because the product does not capture on a quad — it captures on a LOCK, which
// is a quad that survived the presence gate, the tracker's reticle gate, the
// tracker's stability requirement, and then sat card-shaped and centred for
// `lockTicks` consecutive ticks. "24/26 wrong quads" and "24/26 wrong captures"
// are very different claims and only the second one is the owner's bug.
//
// So this drives the REAL path — the shipping preprocess, the real LC050 through
// the sidecar, the real presence gate, the real refiner, the real tracker, and
// `index.createLockPolicy` itself, not a copy of its rules — and reports the
// confusion table that auto-capture actually produces.
//
// THE DWELL MODEL, AND ITS HONEST LIMIT. The corpus is 87 stills taken seconds
// apart, not a video, so there is no real inter-frame motion to replay. Each
// frame is therefore held STATIC for `--ticks` detect ticks, which models "the
// user holds the phone still over this scene" and is the WORST CASE for false
// captures: a motionless quad associates with itself at IoU 1.0 every tick, ages
// to stable, and dwells without interruption. Real hand motion can only reduce
// these lock counts, never raise them. `--jitter <px>` perturbs corners per tick
// to sanity-check that claim. Numbers here are an UPPER BOUND on clutter locks
// and a LOWER BOUND on the cost to real cards; neither is a device measurement.
//
//   node --import tsx src/scan/engine/__tests__/clutter-lock.ts
//   node --import tsx src/scan/engine/__tests__/clutter-lock.ts --box 428x324
//   node --import tsx src/scan/engine/__tests__/clutter-lock.ts --scale 1.5 --jitter 3

import fs from 'node:fs'
import path from 'node:path'

import type { Quad, TrackedQuad } from '../contract'
import { createPresenceGate } from '../gate'
import { CAPTURE_MARGIN, expandQuad, rectifyImageData } from '../rectify'
import {
  centroid,
  insideFraction,
  oppositeSideRatio,
  polyArea,
  quadAspectRatio,
  type ImageDataLike,
  type Rect,
} from '../geometry'
import {
  CANONICAL_SIZE,
  DEFAULT_CARD_ASPECT,
  modelPointsToCanonicalQuad,
  PIPELINE_VERSION,
  reticleForAspect,
  squareCrop,
} from '../frame'
import {
  createLockPolicy,
  DEFAULT_LOCK_ASPECT_TOL,
  DEFAULT_LOCK_MIN_SATURATION,
  DEFAULT_LOCK_PARALLEL_MIN,
} from '../index'
import { MODEL_SIZE } from '../preprocess'
import { gradientField, quadMeanSaturation, refineQuadChecked } from '../refine'
import { createTracker } from '../tracker'
import {
  engineInput,
  listFlagFrames,
  loadRGBA,
  ortAvailable,
  writePNG,
  runModel,
  sharp,
  SESSION2,
  toTensor,
  type FlagFrame,
} from './offline-harness'

// ---------------------------------------------------------------------------
// labels — parsed from the blind verification, never hand-copied
// ---------------------------------------------------------------------------

const BLIND =
  'E:/users/cheyr/deckpal/roadmap/plans/card-scanner-redesign/p2-work/phase0b/session2/engine-diag/BLIND-VERIFICATION.md'

/** `card?` per frame from BLIND-VERIFICATION.md's own table — the independent,
 *  hand-judged "is a card actually presented here" column. Parsed at run time so
 *  this file can never drift from the judgement it cites. */
function cardLabels(): Map<string, boolean> {
  const out = new Map<string, boolean>()
  for (const line of fs.readFileSync(BLIND, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\|\s*(F\d{3})\s*\|[^|]*\|\s*(yes|no)\s*\|/)
    if (m) out.set(m[1], m[2] === 'yes')
  }
  return out
}

// ---------------------------------------------------------------------------
// one frame -> one detection (inference is reticle-independent, so it is done
// ONCE per frame and replayed across every gate configuration)
// ---------------------------------------------------------------------------

interface Detection {
  frame: FlagFrame
  w: number
  h: number
  /** The engine's final quad in frame px, or null when the presence gate shut. */
  quad: Quad | null
  hasObj: number
  aspect: number
  /** Mean colour saturation inside the quad — the card signature. */
  saturation: number
}

/** index.ts `refine()`, offline: the same gradient-field refinement over the
 *  same working image, at the same REFINE_LONG_SIDE. */
function refineLocal(img: ImageDataLike, quad: Quad, crop: Rect): Quad | null {
  const sx = img.width / crop.w
  const sy = img.height / crop.h
  const F = gradientField(img)
  const local = quad.map(([x, y]) => [(x - crop.x) * sx, (y - crop.y) * sy]) as Quad
  const r = refineQuadChecked(local, F)
  if (!r) return null
  return r.map(([x, y]) => [x / sx + crop.x, y / sy + crop.y]) as Quad
}

async function workImageFull(file: string, w: number, h: number, longSide: number): Promise<ImageDataLike> {
  const S = await sharp()
  const s = Math.min(1, longSide / Math.max(w, h))
  const rw = Math.max(16, Math.round(w * s))
  const rh = Math.max(16, Math.round(h * s))
  const buf = await S(file).resize({ width: rw, height: rh, fit: 'fill', kernel: 'lanczos3' }).ensureAlpha().raw().toBuffer()
  return { width: rw, height: rh, data: new Uint8ClampedArray(buf.buffer, buf.byteOffset, buf.length) }
}

/** Rescale a frame to `scale` and write it to a temp PNG — used to run the
 *  corpus at the LIVE working resolution rather than only at 480x640. */
async function scaledFile(f: FlagFrame, scale: number, dir: string): Promise<{ file: string; w: number; h: number }> {
  if (scale === 1) return { file: f.png, w: f.width, h: f.height }
  const w = Math.round(f.width * scale)
  const h = Math.round(f.height * scale)
  const out = path.join(dir, `${f.name}_${w}x${h}.png`)
  if (!fs.existsSync(out)) {
    const S = await sharp()
    await S(f.png).resize({ width: w, height: h, fit: 'fill', kernel: 'lanczos3' }).png().toFile(out)
  }
  return { file: out, w, h }
}

/**
 * PIPELINE VERSION 3 preprocessing, offline.
 *
 * The corpus is a VERSION-2 dataset — 480x640 frames from the letterboxed
 * full-frame era. Replaying it against the shipping spec means putting each
 * frame through the SAME centre-square crop the engine now applies to a camera
 * stream and treating the result as the canonical frame. `frame.squareCrop` is
 * the engine's own function, so this measures the shipping decision rather than
 * an approximation of it, and every quad below is in canonical coordinates.
 */
async function squareInput(file: string, w: number, h: number, out: number): Promise<ImageDataLike> {
  const S = await sharp()
  const c = squareCrop(w, h)
  const buf = await S(file)
    .extract({ left: c.x, top: c.y, width: c.size, height: c.size })
    .resize({ width: out, height: out, fit: 'fill', kernel: 'lanczos3' })
    .ensureAlpha()
    .raw()
    .toBuffer()
  return { width: out, height: out, data: new Uint8ClampedArray(buf.buffer, buf.byteOffset, buf.length) }
}

async function detect(frames: FlagFrame[], scale: number): Promise<Detection[]> {
  const dir = path.join(SESSION2, '.scaled')
  if (scale !== 1) fs.mkdirSync(dir, { recursive: true })
  const prepared: Array<{ f: FlagFrame; file: string; w: number; h: number; tensor: Float32Array }> = []
  for (const f of frames) {
    const { file, w, h } = await scaledFile(f, scale, dir)
    // PIPELINE VERSION 3: a plain resize of the CENTRE SQUARE, no letterbox.
    prepared.push({ f, file, w, h, tensor: toTensor(await squareInput(file, w, h, MODEL_SIZE)) })
  }
  const outs = runModel(prepared.map((p) => p.tensor))

  const dets: Detection[] = []
  for (let i = 0; i < prepared.length; i++) {
    const { f, file, w, h } = prepared[i]
    const { points, hasObj } = outs[i]
    // THE GATE IS A LATCH, AND WHICH SIDE OF IT YOU START ON MATTERS ENORMOUSLY.
    // A corpus of independent stills has no previous frame, so the obvious
    // choice is a fresh (CLOSED) gate per frame — that is the `acquire` = 0.80
    // rule, and it models a COLD START: the app has just opened on this scene.
    //
    // But the owner's failure is not a cold start. It is mid-session: a card was
    // just scanned, so the gate is OPEN, and it now stays open on anything
    // scoring >= `hold` = 0.30 as the phone moves across the table. `--gate open`
    // models that, and it is the case the product actually fails in.
    const gate = createPresenceGate()
    if (GATE_OPEN) gate.update(1) // latch it open, as a just-scanned card would
    let quad: Quad | null = null
    let sat = 0
    if (gate.update(hasObj)) {
      // Model fractions ARE canonical fractions now, and the working image IS
      // the canonical frame — so the refiner needs no coordinate change at all.
      const raw = modelPointsToCanonicalQuad(points)
      if (raw) {
        const work = await squareInput(file, w, h, CANONICAL_SIZE)
        quad = refineQuadChecked(raw, gradientField(work)) ?? raw
        sat = quadMeanSaturation(work, quad)
      }
    }
    dets.push({ frame: f, w, h, quad, hasObj, aspect: quad ? quadAspectRatio(quad) : 0, saturation: sat })
  }
  return dets
}

// ---------------------------------------------------------------------------
// one detection + one gate configuration -> does it LOCK?
// ---------------------------------------------------------------------------

interface Config {
  label: string
  aspectTol: number
  /** Straddle gate; 0 disables. */
  parallelMin: number
  /** Card-signature gate (mean saturation); 0 disables. */
  minSat: number
}

function jitterQuad(q: Quad, px: number, tick: number): Quad {
  if (!px) return q
  // Deterministic pseudo-motion: a small rotation of a fixed offset per corner,
  // so a run is reproducible and every corner moves by exactly `px`.
  return q.map(([x, y], i) => {
    const a = (tick * 1.7 + i * 1.3) % (Math.PI * 2)
    return [x + Math.cos(a) * px, y + Math.sin(a) * px]
  }) as Quad
}

function locksUnder(d: Detection, cfg: Config, ticks: number, jitter: number): boolean {
  // The reticle is a CONSTANT of the canonical square now — no viewport input.
  const reticle = reticleForAspect()
  const N = CANONICAL_SIZE
  const tracker = createTracker()
  tracker.setReticle({ x: reticle.x * N, y: reticle.y * N, w: reticle.w * N, h: reticle.h * N })
  const policy = createLockPolicy({
    lockAspectTol: cfg.aspectTol,
    lockParallelMin: cfg.parallelMin,
    minSaturation: cfg.minSat,
  })
  // One frame, one detection, so every track shares this frame's signature.
  const satOf = () => d.saturation
  for (let t = 0; t < ticks; t++) {
    const quads: Quad[] = d.quad ? [jitterQuad(d.quad, jitter, t)] : []
    const { stable } = tracker.update(quads)
    if (policy.update(stable as TrackedQuad[], reticle, N, N, satOf)) return true
  }
  return false
}

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------

function arg(name: string, dflt: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt
}

/** True when the presence gate should start LATCHED OPEN — see `detect()`. */
const GATE_OPEN = arg('gate', 'cold') === 'open'

/** Why a track that locked under the baseline stopped locking — so a lost card
 *  is attributable to a specific rule instead of merely counted. */
function lossReason(d: Detection, cfg: Config): string {
  if (!d.quad) return 'no quad'
  const reticle = reticleForAspect()
  const N = CANONICAL_SIZE
  const px: Rect = { x: reticle.x * N, y: reticle.y * N, w: reticle.w * N, h: reticle.h * N }
  const A = DEFAULT_CARD_ASPECT
  const shaped = cfg.aspectTol <= 0 || (d.aspect >= A * (1 - cfg.aspectTol) && d.aspect <= A * (1 + cfg.aspectTol))
  const par = oppositeSideRatio(d.quad)
  const inside = insideFraction(d.quad, px)
  const cen = centroid(d.quad)
  const centred = cen[0] >= px.x && cen[0] <= px.x + px.w && cen[1] >= px.y && cen[1] <= px.y + px.h
  const why: string[] = []
  if (!shaped) why.push(`aspect ${d.aspect.toFixed(3)}`)
  if (cfg.parallelMin > 0 && par < cfg.parallelMin) why.push(`straddle ratio ${par.toFixed(3)}`)
  if (!centred) why.push('centroid outside reticle')
  if (inside < 0.65) why.push(`only ${(inside * 100).toFixed(0)}% inside reticle`)
  return why.join(' + ') || 'unknown'
}

async function main(): Promise<void> {
  if (!ortAvailable()) {
    console.error('onnxruntime sidecar unavailable (python venv / model / sidecar missing) — cannot run.')
    process.exit(2)
  }
  const ticks = Number(arg('ticks', '10'))
  const jitter = Number(arg('jitter', '0'))
  const scale = Number(arg('scale', '1'))

  const labels = cardLabels()
  const frames = listFlagFrames()
  console.log(`corpus: ${frames.length} frames  |  ticks/frame: ${ticks}  jitter: ${jitter}px  scale: ${scale}x`)
  const dets = await detect(frames, scale)
  console.log(
    `source frames ${dets[0].w}x${dets[0].h} -> canonical square ${CANONICAL_SIZE}x${CANONICAL_SIZE}` +
      `  (pipeline v${PIPELINE_VERSION})\n`,
  )

  const configs: Config[] = [
    { label: 'A  no lock priors at all', aspectTol: 0, parallelMin: 0, minSat: 0 },
    { label: `B  + aspect prior (tol ${DEFAULT_LOCK_ASPECT_TOL})`, aspectTol: DEFAULT_LOCK_ASPECT_TOL, parallelMin: 0, minSat: 0 },
    { label: `C  + straddle gate (min ${DEFAULT_LOCK_PARALLEL_MIN})`, aspectTol: 0, parallelMin: DEFAULT_LOCK_PARALLEL_MIN, minSat: 0 },
    { label: `D  + card signature (sat ${DEFAULT_LOCK_MIN_SATURATION})`, aspectTol: 0, parallelMin: 0, minSat: DEFAULT_LOCK_MIN_SATURATION },
    {
      label: 'E  ALL THREE (shipping)',
      aspectTol: DEFAULT_LOCK_ASPECT_TOL,
      parallelMin: DEFAULT_LOCK_PARALLEL_MIN,
      minSat: DEFAULT_LOCK_MIN_SATURATION,
    },
  ]

  const noCard = dets.filter((d) => labels.get(d.frame.name) === false)
  const card = dets.filter((d) => labels.get(d.frame.name) === true)
  console.log(`labels from BLIND-VERIFICATION.md: ${card.length} card frames, ${noCard.length} no-card frames`)
  console.log(`detector drew a quad on ${noCard.filter((d) => d.quad).length}/${noCard.length} no-card frames ` +
    `and ${card.filter((d) => d.quad).length}/${card.length} card frames\n`)

  const pad = (s: string, n: number) => s.padEnd(n)
  console.log(pad('configuration', 50) + pad('CLUTTER LOCKS', 16) + pad('CARD LOCKS', 16) + 'cards kept')
  console.log('-'.repeat(96))
  const results = new Map<string, { bad: Detection[]; good: Detection[] }>()
  for (const cfg of configs) {
    const bad = noCard.filter((d) => locksUnder(d, cfg, ticks, jitter))
    const good = card.filter((d) => locksUnder(d, cfg, ticks, jitter))
    results.set(cfg.label, { bad, good })
    console.log(
      pad(cfg.label, 50) +
        pad(`${bad.length}/${noCard.length}  (${((bad.length / noCard.length) * 100).toFixed(0)}%)`, 16) +
        pad(`${good.length}/${card.length}  (${((good.length / card.length) * 100).toFixed(0)}%)`, 16) +
        `${good.length}`,
    )
  }

  const base = results.get(configs[0].label)!
  const fixed = results.get(configs[configs.length-1].label)!
  console.log(`\nclutter locks removed by the fix : ${base.bad.length - fixed.bad.length}` +
    `  (${base.bad.map((d) => d.frame.name).filter((n) => !fixed.bad.some((f) => f.frame.name === n)).join(', ') || 'none'})`)
  console.log(`clutter locks REMAINING          : ${fixed.bad.map((d) => d.frame.name).join(', ') || 'none'}`)
  const lostCards = base.good.filter((g) => !fixed.good.some((f) => f.frame.name === g.frame.name))
  console.log(`card locks LOST to the fix       : ${lostCards.length}`)
  for (const d of lostCards) console.log(`    ${d.frame.name}  ${lossReason(d, configs[configs.length-1])}`)

  console.log('\n--- aspect-tolerance sweep (straddle gate held at its default) ---')
  console.log(pad('tol', 10) + pad('admits', 20) + pad('clutter locks', 18) + 'card locks')
  console.log('-'.repeat(66))
  for (const tol of [0, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4]) {
    const c: Config = { label: `tol ${tol}`, aspectTol: tol, parallelMin: DEFAULT_LOCK_PARALLEL_MIN, minSat: DEFAULT_LOCK_MIN_SATURATION }
    const bad = noCard.filter((d) => locksUnder(d, c, ticks, jitter)).length
    const good = card.filter((d) => locksUnder(d, c, ticks, jitter)).length
    const A = DEFAULT_CARD_ASPECT
    const lo = tol > 0 ? (A * (1 - tol)).toFixed(3) : '—'
    const hi = tol > 0 ? (A * (1 + tol)).toFixed(3) : '—'
    console.log(pad(String(tol), 10) + pad(tol > 0 ? `${lo}..${hi}` : 'everything', 20) + pad(`${bad}/${noCard.length}`, 18) + `${good}/${card.length}`)
  }

  console.log('\n--- STRADDLE-GATE sweep (aspect prior held at its default) ---')
  console.log(pad('minRatio', 12) + pad('clutter locks', 18) + 'card locks')
  console.log('-'.repeat(50))
  for (const p of [0, 0.7, 0.8, 0.85, 0.9, 0.95]) {
    const c: Config = { label: `par ${p}`, aspectTol: DEFAULT_LOCK_ASPECT_TOL, parallelMin: p, minSat: DEFAULT_LOCK_MIN_SATURATION }
    const bad = noCard.filter((d) => locksUnder(d, c, ticks, jitter)).length
    const good = card.filter((d) => locksUnder(d, c, ticks, jitter)).length
    console.log(pad(p === 0 ? 'off' : String(p), 12) + pad(`${bad}/${noCard.length}`, 18) + `${good}/${card.length}`)
  }

  // --- symptom A: what does a clutter lock actually RECTIFY into? -----------
  // The incoming stack shows `capture()`'s rectified JPEG, so a thumbnail can
  // only "look like a raw photo" if the quad it was warped from covered most of
  // the scene. This measures exactly that, and with --dump writes the images.
  const dump = process.argv.includes('--dump')
  const dumpDir = path.join(SESSION2, 'engine-diag', 'clutter-captures')
  if (dump) fs.mkdirSync(dumpDir, { recursive: true })
  console.log('\n--- coverage of the CAPTURE a clutter lock produces ---')
  console.log(pad('frame', 10) + pad('quad aspect', 14) + pad('capture covers', 18) + 'of the canonical square')
  console.log('-'.repeat(66))
  for (const d of base.bad) {
    if (!d.quad) continue
    const expanded = expandQuad(d.quad, CAPTURE_MARGIN)
    const cov = polyArea(expanded) / (CANONICAL_SIZE * CANONICAL_SIZE)
    console.log(
      pad(d.frame.name, 10) + pad(d.aspect.toFixed(3), 14) + pad(`${(cov * 100).toFixed(1)}%`, 18) + `${CANONICAL_SIZE}²`,
    )
    if (dump) {
      // Warp from the canonical square, which is what the engine now holds.
      const src = await squareInput(d.frame.png, d.w, d.h, CANONICAL_SIZE)
      const out = rectifyImageData(src, expanded)
      if (out) await writePNG(out, path.join(dumpDir, `${d.frame.name}.png`))
    }
  }
  if (dump) console.log(`\nrectified clutter captures written to ${dumpDir}`)

  console.log('\n--- aspect distribution (short/long; a card is 0.716) ---')
  const fmt = (xs: number[]) => {
    if (!xs.length) return 'n/a'
    const s = [...xs].sort((a, b) => a - b)
    const at = (q: number) => s[Math.min(s.length - 1, Math.floor(q * s.length))]
    return `min ${s[0].toFixed(3)}  p10 ${at(0.1).toFixed(3)}  median ${at(0.5).toFixed(3)}  p90 ${at(0.9).toFixed(3)}  max ${s[s.length - 1].toFixed(3)}`
  }
  console.log(`card frames   : ${fmt(card.filter((d) => d.quad).map((d) => d.aspect))}`)
  console.log('\n--- CARD SIGNATURE: mean saturation of the detected quad ---')
  console.log(`card frames   : ${fmt(card.filter((d) => d.quad).map((d) => d.saturation))}`)
  console.log(`no-card frames: ${fmt(noCard.filter((d) => d.quad).map((d) => d.saturation))}`)
  const lowCards = card
    .filter((d) => d.quad && d.saturation < DEFAULT_LOCK_MIN_SATURATION)
    .map((d) => `${d.frame.name} ${d.saturation.toFixed(3)}`)
  console.log(`cards BELOW the ${DEFAULT_LOCK_MIN_SATURATION} gate: ${lowCards.join(', ') || 'none'}`)
  console.log(`(the drive's two postal-envelope captures measured 0.108 and 0.112)`)
  console.log(`no-card frames: ${fmt(noCard.filter((d) => d.quad).map((d) => d.aspect))}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
