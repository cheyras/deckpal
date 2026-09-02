import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createPresenceGate, DEFAULT_ACQUIRE, DEFAULT_HOLD } from '../gate'

describe('presence gate', () => {
  it('ships the sizes PHASE0-CLOSEOUT §2.7 measured', () => {
    assert.equal(DEFAULT_ACQUIRE, 0.8)
    assert.equal(DEFAULT_HOLD, 0.3)
  })

  it('starts closed and does not open below acquire', () => {
    const g = createPresenceGate()
    assert.equal(g.open, false)
    for (const v of [0, 0.3, 0.5, 0.65, 0.79]) {
      assert.equal(g.update(v), false, `has_obj ${v} must not acquire`)
    }
  })

  it('opens at acquire and holds all the way down to hold', () => {
    const g = createPresenceGate()
    assert.equal(g.update(0.8), true)
    for (const v of [0.79, 0.65, 0.5, 0.35, 0.3]) {
      assert.equal(g.update(v), true, `has_obj ${v} must hold`)
    }
    assert.equal(g.update(0.29), false)
    assert.equal(g.open, false)
  })

  it('the hysteresis band is genuinely two-valued: the same input, both answers', () => {
    // 0.5 is the probe's old single threshold and the middle of the band where
    // PHASE0-CLOSEOUT §2.7 found the ENTIRE error population lives.
    const closed = createPresenceGate()
    assert.equal(closed.update(0.5), false, 'from closed, 0.5 stays closed')

    const opened = createPresenceGate()
    opened.update(0.95)
    assert.equal(opened.update(0.5), true, 'from open, 0.5 stays open')
  })

  it('re-acquiring after a close needs the full acquire threshold again', () => {
    const g = createPresenceGate()
    g.update(0.9)
    g.update(0.1) // closed
    assert.equal(g.open, false)
    assert.equal(g.update(0.7), false, 'a hold-level value must not re-open a closed gate')
    assert.equal(g.update(0.85), true)
  })

  it('does not rescue misses — the measured miss band never acquires', () => {
    // The 9 live misses sat at has_obj 0.001-0.365 (§2.7). No threshold pair
    // that keeps rejections silent can recover them, and this pins that the
    // shipped pair does not pretend to.
    const g = createPresenceGate()
    for (const v of [0.001, 0.09, 0.192, 0.28, 0.365]) {
      assert.equal(g.update(v), false, `miss-band ${v} must not acquire`)
    }
  })

  it('closes on a non-finite reading rather than latching open', () => {
    const g = createPresenceGate()
    g.update(0.99)
    assert.equal(g.update(Number.NaN), false)
    assert.equal(g.open, false)
  })

  it('reset() closes it', () => {
    const g = createPresenceGate()
    g.update(0.99)
    g.reset()
    assert.equal(g.open, false)
    assert.equal(g.update(0.5), false)
  })

  it('accepts custom thresholds and clamps an inverted pair', () => {
    const g = createPresenceGate(0.65, 0.35)
    assert.equal(g.update(0.5), false)
    assert.equal(g.update(0.65), true)
    assert.equal(g.update(0.35), true)
    assert.equal(g.update(0.34), false)

    // hold above acquire would be a latch with a surprising sign.
    const weird = createPresenceGate(0.5, 0.9)
    assert.equal(weird.update(0.5), true)
    assert.equal(weird.update(0.5), true, 'hold is clamped to acquire, not left above it')
  })
})
