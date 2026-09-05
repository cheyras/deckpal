// Run: node --import tsx --test src/scan/ocr/__tests__/*.test.ts
//
// The GEOMETRY of the OCR lane: the two ROI bands, the detector's input
// rounding, the resampler, the rotated crop, the DB box recovery and the CTC
// decode. Everything here is pure, which is the point — the model is the one
// part of this pipeline that cannot be unit-tested in a Node process, so the
// arithmetic around it had better be.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { DET_BASE_SIZE, ROIS, ROI_SCALE, detInputSize, roiPixels } from '../rois'
import { cropRotated, makeRaster, resample, rgbaToBGRPlanar, type Box } from '../raster'
import { detectBoxes, groupIntoLines } from '../db'
import { decodeCtc, parseKeys } from '../ctc'

/** `rectify.ts`'s output size. The ROI fractions are fractions of THIS. */
const CROP_W = 480
const CROP_H = 670

describe('the ROI bands — REPORT.md §3.3', () => {
  it('covers every number line the detector measured, with margin', () => {
    // `derive-roi.mjs` ran the detector over all 21 native crops and recorded
    // where the number line actually sat (§3.3):
    //     number line   y0 0.855 .. 0.957   y1 0.894 .. 0.987   x0 0.033 .. 0.179
    // The band has to contain the whole observed range — the ~10 % spread is
    // real quad error plus CAPTURE_MARGIN moving with it, and a band that only
    // covers the median loses a tenth of the crops outright.
    assert.ok(ROIS.strip.y0 <= 0.855, 'top of the band is above the highest observed y0')
    assert.ok(ROIS.strip.y1 >= 0.987, 'bottom of the band is below the lowest observed y1')
    assert.ok(ROIS.strip.x0 <= 0.033, 'left edge is left of the leftmost observed x0')
  })

  it('covers every name line the detector measured, with margin', () => {
    //     name line     y0 0.007 .. 0.133   y1 0.082 .. 0.163   x0 0.102 .. 0.252
    assert.ok(ROIS.name.y0 <= 0.007)
    assert.ok(ROIS.name.y1 >= 0.163)
    assert.ok(ROIS.name.x0 <= 0.102)
  })

  it('the two bands do not overlap', () => {
    // If they did, the same line could contribute a name AND a number, and the
    // two-pass merge's premise — each pass owns its fields — would be false.
    assert.ok(ROIS.name.y1 < ROIS.strip.y0)
  })

  it('is 3×, which is the only preprocessing the recipe has', () => {
    assert.equal(ROI_SCALE, 3)
  })
})

describe('roiPixels', () => {
  it('converts the shipped bands to the pixels of a 480×670 crop', () => {
    const name = roiPixels(ROIS.name, CROP_W, CROP_H)
    assert.deepEqual(name, { x: 10, y: 0, w: 465, h: 134 })
    const strip = roiPixels(ROIS.strip, CROP_W, CROP_H)
    assert.deepEqual(strip, { x: 0, y: 556, w: 298, h: 114 })
  })

  it('is CROP-relative, so it scales with the crop and not with the card', () => {
    // Double the rectified size and every band doubles. This is what makes the
    // fractions survive a change to CARD_RECT_WIDTH — the bands would still need
    // RE-DERIVING if CAPTURE_MARGIN moved, but they would not silently point at
    // the wrong pixels.
    // Within a pixel: each edge is rounded independently, so doubling the crop
    // can move a rounded edge by one against twice the smaller box.
    const a = roiPixels(ROIS.strip, CROP_W, CROP_H)
    const b = roiPixels(ROIS.strip, CROP_W * 2, CROP_H * 2)
    assert.ok(Math.abs(b.w - a.w * 2) <= 1, `${b.w} vs ${a.w * 2}`)
    assert.ok(Math.abs(b.h - a.h * 2) <= 1, `${b.h} vs ${a.h * 2}`)
    assert.ok(Math.abs(b.y - a.y * 2) <= 1, `${b.y} vs ${a.y * 2}`)
  })

  it('clamps to the image and never returns an empty box', () => {
    const out = roiPixels({ x0: 0.9, y0: 0.9, x1: 5, y1: 5 }, 100, 100)
    assert.deepEqual(out, { x: 90, y: 90, w: 10, h: 10 })
    const degenerate = roiPixels({ x0: 0.5, y0: 0.5, x1: 0.5, y1: 0.5 }, 100, 100)
    assert.equal(degenerate.w, 1)
    assert.equal(degenerate.h, 1)
  })
})

