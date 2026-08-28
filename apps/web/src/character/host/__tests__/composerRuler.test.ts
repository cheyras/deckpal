/**
 * The composer height he is ruled off — and why it is not the composer's height.
 *
 * ── THE DEFECT, MEASURED ─────────────────────────────────────────────────────
 *
 * The most frequent complaint on the 2026-08-24 review recording, fourteen
 * tagged instances of it across twenty minutes: his size pops to a new value in
 * one frame, paired with a shift down and to the left, and a corrective hop a
 * beat later. "He all of a sudden just grew in size for no reason." "Sudden
 * resize back to the right size and shift upward, then readjustment hop."
 * "Sudden scale back down. Same bullshit." "I'm sure there are more after this
 * but I'm going to stop labeling them, I think you get the idea."
 *
 * Read frame by frame, every instance brackets a stretch of TYPING. At t=13:20
 * the composer is one row and he is one size; at t=13:23 the draft wraps to a
 * second row and he is bigger; at t=13:34 the message is sent, the composer
 * collapses to one row, and he snaps back. Measured off the tape at 1302 CSS px
 * wide: composer 47 -> 65 px, and `characterHeightBeside` turns that into
 * 136 -> 188 px of character. Nothing about the viewport changed.
 *
 * The composer MOVING is a real event he should answer — a taller composer sits
 * higher and he should go up with it, which `markWatch` exists for and which
 * `markWatch.test.ts` pins. The composer moving is not a reason for him to be a
 * different SIZE, and separating those two is the whole of this module.
 *
 * These tests cannot reach `DeckeHost` itself: a `.tsx` throws under
 * `node --import tsx` on `import.meta.env`. Same reason `markWatch.ts` is a
 * `.ts` sibling, same shape of fix.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  HEIGHT_EPS,
  ruleComposer,
  rulerFor,
  steadyHeight,
  type ComposerRuler,
} from '../composerRuler'

/** A 1440x900 laptop, the viewport the review was recorded at. */
const W = 1440
const H = 900
/** The composer at rest: 8px of padding, a 40px control row, 8px more. */
const REST = 58
/** The same composer with a draft wrapped onto a second row, measured. */
const TWO_ROWS = 80

test('the first measurement is the resting height, because there is nothing to compare it to', () => {
  const r = ruleComposer(null, { composerH: REST, w: W, h: H })
  assert.deepEqual(r, { w: W, h: H, resting: REST })
})

test('a composer that GREW does not change the ruler — the defect, directly', () => {
  const rest = ruleComposer(null, { composerH: REST, w: W, h: H })
  const typed = ruleComposer(rest, { composerH: TWO_ROWS, w: W, h: H })
  assert.equal(rulerFor(typed, { composerH: TWO_ROWS, w: W, h: H }), REST)
  // And the ruler object itself is the same one, so a caller comparing by
  // identity sees no change either.
  assert.equal(typed, rest)
})

test('and it does not change back on send, so the return leg is symmetric', () => {
  // The pop had two halves and the second one is the "sudden scale back down"
  // the owner tagged five separate times. Both come from the same read.
  let r: ComposerRuler | null = ruleComposer(null, { composerH: REST, w: W, h: H })
  r = ruleComposer(r, { composerH: TWO_ROWS, w: W, h: H })
  r = ruleComposer(r, { composerH: 102, w: W, h: H }) // three rows
  r = ruleComposer(r, { composerH: REST, w: W, h: H }) // sent; back to one
  assert.equal(rulerFor(r, { composerH: REST, w: W, h: H }), REST)
})

test('a composer that is genuinely SHORTER than anything seen wins', () => {
  // The latch is a minimum, not a first-write. A panel that mounts with a
  // restored draft already in it hands the first sample a tall composer, and
  // "whatever arrived first" would rule him off it for the rest of the session.
  const tall = ruleComposer(null, { composerH: TWO_ROWS, w: W, h: H })
  const sent = ruleComposer(tall, { composerH: REST, w: W, h: H })
  assert.equal(rulerFor(sent, { composerH: REST, w: W, h: H }), REST)
})

