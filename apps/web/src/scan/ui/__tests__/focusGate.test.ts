// The focus gate (focusGate.ts) and the measure it reads (engine/sharpness.ts).
// The numbers are the owner's 2026-11-25 session, measured in the engine's
// canonical frame: blurred captures 101-259, sharp ones 375-1403.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { quadSharpness } from '../../engine/sharpness'
import type { Quad } from '../../engine/contract'
import { decideAutoCapture } from '../autoCapture'
import {
  FOCUS_FLOOR,
  FOCUS_MAX_WAIT_MS,
  createFocusGate,
} from '../focusGate'
import { createCapturedRegions } from '../regions'
import { createLookRearm } from '../rearm'

test('a blurred tick waits; the same track sharp a moment later is ready', () => {
  // The field Hypno: captured at 155, then by the same track at 508, 0.85 s later.
  const g = createFocusGate()
  assert.deepEqual(g.judge(5, 155, 0), { ready: false, waiting: true })
  assert.deepEqual(g.judge(5, 160, 120), { ready: false, waiting: true })
  assert.equal(g.judge(5, 508, 850).ready, true)
})

test('every blurred capture of the session waits, every sharp one fires at once', () => {
  for (const s of [259, 155, 200, 121, 101]) assert.equal(createFocusGate().judge(1, s, 0).ready, false, `blurred ${s}`)
  for (const s of [426, 497, 508, 562, 1403, 553, 955, 375, 843, 709, 460, 754]) {
    assert.equal(createFocusGate().judge(1, s, 0).ready, true, `sharp ${s}`)
  }
})

test('a passing smear on a card already seen sharp waits for it to come back', () => {
  const g = createFocusGate()
  assert.equal(g.judge(1, 1400, 0).ready, true)
  assert.equal(g.judge(1, 600, 100).ready, false, '600 is over the floor but well under 0.7 x 1400')
  assert.equal(g.judge(1, 1300, 200).ready, true)
})

test('a low-texture card that never reaches the floor is still taken, on its best frame', () => {
  const g = createFocusGate()
  const low = FOCUS_FLOOR * 0.5
  assert.equal(g.judge(1, low, 0).ready, false)
  for (let t = 100; t < FOCUS_MAX_WAIT_MS; t += 100) assert.equal(g.judge(1, low, t).ready, false)
  assert.equal(g.judge(1, low * 0.5, FOCUS_MAX_WAIT_MS).ready, false, 'not on a frame much worse than its best')
  assert.equal(g.judge(1, low * 0.95, FOCUS_MAX_WAIT_MS + 100).ready, true)
})

test('no measurement never holds a capture', () => {
  assert.equal(createFocusGate().judge(1, null, 0).ready, true)
})

test('a lock that lapses starts its wait again', () => {
  const g = createFocusGate()
  let t = 0
  for (; t < FOCUS_MAX_WAIT_MS; t += 100) assert.equal(g.judge(1, 100, t).ready, false)
  assert.equal(g.judge(1, 100, t).ready, true, 'settled after the wait')
  assert.equal(g.judge(1, 100, t + 5000).ready, false, 'a fresh lock waits again')
})

test('decideAutoCapture holds a blurred lock and fires the sharp one', () => {
  const quad: Quad = [[100, 50], [300, 50], [300, 330], [100, 330]]
  const lock = { id: 7, quad }
  const focus = createFocusGate()
  const memory = (sharpness: number | null, now: number) => ({
    refractory: new Set<number>(),
    busy: false,
    regions: createCapturedRegions(),
    rearm: createLookRearm(),
    focus: { gate: focus, sharpness, now },
  })
  const blurred = decideAutoCapture(lock, null, memory(150, 0))
  assert.equal(blurred.fire, false)
  assert.equal(blurred.focusWait, true)
  const sharp = decideAutoCapture(lock, null, memory(600, 300))
  assert.equal(sharp.fire, true)
  assert.equal(sharp.focusWait, false)
})

test('quadSharpness: a crisp checkerboard outscores the same board blurred', () => {
  const W = 120
  const img = (blur: boolean) => {
    const data = new Uint8ClampedArray(W * W * 4)
    for (let y = 0; y < W; y++) {
      for (let x = 0; x < W; x++) {
        let v = ((x >> 2) + (y >> 2)) % 2 ? 255 : 0
        if (blur) v = 128 + (v - 128) * 0.15
        const o = (y * W + x) * 4
        data[o] = data[o + 1] = data[o + 2] = v
        data[o + 3] = 255
      }
    }
    return { width: W, height: W, data }
  }
  const quad: Quad = [[10, 10], [110, 10], [110, 110], [10, 110]]
  const crisp = quadSharpness(img(false), quad)!
  const soft = quadSharpness(img(true), quad)!
  assert.ok(crisp > 10 * soft, `${crisp} vs ${soft}`)
  assert.equal(quadSharpness(img(false), [[0, 0], [5, 0], [5, 5], [0, 5]]), null, 'too small to measure')
})
