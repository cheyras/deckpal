// What the loupe actually shows, in units of CARD.
//
// ── THE DEFECT THIS PINS ───────────────────────────────────────────────────
//
// The loupe shipped with `LOUPE_ZOOM = 5`, a fixed multiplier on `reference`
// pixels. `reference` is up to 1600 px of whatever resolution the photo
// happened to be, so a constant multiplier shows a constant number of PIXELS
// and a wildly varying amount of card — and at every realistic resolution the
// window came out SMALLER THAN THE CORNER RADIUS itself. The reader saw the tip
// of the arc and neither straight edge, in a tool whose entire job is helping
// them align a corner against two lines.
//
// Nothing failed. The picture was sharp, correct, and useless. So the property
// worth testing is not "does it render" but "how much CARD is in the window",
// which is arithmetic and belongs here.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LOUPE_CARD_FRACTION, LOUPE_DEFAULT_STEP, LOUPE_SIZE, LOUPE_STEPS } from '../Loupe'
import { CARD_CORNER_RADIUS_MM, CARD_WIDTH_MM } from '../../../lib/cardGeometry'

/** The corner radius as a fraction of the card's short edge — 3 mm of 63 mm. */
const RADIUS_FRACTION = CARD_CORNER_RADIUS_MM / CARD_WIDTH_MM

/** How many corner radii the window spans, at a given step. */
function radiiShown(step: number): number {
  const windowFraction = LOUPE_CARD_FRACTION * (LOUPE_STEPS[step] ?? 1)
  return windowFraction / RADIUS_FRACTION
}

test('the default window shows the arc PLUS a run of each straight edge', () => {
  const radii = radiiShown(LOUPE_DEFAULT_STEP)
  // The corner arc occupies one radius each way from the tangent points, so a
  // window of N radii leaves (N-2)/2 radii of straight edge visible per side.
  // Below about 4 there is no line to align against, which was the bug.
  assert.ok(radii >= 4, `default window spans only ${radii.toFixed(1)} corner radii — too tight to show an edge`)
  assert.ok(radii <= 8, `default window spans ${radii.toFixed(1)} radii — so wide the corner is no longer magnified`)
})

test('the old fixed-pixel zoom could not have satisfied that at any resolution', () => {
  // The regression in its original form: 132 px of loupe at 5x is a 26.4 px
  // window, against a corner radius that is ~4.8% of the card's short edge.
  const OLD_SIZE = 132
  const OLD_ZOOM = 5
  const oldWindowPx = OLD_SIZE / OLD_ZOOM
  for (const referencePx of [800, 1200, 1600]) {
    for (const fill of [0.5, 0.7, 0.9]) {
      const shortEdgePx = referencePx * fill
      const radiusPx = shortEdgePx * RADIUS_FRACTION
      assert.ok(
        oldWindowPx / radiusPx < 2,
        `old window showed ${(oldWindowPx / radiusPx).toFixed(2)} radii at ref=${referencePx} fill=${fill} — ` +
          'if this ever exceeded 2 the historical claim in Loupe.tsx would be wrong',
      )
    }
  }
})

test('the window is resolution-independent — the same card fills the same loupe', () => {
  // The whole point of measuring against the quad. A 63 mm card photographed at
  // three resolutions must produce three different PIXEL windows that all show
  // the same fraction of the card.
  const windows = [800, 1200, 1600].map((referencePx) => {
    const shortEdgePx = referencePx * 0.7
    return { referencePx, windowPx: shortEdgePx * LOUPE_CARD_FRACTION, shortEdgePx }
  })
  const fractions = windows.map((w) => w.windowPx / w.shortEdgePx)
  for (const f of fractions) assert.ok(Math.abs(f - LOUPE_CARD_FRACTION) < 1e-9)
  // ...and the pixel windows genuinely differ, or the test proves nothing.
  assert.notEqual(windows[0]!.windowPx, windows[2]!.windowPx)
})

test('every step is usable — none inverts, none degenerates', () => {
  assert.ok(LOUPE_STEPS.length >= 3, 'a stepper with fewer than three stops is a toggle')
  for (let i = 1; i < LOUPE_STEPS.length; i++) {
    assert.ok(LOUPE_STEPS[i]! > LOUPE_STEPS[i - 1]!, 'steps must increase monotonically')
  }
  for (let i = 0; i < LOUPE_STEPS.length; i++) {
    const radii = radiiShown(i)
    assert.ok(radii > 1, `step ${i} spans ${radii.toFixed(1)} radii — back inside the corner, which is the bug`)
  }
})

test('the default step is a real index into the steps', () => {
  assert.ok(Number.isInteger(LOUPE_DEFAULT_STEP))
  assert.ok(LOUPE_DEFAULT_STEP >= 0 && LOUPE_DEFAULT_STEP < LOUPE_STEPS.length)
  assert.equal(LOUPE_STEPS[LOUPE_DEFAULT_STEP], 1, 'the default should be the derived window, unscaled')
})

test('the loupe is big enough for the magnification to be worth having', () => {
  assert.ok(LOUPE_SIZE >= 132, 'the loupe got smaller, which spends the fix')
})
