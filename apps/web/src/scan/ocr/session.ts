// THE OCR SESSIONS — two more ONNX graphs on the runtime the scanner already
// loaded, and the staged loading that keeps them off the critical path.
//
// ── SEPARATE FROM THE DETECTOR, ON PURPOSE ──────────────────────────────────
//
// `engine/model.ts` owns LC050 and 19 MB of ORT runtime, fetched on the first
// `ready()` call. This module owns 15.6 MB more (det 4.75 + rec 10.82 + keys
// 0.03) and MUST NOT be reachable from that path. The detector is what makes the
// camera useful — it draws the quad, it decides when to fire — and it has to be
// usable before a byte of OCR weight has arrived. Two session caches, two
// `loadX()` promises, no shared gate: an OCR fetch that never completes (a phone
// that goes offline mid-download) degrades the scanner to exactly what it is
// today, which is a working scanner.
//
// What IS shared is the runtime. `import()` of the same URL returns the same
// module instance, so the `ort` object here is the one `model.ts` already
// configured, and the 14 MB `.wasm` is fetched once for all three sessions.
// REPORT.md §5.2's case for PP-OCRv4 over every alternative is precisely this:
// "reuses the ORT runtime and proxy worker entirely".
//
// ── THE STAGING RULE ────────────────────────────────────────────────────────
//
// REPORT.md §6.3: OCR must not sit on the capture path. The whole unsuppressed
// capture was measured at 0.67 s and OCR is projected at 1.8-3.4 s on the
// owner's iPhone, so the fetch is kicked off only once the camera is live AND
// the detector is ready (`useScanEngine`'s status reaching 'ready'), and the
// inference runs in parallel with the phash round trip rather than ahead of it.
//
// ── AND THE iOS DISCIPLINE THAT COMES WITH IT ───────────────────────────────
//
// `model.ts`'s header is a catalogue of what ORT-web on iOS does when it is
// given the wrong bundle: WASM-JIT infinite loops, device hard-reboots, a live
// camera loop dying at ~500 inferences (onnxruntime #26827, #27584). Everything
// that made LC050 survive a 70,229-inference endurance run applies here
// unchanged and is not re-derived: same wasm-only bundle, same explicit
// `executionProviders: ['wasm']`, same proxy worker, same fresh-tensor-per-call
// rule. REPORT.md §8.4 names "adding a second, larger ONNX session is not
// obviously free" as an open risk — the mitigation is that this one is behind a
// flag (`scan/ui/flags.ts`) that defaults OFF in production.

import { scanAssetUrl } from '../engine/model'

/** Structural subset of onnxruntime-web this module uses. Wider than
 *  `model.ts`'s because both PP-OCR graphs take DYNAMIC input dimensions — the
 *  detector's input is the ROI's own size rounded to a multiple of 32, and the
 *  recogniser's width varies per line — so nothing here can be a fixed tuple. */
interface OrtTensor {
  readonly data: Float32Array
  readonly dims: readonly number[]
}
interface OrtSession {
  readonly inputNames: readonly string[]
  readonly outputNames: readonly string[]
  run(feeds: Record<string, OrtTensor>): Promise<Record<string, OrtTensor>>
}
interface OrtModule {
  env: { wasm: { simd: boolean; proxy: boolean; numThreads: number } }
  Tensor: new (type: 'float32', data: Float32Array, dims: readonly number[]) => OrtTensor
  InferenceSession: {
    create(
      path: string,
      options: { executionProviders: string[]; graphOptimizationLevel: string },
    ): Promise<OrtSession>
  }
}

const ORT_BUNDLE = 'ort.wasm.min.mjs'
const DET_FILE = 'ppocr-v4-det.onnx'
const REC_FILE = 'ppocr-v4-rec.onnx'
const KEYS_FILE = 'ppocr-keys-v1.txt'

/** One graph, plus the names its inputs and outputs actually carry — read from
 *  the session rather than hard-coded, exactly as `model.ts` does, because an
 *  export's tensor names are not part of any contract we control. */
export interface OcrGraph {
  run(input: Float32Array, dims: readonly number[]): Promise<{ data: Float32Array; dims: readonly number[] }>
}

