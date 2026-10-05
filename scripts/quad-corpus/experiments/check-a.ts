#!/usr/bin/env node
/**
 * CHECK A, step 1: how different is the crop made from the DETECTOR's corners
 * from the crop made from the HUMAN's corners?
 *
 *   node --import tsx scripts/quad-corpus/experiments/check-a.ts
 *
 * For every labelled positive in the corpus manifest:
 *   1. re-runs LC050 exactly as eval.ts does (same harness, same sidecar) to get
 *      the UNREFINED quad, refines it with refineQuadChecked exactly as the
 *      engine does, and checks the refined quad against eval-lc050-all.json;
 *   2. measures corner error and the residual warp between the two crops;
 *   3. rectifies with the product's own functions (expandQuad(CAPTURE_MARGIN) ->
 *      rectifyImageData at cardRectSize(), i.e. rectifyToCapture minus the JPEG
 *      encoder) and builds embedInput(crop, {marginFrac: CAPTURE_MARGIN}) — the
 *      tensor queryEmbed.ts feeds the identity model;
 *   4. writes those tensors (one .f32 per variant) plus geometry.json to the work
 *      dir for step 2 (check-a-embed.py).
 *
 * No app code is modified; every stage is imported from the shipping modules.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Quad } from '../../../apps/web/src/scan/engine/contract'
import { createPresenceGate, DEFAULT_ACQUIRE, DEFAULT_HOLD } from '../../../apps/web/src/scan/engine/gate'
import { CANONICAL_SIZE, modelPointsToCanonicalQuad } from '../../../apps/web/src/scan/engine/frame'
import { gradientField, refineQuadChecked } from '../../../apps/web/src/scan/engine/refine'
import {
  applyHomography,
  CAPTURE_MARGIN,
  cardRectSize,
  expandQuad,
  orderQuadForCard,
  rectifyImageData,
  solveHomography,
  type Mat3,
} from '../../../apps/web/src/scan/engine/rectify'
import type { ImageDataLike } from '../../../apps/web/src/scan/engine/geometry'
import {
  cornerDeltas,
  loadRGBA,
  probeInput,
  PY,
  sharp,
  toTensor,
  type RawModelOut,
} from '../../../apps/web/src/scan/engine/__tests__/offline-harness'
import { embedInput, EMBED_SIZE } from '../../../packages/matching/src/input-spec'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..', '..')
const SIDECAR = path.join(REPO, 'apps/web/src/scan/engine/__tests__/ort_sidecar.py')
const MODEL = path.join(REPO, 'apps/web/public/scan-assets/lc050.onnx')
const CORPUS = process.env.QUAD_CORPUS_DIR ?? path.join(os.homedir(), 'deckpal-data', 'quad-corpus')
const WORK = path.join(CORPUS, 'check-a-work')

const OUT = cardRectSize() // 480 x 670, what capture() asks for on a Pokémon card
const TENSOR_LEN = 3 * EMBED_SIZE * EMBED_SIZE

/** Variants embedded per row. H = human quad, D = detector quad. */
const VARIANTS = ['H', 'DR', 'DU', 'HJ', 'DRJ', 'HLR', 'HMR', 'P1', 'P2', 'P4', 'P8'] as const
type Variant = (typeof VARIANTS)[number]
const PERTURB: Record<string, number> = { P1: 0.01, P2: 0.02, P4: 0.04, P8: 0.08 }

// ---------------------------------------------------------------------------

function runLC050(inputs: readonly Float32Array[]): RawModelOut[] {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-a-'))
  const binp = path.join(dir, 'in.bin')
  const outp = path.join(dir, 'out.json')
  try {
    const per = inputs[0].length
    const all = new Float32Array(per * inputs.length)
    inputs.forEach((v, i) => all.set(v, i * per))
    fs.writeFileSync(binp, Buffer.from(all.buffer, all.byteOffset, all.byteLength))
    execFileSync(PY, [SIDECAR, MODEL, binp, String(inputs.length), outp], { stdio: ['ignore', 'pipe', 'pipe'] })
    return JSON.parse(fs.readFileSync(outp, 'utf8'))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

/** Deterministic PRNG (mulberry32) so the perturbation set is reproducible. */
function prng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1])
const diagOf = (q: Quad) => (dist(q[0], q[2]) + dist(q[1], q[3])) / 2
function bboxLong(q: Quad): number {
  const xs = q.map((p) => p[0])
  const ys = q.map((p) => p[1])
  return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))
}

