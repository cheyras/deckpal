import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { DEFAULT_SECOND_LOOK } from '../index'
import {
  DEFAULT_SECOND_LOOK_AGREE_IOU,
  DEFAULT_SECOND_LOOK_SCALE,
  mergeSecondLook,
  SECOND_LOOK_MIN_SIDE,
  secondLookCrop,
  secondLookPointsToSquare,
  secondLookRect,
} from '../second-look'

/** A card-shaped quad (TL, TR, BR, BL) in fractions of the square. */
const card = (x0: number, y0: number, w: number, h: number) => [x0, y0, x0 + w, y0, x0 + w, y0 + h, x0, y0 + h]
const close = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`)
/** The frame.reticleForAspect default, in fractions. */
const RETICLE = { x: 0.185, y: 0.06, w: 0.63, h: 0.88 }

describe('second look', () => {
  it('ships OFF, at the measured scale and agreement', () => {
    assert.equal(DEFAULT_SECOND_LOOK, false)
    assert.equal(DEFAULT_SECOND_LOOK_SCALE, 1.3)
    assert.equal(DEFAULT_SECOND_LOOK_AGREE_IOU, 0.5)
  })

  it('crops a square centred on the quad, scale x its larger extent', () => {
    const r = secondLookRect(card(0.35, 0.3, 0.3, 0.42))!
    close(r.w, 1.3 * 0.42)
    close(r.h, r.w)
    close(r.x + r.w / 2, 0.5)
    close(r.y + r.h / 2, 0.51)
  })

  it('slides the crop inside the square instead of padding or shrinking it', () => {
    // A card low and right, as WuheDPVq_Bo holds them: the crop keeps its size
    // and stops at the square's edges.
    const r = secondLookRect(card(0.55, 0.5, 0.4, 0.48))!
    close(r.w, 1.3 * 0.48)
    close(r.x + r.w, 1)
    close(r.y + r.h, 1)
    // Never larger than the square.
    const big = secondLookRect(card(0.05, 0.05, 0.9, 0.9))!
    assert.deepEqual(big, { x: 0, y: 0, w: 1, h: 1 })
  })

  it('never crops below the minimum side', () => {
    const r = secondLookRect(card(0.48, 0.48, 0.03, 0.04))!
    close(r.w, SECOND_LOOK_MIN_SIDE)
  })

  it('has nothing to look at without four finite, non-degenerate corners', () => {
    assert.equal(secondLookRect([0.1, 0.1, 0.2]), null)
    assert.equal(secondLookRect([0.1, 0.1, 0.2, NaN, 0.3, 0.3, 0.1, 0.3]), null)
    assert.equal(secondLookRect([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]), null)
  })

  it('maps the crop\'s points back to the square exactly', () => {
    const crop = { x: 0.2, y: 0.1, w: 0.5, h: 0.5 }
    const inCrop = [0, 0, 1, 0, 1, 1, 0, 1]
    assert.deepEqual(secondLookPointsToSquare(inCrop, crop), [0.2, 0.1, 0.7, 0.1, 0.7, 0.6, 0.2, 0.6])
  })

  it('looks again only below acquire, and only at a quad centred in the reticle', () => {
    const centred = card(0.35, 0.3, 0.3, 0.42)
    assert.equal(secondLookCrop({ points: centred, hasObj: 0.8 }, { acquire: 0.8, reticle: RETICLE }), null)
    assert.equal(secondLookCrop({ points: centred, hasObj: 0.95 }, { acquire: 0.8, reticle: RETICLE }), null)
    assert.ok(secondLookCrop({ points: centred, hasObj: 0.1 }, { acquire: 0.8, reticle: RETICLE }))
    // A quad whose centroid is outside the reticle: the tracker would drop it.
    const offCentre = card(0.02, 0.3, 0.12, 0.2)
    assert.equal(secondLookCrop({ points: offCentre, hasObj: 0.1 }, { acquire: 0.8, reticle: RETICLE }), null)
  })

  describe('merge', () => {
    const quad = card(0.35, 0.3, 0.3, 0.42)
    const crop = secondLookRect(quad)!
    /** The same card as the crop's model would report it, in crop fractions. */
    const sameInCrop = Array.from({ length: 8 }, (_, i) => (i % 2 ? (quad[i] - crop.y) / crop.h : (quad[i] - crop.x) / crop.w))

    it('keeps the first answer when the second is not more sure', () => {
      for (const h of [0.2, 0.3, NaN]) {
        const m = mergeSecondLook({ points: quad, hasObj: 0.3 }, { points: sameInCrop, hasObj: h }, crop)
        assert.equal(m.used, false)
        assert.equal(m.hasObj, 0.3)
        assert.deepEqual(m.points, quad)
      }
      assert.equal(mergeSecondLook({ points: quad, hasObj: 0.3 }, null, crop).used, false)
    })

    it('takes the crop\'s presence and keeps the first look\'s quad', () => {
      const shifted = sameInCrop.map((v) => v + 0.01)
      const m = mergeSecondLook({ points: quad, hasObj: 0.05 }, { points: shifted, hasObj: 0.97 }, crop)
      assert.equal(m.used, true)
      assert.equal(m.hasObj, 0.97)
      assert.deepEqual(m.points, quad)
      assert.ok(m.iou! > 0.9)
    })

    it('refuses a second look that found a different rectangle', () => {
      // The crop's classic failure: the art window, the top third of the card.
      const artWindow = card(0.37, 0.33, 0.26, 0.15)
      const inCrop = artWindow.map((v, i) => (i % 2 ? (v - crop.y) / crop.h : (v - crop.x) / crop.w))
      const m = mergeSecondLook({ points: quad, hasObj: 0.05 }, { points: inCrop, hasObj: 0.99 }, crop)
      assert.equal(m.used, false)
      assert.equal(m.hasObj, 0.05)
      assert.ok(m.iou! < DEFAULT_SECOND_LOOK_AGREE_IOU)
      // agreeIoU 0 disables the check; keepFirstQuad false takes the crop's quad.
      const loose = mergeSecondLook({ points: quad, hasObj: 0.05 }, { points: inCrop, hasObj: 0.99 }, crop, {
        agreeIoU: 0,
        keepFirstQuad: false,
      })
      assert.equal(loose.used, true)
      loose.points.forEach((v, i) => close(v, artWindow[i]))
    })
  })
})
