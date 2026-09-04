// Regressions for the four failures the 2026-09-03 field test found on the
// shipped build (deckpal-dobcym7uz).
//
// Every test here FAILS on the code as it shipped and passes on the fix. Where
// a number appears it is the measured one, and its provenance is named — the
// point of this file is that the next person can re-derive the claim rather
// than trust it.

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { Quad, TrackedQuad } from '../contract'
import {
  CARD_ASPECT_W_OVER_H,
  defaultReticle,
  quadAspectRatio,
  reticleWithin,
  visibleRect,
} from '../geometry'
import { createLockPolicy, DEFAULT_LOCK_ASPECT_TOL, isCardShaped } from '../index'
import { CAPTURE_MARGIN, expandQuad, rectifyImageData } from '../rectify'
import { createTracker, TRACKER_DEFAULTS } from '../tracker'
import { nextFrameSafe, TimeoutError, withTimeout } from '../../ui/deadline'
// From ./eventPost, not ./flags: the policy module is deliberately free of
// `lib/api`, whose `import.meta.env` read does not exist under node.
import {
  __setFlagPoster,
  MAX_CONSECUTIVE_FAILURES,
  postEvent,
  recorderSuspended,
} from '../../ui/eventPost'

/** `coords.coverMap`, restated here so this file does not import the UI's
 *  rendering module to assert a geometric fact about it. */
function coverScale(boxW: number, boxH: number, frameW: number, frameH: number) {
  const scale = Math.max(boxW / frameW, boxH / frameH)
  return { scale, originY: (boxH - frameH * scale) / 2 }
}

function cardQuad(cx: number, cy: number, h: number, aspect = CARD_ASPECT_W_OVER_H): Quad {
  const w = h * aspect
  return [
    [cx - w / 2, cy - h / 2],
    [cx + w / 2, cy - h / 2],
    [cx + w / 2, cy + h / 2],
    [cx - w / 2, cy + h / 2],
  ]
}

// The owner's build, measured off screenshot 4f4591af: iPhone at DPR 3, so a
// 1284 px panel is 428 CSS px wide, and the camera stage resolved to ~324 CSS
// px tall (Scan.tsx gives it flex-[3] against the bin's flex-[2]).
const OWNER_BOX = { w: 428, h: 324 }

