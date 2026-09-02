// Run: node --import tsx --test src/scan/engine/__tests__/*.test.ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { defaultReticle, type ImageDataLike } from '../geometry'
import {
  computeLetterbox,
  frameToModelNorm,
  letterboxRGBA,
  modelNormToFrame,
  modelPointsToQuad,
  PAD_VALUE,
  rgbaToBGRPlanar,
} from '../preprocess'

function px(img: ImageDataLike, x: number, y: number): [number, number, number, number] {
  const o = (y * img.width + x) * 4
  return [img.data[o], img.data[o + 1], img.data[o + 2], img.data[o + 3]]
}

describe('computeLetterbox', () => {
  it('crops to the reticle and pads only on the short axis', () => {
    const t = computeLetterbox(480, 640, defaultReticle(480, 640))
    // 63:88 contain-fit at 72% width on a 3:4 portrait frame: the width cap wins.
    assert.equal(t.crop.x, 67)
    assert.equal(t.crop.w, 346)
    assert.equal(t.crop.h, 483)
    assert.equal(t.size, 256)
    // The crop is taller than it is wide, so the model input is padded left and
    // right and not top and bottom.
    assert.equal(t.padY, 0)
    assert.ok(t.padX > 30 && t.padX < 40, `padX=${t.padX}`)
  })

  it('preserves aspect — that is the entire point of letterboxing', () => {
    const t = computeLetterbox(1280, 960, { x: 0.1, y: 0.05, w: 0.5, h: 0.9 })
    const boxW = t.crop.w * t.scale
    const boxH = t.crop.h * t.scale
    assert.ok(Math.abs(boxW / boxH - t.crop.w / t.crop.h) < 1e-12)
    // The scaled crop fits inside the square, touching it on exactly one axis.
    assert.ok(boxW <= t.size + 1e-9 && boxH <= t.size + 1e-9)
    assert.ok(Math.abs(Math.max(boxW, boxH) - t.size) < 1e-9)
  })

  it('clamps a reticle that would run off the frame', () => {
    const t = computeLetterbox(100, 100, { x: 0.8, y: 0.8, w: 0.5, h: 0.5 })
    assert.ok(t.crop.x + t.crop.w <= 100)
    assert.ok(t.crop.y + t.crop.h <= 100)
  })
})

describe('coordinate mapping (model space <-> frame space)', () => {
  const t = computeLetterbox(480, 640, defaultReticle(480, 640))

  it('round-trips frame -> model -> frame exactly', () => {
    for (const [fx, fy] of [
      [67, 79],
      [100.25, 200.5],
      [412.75, 561.5],
      [240, 320],
      [0, 0],
      [479, 639],
    ]) {
      const [nx, ny] = frameToModelNorm(t, fx, fy)
      const [bx, by] = modelNormToFrame(t, nx, ny)
      assert.ok(Math.abs(bx - fx) < 1e-9, `x ${fx} -> ${bx}`)
      assert.ok(Math.abs(by - fy) < 1e-9, `y ${fy} -> ${by}`)
    }
  })

  it('puts the crop origin exactly at the top-left of the padded box', () => {
    const [x, y] = modelNormToFrame(t, t.padX / t.size, t.padY / t.size)
    assert.ok(Math.abs(x - t.crop.x) < 1e-9)
    assert.ok(Math.abs(y - t.crop.y) < 1e-9)
    const [x2, y2] = modelNormToFrame(t, (t.size - t.padX) / t.size, (t.size - t.padY) / t.size)
    assert.ok(Math.abs(x2 - (t.crop.x + t.crop.w)) < 1e-9)
    assert.ok(Math.abs(y2 - (t.crop.y + t.crop.h)) < 1e-9)
  })

  it('a centred model-space quad lands centred on the reticle in frame space', () => {
    const q = modelPointsToQuad(t, [0.3, 0.3, 0.7, 0.3, 0.7, 0.7, 0.3, 0.7])
    assert.ok(q)
    const cx = (q[0][0] + q[2][0]) / 2
    const cy = (q[0][1] + q[2][1]) / 2
    assert.ok(Math.abs(cx - (t.crop.x + t.crop.w / 2)) < 1e-9)
    assert.ok(Math.abs(cy - (t.crop.y + t.crop.h / 2)) < 1e-9)
  })

  it('rejects a short points array rather than reading past its end', () => {
    assert.equal(modelPointsToQuad(t, [0.1, 0.2, 0.3]), null)
  })
})

