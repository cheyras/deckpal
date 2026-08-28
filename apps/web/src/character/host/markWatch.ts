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
 * The move above which chasing the mark is worth a FLIGHT rather than a cut.
 *
 * ── THE SLOW DRIFT, MEASURED OFF THE 2026-08-27 MOBILE TAPE ─────────────────
 *
 * *"See how that is like slowly drifting downward before it rests at the
 * bottom? It's also causing him to do a lot of jitter and stuff as he has to
 * readjust a bunch."*
 *
 * Tracked frame by frame at 10 Hz, from the moment the software keyboard
 * dismissed at 0:36.6 to the moment he came to rest at 0:41.5: his silhouette's
 * bottom edge fell in SIX discrete hops with a small retreat between each pair
 * — 218 → 228 → 232 → 236 → 241 → 244 → 246, in the tape's 1/10-scale pixels,
 * about 90 CSS px in just under five seconds. Six hops is not one animation. It
 * is this watch firing six times: 100 ms poll, `MARK_SETTLE_MS` of trailing
 * debounce, a full `flyTo` with its ease-in and its ease-out, land, and the
 * mark has moved a handful of pixels again by the time he gets there.
 *
 * Neither half of that is wrong on its own. The watch exists because a mark
 * that moves without an event is the defect it documents at length, and the
 * debounce exists because a leading-edge park aims him at a position the mark
 * is still leaving. What was missing is that A FEW PIXELS IS NOT A JOURNEY. A
 * flight has an arc, a facing re-assertion and an arrival; played out to cover
 * four pixels it reads as exactly what it was called on camera — a fidget.
 *
 * So a small correction is a CUT. He is simply already at the new mark on the
 * next frame, which is invisible at this distance and cannot chain into the
 * next one. A real move — the composer's first-message drop, an approval card
 * arriving, a rotation — still gets the flight it deserves.
 *
 * 24 px is chosen as roughly one line of transcript text: below it, nothing the
 * layout can do to him is a thing a reader would describe as him moving.
 */
export const MARK_HOP_MIN_PX = 24

/**
 * How long the mark must have been LET ALONE for the next move to be a journey.
 *
 * ── WHY A SIZE THRESHOLD ALONE WAS NOT ENOUGH ────────────────────────────────
 *
 * Measured, on `probe-park-settle.mjs`, replaying the tape's six hops into a
 * real panel at 390x844: `main` took SIX flights to settle. A size threshold on
 * its own took FOUR — better, and still a staircase, because a drift that
 * arrives 13 px at a time crosses 24 px every second hop and buys another
 * flight for doing so.
 *
 * The missing idea is that YOU CANNOT FLY TO A MOVING TARGET. A flight is the
 * gesture for "that thing moved, I am going to it" — it has a launch, an arc
 * and an arrival, and it is worth watching exactly once. What follows, while
 * the layout is still settling under him, is not another journey; it is him
 * keeping station, and keeping station is a cut. So the first move of a quiet
 * mark is flown and everything in the same disturbance is tracked.
 *
 * That gives one flight for the composer's first-message drop, one for an
 * approval card arriving, and one for the whole of the tape's drift — which is
 * what "he moved out of the way" is supposed to look like.
 *
 * 1200 ms is comfortably past `MARK_SETTLE_MS` plus the flight it dispatches,
 * so the clock cannot still be inside the previous journey when it is read.
 */
export const MARK_QUIET_MS = 1200

/**
 * Fly to the new mark, or cut to it?
 *
 * Both leave him standing in the right place; only one of them is a journey the
 * reader watches him take. `'fly'` needs BOTH of:
 *
 *   - a move big enough to read as a move (`MARK_HOP_MIN_PX`), measured against
 *     where he was last DISPATCHED rather than against the previous sample, so
 *     a drift cannot arrive under the threshold in instalments; and
 *   - a mark that had been still (`MARK_QUIET_MS`) before it moved, so a
 *     disturbance that takes several seconds to settle costs one journey and
 *     not one per instalment.
 *
 * `null` on either side is not a move at all and is therefore not a flight —
 * the caller has already decided not to park.
 */
export function parkStyle(
  before: MarkBox | null,
  after: MarkBox | null,
  sinceLastParkMs: number,
  opts: { min?: number; quiet?: number } = {},
): 'fly' | 'cut' {
  if (!before || !after) return 'cut'
  const moved =
    Math.abs(after.top - before.top) +
    Math.abs(after.left - before.left) +
    Math.abs(after.h - before.h)
  if (moved < (opts.min ?? MARK_HOP_MIN_PX)) return 'cut'
  return sinceLastParkMs >= (opts.quiet ?? MARK_QUIET_MS) ? 'fly' : 'cut'
}

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
