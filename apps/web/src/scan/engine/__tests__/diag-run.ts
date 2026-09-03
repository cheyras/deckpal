// Stage-by-stage forensics of the shipping pipeline over phase 0b's 87 live
// frames. Run:
//
//   node --import tsx src/scan/engine/__tests__/diag-run.ts [--overlays]
//   node --import tsx src/scan/engine/__tests__/diag-run.ts --refine-sweep
//   node --import tsx src/scan/engine/__tests__/diag-run.ts --margin-sweep
//   node --import tsx src/scan/engine/__tests__/diag-run.ts --sheets [--frames=F061,...]
//
// The last two read stages.json and need no inference: --margin-sweep sizes the
// capture margin (rectify.CAPTURE_MARGIN) against the labelled cards and splits
// the residual error by SIDE, and --sheets tiles the top strip of the rectified
// crop at several margins so "is the card's header in the capture" is a
// question you answer by looking rather than by trusting a number.
//
// It pushes the SAME frame through the SAME model and the SAME mapping code
// under several preprocessings, then the refiner on top, and reports where the
// corners go. Everything it prints is a distance in FRAME PIXELS on a 480x640
// frame, directly comparable to the 3-8 px the model was measured at and to the
// tolerance integration-frames.test.ts asserts.
//
// `retCrop` is the pipeline as it shipped (inference cropped to the reticle) and
// `engine` is the pipeline as it stands (index.ts INFERENCE_RECT); the ladder
// between them is the same crop grown by a margin, which is what turned "the
// crop is wrong" into "the crop is wrong FOR THIS REASON".

import fs from 'node:fs'
import path from 'node:path'

import type { Quad } from '../contract'
import { createPresenceGate, DEFAULT_ACQUIRE, DEFAULT_HOLD } from '../gate'
import {
  centroid,
  clipPoly,
  defaultReticle,
  insideFraction,
  pointInRect,
  polyArea,
  polyIoU,
  type ImageDataLike,
  type Point,
  type Rect,
} from '../geometry'
import { computeLetterbox, letterboxRGBA, modelPointsToQuad, type LetterboxTransform } from '../preprocess'
import { gradientField, refineQuadChecked } from '../refine'
import {
  applyHomography,
  CAPTURE_MARGIN,
  CARD_RECT_HEIGHT,
  CARD_RECT_WIDTH,
  expandQuad,
  orderQuadForCard,
  rectifyImageData,
  solveHomography,
} from '../rectify'
import { inferenceTransform, REFINE_LONG_SIDE } from '../index'
import { TRACKER_DEFAULTS } from '../tracker'
import {
  copyRGBA,
  drawQuad,
  drawRect,
  engineInput,
  listFlagFrames,
  loadRGBA,
  maxDelta,
  meanDelta,
  ortAvailable,
  probeInput,
  probePointsToQuad,
  quantiles,
  reticlePx,
  runModel,
  SESSION2,
  toTensor,
  workImage,
  writePNG,
  type FlagFrame,
  type RawModelOut,
} from './offline-harness'

const OUT = path.join(SESSION2, 'engine-diag')

const CYAN: [number, number, number] = [0, 220, 255]
const MAGENTA: [number, number, number] = [255, 47, 224]
const GREEN: [number, number, number] = [60, 255, 120]
const YELLOW: [number, number, number] = [255, 210, 40]
const GRAY: [number, number, number] = [150, 150, 150]

/** The shipping variant's key — the one the overlays and the crops describe. */
const SHIPPING = 'engine'

interface Variant {
  key: string
  /** The transform whose crop the refiner should read, or null for "whole
   *  frame" (the probe, which has no crop of its own). */
  transform(f: FlagFrame): LetterboxTransform | null
  input(f: FlagFrame, frame: ImageDataLike): Promise<ImageDataLike>
  back(f: FlagFrame, points: number[]): Quad | null
}

/** The reticle grown about its own centre by `m`, clamped to the frame. m = 1
 *  is the crop that shipped; m large enough is the whole frame. */
function grownReticle(fw: number, fh: number, m: number): Rect {
  const r = defaultReticle(fw, fh)
  const w = Math.min(1, r.w * m)
  const h = Math.min(1, r.h * m)
  const cx = r.x + r.w / 2
  const cy = r.y + r.h / 2
  return { x: Math.max(0, Math.min(1 - w, cx - w / 2)), y: Math.max(0, Math.min(1 - h, cy - h / 2)), w, h }
}

/** A crop-and-letterbox variant. `nearest` selects the engine's own pure
 *  reference resampler instead of the browser-equivalent smooth one, so the
 *  pipeline's sensitivity to the resampler is a measured number. */
function cropVariant(key: string, m: number, nearest = false): Variant {
  const tf = (f: FlagFrame) => computeLetterbox(f.width, f.height, grownReticle(f.width, f.height, m))
  return {
    key,
    transform: tf,
    async input(f, frame) {
      const t = tf(f)
      return nearest ? letterboxRGBA(frame, t) : engineInput(f.png, t)
    },
    back: (f, p) => modelPointsToQuad(tf(f), p),
  }
}

