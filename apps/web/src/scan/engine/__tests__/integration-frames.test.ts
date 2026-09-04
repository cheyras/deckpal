// Run: node --import tsx --test src/scan/engine/__tests__/integration-frames.test.ts
//
// THE TEST THE OTHER SEVEN FILES CANNOT BE. Every pure function in this engine
// round-trips to 1e-9 against its own definition, and the assembled pipeline was
// still returning the wrong rectangle on a phone: it cropped inference to the
// reticle, which handed a zero-training DocAligner checkpoint an input the card
// filled edge to edge, and the model answered with the card's illustration
// window instead of its outer boundary. No unit test could have caught that,
// because every unit was doing exactly what it said.
//
// So this one runs the SHIPPING code path — preprocess.computeLetterbox with
// index.INFERENCE_RECT, the real tensor builder, the real LC050 weights, the
// real modelPointsToQuad, the real refiner, the real rectifier — over 19
// hand-labelled camera frames from phase 0b session 2, and scores the corners it
// gets back in FRAME PIXELS against the labels.
//
// It needs three things node has not got: pixels, a model, and ground truth.
// offline-harness.ts supplies all three and documents exactly what it
// substitutes; when the model is not available (a machine without the phase 0a
// python venv, or a CI box without the session-2 corpus) every case here SKIPS
// rather than passing vacuously.
//
// The thresholds below are deliberately slack against the measurement — they are
// a fence around a fix, not a record of a run. What they must catch is the
// regression class that produced this bug: the model quietly returning a
// smaller, interior rectangle. `linear scale` is the assertion that does that.

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { Quad } from '../contract'
import { clipPoly, defaultReticle, polyArea, polyIoU, CARD_ASPECT_W_OVER_H } from '../geometry'
import { computeLetterbox, modelPointsToQuad } from '../preprocess'
import { gradientField, refineQuadChecked, REFINE_DEFAULTS, REFINE_PASS_HALVES } from '../refine'
import {
  applyHomography,
  expandQuad,
  orderQuadForCard,
  rectifyImageData,
  solveHomography,
  CAPTURE_MARGIN,
  CARD_RECT_HEIGHT,
  CARD_RECT_WIDTH,
} from '../rectify'
import { inferenceTransform, REFINE_LONG_SIDE } from '../index'
import {
  engineInput,
  listFlagFrames,
  loadRGBA,
  maxDelta,
  meanDelta,
  ortAvailable,
  probeInput,
  probePointsToQuad,
  quantiles,
  runModel,
  toTensor,
  workImage,
  type FlagFrame,
} from './offline-harness'

/** A machine without the phase 0a python venv, or without the session-2 corpus,
 *  must SKIP — never crash, and never pass vacuously. The corpus lives outside
 *  the repo, so even reading its index is allowed to fail. */
function available(): boolean {
  try {
    return ortAvailable() && listFlagFrames().some((f) => f.gt)
  } catch {
    return false
  }
}
const skip = available() ? false : 'phase 0b session-2 frames or the ONNX sidecar are not available here'

interface Scored {
  frame: FlagFrame
  gt: Quad
  /** The shipping path, before and after the sub-pixel refiner. */
  raw: Quad
  refined: Quad | null
  /** The probe's preprocessing (whole frame, stretched) through the same model:
   *  the 85.5%-on-card baseline every stage is compared against. */
  probe: Quad
  /** The pipeline as it shipped before the fix — inference cropped to the
   *  reticle — so "better than what it replaced" is asserted, not asserted-of. */
  retCrop: Quad
}

let cache: Promise<Scored[]> | null = null
function scored(): Promise<Scored[]> {
  if (!cache) cache = compute()
  return cache
}

