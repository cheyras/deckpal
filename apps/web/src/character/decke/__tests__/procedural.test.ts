/**
 * Parity tests for the procedural layers against the upstream Python.
 *
 * The reproducibility argument for this whole subsystem is that Blender and the
 * browser draw the SAME pseudo-random numbers in the SAME order. If the draw
 * order drifts, the blink and gaze schedules diverge and nothing visible will
 * tell you — he will simply blink at different moments than the reference
 * render, and every frame-by-frame comparison after that is noise.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'
import { Blinker, IdleFloat, Rng } from '../procedural'
import type { PlaybookDoc } from '../playbook'

const here = dirname(fileURLToPath(import.meta.url))
const fx = JSON.parse(
  readFileSync(resolve(here, '../../../../scripts/decke/proc-fixture.json'), 'utf8'),
)
const doc: PlaybookDoc = JSON.parse(
  readFileSync(resolve(here, '../../../../public/models/decke/playbook.json'), 'utf8'),
)

test('the playbook carries the same procedural constants as the Python', () => {
  const f = doc.procedural.idle_float
  assert.equal(f.base_hz, fx.idle.f0)
  assert.deepEqual(f.ratios, fx.idle.ratios)
  assert.deepEqual(f.weights, fx.idle.weights)
  assert.deepEqual(f.amplitude, fx.idle.amp)
  for (const c of Object.keys(fx.idle.phi)) {
    assert.deepEqual(f.phase[c], fx.idle.phi[c], `phase ${c}`)
  }
  const p = doc.procedural.prng
  assert.equal(p.seed, fx.prng.seed)
  assert.equal(p.a, fx.prng.a)
  assert.equal(p.m, fx.prng.m)
})

test('the PRNG reproduces the Python sequence exactly', () => {
  const p = doc.procedural.prng
  const rng = new Rng(p.seed, p.a, p.m)
  for (let i = 0; i < fx.prng.sequence.length; i++) {
    const mine = rng.next()
    assert.ok(
      Math.abs(mine - fx.prng.sequence[i]) < 1e-15,
      `draw ${i}: ${mine} != ${fx.prng.sequence[i]}`,
    )
  }
})

test('the PRNG is exact in double precision (no BigInt needed)', () => {
  // s < 2^31 and a = 48271, so s*a < 2^47 — comfortably inside 2^53. This test
  // exists because "optimising" it into BigInt or a 32-bit mask is a tempting
  // and wrong change.
  const p = doc.procedural.prng
  const rng = new Rng(p.seed, p.a, p.m)
  let maxProduct = 0
  for (let i = 0; i < 5000; i++) {
    const before = (rng as unknown as { s: number }).s
    maxProduct = Math.max(maxProduct, before * p.a)
    rng.next()
  }
  assert.ok(maxProduct < Number.MAX_SAFE_INTEGER, `product reached ${maxProduct}`)
})

test('the idle float matches the Python on every channel and sample', () => {
  const f = new IdleFloat(doc)
  let worst = 0
  let where = ''
  for (const ch of Object.keys(fx.idle.values)) {
    const expected: number[] = fx.idle.values[ch]
    for (let i = 0; i < fx.idle.times.length; i++) {
      const mine = f.channel(ch, fx.idle.times[i])
      const d = Math.abs(mine - expected[i])
      if (d > worst) {
        worst = d
        where = `${ch} @ t=${fx.idle.times[i]}s`
      }
    }
  }
  assert.ok(worst < 1e-12, `worst idle error ${worst} at ${where}`)
})

test('the idle float never repeats, which is the whole point of it', () => {
  // Irrational frequency ratios mean the composite has no period. If someone
  // "simplifies" the ratios to something rational this catches it: a repeat
  // would show up as the state at t and t+period being identical.
  const f = new IdleFloat(doc)
  const sample = (t: number) =>
    ['x', 'y', 'z', 'rx', 'ry', 'rz'].map((c) => f.channel(c, t))

  const a = sample(3.3)
  for (const period of [1.9, 3.8, 5.7, 7.6, 11.4]) {
    const b = sample(3.3 + period)
    const same = a.every((v, i) => Math.abs(v - b[i]) < 1e-6)
    assert.ok(!same, `the float repeated after ${period}s`)
  }
})

test('the blink curve matches the Python, and is asymmetric', () => {
  const p = doc.procedural.prng
  const b = new Blinker(doc, new Rng(p.seed, p.a, p.m))
  let worst = 0
  for (let i = 0; i < fx.blink.curve_t_ms.length; i++) {
    const mine = b.curve(fx.blink.curve_t_ms[i])
    worst = Math.max(worst, Math.abs(mine - fx.blink.curve[i]))
  }
  assert.ok(worst < 1e-12, `worst blink-curve error ${worst}`)

  // Closing takes 70 ms and opening 120 ms. That asymmetry is most of what
  // sells the blink, so assert the shape rather than just the samples.
  const total = fx.blink.close_ms + fx.blink.hold_ms + fx.blink.open_ms
  const shutStart = fx.blink.close_ms + fx.blink.hold_ms

  // Time taken to travel the first half of each phase.
  const closeToHalf = fx.blink.curve_t_ms.find((t: number) => b.curve(t) >= 0.5)!
  const openToHalf =
    fx.blink.curve_t_ms
      .filter((t: number) => t > shutStart)
      .find((t: number) => b.curve(t) <= 0.5)! - shutStart

  assert.ok(closeToHalf < 40, `should snap shut fast, reached half at ${closeToHalf}ms`)
  assert.ok(
    openToHalf > closeToHalf * 2,
    `opening (${openToHalf}ms to half) must be markedly slower than closing (${closeToHalf}ms)`,
  )
  assert.equal(b.curve(shutStart - 1), 1, 'must be fully shut through the hold')
  assert.equal(b.curve(-1), 0)
  assert.equal(b.curve(total + 1), 0)
})

test('the blink schedule reproduces the Python draw-for-draw', () => {
  // Rebuild the schedule with the same algorithm and the same fresh RNG, and
  // compare against the Python's. This is the test that catches a reordered
  // draw — the single most likely way this layer silently desyncs.
  const p = doc.procedural.prng
  const rng = new Rng(p.seed, p.a, p.m)
  const cfg = doc.procedural.blink
  const out: number[] = []
  const durationS = 120
  let t = rng.range(cfg.first_offset_s[0], cfg.first_offset_s[1])
  const span = (cfg.close_ms + cfg.hold_ms + cfg.open_ms + cfg.double_gap_ms) / 1000
  while (t < durationS) {
    out.push(t)
    if (rng.next() < cfg.double_p) {
      const t2 = t + span
      if (t2 < durationS) out.push(t2)
      t = t2
    }
    t += rng.range(cfg.interval_s[0], cfg.interval_s[1])
  }

  const expected: number[] = fx.blink.schedule_120s
  assert.equal(out.length, expected.length, 'blink count differs')
  for (let i = 0; i < expected.length; i++) {
    assert.ok(
      Math.abs(out[i] - expected[i]) < 1e-12,
      `blink ${i}: ${out[i]} != ${expected[i]}`,
    )
  }
})

test('the recalibrated gaze amplitudes are in the data, not the stale wiki ones', () => {
  // The wiki documents 0.16 / 0.11; those were measured to move the pupil about
  // one pixel and were recalibrated to 0.68 / 0.46. Guard against a well-meaning
  // "fix" back to the documented values.
  assert.equal(doc.procedural.gaze_flit.amp_x, fx.flit.amp_x)
  assert.equal(doc.procedural.gaze_flit.amp_z, fx.flit.amp_z)
  assert.ok(doc.procedural.gaze_flit.amp_x > 0.5, 'flit amp_x should be the recalibrated 0.68')
  assert.deepEqual(doc.procedural.glance_away.amp_x, fx.glance.amp_x)
})

test('gaze-locked states and the alert freeze are both represented', () => {
  assert.ok(doc.gaze_lock.includes('nod_yes'))
  assert.ok(doc.gaze_lock.includes('shake_no'))
  assert.deepEqual(doc.gaze_lock, fx.gaze_lock)
})