const VARIANTS: Variant[] = [
  {
    // THE BASELINE. The probe's own tensor: whole frame, STRETCHED. This is the
    // preprocessing that measured 85.5% on-card live.
    key: 'probe',
    transform: () => null,
    input: (f) => probeInput(f.png),
    back: (f, p) => probePointsToQuad(p, f.width, f.height),
  },
  // BEFORE: inference cropped to the reticle, both resamplers.
  cropVariant('retCrop', 1),
  cropVariant('retCropNN', 1, true),
  // The ladder that identifies the mechanism: same code, only the margin grows.
  cropVariant('ret115', 1.15),
  cropVariant('ret130', 1.3),
  {
    // AFTER: whatever index.ts INFERENCE_RECT currently says, built the way the
    // browser builds it. Imported, not copied, so this row cannot go stale.
    key: SHIPPING,
    transform: (f) => inferenceTransform(f.width, f.height),
    input: (f) => engineInput(f.png, inferenceTransform(f.width, f.height)),
    back: (f, p) => modelPointsToQuad(inferenceTransform(f.width, f.height), p),
  },
  {
    key: 'engineNN',
    transform: (f) => inferenceTransform(f.width, f.height),
    input: async (f, frame) => letterboxRGBA(frame, inferenceTransform(f.width, f.height)),
    back: (f, p) => modelPointsToQuad(inferenceTransform(f.width, f.height), p),
  },
]

interface Row {
  name: string
  id: string
  liveHasObj: number
  gt: Quad | null
  live: Quad | null
  v: Record<string, { hasObj: number; raw: Quad | null; refined: Quad | null }>
  gtInsideReticle: number | null
  liveInsideReticle: number | null
}

/** The reticle POST-FILTER, exactly as tracker.passesReticle applies it. */
function passesReticle(q: Quad, r: Rect): boolean {
  return pointInRect(centroid(q), r) && insideFraction(q, r) >= TRACKER_DEFAULTS.minInsideFrac
}

async function main(): Promise<void> {
  if (process.argv.includes('--refine-sweep')) return refineSweep()
  if (process.argv.includes('--margin-sweep')) return marginSweep()
  if (process.argv.includes('--sheets')) return sheets()
  if (!ortAvailable()) throw new Error('diag: python onnxruntime sidecar not available')
  const wantOverlays = process.argv.includes('--overlays')
  const frames = listFlagFrames()
  console.log(
    `frames: ${frames.length}  gt: ${frames.filter((f) => f.gt).length}  live claims: ${frames.filter((f) => f.livePoints).length}`,
  )

  const decoded = new Map<string, ImageDataLike>()
  for (const f of frames) decoded.set(f.id, await loadRGBA(f.png, f.width, f.height))

  const rows: Row[] = frames.map((f) => ({
    name: f.name,
    id: f.id,
    liveHasObj: f.liveHasObj,
    gt: f.gt,
    live: f.livePoints ? probePointsToQuad(f.livePoints, f.width, f.height) : null,
    v: {},
    gtInsideReticle: null,
    liveInsideReticle: null,
  }))
  const byName = new Map(rows.map((r) => [r.name, r]))

  // How much of the card was inside the crop that shipped — the first thing to
  // rule in or out, because a corner the model was never shown cannot be found.
  for (const f of frames) {
    const crop = computeLetterbox(f.width, f.height, defaultReticle(f.width, f.height)).crop
    const r = byName.get(f.name)!
    if (f.gt) r.gtInsideReticle = insideFraction(f.gt, crop)
    if (r.live) r.liveInsideReticle = insideFraction(r.live, crop)
  }

  for (const variant of VARIANTS) {
    const inputs: Float32Array[] = []
    for (const f of frames) inputs.push(toTensor(await variant.input(f, decoded.get(f.id)!)))
    const outs: RawModelOut[] = runModel(inputs)
    for (let i = 0; i < frames.length; i++) {
      byName.get(frames[i].name)!.v[variant.key] = {
        hasObj: outs[i].hasObj,
        raw: variant.back(frames[i], outs[i].points),
        refined: null,
      }
    }
    console.log(`ran ${variant.key}: ${outs.length} inferences`)
  }

  // Refinement, exactly as index.ts does it: a gradient field over the pixels
  // the model was shown, at up to REFINE_LONG_SIDE, with the quad mapped into
  // that space and back. Each variant is refined against ITS OWN rect, so the
  // "before" row is the pipeline that actually shipped and not a hybrid.
  for (const f of frames) {
    const r = byName.get(f.name)!
    const cache = new Map<string, { F: ReturnType<typeof gradientField>; sx: number; sy: number; crop: Rect }>()
    for (const variant of VARIANTS) {
      const t = variant.transform(f)
      const crop: Rect = t ? t.crop : { x: 0, y: 0, w: f.width, h: f.height }
      const ck = `${crop.x},${crop.y},${crop.w},${crop.h}`
      if (!cache.has(ck)) {
        const img = await workImage(f.png, crop, REFINE_LONG_SIDE)
        cache.set(ck, { F: gradientField(img), sx: img.width / crop.w, sy: img.height / crop.h, crop })
      }
      const fd = cache.get(ck)!
      const q = r.v[variant.key].raw
      if (!q) continue
      const local = q.map((p) => [(p[0] - fd.crop.x) * fd.sx, (p[1] - fd.crop.y) * fd.sy]) as Quad
      const out = refineQuadChecked(local, fd.F)
      r.v[variant.key].refined = out
        ? (out.map((p) => [p[0] / fd.sx + fd.crop.x, p[1] / fd.sy + fd.crop.y]) as Quad)
        : null
    }
  }

  report(rows)
  fs.mkdirSync(OUT, { recursive: true })
  fs.writeFileSync(path.join(OUT, 'stages.json'), JSON.stringify(rows, null, 1))
  if (wantOverlays) await renderAll(frames, byName, decoded)
  console.log(`\nwrote ${path.join(OUT, 'stages.json')}`)
}

