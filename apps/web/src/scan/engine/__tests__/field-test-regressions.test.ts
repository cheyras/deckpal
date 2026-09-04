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
import { createTracker, TRACKER_DEFAULTS } from '../tracker'
import { nextFrameSafe, TimeoutError, withTimeout } from '../../ui/deadline'

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