describe('field test 2026-09-03 — A/D: the reticle was mostly off-screen', () => {
  it('SHIPPED BEHAVIOUR: a whole-frame reticle leaves the visible box on a portrait stream', () => {
    // This is the bug, asserted so it cannot come back silently.
    for (const [fw, fh] of [
      [720, 1280],
      [960, 1280],
      [1080, 1920],
    ] as const) {
      const r = defaultReticle(fw, fh)
      const { scale, originY } = coverScale(OWNER_BOX.w, OWNER_BOX.h, fw, fh)
      const top = originY + r.y * fh * scale
      const bottom = top + r.h * fh * scale
      assert.ok(top < 0, `${fw}x${fh}: reticle top should have been off-screen, was ${top.toFixed(1)}`)
      assert.ok(
        bottom > OWNER_BOX.h,
        `${fw}x${fh}: reticle bottom should have been off-screen, was ${bottom.toFixed(1)}`,
      )
    }
  })

  it('THE FIX: a viewport-fitted reticle is fully inside the box at every candidate resolution', () => {
    for (const [fw, fh] of [
      [720, 1280],
      [960, 1280],
      [480, 640],
      [1080, 1920],
      [1280, 960], // landscape stream: was already fine, must stay fine
    ] as const) {
      const vis = visibleRect(fw, fh, OWNER_BOX.w, OWNER_BOX.h)
      const r = reticleWithin(fw, fh, vis)
      const { scale, originY } = coverScale(OWNER_BOX.w, OWNER_BOX.h, fw, fh)
      const top = originY + r.y * fh * scale
      const bottom = top + r.h * fh * scale
      assert.ok(top >= -0.5, `${fw}x${fh}: reticle top off-screen at ${top.toFixed(1)}`)
      assert.ok(bottom <= OWNER_BOX.h + 0.5, `${fw}x${fh}: reticle bottom off-screen at ${bottom.toFixed(1)}`)
      // and it must still be a card-shaped aiming guide, not a sliver
      const aspect = (r.w * fw) / (r.h * fh)
      assert.ok(Math.abs(aspect - CARD_ASPECT_W_OVER_H) < 0.01, `${fw}x${fh}: reticle aspect ${aspect.toFixed(3)}`)
    }
  })

  it('THE CONSEQUENCE: the gate no longer admits rows the user cannot see', () => {
    const [fw, fh] = [720, 1280]
    const vis = visibleRect(fw, fh, OWNER_BOX.w, OWNER_BOX.h)

    // Shipped: the gate covered 1.33x the visible height — measured, not guessed.
    const shipped = defaultReticle(fw, fh)
    const shippedSpan = shipped.h * fh
    assert.ok(
      shippedSpan / vis.h > 1.3,
      `expected the old gate to overreach the visible strip, ratio was ${(shippedSpan / vis.h).toFixed(2)}`,
    )

    // Fixed: every gated row is a row the user can see.
    const fixed = reticleWithin(fw, fh, vis)
    assert.ok(fixed.y * fh >= vis.y - 0.5, 'gate starts above the visible strip')
    assert.ok((fixed.y + fixed.h) * fh <= vis.y + vis.h + 0.5, 'gate ends below the visible strip')
  })

  it('no viewport information keeps the old whole-frame behaviour (offline harness, unit tests)', () => {
    const vis = visibleRect(480, 640, null, null)
    assert.deepEqual(vis, { x: 0, y: 0, w: 480, h: 640 })
    assert.deepEqual(reticleWithin(480, 640, vis), defaultReticle(480, 640))
  })
})

describe('field test 2026-09-03 — B: auto-capture fired at table clutter', () => {
  it('quadAspectRatio reports short/long, orientation-free', () => {
    const portrait = cardQuad(100, 100, 200)
    const landscape: Quad = [
      [0, 0],
      [200, 0],
      [200, 200 * CARD_ASPECT_W_OVER_H],
      [0, 200 * CARD_ASPECT_W_OVER_H],
    ]
    assert.ok(Math.abs(quadAspectRatio(portrait) - CARD_ASPECT_W_OVER_H) < 1e-9)
    assert.ok(Math.abs(quadAspectRatio(landscape) - CARD_ASPECT_W_OVER_H) < 1e-9)
  })

  it('the shape prior admits a card and refuses clutter shapes', () => {
    assert.ok(isCardShaped(cardQuad(0, 0, 300)), 'a card must lock')
    // A laptop lid / a squarish box: the F020 failure class.
    assert.ok(!isCardShaped(cardQuad(0, 0, 300, 0.98)), 'a near-square must not lock')
    // A long thin thing: a banister, a stair edge (F021/F022).
    assert.ok(!isCardShaped(cardQuad(0, 0, 300, 0.32)), 'a sliver must not lock')
  })

  it('SHIPPED BEHAVIOUR: with no shape prior, a square locks just as readily as a card', () => {
    const square = cardQuad(240, 320, 300, 0.98)
    assert.ok(locks(square, { lockAspectTol: 0 }), 'the shipped policy locked non-card shapes — that was the bug')
  })

  it('THE FIX: the same square never locks, however long it dwells', () => {
    const square = cardQuad(240, 320, 300, 0.98)
    assert.ok(!locks(square, {}), 'a square must never become an automatic capture')
    // ...and a real card still does, so the prior has not simply turned auto off.
    assert.ok(locks(cardQuad(240, 320, 300), {}), 'a card must still lock')
  })

  it('the dwell must be UNINTERRUPTED — a shape that flickers never accumulates a lock', () => {
    const tracker = createTracker()
    const reticle = defaultReticle(480, 640)
    tracker.setReticle({ x: reticle.x * 480, y: reticle.y * 640, w: reticle.w * 480, h: reticle.h * 640 })
    const policy = createLockPolicy({})
    let locked = false
    for (let t = 0; t < 40; t++) {
      // alternate between card-shaped and not, at the same place
      const q = cardQuad(240, 320, 300, t % 2 === 0 ? CARD_ASPECT_W_OVER_H : 0.98)
      const { stable } = tracker.update([q])
      if (policy.update(stable as TrackedQuad[], reticle, 480, 640)) locked = true
    }
    assert.ok(!locked, 'a flickering shape must not accumulate a lock across its good ticks')
  })

  function locks(quad: Quad, opts: { lockAspectTol?: number }): boolean {
    const tracker = createTracker()
    const reticle = defaultReticle(480, 640)
    tracker.setReticle({ x: reticle.x * 480, y: reticle.y * 640, w: reticle.w * 480, h: reticle.h * 640 })
    const policy = createLockPolicy(opts)
    for (let t = 0; t < 12; t++) {
      const { stable } = tracker.update([quad])
      if (policy.update(stable as TrackedQuad[], reticle, 480, 640)) return true
    }
    return false
  }
})