test('a real resize starts again rather than carrying the old minimum across', () => {
  // Dragging the window narrower gives the composer more rows for the same
  // text, so its resting height at the new width is genuinely different. A
  // `Math.min` across the resize would pin him to a composer that no longer
  // exists at that height.
  const wide = ruleComposer(null, { composerH: REST, w: W, h: H })
  const narrow = ruleComposer(wide, { composerH: 80, w: 390, h: 780 })
  assert.deepEqual(narrow, { w: 390, h: 780, resting: 80 })
})

test('a composer that cannot be measured leaves the ruler exactly as it was', () => {
  // Zero is what `getBoundingClientRect` reports for a composer that is absent
  // (a past transcript, the out-of-credits notice) or has not laid out yet.
  // Folding it in would latch him to nothing at all.
  const rest = ruleComposer(null, { composerH: REST, w: W, h: H })
  assert.equal(ruleComposer(rest, { composerH: 0, w: W, h: H }), rest)
  assert.equal(ruleComposer(null, { composerH: 0, w: W, h: H }), null)
})

test('and with no ruler at all, the answer is "do not change his height"', () => {
  // NOT "fall back to the full-page formula". That fallback is up to 300px
  // against a composer-ruled ~168px, so substituting it for a composer that is
  // merely unmeasurable this instant is a near-2x pop — the same defect these
  // tests exist to remove, arriving by a different door.
  assert.equal(rulerFor(null, { composerH: 0, w: W, h: H }), null)
})

test('the ruler is still reported on the frame the viewport changes', () => {
  // The resize sample carries its own composer height, so there IS an honest
  // answer for that frame; `null` is reserved for having nothing to say.
  const wide = ruleComposer(null, { composerH: REST, w: W, h: H })
  const sample = { composerH: 80, w: 390, h: 780 }
  assert.equal(rulerFor(wide, sample), 80)
})

// ─────────────────────────────────────────────────────────────────────────────
// THE DEADBAND — the other half of the slow drift (2026-08-27)
// ─────────────────────────────────────────────────────────────────────────────

test('a one-pixel re-measure is not a size change', () => {
  // It is not a cheap no-op either, which is the point. His height sets
  // `parkW`, `parkW` sets the transcript's `--decke-gutter`, the gutter
  // re-wraps every bubble beside him, and `DeckeHost`'s mark watch is watching
  // what that does to the layout — so one pixel buys a re-wrap, a moved mark,
  // a 420 ms debounce and a re-park whose own measurement can land one pixel
  // off again. That loop is the staircase `MARK_HOP_MIN_PX` documents, seen
  // from the end that GENERATES the moves rather than the end that flies them.
  assert.equal(steadyHeight(188, 189), 188)
  assert.equal(steadyHeight(188, 187), 188)
  assert.equal(steadyHeight(188, 186), 188)
})

test('a real change still lands, in both directions', () => {
  // A rotation, a keyboard, a viewport that actually changed. The deadband must
  // not be able to pin him to a size the layout has left behind.
  assert.equal(steadyHeight(188, 191), 191)
  assert.equal(steadyHeight(188, 136), 136)
  // The measured 136 -> 188 pop this file's header is about is nowhere near it.
  assert.equal(steadyHeight(136, 188), 188)
})

test('the threshold is invisible on a character this size', () => {
  // 3 px on the ~136-188 px he is measured at. Stated as a ratio so a future
  // change to either number has to look at this.
  assert.ok(HEIGHT_EPS / 136 < 0.025, 'the deadband is big enough to see')
})

test('zero is always applied, on the way in and on the way out', () => {
  // `0` means "no size yet" when the controller boots and "the panel is gone"
  // when it tears down. Treating either as a small change leaves him at a stale
  // size with nothing left running to correct it.
  assert.equal(steadyHeight(0, 2), 2, 'his first measurement must not be swallowed')
  assert.equal(steadyHeight(188, 0), 0, 'the teardown must not be swallowed')
})

test('the deadband cannot creep', () => {
  // The baseline is the height last APPLIED, never the last measured — so a
  // slow ramp of sub-threshold samples holds at the applied value instead of
  // walking it up two pixels at a time, which would be the drift rebuilt out of
  // rounding error.
  let applied = 188
  for (const sample of [189, 190, 189, 190, 189, 190]) applied = steadyHeight(applied, sample)
  assert.equal(applied, 188)
})
