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

// ── THE 6 s DEADLINE THAT USED TO LIVE HERE, AND THE RULING THAT ENDED IT ───
//
// `IDENTITY_DEADLINE_MS = 6_000` stood in this file until 2026-09-07. It decided
// when a thumbnail that was still waiting stopped waiting and ASKED THE READER,
// it was sized as headroom over the OCR branch's projected 2.8-5.4 s, and its
// own doc said in as many words that it was "NOT final": a confident answer
// arriving at 7 s still promoted the thumbnail and flew it down.
//
// Round 10b measured what that costs once the image rung is actually in the loop
// (`p2-work/e2e-drive/E2E-REPORT.md` §3.3). `msToResolve` p50 moved from round
// 10's 678-1 269 ms to 4 283-6 001 ms, and SIX OF THIRTY-ONE CAPTURES crossed
// the 6 s deadline while their embed was still in flight. Each one flipped to
// needs-you, flew down as an amber "needs your input" row — and then upgraded
// itself when the late answer landed. `r10bs59`'s third capture did exactly
// that: `needs-you` at +91.7 s, `confident-resolve` at +92.0 s, two machine
// records for one capture, and a row the reader watched change its mind.
//
// The owner ruled on it, verbatim: "it should NOT [land] as needs you and then
// upgrade itself. If it isn't totally resolved, it stays in the side. That's the
// point of the side."
//
// So needs-you is not a timeout any more. It means THE SYSTEM IS FINISHED
// TRYING, and `identity.ts` settles on "every signal that was actually started
// has reported, and none of them named the card". In the ordinary failure — a
// card back, a blurred crop — that is reached WELL INSIDE the old 6 s, because
// both answers are already in and both said no; the common case got faster, not
// slower. What is left in this file is the other half of the old constant's job,
// and only that half: the guarantee that a hung request cannot park a thumbnail
// on the camera forever.

/**
 * THE HARD BACKSTOP ON ONE CAPTURE'S IDENTITY RACE. A fuse, not a verdict.
 *
 * Everything at the top of this file distinguishes "slow" from "never" for one
 * await. This does it for the whole race: at `IDENTITY_BACKSTOP_MS` after the
 * shutter, whatever has not reported is TREATED AS FAILED and the capture
 * settles needs-you, finally. Nothing promotes it afterwards (`identity.ts`
 * makes every settled phase terminal), so this is the one number that decides
 * how long a thumbnail can spin.
 *
 * ── THE ARITHMETIC, FROM ROUND 10b's MEASURED TAILS ─────────────────────────
 *
 * The worst HONEST chain is the second-answer leg, and it is two round trips
 * deep because the narrowing cannot start until the vector has settled:
 *
 *   the embed      8 000 ms  `EMBED_TIMEOUT_MS` (vectorEvidence.ts), and it is
 *                            anchored at the SHUTTER rather than at the moment
 *                            the resolve is ready to fire. Round 10b §3.1
 *                            measured 29 in-app embeds at min 860 / p50 4 202 /
 *                            p90 6 071 / max 6 363 ms of wall latency (the
 *                            telemetry's own `embedMs` max was 5 992), with 2 of
 *                            31 blowing the budget outright. 8 s is therefore
 *                            the longest this side will EVER hold for a vector —
 *                            it is a client-side budget, not a hope.
 *   the resolve    4 000 ms  `POST /scan/resolve`, which starts only once the
 *                            embed above has settled. Round 10b's `msToResolve`
 *                            ran p50 4 283-6 001 ms with a max of 6 255 ms
 *                            against embeds whose own p50 was 4 202 ms, so the
 *                            observed remainder is roughly 1-2 s; §3.2 measured
 *                            `/api/scan` itself stretching to 4 847 ms once the
 *                            two routes share a serverless instance. 4 s is that
 *                            tail with the same "slowest we have seen" margin
 *                            the embed budget was written under.
 *
 *   8 000 + 4 000 = 12 000.
 *
 * ── THE TWO THINGS IT DELIBERATELY DOES NOT FIT INSIDE ─────────────────────
 *
 *  * `IDENTIFY_TIMEOUT_MS` (15 s) is LONGER than this, on purpose. That is a
 *    recovery deadline for a socket that may be dead; this is a promise to the
 *    reader. A capture whose identify is still out at 12 s has already lost the
 *    answer that would have mattered — round 10b's slowest `/api/scan` was
 *    4 847 ms, a third of this — and the backstop is precisely what stops the
 *    thumbnail waiting on it.
 *  * `OCR_NARROW_TIMEOUT_MS` (ocrNarrow.ts, 20 s) is longer too, and it stays
 *    that way for the reason stated there: it exists to release a WASM worker,
 *    not to decide a thumbnail. This is still NOT a cancellation — nothing is
 *    aborted here, the work is simply no longer being waited for.
 *
 * WHAT WOULD MOVE IT: another round's embed and resolve tails. This number is
 * two measured budgets added together, so it moves when either one does.
 */
export const IDENTITY_BACKSTOP_MS = 12_000

/**
 * The resolve half of the sum above, named so the arithmetic is a thing a test
 * can assert rather than prose that can drift from the constant beside it. See
 * `__tests__/identity.test.ts`, "the backstop covers the worst honest chain".
 */
export const RESOLVE_RTT_TAIL_MS = 4_000

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