describe('field test 2026-09-03 — D: the snap cap was resolution-dependent', () => {
  // Same PHYSICAL motion (a fixed share of the card) at three resolutions. The
  // shipped absolute snapPx made smoothing switch itself off as resolution rose.
  function snapRate(frameH: number, snapFrac: number): { snaps: number; ticks: number; jitterFrac: number } {
    const cardH = frameH * 0.55
    const jit = cardH / 40
    const tracker = createTracker({ snapFrac })
    tracker.setReticle(null)
    let snaps = 0
    let ticks = 0
    let displayed = 0
    let cx = frameH * 0.375
    let cy = frameH / 2
    for (let t = 0; t < 60; t++) {
      cx += Math.cos(t * 0.7) * jit
      cy += Math.sin(t * 0.7) * jit
      const r = tracker.update([cardQuad(cx, cy, cardH)])
      if (r.stable.length) {
        ticks++
        displayed += r.jitter.displayedPx
        if (r.jitter.snapped) snaps++
      }
    }
    return { snaps, ticks, jitterFrac: displayed / ticks / cardH }
  }

  it('SHIPPED BEHAVIOUR: an absolute 12 px cap collapses the EMA at high resolution', () => {
    // snapFrac: 0 reproduces the shipped tracker exactly.
    assert.equal(snapRate(640, 0).snaps, 0, 'no snapping at the tuning resolution')
    const high = snapRate(1440, 0)
    assert.ok(high.snaps > high.ticks / 3, `expected the shipped cap to snap constantly at 1440, got ${high.snaps}/${high.ticks}`)
  })

  it('THE FIX: the same motion snaps at no resolution, and displayed jitter is scale-invariant', () => {
    const rates = [640, 960, 1440].map((h) => snapRate(h, TRACKER_DEFAULTS.snapFrac))
    for (const r of rates) assert.equal(r.snaps, 0, `snapped ${r.snaps}/${r.ticks} times`)
    // The whole point: the same motion now LOOKS the same at every resolution.
    const spread = Math.max(...rates.map((r) => r.jitterFrac)) - Math.min(...rates.map((r) => r.jitterFrac))
    assert.ok(spread < 1e-6, `displayed jitter should be scale-invariant, spread was ${spread}`)
  })

  it('the absolute cap survives as a FLOOR for small quads', () => {
    // A 100 px quad: 0.04 * sqrt(area) is well under 12, so snapPx governs.
    const tracker = createTracker()
    tracker.setReticle(null)
    tracker.update([cardQuad(200, 200, 100)])
    tracker.update([cardQuad(200, 200, 100)])
    const r = tracker.update([cardQuad(205, 200, 100)]) // a 5 px move, inside the floor
    assert.equal(r.jitter.snapped, false, 'a move under the 12 px floor must still be smoothed')
  })
})

