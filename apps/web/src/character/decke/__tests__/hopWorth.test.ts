/**
 * Which moves earn the arc.
 *
 * The threshold is a fraction of his own height, so the cases below are written
 * as "he is Npx tall and is asked to move Mpx" rather than as bare numbers —
 * that is the only framing in which the answers are obvious, and it is the
 * framing the rule is actually stated in.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { HOP_MIN_FRACTION, HOP_MIN_PX, GLIDE_SHAPE, worthHopping } from '../hopWorth'

/** What the host dollies him to on a phone with the chat open, near enough. */
const PHONE = 180
/** The constructor default, and roughly a desktop. */
const DESKTOP = 300

test('the moves the owner named as hops still hop', () => {
  // *"when he is PURPOSELY traveling somewhere, like to show off something in
  // the UI, or to go from the chat button and back"* — those are hundreds of px.
  assert.equal(worthHopping(400, PHONE), true, 'across the page')
  assert.equal(worthHopping(150, PHONE), true, 'rising over an approval card')
  assert.equal(worthHopping(800, DESKTOP), true, 'the beacon and back')
})

test('the moves the owner named as hiccups slide', () => {
  // *"even if he moves like 10 pixels ... he does a hop"* — the case this is for.
  assert.equal(worthHopping(10, PHONE), false)
  assert.equal(worthHopping(24, PHONE), false, 'the composer growing one line')
  assert.equal(worthHopping(5, DESKTOP), false, 'a layout settle')
})

test('the threshold is a quarter of him, so it scales instead of being tuned', () => {
  // THE POINT OF THE FRACTION. The same 60px move is a nudge for a big
  // character and a real step for a small one, and a fixed pixel count could
  // only ever be right for one of them.
  assert.equal(worthHopping(60, DESKTOP), false, '60 of a 300px character is a nudge')
  assert.equal(worthHopping(60, PHONE), true, '60 of a 180px character is travel')
  // Exactly on the line hops: the boundary belongs to the deliberate side.
  assert.equal(worthHopping(PHONE * HOP_MIN_FRACTION, PHONE), true)
  assert.equal(worthHopping(PHONE * HOP_MIN_FRACTION - 0.1, PHONE), false)
})

test('an unknown height still hops for anything deliberate', () => {
  // `characterHeightPx` is null until the host's first measure, and a null that
  // disabled hopping would turn his ARRIVAL into a slide — the one frame where
  // the animation is the whole point.
  assert.equal(worthHopping(400, null), true)
  assert.equal(worthHopping(HOP_MIN_PX, null), true)
  assert.equal(worthHopping(HOP_MIN_PX - 1, null), false)
})

test('a nonsense height falls back to the floor rather than to no hopping', () => {
  for (const bad of [0, -50, NaN, Infinity]) {
    assert.equal(worthHopping(400, bad), true, `height ${bad} must not disable the arc`)
    assert.equal(worthHopping(2, bad), false, `height ${bad} must still swallow a 2px nudge`)
  }
})

test('the floor outranks the fraction for a very small character', () => {
  // A 40px character would put the fraction at 10px, and a 10px move is exactly
  // what the owner said must not hop.
  assert.equal(worthHopping(12, 40), false)
  assert.equal(worthHopping(HOP_MIN_PX, 40), true)
})

test('an unmeasurable move is treated as deliberate', () => {
  // A NaN span means the projection could not answer, and refusing to hop on a
  // number nobody understands would silently drop real arrivals.
  assert.equal(worthHopping(NaN, PHONE), true)
})

test('a glide is flat and straight and nothing else', () => {
  // If this ever grows an arc it stops being the thing it was added to be.
  assert.equal(GLIDE_SHAPE.arc, 0)
  assert.equal(GLIDE_SHAPE.bow, 0)
  // Paced by the same controller as a short hop — only the SHAPE differs.
  assert.equal(GLIDE_SHAPE.cruise, 0.1)
})
