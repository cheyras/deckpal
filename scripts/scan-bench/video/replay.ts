#!/usr/bin/env node
/**
 * VIDEO AS THE CAMERA — replay a pack-opening video through the scanner's real
 * per-frame path and its real auto-capture policy, offline.
 *
 *   node --import tsx scripts/scan-bench/video/replay.ts JP-MdK4Kr00 RLULfTjTFSs
 *   node --import tsx scripts/scan-bench/video/replay.ts path/to/clip.mp4 --start 10 --end 40
 *
 * Flags: --fps 8 (detect cadence)  --busy-ms 500 (capture busy window)
 *        --lock-ticks N (default: the shipping DEFAULT_LOCK_TICKS)
 *        --no-rearm (replay the policy without the look re-arm, ui/rearm.ts)
 *        --batch 16 (LC050 frames per sidecar call)  --timeline-every 8 (ticks)
 *        --out <dir> (default ~/deckpal-data/video-bench)
 *        --aim x,y,side (point the phone: the engine square's SOURCE rect; phone.ts aimedGeometry)
 *        --second-look (engine/second-look.ts, EngineOptions.secondLook: re-infer on a crop
 *          around the quad when has_obj < acquire; the crop's presence, the first look's quad)
 *        --second-look-scale 1.3  --second-look-gate reticle|any  --second-look-agree 0.5
 *        --second-look-quad first|second (defaults: the engine's)
 *
 * Per video, under <out>/<videoId>/:
 *   captures/<t>.jpg      the 480x670 crops the device would have POSTed
 *   suppressed/<t>-*.jpg  the first suppressed lock of each track, same warp
 *   captures.jsonl        one row per fired capture AND per suppressed lock episode
 *   frames.jsonl          one row per detect tick
 *   contact.png           every fired capture, timestamped
 *   contact-suppressed.png, timeline.png, summary.json
 *
 * What is the product and what is not: see README.md beside this file. In one
 * line — every decision is made by an imported shipping module; the pixels come
 * from ffmpeg + sharp instead of <video> + canvas, the model runs under python
 * onnxruntime instead of onnxruntime-web, and the clock is video time.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'

import type { Quad } from '../../../apps/web/src/scan/engine/contract'
import { oppositeSideRatio, quadAspectRatio, type ImageDataLike, type Rect } from '../../../apps/web/src/scan/engine/geometry'
import { CANONICAL_SIZE } from '../../../apps/web/src/scan/engine/frame'
import { MODEL_SIZE, rgbaToBGRPlanar } from '../../../apps/web/src/scan/engine/preprocess'
import { DEFAULT_ACQUIRE } from '../../../apps/web/src/scan/engine/gate'
import {
  mergeSecondLook,
  secondLookCrop,
  secondLookRect,
} from '../../../apps/web/src/scan/engine/second-look'
import { CAPTURE_QUALITY, type RectifiedImage } from '../../../apps/web/src/scan/engine/rectify'
import {
  copyRGBA,
  drawQuad,
  drawRect,
  sharp,
  type RawModelOut,
} from '../../../apps/web/src/scan/engine/__tests__/offline-harness'
import { parseLockTicks, parseSecondLookFlags } from './flags'
import { aimedGeometry, cropToSource, phoneGeometry, probeVideo, streamSquares, type PhoneGeometry, type StreamFrame } from './phone'
import {
  captureFromSquare,
  createCapturePolicy,
  createMotionMeter,
  createReplayEngine,
  DEFAULT_CAPTURE_BUSY_MS,
  laplacianVariance,
  lockBlockers,
  reticleBlockers,
  type PolicyKnobs,
  type TickState,
} from './session'
import { contactSheet, type Tile } from './sheets'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..', '..')
const DATA = process.env.DECKPAL_DATA ?? path.join(os.homedir(), 'deckpal-data')
const RAW_DIR = path.join(DATA, 'cc-videos', 'raw')
const MODEL = path.join(REPO, 'apps/web/public/scan-assets/lc050.onnx')
const PY = process.env.PY ?? path.join(DATA, 'venvs', 'scanid', 'Scripts', 'python.exe')
const SIDECAR = path.join(HERE, 'lc050_stream.py')

function arg(name: string, dflt: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt
}
/** Flags that take no value: they must not swallow the argument after them. */
const BOOLEAN_FLAGS = new Set(['--no-rearm', '--second-look'])