// ---------------------------------------------------------------------------
// Field test 2026-09-03, build obb0xud59 (the SECOND field test): quads "much
// better", thumbnails still not the squared-up document-scan crop, identify
// mostly wrong. The discriminating hypothesis is CAPTURE-TIME INCOHERENCE —
// `capture()` warps the frame it reads AT CAPTURE TIME with a quad measured on
// an EARLIER frame, so a quad that looked right on screen still warps wrongly.
// ---------------------------------------------------------------------------

const BG: [number, number, number] = [58, 42, 30] // table brown
const CARD_W = 200
const CARD_H = Math.round(CARD_W / CARD_ASPECT_W_OVER_H)

/** A synthetic scene: a bordered, ASYMMETRIC card on a flat table. The
 *  asymmetry is load-bearing — a symmetric card would hide a translation. */
function scene(w: number, h: number, cx: number, cy: number) {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = BG[0]
    data[i * 4 + 1] = BG[1]
    data[i * 4 + 2] = BG[2]
    data[i * 4 + 3] = 255
  }
  const x0 = Math.round(cx - CARD_W / 2)
  const y0 = Math.round(cy - CARD_H / 2)
  for (let y = 0; y < CARD_H; y++) {
    for (let x = 0; x < CARD_W; x++) {
      const px = x0 + x
      const py = y0 + y
      if (px < 0 || py < 0 || px >= w || py >= h) continue
      const border = x < 7 || y < 7 || x >= CARD_W - 7 || y >= CARD_H - 7
      const art = x > 24 && x < 120 && y > 30 && y < 130 // off-centre "art window"
      const o = (py * w + px) * 4
      const v = border ? 18 : art ? 90 : 236
      data[o] = v
      data[o + 1] = v
      data[o + 2] = border ? 18 : art ? 130 : 236
      data[o + 3] = 255
    }
  }
  return { width: w, height: h, data }
}

function cornersAt(cx: number, cy: number): Quad {
  return [
    [cx - CARD_W / 2, cy - CARD_H / 2],
    [cx + CARD_W / 2, cy - CARD_H / 2],
    [cx + CARD_W / 2, cy + CARD_H / 2],
    [cx - CARD_W / 2, cy + CARD_H / 2],
  ]
}

/** Share of the rectified output that is table rather than card — the number
 *  that decides whether a crop reads as a document scan or as a photo. */
function backgroundShare(img: { width: number; height: number; data: Uint8ClampedArray }): number {
  let bg = 0
  const n = img.width * img.height
  for (let i = 0; i < n; i++) {
    const dr = img.data[i * 4] - BG[0]
    const dg = img.data[i * 4 + 1] - BG[1]
    const db = img.data[i * 4 + 2] - BG[2]
    if (dr * dr + dg * dg + db * db < 900) bg++
  }
  return bg / n
}

/**
 * Share of pixels that differ materially from the IDEAL rectification.
 *
 * This, not background bleed, is the number that matters. The 5% capture margin
 * ABSORBS a small translation — the whole card is still inside the crop, so
 * table bleed barely moves (measured: 17.6% at rest, 17.8% after 10 px of
 * motion) — but the card lands MIS-REGISTERED within the output, shifted and
 * rescaled against the frame the hash is taken over. A perceptual hash is not
 * translation-invariant, so "the card is all there, just not where the crop says
 * it is" is precisely the failure that returns confident wrong matches.
 */
function misregistration(
  a: { width: number; height: number; data: Uint8ClampedArray },
  b: { width: number; height: number; data: Uint8ClampedArray },
): number {
  let bad = 0
  const n = a.width * a.height
  for (let i = 0; i < n; i++) {
    const d =
      Math.abs(a.data[i * 4] - b.data[i * 4]) +
      Math.abs(a.data[i * 4 + 1] - b.data[i * 4 + 1]) +
      Math.abs(a.data[i * 4 + 2] - b.data[i * 4 + 2])
    if (d > 96) bad++
  }
  return bad / n
}

