/**
 * The entrance animation, for content that arrives after its wrapper.
 *
 * ── THE DEFECT THIS EXISTS FOR (issue #49) ───────────────────────────────────
 *
 * `premium.css` §4 attaches the entrance to `.app-content > *` — the route's
 * WRAPPER. That wrapper is `<Content>`, and it mounts immediately, with a
 * `<Spinner>` inside it, while react-query fetches. So on a COLD cache the
 * entrance runs and finishes over a spinner, and the real content appears
 * afterwards with no motion at all.
 *
 * Measured on a cold cache at 428px, signed in, against the live backend:
 *
 *   route     px-rise ended     content appeared     gap
 *   /decks          927ms              6985ms     +6058ms
 *   /series        3691ms              4548ms      +857ms
 *
 * — with zero animations running on the content in either case. That is the
 * whole of issue #49. The motion layer was never missing and never disabled:
 * it was spent before there was anything to introduce. It reads as "no
 * animation" precisely because the animation happened while the page was
 * empty, and it is WORSE on a slow phone, which is where it was reported.
 *
 * ── WHY NOT JUST ANIMATE THE WRAPPER LATER ───────────────────────────────────
 *
 * Because the wrapper also holds the page title and the toolbar, which are on
 * screen during the fetch. Re-running the wrapper's entrance when data lands
 * would fade the heading out and back in — a flash on every load. The entrance
 * belongs to the part that actually appears, so that is what gets the class.
 *
 * ── WHY IT IS CONDITIONAL, NOT ALWAYS-ON ─────────────────────────────────────
 *
 * On a WARM cache the data is already there at first render: the wrapper's own
 * `px-rise` covers real content and is correct as authored. Adding a second
 * entrance underneath it would nest two `px-rise` runs — 10px of travel plus
 * another 10px, and two multiplied opacity ramps. So the class is applied only
 * to content that was actually late: the component has to have rendered in a
 * pending state at least once. Warm loads are byte-identical to before.
 *
 * The class is not removed once applied. A CSS animation runs on application
 * and `backwards` hands the element back to its own styles when it finishes,
 * so a lingering class costs nothing and re-adding it on every keystroke-driven
 * re-render is what would actually be visible.
 */
import { useRef } from 'react'

/** The class `useLateEntrance` resolves to. Styled in `premium.css` §4. */
export const LATE_ENTRANCE_CLASS = 'px-enter'

/**
 * Pure decision, extracted so it can be tested without a renderer — the
 * `tsx --test` suites in this app run in plain Node with no DOM.
 *
 * @param pending     is the content still loading right now?
 * @param everPending has it been loading at any point in this component's life?
 */
export function lateEntranceClass(pending: boolean, everPending: boolean): string {
  return !pending && everPending ? LATE_ENTRANCE_CLASS : ''
}

/**
 * `''` when the content was there all along, `'px-enter'` when it arrived late.
 *
 *   const enter = useLateEntrance(isLoading)
 *   …
 *   <div className={`grid gap-[20px] ${enter}`}>
 */
export function useLateEntrance(pending: boolean): string {
  // Mutating a ref during render is the standard previous-value idiom and is
  // idempotent here: it only ever latches false → true, so a double render
  // under StrictMode reaches the same answer.
  const everPending = useRef(false)
  if (pending) everPending.current = true
  return lateEntranceClass(pending, everPending.current)
}
