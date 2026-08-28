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
import {
  MARK_HOP_MIN_PX,
  MARK_MOVE_EPS,
  MARK_QUIET_MS,
  MARK_SETTLE_MS,
  MARK_WATCH_MS,
  markMoved,
  parkStyle,
} from '../markWatch'

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

// ─────────────────────────────────────────────────────────────────────────────
// CUT OR FLY — the slow drift off the 2026-08-27 mobile tape
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The six hops, as measured.
 *
 * His silhouette's bottom edge, sampled at 10 Hz from the frame the software
 * keyboard dismissed (0:36.6) to the frame he came to rest (0:41.5), in the
 * tape's 1/10-scale pixels. Six discrete steps down with a retreat between each
 * pair — about 90 CSS px in just under five seconds, which is the *"slowly
 * drifting downward before it rests at the bottom"* the owner narrates over it.
 *
 * Converted to CSS pixels at the tape's scale (1 tracked px = 10 device px on a
 * 3x screen), the per-hop deltas are roughly 33, 13, 13, 17, 10 and 7.
 */
const DRIFT_HOPS_CSS = [33, 13, 13, 17, 10, 7]

/** He has been standing still for a while — the ordinary case. */
const RESTED = MARK_QUIET_MS * 2
/** The mark moved again while the last journey was still settling. */
const BUSY = 700

test('a few pixels is a cut, however long he has been still', () => {
  // Played out as a flight, a thirteen-pixel correction reads as a fidget, and
  // six of them in a row read as him slowly sinking.
  for (const px of DRIFT_HOPS_CSS.slice(1)) {
    assert.equal(
      parkStyle(CENTRED, { ...CENTRED, top: CENTRED.top + px }, RESTED),
      'cut',
      `${px} px was flown, and six of those in a row is the drift`,
    )
  }
})

test('the first-message drop is a flight, because it is a real journey', () => {
  // The 310 px the composer falls when the first message is sent. Cutting THAT
  // would be the opposite defect: he would teleport across a third of the panel.
  assert.equal(parkStyle(CENTRED, DROPPED, RESTED), 'fly')
})

test('an approval card arriving is a flight', () => {
  // The card is ~200 px of panel appearing above the composer, which is what
  // lifts him off it (`parkFloor.ts`). He should be SEEN to move out of its way.
  assert.equal(parkStyle(CENTRED, { ...CENTRED, top: CENTRED.top - 210 }, RESTED), 'fly')
})

test('you cannot fly to a moving target', () => {
  // A big move is STILL a cut if it arrives while the layout is settling. This
  // is the half a size threshold alone does not cover, and the reason `main`'s
  // six flights only came down to four before it existed.
  assert.equal(parkStyle(CENTRED, DROPPED, BUSY), 'cut')
})

test("the tape's drift costs exactly one flight", () => {
  // THE MEASUREMENT THIS WHOLE RULE EXISTS FOR. Six hops arriving ~700 ms apart
  // — the recording's own cadence — must read as ONE disturbance he moves out
  // of, not as six separate journeys.
  let dispatched = CENTRED
  let top = CENTRED.top
  let rested = RESTED
  const flown: number[] = []
  for (const px of DRIFT_HOPS_CSS) {
    top += px
    const now = { ...CENTRED, top }
    if (parkStyle(dispatched, now, rested) === 'fly') flown.push(top - dispatched.top)
    dispatched = now
    rested = BUSY
  }
  assert.deepEqual(flown, [33], 'the drift is one journey and five corrections')
})

test('and the NEXT disturbance is a journey again', () => {
  // The quiet clock is a gate on a run of moves, not a budget that runs out.
  // Once he has been left alone, the next real move is flown like any other.
  assert.equal(parkStyle(CENTRED, DROPPED, RESTED), 'fly')
})

test('appearing and going away are cuts, not flights', () => {
  // Same rule as `markMoved`, and the two must agree: the caller has already
  // decided not to park at all in both of these cases.
  assert.equal(parkStyle(null, DROPPED, RESTED), 'cut')
  assert.equal(parkStyle(CENTRED, null, RESTED), 'cut')
})

test('the flight threshold is above the move threshold', () => {
  // Otherwise every move worth noticing is also worth flying, and this file
  // describes a distinction that does not exist.
  assert.ok(MARK_HOP_MIN_PX > MARK_MOVE_EPS)
})

test('the quiet window outlasts the settle it follows', () => {
  // The clock is read inside `parkNow`, which the debounce has just fired. If
  // the window were shorter than the debounce, every trailing move would look
  // like a rested one and the gate would never close.
  assert.ok(MARK_QUIET_MS > MARK_SETTLE_MS, 'the quiet window is inside the debounce')
})
