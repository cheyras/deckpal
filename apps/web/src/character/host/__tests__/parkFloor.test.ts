/**
 * Which card he stands on — and the one where he was standing on the reader.
 *
 * ── THE DEFECT, MEASURED OFF THE TAPE ────────────────────────────────────────
 *
 * 2026-08-27 mobile screen recording, 1284x2778 at 3x — 428x926 CSS px.
 * Narrated at 0:54: *"We have this issue where the permission prompts, he's
 * covering it up. I'd like him to like jump up above the permission prompt.
 * That would be much better … so we can actually read the text that he's
 * covering up."*
 *
 * On the frame at 1:10 the approval card runs from y=900 to y=1220 of the
 * panel's 1390-px-tall render (≈214 to ≈290 in CSS px above the panel floor),
 * he is drawn ~223 px tall in the panel's bottom-left corner, and his head
 * covers the line *"the deep research takes longer and uses more than a normal
 * request"*. Every number below is that frame.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { parkFloor } from '../parkFloor'

/** `PARK_ABOVE` in `DeckeChat.tsx` — the daylight kept under his feet. */
const ABOVE = 8

/** The 1:10 frame, in CSS px above the panel's floor. */
const TAPE = {
  /** The composer card's top edge. */
  composerTop: 96,
  /** The approval card's top edge, measured from the same floor. */
  askTop: 290,
  /** The panel: the screen below the app header and the status bar. */
  panelH: 790,
  /** His silhouette, `characterPx * SILHOUETTE`. */
  parkH: 223,
  above: ABOVE,
}

test('with no card up, nothing about this changed', () => {
  // The regression that would be easiest to ship and hardest to see: the
  // ordinary path is the overwhelming majority of the time the panel is open,
  // and it must return the same number the single measurement used to.
  assert.equal(parkFloor({ ...TAPE, askTop: 0 }), TAPE.composerTop)
})

test('an approval card lifts him off the composer and onto it', () => {
  // The ask, in one assertion.
  assert.equal(parkFloor(TAPE), TAPE.askTop)
})

test('and that actually clears the card, which is the point', () => {
  // Not "he moved" — "the text is readable". His feet land at the floor plus
  // the daylight, so his lowest pixel is above the card's highest one and no
  // part of the card is behind him.
  const feet = parkFloor(TAPE) + ABOVE
  assert.ok(feet > TAPE.askTop, `his feet at ${feet} are still inside a card topping out at ${TAPE.askTop}`)
})

test('he still fits on the screen while he is up there', () => {
  // The other half of the same frame: rising is only correct if the top of him
  // is still inside the panel.
  const head = parkFloor(TAPE) + ABOVE + TAPE.parkH
  assert.ok(head <= TAPE.panelH, `his head at ${head} is off a panel ${TAPE.panelH} tall`)
})

test('a card too tall to clear leaves him on screen, standing in it', () => {
  // The honest degradation. A card running nearly the whole panel cannot be
  // stood above by a 223 px character; the clamp holds him at the highest mark
  // that still fits rather than flying him off the top, which would be the same
  // defect with the sign flipped.
  const tall = { ...TAPE, askTop: 700 }
  const at = parkFloor(tall)
  assert.ok(at < tall.askTop, 'he was sent above a card he cannot clear')
  assert.ok(at + ABOVE + tall.parkH <= tall.panelH, 'the clamp let his head off the panel')
})

test('he is never pushed back down into the composer', () => {
  // The clamp's lower bound is the composer, not zero. A panel measured absurdly
  // short — mid-entrance, a keyboard animating, a rotation — must not be able to
  // produce a mark that buries his feet in the one control the reader is using.
  assert.equal(parkFloor({ ...TAPE, panelH: 40 }), TAPE.composerTop)
})

test('nothing measured yet is 0, so the caller keeps its own fallback', () => {
  // The park box reads a falsy value as "not measured" and falls back to the
  // old resting offset. Returning a plausible number here would take that
  // branch away and stand him against a panel that has not laid out.
  assert.equal(parkFloor({ ...TAPE, composerTop: 0, askTop: 0 }), 0)
})

test('a card with no panel height yet still lifts him', () => {
  // The measurements do not all arrive on the same frame. An absent ceiling
  // means "no ceiling", which is exactly the answer this gave before there was
  // one — not "refuse to move".
  assert.equal(parkFloor({ ...TAPE, panelH: 0 }), TAPE.askTop)
})
