import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  EMBED_MEAN,
  EMBED_SIZE,
  EMBED_SPEC_VERSION,
  EMBED_STD,
  cardRect,
  embedInput,
  embedStamp,
  frameStamp,
  l2Normalize,
} from '../input-spec.js'
import { syntheticRgba } from './fixtures.js'

const HERE = dirname(fileURLToPath(import.meta.url))

test('the tensor is 1x3xSIZExSIZE and every value is finite', () => {
  const data = syntheticRgba(1, 60, 84)
  const t = embedInput({ width: 60, height: 84, data })
  assert.equal(t.length, 3 * EMBED_SIZE * EMBED_SIZE)
  assert.ok(t.every((v) => Number.isFinite(v)))
})

test('normalisation maps flat black and flat white to the expected extremes', () => {
  // The two ends of the domain, computed by hand from the constants: a black
  // pixel is (0 - mean)/std and a white one is (1 - mean)/std. This is the test
  // that catches a mean/std transposed, scaled by 255, or quietly dropped —
  // which is the exact class of bug that made LC050 look broken on-device
  // (preprocess.ts's header).
  const black = new Uint8ClampedArray(4 * 4 * 4)
  for (let i = 0; i < 16; i++) black[i * 4 + 3] = 255
  const tb = embedInput({ width: 4, height: 4, data: black })
  const plane = EMBED_SIZE * EMBED_SIZE
  for (let c = 0; c < 3; c++) {
    assert.ok(Math.abs((tb[c * plane] as number) - (0 - EMBED_MEAN[c]!) / EMBED_STD[c]!) < 1e-6)
  }

  const white = new Uint8ClampedArray(4 * 4 * 4).fill(255)
  const tw = embedInput({ width: 4, height: 4, data: white })
  for (let c = 0; c < 3; c++) {
    assert.ok(Math.abs((tw[c * plane] as number) - (1 - EMBED_MEAN[c]!) / EMBED_STD[c]!) < 1e-6)
  }
})

test('the box filter averages rather than samples', () => {
  // A 2x2 source of two blacks and two whites downscaled to 1x1 must be mid-grey.
  // Nearest-neighbour would answer black or white, which is the substitution
  // this asserts against: an implementation that "looks the same" on photos and
  // is a different function.
  const data = new Uint8ClampedArray(2 * 2 * 4)
  for (let i = 0; i < 4; i++) {
    const v = i < 2 ? 0 : 255
    data[i * 4] = v
    data[i * 4 + 1] = v
    data[i * 4 + 2] = v
    data[i * 4 + 3] = 255
  }
  const t = embedInput({ width: 2, height: 2, data }, { size: 1 })
  const expected = (127.5 / 255 - EMBED_MEAN[0]!) / EMBED_STD[0]!
  assert.ok(Math.abs((t[0] as number) - expected) < 1e-6)
})

test('the capture margin is cropped back off, and only when asked', () => {
  // rectify.ts warps (1 + 2*0.05) card-widths into 480 px, so the card is
  // 480/1.1 = 436 px wide starting at x = 22.
  assert.deepEqual(cardRect(480, 670, 0.05), { x: 22, y: 30, w: 436, h: 610 })
  assert.deepEqual(cardRect(480, 670, 0), { x: 0, y: 0, w: 480, h: 670 })
  // Catalog renders pass no margin and must be untouched.
  assert.deepEqual(cardRect(245, 337), { x: 0, y: 0, w: 245, h: 337 })
})

test('the margin crop actually changes what the model sees', () => {
  // A guard against `marginFrac` being accepted and ignored — a silent version
  // of the failure this whole module exists to prevent, since the two sides
  // would then be comparing a card against a card-plus-table.
  const data = syntheticRgba(3, 480, 670)
  const withMargin = embedInput({ width: 480, height: 670, data }, { marginFrac: 0.05 })
  const without = embedInput({ width: 480, height: 670, data })
  assert.notDeepEqual(Array.from(withMargin.slice(0, 32)), Array.from(without.slice(0, 32)))
})

test('l2Normalize produces a unit vector and tolerates a zero vector', () => {
  const v = Float32Array.from([3, 4, 0])
  l2Normalize(v)
  assert.ok(Math.abs(Math.hypot(v[0]!, v[1]!, v[2]!) - 1) < 1e-6)
  const z = new Float32Array(4)
  l2Normalize(z)
  assert.ok(z.every((x) => x === 0))
})

test('the stamp names the spec version and the checkpoint', () => {
  assert.equal(embedStamp('clip-vit-b32-openai'), `e${EMBED_SPEC_VERSION}:clip-vit-b32-openai`)
  assert.equal(frameStamp(3), 'p3')
})

test('this module does not redeclare the detector PIPELINE_VERSION', () => {
  // The coordination half of the owner's "ONE versioned input spec" ruling:
  // frame.ts owns the detector's version number and a second declaration here
  // is how two pipelines start disagreeing about which one they are. The stamp
  // helper takes the number as an argument; nothing in the source assigns one.
  const src = readFileSync(join(HERE, '..', 'input-spec.ts'), 'utf8')
  assert.equal(
    /PIPELINE_VERSION\s*=/.test(src),
    false,
    'input-spec.ts must not declare PIPELINE_VERSION — frame.ts owns it',
  )
})