describe('detInputSize', () => {
  it('rounds UP to a multiple of 32 on both axes', () => {
    // Up, never to nearest: rounding down would crop a strip off the band, and
    // the strip that would be lost off the bottom is where the number is.
    const name = roiPixels(ROIS.name, CROP_W, CROP_H)
    assert.deepEqual(detInputSize(name.w * ROI_SCALE, name.h * ROI_SCALE), { w: 1408, h: 416 })
    const strip = roiPixels(ROIS.strip, CROP_W, CROP_H)
    assert.deepEqual(detInputSize(strip.w * ROI_SCALE, strip.h * ROI_SCALE), { w: 896, h: 352 })
  })

  it('never goes below one base tile', () => {
    assert.deepEqual(detInputSize(1, 1), { w: DET_BASE_SIZE, h: DET_BASE_SIZE })
  })

  it('leaves an exact multiple alone', () => {
    assert.deepEqual(detInputSize(64, 96), { w: 64, h: 96 })
  })
})

// ── the resampler ──────────────────────────────────────────────────────────

/** Fill an RGBA raster from a function of (x, y), grey. */
function grey(w: number, h: number, f: (x: number, y: number) => number) {
  const r = makeRaster(w, h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4
      const v = f(x, y)
      r.data[o] = v
      r.data[o + 1] = v
      r.data[o + 2] = v
      r.data[o + 3] = 255
    }
  }
  return r
}

describe('resample', () => {
  it('is the identity at the same size', () => {
    const src = grey(8, 4, (x, y) => x * 16 + y)
    const out = resample(src, 8, 4)
    assert.deepEqual([...out.data], [...src.data])
  })

  it('AVERAGES when shrinking — the half that stops 12 px type aliasing', () => {
    // Detected lines are 90-140 px tall off a 3×-upscaled band and go to 48 px:
    // a 2-3× reduction. Point-sampling that turns the strokes of small type into
    // noise, which is the one input the recogniser has no defence against.
    const src = grey(4, 1, (x) => [0, 100, 200, 255][x])
    const out = resample(src, 2, 1)
    assert.equal(out.data[0], 50) // mean of 0 and 100
    assert.equal(out.data[4], 228) // mean of 200 and 255, rounded by Uint8ClampedArray
  })

  it('interpolates when growing, rather than replicating', () => {
    const src = grey(2, 1, (x) => (x === 0 ? 0 : 200))
    const out = resample(src, 4, 1)
    // A blocky nearest-neighbour result would be [0, 0, 200, 200]; a smooth one
    // has intermediate values. `nearest` costs 3 wrong badge reads (see
    // `capture.ts`), so this is not a stylistic preference.
    const lane = [out.data[0], out.data[4], out.data[8], out.data[12]]
    assert.ok(lane[1] > lane[0] && lane[1] < lane[2], `not interpolating: ${lane}`)
  })

  it('always writes an opaque alpha', () => {
    const out = resample(grey(3, 3, () => 10), 7, 2)
    for (let i = 3; i < out.data.length; i += 4) assert.equal(out.data[i], 255)
  })
})

describe('cropRotated', () => {
  it('lifts an axis-aligned box out unchanged', () => {
    const src = grey(10, 10, (x, y) => x * 10 + y)
    const box: Box = [
      [2, 3],
      [6, 3],
      [6, 7],
      [2, 7],
    ]
    const out = cropRotated(src, box)
    assert.equal(out.width, 4)
    assert.equal(out.height, 4)
    // Sampled at pixel centres, so out(0,0) is src(2,3).
    assert.equal(out.data[0], 2 * 10 + 3)
    assert.equal(out.data[(1 * 4 + 1) * 4], 3 * 10 + 4)
  })

  it('returns a blank crop rather than throwing on a degenerate box', () => {
    const src = grey(10, 10, () => 128)
    const flat: Box = [
      [5, 5],
      [5, 5],
      [5, 5],
      [5, 5],
    ]
    const out = cropRotated(src, flat)
    assert.equal(out.width, 1)
    assert.equal(out.height, 1)
  })
})

