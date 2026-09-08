// What the LIVE detector did with this frame, reduced to one verdict — the
// whole point of the sweep mode in CaptureStage.
//
// ── THE QUESTION THIS ANSWERS ───────────────────────────────────────────────
//
// The labeler's own seed (detectSeed.ts) answers "what does the detector
// propose for the frame I just froze". That is the right question when the
// frame already has a card in it. It is the wrong question when the reader is
// walking around a room pointing the phone at a doorframe, a laptop lid and a
// cereal box, because what they want to know then is the opposite: which of
// these does the SHIPPING PIPELINE mistake for a card, and how far does the
// mistake get before something stops it?
//
// "How far it gets" is the useful axis, because the pipeline has five places
// to say no and they fail for completely different reasons. A quad the
// presence head scores 0.42 is a near-miss worth a `not_a_card` label; a quad
// that sails through the gate and dies on the reticle post-filter is not a
// detector problem at all (the reader simply was not aiming at it); a quad
// that reaches the lock and dies on saturation is the postal-envelope case
// `DEFAULT_LOCK_MIN_SATURATION` exists for. Labelling all three as "false
// positive" would throw away the only thing that distinguishes them.
//
// ── WHY IT IS A PURE FUNCTION OF EngineState ────────────────────────────────
//
// Everything here is derived, never measured: the engine already computed all
// of it and this only names the stage. That keeps the readout honest (it can
// only ever describe the shipping pipeline, because it has no pipeline of its
// own to disagree with) and it makes the whole thing testable without a
// camera, a model or a DOM — see __tests__/sweep.test.ts.
import type { EngineState } from '../engine/contract'

/**
 * How far this frame's best proposal travelled. Ordered: each stage strictly
 * contains the next.
 *
 *  `none`      the model emitted no decodable quad at all
 *  `proposed`  corners exist, but the presence gate refused them
 *  `gated`     through the gate and refined — the tracker was offered this
 *  `tracked`   inside the reticle, so the product WOULD HAVE DRAWN it
 *  `locked`    a capture candidate: the product would have auto-fired
 */
export type SweepStage = 'none' | 'proposed' | 'gated' | 'tracked' | 'locked'

/** The stage that stopped it, or null when nothing did (i.e. it locked). */
export type SweepRejector = 'no-quad' | 'presence-gate' | 'reticle' | 'lock' | null

export interface SweepVerdict {
  stage: SweepStage
  rejectedBy: SweepRejector
  /** Raw presence head, ungated — the number the `presence-gate` rejection is
   *  about, and the one worth a histogram. */
  hasObj: number
  /** The acquire threshold in force, recorded WITH the value it judged so a
   *  later re-tune cannot rewrite what this row meant. */
  acquire: number
  hold: number
  /** Mean colour saturation of the track being reported on, when there is one.
   *  Null is "nothing was measured", never "zero". */
  saturation: number | null
  minSaturation: number
  /** Quads the tracker was offered this tick (post-gate, post-refine). */
  observed: number
  /** Live tracks — what the product would be drawing right now. */
  tracked: number
  detectMs: number
  hz: number
}

/**
 * Reduce one engine tick to its verdict.
 *
 * THE ORDER OF THE TESTS IS THE PIPELINE'S OWN ORDER, deliberately, and reading
 * it top to bottom is meant to be the same as reading `engine/index.ts`'s tick.
 * A rejection is attributed to the FIRST stage that could have caused it, which
 * is why `locked` is checked before `tracked` and so on downward rather than
 * building the answer up from `none`.
 */
export function sweepVerdict(state: EngineState): SweepVerdict {
  const tracked = state.stable.length + state.pending.length
  const observed = state.observed.length

  let stage: SweepStage
  let rejectedBy: SweepRejector
  if (state.locked) {
    stage = 'locked'
    rejectedBy = null
  } else if (tracked > 0) {
    // Tracked but not locked. The lock policy is the only thing left that could
    // have refused it — aspect, straddle, saturation or simply not enough
    // consecutive ticks yet. `lock` covers all four on purpose: they are one
    // decision (`createLockPolicy`) and the readout would be lying to imply it
    // can tell which clause fired without the policy reporting it.
    stage = 'tracked'
    rejectedBy = 'lock'
  } else if (observed > 0) {
    // The detector produced a refined quad and the tracker kept none of it.
    // `tracker.passesReticle` is the only filter between those two facts.
    stage = 'gated'
    rejectedBy = 'reticle'
  } else if (state.ungated) {
    // Corners exist; the presence head is what refused them. THE MOST
    // INTERESTING ROW IN A ROOM SWEEP — this is "the model does think something
    // card-like is here, and was not confident enough to say so".
    stage = 'proposed'
    rejectedBy = 'presence-gate'
  } else {
    stage = 'none'
    rejectedBy = 'no-quad'
  }

  return {
    stage,
    rejectedBy,
    hasObj: state.hasObj,
    acquire: state.thresholds.acquire,
    hold: state.thresholds.hold,
    saturation: state.saturation,
    minSaturation: state.thresholds.minSaturation,
    observed,
    tracked,
    detectMs: state.perf.detectMs,
    hz: state.perf.hz,
  }
}

/**
 * Is this frame worth stopping for?
 *
 * A room sweep is mostly `none`, which is the detector being right and is not
 * training data. Anything that got as far as corners the model half-believes is
 * a candidate for a `not_a_card` / `no_card` label — that is exactly the
 * population the reader asked to be pointed at, rather than labelling whatever
 * happened to be in front of the lens.
 */
export function isNoteworthy(v: SweepVerdict): boolean {
  return v.stage !== 'none'
}

/** One short line for the readout. Written here, next to the rule it
 *  describes, so the words and the logic cannot drift apart. */
export function sweepHeadline(v: SweepVerdict): string {
  switch (v.stage) {
    case 'locked':
      return 'LOCKED — the scanner would fire at this'
    case 'tracked':
      return 'DRAWN — tracked, but not a capture candidate'
    case 'gated':
      return 'DROPPED by the reticle — detected, outside the aim frame'
    case 'proposed':
      return 'NEAR MISS — corners found, presence too low'
    case 'none':
      return 'nothing'
  }
}
