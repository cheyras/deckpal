#!/usr/bin/env node
/**
 * Score a corner model over a frozen corpus split, through the SHIPPING engine
 * path, against the Phase 1 gates.
 *
 *   node --import tsx scripts/quad-corpus/eval.ts                      # LC050, corpus test split
 *   node --import tsx scripts/quad-corpus/eval.ts --split val
 *   node --import tsx scripts/quad-corpus/eval.ts --model runs/ft3.onnx  # a fine-tune, same split
 *   node --import tsx scripts/quad-corpus/eval.ts --session2           # phase-0b session 2 frames
 *   node --import tsx scripts/quad-corpus/eval.ts --session2 --pipeline v2   # harness cross-check
 *
 * Options: --corpus <dir>   default QUAD_CORPUS_DIR, else ~/deckpal-data/quad-corpus
 *          --split test|val|train|all   (default test; `all` needs no split.json)
 *          --model <onnx>   default apps/web/public/scan-assets/lc050.onnx
 *          --acquire <p>    presence threshold (default gate.ts DEFAULT_ACQUIRE)
 *          --out <dir>      default: the corpus dir (session2: <SESSION2>/quad-eval)
 *          --limit <n>      first n rows only (smoke runs)
 *
 * Writes eval-<model>-<split>.json (every row + every aggregate) and
 * eval-<model>-<split>.md (the summary) to the output dir.
 *
 * WHAT "THE SHIPPING PATH" MEANS HERE. engine/index.ts tick(), single frame —
 * the same reduction labeler/detectSeed.ts makes, for the same reasons:
 *
 *     canonical square (the labeler's 416 PNG IS one)
 *       -> plain resize to MODEL_SIZE                (index.ts drawModelInput)
 *       -> preprocess.rgbaToBGRPlanar                 verbatim
 *       -> the model, via ort_sidecar.py              (python onnxruntime: the
 *                                                     harness's one substitution)
 *       -> gate.createPresenceGate, cold              verbatim: opens at acquire
 *       -> frame.modelPointsToCanonicalQuad           verbatim
 *       -> refine.refineQuadChecked(gradientField())  verbatim, ?? raw on failure
 *
 * Left out, as detectSeed.ts leaves them out: the rAF cadence, the gate's
 * hysteresis (a still frame has no previous tick, and a cold gate opens at
 * exactly `acquire`), the tracker and the lock policy (persistence across ticks;
 * none of them changes the quad the detector proposed, which is what
 * capture() warps). Pixels come from sharp (lanczos3) where the browser uses a
 * smoothed drawImage — offline-harness.ts's documented substitution, measured
 * by the presence-parity table below wherever the label recorded the browser's
 * own hasObj.
 *
 * A MODEL TO SCORE must take `img` 1x3x256x256 BGR/255 and return `points`
 * (8 normalized floats) and `has_obj`, exactly as LC050 does — ort_sidecar.py
 * reads those two output names.
 */
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Quad } from '../../apps/web/src/scan/engine/contract'
import { createPresenceGate, DEFAULT_ACQUIRE, DEFAULT_HOLD } from '../../apps/web/src/scan/engine/gate'
import type { ImageDataLike, Rect } from '../../apps/web/src/scan/engine/geometry'
import {
  CANONICAL_SIZE,
  modelPointsToCanonicalQuad,
  squareCrop,
  streamQuadToCanonical,
  type SquareCrop,
} from '../../apps/web/src/scan/engine/frame'
import { inferenceTransform, REFINE_LONG_SIDE } from '../../apps/web/src/scan/engine/index'
import { MODEL_SIZE, modelPointsToQuad } from '../../apps/web/src/scan/engine/preprocess'
import { gradientField, refineQuadChecked } from '../../apps/web/src/scan/engine/refine'
import {
  engineInput,
  listFlagFrames,
  loadRGBA,
  probeInput,
  PY,
  SESSION2,
  toTensor,
  workImage,
  type RawModelOut,
} from '../../apps/web/src/scan/engine/__tests__/offline-harness'
import { arg, corpusDir, describe, flag, readManifest, readSplit, type ManifestRow } from './corpus'
import {
  aggregate,
  FILL_ORDER,
  fillBucket,
  gates,
  quantile,
  scoreQuad,
  THRESHOLDS,
  TIGHT_FILL,
  type GroupStats,
  type Rate,
  type RowResult,
} from './metrics'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..')
const SIDECAR = path.join(REPO, 'apps/web/src/scan/engine/__tests__/ort_sidecar.py')
const DEFAULT_MODEL = path.join(REPO, 'apps/web/public/scan-assets/lc050.onnx')
const BLIND = path.join(SESSION2, 'engine-diag', 'BLIND-VERIFICATION.md')
/** Tensors per sidecar call: 128 x 786 KB, well inside memory, few session boots. */
const CHUNK = 128