/** Which cyclic rotation r best aligns b to a (b[(i+r)%4] ~ a[i]). 0 = the
 *  product's two orderings agree on which corner is the card's top-left. */
function bestRotation(a: Quad, b: Quad): number {
  let best = 0
  let bestS = Infinity
  for (let r = 0; r < 4; r++) {
    let s = 0
    for (let i = 0; i < 4; i++) s += dist(a[i], b[(i + r) % 4])
    if (s < bestS) {
      bestS = s
      best = r
    }
  }
  return best
}

/**
 * The residual warp between two crops, exactly as the product makes them.
 * Grid points over the CARD region of the human crop (the margin stripped) are
 * mapped crop -> source through the human crop's homography, then source ->
 * crop through the detector crop's. A perfect detector gives zero everywhere.
 * Returned in % of the card's diagonal IN THE CROP (436 x 609 px -> 749 px).
 */
function residualWarp(gt: Quad, det: Quad): { mean: number; max: number; corners: number[] } | null {
  const oh = orderQuadForCard(expandQuad(gt, CAPTURE_MARGIN))
  const od = orderQuadForCard(expandQuad(det, CAPTURE_MARGIN))
  if (!oh || !od) return null
  const dst: Quad = [
    [0, 0],
    [OUT.width, 0],
    [OUT.width, OUT.height],
    [0, OUT.height],
  ]
  const Gh = solveHomography(dst, oh) // crop -> source (what rectifyImageData solves)
  const GdInv = solveHomography(od, dst) // source -> detector crop
  if (!Gh || !GdInv) return null
  const k = CAPTURE_MARGIN / (1 + 2 * CAPTURE_MARGIN)
  const x0 = OUT.width * k
  const y0 = OUT.height * k
  const cw = OUT.width - 2 * x0
  const ch = OUT.height - 2 * y0
  const cardDiag = Math.hypot(cw, ch)
  const N = 11
  let sum = 0
  let max = 0
  const corners: number[] = []
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const u = x0 + (cw * i) / (N - 1)
      const v = y0 + (ch * j) / (N - 1)
      const [sx, sy] = applyHomography(Gh as Mat3, u, v)
      const [u2, v2] = applyHomography(GdInv as Mat3, sx, sy)
      const d = (Math.hypot(u2 - u, v2 - v) / cardDiag) * 100
      sum += d
      if (d > max) max = d
      if ((i === 0 || i === N - 1) && (j === 0 || j === N - 1)) corners.push(d)
    }
  return { mean: sum / (N * N), max, corners }
}

async function jpegRoundTrip(img: ImageDataLike): Promise<ImageDataLike> {
  const S = await sharp()
  const jpg = await S(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.length), {
    raw: { width: img.width, height: img.height, channels: 4 },
  })
    .removeAlpha()
    // CAPTURE_QUALITY 0.85; sharp's libjpeg stands in for the browser encoder.
    .jpeg({ quality: 85 })
    .toBuffer()
  const raw = await S(jpg).ensureAlpha().raw().toBuffer()
  return { width: img.width, height: img.height, data: new Uint8ClampedArray(raw.buffer, raw.byteOffset, raw.length) }
}

async function lowResSource(file: string, side: number): Promise<ImageDataLike> {
  const S = await sharp()
  const buf = await S(file).resize({ width: side, height: side, fit: 'fill', kernel: 'lanczos3' }).ensureAlpha().raw().toBuffer()
  return { width: side, height: side, data: new Uint8ClampedArray(buf.buffer, buf.byteOffset, buf.length) }
}

async function savePNG(img: ImageDataLike, file: string): Promise<void> {
  const S = await sharp()
  await S(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.length), {
    raw: { width: img.width, height: img.height, channels: 4 },
  })
    .png()
    .toFile(file)
}