function fmt(n: number): string {
  return Number.isFinite(n) ? n.toFixed(1).padStart(6) : '     -'
}

function report(rows: Row[]): void {
  const gtRows = rows.filter((r) => r.gt)
  const liveRows = rows.filter((r) => r.live)
  const keys = Object.keys(rows[0].v)

  console.log('\n=== CONTAINMENT: how much of the card was inside the reticle crop ===')
  const gtIn = gtRows.map((r) => r.gtInsideReticle!)
  const liveIn = liveRows.map((r) => r.liveInsideReticle!)
  for (const [lbl, xs] of [['GT quads   ', gtIn], ['live claims', liveIn]] as const) {
    const q = quantiles(xs)
    console.log(
      `${lbl} n=${xs.length} mean=${q.mean.toFixed(3)} median=${q.median.toFixed(3)} worst=${Math.min(...xs).toFixed(3)} fully-inside=${xs.filter((x) => x > 0.999).length}/${xs.length}`,
    )
  }

  console.log(`\n=== vs GROUND TRUTH (n=${gtRows.length}), mean corner px ===`)
  console.log('variant     stage    median    p90    max   mean  on-card<=12px  IoU>=0.8')
  for (const k of keys) {
    for (const stage of ['raw', 'refined'] as const) {
      const ds = gtRows.map((r) => (r.v[k][stage] ? meanDelta(r.v[k][stage]!, r.gt!) : NaN)).filter(Number.isFinite)
      const ious = gtRows.map((r) => (r.v[k][stage] ? polyIoU(r.v[k][stage]!, r.gt!) : 0))
      const q = quantiles(ds)
      console.log(
        `${k.padEnd(11)} ${stage.padEnd(8)} ${fmt(q.median)} ${fmt(q.p90)} ${fmt(q.max)} ${fmt(q.mean)}    ${String(ds.filter((d) => d <= 12).length).padStart(2)}/${ds.length}        ${ious.filter((x) => x >= 0.8).length}/${ious.length}`,
      )
    }
  }

  console.log('\n=== SHAPE: predicted linear scale vs GT (an interior lock reads < 1) ===')
  for (const k of keys) {
    const rs = gtRows
      .map((r) => (r.v[k].raw ? Math.sqrt(polyArea(r.v[k].raw!) / polyArea(r.gt!)) : NaN))
      .filter(Number.isFinite)
    const q = quantiles(rs)
    console.log(
      `${k.padEnd(11)} median=${q.median.toFixed(3)} mean=${q.mean.toFixed(3)} min=${Math.min(...rs).toFixed(3)}  shrunk(<0.95): ${rs.filter((x) => x < 0.95).length}/${rs.length}`,
    )
  }

  // GT covers 19 frames; this covers all 87. A trading card is 63:88, and
  // PHASE0-CLOSEOUT §2.3 found the live claim distribution already centred on
  // 0.716 to three decimals — so "is the returned rectangle card-SHAPED" is a
  // label-free way to ask the same question of every frame.
  console.log('\n=== ASPECT (all frames, no labels needed): short/long, card = 0.716 ===')
  for (const k of keys) {
    const asp = rows
      .map((r) => {
        const q = r.v[k].raw
        if (!q) return NaN
        const e = [0, 1, 2, 3].map((i) => Math.hypot(q[(i + 1) % 4][0] - q[i][0], q[(i + 1) % 4][1] - q[i][1]))
        const a = (e[0] + e[2]) / 2
        const b = (e[1] + e[3]) / 2
        return Math.min(a, b) / Math.max(a, b)
      })
      .filter(Number.isFinite)
    const q = quantiles(asp)
    console.log(
      `${k.padEnd(11)} median=${q.median.toFixed(3)}  within 0.06 of card aspect: ${asp.filter((x) => Math.abs(x - 0.7159) <= 0.06).length}/${asp.length}`,
    )
  }

  console.log('\n=== PIPELINE OUTCOME: presence gate then reticle post-filter, all 87 ===')
  for (const k of keys) {
    const gate = createPresenceGate(DEFAULT_ACQUIRE, DEFAULT_HOLD)
    let open = 0
    let shown = 0
    let onCard = 0
    let gtShown = 0
    for (const r of rows) {
      const px = reticlePx(480, 640)
      if (!gate.update(r.v[k].hasObj)) continue
      open++
      const q = r.v[k].refined ?? r.v[k].raw
      if (!q || !passesReticle(q, px)) continue
      shown++
      if (r.gt) {
        gtShown++
        if (meanDelta(q, r.gt) <= 12) onCard++
      }
    }
    console.log(
      `${k.padEnd(11)} gate-open ${String(open).padStart(2)}/87  survives reticle ${String(shown).padStart(2)}/87  of the GT frames shown: on-card ${onCard}/${gtShown}`,
    )
  }

  console.log('\n=== PROBE reproduction vs the LIVE on-device claim (harness noise floor) ===')
  const nf = liveRows.map((r) => (r.v.probe.raw ? meanDelta(r.v.probe.raw, r.live!) : NaN)).filter(Number.isFinite)
  const qn = quantiles(nf)
  console.log(`n=${nf.length} median=${qn.median.toFixed(1)} p90=${qn.p90.toFixed(1)} max=${qn.max.toFixed(1)}`)

  console.log('\n=== REFINER: does it help or hurt? (vs GT) ===')
  for (const k of keys) {
    const pairs = gtRows.map((r) => ({ raw: r.v[k].raw, ref: r.v[k].refined, gt: r.gt! })).filter((p) => p.raw && p.ref)
    const better = pairs.filter((p) => meanDelta(p.ref!, p.gt) < meanDelta(p.raw!, p.gt)).length
    const dRaw = pairs.reduce((a, p) => a + meanDelta(p.raw!, p.gt), 0) / pairs.length
    const dRef = pairs.reduce((a, p) => a + meanDelta(p.ref!, p.gt), 0) / pairs.length
    const qm = quantiles(pairs.map((p) => maxDelta(p.raw!, p.ref!)))
    console.log(
      `${k.padEnd(11)} mean ${dRaw.toFixed(2)} -> ${dRef.toFixed(2)} (${(dRef - dRaw >= 0 ? '+' : '') + (dRef - dRaw).toFixed(2)})  improved ${better}/${pairs.length}  corner move median=${qm.median.toFixed(1)} max=${qm.max.toFixed(1)}`,
    )
  }

  console.log('\n=== PER-FRAME (GT frames), raw mean corner px ===')
  console.log('frame  inside' + keys.map((k) => k.padStart(11)).join(''))
  for (const r of gtRows) {
    console.log(
      `${r.name}  ${r.gtInsideReticle!.toFixed(3)}` +
        keys.map((k) => fmt(r.v[k].raw ? meanDelta(r.v[k].raw!, r.gt!) : NaN).padStart(11)).join(''),
    )
  }
}

