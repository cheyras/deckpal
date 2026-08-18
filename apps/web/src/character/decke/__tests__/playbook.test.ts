/**
 * Structural and behavioural tests for the playbook and its evaluator.
 *
 * These run against the REAL generated `playbook.json`, not a fixture, so they
 * also serve as a regression guard on `gen-playbook.py`.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'
import { compilePlaybook, evalState, type PlaybookDoc, type Pose } from '../playbook'
import { evalCurve, makeCurve } from '../curve'

const here = dirname(fileURLToPath(import.meta.url))
const doc: PlaybookDoc = JSON.parse(
  readFileSync(resolve(here, '../../../../public/models/decke/playbook.json'), 'utf8'),
)
const compiled = compilePlaybook(doc)

test('the playbook has the expected shape', () => {
  assert.equal(doc.fps, 30)
  assert.equal(doc.order.length, 27)
  assert.equal(Object.keys(doc.states).length, 27)
  assert.equal(Object.keys(doc.rest_pose).length, 47)
  // The rest pose has non-zero defaults that a zero-fill would destroy.
  assert.equal(doc.rest_pose.single, 1, 'his internal card exists at rest')
  assert.equal(doc.rest_pose.orb_r, 0.5, 'the two orbit cards start half a revolution apart')
  assert.equal(doc.rest_pose.rl_z, 1, 'the roll axis defaults to +Z')
})

test('every state compiles and evaluates without producing NaN', () => {
  const out: Pose = {}
  for (const [name, st] of compiled) {
    const dur = st.clip.duration_ms
    for (const frac of [0, 0.01, 0.25, 0.5, 0.75, 0.999, 1]) {
      evalState(st, dur * frac, doc.rest_pose, out)
      for (const [ch, v] of Object.entries(out)) {
        assert.ok(Number.isFinite(v), `${name} @${frac}: channel ${ch} is ${v}`)
      }
    }
  }
})

test('evaluating before and after a clip clamps to its endpoints', () => {
  const st = compiled.get('happy')!
  const a: Pose = {}
  const b: Pose = {}
  evalState(st, -500, doc.rest_pose, a)
  evalState(st, 0, doc.rest_pose, b)
  for (const k in a) assert.equal(a[k], b[k], `channel ${k} differs before t=0`)

  evalState(st, st.clip.duration_ms + 500, doc.rest_pose, a)
  evalState(st, st.clip.duration_ms, doc.rest_pose, b)
  for (const k in a) assert.equal(a[k], b[k], `channel ${k} differs after the end`)
})

test('every state rests at both ends except the declared exceptions', () => {
  // Hub-and-spoke blending assumes a clip begins and ends at rest. The
  // exceptions are computed by the generator from the beats themselves, so this
  // asserts the runtime and the data agree about exactly which channels depart
  // — not merely that "some state is special".
  const out: Pose = {}
  for (const [name, st] of compiled) {
    for (const [which, t] of [
      ['start', 0],
      ['end', st.clip.duration_ms],
    ] as const) {
      const declared = new Set(
        (which === 'start'
          ? doc.transition.non_resting_start[name]
          : doc.transition.non_resting_end[name]) ?? [],
      )
      evalState(st, t, doc.rest_pose, out)
      const actual = Object.keys(out).filter(
        (ch) => Math.abs(out[ch] - doc.rest_pose[ch]) > 1e-9,
      )
      assert.deepEqual(
        actual.sort(),
        [...declared].sort(),
        `${name} @${which}: departed channels do not match the declared list`,
      )
    }
  }
})

test('boot is the entrance state and starts squashed and shut', () => {
  // Not a quirk — starting away from rest is the entire point of boot, and an
  // earlier version of this test wrongly flagged it as a defect.
  const st = compiled.get('boot')!
  const out: Pose = {}
  evalState(st, 0, doc.rest_pose, out)
  assert.ok(out.sq < -0.1, `boot should start compressed, sq = ${out.sq}`)
  assert.equal(out.lid_u, 1, 'boot should start with the eyes shut')
  assert.ok(out.brow < -0.5, 'boot should start with the brows down')
  evalState(st, st.clip.duration_ms, doc.rest_pose, out)
  assert.ok(Math.abs(out.sq) < 1e-9, 'boot must settle to rest')
})

test('the alert symbol residue is cosmetic only', () => {
  // alert_dizzy and alert_scribble leave their symbol channels wound up. That is
  // harmless ONLY because `alert` itself returns to 0, which parks the glyph
  // off-screen. If `alert` ever failed to return, the residue would be visible.
  for (const name of ['alert_dizzy', 'alert_scribble']) {
    const departed: string[] = doc.transition.non_resting_end[name] ?? []
    assert.ok(
      departed.every((ch: string) => ch === 'sym_spin' || ch === 'sym_frame'),
      `${name} leaves more than the symbol channels off-rest: ${departed}`,
    )
    const out: Pose = {}
    const st = compiled.get(name)!
    evalState(st, st.clip.duration_ms, doc.rest_pose, out)
    assert.equal(out.alert, doc.rest_pose.alert, `${name} must park the reel`)
  }
})

test('stepped channels hold their value across the whole segment', () => {
  // The "robot register" is constant interpolation. If a step key ever
  // interpolates, the 15 Hz alert vibrate turns into a smooth wobble and the
  // whole mode-switch read is lost.
  const st = compiled.get('alert_money')!
  const px = st.curves.get('px')
  assert.ok(px, 'alert_money must animate px (the vibrate)')

  const stepKeys = px!.keys.filter((k) => k.interp === 'step')
  assert.ok(stepKeys.length >= 4, `expected several step keys, got ${stepKeys.length}`)

  const keys = px.keys
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i]
    if (k.interp !== 'step') continue
    const mid = k.t + (keys[i + 1].t - k.t) * 0.5
    assert.equal(evalCurve(px, mid), k.v, `step key at ${k.t}ms interpolated`)
  }
})

test('a plateau is not overshot', () => {
  // The single most important property of the interpolant for this character.
  // `happy` holds its pose from 500ms to 1400ms; a Catmull-Rom or unclamped
  // bezier bulges through that and the held pose visibly wobbles.
  const st = compiled.get('happy')!
  const brow = st.curves.get('brow')!
  const at500 = evalCurve(brow, 500)
  const at1400 = evalCurve(brow, 1400)
  const hi = Math.max(at500, at1400)
  const lo = Math.min(at500, at1400)
  for (let t = 500; t <= 1400; t += 10) {
    const v = evalCurve(brow, t)
    assert.ok(
      v <= hi + 1e-9 && v >= lo - 1e-9,
      `brow overshot the 500-1400ms hold at ${t}ms: ${v} outside [${lo}, ${hi}]`,
    )
  }
})

test('the bezier evaluator solves for t rather than using normalised time', () => {
  // A deliberately lopsided segment: both handles bunched near the start. If the
  // evaluator uses u directly as the bezier parameter, the midpoint value is
  // wrong in a way that is invisible on a symmetric curve.
  const c = makeCurve([
    { t: 0, v: 0, hr: [1, 0], interp: 'ease' },
    { t: 100, v: 1, hl: [2, 1], interp: 'ease' },
  ])
  const mid = evalCurve(c, 50)
  // Linear would give 0.5, and treating u as the bezier parameter directly gives
  // ~0.71. Solving the x-cubic for t gives ~0.885. The gap between 0.71 and
  // 0.885 is exactly the error this test exists to catch.
  assert.ok(mid > 0.85, `expected an early-rising curve, got ${mid} at the midpoint`)
  assert.ok(mid < 1.0, `must not overshoot its end key, got ${mid}`)
  assert.equal(evalCurve(c, 0), 0)
  assert.equal(evalCurve(c, 100), 1)
})

test('alert states freeze the procedural layers', () => {
  for (const name of doc.order) {
    if (!name.startsWith('alert_')) continue
    const m = doc.states[name].modulation
    assert.equal(m.float_amp, 0, `${name} must freeze the float`)
    assert.equal(m.blink_rate, 0, `${name} must suppress blinking`)
  }
})

test('the modulation profile indirection is preserved', () => {
  // Nine states point at a profile that is not their own name. Resolving that
  // away at generation time would silently change six of them.
  assert.equal(doc.states.listening.mod, 'curious')
  assert.equal(doc.states.card_stash.mod, 'happy')
  assert.equal(doc.states.nod_yes.mod, 'idle')
  assert.equal(doc.states.travel_far.mod, 'travel')
})

test('talk is the only overlay, and it loops seamlessly', () => {
  const overlays = doc.order.filter((n) => doc.states[n].overlay)
  assert.deepEqual(overlays, ['talk'])

  const st = compiled.get('talk')!
  const a: Pose = {}
  const b: Pose = {}
  evalState(st, 0, doc.rest_pose, a)
  evalState(st, st.clip.duration_ms, doc.rest_pose, b)
  for (const k in a) {
    assert.ok(Math.abs(a[k] - b[k]) < 1e-9, `talk does not loop cleanly on ${k}`)
  }
})