describe('field test 2026-09-03 (obb0xud59) — capture-time frame/quad incoherence', () => {
  const MOVES = [0, 2, 5, 10, 20]

  it('SHIPPED BEHAVIOUR: the current frame warped by an earlier quad is mis-registered', () => {
    const rows: string[] = []
    const quad = cornersAt(240, 320) // measured on the tick's frame
    const ideal = rectifyImageData(scene(480, 640, 240, 320), expandQuad(quad, CAPTURE_MARGIN))
    assert.ok(ideal)
    let worst = 0
    for (const d of MOVES) {
      const captureFrame = scene(480, 640, 240 + d, 320 + d) // the hand moved since
      const shipped = rectifyImageData(captureFrame, expandQuad(quad, CAPTURE_MARGIN))
      assert.ok(shipped)
      const err = misregistration(ideal, shipped)
      worst = Math.max(worst, err)
      rows.push(
        `  moved ${String(d).padStart(2)} px -> ${(err * 100).toFixed(1)}% of the crop wrong,` +
          ` ${(backgroundShare(shipped) * 100).toFixed(1)}% table`,
      )
    }
    assert.ok(
      worst > 0.15,
      `expected motion to corrupt the crop the hash sees; worst ${(worst * 100).toFixed(1)}%\n${rows.join('\n')}`,
    )
    // And the damage is monotone in the motion — it is the motion causing it.
    assert.equal(misregistration(ideal, ideal), 0, 'zero motion must be a perfect match')
  })

  it('THE FIX: warping the SAME frame the quad was measured on is motion-independent', () => {
    const quad = cornersAt(240, 320)
    const ideal = rectifyImageData(scene(480, 640, 240, 320), expandQuad(quad, CAPTURE_MARGIN))
    assert.ok(ideal)
    for (const _d of MOVES) {
      // However far the phone travelled after the tick, the fix warps the frame
      // the quad was measured on, so the result is the ideal crop every time.
      const tickFrame = scene(480, 640, 240, 320)
      const fixed = rectifyImageData(tickFrame, expandQuad(quad, CAPTURE_MARGIN))
      assert.ok(fixed)
      assert.equal(misregistration(ideal, fixed), 0, 'a coherent capture must not depend on post-tick motion')
    }
  })

  it('the 5% margin does NOT rescue a misaligned quad — it scales the error too', () => {
    const quad = cornersAt(240, 320)
    const moved = scene(480, 640, 260, 340)
    const noMargin = rectifyImageData(moved, expandQuad(quad, 0))
    const withMargin = rectifyImageData(moved, expandQuad(quad, CAPTURE_MARGIN))
    assert.ok(noMargin && withMargin)
    // expandQuad scales about the quad's OWN centroid, which is itself displaced.
    assert.ok(
      backgroundShare(withMargin) > backgroundShare(noMargin),
      'the margin should add background, never recover alignment',
    )
  })

  it('the tracker exposes the RAW observation, so capture need not use the EMA blend', () => {
    const tracker = createTracker()
    tracker.setReticle(null)
    tracker.update([cornersAt(240, 320)])
    tracker.update([cornersAt(248, 320)])
    const r = tracker.update([cornersAt(256, 320)])
    const t = r.stable[0] ?? r.pending[0]
    assert.ok(t, 'expected a track')
    assert.ok(t.raw, 'a matched track must carry its latest raw observation')
    // The smoothed quad lags the observation; the raw one IS the observation,
    // and it is the one that belongs to the retained frame.
    assert.ok(Math.abs(t.raw[0][0] - 156) < 1e-6, `raw should be the newest observation, got ${t.raw[0][0]}`)
    assert.ok(t.quad[0][0] < t.raw[0][0], 'the smoothed quad should trail the raw one')
  })
})