/**
 * Is the sub-pixel refiner earning its place, and if not, is it a calibration
 * problem or a premise problem? Replays every stored raw quad through the
 * refiner under a grid of leashes and pass schedules and scores each against
 * ground truth. Reads stages.json, so it needs no inference.
 */
async function refineSweep(): Promise<void> {
  const rows: Row[] = JSON.parse(fs.readFileSync(path.join(OUT, 'stages.json'), 'utf8'))
  const gtFrames = listFlagFrames().filter((f) => f.gt)
  const byName = new Map(rows.map((r) => [r.name, r]))
  const fields = new Map<string, { F: ReturnType<typeof gradientField>; sx: number; sy: number; crop: Rect }>()
  for (const f of gtFrames) {
    const crop = inferenceTransform(f.width, f.height).crop
    const img = await workImage(f.png, crop, REFINE_LONG_SIDE)
    fields.set(f.name, { F: gradientField(img), sx: img.width / crop.w, sy: img.height / crop.h, crop })
  }
  const grid: Array<{ label: string; opts: Record<string, number>; halves: number[] }> = []
  for (const maxMove of [2, 3, 4, 6, 14])
    for (const halves of [[3], [6, 3]])
      for (const minPeak of [90, 180, 300])
        grid.push({ label: `maxMove=${maxMove} half=[${halves}] minPeak=${minPeak}`, opts: { maxMove, minPeak }, halves })

  for (const key of Object.keys(rows[0].v)) {
    console.log(`\n=== refiner sweep on ${key} raw quads (n=${gtFrames.length} GT frames) ===`)
    const base = gtFrames.map((f) => {
      const q = byName.get(f.name)!.v[key].raw
      return q ? meanDelta(q, f.gt!) : NaN
    })
    const fin = base.filter(Number.isFinite)
    const baseMean = fin.reduce((a, b) => a + b, 0) / fin.length
    console.log(`no refinement:                         mean=${baseMean.toFixed(2)}`)
    for (const g of grid) {
      const ds: number[] = []
      let better = 0
      for (const f of gtFrames) {
        const q = byName.get(f.name)!.v[key].raw
        const fd = fields.get(f.name)!
        if (!q) continue
        const local = q.map((p) => [(p[0] - fd.crop.x) * fd.sx, (p[1] - fd.crop.y) * fd.sy]) as Quad
        const out = refineQuadChecked(local, fd.F, g.opts, g.halves)
        const back = out ? (out.map((p) => [p[0] / fd.sx + fd.crop.x, p[1] / fd.sy + fd.crop.y]) as Quad) : null
        const before = meanDelta(q, f.gt!)
        const after = back ? meanDelta(back, f.gt!) : before
        ds.push(after)
        if (after < before) better++
      }
      const mean = ds.reduce((a, b) => a + b, 0) / ds.length
      console.log(
        `${g.label.padEnd(38)} mean=${mean.toFixed(2)}  ${mean < baseMean ? 'BETTER' : 'worse '} improved=${better}/${ds.length}`,
      )
    }
  }
}

// ---------------------------------------------------------------------------
// the capture margin
// ---------------------------------------------------------------------------

/** The margins swept, as a fraction of a card dimension added on EVERY side. */
const MARGINS = [0, 0.02, 0.03, 0.04, 0.05, 0.06, 0.07, 0.1]