describe('letterboxRGBA', () => {
  // 8x8 source, every pixel distinguishable: r = x*16, g = y*16, b = 200.
  const src: ImageDataLike = (() => {
    const data = new Uint8ClampedArray(8 * 8 * 4)
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const o = (y * 8 + x) * 4
        data[o] = x * 16
        data[o + 1] = y * 16
        data[o + 2] = 200
        data[o + 3] = 255
      }
    }
    return { width: 8, height: 8, data }
  })()

  // Crop the middle half horizontally: 4x8 crop into an 8x8 model input, so
  // scale = 1 and there are exactly two mid-gray columns on each side.
  const t = computeLetterbox(8, 8, { x: 0.25, y: 0, w: 0.5, h: 1 }, 8)

  it('computes the expected pad geometry', () => {
    assert.deepEqual(t.crop, { x: 2, y: 0, w: 4, h: 8 })
    assert.equal(t.scale, 1)
    assert.equal(t.padX, 2)
    assert.equal(t.padY, 0)
  })

  it('fills the bars with mid-gray, opaque', () => {
    const out = letterboxRGBA(src, t)
    for (const x of [0, 1, 6, 7]) {
      for (const y of [0, 3, 7]) {
        assert.deepEqual(px(out, x, y), [PAD_VALUE, PAD_VALUE, PAD_VALUE, 255], `pad at ${x},${y}`)
      }
    }
  })

  it('reproduces the cropped pixels at known positions', () => {
    const out = letterboxRGBA(src, t)
    // Output column 2 is source column 2 (crop.x), column 5 is source column 5.
    assert.deepEqual(px(out, 2, 3), [2 * 16, 3 * 16, 200, 255])
    assert.deepEqual(px(out, 5, 7), [5 * 16, 7 * 16, 200, 255])
  })

  it('agrees with modelNormToFrame about where a pixel came from', () => {
    const out = letterboxRGBA(src, t)
    for (const [ox, oy] of [
      [2, 0],
      [3, 4],
      [5, 7],
    ]) {
      const [fx, fy] = modelNormToFrame(t, (ox + 0.5) / t.size, (oy + 0.5) / t.size)
      const got = px(out, ox, oy)
      assert.deepEqual(got, [Math.floor(fx) * 16, Math.floor(fy) * 16, 200, 255], `at ${ox},${oy}`)
    }
  })
})

describe('rgbaToBGRPlanar', () => {
  it('emits planar BGR / 255 in the exact order LC050 expects', () => {
    const data = new Uint8ClampedArray([
      10, 20, 30, 255, //
      40, 50, 60, 255,
      70, 80, 90, 255,
      100, 110, 120, 255,
    ])
    const out = rgbaToBGRPlanar({ width: 2, height: 2, data })
    assert.equal(out.length, 12)
    // plane 0 = BLUE
    assert.deepEqual([...out.slice(0, 4)], [30 / 255, 60 / 255, 90 / 255, 120 / 255].map(Math.fround))
    // plane 1 = GREEN
    assert.deepEqual([...out.slice(4, 8)], [20 / 255, 50 / 255, 80 / 255, 110 / 255].map(Math.fround))
    // plane 2 = RED  (NOT plane 0 — the whole session-1 failure in one line)
    assert.deepEqual([...out.slice(8, 12)], [10 / 255, 40 / 255, 70 / 255, 100 / 255].map(Math.fround))
  })

  it('is /255 only — no ImageNet mean/std normalisation (TRIAGE.md session1)', () => {
    const data = new Uint8ClampedArray([255, 255, 255, 255])
    const out = rgbaToBGRPlanar({ width: 1, height: 1, data })
    assert.deepEqual([...out], [1, 1, 1])
    const black = rgbaToBGRPlanar({ width: 1, height: 1, data: new Uint8ClampedArray([0, 0, 0, 255]) })
    assert.deepEqual([...black], [0, 0, 0])
  })

  it('returns a FRESH array every call (the proxy-worker DataCloneError trap)', () => {
    const img = { width: 1, height: 1, data: new Uint8ClampedArray([1, 2, 3, 255]) }
    const a = rgbaToBGRPlanar(img)
    const b = rgbaToBGRPlanar(img)
    assert.notEqual(a.buffer, b.buffer)
  })
})