describe('rgbaToBGRPlanar', () => {
  it('is BGR planar, /255, with no mean/std', () => {
    // The same tensor layout the detector's own preprocess uses, and for the
    // same reason: it is what the reference implementation feeds, and phase-0b's
    // session-1 failure was nothing but a mismatched tensor.
    const r = makeRaster(2, 1)
    r.data.set([255, 128, 0, 255, 0, 64, 32, 255])
    const t = rgbaToBGRPlanar(r)
    const near = (a: number, b: number, what: string) =>
      assert.ok(Math.abs(a - b) < 1e-6, `${what}: ${a} vs ${b}`) // Float32 rounding
    assert.equal(t.length, 6)
    near(t[0], 0 / 255, 'B of px0')
    near(t[1], 32 / 255, 'B of px1')
    near(t[2], 128 / 255, 'G of px0')
    near(t[4], 255 / 255, 'R of px0')
  })

  it('returns a FRESH array every call — the proxy worker detaches it', () => {
    const r = makeRaster(2, 2)
    assert.notEqual(rgbaToBGRPlanar(r).buffer, rgbaToBGRPlanar(r).buffer)
  })
})

// ── DB post-processing ─────────────────────────────────────────────────────

describe('detectBoxes', () => {
  /** A probability map with one filled rectangle of 1.0 in a field of 0. */
  function blob(w: number, h: number, x0: number, y0: number, x1: number, y1: number) {
    const p = new Float32Array(w * h)
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) p[y * w + x] = 1
    return p
  }

  it('recovers one box per blob, unclipped by area×1.5/perimeter', () => {
    // Blob is 30 px wide and 10 tall (inclusive bounds), so the min-area rect
    // over its pixel centres is 29 × 9 and DB's unclip grows it by
    // d = 1.5·29·9/(2·38) = 5.15 on every side.
    const boxes = detectBoxes(blob(64, 64, 10, 20, 39, 29), 64, 64)
    assert.equal(boxes.length, 1)
    const xs = boxes[0].box.map((p) => p[0])
    const ys = boxes[0].box.map((p) => p[1])
    assert.ok(Math.min(...xs) >= 4 && Math.min(...xs) <= 6, `left ${Math.min(...xs)}`)
    assert.ok(Math.max(...xs) >= 43 && Math.max(...xs) <= 46, `right ${Math.max(...xs)}`)
    assert.ok(Math.min(...ys) >= 14 && Math.min(...ys) <= 16, `top ${Math.min(...ys)}`)
    assert.ok(Math.max(...ys) >= 33 && Math.max(...ys) <= 36, `bottom ${Math.max(...ys)}`)
  })

  it('separates two blobs and clamps to the map', () => {
    const p = blob(64, 64, 2, 2, 24, 12)
    const q = blob(64, 64, 2, 40, 24, 50)
    for (let i = 0; i < p.length; i++) p[i] = Math.max(p[i], q[i])
    const boxes = detectBoxes(p, 64, 64)
    assert.equal(boxes.length, 2)
    for (const b of boxes) {
      for (const [x, y] of b.box) {
        assert.ok(x >= 0 && x <= 64, `x ${x}`)
        assert.ok(y >= 0 && y <= 64, `y ${y}`)
      }
    }
  })

  it('drops specks below the minimum side', () => {
    // A 2×2 blob is under MIN_SIDE before unclipping. `RETR_LIST`'s hole
    // contours are this size, which is why they cost nothing.
    assert.equal(detectBoxes(blob(64, 64, 30, 30, 31, 31), 64, 64).length, 0)
  })

  it('thresholds at 0.03, the reference implementation’s value', () => {
    const p = new Float32Array(64 * 64)
    for (let y = 20; y <= 29; y++) for (let x = 10; x <= 39; x++) p[y * 64 + x] = 0.05
    assert.equal(detectBoxes(p, 64, 64).length, 1, '0.05 is above the threshold')
    for (let i = 0; i < p.length; i++) if (p[i]) p[i] = 0.02
    assert.equal(detectBoxes(p, 64, 64).length, 0, '0.02 is below it')
  })
})