/** The NEAR frames of the blind verification (engine-diag/BLIND-VERIFICATION.md)
 *  — the ones whose crop was judged "on the card but a hair off". Thirteen of
 *  them lost the top strip; those are marked. */
const NEAR_FRAMES = [
  'F046', 'F051', 'F061', 'F063', 'F064', 'F065', 'F067', 'F068',
  'F070', 'F071', 'F072', 'F076', 'F078', 'F081', 'F082', 'F083',
]
const NEAR_TOP_LOSS = new Set([
  'F061', 'F063', 'F064', 'F065', 'F067', 'F068', 'F070', 'F071', 'F072', 'F076', 'F078', 'F081', 'F083',
])

/** How much of the LABELLED card survives into the capture taken from `q`.
 *  1.0 means every pixel of the card is in the JPEG; anything less is card the
 *  server can never get back. */
function cardCoverage(capture: Quad, gt: Quad): number {
  const a = polyArea(gt)
  if (!(a > 0)) return 0
  const inter = clipPoly(gt, capture)
  return inter.length >= 3 ? Math.min(1, polyArea(inter) / a) : 0
}

/** The top fifth of the labelled card, in frame px: the strip carrying the
 *  Stage badge, the name and the HP — the thing the blind verification found
 *  missing, and the thing the margin is bought to keep. */
function headerBand(gt: Quad): Quad | null {
  const g = orderQuadForCard(gt)
  if (!g) return null
  const H = solveHomography(
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
    g,
  )
  if (!H) return null
  return [
    applyHomography(H, 0, 0),
    applyHomography(H, 1, 0),
    applyHomography(H, 1, 0.2),
    applyHomography(H, 0, 0.2),
  ]
}

/** The share of the capture that is NOT card — the price of the margin. */
function backgroundFraction(capture: Quad, gt: Quad): number {
  const a = polyArea(capture)
  if (!(a > 0)) return 1
  const inter = clipPoly(gt, capture)
  return 1 - (inter.length >= 3 ? polyArea(inter) / a : 0)
}

/**
 * Where the quad's four sides sit in the CARD's own coordinates: the labelled
 * card is the unit square, so 0 is its top/left edge and 1 its bottom/right.
 *
 * Order-free on purpose. Both quads are ordered independently and a 180 deg
 * disagreement between them would silently swap "top" and "bottom", so each
 * side is read off the SORTED mapped coordinates instead of off corner indices:
 * the top side is the second-smallest v (the two upper corners), and so on.
 */
function sidesInCardSpace(q: Quad, gt: Quad): { top: number; bottom: number; left: number; right: number } | null {
  const g = orderQuadForCard(gt)
  if (!g) return null
  const unit: Quad = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ]
  const H = solveHomography(g, unit)
  if (!H) return null
  const m: Point[] = q.map((p) => applyHomography(H, p[0], p[1]))
  const us = m.map((p) => p[0]).sort((a, b) => a - b)
  const vs = m.map((p) => p[1]).sort((a, b) => a - b)
  return { top: vs[1], bottom: vs[2], left: us[1], right: us[2] }
}

/**
 * The same four sides, read at their MIDPOINTS instead of at their innermost
 * corner. Rotation-neutral: an in-plane tilt of theta pushes one corner of a
 * side in and the other out by the same amount, so the pair's mean is unmoved
 * to first order, while `sidesInCardSpace` (deliberately) charges the tilt to
 * whichever side it eats into. Containment questions want the corner reading;
 * "which side is the model biased on" wants this one.
 */
function sideMidsInCardSpace(
  q: Quad,
  gt: Quad,
): { top: number; bottom: number; left: number; right: number } | null {
  const g = orderQuadForCard(gt)
  if (!g) return null
  const unit: Quad = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ]
  const H = solveHomography(g, unit)
  if (!H) return null
  const m: Point[] = q.map((p) => applyHomography(H, p[0], p[1]))
  const us = m.map((p) => p[0]).sort((a, b) => a - b)
  const vs = m.map((p) => p[1]).sort((a, b) => a - b)
  return { top: (vs[0] + vs[1]) / 2, bottom: (vs[2] + vs[3]) / 2, left: (us[0] + us[1]) / 2, right: (us[2] + us[3]) / 2 }
}

/** Positive = this side of the capture cuts INTO the card, in card dimensions. */
function deficits(q: Quad, gt: Quad): { top: number; bottom: number; left: number; right: number } | null {
  const s = sidesInCardSpace(q, gt)
  if (!s) return null
  return { top: s.top, bottom: 1 - s.bottom, left: s.left, right: 1 - s.right }
}

function stats(xs: readonly number[]): { median: number; mean: number; max: number } {
  const q = quantiles(xs)
  return { median: q.median, mean: q.mean, max: q.max }
}

/**
 * Size the capture margin against the labels, and split the residual by side.
 *
 * Reads stages.json, so it measures the same quads the overlays and the blind
 * verification were judged on. Everything is expressed in CARD DIMENSIONS
 * (fractions of the card's own width/height), because that is the unit the
 * margin is denominated in and it is comparable across a card held near the
 * lens and one on a table.
 */
