/**
 * Noticing that his mark has MOVED.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 *
 * Deck-E parks against the chat composer, and the composer moves without
 * resizing anything: before a conversation starts it is centred in the pane,
 * and the first message drops it to the bottom. That transition swaps one
 * `justify-content` value on the column. The window does not resize, the
 * keep-out bands do not change, nothing scrolls, and the composer's own box is
 * identical — so every re-park trigger the runtime has misses it.
 *
 * MEASURED at 1440x900, signed in, driving the real DOM: the composer's top
 * went 511.5 -> 822.0 and his drawn silhouette went 363-562 -> 362-561, with
 * `DeckE.resize`, `DeckE.setKeepOut` and `DeckE.flyTo` called ZERO times.
 * Reported twice by the owner: "he should have gone down with this and he did
 * not" / "Deck-E didn't ever come down to this bar, he's up here."
 *
 * There is no browser event for "this element moved", so `DeckeHost` polls one
 * rect at 10 Hz while the chat is open. The DECISION it makes on each sample
 * lives here rather than in the component, because a `.tsx` cannot be imported
 * under `node --import tsx` (`import.meta.env` throws) and an untestable
 * decision is how the two "verified" but vacuous tests in this pass happened.
 */

/** The parts of the mark's box that decide whether he has to move. */
export type MarkBox = { top: number; left: number; h: number }

/**
 * How often the mark is read, in ms.
 *
 * One `getBoundingClientRect` on one element, and only while the chat is open.
 * Deliberately SLOWER than the 8 Hz sample the speech bubble already runs while
 * he travels: a mark that moved a beat ago is invisible, and a forced layout on
 * a path that runs regardless is not.
 */
export const MARK_WATCH_MS = 100

/**
 * How long the mark must hold still before he is sent after it, in ms.
 *
 * A TRAILING debounce, restarted by every observed move — the same shape
 * `DeckE.resize` uses, and for the same reason it gives: a leading-edge trigger
 * fires on the first sample of a move and drops the last one, so he is aimed at
 * a position the mark is still leaving.
 *
 * IT MUST OUTLAST THE COMPOSER'S OWN DROP, which is a 360 ms keyframe
 * animation (`decke-composer-drop` in `DeckeChat.tsx`). `getBoundingClientRect`
 * reports an animating element where it IS, not where it lands, so a settle
 * shorter than the animation solves his park against a frame from the middle of
 * it. `markWatch.test.ts` pins that relationship; if the composer's animation
 * is ever lengthened, this has to follow it.
 */
export const MARK_SETTLE_MS = 420

/** Total px of top+left+height change below which nothing has really moved. */
export const MARK_MOVE_EPS = 1

/**
 * Has the mark moved enough to be worth a re-park?
 *
 * `null` on either side is NOT a move, and both halves of that matter:
 *
 *   - `before === null` is the mark appearing. The panel's own entrance already
 *     ends in a park, and treating a mount as a move would race it.
 *   - `after === null` is the mark going away — a navigation, a journey
 *     collapsing the transcript to a bar. Standing still beats flying to the
 *     last place a thing that no longer exists used to be, and the host has
 *     separate paths for both of those cases.
 */
export function markMoved(
  before: MarkBox | null,
  after: MarkBox | null,
  eps: number = MARK_MOVE_EPS,
): boolean {
  if (!before || !after) return false
  const delta =
    Math.abs(after.top - before.top) +
    Math.abs(after.left - before.left) +
    Math.abs(after.h - before.h)
  return delta > eps
}
