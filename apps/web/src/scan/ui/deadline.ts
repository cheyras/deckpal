// Deadlines for the capture pipeline.
//
// WHY THIS FILE EXISTS — the "Got it — hang on…" wedge, 2026-09-03 field test.
//
// `Scan.tsx`'s auto-capture holds a single boolean, `captureBusyRef`, for the
// whole of capture -> stack -> identify -> feed, and clears it in a `finally`.
// That is correct only if every await inside can actually settle. Three of them
// could not:
//
//   1. `api.scan(...)` was called with NO AbortSignal, and `lib/api.ts`'s
//      `request()` sets no default deadline. A stalled connection — a phone
//      moving between wifi and cell, a captive portal, a proxy holding the
//      socket — leaves that fetch pending indefinitely. `handleCaptured` awaits
//      it, so `runCapture`'s `finally` never runs, `captureBusyRef` never
//      clears, and auto-capture is dead for the REST OF THE SESSION while the
//      hint sits on "Got it — hold on…" forever. One stalled request, one
//      permanently broken scanner, no error and no way back but a reload.
//
//   2. `nextFrame()` waits on two nested `requestAnimationFrame`s. rAF does not
//      fire in a backgrounded tab, and a phone screen locking mid-capture — or
//      the user glancing at a notification — backgrounds it. The capture then
//      resumes only if the user comes back, and the same wedge holds until they
//      do.
//
//   3. The flight animations (`flyArc`, `bump`) await `anim.finished`, which is
//      also suspended while the document is hidden.
//
// So every await in that path now carries a deadline, and the outermost call
// carries a backstop deadline of its own. The rule this file encodes: NOTHING
// on the capture path may await something that has no worst case.
//
// These are RECOVERY deadlines, not performance targets. They are deliberately
// far longer than a healthy round trip (identify is ~1-2 s on the owner's
// device) because their job is to distinguish "slow" from "never", and firing
// early would turn a merely slow network into a failed capture.

/** A capture's identify round trip. Generous: this is the "never" detector. */
export const IDENTIFY_TIMEOUT_MS = 15_000

/** Backstop on the WHOLE capture pipeline, including both flights and the
 *  identify call. Must exceed IDENTIFY_TIMEOUT_MS or it would pre-empt the more
 *  specific error and report the wrong cause. */
export const CAPTURE_TIMEOUT_MS = 25_000

/** How long a paint wait may block before the pipeline gives up on rAF and
 *  proceeds. A missed frame costs an animation's start pose, never a capture. */
export const FRAME_TIMEOUT_MS = 500

export class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${Math.round(ms / 1000)}s`)
    this.name = 'TimeoutError'
  }
}

/**
 * Reject with a `TimeoutError` if `p` has not settled within `ms`.
 *
 * The underlying work is NOT cancelled — callers that can cancel (a fetch with
 * an AbortSignal) should do that too; this is the guarantee that the AWAIT ends
 * regardless of whether the work does.
 */
export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms)
    p.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e as Error)
      },
    )
  })
}

/** An AbortController that fires by itself after `ms`. Returned with its own
 *  disposer so a completed request stops holding a pending timer. */
export function deadlineSignal(ms: number): { signal: AbortSignal; done: () => void } {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(new TimeoutError('request', ms)), ms)
  return { signal: ac.signal, done: () => clearTimeout(timer) }
}

/**
 * `Scan.tsx`'s two-rAF "the frame I just committed has painted" wait, made
 * unhangable: whichever of the paint or the timeout arrives first wins.
 *
 * Resolves (never rejects) — a capture must not FAIL because an animation could
 * not measure a rect. The consequence of the timeout branch is a courier that
 * starts from a slightly stale pose, which is invisible next to the alternative.
 */
export function nextFrameSafe(ms: number = FRAME_TIMEOUT_MS): Promise<void> {
  return new Promise<void>((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(finish, ms)
    // `requestAnimationFrame` is absent under node (unit tests) and during SSR;
    // the timer alone is then the whole implementation, which is correct.
    const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : null
    if (raf) raf(() => raf(finish))
  })
}

/** Await an animation-ish promise but never longer than `ms`, and never throw:
 *  a flight that could not finish is a cosmetic loss, not a capture failure. */
export async function settleWithin(p: Promise<unknown>, ms: number): Promise<void> {
  try {
    await withTimeout(p, ms, 'animation')
  } catch {
    // reduced-motion, a cancelled animation, or a hidden document — all fine.
  }
}