async function compute(): Promise<Scored[]> {
  const frames = listFlagFrames().filter((f) => f.gt)
  const tensors: Float32Array[] = []
  // Three preprocessings of every frame, in one batch: the model is loaded once.
  for (const f of frames) tensors.push(toTensor(await engineInput(f.png, inferenceTransform(f.width, f.height))))
  for (const f of frames) tensors.push(toTensor(await probeInput(f.png)))
  for (const f of frames)
    tensors.push(
      toTensor(await engineInput(f.png, computeLetterbox(f.width, f.height, defaultReticle(f.width, f.height)))),
    )
  const outs = runModel(tensors)
  const n = frames.length

  const rows: Scored[] = []
  for (let i = 0; i < n; i++) {
    const f = frames[i]
    const t = inferenceTransform(f.width, f.height)
    const raw = modelPointsToQuad(t, outs[i].points)
    const probe = probePointsToQuad(outs[n + i].points, f.width, f.height)
    const retT = computeLetterbox(f.width, f.height, defaultReticle(f.width, f.height))
    const retCrop = modelPointsToQuad(retT, outs[2 * n + i].points)
    assert.ok(raw && probe && retCrop, `${f.name}: the model returned no quad`)

    // Refinement, as index.ts does it: the gradient field of the pixels the
    // model was shown, at up to REFINE_LONG_SIDE, quad mapped in and back.
    const img = await workImage(f.png, t.crop, REFINE_LONG_SIDE)
    const sx = img.width / t.crop.w
    const sy = img.height / t.crop.h
    const local = raw.map((p) => [(p[0] - t.crop.x) * sx, (p[1] - t.crop.y) * sy]) as Quad
    const out = refineQuadChecked(local, gradientField(img))
    rows.push({
      frame: f,
      gt: f.gt!,
      raw,
      probe,
      retCrop,
      refined: out ? (out.map((p) => [p[0] / sx + t.crop.x, p[1] / sy + t.crop.y]) as Quad) : null,
    })
  }
  return rows
}

/** The shipping quad: refined when the refiner produced a valid one, else the
 *  model's own — which is exactly index.ts's fallback. */
function shipped(s: Scored): Quad {
  return s.refined ?? s.raw
}

/** The rect the CAPTURE covers — the shipping quad widened by the capture
 *  margin, which is what rectifyToJpeg warps and therefore what the server is
 *  actually handed. `shipped` is what the engine claims; this is what it sends. */
function captured(s: Scored, margin = CAPTURE_MARGIN): Quad {
  return expandQuad(shipped(s), margin)
}

/** Share of `card` that survives into `capture`. 1.0 means the JPEG contains
 *  every pixel of the labelled card; the shortfall is card no downstream stage
 *  can recover. */
function coverage(capture: Quad, card: readonly [number, number][]): number {
  const a = polyArea(card)
  if (!(a > 0)) return 0
  const inter = clipPoly(card, capture)
  return inter.length >= 3 ? Math.min(1, polyArea(inter) / a) : 0
}

/** The top fifth of the labelled card, in frame pixels: the band that carries
 *  the Stage badge, the name and the HP — the strip whose loss is the failure
 *  the capture margin exists to fix. */
function headerBand(gt: Quad): Quad | null {
  const g = orderQuadForCard(gt)
  if (!g) return null
  const H = solveHomography(
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
    g,
  )
  if (!H) return null
  return [
    applyHomography(H, 0, 0),
    applyHomography(H, 1, 0),
    applyHomography(H, 1, 0.2),
    applyHomography(H, 0, 0.2),
  ]
}