describe('groupIntoLines', () => {
  const at = (x0: number, y0: number, x1: number, y1: number): Box => [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ]

  it('glues fragments on one line, left to right', () => {
    // This is what turns three detections into `DRIEN 089/182` — and the badge
    // rule is defined as "the text left of the number ON THE SAME LINE", so
    // without it there is no such thing as the same line.
    const out = groupIntoLines([
      { box: at(60, 100, 140, 120), text: '089/182', mean: 0.9 },
      { box: at(10, 101, 50, 121), text: 'DRIEN', mean: 0.9 },
    ])
    assert.equal(out.length, 1)
    assert.equal(out[0].text, 'DRIEN 089/182')
  })

  it('keeps separate lines separate, top to bottom', () => {
    const out = groupIntoLines([
      { box: at(10, 100, 90, 120), text: 'second', mean: 0.9 },
      { box: at(10, 10, 90, 30), text: 'first', mean: 0.9 },
    ])
    assert.deepEqual(out.map((l) => l.text), ['first', 'second'])
  })

  it('is empty for no input', () => {
    assert.deepEqual(groupIntoLines([]), [])
  })
})

// ── CTC ────────────────────────────────────────────────────────────────────

describe('decodeCtc', () => {
  const keys = ['a', 'b', 'c'] // classes 1,2,3; class 0 is BLANK

  /** One-hot logits for a sequence of class indices. */
  function logits(seq: number[], c: number) {
    const d = new Float32Array(seq.length * c)
    seq.forEach((k, i) => {
      d[i * c + k] = 1
    })
    return d
  }

  it('drops blanks and collapses repeats', () => {
    const seq = [0, 1, 1, 0, 2, 2, 2, 3]
    const out = decodeCtc(logits(seq, 4), seq.length, 4, keys)
    assert.equal(out.text, 'abc')
  })

  it('keeps a genuine double letter when a blank separates it', () => {
    // The whole reason CTC has a blank: `aa` is `a, blank, a`, and collapsing
    // before removing blanks would turn it into `a`.
    const seq = [1, 0, 1]
    assert.equal(decodeCtc(logits(seq, 4), seq.length, 4, keys).text, 'aa')
  })

  it('is index-shifted by one — class k is keys[k-1]', () => {
    // An off-by-one here does not crash. It silently returns text shifted by one
    // codepoint through a 6,624-entry dictionary, which reads as a broken model.
    assert.equal(decodeCtc(logits([1], 4), 1, 4, keys).text, 'a')
    assert.equal(decodeCtc(logits([3], 4), 1, 4, keys).text, 'c')
  })

  it('returns empty with zero confidence when everything is blank', () => {
    const out = decodeCtc(logits([0, 0, 0], 4), 3, 4, keys)
    assert.equal(out.text, '')
    assert.equal(out.mean, 0)
  })

  it('reports the mean of the winning logits', () => {
    const d = new Float32Array(2 * 4)
    d[0 * 4 + 1] = 0.8
    d[1 * 4 + 2] = 0.6
    const out = decodeCtc(d, 2, 4, keys)
    assert.equal(out.text, 'ab')
    assert.ok(Math.abs(out.mean - 0.7) < 1e-6)
  })
})

describe('parseKeys', () => {
  it('appends the space that the file does not contain', () => {
    // 6,623 lines in `ppocr-keys-v1.txt` + a space = 6,624 characters, + CTC's
    // blank = the model's 6,625 classes. Without the space, every inter-word gap
    // decodes as the last dictionary character.
    const keys = parseKeys('a\nb\nc')
    assert.deepEqual(keys, ['a', 'b', 'c', ' '])
  })

  it('survives a CRLF checkout', () => {
    assert.deepEqual(parseKeys('a\r\nb\r\nc'), ['a', 'b', 'c', ' '])
  })
})
