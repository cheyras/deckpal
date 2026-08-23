/**
 * Noticing that his mark has moved — the trigger the empty→conversation
 * transition never had.
 *
 * ── THE DEFECT, MEASURED ─────────────────────────────────────────────────────
 *
 * Reported twice, from two separate recordings: "okay so he should have gone
 * down with this and he did not" / "Deck-E didn't ever come down to this bar,
 * he's up here. Yeah, he needs to move down."
 *
 * Driven from the live DOM at 1440x900, signed in, parked beside the centred
 * composer and then sent a message:
 *
 *   composer top     511.5  ->  822.0
 *   his drawn box    363-562 -> 362-561   (unchanged, to the pixel)
 *   DeckE.resize()   0 calls
 *   DeckE.setKeepOut() 0 calls
 *   DeckE.flyTo()    0 calls
 *
 * The solve was never wrong — setting the station dirty by hand in the same
 * session moved him correctly to 668-882. NOTHING ASKED IT. The chat column
 * swaps one `justify-content` value, which moves the composer 310 px without
 * changing the window, the keep-out bands, the scroll offset or the composer's
 * own box, so every existing re-park trigger sits it out.
 *
 * These tests are about the decision `DeckeHost` makes on each sample of the
 * poll that closes that hole. They cannot reach the component itself: a `.tsx`
 * throws under `node --import tsx` on `import.meta.env`, which is why the
 * decision lives in a `.ts` sibling.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { MARK_SETTLE_MS, MARK_WATCH_MS, MARK_MOVE_EPS, markMoved } from '../markWatch'

/** The composer's box before and after the first message, measured at 1440x900. */
const CENTRED = { top: 512, left: 494, h: 58 }
const DROPPED = { top: 822, left: 494, h: 58 }

test('the 310 px drop that shipped is seen as a move', () => {
  assert.equal(markMoved(CENTRED, DROPPED), true)
})

test('a mark that has not moved is not a move', () => {
  assert.equal(markMoved(CENTRED, { ...CENTRED }), false)
})

test('a sub-threshold shuffle is not a move', () => {
  // A pixel of rounding must not launch a flight: `parkForChat` calls `flyTo`,
  // which is a real journey across the screen, and one per layout jitter would
  // read as him twitching.
  assert.equal(markMoved(CENTRED, { ...CENTRED, top: CENTRED.top + MARK_MOVE_EPS }), false)
  assert.equal(markMoved(CENTRED, { ...CENTRED, top: CENTRED.top + MARK_MOVE_EPS + 1 }), true)
})

test('the composer GROWING is a move too, not only the composer travelling', () => {
  // He is sized from the composer (`characterHeightBeside`), so a composer that
  // gained a line is both taller and higher up, and both halves want re-solving.
  // Height is in the comparison for this reason; dropping it from `markMoved`
  // would leave a typed-into composer sizing him from a card that no longer
  // exists at that height.
  assert.equal(markMoved(CENTRED, { ...CENTRED, h: CENTRED.h + 22 }), true)
})

test('appearing is not a move, and neither is going away', () => {
  // `before === null` is the panel mounting, whose own entrance already ends in
  // a park — treating it as a move would race that park with a second one.
  assert.equal(markMoved(null, DROPPED), false)
  // `after === null` is a navigation, or a journey collapsing the transcript to
  // a bar. Both have their own paths in the host, and flying to where a thing
  // that no longer exists used to be is worse than standing still.
  assert.equal(markMoved(CENTRED, null), false)
  assert.equal(markMoved(null, null), false)
})

test('the settle outlasts the composer\'s own drop animation', () => {
  // `decke-composer-drop` in `DeckeChat.tsx` is a 360 ms keyframe, and
  // `getBoundingClientRect` reports an animating element where it IS rather
  // than where it lands. A settle shorter than the animation therefore solves
  // his park against a frame from the middle of the drop — he would set off
  // after the composer and stop short of it.
  const COMPOSER_DROP_MS = 360
  assert.ok(
    MARK_SETTLE_MS > COMPOSER_DROP_MS,
    `a ${MARK_SETTLE_MS} ms settle lands inside the ${COMPOSER_DROP_MS} ms drop`,
  )
  // And the poll has to sample the animation more than once, or the trailing
  // debounce has nothing to trail.
  assert.ok(MARK_WATCH_MS * 2 < COMPOSER_DROP_MS, 'the watch must sample the drop repeatedly')
})
