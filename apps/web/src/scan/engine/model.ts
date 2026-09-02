// ONNX Runtime session management for DocAligner LC050.
//
// Everything in this file is a transcription of what the 20-minute phase-0b
// endurance run actually did (dev-assets/probe/probe.html, 70,229 inferences,
// no crash, 46-85 inf/s on the owner's iPhone). Where it looks over-specified,
// that is because each specification is load-bearing:
//
// WASM ONLY, AND PHYSICALLY SO. `ort.wasm.min.mjs` is a different bundle from
// the default `ort.min.mjs`/`ort.all.*`, which pull in the WebGPU (JSEP) and
// WebNN backends. The binary it loads, `ort-wasm-simd-threaded.wasm`, is
// compiled WITHOUT the JSEP code paths at all — the WebGPU-capable build is a
// separate ~28 MB file we do not ship. So this is not "we did not select
// WebGPU": the compiled module cannot execute a WebGPU op. That is the
// strongest available guarantee against the iOS crash reports research lane R2
// §4a collected (onnxruntime #26827, #27584: WASM-JIT infinite loop, device
// hard-reboot, live-camera loop dying at ~500 inferences). We pass
// executionProviders: ['wasm'] explicitly as well. Belt and suspenders.
//
// THE THREE FILES MUST SIT TOGETHER. The wasm-only bundle resolves its binary
// with `new URL('ort-wasm-simd-threaded.wasm', import.meta.url)` — relative to
// ITSELF, not to the page. All three (`ort.wasm.min.mjs`,
// `ort-wasm-simd-threaded.mjs`, `ort-wasm-simd-threaded.wasm`) therefore live
// in the same public/scan-assets/ directory, and the module is loaded by URL
// so that resolution still works from a hashed app chunk.
//
// THREADS: ORT only starts a worker pool when self.crossOriginIsolated is true
// (COOP/COEP headers, for SharedArrayBuffer). This app sets no such headers, so
// numThreads clamps to 1 internally. The 46-85 inf/s above IS the
// single-threaded number; nothing here depends on getting threads.
//
// PROXY WORKER: ort.env.wasm.proxy = true runs the actual inference in ORT's
// own internal worker, off the main thread, without hand-rolling an
// OffscreenCanvas pipeline (iOS Safari has no reliable
// MediaStreamTrackProcessor, so frame capture must stay on the main thread
// regardless — see index.ts).
//
// LAZY AND IDEMPOTENT: 19 MB of assets are fetched on the first ready() call
// and never at page load. vite.config.ts excludes scan-assets/** from the
// service worker precache for the same reason.

import { MODEL_SIZE } from './preprocess'

/** Structural subset of onnxruntime-web that this engine uses. The module is
 *  loaded at runtime from a URL, so there is no package to import types from;
 *  these are the shapes the probe verified against the real bundle. */
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

export const MODEL_INPUT_DIMS = [1, 3, MODEL_SIZE, MODEL_SIZE] as const
const ASSET_DIR = 'scan-assets/'
const ORT_BUNDLE = 'ort.wasm.min.mjs'
const MODEL_FILE = 'lc050.onnx'

/** Public path of a scan asset, honouring the app's base path (`/` on cloud,
 *  `/deckpal/` self-hosted — vite.config.ts decides, everything else reads it). */
export function scanAssetUrl(file: string): string {
  const base = import.meta.env.BASE_URL || '/'
  return `${base.endsWith('/') ? base : `${base}/`}${ASSET_DIR}${file}`
}

export interface ModelSession {
  /** Raw normalised corner predictions [x0,y0,...,x3,y3] in MODEL space. */
  run(input: Float32Array): Promise<ModelResult>
  readonly info: ModelInfo
}

export interface ModelResult {
  /** 8 values, normalised [0,1] in model space (LC050's `points` output is
   *  normalised, not absolute pixels — verified empirically, probe.html:540). */
  points: Float32Array
  /** Presence head, raw and ungated. gate.ts decides what it means. */
  hasObj: number
}

export interface ModelInfo {
  loadMs: number
  /** What ORT ACTUALLY used after init, not what we requested. */
  numThreads: number
  proxy: boolean
  crossOriginIsolated: boolean
  inputName: string
}

let pending: Promise<ModelSession> | null = null

/**
 * Load the model once. Concurrent callers share the same promise; a caller
 * after a successful load gets the resolved one back with no work. A FAILED
 * load clears the cache so a later retry (offline on first open, then online)
 * can actually retry rather than replaying the rejection forever.
 */
export function loadModel(): Promise<ModelSession> {
  if (!pending) {
    pending = createSession().catch((err) => {
      pending = null
      throw err
    })
  }
  return pending
}

/** Test/teardown hook — drops the cached session promise. */
export function resetModel(): void {
  pending = null
}

async function createSession(): Promise<ModelSession> {
  const t0 = performance.now()
  // Dynamic, by URL: the bundle is a public asset (so it can resolve its own
  // .wasm sibling), not a dependency Vite may inline or hash.
  const mod = (await import(/* @vite-ignore */ scanAssetUrl(ORT_BUNDLE))) as { default?: OrtModule }
  const ort = (mod.default ?? (mod as unknown)) as OrtModule

  const coi = typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated
  const threadsPossible = coi && typeof SharedArrayBuffer !== 'undefined'
  ort.env.wasm.simd = true
  ort.env.wasm.proxy = true
  ort.env.wasm.numThreads = threadsPossible
    ? Math.min(4, Math.max(1, Math.floor((navigator.hardwareConcurrency || 1) / 2)))
    : 1

  const session = await ort.InferenceSession.create(scanAssetUrl(MODEL_FILE), {
    executionProviders: ['wasm'], // NEVER 'webgpu' / 'webnn'
    graphOptimizationLevel: 'all',
  })

  const inputName = session.inputNames[0] ?? 'img'
  const outNames = session.outputNames
  const pointsName = outNames.find((n) => /point/i.test(n)) ?? outNames[0]
  const hasObjName = outNames.find((n) => /obj/i.test(n)) ?? outNames[1]

  const info: ModelInfo = {
    loadMs: performance.now() - t0,
    numThreads: ort.env.wasm.numThreads,
    proxy: ort.env.wasm.proxy,
    crossOriginIsolated: coi,
    inputName,
  }

  return {
    info,
    async run(input: Float32Array): Promise<ModelResult> {
      // A FRESH Tensor over a FRESH Float32Array, every call. With
      // env.wasm.proxy = true ORT transfers the backing ArrayBuffer to the
      // proxy worker as a transferable, detaching it here; a reused buffer
      // throws `DataCloneError: ... An ArrayBuffer is detached and could not
      // be cloned` on the second run. preprocess.rgbaToBGRPlanar allocates the
      // array; this wraps it and hands ownership away.
      const tensor = new ort.Tensor('float32', input, MODEL_INPUT_DIMS)
      const out = await session.run({ [inputName]: tensor })
      const points = out[pointsName]?.data
      const hasObj = out[hasObjName]?.data?.[0]
      return {
        points: points instanceof Float32Array ? points : new Float32Array(8),
        hasObj: typeof hasObj === 'number' ? hasObj : 0,
      }
    },
  }
}