function positional(): string[] {
  const out: string[] = []
  const argv = process.argv.slice(2)
  for (let i = 0; i < argv.length; i++) {
    if (BOOLEAN_FLAGS.has(argv[i])) continue
    if (argv[i].startsWith('--')) i++
    else out.push(argv[i])
  }
  return out
}

// ---------------------------------------------------------------------------
// LC050 over a long-lived python process (lc050_stream.py)
// ---------------------------------------------------------------------------

class Lc050 {
  private proc: ChildProcessWithoutNullStreams
  private waiting: Array<{ resolve: (r: RawModelOut[]) => void; reject: (e: Error) => void }> = []
  private stderr = ''

  constructor() {
    // OPENBLAS_NUM_THREADS=1: numpy's BLAS pool reserves memory per thread at
    // import, and this machine's commit charge is tight. ORT's own threads are
    // unaffected (LC050_THREADS pins them if wanted).
    this.proc = spawn(PY, [SIDECAR, MODEL], {
      env: { ...process.env, OPENBLAS_NUM_THREADS: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    this.proc.stderr.on('data', (d) => (this.stderr += d))
    readline.createInterface({ input: this.proc.stdout }).on('line', (line) => {
      const w = this.waiting.shift()
      if (!w) return
      try {
        w.resolve(JSON.parse(line))
      } catch (e) {
        w.reject(e as Error)
      }
    })
    this.proc.on('close', (code) => {
      for (const w of this.waiting.splice(0)) w.reject(new Error(`LC050 sidecar exited ${code}: ${this.stderr.slice(-800)}`))
    })
  }

  run(tensors: readonly Float32Array[]): Promise<RawModelOut[]> {
    const head = Buffer.alloc(4)
    head.writeUInt32LE(tensors.length, 0)
    const p = new Promise<RawModelOut[]>((resolve, reject) => this.waiting.push({ resolve, reject }))
    this.proc.stdin.write(head)
    for (const t of tensors) this.proc.stdin.write(Buffer.from(t.buffer, t.byteOffset, t.byteLength))
    return p
  }

  async close(): Promise<void> {
    const head = Buffer.alloc(4)
    this.proc.stdin.end(head)
    await new Promise((r) => this.proc.on('close', r))
  }
}

// ---------------------------------------------------------------------------
// pixels: sharp stands in for drawImage (offline-harness.ts substitution 1)
// ---------------------------------------------------------------------------

function rgba(buf: Buffer, w: number, h: number): ImageDataLike {
  return { width: w, height: h, data: new Uint8ClampedArray(buf.buffer, buf.byteOffset, buf.length) }
}

/**
 * index.ts:631-636: the model input is a plain resize of the full-res centre
 * square to MODEL_SIZE (drawModelInput), and the refiner's working image is the
 * same square at CANONICAL_SIZE (grabWork). Both are smooth-filtered
 * downscales of one buffer here as there; lanczos3 is the resampler every other
 * offline harness in this repo substitutes for canvas smoothing.
 */
async function prepare(sq: StreamFrame['square']): Promise<{ tensor: Float32Array; work: ImageDataLike }> {
  const S = await sharp()
  const src = () =>
    S(Buffer.from(sq.data.buffer, sq.data.byteOffset, sq.data.byteLength), {
      raw: { width: sq.width, height: sq.height, channels: 4 },
    })
  const [m, w] = await Promise.all([
    src().resize({ width: MODEL_SIZE, height: MODEL_SIZE, fit: 'fill', kernel: 'lanczos3' }).ensureAlpha().raw().toBuffer(),
    src().resize({ width: CANONICAL_SIZE, height: CANONICAL_SIZE, fit: 'fill', kernel: 'lanczos3' }).ensureAlpha().raw().toBuffer(),
  ])
  return { tensor: rgbaToBGRPlanar(rgba(m, MODEL_SIZE, MODEL_SIZE)), work: rgba(w, CANONICAL_SIZE, CANONICAL_SIZE) }
}

/**
 * The second look's model input: the crop of the FULL-RES square this tick read
 * (on the device: the capture buffer grabbed at tick start, never the live
 * video, which has moved on by the time the first inference returns), resized to
 * MODEL_SIZE the same way prepare() makes the first.
 */
async function prepareCrop(sq: StreamFrame['square'], r: Rect): Promise<Float32Array> {
  const S = await sharp()
  const left = Math.round(r.x * sq.width)
  const top = Math.round(r.y * sq.height)
  const side = Math.max(1, Math.min(Math.round(r.w * sq.width), sq.width - left, sq.height - top))
  const m = await S(Buffer.from(sq.data.buffer, sq.data.byteOffset, sq.data.byteLength), {
    raw: { width: sq.width, height: sq.height, channels: 4 },
  })
    .extract({ left, top, width: side, height: side })
    .resize({ width: MODEL_SIZE, height: MODEL_SIZE, fit: 'fill', kernel: 'lanczos3' })
    .ensureAlpha()
    .raw()
    .toBuffer()
  return rgbaToBGRPlanar(rgba(m, MODEL_SIZE, MODEL_SIZE))
}

/** CAPTURE_QUALITY 0.85; sharp's libjpeg stands in for the browser encoder
 *  (check-a.ts jpegRoundTrip makes the same substitution). */
async function encodeJpeg(px: { width: number; height: number; data: Uint8ClampedArray }): Promise<Buffer> {
  const S = await sharp()
  return S(Buffer.from(px.data.buffer, px.data.byteOffset, px.data.byteLength), {
    raw: { width: px.width, height: px.height, channels: 4 },
  })
    .removeAlpha()
    .jpeg({ quality: Math.round(CAPTURE_QUALITY * 100) })
    .toBuffer()
}

// ---------------------------------------------------------------------------
// records
// ---------------------------------------------------------------------------

const r1 = (n: number) => Math.round(n * 10) / 10
const r3 = (n: number | null | undefined) => (n === null || n === undefined ? null : Math.round(n * 1000) / 1000)
const rq = (q: Quad | null | undefined) => (q ? q.map(([x, y]) => [r1(x), r1(y)]) : null)
const tName = (tMs: number) => (tMs / 1000).toFixed(3).padStart(8, '0')

interface TrackLog {
  firstLockMs: number
  firedMs: number | null
  regionTicks: number
  busyTicks: number
  refractoryTicks: number
  logged: Set<string>
}

interface CaptureRow {
  n: number | null
  t: number
  i: number
  file: string
  suppressed: false | 'region' | 'busy'
  /** 'look': a repeat the look re-arm let through. */
  why?: 'look'
  trackId: number
  trackAge: number
  quad: number[][] | null
  quadStream: number[][]
  quadSource: number[][]
  hasObj: number | null
  gateOpen: boolean
  saturation: number | null
  aspect: number | null
  parallel: number | null
  motionPx: number | null
  sharpness: number
  regionCount: number
  regionsExpired: number
  trackFiredAt?: number | null
}

// ---------------------------------------------------------------------------
// one video
// ---------------------------------------------------------------------------

async function replayVideo(input: string, lc050: Lc050, outRoot: string): Promise<Record<string, unknown>> {
  const file = fs.existsSync(input) ? input : path.join(RAW_DIR, `${input}.mp4`)
  if (!fs.existsSync(file)) throw new Error(`no such video: ${input}`)
  const videoId = path.basename(file).replace(/\.[^.]+$/, '')
  const fps = Number(arg('fps', '8'))
  const busyMs = Number(arg('busy-ms', String(DEFAULT_CAPTURE_BUSY_MS)))
  const batchSize = Number(arg('batch', '16'))
  const timelineEvery = Number(arg('timeline-every', String(fps)))
  const startS = Number(arg('start', '0')) || undefined
  const endS = Number(arg('end', '0')) || undefined

  const lockTicks = parseLockTicks(arg)
  const aimArg = arg('aim', '')
  const aim = aimArg ? aimArg.split(',').map(Number) : null
  if (aim && (aim.length !== 3 || aim.some((n) => !Number.isFinite(n)))) throw new Error(`--aim wants x,y,side in source px, got ${aimArg}`)
  const secondLook = process.argv.includes('--second-look')
  // flags.ts checks every second-look flag (ranges, enum values) even when
  // --second-look is off, so a typo stops the run instead of changing it.
  const {
    scale: secondLookScale,
    gate: secondLookGate,
    agree: secondLookAgree,
    quad: secondLookQuad,
  } = parseSecondLookFlags(arg)
  const knobs: PolicyKnobs & { lockTicks?: number; aim?: string; secondLook?: Record<string, unknown> } = {
    busyMs,
    lockTicks,
    rearm: !process.argv.includes('--no-rearm'),
    ...(aim ? { aim: aimArg } : {}),
    ...(secondLook
      ? { secondLook: { scale: secondLookScale, gate: secondLookGate, agree: secondLookAgree, quad: secondLookQuad } }
      : {}),
  }
  const probe = await probeVideo(file)
  const geo: PhoneGeometry = aim
    ? aimedGeometry(probe.width, probe.height, { x: aim[0], y: aim[1], side: aim[2] })
    : phoneGeometry(probe.width, probe.height)
  const outDir = path.join(outRoot, videoId)
  for (const d of ['captures', 'suppressed']) fs.rmSync(path.join(outDir, d), { recursive: true, force: true })
  fs.mkdirSync(path.join(outDir, 'captures'), { recursive: true })
  fs.mkdirSync(path.join(outDir, 'suppressed'), { recursive: true })
  const framesOut = fs.createWriteStream(path.join(outDir, 'frames.jsonl'))
  const rows: CaptureRow[] = []

  console.log(
    `${videoId}: ${probe.width}x${probe.height} ${probe.durationS.toFixed(1)}s -> ${geo.aim ? `AIMED square ${geo.aim.side}@${geo.aim.x},${geo.aim.y} (` : ''}viewport ` +
      `${geo.viewport.w}x${geo.viewport.h}@${geo.viewport.x},${geo.viewport.y} -> stream 960x1280 -> ` +
      `square ${geo.square.size} (native ${geo.nativeSquarePx}px)${geo.aim ? ')' : ''}  @${fps} Hz, busy ${busyMs} ms` +
      (secondLook ? `, second look ${JSON.stringify(knobs.secondLook)}` : ''),
  )

  const engine = createReplayEngine({ lockTicks: knobs.lockTicks })
  const policy = createCapturePolicy(knobs)
  const motion = createMotionMeter()
  const tracks = new Map<number, TrackLog>()
  const timeline: Tile[] = []
  let lastPixels: RectifiedImage | null = null
  const captureTiles: Tile[] = []
  const suppressedTiles: Tile[] = []
  // THE FUNNEL, tick by tick: gate open -> a quad observed -> it passes the
  // tracker's reticle filter -> some stable track -> some stable track is
  // lock-eligible -> locked. Each step's losses are attributed below.
  const stats = {
    ticks: 0,
    gateOpenTicks: 0,
    observedTicks: 0,
    inReticleTicks: 0,
    stableTicks: 0,
    lockEligibleTicks: 0,
    lockTicks: 0,
    captures: 0,
    captureFailures: 0,
    regionSuppressedTicks: 0,
    busyTicks: 0,
    lookFires: 0,
    /** Second look (--second-look): ticks that ran it, ticks whose answer it
     *  replaced, and ticks it lifted from below the acquire threshold to above. */
    secondLookTicks: 0,
    secondLookUsed: 0,
    secondLookAcquired: 0,
  }
  /** Blocker histograms keyed by the reason's first word (`inside 0.52` ->
   *  `inside`): why observed quads missed the tracker, why stable tracks
   *  missed the lock. One tick can count under several reasons. */
  const blockers = { observed: {} as Record<string, number>, stable: {} as Record<string, number> }
  const bump = (h: Record<string, number>, why: string) => {
    const k = why.split(' ')[0]
    h[k] = (h[k] ?? 0) + 1
  }
  let lastEvents: string[] = []

  const toStream = (q: Quad) => q.map(([x, y]) => [r1(geo.square.x + x), r1(geo.square.y + y)])
  const toSource = (q: Quad) => q.map((p) => cropToSource(geo, p).map(r1))

  async function writeCrop(
    s: TickState,
    f: StreamFrame,
    kind: 'fire' | 'region' | 'busy',
    motionPx: number | undefined,
    why?: 'look',
  ): Promise<CaptureRow | null> {
    const locked = s.locked!
    const cap = captureFromSquare(locked, f.square)
    if (!cap) return null
    lastPixels = cap.pixels
    const jpeg = await encodeJpeg(cap.pixels)
    const rel = kind === 'fire' ? `captures/${tName(f.tMs)}.jpg` : `suppressed/${tName(f.tMs)}-${kind}-trk${locked.id}.jpg`
    fs.writeFileSync(path.join(outDir, rel), jpeg)
    const row: CaptureRow = {
      n: kind === 'fire' ? stats.captures + 1 : null,
      t: r3(f.tMs / 1000)!,
      i: f.index,
      file: rel,
      suppressed: kind === 'fire' ? false : kind,
      ...(why ? { why } : {}),
      trackId: locked.id,
      trackAge: locked.age,
      quad: rq(cap.quad),
      quadStream: toStream(cap.cropQuad),
      quadSource: toSource(cap.cropQuad),
      hasObj: r3(s.hasObj),
      gateOpen: s.gateOpen,
      saturation: r3(s.saturationOf(locked.id)),
      aspect: r3(quadAspectRatio(cap.quad)),
      parallel: r3(oppositeSideRatio(cap.quad)),
      motionPx: motionPx === undefined ? null : r1(motionPx),
      sharpness: Math.round(laplacianVariance(cap.pixels)),
      regionCount: policy.regionCount,
      regionsExpired: policy.regionsExpired,
    }
    rows.push(row)
    const tile: Tile = {
      image: jpeg,
      lines: [
        `${kind === 'fire' ? `#${row.n}` : kind} t=${(f.tMs / 1000).toFixed(2)}s trk${locked.id}`,
        `lap ${row.sharpness} mot ${row.motionPx ?? '-'} sat ${row.saturation ?? '-'}`,
      ],
    }
    ;(kind === 'fire' ? captureTiles : suppressedTiles).push(tile)
    return row
  }

  async function onTick(f: StreamFrame, out: RawModelOut & { h1?: number }, work: ImageDataLike): Promise<void> {
    const s = engine.tick(out.points, out.hasObj, work)
    const motionBy = motion.update([...s.stable, ...s.pending])
    const outcome = policy.decide(f.tMs, s, { look: s.look })
    stats.ticks++
    if (s.gateOpen) stats.gateOpenTicks++
    if (s.observed) stats.observedTicks++
    const obsWhy = s.observed ? reticleBlockers(s.observed, engine.reticle) : []
    if (s.observed && !obsWhy.length) stats.inReticleTicks++
    for (const w of obsWhy) bump(blockers.observed, w)
    if (s.stable.length) stats.stableTicks++
    const stableWhy = s.stable.map((t) => lockBlockers(t, engine.reticle, s.saturationOf(t.id)))
    if (stableWhy.some((w) => !w.length)) stats.lockEligibleTicks++
    for (const ws of stableWhy) for (const w of ws) bump(blockers.stable, w)
    if (s.locked) stats.lockTicks++

    let event: string | null = outcome.kind === 'none' ? null : outcome.kind
    const locked = s.locked
    if (locked) {
      let log = tracks.get(locked.id)
      if (!log) {
        log = { firstLockMs: f.tMs, firedMs: null, regionTicks: 0, busyTicks: 0, refractoryTicks: 0, logged: new Set() }
        tracks.set(locked.id, log)
      }
      if (outcome.kind === 'fire') {
        const row = await writeCrop(s, f, 'fire', motionBy.get(locked.id), outcome.why)
        if (!row) {
          // index.ts:838 throws; Scan.tsx:1217-1221 releases the hold.
          policy.failed(locked.id)
          stats.captureFailures++
          event = 'capture-failed'
        } else {
          policy.captured(f.tMs, (locked.raw ?? locked.quad) as Quad, locked.id, lastPixels!)
          stats.captures++
          if (outcome.why === 'look') stats.lookFires++
          log.firedMs = f.tMs
        }
      } else if (outcome.kind === 'region' || outcome.kind === 'busy') {
        if (outcome.kind === 'region') {
          log.regionTicks++
          stats.regionSuppressedTicks++
        } else {
          log.busyTicks++
          stats.busyTicks++
        }
        // One crop per track per reason: enough to judge by eye whether the
        // suppression refused a duplicate or a new card.
        if (!log.logged.has(outcome.kind)) {
          log.logged.add(outcome.kind)
          await writeCrop(s, f, outcome.kind, motionBy.get(locked.id))
        }
      } else if (outcome.kind === 'refractory') {
        log.refractoryTicks++
      }
    }
    if (event) lastEvents.push(event)

    framesOut.write(
      JSON.stringify({
        i: f.index,
        t: r3(f.tMs / 1000),
        hasObj: r3(s.hasObj),
        // The first look's has_obj, when the second look replaced it.
        ...(out.h1 !== undefined ? { h1: r3(out.h1) } : {}),
        gate: s.gateOpen ? 1 : 0,
        obs: rq(s.observed),
        ...(obsWhy.length ? { obsWhy } : {}),
        sat: r3(s.tickSaturation),
        stable: s.stable.map((t, k) => {
          const why = stableWhy[k]
          return { id: t.id, age: t.age, c: t.coasting ? 1 : 0, q: rq(t.quad), mot: r1(motionBy.get(t.id) ?? 0), ...(why.length ? { why } : {}) }
        }),
        pending: s.pending.map((t) => ({ id: t.id, age: t.age })),
        locked: locked?.id ?? null,
        // The lock's look (EngineState.look), so the re-arm's thresholds can be re-fitted offline.
        ...(s.look ? { look: Buffer.from(s.look).toString('base64') } : {}),
        regions: policy.regionCount,
        ...(event ? { event } : {}),
      }) + '\n',
    )

    if (f.index % timelineEvery === 0) {
      // What the phone saw this tick: the canonical frame with the reticle
      // (grey), the observation (yellow), stable tracks (green, dark when
      // coasting) and the lock (red). Border: red if a capture fired since the
      // previous tile, orange if only suppressions happened.
      const img = copyRGBA(work)
      const N = CANONICAL_SIZE
      const r = engine.reticle
      drawRect(img, { x: r.x * N, y: r.y * N, w: r.w * N, h: r.h * N }, [150, 150, 150], 1)
      if (s.observed) drawQuad(img, s.observed, [255, 220, 0], 1, false)
      for (const t of s.stable) drawQuad(img, t.quad, t.coasting ? [0, 110, 0] : [0, 230, 80], 2, false)
      if (locked) drawQuad(img, locked.quad, [255, 40, 40], 3, false)
      const S = await sharp()
      const small = await S(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength), {
        raw: { width: N, height: N, channels: 4 },
      })
        .resize({ width: 208, height: 208 })
        .removeAlpha()
        .raw()
        .toBuffer()
      const fired = lastEvents.includes('fire')
      const supp = lastEvents.includes('region') || lastEvents.includes('busy')
      timeline.push({
        image: { data: small, width: 208, height: 208, channels: 3 },
        lines: [
          `t=${(f.tMs / 1000).toFixed(1)}s obj ${s.hasObj.toFixed(2)}`,
          `${locked ? `LOCK trk${locked.id}` : s.stable.length ? `stable ${s.stable.length}` : s.observed ? 'seen' : '-'}`,
        ],
        border: fired ? '#ff3030' : supp ? '#ff9a00' : undefined,
      })
      lastEvents = []
    }
  }

  // Decode -> prepare -> one sidecar call per batch -> the causal pass, in
  // order. Each batch's full-res squares stay in memory only until the causal
  // pass has decided whether any of them is a capture frame.
  let batch: StreamFrame[] = []
  const flush = async () => {
    if (!batch.length) return
    const prepared = await Promise.all(batch.map((f) => prepare(f.square)))
    const outs: Array<RawModelOut & { h1?: number }> = await lc050.run(prepared.map((p) => p.tensor))
    if (secondLook) {
      // engine/second-look.ts, called as index.ts tick() calls it under
      // EngineOptions.secondLook: which ticks look again and at what
      // (secondLookCrop), and which answer the tick keeps (mergeSecondLook).
      // Both looks are batched here; the device runs them back to back.
      const want: Array<{ k: number; crop: Rect }> = []
      for (let k = 0; k < batch.length; k++) {
        const o = outs[k]
        const crop =
          secondLookGate === 'any'
            ? o.hasObj < DEFAULT_ACQUIRE
              ? secondLookRect(o.points, secondLookScale)
              : null
            : secondLookCrop(o, { acquire: DEFAULT_ACQUIRE, reticle: engine.reticle, scale: secondLookScale })
        if (crop) want.push({ k, crop })
      }
      if (want.length) {
        const tensors = await Promise.all(want.map(({ k, crop }) => prepareCrop(batch[k].square, crop)))
        const outs2 = await lc050.run(tensors)
        want.forEach(({ k, crop }, j) => {
          stats.secondLookTicks++
          const m = mergeSecondLook(outs[k], outs2[j], crop, {
            agreeIoU: secondLookAgree,
            keepFirstQuad: secondLookQuad !== 'second',
          })
          if (!m.used) return
          stats.secondLookUsed++
          if (m.hasObj >= DEFAULT_ACQUIRE) stats.secondLookAcquired++
          outs[k] = { points: m.points, hasObj: m.hasObj, h1: outs[k].hasObj }
        })
      }
    }
    for (let k = 0; k < batch.length; k++) await onTick(batch[k], outs[k], prepared[k].work)
    batch = []
  }
  const t0 = Date.now()
  for await (const f of streamSquares(file, geo, { fps, startS, endS })) {
    batch.push(f)
    if (batch.length >= batchSize) await flush()
    if (f.index % (fps * 20) === 0 && f.index) process.stdout.write(`  ${(f.tMs / 1000).toFixed(0)}s`)
  }
  await flush()
  await new Promise<void>((r) => framesOut.end(r))
  process.stdout.write('\n')

  // Annotate suppressed rows with whether their track ever fired, then write.
  for (const row of rows) if (row.suppressed) row.trackFiredAt = tracks.get(row.trackId)?.firedMs != null ? r3(tracks.get(row.trackId)!.firedMs! / 1000) : null
  fs.writeFileSync(path.join(outDir, 'captures.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''))

  const lockEpisodes = [...tracks.values()]
  const regionOnly = lockEpisodes.filter((l) => l.firedMs === null && l.regionTicks > 0)
  const busyDeferred = lockEpisodes.filter((l) => l.busyTicks > 0)
  const sharp_ = rows.filter((r) => !r.suppressed).map((r) => r.sharpness).sort((a, b) => a - b)
  const summary = {
    videoId,
    source: { width: probe.width, height: probe.height, durationS: r3(probe.durationS), fps: probe.fps },
    phone: { viewport: geo.viewport, stream: { width: 960, height: 1280 }, square: geo.square, nativeSquarePx: geo.nativeSquarePx },
    replay: { fps, busyMs, startS: startS ?? 0, endS: endS ?? null, wallS: r1((Date.now() - t0) / 1000) },
    knobs,
    ...stats,
    blockers,
    lockedTracks: lockEpisodes.length,
    capturedTracks: lockEpisodes.filter((l) => l.firedMs !== null).length,
    regionSuppressedTracks: regionOnly.length,
    busyDeferredTracks: busyDeferred.length,
    busyDeferredThenFired: busyDeferred.filter((l) => l.firedMs !== null).length,
    sharpness: sharp_.length
      ? { min: sharp_[0], median: sharp_[Math.floor(sharp_.length / 2)], max: sharp_[sharp_.length - 1] }
      : null,
  }
  fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2))

  const title = [
    `${videoId}  ${probe.width}x${probe.height}  ${probe.durationS.toFixed(1)}s  square ${geo.nativeSquarePx}px native  @${fps}Hz`,
    `ticks ${stats.ticks}  lock ticks ${stats.lockTicks}  locked tracks ${lockEpisodes.length}  captures ${stats.captures}  region-suppressed tracks ${regionOnly.length}  busy-deferred ${busyDeferred.length}`,
  ]
  await contactSheet(captureTiles, { thumbW: 192, thumbH: 268, cols: 8, title, out: path.join(outDir, 'contact.png') })
  if (suppressedTiles.length) {
    await contactSheet(suppressedTiles, {
      thumbW: 192,
      thumbH: 268,
      cols: 8,
      title: [`${videoId} — SUPPRESSED locks (first of each track per reason)`],
      out: path.join(outDir, 'contact-suppressed.png'),
    })
  }
  await contactSheet(timeline, {
    thumbW: 208,
    thumbH: 208,
    cols: 10,
    title: [`${videoId} — canonical frame every ${timelineEvery} ticks; red border = capture fired, orange = suppressed lock`],
    out: path.join(outDir, 'timeline.png'),
  })
  return summary
}

async function main(): Promise<void> {
  const inputs = positional()
  if (!inputs.length) {
    console.error('usage: node --import tsx scripts/scan-bench/video/replay.ts <videoId|file.mp4>... [--fps 8] [--busy-ms 500]')
    process.exit(2)
  }
  for (const p of [PY, MODEL, SIDECAR]) if (!fs.existsSync(p)) throw new Error(`missing: ${p}`)
  const outRoot = arg('out', path.join(DATA, 'video-bench'))
  const lc050 = new Lc050()
  const results: Record<string, unknown>[] = []
  try {
    for (const input of inputs) results.push(await replayVideo(input, lc050, outRoot))
  } finally {
    await lc050.close()
  }
  console.log('\nvideo            ticks  lockTicks  lockedTrk  captures  regionSupTrk  busyDefTrk  sharpness(med)  wall')
  for (const s of results as Array<Record<string, any>>) {
    console.log(
      `${String(s.videoId).padEnd(16)} ${String(s.ticks).padStart(5)}  ${String(s.lockTicks).padStart(9)}  ${String(s.lockedTracks).padStart(9)}  ` +
        `${String(s.captures).padStart(8)}  ${String(s.regionSuppressedTracks).padStart(12)}  ${String(s.busyDeferredTracks).padStart(10)}  ` +
        `${String(s.sharpness?.median ?? '-').padStart(14)}  ${s.replay.wallS}s`,
    )
  }
  console.log('\nfunnel (ticks): gate open > observed > in reticle > stable > lock-eligible > locked; blockers')
  for (const s of results as Array<Record<string, any>>) {
    const h = (o: Record<string, number>) => Object.entries(o).map(([k, v]) => `${k} ${v}`).join(', ') || '-'
    console.log(
      `${String(s.videoId).padEnd(16)} ${s.gateOpenTicks} > ${s.observedTicks} > ${s.inReticleTicks} > ${s.stableTicks} > ` +
        `${s.lockEligibleTicks} > ${s.lockTicks}   reticle: ${h(s.blockers.observed)}   lock: ${h(s.blockers.stable)}`,
    )
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