async function marginSweep(): Promise<void> {
  const rows: Row[] = JSON.parse(fs.readFileSync(path.join(OUT, 'stages.json'), 'utf8'))
  const gtRows = rows.filter((r) => r.gt)
  const shipped = (r: Row): Quad | null => r.v[SHIPPING].refined ?? r.v[SHIPPING].raw
  const withQuad = gtRows.filter((r) => shipped(r))
  console.log(`=== CAPTURE MARGIN, over the ${withQuad.length} hand-labelled frames ===`)
  console.log('The card the server sees. coverage = share of the LABELLED card inside the capture;')
  console.log('background = share of the capture that is not card. Margin is per side, in card dims.\n')
  console.log(
    'margin   full card   >=99% card   header in   header band >=99%   mean cov   mean band   background   frames still short',
  )
  for (const m of MARGINS) {
    const cov = withQuad.map((r) => cardCoverage(expandQuad(shipped(r)!, m), r.gt!))
    const bg = withQuad.map((r) => backgroundFraction(expandQuad(shipped(r)!, m), r.gt!))
    const hdr = withQuad.map((r) => deficits(expandQuad(shipped(r)!, m), r.gt!)?.top ?? 1)
    const band = withQuad.map((r) => {
      const b = headerBand(r.gt!)
      return b ? cardCoverage(expandQuad(shipped(r)!, m), b) : 0
    })
    const full = cov.filter((c) => c >= 0.999).length
    const short = withQuad.filter((_, i) => cov[i] < 0.999).map((r) => r.name)
    console.log(
      `${(m * 100).toFixed(0).padStart(4)}%   ${String(full).padStart(5)}/${cov.length}   ` +
        `${String(cov.filter((c) => c >= 0.99).length).padStart(6)}/${cov.length}   ` +
        `${String(hdr.filter((t) => t <= 0).length).padStart(5)}/${hdr.length}   ` +
        `${String(band.filter((b) => b >= 0.99).length).padStart(12)}/${band.length}   ` +
        `${stats(cov).mean.toFixed(3).padStart(8)}   ${stats(band).mean.toFixed(3).padStart(9)}   ` +
        `${(stats(bg).mean * 100).toFixed(1).padStart(9)}%   ${short.join(' ')}`,
    )
  }

  console.log('\n=== PER-FRAME TOP deficit (+ = the header strip is cut off), card heights ===')
  console.log('frame  near?' + MARGINS.map((m) => `${(m * 100).toFixed(0)}%`.padStart(8)).join(''))
  for (const r of withQuad) {
    const tag = NEAR_TOP_LOSS.has(r.name) ? 'TOPLOSS' : NEAR_FRAMES.includes(r.name) ? '   near' : '       '
    console.log(
      `${r.name} ${tag}` +
        MARGINS.map((m) => {
          const d = deficits(expandQuad(shipped(r)!, m), r.gt!)
          return `${((d?.top ?? 1) * 100).toFixed(1)}%`.padStart(8)
        }).join(''),
    )
  }

  console.log('\n=== PER-FRAME card coverage ===')
  console.log('frame  near?' + MARGINS.map((m) => `${(m * 100).toFixed(0)}%`.padStart(7)).join(''))
  for (const r of withQuad) {
    const tag = NEAR_TOP_LOSS.has(r.name) ? 'TOPLOSS' : NEAR_FRAMES.includes(r.name) ? '   near' : '       '
    console.log(
      `${r.name} ${tag}` +
        MARGINS.map((m) => cardCoverage(expandQuad(shipped(r)!, m), r.gt!).toFixed(3).padStart(7)).join(''),
    )
  }

  // ---- the direction of the error, and who put it there --------------------
  const sides = ['top', 'right', 'bottom', 'left'] as const
  console.log('\n=== WHICH SIDE UNDER-CROPS (margin 0), at the side MIDPOINT. + = cuts in, card dims ===')
  console.log('Rotation-neutral, so this is the model/refiner BIAS and not the tilt of any one frame.')
  for (const [label, pick] of [
    ['model raw   ', (r: Row) => r.v[SHIPPING].raw],
    ['refined     ', (r: Row) => r.v[SHIPPING].refined ?? r.v[SHIPPING].raw],
  ] as const) {
    const ms = withQuad.map((r) => sideMidsInCardSpace(pick(r)!, r.gt!)).filter((d): d is NonNullable<typeof d> => !!d)
    console.log(
      `${label}` +
        sides
          .map((s) => {
            const xs = ms.map((d) => (s === 'top' || s === 'left' ? d[s] : 1 - d[s]))
            return `${s}: median ${(stats(xs).median * 100).toFixed(1).padStart(5)}%  cuts-in ${String(xs.filter((x) => x > 0.005).length).padStart(2)}/${xs.length}   `
          })
          .join(''),
    )
  }
  console.log('\n=== ...and at the innermost CORNER, which is what containment actually turns on ===')
  for (const [label, pick] of [
    ['model raw   ', (r: Row) => r.v[SHIPPING].raw],
    ['refined     ', (r: Row) => r.v[SHIPPING].refined ?? r.v[SHIPPING].raw],
  ] as const) {
    const ds = withQuad.map((r) => deficits(pick(r)!, r.gt!)).filter((d): d is NonNullable<typeof d> => !!d)
    console.log(
      `${label}` +
        sides
          .map((s) => {
            const xs = ds.map((d) => d[s])
            return `${s}: median ${(stats(xs).median * 100).toFixed(1).padStart(5)}%  cuts-in ${String(xs.filter((x) => x > 0.005).length).padStart(2)}/${xs.length}   `
          })
          .join(''),
    )
  }

  console.log('\n=== IS THE REFINER DIRECTIONAL? raw -> refined, + = pulled INWARD (card dims) ===')
  const moves: Record<string, number[]> = { top: [], right: [], bottom: [], left: [] }
  const movePx: Record<string, number[]> = { top: [], right: [], bottom: [], left: [] }
  for (const r of withQuad) {
    const raw = r.v[SHIPPING].raw
    const ref = r.v[SHIPPING].refined
    if (!raw || !ref) continue
    const a = sideMidsInCardSpace(raw, r.gt!)
    const b = sideMidsInCardSpace(ref, r.gt!)
    if (!a || !b) continue
    // Card size in frame px, so the same movement can also be read in the unit
    // the refiner's own leash is written in.
    const g = orderQuadForCard(r.gt!)!
    const wPx = (Math.hypot(g[1][0] - g[0][0], g[1][1] - g[0][1]) + Math.hypot(g[2][0] - g[3][0], g[2][1] - g[3][1])) / 2
    const hPx = (Math.hypot(g[3][0] - g[0][0], g[3][1] - g[0][1]) + Math.hypot(g[2][0] - g[1][0], g[2][1] - g[1][1])) / 2
    const d = { top: b.top - a.top, bottom: a.bottom - b.bottom, left: b.left - a.left, right: a.right - b.right }
    for (const s of sides) moves[s].push(d[s])
    movePx.top.push(d.top * hPx)
    movePx.bottom.push(d.bottom * hPx)
    movePx.left.push(d.left * wPx)
    movePx.right.push(d.right * wPx)
  }
  console.log('side     median      mean       max-inward   pulled in / n   (px on the frame)')
  for (const s of sides) {
    const st = stats(moves[s])
    const px = stats(movePx[s])
    console.log(
      `${s.padEnd(8)} ${(st.median * 100).toFixed(2).padStart(6)}%  ${(st.mean * 100).toFixed(2).padStart(6)}%  ` +
        `${(Math.max(...moves[s]) * 100).toFixed(2).padStart(8)}%   ${String(moves[s].filter((x) => x > 0.001).length).padStart(2)}/${moves[s].length}` +
        `          median ${px.median.toFixed(2).padStart(5)} px, mean ${px.mean.toFixed(2)} px`,
    )
  }
  console.log(`\nshipping CAPTURE_MARGIN = ${(CAPTURE_MARGIN * 100).toFixed(0)}%`)
}