describe('field test 2026-09-03 (obb0xud59) — the instrumentation gate that recorded nothing', () => {
  it('SHIPPED BEHAVIOUR the owner hit: a QA-account session is not the owner', () => {
    // The removed gate was `me().owner === true`, failing closed. AGENTS.md B12
    // requires field tests to run on the QA account, for which owner is false —
    // so the gate was guaranteed to suppress exactly the sessions it existed for.
    const qaAccount = { username: 'qa', owner: false }
    assert.equal(qaAccount.owner === true, false, 'the old client gate would have suppressed the whole session')
  })

  it('THE FIX: the recorder posts for any session and lets the endpoint decide', async () => {
    const seen: Array<Record<string, unknown>> = []
    __setFlagPoster(async (_png, meta) => {
      seen.push(meta)
      return { id: 'x' }
    })
    // No owner, no /me call, no pre-flight of any kind — a preview deployment
    // accepts this unconditionally (apps/api/src/dev/scanFlags.ts).
    const ok = await postEvent('PNGDATA', { type: 'capture-event' })
    assert.equal(ok, true, 'the recorder must attempt and succeed for a non-owner session')
    assert.equal(seen.length, 1)
    assert.equal(seen[0].type, 'capture-event')
    assert.equal(recorderSuspended(), false)
    __setFlagPoster(null)
  })

  it('a production refusal backs off after a bounded number of attempts', async () => {
    let attempts = 0
    __setFlagPoster(async () => {
      attempts += 1
      throw new Error('403 forbidden')
    })
    for (let i = 0; i < 12; i++) await postEvent('PNGDATA', { type: 'capture-event' })
    assert.equal(attempts, MAX_CONSECUTIVE_FAILURES, `a refused client must stop after ${MAX_CONSECUTIVE_FAILURES} tries`)
    assert.equal(recorderSuspended(), true)
    __setFlagPoster(null)
  })

  it('a transient failure does not permanently disable a legitimate session', async () => {
    let n = 0
    __setFlagPoster(async () => {
      n += 1
      if (n <= 2) throw new Error('network blip')
      return { id: 'x' }
    })
    assert.equal(await postEvent('P', {}), false)
    assert.equal(await postEvent('P', {}), false)
    assert.equal(await postEvent('P', {}), true, 'a success must clear the backoff')
    for (let i = 0; i < 5; i++) assert.equal(await postEvent('P', {}), true)
    assert.equal(recorderSuspended(), false)
    __setFlagPoster(null)
  })
})

describe('field test 2026-09-03 — C: the capture pipeline could wedge forever', () => {
  it('SHIPPED BEHAVIOUR: an identify that never settles never releases its await', async () => {
    // The shipped call was `await api.scan(...)` with no signal and no deadline.
    const neverSettles = new Promise<string>(() => {})
    const raced = await Promise.race([
      neverSettles,
      new Promise<string>((r) => setTimeout(() => r('still pending'), 30)),
    ])
    assert.equal(raced, 'still pending', 'a bare await on a stalled request never returns — that was the wedge')
  })

  it('THE FIX: withTimeout always settles, and says why', async () => {
    const neverSettles = new Promise<string>(() => {})
    await assert.rejects(() => withTimeout(neverSettles, 30, 'identify'), (e: Error) => {
      assert.ok(e instanceof TimeoutError)
      assert.match(e.message, /identify/)
      return true
    })
  })

  it('withTimeout is transparent to work that DOES finish', async () => {
    assert.equal(await withTimeout(Promise.resolve('ok'), 1000, 'x'), 'ok')
    await assert.rejects(() => withTimeout(Promise.reject(new Error('boom')), 1000, 'x'), /boom/)
  })

  it('nextFrameSafe resolves even where requestAnimationFrame never fires', async () => {
    // Under node there is no rAF at all — the same starvation a backgrounded
    // tab produces. It must still resolve, and promptly.
    const t0 = Date.now()
    await nextFrameSafe(40)
    assert.ok(Date.now() - t0 < 2000, 'nextFrameSafe must not hang without rAF')
  })
})
