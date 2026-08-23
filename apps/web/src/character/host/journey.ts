/**
 * Walking someone somewhere, as one plan executed here rather than four turns.
 *
 * ── WHY A PLAN AND NOT A CONVERSATION ────────────────────────────────────────
 *
 * The obvious design for an escort is a turn per hop: he says where he is
 * going, moves, the browser reports back, the model looks at the new page and
 * decides the next hop. That is four full requests to cross two pages, each
 * re-billing the entire prompt, and it makes depth expensive enough that the
 * feature has to be rationed.
 *
 * It is also unnecessary, and the reason is an addressing scheme rather than a
 * trick: the selectors are constructible from ids the data tools return BEFORE
 * anything moves. Given `seriesSlug: mega-evolution, setId: me05`, the whole
 * path — nav row, series card, set row — can be written down without having
 * seen any of those pages. So he emits the journey as one ordered block and
 * this consumes it as a timeline.
 *
 * ── WHAT THIS FILE IS RESPONSIBLE FOR NOT DOING ──────────────────────────────
 *
 * **Never continue blindly.** If a step's landmark does not appear, the
 * sequence STOPS there, reports which step and why, and hands back to the model
 * for a fresh turn. Half a journey narrated as a whole one is the failure mode
 * this whole area exists to prevent.
 *
 * **Never claim a step it did not run.** `ran` accumulates only as steps
 * actually complete, and the result is built from it. A step after a failure
 * contributes nothing at all — not a row, not a mention.
 *
 * **Never fight the reader.** A real click or a real scroll cancels everything
 * remaining. Guided motion that overrides a gesture someone is mid-way through
 * is worse than no guidance.
 *
 * ── TWO THINGS THE PLAN GOT WRONG, BOTH FOUND BY READING THE CODE ────────────
 *
 * 1. **`travelAfterRoute` is not a wait.** The plan says to reuse it as the
 *    bounded wait-for-selector. It does wait — and then, on success, it flies
 *    him in via the background plane and points. Reusing it for `ensure` and
 *    `click` would drag a dramatic two-leg flight behind every step of the
 *    journey. What is reusable is its MutationObserver, and that is what
 *    `waitForLandmark` below is.
 * 2. **A hidden control is still a clickable control.** Below the nav
 *    breakpoint the sidebar is `hidden nav:flex` — the marked links are still
 *    in the DOM, merely `display: none`. `el.click()` on one genuinely
 *    navigates, and `flyTo` would park him against a zero-size rect. So a step
 *    that needs him to be SEEN doing something refuses a target with no box,
 *    and says so, rather than performing an escort that reads as a teleport.
 */
import { runUiTool, type UiToolContext, type UiToolResult } from './uiTools'

/** Mirrors `JOURNEY_VERBS` in `apps/api/src/decke/tools.ts`. */
export const JOURNEY_VERBS = ['say', 'goTo', 'flyTo', 'highlight', 'click', 'ensure'] as const
export type JourneyVerb = (typeof JOURNEY_VERBS)[number]

/** Mirrors `JOURNEY_MAX_STEPS`. Enforced server-side at parse time; re-checked
 *  here because a client that trusts its input is a client with no floor. */
export const JOURNEY_MAX_STEPS = 10

export type JourneyStep = {
  verb: JourneyVerb
  text?: string
  route?: string
  landmark?: string
  byClicking?: string
  point?: boolean
}

export type JourneyRan = { verb: JourneyVerb; target?: string; reason?: string }

export type JourneyFailure = {
  step: number
  verb: JourneyVerb
  target?: string
  why: 'absent' | 'timeout' | 'refused' | 'cancelled' | 'error'
  reason: string
}

export type JourneyResult = {
  ok: boolean
  planned: number
  ran: JourneyRan[]
  failure?: JourneyFailure
}

/**
 * How long a step waits for its landmark before giving up.
 *
 * The same 6 s `travelAfterRoute` uses, and for the same reason: a route
 * renders, then its data resolves, then the list it renders appears — seconds
 * later on a cold cache, and never at all if the page is empty. Unbounded is not
 * an option, because a step that never answers reads as him freezing.
 */
const STEP_WAIT_MS = 6000

/** A landmark that is present AND has a box. See the header, point 2. */
function visibleLandmark(landmark: string): HTMLElement | null {
  let el: Element | null = null
  try {
    el = document.querySelector(landmark)
  } catch {
    return null
  }
  if (!(el instanceof HTMLElement)) return null
  const r = el.getBoundingClientRect()
  return r.width > 0 && r.height > 0 ? el : null
}

