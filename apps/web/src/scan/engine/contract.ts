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
  /**
   * THE CANONICAL FRAME — always CANONICAL_SIZE square (frame.ts). Every quad in
   * this state, and the reticle, are in these coordinates.
   *
   * ── THE WORKING-FRAME INVARIANT (owner ruling, 2026-09-04) ────────────────
   *
   * A display change — the photo window's height, the card list growing, the
   * device rotating — must NEVER change what detection sees. The canonical frame
   * is therefore a PURE FUNCTION OF THE CAMERA STREAM: the centre square of the
   * sensor image at one fixed resolution, with no layout, CSS, camera-box or
   * viewport input anywhere in its derivation.
   *
   * The dependency runs one way only: the DISPLAY reads the canonical frame and
   * shows whatever window of it it likes. The canonical frame never reads the
   * display. `__tests__/frame-invariant.test.ts` enforces both halves — the
   * dimensions depend only on stream dimensions, and the frame-derivation
   * modules may not import from the UI layer at all.
   */
  frame: EngineFrame
  /** The camera stream's own dimensions, recorded so a consumer can map a
   *  canonical quad back to sensor pixels (frame.canonicalQuadToStream). NOT an
   *  input to anything above — see the invariant on `frame`. */
  stream: EngineFrame
  /** Reticle rect as fractions of the CANONICAL frame: what the user aims at,
   *  and the rect a tracked quad must sit inside to be shown. A constant — a
   *  fixed top/bottom margin with the width set by this game's card aspect
   *  (frame.reticleForAspect). */
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
  /**
   * Rectify the given track's quad from the frame it was MEASURED on (not the
   * live video — see index.ts's capA/capB), warping at full sensor resolution.
   *
   * NOTE there is deliberately no `setViewport` here any more. The reticle used
   * to be derived from the rendered camera box; under the working-frame
   * invariant on `EngineState.frame` it is a constant of the canonical square,
   * so the engine has no interest in the display's dimensions at all.
   */
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
  /** Minimum opposite-side ratio for a lock — the straddle gate (default 0.72,
   *  index.DEFAULT_LOCK_PARALLEL_MIN). 0 disables it. */
  lockParallelMin?: number
  /** Minimum mean colour saturation inside a locked quad — THE CARD SIGNATURE
   *  (default 0.16, index.DEFAULT_LOCK_MIN_SATURATION). The one non-geometric
   *  lock gate, and it exists because a postal envelope is genuinely
   *  card-shaped and card-proportioned. 0 disables it. */
  minSaturation?: number
  /**
   * THE PER-GAME PARAMETER: this card game's width/height (Pokémon 63:88 =
   * 0.71591, the default).
   *
   * Everything else in the frame spec is universal — the canonical square and
   * the standardized top/bottom margin (frame.ts) — because those must feel the
   * same in every game. The aspect is what differs, so it is threaded rather
   * than hardcoded: it sets the reticle's WIDTH, the rectified output's shape,
   * and the lock policy's aspect prior. A new TCG supplies this one number.
   */
  cardAspect?: number
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
