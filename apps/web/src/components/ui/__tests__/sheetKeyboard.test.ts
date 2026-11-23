/**
 * The sheet's keyboard placement, pinned to the samples Deck-E's chat fix was
 * measured from (decision 2026-08-28, `panelViewport.test.ts`): iPhone 17 Pro /
 * iOS 26.5 and iPhone 16 Pro / iOS 18.6, read off `KbDiag.tsx` in a simulator.
 *
 * What these cannot prove is behaviour — no headless browser has a software
 * keyboard — so they pin the arithmetic and the device check lives in the PR.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { KEYBOARD_MIN_PX, keyboardLikelyUp, sheetBox } from '../sheetKeyboard'

/** iPhone 17 Pro, iOS 26.5, nothing focused. */
const REST_26 = { fixedOrigin: 0, visualHeight: 714, scale: 1, layoutHeight: 714 }
/** The same phone with a field focused: iOS scrolled 338 and fixed layers ride. */
const FOCUSED_26 = { fixedOrigin: -337, visualHeight: 377, scale: 1, layoutHeight: 714 }
/** iPhone 16 Pro, iOS 18.6, at rest and focused. */
const REST_18 = { fixedOrigin: 0, visualHeight: 678, scale: 1, layoutHeight: 678 }
const FOCUSED_18 = { fixedOrigin: -268, visualHeight: 410, scale: 1, layoutHeight: 678 }

test('at rest nothing is written, on either phone', () => {
  assert.equal(sheetBox(REST_26), null)
  assert.equal(sheetBox(REST_18), null)
})

test('keyboard up: the scrim covers exactly the visible area', () => {
  // Written in layout coordinates: `top` cancels the ride, so the scrim lands
  // at client 0, and its floor is the top of the keyboard.
  assert.deepEqual(sheetBox(FOCUSED_26), { top: 337, height: 377 })
  assert.deepEqual(sheetBox(FOCUSED_18), { top: 268, height: 410 })
  for (const s of [FOCUSED_26, FOCUSED_18]) {
    const box = sheetBox(s)!
    assert.equal(s.fixedOrigin + box.top, 0, 'client top of the scrim')
    assert.equal(s.fixedOrigin + box.top + box.height, s.visualHeight, 'client floor = keyboard top')
  }
})

test('a keyboard that overlays without riding (Android) still gets a floor on it', () => {
  // Chrome 108+ resizes the visual viewport only; nothing scrolls.
  assert.deepEqual(sheetBox({ fixedOrigin: 0, visualHeight: 420, scale: 1, layoutHeight: 760 }), {
    top: 0,
    height: 420,
  })
})

test('a pinch-zoom is not a keyboard', () => {
  assert.equal(keyboardLikelyUp({ fixedOrigin: 0, visualHeight: 357, scale: 2, layoutHeight: 714 }), false)
})

test('a collapsing toolbar is not a keyboard', () => {
  // Safari's toolbar collapsing makes the visual viewport TALLER than layout.
  assert.equal(keyboardLikelyUp({ fixedOrigin: 0, visualHeight: 790, scale: 1, layoutHeight: 714 }), false)
  assert.equal(
    keyboardLikelyUp({ fixedOrigin: 0, visualHeight: 714 - KEYBOARD_MIN_PX + 1, scale: 1, layoutHeight: 714 }),
    false,
  )
})

test('nothing believable, nothing written', () => {
  assert.equal(sheetBox(null), null)
  assert.equal(sheetBox({ ...FOCUSED_26, visualHeight: Number.NaN }), null)
  assert.equal(sheetBox({ ...FOCUSED_26, fixedOrigin: Number.NaN }), null)
  assert.equal(sheetBox({ ...FOCUSED_26, layoutHeight: Number.NaN }), null)
})