describe('engine over real camera frames', { skip }, () => {
  it('lands on the card, not inside it', async () => {
    const rows = await scored()
    const errs = rows.map((s) => meanDelta(shipped(s), s.gt))
    const q = quantiles(errs)
    const onCard = errs.filter((e) => e <= 12).length
    const detail = rows
      .map((s, i) => `${s.frame.name}=${errs[i].toFixed(1)}`)
      .join(' ')
    assert.ok(q.median <= 13, `median corner error ${q.median.toFixed(1)}px — ${detail}`)
    assert.ok(q.mean <= 21, `mean corner error ${q.mean.toFixed(1)}px — ${detail}`)
    assert.ok(onCard >= 10, `only ${onCard}/${rows.length} frames within 12px — ${detail}`)
  })

  it('does not return a SMALLER rectangle than the card — the interior lock', async () => {
    // THE REGRESSION FENCE. The bug this file was written for did not look like
    // noise, it looked like a systematic shrink: the model returning the card's
    // art window scores ~0.89 here, the outer boundary ~0.99. Corner error alone
    // would have called that "a bit worse"; this calls it what it is.
    const rows = await scored()
    const scales = rows.map((s) => Math.sqrt(polyArea(shipped(s)) / polyArea(s.gt)))
    const mean = scales.reduce((a, b) => a + b, 0) / scales.length
    const shrunk = scales.filter((x) => x < 0.95).length
    const detail = rows.map((s, i) => `${s.frame.name}=${scales[i].toFixed(2)}`).join(' ')
    assert.ok(mean >= 0.95, `mean linear scale ${mean.toFixed(3)} vs ground truth — ${detail}`)
    assert.ok(shrunk <= 8, `${shrunk}/${rows.length} quads more than 5% too small — ${detail}`)
  })

  it('agrees with the probe baseline where the probe was on-card', async () => {
    // The probe (whole frame, stretched) is the preprocessing that measured
    // 85.5% on-card live. Where it was right, the engine must be looking at the
    // same rectangle: this is the assertion that the reticle/letterbox/mapping
    // chain has not introduced an offset or a scale of its own.
    const rows = await scored()
    const on = rows.filter((s) => meanDelta(s.probe, s.gt) <= 12)
    assert.ok(on.length >= 10, `only ${on.length} baseline-on-card frames to compare against`)
    const d = on.map((s) => meanDelta(shipped(s), s.probe))
    const q = quantiles(d)
    const detail = on.map((s, i) => `${s.frame.name}=${d[i].toFixed(1)}`).join(' ')
    assert.ok(q.median <= 6.5, `median engine-vs-probe corner delta ${q.median.toFixed(1)}px — ${detail}`)
    // Two frames sit outside that: the model genuinely resolves them
    // differently under a letterbox than under a stretch, and on both of them
    // the ENGINE is the one closer to ground truth. So the per-frame bound is
    // loose and the fence is the count.
    assert.ok(
      d.filter((x) => x <= 12).length >= on.length - 3,
      `too many frames disagree with the baseline by >12px — ${detail}`,
    )
  })

  it('beats the reticle-cropped pipeline it replaced', async () => {
    const rows = await scored()
    const now = rows.map((s) => meanDelta(shipped(s), s.gt))
    const was = rows.map((s) => meanDelta(s.retCrop, s.gt))
    const mNow = now.reduce((a, b) => a + b, 0) / now.length
    const mWas = was.reduce((a, b) => a + b, 0) / was.length
    const better = now.filter((v, i) => v < was[i]).length
    assert.ok(mNow < mWas - 5, `full-frame mean ${mNow.toFixed(1)}px vs reticle-crop ${mWas.toFixed(1)}px`)
    assert.ok(better >= 12, `full-frame better on only ${better}/${rows.length} frames`)
    // And the shrink, which is the mechanism rather than the symptom.
    const sNow = rows.map((s) => Math.sqrt(polyArea(shipped(s)) / polyArea(s.gt)))
    const sWas = rows.map((s) => Math.sqrt(polyArea(s.retCrop) / polyArea(s.gt)))
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
    assert.ok(avg(sNow) > avg(sWas) + 0.05, `scale ${avg(sWas).toFixed(3)} -> ${avg(sNow).toFixed(3)}`)
  })

  it('refines within its leash, on real edges', async () => {
    // The refiner is a POLISH layer, and the failure this test guards is the one
    // that shipped: a leash long enough to reach the sleeve rim or the card's
    // printed inner border, at which point it is not polishing, it is choosing.
    const rows = await scored()
    const budget = REFINE_DEFAULTS.maxMove * REFINE_PASS_HALVES.length
    for (const s of rows) {
      if (!s.refined) continue
      const moved = maxDelta(s.raw, s.refined)
      assert.ok(moved <= budget + 1e-6, `${s.frame.name}: refiner moved a corner ${moved.toFixed(1)}px (budget ${budget})`)
    }
    // ...and across the corpus it must not be making things worse on net, which
    // is what a 14px leash measurably did.
    const dRaw = rows.map((s) => meanDelta(s.raw, s.gt))
    const dRef = rows.map((s) => meanDelta(shipped(s), s.gt))
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
    assert.ok(avg(dRef) <= avg(dRaw) + 0.25, `refiner cost ${(avg(dRef) - avg(dRaw)).toFixed(2)}px of mean accuracy`)
  })

  it('sends the WHOLE card — the capture margin', async () => {
    // THE FENCE FOR THE OTHER HALF OF THE CAPTURE. Every assertion above scores
    // the QUAD; this one scores the JPEG. Blind verification of the fixed engine
    // put 95% of quads on the card and still found 13 of 17 near-miss captures
    // missing the card's name/HP header, because a quad that is a hair inside
    // the true edge makes a capture that is a hair short of the card — and the
    // server trims background but cannot restore card.
    const rows = await scored()
    const at = (m: number) => rows.map((s) => coverage(captured(s, m), s.gt))
    const exact = at(0)
    const withM = at(CAPTURE_MARGIN)
    const n = (xs: number[], t: number) => xs.filter((c) => c >= t).length
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
    const detail = rows.map((s, i) => `${s.frame.name}=${withM[i].toFixed(3)}`).join(' ')
    // Measured at the shipping 5%: 11/19 whole cards against 0/19 exact-cropped.
    assert.ok(
      n(withM, 0.999) >= n(exact, 0.999) + 8,
      `the margin rescued only ${n(withM, 0.999) - n(exact, 0.999)} frames (${n(exact, 0.999)} -> ${n(withM, 0.999)} whole cards) — ${detail}`,
    )
    assert.ok(n(withM, 0.999) >= 9, `only ${n(withM, 0.999)}/${rows.length} captures contain the whole card — ${detail}`)
    assert.ok(avg(withM) >= 0.96, `mean card coverage ${avg(withM).toFixed(3)} — ${detail}`)

    // ...and specifically the strip that was going missing. This is the one
    // that would have failed BEFORE the margin: 0/19 exact-cropped captures
    // hold the whole header band, 13/19 hold it at 5%.
    const band = (m: number) =>
      rows.map((s) => {
        const b = headerBand(s.gt)
        assert.ok(b, `${s.frame.name}: header band did not build`)
        return coverage(captured(s, m), b)
      })
    const hExact = band(0)
    const hdr = band(CAPTURE_MARGIN)
    const hDetail = rows.map((s, i) => `${s.frame.name}=${hdr[i].toFixed(3)}`).join(' ')
    assert.ok(
      n(hdr, 0.99) >= n(hExact, 0.99) + 8,
      `the margin rescued only ${n(hdr, 0.99) - n(hExact, 0.99)} header bands (${n(hExact, 0.99)} -> ${n(hdr, 0.99)}) — ${hDetail}`,
    )
    assert.ok(
      n(hdr, 0.99) >= 11,
      `only ${n(hdr, 0.99)}/${rows.length} captures keep the card's header band — ${hDetail}`,
    )
    assert.ok(avg(hdr) >= 0.88, `mean header-band coverage ${avg(hdr).toFixed(3)} — ${hDetail}`)
  })

  it('rectifies ground-truth quads to clean frontal cards', async () => {
    // Rectification validated in isolation, on the labels rather than on the
    // model's output, so a bad capture can never be blamed on the warp without
    // evidence. Every one of these — including a card presented rotated ~40deg
    // (F059) — must come back upright, card-shaped, and full of card.
    const rows = await scored()
    for (const s of rows) {
      const ordered = orderQuadForCard(s.gt)
      assert.ok(ordered, `${s.frame.name}: ground truth did not order`)
      // Corner 0 -> 1 is the quad's TOP edge, by position.
      //
      // THIS ASSERTION WAS INVERTED UNTIL 2026-09-04. It used to require the
      // first side to be the SHORT one, on the reasoning that a card's short
      // side is its 63 mm width — true only square-on. Under foreshortening the
      // shorter projected side is the card's HEIGHT, so that rule rotated every
      // tilted capture a quarter turn; the e2e drive measured it on 13/13 real
      // captures. F059 (a card at ~40deg) is exactly such a frame, and it is why
      // this test now asserts the opposite of what it used to.
      // Corner 0 is the corner nearest the frame's top-left, and the cycle runs
      // clockwise from there.
      //
      // NOT asserted here: that corners 0-1 are the two topmost corners. For a
      // card presented near-square-on those coincide, and the e2e-drive
      // regressions assert exactly that on 13 real captures. But F059 is
      // presented at ~40deg, where "the top edge" stops being well defined at
      // all — at 45deg the top-left and top-right corners are equidistant from
      // the top, and any positional rule has to pick one. That ambiguity is a
      // property of the problem, not of this implementation, and the 180deg/90deg
      // residual it leaves is documented on orderQuadForCard.
      const minSum = [...s.gt].sort((a, b) => a[0] + a[1] - (b[0] + b[1]))[0]
      assert.deepEqual(ordered[0], minSum, `${s.frame.name}: corner 0 must be the top-left-most corner`)
      let a2 = 0
      for (let i = 0; i < 4; i++) a2 += ordered[i][0] * ordered[(i + 1) % 4][1] - ordered[(i + 1) % 4][0] * ordered[i][1]
      assert.ok(a2 > 0, `${s.frame.name}: ordered corners must wind clockwise`)
      const w = Math.hypot(ordered[1][0] - ordered[0][0], ordered[1][1] - ordered[0][1])
      const h = Math.hypot(ordered[3][0] - ordered[0][0], ordered[3][1] - ordered[0][1])
      // Still card-ish once ordered — a hand-labelled card seen near square-on
      // is; a steeply tilted one is allowed to be further off.
      assert.ok(w / h > 0.3 && w / h < 2.2, `${s.frame.name}: ordered aspect ${(w / h).toFixed(3)}`)

      const src = await loadRGBA(s.frame.png, s.frame.width, s.frame.height)
      const out = rectifyImageData(src, s.gt)
      assert.ok(out, `${s.frame.name}: rectify returned null`)
      assert.equal(out.width, CARD_RECT_WIDTH)
      assert.equal(out.height, CARD_RECT_HEIGHT)
      // A card fills its own rectify: opaque everywhere, and not one flat
      // colour (which is what sampling outside the frame would produce).
      let min = 255
      let max = 0
      for (let i = 0; i < out.data.length; i += 4) {
        assert.equal(out.data[i + 3], 255)
        const v = out.data[i]
        if (v < min) min = v
        if (v > max) max = v
      }
      assert.ok(max - min > 60, `${s.frame.name}: rectified crop is nearly flat (${min}..${max})`)
    }
  })

  it('rectifies what the engine actually produces, at card aspect', async () => {
    const rows = await scored()
    let good = 0
    for (const s of rows) {
      const src = await loadRGBA(s.frame.png, s.frame.width, s.frame.height)
      const out = rectifyImageData(src, shipped(s))
      assert.ok(out, `${s.frame.name}: engine quad did not rectify`)
      // Overlap with the capture the LABEL would have produced. This is the
      // number the downstream perceptual hash actually cares about.
      if (polyIoU(shipped(s), s.gt) >= 0.7) good++
    }
    assert.ok(good >= 13, `only ${good}/${rows.length} engine captures overlap the labelled card by 70%`)
  })
})