/**
 * Wait for a landmark to exist and have a box, bounded.
 *
 * The MutationObserver rather than a poll, because a poll's lag is visible: the
 * whole point of a conditional wait is that a fast page does not pay a slow
 * page's delay.
 */
function waitForLandmark(landmark: string, signal: AbortSignal): Promise<HTMLElement | null> {
  return new Promise((resolve) => {
    const now = visibleLandmark(landmark)
    if (now) return resolve(now)
    if (signal.aborted) return resolve(null)
    const done = (el: HTMLElement | null) => {
      obs.disconnect()
      window.clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      resolve(el)
    }
    const onAbort = () => done(null)
    const obs = new MutationObserver(() => {
      const el = visibleLandmark(landmark)
      if (el) done(el)
    })
    // `attributes` as well as `childList`: a disclosure that toggles a class or
    // an `aria-hidden` rather than mounting a node is the common case for the
    // one thing `ensure` exists to handle, and a childList-only observer sleeps
    // straight through it.
    obs.observe(document.body, { childList: true, subtree: true, attributes: true })
    const timer = window.setTimeout(() => done(null), STEP_WAIT_MS)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/** Wait for the router to actually commit, so a landmark check cannot match the
 *  page he is leaving. */
function waitForRoute(route: string, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (window.location.pathname === route) return resolve(true)
    const t0 = Date.now()
    const id = window.setInterval(() => {
      if (signal.aborted) {
        window.clearInterval(id)
        return resolve(false)
      }
      if (window.location.pathname === route) {
        window.clearInterval(id)
        return resolve(true)
      }
      if (Date.now() - t0 > STEP_WAIT_MS) {
        window.clearInterval(id)
        return resolve(false)
      }
    }, 60)
  })
}

const fail = (
  step: number,
  s: JourneyStep,
  why: JourneyFailure['why'],
  reason: string,
  ran: JourneyRan[],
  planned: number,
): JourneyResult => ({
  ok: false,
  planned,
  ran,
  failure: { step, verb: s.verb, target: s.landmark ?? s.route, why, reason },
})

export type JourneyContext = UiToolContext & {
  /**
   * Say a line out loud, mid-journey.
   *
   * It goes onto the TRANSCRIPT, and the speech bubble is derived from that —
   * the bubble shows the last thing he said while he is out on the page. An
   * earlier version of this comment claimed the opposite, which is the sort of
   * thing that survives review because it sounds right.
   */
  say: (text: string) => void
  /** Held true for the whole sequence, so the route watcher does not undo it. */
  setStepping: (on: boolean) => void
}

/**
 * Run one journey.
 *
 * `signal` is the TURN's AbortController, so Stop halts the sequence and the
 * turn together rather than one of them — a Stop that leaves a character still
 * walking across the page has not stopped anything the reader can see.
 */
export async function runJourney(
  ctx: JourneyContext,
  steps: JourneyStep[],
  signal: AbortSignal,
): Promise<JourneyResult> {
  const planned = steps.length
  const ran: JourneyRan[] = []

  if (!Array.isArray(steps) || steps.length === 0) {
    return { ok: false, planned: 0, ran, failure: { step: 0, verb: 'say', why: 'refused', reason: 'that journey had no steps' } }
  }
  if (steps.length > JOURNEY_MAX_STEPS) {
    // The server refuses this at parse time. Re-checked because a client that
    // trusts its input has no floor of its own, and this one drives clicks.
    return { ok: false, planned, ran, failure: { step: JOURNEY_MAX_STEPS, verb: steps[JOURNEY_MAX_STEPS]?.verb ?? 'say', why: 'refused', reason: 'that journey was too long' } }
  }

  // ── CANCEL ON A REAL GESTURE, AND ONLY A REAL ONE ─────────────────────────
  //
  // `isTrusted` is the whole of this. The sequencer's own `el.click()` produces
  // an untrusted event, so without the check the very first `click` step would
  // cancel the journey it is executing — a bug that would look like "escorting
  // randomly stops working" and would be miserable to find.
  const cancelled = { by: null as string | null }
  const onGesture = (e: Event) => {
    if (!e.isTrusted || cancelled.by) return
    cancelled.by = e.type === 'wheel' || e.type === 'touchmove' ? 'scrolled' : 'clicked'
  }
  const GESTURES = ['pointerdown', 'wheel', 'touchmove', 'keydown'] as const
  for (const g of GESTURES) window.addEventListener(g, onGesture, { capture: true, passive: true })

  ctx.setStepping(true)
  try {
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i]
      if (signal.aborted) return fail(i, s, 'cancelled', 'you stopped me', ran, planned)
      if (cancelled.by) {
        return fail(i, s, 'cancelled', `you ${cancelled.by}, so I left off there`, ran, planned)
      }

      switch (s.verb) {
        case 'say': {
          const text = (s.text ?? '').trim()
          if (!text) return fail(i, s, 'refused', 'that step had nothing to say', ran, planned)
          ctx.say(text)
          ran.push({ verb: 'say', reason: text })
          break
        }

        case 'goTo': {
          const route = s.route ?? ''
          const r = await runUiTool(ctx, 'goTo', { route })
          if (!r.ok) return fail(i, s, 'refused', r.reason ?? 'I could not go there', ran, planned)
          if (!(await waitForRoute(route, signal))) {
            // THE ROUTE, THEN THE LANDMARK. Checking a landmark before the
            // router commits can match the page he is leaving, and the escort
            // then points confidently at the wrong thing.
            //
            // The commit is necessary and NOT sufficient: a route commits, then
            // its data resolves, then the list it renders appears. Every step
            // after this waits for its own landmark, which is what covers the
            // rest of that gap.
            return fail(i, s, 'timeout', `that page did not open`, ran, planned)
          }
          ran.push({ verb: 'goTo', target: route, reason: r.reason })
          break
        }

        case 'ensure': {
          // Idempotent by construction: present, continue; absent, press the
          // thing that reveals it and wait. It is the general answer to a
          // disclosure, a tab or a filter — and without it a pre-made plan has
          // to GUESS whether the one-shot "show the rest" control has been
          // pressed, and fails its wait whichever way it guesses.
          const landmark = s.landmark ?? ''
          if (visibleLandmark(landmark)) {
            ran.push({ verb: 'ensure', target: landmark, reason: 'it was already showing' })
            break
          }
          const opener = s.byClicking ?? ''
          // WAIT FOR THE OPENER TOO, and this was wrong on the first attempt.
          //
          // `goTo` waits for the route to COMMIT, which is a different and much
          // earlier event than the page having its data. So `ensure` arrived
          // while `/series` was still fetching, found neither the grid nor the
          // control that reveals it, and refused instantly with "there is
          // nothing like that on this page" — a fail-stop that was accurate
          // about what it saw and completely wrong about what was happening.
          // Measured: every one of three trial journeys died here.
          //
          // Both halves of an `ensure` are conditional waits, because both are
          // things that appear when the page is ready rather than when the URL
          // changes.
          if (!(await waitForLandmark(opener, signal))) {
            return fail(i, s, 'absent', 'I could not find the control that opens that', ran, planned)
          }
          const r = await runUiTool(ctx, 'click', { selector: opener })
          if (!r.ok) return fail(i, s, 'refused', r.reason ?? 'I could not open that', ran, planned)
          if (!(await waitForLandmark(landmark, signal))) {
            return fail(i, s, 'absent', 'that did not bring up what I expected', ran, planned)
          }
          ran.push({ verb: 'ensure', target: landmark, reason: r.reason ?? 'opened it' })
          break
        }

        case 'flyTo':
        case 'highlight':
        case 'click': {
          const landmark = s.landmark ?? ''
          const el = await waitForLandmark(landmark, signal)
          if (!el) {
            if (cancelled.by || signal.aborted) {
              return fail(i, s, 'cancelled', 'you took over, so I stopped', ran, planned)
            }
            // A landmark that exists but has NO BOX lands here too, which is the
            // hidden-sidebar case: below the nav breakpoint those links are
            // `display: none` but still in the document, so pressing one really
            // navigates while nobody sees anything happen. An escort nobody can
            // watch is not an escort.
            return fail(i, s, 'absent', 'I could not see that on this page', ran, planned)
          }
          const input =
            s.verb === 'flyTo'
              ? { selector: landmark, ...(s.point ? { then: 'point' } : {}) }
              : { selector: landmark }
          const r: UiToolResult = await runUiTool(ctx, s.verb, input)
          if (!r.ok) return fail(i, s, 'refused', r.reason ?? 'that did not work', ran, planned)
          ran.push({ verb: s.verb, target: landmark, reason: r.reason })
          break
        }

        default:
          return fail(i, s, 'refused', `I do not know how to "${String(s.verb)}"`, ran, planned)
      }
    }
    return { ok: true, planned, ran }
  } catch (e) {
    const i = ran.length
    return {
      ok: false,
      planned,
      ran,
      failure: {
        step: i,
        verb: steps[i]?.verb ?? 'say',
        target: steps[i]?.landmark ?? steps[i]?.route,
        why: 'error',
        reason: e instanceof Error ? e.message : 'that did not work',
      },
    }
  } finally {
    for (const g of GESTURES) window.removeEventListener(g, onGesture, { capture: true })
    ctx.setStepping(false)
  }
}