// ---------------------------------------------------------------------------

interface ManifestRow {
  id: number
  png: string
  verdict: string
  source: string
  corners: [number, number][] | null
  topLeftIndex: number | null
  fill: number | null
  seededFrom: string
  mirrorPadded: boolean
}

async function main(): Promise<void> {
  const manifest: ManifestRow[] = fs
    .readFileSync(path.join(CORPUS, 'manifest.jsonl'), 'utf8')
    .trim()
    .split(/\r?\n/)
    .map((l) => JSON.parse(l))
  const evalJson = JSON.parse(fs.readFileSync(path.join(CORPUS, 'eval-lc050-all.json'), 'utf8'))
  const evalRows = new Map<string, any>(evalJson.rows.map((r: any) => [String(r.id), r]))
  const pos = manifest.filter((m) => m.verdict !== 'negative' && m.corners)
  console.log(`${pos.length} labelled positives; output crop ${OUT.width}x${OUT.height}, margin ${CAPTURE_MARGIN}`)

  fs.mkdirSync(path.join(WORK, 'crops'), { recursive: true })

  // 1. LC050, the same tensor eval.ts builds.
  const tensors: Float32Array[] = []
  for (const m of pos) tensors.push(toTensor(await probeInput(path.join(CORPUS, m.png))))
  const outs = runLC050(tensors)

  const writers = Object.fromEntries(
    VARIANTS.map((v) => [v, fs.openSync(path.join(WORK, `tensors-${v}.f32`), 'w')]),
  ) as Record<Variant, number>
  const rows: any[] = []
  let maxRefineDiff = 0

  for (let i = 0; i < pos.length; i++) {
    const m = pos[i]
    const id = String(m.id)
    const er = evalRows.get(id)
    if (!er) throw new Error(`row ${id} missing from eval-lc050-all.json`)
    const file = path.join(CORPUS, m.png)
    const src = await loadRGBA(file, CANONICAL_SIZE, CANONICAL_SIZE)
    const gt = m.corners!.map(([x, y]) => [x * CANONICAL_SIZE, y * CANONICAL_SIZE]) as Quad
    const o = outs[i]
    const raw = modelPointsToCanonicalQuad(o.points)
    if (!raw) throw new Error(`row ${id}: model emitted no finite quad`)
    const refinedOrNull = refineQuadChecked(raw, gradientField(src))
    const refined = refinedOrNull ?? raw
    const gateOpen = createPresenceGate(DEFAULT_ACQUIRE, DEFAULT_HOLD).update(o.hasObj)
    // Cross-check against the committed eval: same quad, same gate.
    const evq: Quad = er.ungatedQuad
    const diff = Math.max(...refined.map((p, k) => dist(p, evq[k])))
    maxRefineDiff = Math.max(maxRefineDiff, diff)

    const diag = diagOf(gt)
    const geo = (q: Quad) => {
      const d = cornerDeltas(gt, q)
      const rw = residualWarp(gt, q)
      const oh = orderQuadForCard(gt)!
      const oq = orderQuadForCard(q)!
      return {
        cornerErrPx: d,
        meanErrPct: (d.reduce((a, b) => a + b, 0) / 4 / diag) * 100,
        maxErrPct: (Math.max(...d) / diag) * 100,
        residualMeanPct: rw?.mean ?? null,
        residualMaxPct: rw?.max ?? null,
        residualCornersPct: rw?.corners ?? null,
        rotation: bestRotation(oh, oq),
      }
    }

    // Does the PRODUCT's ordering of the HUMAN quad put the human-labelled
    // top-left first? If not, even a perfect detector yields a rotated crop.
    const ordGt = orderQuadForCard(gt)!
    const humanTL = gt[m.topLeftIndex ?? 0]
    const humanOrientOk = dist(ordGt[0], humanTL) < 1e-6

    // 2. crops, the product's way.
    const crop = (img: ImageDataLike, q: Quad) => {
      const c = rectifyImageData(img, expandQuad(q, CAPTURE_MARGIN), OUT.width, OUT.height)
      if (!c) throw new Error(`row ${id}: quad could not be rectified`)
      return c as ImageDataLike
    }
    const cH = crop(src, gt)
    const cDR = crop(src, refined)
    const cDU = crop(src, raw)
    const cHJ = await jpegRoundTrip(cH)
    const cDRJ = await jpegRoundTrip(cDR)
    // Resolution sensitivity: the same human quad on a 208 px and a 312 px copy.
    const half = await lowResSource(file, CANONICAL_SIZE / 2)
    const cHLR = crop(half, gt.map(([x, y]) => [x / 2, y / 2]) as Quad)
    const threeQ = await lowResSource(file, (CANONICAL_SIZE * 3) / 4)
    const cHMR = crop(threeQ, gt.map(([x, y]) => [x * 0.75, y * 0.75]) as Quad)
    const rnd = prng(Number(id.slice(-9)))
    const perturbed: Record<string, ImageDataLike> = {}
    const perturbGeo: Record<string, any> = {}
    for (const [k, frac] of Object.entries(PERTURB)) {
      const q = gt.map(([x, y]) => {
        const a = rnd() * Math.PI * 2
        return [x + Math.cos(a) * frac * diag, y + Math.sin(a) * frac * diag]
      }) as Quad
      perturbed[k] = crop(src, q)
      const g = geo(q)
      perturbGeo[k] = { meanErrPct: g.meanErrPct, maxErrPct: g.maxErrPct, residualMeanPct: g.residualMeanPct, residualMaxPct: g.residualMaxPct }
    }
    const imgs: Record<Variant, ImageDataLike> = {
      H: cH, DR: cDR, DU: cDU, HJ: cHJ, DRJ: cDRJ, HLR: cHLR, HMR: cHMR,
      P1: perturbed.P1, P2: perturbed.P2, P4: perturbed.P4, P8: perturbed.P8,
    }
    for (const v of VARIANTS) {
      const t = embedInput(imgs[v], { marginFrac: CAPTURE_MARGIN })
      if (t.length !== TENSOR_LEN) throw new Error('tensor length')
      fs.writeSync(writers[v], Buffer.from(t.buffer, t.byteOffset, t.byteLength))
    }
    await savePNG(cH, path.join(WORK, 'crops', `${id}-H.png`))
    await savePNG(cDR, path.join(WORK, 'crops', `${id}-DR.png`))
    await savePNG(cDU, path.join(WORK, 'crops', `${id}-DU.png`))

    rows.push({
      idx: i,
      id,
      face: m.verdict,
      source: m.source,
      seededFrom: m.seededFrom,
      mirrorPadded: m.mirrorPadded,
      fill: m.fill,
      heightFrac: bboxLong(gt) / CANONICAL_SIZE,
      diagPx: diag,
      hasObj: o.hasObj,
      gateOpen,
      evalEmitted: er.emitted,
      evalCls: er.cls,
      ungatedCls: er.ungatedScore?.cls ?? null,
      refinerAccepted: !!refinedOrNull,
      humanOrientOk,
      gt,
      refined,
      raw,
      geoRefined: geo(refined),
      geoRaw: geo(raw),
      perturbGeo,
    })
    if ((i + 1) % 10 === 0) process.stdout.write(`  ${i + 1}/${pos.length}\n`)
  }
  for (const v of VARIANTS) fs.closeSync(writers[v])

  fs.writeFileSync(
    path.join(WORK, 'geometry.json'),
    JSON.stringify(
      {
        meta: {
          generatedAt: new Date().toISOString(),
          crop: OUT,
          captureMargin: CAPTURE_MARGIN,
          embedSize: EMBED_SIZE,
          variants: VARIANTS,
          perturb: PERTURB,
          maxRefinedVsEvalPx: maxRefineDiff,
          model: MODEL,
        },
        rows,
      },
      null,
      1,
    ),
  )
  console.log(`refined quad vs eval-lc050-all.json ungatedQuad: max corner diff ${maxRefineDiff.toExponential(2)} px`)
  console.log(`wrote ${path.join(WORK, 'geometry.json')} and ${VARIANTS.length} tensor files`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
