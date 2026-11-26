// THE FOCUS GATE: an auto-capture waits for a sharp tick of the card it is
// about to take.
//
// The owner's 2026-11-25 session on deckpal.app fired 5 of 17 auto-captures on
// blurred frames, and every one of them failed to identify. The lock was
// steady, which is all the old policy asked. Steady is not sharp: the camera
// hunts focus for a moment after a card arrives, and a hand still drifts.
// `EngineState.sharpness` (engine/sharpness.ts) measures it, and on that session
// it put the blurred captures at 101-259 and the sharp ones at 375-1403.
//
// THE RULE, per track, on its lock ticks:
//   * READY when this tick is at least FOCUS_FLOOR AND at least
//     FOCUS_NEAR_BEST of the sharpest tick the track has shown in the last
//     FOCUS_WINDOW_MS. The floor refuses the blurred frames outright. The
//     relative half refuses a passing smear on a card already seen sharp.
//   * Or, once the track has been locked FOCUS_MAX_WAIT_MS, READY on any tick
//     within FOCUS_SETTLE_NEAR_BEST of its best. A card with little texture (a
//     basic energy, a card behind a hazy toploader) may never reach the floor,
//     and it must still be captured, on its best frame and only a little late.
//   * A tick with no measurement (null) never holds a capture: the gate only
//     refuses what it has measured.
//
// Manual captures do not pass through here. The reader pressing the button is
// the reader deciding the frame is good enough.

/** Laplacian variance in the engine's canonical frame (engine/sharpness.ts).
 *  2026-11-25 field session: blurred captures 101-259, sharp 375-1403. */
export const FOCUS_FLOOR = 300
/** A tick must be this fraction of the track's recent best. */
export const FOCUS_NEAR_BEST = 0.7
/** After FOCUS_MAX_WAIT_MS, a tick this close to the best is taken anyway. */
export const FOCUS_SETTLE_NEAR_BEST = 0.85
export const FOCUS_MAX_WAIT_MS = 1200
/** How far back "the track's recent best" looks. */
export const FOCUS_WINDOW_MS = 2000
/** A lock that lapses for longer than this starts its wait again. */
const LOCK_GAP_MS = 600

export interface FocusVerdict {
  /** This tick is sharp enough to capture. */
  ready: boolean
  /** Locked and refused for focus: the UI says "hold still". */
  waiting: boolean
}

export interface FocusGate {
  /** One lock tick of `trackId`. Call on every lock tick, captured or not. */
  judge(trackId: number, sharpness: number | null, now: number): FocusVerdict
  /** Forget tracks that are gone. */
  prune(present: ReadonlySet<number>): void
}

interface TrackFocus {
  lockedSince: number
  lastTick: number
  history: { t: number; s: number }[]
}

export function createFocusGate(): FocusGate {
  const tracks = new Map<number, TrackFocus>()
  return {
    judge(trackId, sharpness, now) {
      let t = tracks.get(trackId)
      if (!t || now - t.lastTick > LOCK_GAP_MS) {
        t = { lockedSince: now, lastTick: now, history: t?.history ?? [] }
        tracks.set(trackId, t)
      }
      t.lastTick = now
      if (sharpness == null) return { ready: true, waiting: false }
      t.history = t.history.filter((h) => now - h.t <= FOCUS_WINDOW_MS)
      t.history.push({ t: now, s: sharpness })
      const best = Math.max(...t.history.map((h) => h.s))
      const sharp = sharpness >= FOCUS_FLOOR && sharpness >= FOCUS_NEAR_BEST * best
      const settled = now - t.lockedSince >= FOCUS_MAX_WAIT_MS && sharpness >= FOCUS_SETTLE_NEAR_BEST * best
      const ready = sharp || settled
      return { ready, waiting: !ready }
    },
    prune(present) {
      for (const id of tracks.keys()) if (!present.has(id)) tracks.delete(id)
    },
  }
}
