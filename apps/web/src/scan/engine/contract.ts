// The boundary between the scan ENGINE (camera frames -> tracked card quads ->
// rectified captures) and the scan UI (reticle, incoming stack, verify feed).
// Decided 2026-09-02 (DECISIONS.md: "a pretrained corner model replaces
// classical CV"): detection is DocAligner LC050 (WASM, letterboxed BGR/255,
// reticle-cropped input, hysteresis presence gate), polished by the classical
// sub-pixel refiner, displayed through a tracker that must never draw
// anything worse than the model's own output.

export type Quad = [[number, number], [number, number], [number, number], [number, number]]

export interface EngineFrame {
  width: number
  height: number
}

export interface TrackedQuad {
  id: number
  /** Display-space corners (video-native pixels), sub-pixel refined, smoothed. */
  quad: Quad
  /** Consecutive detect ticks this track has been seen. */
  age: number
  /** True while surviving a missed detection inside the grace window; the UI
   *  must render coasting tracks visually distinct (they are a prediction,
   *  not an observation) — the tracker never coasts past its grace. */
  coasting: boolean
}

export interface EngineState {
  frame: EngineFrame
  /** Reticle rect as fractions of the frame; the engine crops inference to it. */
  reticle: { x: number; y: number; w: number; h: number }
  /** Presence-head value for the latest inference (raw, ungated). */
  hasObj: number
  /** Gated + tracked quads: what the UI may draw. */
  stable: TrackedQuad[]
  pending: TrackedQuad[]
  /** A stable, non-coasting track centered in the reticle for >= lockTicks:
   *  the capture candidate. Null otherwise. */
  locked: TrackedQuad | null
  perf: { detectMs: number; hz: number; jitterPx: number }
}

export interface CaptureResult {
  /** Fronto-parallel JPEG (63:88, ~480px wide) rectified from the locked quad —
   *  the body for POST /scan. */
  blob: Blob
  quad: Quad
  /** Track id, so the UI can refractory-dedupe re-presentations of the card. */
  trackId: number
}

export interface ScanEngine {
  /** Loads the model lazily (idempotent). Resolves when inference is ready. */
  ready(): Promise<void>
  /** Begin the detect loop against a playing video element. */
  start(video: HTMLVideoElement): void
  stop(): void
  /** Subscribe to per-detect-tick state. Returns unsubscribe. */
  onState(cb: (s: EngineState) => void): () => void
  /** Rectify the given track's current quad from the live frame. */
  capture(trackId: number): Promise<CaptureResult>
}

export interface EngineOptions {
  /** Acquire/hold hysteresis on hasObj; defaults 0.8 / 0.3 (measured: buys
   *  44% of false quads for 7% of acquisitions — PHASE0-CLOSEOUT.md). */
  acquire?: number
  hold?: number
  /** Detect cadence floor in ms (default 120; engine stretches when slow). */
  cadenceMs?: number
  /** Consecutive ticks before a stable track can lock (default 3). */
  lockTicks?: number
}

export type CreateScanEngine = (opts?: EngineOptions) => ScanEngine
