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
import { Blinker, FLOAT_RATE_SCALE, Gaze, IdleFloat, Rng } from '../procedural'
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

/**
 * The flit gate — the one procedural constraint that is stated as an invariant
 * rather than as a distribution.
 *
 * "There needs to be like a gate on that, because I do want it to be randomized,
 * but there needs to be like a max frequency. It's at most every half second
 * maybe." A wider interval range is NOT that: a uniform draw satisfies a floor
 * only on average, and the failure it was asked to prevent — two flits back to
 * back, "boom, boom" — is exactly the tail of that distribution.
 */
test('no two gaze flits ever land closer than the gate', () => {
  const p = doc.procedural.prng
  const gaze = new Gaze(doc, new Rng(p.seed, p.a, p.m))
  const out = { gx: 0, gz: 0 }
  // Walk a real ten minutes of clock so the schedule regenerates at least once
  // and the seam between two generated horizons is covered too.
  const seen: number[] = []
  let last = -Infinity
  let minGap = Infinity
  for (let t = 0; t < 600; t += 0.05) {
    gaze.at(t, false, false, out)
    const flits = (gaze as unknown as { flits: { t: number }[] }).flits
    for (const f of flits) {
      if (f.t <= last) continue
      minGap = Math.min(minGap, f.t - last)
      last = f.t
      seen.push(f.t)
    }
  }
  assert.ok(seen.length > 100, `only ${seen.length} flits in 10 minutes`)
  assert.ok(minGap >= 0.9 - 1e-9, `two flits landed ${minGap.toFixed(3)} s apart`)
  // And "overall less frequent" is a real reduction, not a rounding: the
  // authored [0.45, 1.6] averages one flit every 1.02 s.
  const rate = seen.length / seen[seen.length - 1]
  assert.ok(rate < 0.55, `still ${rate.toFixed(2)} flits/s`)
})

test('a flit stays a micro-saccade', () => {
  const p = doc.procedural.prng
  const gaze = new Gaze(doc, new Rng(p.seed, p.a, p.m))
  const flits = (gaze as unknown as { flits: { x: number; z: number }[] }).flits
  // In TARGET units. `look.ts` divides by the eye-to-camera depth (5.06 at the
  // staging camera) and multiplies by GAZE_GAIN, so 0.28 is 12% of the pupil's
  // lateral roam — where the authored 0.68 was 30% of it, per flit.
  let maxX = 0
  let maxZ = 0
  for (const f of flits) {
    maxX = Math.max(maxX, Math.abs(f.x))
    maxZ = Math.max(maxZ, Math.abs(f.z))
  }
  assert.ok(maxX <= 0.28 + 1e-9, `flit x reached ${maxX}`)
  assert.ok(maxZ <= 0.22 + 1e-9, `flit z reached ${maxZ}`)
  // Not so small it is invisible again — the wiki's 0.16/0.11 moved the pupil
  // about a pixel and that was the bug BEFORE this one.
  assert.ok(maxX > 0.2, `flit x never exceeded ${maxX}`)
})

test('the hover is slowed by one multiplier, phase-continuously', () => {
  // "I would have his floating subtle bob be a little bit slower all the time."
  // ALL THE TIME is why this is a scale on the rate rather than an edit to
  // twenty-seven authored `float_rate` values: the relative structure between
  // states (`sleep` 0.4, `loading` 1.35) was right; the tempo was not.
  assert.ok(FLOAT_RATE_SCALE < 1 && FLOAT_RATE_SCALE > 0.5)

  const f = new IdleFloat(doc)
  f.advance(1, 1)
  assert.ok(Math.abs(f.tau - FLOAT_RATE_SCALE) < 1e-12, `tau ${f.tau}`)

  // And a rate CHANGE does not move the clock, which is what keeps a state
  // entry from putting a pop on the hover. Same rule the class documents.
  const before = f.tau
  f.advance(0, 0.4)
  assert.equal(f.tau, before)
})
