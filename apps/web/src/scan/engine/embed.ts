// The identity embedder, on the phone.
//
// The detector's session manager (./model.ts) is the reference for everything
// mechanical here — WASM-only bundle, `executionProviders: ['wasm']`, proxy
// worker, lazy and idempotent load, a fresh Float32Array per run because ORT
// detaches the one it is handed. Read that file's header for WHY each of those
// is load-bearing; every reason it gives applies unchanged to this model, and
// repeating them here would only create a second place for them to drift.
//
// What is DIFFERENT is worth stating, because the two models are easy to
// conflate now that both live in this directory:
//
//   * DIFFERENT CADENCE. LC050 runs on the live video at ~8 fps. This runs
//     ONCE PER CAPTURE, on a card the tracker has already decided is stable —
//     two or three times per card when multi-frame exemplars are being
//     collected, and never on a frame the reader has not effectively chosen.
//     So its latency budget is a fraction of a second of the reader's own
//     pause, not a slice of a frame interval, and it is not on the critical
//     path of anything that has to feel smooth.
//
//   * DIFFERENT TENSOR. LC050 wants BGR planar and a plain /255 with no
//     mean/std (a mismatch there cost phase 0b session 1 an entire evening).
//     This wants RGB planar and CLIP's mean/std. Neither module assumes a house
//     convention; each states its own, and this one does not even own the
//     statement — `@deckpal/matching` does, because the catalogue side has to
//     agree with it to the bit and a copy here would be the drift.
//
//   * DIFFERENT SOURCE PIXELS. The detector looks at the canonical square
//     (frame.ts). This looks at the RECTIFIED CARD (rectify.ts) — the same
//     480x670 warp that goes to /scan — with the capture margin cropped back
//     off, so the phone and the catalogue embedder are looking at the same
//     thing. `CAPTURE_MARGIN` is passed rather than assumed for exactly that
//     reason: if the capture margin ever changes, this changes with it.
//
// The model is loaded LAZILY AND SEPARATELY from the detector's. A reader who
// opens the scanner and never captures anything should not pay for this
// download, and a failure to load it must degrade to the hash path rather than
// break detection — which is why `loadEmbedModel()` rejects and nothing here
// catches on its behalf.

import { EMBED_SIZE, embedInput, embedStamp, l2Normalize } from '@deckpal/matching'
import { CAPTURE_MARGIN } from './rectify'
import { scanAssetUrl } from './model'
import type { ImageDataLike } from './geometry'

/** 1 x 3 x SIZE x SIZE, NCHW. The shape `@deckpal/matching` produces flat. */
export const EMBED_INPUT_DIMS = [1, 3, EMBED_SIZE, EMBED_SIZE] as const

const ORT_BUNDLE = 'ort.wasm.min.mjs'
const MODEL_FILE = 'identity.onnx'

/** Structural subset of onnxruntime-web, duplicated from ./model.ts for the
 *  reason that file gives: the module is loaded from a URL at runtime, so there
 *  is no package to import types from. */
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

export interface EmbedSession {
  /** A rectified card (rectify.ts output, margin included) -> a unit vector. */
  embed(card: ImageDataLike): Promise<Float32Array>
  readonly info: EmbedModelInfo
}

export interface EmbedModelInfo {
  loadMs: number
  /** The stamp every vector this session produces belongs to. Sent with the
   *  match request so the server can refuse a mismatch outright rather than
   *  compare across vector spaces. */
  stamp: string
  dim: number
}

let pending: Promise<EmbedSession> | null = null

/**
 * Load once; concurrent callers share the promise; a FAILED load clears the
 * cache so a later retry can actually retry. Same contract as `loadModel()`,
 * and the same reason — the first open is often the offline one.
 */
export function loadEmbedModel(): Promise<EmbedSession> {
  if (!pending) {
    pending = createSession().catch((err) => {
      pending = null
      throw err
    })
  }
  return pending
}

/** Test/teardown hook. */
export function resetEmbedModel(): void {
  pending = null
}

async function createSession(): Promise<EmbedSession> {
  const t0 = performance.now()
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
    executionProviders: ['wasm'], // NEVER 'webgpu' / 'webnn' — see model.ts
    graphOptimizationLevel: 'all',
  })
  const inputName = session.inputNames[0] ?? 'pixel_values'
  const outputName = session.outputNames[0] ?? 'features'

  let dim = 0
  const info: EmbedModelInfo = { loadMs: performance.now() - t0, stamp: embedStamp(), dim }

  return {
    info,
    async embed(card: ImageDataLike): Promise<Float32Array> {
      // A FRESH array every call. `env.wasm.proxy = true` transfers the backing
      // ArrayBuffer to the proxy worker and detaches it here; a reused buffer
      // throws DataCloneError on the second run. embedInput() allocates.
      const input = embedInput(card, { marginFrac: CAPTURE_MARGIN })
      const tensor = new ort.Tensor('float32', input, EMBED_INPUT_DIMS)
      const out = await session.run({ [inputName]: tensor })
      const data = out[outputName]?.data
      if (!(data instanceof Float32Array) || data.length === 0) {
        throw new Error('identity model returned no features')
      }
      if (!dim) {
        dim = data.length
        info.dim = dim
      }
      // Normalise HERE, not at the server: the API refuses an un-normalised
      // vector rather than fixing one, because a client that is not following
      // the spec should fail loudly on its first request and not on its
      // hundredth (apps/api/src/scan/embedMatch.ts, parseEmbedding).
      return l2Normalize(Float32Array.from(data))
    },
  }
}