// ---------------------------------------------------------------------------
// pictures — the point of the whole exercise
// ---------------------------------------------------------------------------

/** Nearest-neighbour box scale — good enough for a contact sheet, and it keeps
 *  this file free of another sharp dependency in the hot path. */
function scaleTo(img: ImageDataLike, w: number, h: number): ImageDataLike {
  const out = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    const sy = Math.min(img.height - 1, Math.floor((y * img.height) / h))
    for (let x = 0; x < w; x++) {
      const sx = Math.min(img.width - 1, Math.floor((x * img.width) / w))
      const si = (sy * img.width + sx) * 4
      const di = (y * w + x) * 4
      out[di] = img.data[si]
      out[di + 1] = img.data[si + 1]
      out[di + 2] = img.data[si + 2]
      out[di + 3] = 255
    }
  }
  return { width: w, height: h, data: out }
}

function blit(dst: ImageDataLike, src: ImageDataLike, ox: number, oy: number): void {
  for (let y = 0; y < src.height; y++) {
    const dy = oy + y
    if (dy < 0 || dy >= dst.height) continue
    for (let x = 0; x < src.width; x++) {
      const dx = ox + x
      if (dx < 0 || dx >= dst.width) continue
      const si = (y * src.width + x) * 4
      const di = (dy * dst.width + dx) * 4
      dst.data[di] = src.data[si]
      dst.data[di + 1] = src.data[si + 1]
      dst.data[di + 2] = src.data[si + 2]
      dst.data[di + 3] = 255
    }
  }
}

/**
 * Contact sheets: for each margin, the TOP THIRD of every named frame's capture,
 * tiled. The failure the margin exists to fix is specifically the loss of the
 * card's name/HP/Stage header, so the top third at full width is the picture
 * that answers it — a whole-card thumbnail is too small to read a Stage badge.
 */
