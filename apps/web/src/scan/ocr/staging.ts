// WHEN THE 15.6 MB IS ALLOWED TO START DOWNLOADING.
//
// The rule is one sentence — "not until the camera is live and the detector is
// ready" — and it is here as its own module rather than as an `if` inside
// `Scan.tsx` for the reason `scan/ui/regions.ts` gives at length about the
// captured-region policy: a rule that lives inside a React component can only be
// tested by a re-implementation of itself, and a re-implementation can agree
// with its test while disagreeing with the product.
//
// ── WHY THE ORDER MATTERS ───────────────────────────────────────────────────
//
// `engine/model.ts` fetches 19 MB (LC050 + the ORT runtime) on the scanner's
// first `ready()` call. This lane wants 15.6 MB more. Started together on a
// phone's uplink they are one 35 MB download and the detector — the thing that
// draws the quad and decides when to fire — finishes when the OCR weights do.
// Started in sequence, the scanner is usable at the 19 MB mark exactly as it is
// today, and the OCR lane arrives during the seconds the reader spends framing
// the first card.
//
// REPORT.md §6.3's shape for the whole feature is "fire the capture and the
// existing phash query immediately, run OCR in parallel, let it narrow the
// candidate list when it lands". Staging is the load-time half of that: OCR is
// never something anything waits for.
//
// ── AND WHY IT FIRES EXACTLY ONCE ───────────────────────────────────────────
//
// `useScanEngine`'s status can reach 'ready' more than once — the hook restarts
// the engine whenever `active` flips, which happens every time the reader moves
// between the scan step and the verify step. `loadOcrSession` is itself
// idempotent, so a second call is harmless, but "harmless" is a property of the
// callee that this gate should not be relying on.

export interface OcrStageInputs {
  /** The feature flag (`scan/ui/flags.ts`'s `OCR_ENABLED`). */
  enabled: boolean
  /** Is the DETECTOR ready — i.e. has the camera produced frames and has LC050
   *  loaded? `useScanEngine`'s `status === 'ready'`. */
  detectorReady: boolean
}

export interface OcrStage {
  /** Feed the current state. Returns true on the tick that fired the load. */
  update(inputs: OcrStageInputs): boolean
  /** Has the load been kicked off? */
  readonly started: boolean
}

/**
 * A one-shot gate: calls `start` the first time the flag is on AND the detector
 * is ready, and never again.
 */
export function createOcrStage(start: () => void): OcrStage {
  let started = false
  return {
    update({ enabled, detectorReady }) {
      if (started || !enabled || !detectorReady) return false
      started = true
      start()
      return true
    },
    get started() {
      return started
    },
  }
}