export interface OcrSession {
  det: OcrGraph
  rec: OcrGraph
  keys: readonly string[]
  /** Wall-clock of the whole load, for the probe and for telemetry. */
  loadMs: number
}

let pending: Promise<OcrSession> | null = null

/**
 * Load the OCR models once. Same contract as `model.ts`'s `loadModel`:
 * concurrent callers share the promise, a caller after success gets it back for
 * free, and a FAILED load clears the cache so a later retry can actually retry
 * rather than replaying the rejection forever (offline on first open, then
 * online — which for a 15.6 MB download is not a hypothetical).
 */
export function loadOcrSession(): Promise<OcrSession> {
  if (!pending) {
    pending = createOcrSession().catch((err) => {
      pending = null
      throw err
    })
  }
  return pending
}

/** Has the session finished loading? Used only to decide whether a capture can
 *  expect an OCR result in useful time — never to gate correctness. */
export function ocrSessionStarted(): boolean {
  return pending !== null
}

/** Test/teardown hook — drops the cached session promise. */
export function resetOcrSession(): void {
  pending = null
}

async function createOcrSession(): Promise<OcrSession> {
  const t0 = performance.now()
  // By URL, dynamic, exactly as `model.ts` does it: the bundle is a public
  // asset so it can resolve its own `.wasm` sibling, not a dependency Vite may
  // inline or hash. The second import of the same URL is free.
  const mod = (await import(/* @vite-ignore */ scanAssetUrl(ORT_BUNDLE))) as { default?: OrtModule }
  const ort = (mod.default ?? (mod as unknown)) as OrtModule

  // Idempotent: these are the SAME values `model.ts` sets, so on the ordinary
  // path (detector first, OCR staged behind it) every assignment here is a
  // no-op. They are still made, because the OCR lane must not depend on the
  // detector having run — the dev probe loads this module on its own.
  const coi = typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated
  const threadsPossible = coi && typeof SharedArrayBuffer !== 'undefined'
  ort.env.wasm.simd = true
  ort.env.wasm.proxy = true
  ort.env.wasm.numThreads = threadsPossible
    ? Math.min(4, Math.max(1, Math.floor((navigator.hardwareConcurrency || 1) / 2)))
    : 1

  // In parallel: three independent fetches, and the two big ones are the whole
  // wait. Serialising them would add the keys file's round trip to a 15.6 MB
  // download for no reason.
  const [det, rec, keysText] = await Promise.all([
    ort.InferenceSession.create(scanAssetUrl(DET_FILE), {
      executionProviders: ['wasm'], // NEVER 'webgpu' / 'webnn' — model.ts's header
      graphOptimizationLevel: 'all',
    }),
    ort.InferenceSession.create(scanAssetUrl(REC_FILE), {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    }),
    fetch(scanAssetUrl(KEYS_FILE)).then((r) => {
      if (!r.ok) throw new Error(`the OCR character set failed to load (${r.status})`)
      return r.text()
    }),
  ])

  const { parseKeys } = await import('./ctc')
  return {
    det: wrap(ort, det),
    rec: wrap(ort, rec),
    keys: parseKeys(keysText),
    loadMs: performance.now() - t0,
  }
}

function wrap(ort: OrtModule, session: OrtSession): OcrGraph {
  const inputName = session.inputNames[0] ?? 'x'
  const outputName = session.outputNames[0] ?? 'softmax_0.tmp_0'
  return {
    async run(input, dims) {
      // A FRESH Tensor over a FRESH Float32Array, every call. With
      // `env.wasm.proxy = true` ORT transfers the backing ArrayBuffer to the
      // proxy worker as a transferable, DETACHING it here; a reused buffer
      // throws `DataCloneError: ... An ArrayBuffer is detached and could not be
      // cloned` on the second run. `raster.rgbaToBGRPlanar` allocates; this
      // hands ownership away. The detector hit this in a live browser
      // (probe.html:500-507) — it is not read from documentation.
      const tensor = new ort.Tensor('float32', input, dims)
      const out = await session.run({ [inputName]: tensor })
      const t = out[outputName] ?? Object.values(out)[0]
      if (!t || !(t.data instanceof Float32Array)) {
        throw new Error('the OCR model returned no output tensor')
      }
      return { data: t.data, dims: t.dims }
    },
  }
}