async function sheets(): Promise<void> {
  const arg = process.argv.find((a) => a.startsWith('--frames='))
  const names = arg ? arg.slice('--frames='.length).split(',') : NEAR_FRAMES
  const rows: Row[] = JSON.parse(fs.readFileSync(path.join(OUT, 'stages.json'), 'utf8'))
  const byName = new Map(rows.map((r) => [r.name, r]))
  const frames = listFlagFrames().filter((f) => names.includes(f.name))
  const dir = path.join(OUT, 'margin-sheets')
  fs.mkdirSync(dir, { recursive: true })

  // --full tiles the WHOLE capture (all four borders, which is what "the full
  // card is in the JPEG" actually means); the default tiles the top third,
  // where the header is legible enough to read a Stage badge.
  const whole = process.argv.includes('--full')
  const TW = whole ? 200 : 300
  const TH = Math.round((whole ? CARD_RECT_HEIGHT : CARD_RECT_HEIGHT / 3) * (TW / CARD_RECT_WIDTH))
  const COLS = whole ? 8 : 4
  const PAD = 6
  const marginsToSheet = process.argv.includes('--all-margins') ? MARGINS : [0, 0.03, 0.05, 0.07]
  for (const m of marginsToSheet) {
    const tiles: Array<{ name: string; img: ImageDataLike }> = []
    for (const f of frames) {
      const r = byName.get(f.name)
      const q = r ? (r.v[SHIPPING].refined ?? r.v[SHIPPING].raw) : null
      if (!q) continue
      const src = await loadRGBA(f.png, f.width, f.height)
      const out = rectifyImageData(src, expandQuad(q as Quad, m))
      if (!out) continue
      const h = whole ? out.height : Math.round(out.height / 3)
      const strip: ImageDataLike = { width: out.width, height: h, data: out.data.slice(0, out.width * h * 4) }
      tiles.push({ name: f.name, img: scaleTo(strip, TW, TH) })
    }
    const rowsN = Math.ceil(tiles.length / COLS)
    const W = COLS * (TW + PAD) + PAD
    const H = rowsN * (TH + PAD + 10) + PAD
    const sheet: ImageDataLike = { width: W, height: H, data: new Uint8ClampedArray(W * H * 4).fill(30) }
    for (let i = 0; i < W * H; i++) sheet.data[i * 4 + 3] = 255
    tiles.forEach((t, i) => {
      const cx = PAD + (i % COLS) * (TW + PAD)
      const cy = PAD + Math.floor(i / COLS) * (TH + PAD + 10)
      blit(sheet, t.img, cx, cy)
      // A tick mark per frame index, so a tile can be identified without text:
      // the ORDER is the order of `names`, printed below.
      for (let k = 0; k <= i % COLS; k++) drawRect(sheet, { x: cx + k * 5, y: cy + TH + 2, w: 3, h: 5 }, CYAN, 1)
    })
    const file = path.join(dir, `near-${whole ? 'full' : 'top'}-${(m * 100).toFixed(0)}pct.png`)
    await writePNG(sheet, file)
    console.log(`margin ${(m * 100).toFixed(0)}% -> ${file}`)
    console.log(`  reading order (${COLS} per row): ${tiles.map((t) => t.name).join(' ')}`)
  }
}

async function renderAll(
  frames: FlagFrame[],
  byName: Map<string, Row>,
  decoded: Map<string, ImageDataLike>,
): Promise<void> {
  const ovDir = path.join(OUT, 'overlays')
  const crDir = path.join(OUT, 'crops')
  const inDir = path.join(OUT, 'inputs')
  for (const d of [ovDir, crDir, inDir]) fs.mkdirSync(d, { recursive: true })
  for (const f of frames) {
    const r = byName.get(f.name)!
    const src = decoded.get(f.id)!
    const canvas = copyRGBA(src)
    drawRect(canvas, reticlePx(f.width, f.height), GRAY, 1)
    if (r.v.retCrop.raw) drawQuad(canvas, r.v.retCrop.raw, YELLOW, 1)
    if (r.v[SHIPPING].raw) drawQuad(canvas, r.v[SHIPPING].raw, MAGENTA, 1)
    if (r.v[SHIPPING].refined) drawQuad(canvas, r.v[SHIPPING].refined, CYAN, 1)
    if (r.gt) drawQuad(canvas, r.gt, GREEN, 1)
    await writePNG(canvas, path.join(ovDir, `${f.name}_${f.id}.png`))

    // The crop is what the SERVER would receive, so it carries the capture
    // margin: rectifyToJpeg widens the quad by rectify.CAPTURE_MARGIN before it
    // warps. A crop drawn from the bare quad would be a picture of the engine's
    // claim, not of the JPEG, and the blind verification that reads this folder
    // is judging the JPEG.
    const q = r.v[SHIPPING].refined ?? r.v[SHIPPING].raw
    if (q) {
      const out = rectifyImageData(src, expandQuad(q, CAPTURE_MARGIN))
      if (out) await writePNG(out, path.join(crDir, `${f.name}_engine.png`))
    }
    if (r.gt) {
      const out = rectifyImageData(src, r.gt)
      if (out) await writePNG(out, path.join(crDir, `${f.name}_gt.png`))
      // WHAT THE MODEL ACTUALLY SEES, before and after. The single most useful
      // picture here: if the tensor is wrong, no coordinate algebra downstream
      // can be right.
      await writePNG(
        await engineInput(f.png, computeLetterbox(f.width, f.height, defaultReticle(f.width, f.height))),
        path.join(inDir, `${f.name}_retCrop.png`),
      )
      await writePNG(
        await engineInput(f.png, inferenceTransform(f.width, f.height)),
        path.join(inDir, `${f.name}_engine.png`),
      )
    }
  }
  console.log(`\noverlays -> ${ovDir}\ncrops    -> ${crDir}\ninputs   -> ${inDir}`)
  console.log('overlay key: gray=reticle, YELLOW=old reticle-crop path, MAGENTA=engine raw, CYAN=engine refined, GREEN=ground truth')
  console.log(
    `crops: *_engine.png is the CAPTURE (quad + ${(CAPTURE_MARGIN * 100).toFixed(0)}% margin, as rectifyToJpeg sends it); ` +
      '*_gt.png is the exact labelled quad.',
  )
}

void main()