// ---------------------------------------------------------------------------
// the model (offline-harness.runModel, with the model path as a parameter so a
// fine-tune is scored by the identical runner)
// ---------------------------------------------------------------------------

function runModelAt(model: string, inputs: readonly Float32Array[]): RawModelOut[] {
  if (!inputs.length) return []
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quad-eval-'))
  const binp = path.join(dir, 'in.bin')
  const outp = path.join(dir, 'out.json')
  try {
    const per = inputs[0].length
    const all = new Float32Array(per * inputs.length)
    inputs.forEach((v, i) => all.set(v, i * per))
    fs.writeFileSync(binp, Buffer.from(all.buffer, all.byteOffset, all.byteLength))
    execFileSync(PY, [SIDECAR, model, binp, String(inputs.length), outp], {
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
    })
    return JSON.parse(fs.readFileSync(outp, 'utf8'))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------------------
// inputs: one shape for both the harvested corpus and session 2
// ---------------------------------------------------------------------------

interface Detection {
  /** Model quad, canonical px, before refinement. */
  raw: Quad | null
  /** After refineQuadChecked; null when it refused. */
  refined: Quad | null
}

interface EvalInput {
  id: string
  verdict: string
  positive: boolean
  face: string
  reason: string | null
  source: string
  day: string
  fill: number | null
  /** Label in canonical px; null for negatives and unlabelled positives. */
  gt: Quad | null
  labelHasObj: number | null
  /** The model input this pipeline builds. */
  tensor(): Promise<Float32Array>
  /** Map the model's output to a canonical quad and refine it. */
  finish(out: RawModelOut): Promise<Detection>
}

/** The v3 refine step: the working image IS the canonical frame. */
function refineCanonical(raw: Quad | null, work: ImageDataLike): Detection {
  if (!raw) return { raw: null, refined: null }
  return { raw, refined: refineQuadChecked(raw, gradientField(work)) }
}

/** The PNG's side from its IHDR, as harvest.mjs `pngSize` reads it. */
async function pngSide(file: string): Promise<number> {
  const fd = fs.openSync(file, 'r')
  const buf = Buffer.alloc(24)
  try {
    fs.readSync(fd, buf, 0, 24, 0)
  } finally {
    fs.closeSync(fd)
  }
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error(`${file} is not a PNG`)
  const w = buf.readUInt32BE(16)
  const h = buf.readUInt32BE(20)
  if (w !== h) throw new Error(`${file} is ${w}x${h}, not a canonical square`)
  return w
}

/** The working image: the canonical square at CANONICAL_SIZE. */
async function canonicalWork(file: string, side: number): Promise<ImageDataLike> {
  if (side === CANONICAL_SIZE) return loadRGBA(file, side, side)
  return workImage(file, { x: 0, y: 0, w: side, h: side }, CANONICAL_SIZE)
}

function corpusInputs(dir: string, rows: ManifestRow[]): EvalInput[] {
  return rows.map((m) => {
    const file = path.join(dir, m.png)
    const positive = m.verdict !== 'negative'
    let side = 0
    const sideOf = async () => (side ||= await pngSide(file))
    return {
      id: String(m.id),
      verdict: m.verdict,
      positive,
      face: positive ? m.verdict : 'negative',
      reason: positive ? null : m.reason,
      source: m.source ?? 'missing',
      day: m.day,
      fill: m.fill,
      gt: positive && m.corners ? (m.corners.map(([x, y]) => [x * CANONICAL_SIZE, y * CANONICAL_SIZE]) as Quad) : null,
      labelHasObj: m.hasObj ?? null,
      // The square resized to the model's input — exactly what the labeler's
      // seed and the engine's drawModelInput do to a canonical square.
      tensor: async () => {
        await sideOf()
        return toTensor(await probeInput(file))
      },
      finish: async (out) => refineCanonical(modelPointsToCanonicalQuad(out.points), await canonicalWork(file, await sideOf())),
    }
  })
}

/** BLIND-VERIFICATION.md's independent `card?` column, parsed the way
 *  clutter-lock.ts parses it. */
function blindCardLabels(): Map<string, boolean> {
  const out = new Map<string, boolean>()
  if (!fs.existsSync(BLIND)) return out
  for (const line of fs.readFileSync(BLIND, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\|\s*(F\d{3})\s*\|[^|]*\|\s*(yes|no)\s*\|/)
    if (m) out.set(m[1], m[2] === 'yes')
  }
  return out
}

/**
 * Phase 0b session 2 as an eval set: the 19 hand-labelled frames as scored
 * positives, the other card frames (BLIND-VERIFICATION `card? = yes`) as
 * unlabelled positives that count toward the miss rate only, and the no-card
 * frames as distractor negatives. These 87 frames are OWNER-FLAGGED — selected
 * because something looked interesting — and the 19 labels deliberately include
 * every wrong/near/interior case, so the rates are biased toward failure.
 *
 * v3 replays each 480x640 frame through the engine's own centre-square crop
 * (as clutter-lock.ts does); v2 is the letterboxed full frame that
 * integration-frames.test.ts scores, kept so this evaluator can be checked
 * against that test's published numbers.
 */
function session2Inputs(pipeline: 'v2' | 'v3'): EvalInput[] {
  const card = blindCardLabels()
  const out: EvalInput[] = []
  for (const f of listFlagFrames()) {
    const isCard = card.get(f.name)
    if (isCard === undefined && !f.gt) continue
    const positive = isCard !== false || !!f.gt
    const crop: SquareCrop = squareCrop(f.width, f.height)
    const cropRect: Rect = { x: crop.x, y: crop.y, w: crop.size, h: crop.size }
    const gt = f.gt ? streamQuadToCanonical(f.gt, crop) : null
    const t = inferenceTransform(f.width, f.height)
    const base = {
      id: `${f.name}:${f.id}`,
      verdict: positive ? 'face-unknown(session2)' : 'negative',
      positive,
      face: positive ? 'face-unknown(session2)' : 'negative',
      reason: positive ? null : 'no_card',
      source: 'camera',
      day: new Date(Number(f.id)).toISOString().slice(0, 10),
      fill: gt ? polyFill(gt) : null,
      gt,
      labelHasObj: null,
    }
    if (pipeline === 'v3') {
      out.push({
        ...base,
        tensor: async () => toTensor(await workImage(f.png, cropRect, MODEL_SIZE)),
        finish: async (o) =>
          refineCanonical(modelPointsToCanonicalQuad(o.points), await workImage(f.png, cropRect, CANONICAL_SIZE)),
      })
    } else {
      out.push({
        ...base,
        tensor: async () => toTensor(await engineInput(f.png, t)),
        finish: async (o) => {
          // integration-frames.test.ts compute(), then into canonical px.
          const raw = modelPointsToQuad(t, o.points)
          if (!raw) return { raw: null, refined: null }
          const img = await workImage(f.png, t.crop, REFINE_LONG_SIDE)
          const sx = img.width / t.crop.w
          const sy = img.height / t.crop.h
          const local = raw.map((p) => [(p[0] - t.crop.x) * sx, (p[1] - t.crop.y) * sy]) as Quad
          const r = refineQuadChecked(local, gradientField(img))
          const refined = r ? (r.map((p) => [p[0] / sx + t.crop.x, p[1] / sy + t.crop.y]) as Quad) : null
          return {
            raw: streamQuadToCanonical(raw, crop),
            refined: refined ? streamQuadToCanonical(refined, crop) : null,
          }
        },
      })
    }
  }
  return out
}

function polyFill(q: Quad): number {
  let a = 0
  for (let i = 0; i < 4; i++) a += q[i][0] * q[(i + 1) % 4][1] - q[(i + 1) % 4][0] * q[i][1]
  return Math.abs(a) / 2 / (CANONICAL_SIZE * CANONICAL_SIZE)
}

// ---------------------------------------------------------------------------
// run
// ---------------------------------------------------------------------------

async function evaluate(inputs: EvalInput[], model: string, acquire: number): Promise<RowResult[]> {
  const results: RowResult[] = []
  for (let c = 0; c < inputs.length; c += CHUNK) {
    const chunk = inputs.slice(c, c + CHUNK)
    const tensors: Float32Array[] = []
    for (const inp of chunk) tensors.push(await inp.tensor())
    const outs = runModelAt(model, tensors)
    for (let i = 0; i < chunk.length; i++) {
      const inp = chunk[i]
      const o = outs[i]
      const det = await inp.finish(o)
      // A cold gate per frame: open iff hasObj >= acquire, gate.ts's own rule.
      const open = createPresenceGate(acquire, DEFAULT_HOLD).update(o.hasObj)
      const shipped = det.refined ?? det.raw
      const emitted = open && !!shipped
      const ungatedScore = inp.gt && shipped ? scoreQuad(shipped, inp.gt) : null
      const score = emitted ? ungatedScore : null
      let cls: string
      if (!inp.positive) cls = emitted ? 'false-quad' : 'silent'
      else if (!emitted) cls = 'miss'
      else cls = score ? score.cls : 'emitted(unlabelled)'
      results.push({
        id: inp.id,
        verdict: inp.verdict,
        positive: inp.positive,
        face: inp.face,
        reason: inp.reason,
        source: inp.source,
        day: inp.day,
        fill: inp.fill,
        fillBucket: fillBucket(inp.fill),
        hasObj: o.hasObj,
        emitted,
        quad: emitted ? shipped : null,
        ungatedQuad: shipped,
        refined: !!det.refined,
        gt: inp.gt,
        score,
        ungatedScore,
        cls,
        labelHasObj: inp.labelHasObj,
      })
    }
    process.stdout.write(`  ${Math.min(c + CHUNK, inputs.length)}/${inputs.length}\n`)
  }
  return results
}

function groupBy(rows: RowResult[], key: (r: RowResult) => string | null, order?: string[]): Record<string, GroupStats> {
  const g = new Map<string, RowResult[]>()
  for (const r of rows) {
    const k = key(r)
    if (k == null) continue
    const a = g.get(k) ?? []
    a.push(r)
    g.set(k, a)
  }
  const keys = [...g.keys()].sort((a, b) =>
    order ? order.indexOf(a) - order.indexOf(b) || (a < b ? -1 : 1) : a < b ? -1 : 1,
  )
  return Object.fromEntries(keys.map((k) => [k, aggregate(g.get(k)!)]))
}

// ---------------------------------------------------------------------------
// markdown
// ---------------------------------------------------------------------------

const pct = (r: Rate) => (r.n ? `${(r.rate * 100).toFixed(1)}% (${r.k}/${r.n})` : '—')
const ci = (r: Rate) => (r.n ? `${(r.ci[0] * 100).toFixed(0)}–${(r.ci[1] * 100).toFixed(0)}%` : '—')
const num = (x: number, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : '—')

function groupTable(title: string, groups: Record<string, GroupStats>): string[] {
  const out = [
    `### ${title}`,
    '',
    '| group | rows | pos (scored) | on-card | interior lock | miss | median err | median IoU | median area | on-card ungated | neg | false quad |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|',
  ]
  for (const [k, s] of Object.entries(groups))
    out.push(
      `| ${k} | ${s.rows} | ${s.positives} (${s.scored}) | ${pct(s.onCard)} | ${pct(s.interiorLock)} | ${pct(s.miss)} | ${num(s.meanErr.median)} | ${num(s.iou.median, 3)} | ${num(s.areaRatio.median, 3)} | ${pct(s.onCardUngated)} | ${s.negatives} | ${pct(s.falseQuad)} |`,
    )
  out.push('')
  return out
}

function markdown(meta: Record<string, unknown>, overall: GroupStats, tight: GroupStats, groups: Record<string, Record<string, GroupStats>>, rows: RowResult[], extra: string[]): string {
  const g = gates(overall)
  const L: string[] = []
  L.push(`# Quad detector eval: ${meta.model} on ${meta.split}`, '')
  L.push(`Generated ${meta.generatedAt}. Model \`${meta.modelPath}\` (sha256 ${String(meta.modelSha256).slice(0, 12)}). Pipeline ${meta.pipeline}; presence gate cold at acquire ${meta.acquire}.`)
  L.push(`Data: ${meta.data}.`, '')
  L.push(
    `Thresholds, canonical px (416 square): on-card = best-of-8 mean corner error <= **${THRESHOLDS.t14.toFixed(2)}** (R5's 14 px on its 360x480 frames, x416/360); secondary ${THRESHOLDS.t20.toFixed(2)} (R5's 20 px) and ${THRESHOLDS.t14p0b.toFixed(2)} (phase 0b's 14 px at 480x640). Interior lock = R5 §5 taxonomy (art-interior + partial-inset). See README.md.`,
    '',
  )
  L.push('## Gates (RECOMMENDATION §3 Phase 1)', '', '| gate | target | value | 95% CI | verdict |', '|---|---|---|---|---|')
  for (const x of g) L.push(`| ${x.name} | ${x.target} | ${pct(x.value)} | ${ci(x.value)} | ${x.pass == null ? 'n/a (no rows)' : x.pass ? 'PASS' : '**FAIL**'} |`)
  L.push('')
  const block = (name: string, s: GroupStats) => !s.rows ? [`## ${name}`, '', 'No rows in this group.', ''] : [
    `## ${name}`,
    '',
    '| metric | value |',
    '|---|---|',
    `| rows / positives (labelled) / negatives | ${s.rows} / ${s.positives} (${s.scored}) / ${s.negatives} |`,
    `| on-card @${THRESHOLDS.t14.toFixed(1)} | ${pct(s.onCard)} |`,
    `| all four corners within ${THRESHOLDS.t14.toFixed(1)} | ${pct(s.allCornersWithin)} |`,
    `| on-card @${THRESHOLDS.t20.toFixed(1)} (R5 20 px) | ${pct(s.onCard20)} |`,
    `| on-card @${THRESHOLDS.t14p0b.toFixed(1)} (phase 0b 14 px) | ${pct(s.onCardP0b)} |`,
    `| interior lock (R5) | ${pct(s.interiorLock)} |`,
    `| interior lock (phase 0: area <70%, >=85% contained) | ${pct(s.interiorLockP0)} |`,
    `| miss (gate shut on a card) | ${pct(s.miss)} |`,
    `| on-card ignoring presence (corner head alone) | ${pct(s.onCardUngated)} |`,
    `| R5 classes (labelled positives) | ${Object.entries(s.classes).map(([k, v]) => `${k} ${v}`).join(', ') || '—'} |`,
    `| mean corner err, emitted: median / mean / p90 | ${num(s.meanErr.median)} / ${num(s.meanErr.mean)} / ${num(s.meanErr.p90)} |`,
    `| IoU, emitted: median / mean | ${num(s.iou.median, 3)} / ${num(s.iou.mean, 3)} |`,
    `| area ratio (pred/label): p10 / median / p90 | ${num(s.areaRatio.p10, 3)} / ${num(s.areaRatio.median, 3)} / ${num(s.areaRatio.p90, 3)} |`,
    `| false quad, all negatives | ${pct(s.falseQuad)} |`,
    `| false quad, distractor-only | ${pct(s.falseQuadDistractor)} |`,
    '',
  ]
  L.push(...block('Overall', overall))
  L.push(...block(`Tight framing (fill >= ${TIGHT_FILL * 100}%) — the HARVEST.md §5 failure`, tight))
  L.push('## Breakdowns', '')
  L.push(...groupTable('By fill (positives)', groups.fill))
  L.push(...groupTable('By source', groups.source))
  L.push(...groupTable('By face', groups.face))
  L.push(...groupTable('By day (UTC)', groups.day))
  if (overall.negatives) {
    L.push('### Negatives by reason', '', '| reason | false quad |', '|---|---|')
    for (const [k, r] of Object.entries(overall.falseQuadByReason)) L.push(`| ${k} | ${pct(r)} |`)
    L.push('')
  }
  // The rows a person should look at first.
  const bad = rows
    .filter((r) => r.positive && r.gt && r.cls !== 'perimeter')
    .sort((a, b) => (b.ungatedScore?.meanErr ?? 1e9) - (a.ungatedScore?.meanErr ?? 1e9))
  L.push(`## Failing labelled positives (${bad.length}; worst first, max 40)`, '')
  L.push('| id | fill | hasObj | class | mean err | max err | IoU | area ratio |', '|---|---|---|---|---|---|---|---|')
  for (const r of bad.slice(0, 40)) {
    const s = r.ungatedScore
    L.push(`| ${r.id} | ${r.fill != null ? (r.fill * 100).toFixed(0) + '%' : '—'} | ${r.hasObj.toFixed(3)} | ${r.cls} | ${s ? num(s.meanErr) : '—'} | ${s ? num(s.maxErr) : '—'} | ${s ? num(s.iou, 3) : '—'} | ${s ? num(s.areaRatio, 3) : '—'} |`)
  }
  L.push('', '(mean err / IoU on a `miss` row describe the quad the corner head produced under a shut gate.)', '')
  // Presence parity: browser hasObj at label time vs this run.
  const par = rows.filter((r) => r.labelHasObj != null)
  if (par.length) {
    const d = par.map((r) => Math.abs(r.hasObj - r.labelHasObj!))
    const acq = Number(meta.acquire)
    const flips = par.filter((r) => r.hasObj >= acq !== r.labelHasObj! >= acq).length
    L.push(
      '## Presence parity (labeler hasObj in the browser vs this run)',
      '',
      `${par.length} rows carry the browser's own hasObj. |Δ| median ${quantile(d, 0.5).toFixed(4)}, p90 ${quantile(d, 0.9).toFixed(4)}, max ${Math.max(...d).toFixed(4)}; gate decision differs on ${flips}. This is the size of the offline substitution (python ORT + sharp lanczos vs ORT-web + drawImage).`,
      '',
    )
  }
  L.push(...extra)
  return L.join('\n') + '\n'
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const session2 = flag('session2')
  const pipeline = (arg('pipeline', 'v3') as 'v2' | 'v3')!
  if (pipeline !== 'v3' && !session2) throw new Error('--pipeline v2 exists only for --session2 (the corpus is canonical squares)')
  const model = path.resolve(arg('model', DEFAULT_MODEL)!)
  if (!fs.existsSync(model)) throw new Error(`no model at ${model}`)
  if (!fs.existsSync(PY)) throw new Error(`no python at ${PY} (the phase-0a venv with onnxruntime)`)
  const acquire = Number(arg('acquire', String(DEFAULT_ACQUIRE)))
  const limit = arg('limit') ? Number(arg('limit')) : Infinity
  const modelLabel = path.basename(model).replace(/\.onnx$/i, '').replace(/[^\w.-]+/g, '_')
  const modelSha256 = crypto.createHash('sha256').update(fs.readFileSync(model)).digest('hex')

  let inputs: EvalInput[]
  let splitLabel: string
  let outDir: string
  let data: string
  const extra: string[] = []
  const metaExtra: Record<string, unknown> = {}
  if (session2) {
    inputs = session2Inputs(pipeline)
    splitLabel = pipeline === 'v3' ? 'session2' : 'session2-v2'
    outDir = arg('out') ?? path.join(SESSION2, 'quad-eval')
    data = `phase 0b session 2 (${SESSION2}): ${inputs.filter((i) => i.gt).length} hand-labelled card frames, ${inputs.filter((i) => i.positive && !i.gt).length} unlabelled card frames (miss rate only), ${inputs.filter((i) => !i.positive).length} no-card frames (BLIND-VERIFICATION card? = no); owner-flagged, so biased toward failures; ${pipeline === 'v3' ? '480x640 -> engine centre square -> canonical 416' : 'v2 letterboxed full frame (integration-frames.test.ts), mapped into the centre-square canonical frame for scoring'}`
  } else {
    const dir = corpusDir(arg('corpus'))
    const man = readManifest(dir)
    splitLabel = arg('split', 'test')!
    let rows = man.rows
    if (splitLabel !== 'all') {
      const split = readSplit(dir)
      if (!split) throw new Error(`no split.json in ${dir} — run split.ts first (or pass --split all)`)
      if (split.manifest.sha256 !== man.sha256)
        throw new Error(
          `split.json was made from manifest ${split.manifest.sha256.slice(0, 12)} but the manifest is now ${man.sha256.slice(0, 12)}; run split.ts --extend`,
        )
      if (!['train', 'val', 'test'].includes(splitLabel)) throw new Error(`--split must be train|val|test|all`)
      rows = rows.filter((r) => split.assignments[String(r.id)] === splitLabel)
      const comp = split.composition[splitLabel]
      extra.push('## Split composition', '', '```', describe(splitLabel.toUpperCase(), comp, split.units[splitLabel as 'test']), '```', '')
      if (split.warnings.length) extra.push('Split warnings:', '', ...split.warnings.map((w) => `- ${w}`), '')
      // Hash of the ASSIGNMENTS, not the file: an identical re-deal (new
      // createdAt) is the same split, and two evals compare only if this matches.
      const keys = Object.keys(split.assignments).sort()
      const asg = JSON.stringify(keys.map((k) => [k, split.assignments[k]]))
      metaExtra.split = { sha256: crypto.createHash('sha256').update(asg).digest('hex'), params: split.params, composition: comp }
    }
    inputs = corpusInputs(dir, rows)
    outDir = arg('out') ?? dir
    data = `${dir}, manifest sha256 ${man.sha256.slice(0, 12)} (${man.rows.length} rows), split '${splitLabel}' = ${rows.length} rows`
    metaExtra.manifestSha256 = man.sha256
  }
  if (Number.isFinite(limit)) inputs = inputs.slice(0, limit)
  if (!inputs.length) throw new Error('no rows to score')

  console.log(`scoring ${inputs.length} rows with ${modelLabel} (${pipeline}) ...`)
  const t0 = Date.now()
  const rows = await evaluate(inputs, model, acquire)
  const overall = aggregate(rows)
  const tight = aggregate(rows.filter((r) => r.positive && (r.fill ?? 0) >= TIGHT_FILL))
  const groups = {
    fill: groupBy(rows.filter((r) => r.positive), (r) => r.fillBucket, FILL_ORDER),
    source: groupBy(rows, (r) => r.source),
    face: groupBy(rows, (r) => r.face),
    day: groupBy(rows, (r) => r.day),
  }

  if (session2) {
    // Cross-check against integration-frames.test.ts, which scores in 480x640
    // frame px: canonical px x 480/416 is exactly frame px (a uniform scale).
    const s = 480 / CANONICAL_SIZE
    const lab = rows.filter((r) => r.gt && r.ungatedScore)
    const fe = lab.map((r) => r.ungatedScore!.meanErr * s)
    const scale = lab.map((r) => Math.sqrt(r.ungatedScore!.areaRatio))
    const N = CANONICAL_SIZE
    const clipped = rows.filter((r) => r.gt && r.gt.some(([x, y]) => x < 0 || y < 0 || x > N || y > N))
    extra.push(
      '## Cross-check in session-2 frame px (integration-frames.test.ts units)',
      '',
      `Over the ${lab.length} labelled frames, ungated: mean corner error median ${quantile(fe, 0.5).toFixed(1)} px, mean ${(fe.reduce((a, b) => a + b, 0) / fe.length).toFixed(1)} px, <=12 px on ${fe.filter((e) => e <= 12).length}/${lab.length}; mean linear scale ${(scale.reduce((a, b) => a + b, 0) / scale.length).toFixed(3)}. Reference: index.ts INFERENCE_RECT records the v2 letterboxed full frame at median 11.6 / mean 18.0 / scale 0.985 / 11 of 19 within 12 px (\`--pipeline v2\` reproduces it).`,
      '',
      `Labelled cards with a corner outside the engine's centre square (the v3 model cannot see it): ${clipped.length}/${lab.length}${clipped.length ? ` — ${clipped.map((r) => r.id.split(':')[0]).join(', ')}` : ''}. Session 2 is a version-2 (3:4) capture; a version-3 corpus is framed inside the square, so this clipping is a property of replaying it, not of the shipping engine.`,
      '',
    )
  }

  const meta = {
    generatedAt: new Date().toISOString(),
    model: modelLabel,
    modelPath: model,
    modelSha256,
    split: splitLabel,
    pipeline,
    acquire,
    hold: DEFAULT_HOLD,
    canonicalSize: CANONICAL_SIZE,
    thresholds: THRESHOLDS,
    data,
    seconds: Math.round((Date.now() - t0) / 1000),
    ...metaExtra,
  }
  fs.mkdirSync(outDir, { recursive: true })
  const base = path.join(outDir, `eval-${modelLabel}-${splitLabel}`)
  fs.writeFileSync(`${base}.json`, JSON.stringify({ meta, gates: gates(overall), overall, tight, groups, rows }, null, 1) + '\n')
  const md = markdown(meta, overall, tight, groups, rows, extra)
  fs.writeFileSync(`${base}.md`, md)
  console.log('\n' + md.split('## Breakdowns')[0])
  console.log(`written ${base}.json and ${base}.md (${meta.seconds}s)`)
}

main().catch((e) => {
  console.error(`eval: ${(e as Error).message}`)
  process.exit(1)
})
