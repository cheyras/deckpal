// The boundary between the scan ENGINE (camera frames -> tracked card quads ->
// rectified captures) and the scan UI (reticle, incoming stack, verify feed).
// Decided 2026-09-02 (DECISIONS.md: "a pretrained corner model replaces
// classical CV"): detection is DocAligner LC050 (WASM, letterboxed BGR/255,
// hysteresis presence gate), polished by the classical sub-pixel refiner,
// displayed through a tracker that must never draw anything worse than the
// model's own output.
//
// That decision also cropped inference to the reticle; measurement over phase
// 0b's live frames reversed it (index.ts INFERENCE_RECT). The reticle survives
// as the aiming guide and as the tracker's post-filter, which is all this
// boundary ever promised of it.

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
  /**
   * The LATEST RAW OBSERVATION for this track — the refined quad the detector
   * actually measured on the most recent tick that matched it — or null while
   * coasting, when by definition there was no observation.
   *
   * `quad` above is the DISPLAY pose: an EMA across several ticks, deliberately
   * lagged for the eye's benefit, and therefore a blend corresponding to no
   * single frame. That is right for drawing and wrong for warping. `capture()`
   * pairs THIS with the frame the same tick read, so the homography is solved
   * between two things that describe one instant.
   */
  raw: Quad | null
}

export interface EngineState {
  frame: EngineFrame
  /** Reticle rect as fractions of the frame: what the user aims at, and the
   *  rect a tracked quad must sit inside to be shown. NOT the inference input —
   *  the model sees the whole frame (index.ts INFERENCE_RECT). */
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
  /**
   * Tell the engine the CSS size of the box the video is rendered into, so the
   * reticle can be fitted inside the part of the frame the user can actually
   * see rather than inside the whole frame.
   *
   * Not optional in spirit: without it the reticle is computed against the full
   * frame while the UI renders that frame with `object-fit: cover`, and on a
   * portrait stream in a landscape box the reticle's top and bottom edges land
   * off-screen — which also silently widens the tracker's gate to 1.33x the
   * visible height (geometry.visibleRect). Pass null to go back to whole-frame
   * behaviour (the offline harness does).
   */
  setViewport(box: { width: number; height: number } | null): void
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
  /**
   * How far a locked candidate's aspect may sit from a card's own 63:88 before
   * it is refused as a capture candidate, as a RATIO either way (default 0.28,
   * i.e. 0.78x..1.28x of 0.7159 => 0.56..0.92).
   *
   * This is a LOCK filter, not a display filter: a quad that fails it is still
   * tracked and still drawn, so the user sees what the engine found and the
   * failure mode is "it will not auto-fire at this", never a blank screen. Sized
   * offline against the phase-0b corpus — see __tests__/clutter-lock.ts.
   */
  lockAspectTol?: number
}

export type CreateScanEngine = (opts?: EngineOptions) => ScanEngine
