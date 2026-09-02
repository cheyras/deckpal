// Hysteresis on LC050's presence head.
//
// PHASE0-CLOSEOUT §2.7 measured has_obj across 199 live frames and found the
// separation clean at the extremes with the ENTIRE error population living in
// 0.35-0.65 — "a single-frame threshold at 0.5 is measurably the wrong
// instrument". Sized against that distribution:
//
//   policy                   TP frames acquire  false quads acquire  rejections silent
//   single 0.5 (the probe)      97/97               27/27               56/56
//   acquire 0.65 / hold 0.35    93/97               19/27               44/56
//   acquire 0.80 / hold 0.30    90/97               15/27               41/56   <- shipped
//   acquire 0.90 / hold 0.25    84/97               11/27               38/56
//
// So the default buys ~44% of the false quads for ~7% of acquisitions.
//
// WHAT IT DOES NOT DO, stated here so nobody re-tunes it hoping otherwise: it
// does not rescue misses. The 9 measured misses sit at has_obj 0.001-0.365,
// below any hold threshold that still keeps the rejections silent. The misses
// need the reticle crop or a presence-head fine-tune, not a better threshold —
// and a miss draws NOTHING, which is the safe failure direction, costing one
// detect tick (PHASE0-CLOSEOUT §2.7).

/** Defaults from PHASE0-CLOSEOUT §2.7's sizing table; also the defaults
 *  EngineOptions documents. */
export const DEFAULT_ACQUIRE = 0.8
export const DEFAULT_HOLD = 0.3

export interface PresenceGate {
  /** Feed one inference's raw has_obj; returns whether the gate is now OPEN
   *  (i.e. this tick's quad may be trusted and passed to the tracker). */
  update(hasObj: number): boolean
  /** Current state without advancing it. */
  readonly open: boolean
  reset(): void
}

/**
 * Two-threshold latch. CLOSED opens only at `hasObj >= acquire`; OPEN stays
 * open while `hasObj >= hold` and closes below it. Between the two thresholds
 * the previous state persists — that band, 0.3..0.8, is where every measured
 * error lives, so "what did the last frame think" is a better answer there
 * than the number itself.
 *
 * A non-finite has_obj (no inference yet, or an inference that failed) closes
 * the gate: absence of evidence is not evidence of a card.
 */
export function createPresenceGate(acquire = DEFAULT_ACQUIRE, hold = DEFAULT_HOLD): PresenceGate {
  // A hold above acquire would make the "latch" a plain threshold with a
  // surprising sign; clamp rather than silently misbehave.
  const acq = Number.isFinite(acquire) ? acquire : DEFAULT_ACQUIRE
  const hld = Math.min(Number.isFinite(hold) ? hold : DEFAULT_HOLD, acq)
  let open = false
  return {
    update(hasObj: number): boolean {
      if (!Number.isFinite(hasObj)) {
        open = false
        return false
      }
      open = open ? hasObj >= hld : hasObj >= acq
      return open
    },
    get open() {
      return open
    },
    reset() {
      open = false
    },
  }
}
