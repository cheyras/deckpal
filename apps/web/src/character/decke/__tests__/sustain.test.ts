/**
 * The sustain windows, checked against the thing that actually matters.
 *
 * A loop window is not "right" because someone picked plausible beat times. It
 * is right if and only if the pose at `toMs` and the pose at `fromMs` agree — a
 * loop is a cut back to the start, and every channel that disagrees across that
 * cut is a visible pop, once per loop, forever. That is the exact failure mode
 * the sustain work exists to remove ("the animation is snapping at the end and
 * it shouldn't"), so shipping a window that reintroduces it would be worse than
 * not having windows at all.
 *
 * So these tests evaluate the REAL compiled curves at both ends of every window
 * and compare them channel by channel, rather than checking that the numbers in
 * the table are the numbers in the table.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'
import { compilePlaybook, compileState, evalState, type PlaybookDoc, type Pose } from '../playbook'
import { CLIP_PATCH, IDLE, IDLE_STATE, ONE_SHOT, SUSTAIN, spinRateFor } from '../sustain'

const here = dirname(fileURLToPath(import.meta.url))
const doc: PlaybookDoc = JSON.parse(
  readFileSync(resolve(here, '../../../../public/models/decke/playbook.json'), 'utf8'),
)
const compiled = compilePlaybook(doc)
compiled.set(IDLE, compileState(IDLE, IDLE_STATE, doc.rest_pose))
// The runtime compiles the PATCHED clips, so the windows have to be checked
// against those. Testing the raw playbook would pass a window that is 310 ms out
// of step with what actually plays.
for (const [name, patch] of Object.entries(CLIP_PATCH)) {
  const base = compiled.get(name)
  if (base) compiled.set(name, compileState(name, patch(base.clip), doc.rest_pose))
}

/**
 * How far apart the two ends of a loop may be — measured in what the viewer
 * SEES, not in channel units.
 *
 * A flat normalised budget is the wrong instrument, because the channels are not
 * commensurate: 0.1 of `twist` is 1.2 degrees of body and invisible, while 0.1
 * of `mouth` is 5.5 degrees of LID — and his eyes are mounted on the lid, so it
 * is one of the loudest tenths on the character. Budgeting both at "0.1" would
 * either wave through a visible jaw pop or reject an invisible shoulder one.
 *
 * So every channel with a known physical mapping is budgeted in DEGREES OF
 * MOTION and converted back through that mapping. The rest — morph weights, lid
 * heights, gaze offsets — keep a normalised budget, below which the idle float
 * is already moving him further on every frame than the wrap does.
 */
/** Degrees of body/lid motion a wrap may jump. */
const TOL_DEG = 1.5
/** Degrees for the channels that ARE degrees (the root euler). Looser, because a
 *  couple of degrees of head angle mid-shake is inside the shake's own step. */
const TOL_EULER = 4.5
/** Normalised budget for channels with no degree mapping. */
const TOL = 0.06
const EULER_CHANNELS = new Set(['rx', 'ry', 'rz', 'rl_x', 'rl_y', 'rl_z'])
/** Degrees of visible motion per unit of channel, for the ones that have a
 *  mapping. `mouth` is the lid hinge's 55 deg/unit; the rest come from
 *  `CHANNEL_RANGE`. */
const DEG_PER_UNIT: Record<string, number> = { bend: 18, lean: 15, twist: 12, mouth: 55 }

function budgetFor(ch: string): number {
  if (EULER_CHANNELS.has(ch)) return TOL_EULER
  const deg = DEG_PER_UNIT[ch]
  return deg ? TOL_DEG / deg : TOL
}
/** `sym_spin` is a monotonically increasing angle and is DRIVEN PROCEDURALLY
 *  from unwrapped time (see `spinRateFor`), so its authored value at the two
 *  ends of a window is not what renders and is deliberately not compared. */
const DRIVEN = new Set(['sym_spin', 'sym_frame'])

function poseAt(name: string, t: number): Pose {
  const st = compiled.get(name)
  assert.ok(st, `no compiled state "${name}"`)
  return evalState(st, t, doc.rest_pose, {})
}

test('every sustain window names a real state', () => {
  for (const name of Object.keys(SUSTAIN)) {
    assert.ok(compiled.has(name), `SUSTAIN has "${name}" but the playbook does not`)
  }
})

test('every state is either a sustain or a declared one-shot', () => {
  const missing = [...compiled.keys()].filter(
    (n) => n !== 'talk' && !SUSTAIN[n] && !ONE_SHOT.has(n),
  )
  assert.deepEqual(
    missing,
    [],
    `these states would play once and freeze on their last beat: ${missing.join(', ')}`,
  )
})

test('a sustain window wraps without a pop', () => {
  for (const [name, spec] of Object.entries(SUSTAIN)) {
    // A synthesized sustain is its own clip; the window then describes that clip
    // rather than the authored one.
    const clip = spec.clip
    const a = clip
      ? evalState(compileState(name, clip, doc.rest_pose), 0, doc.rest_pose, {})
      : poseAt(name, spec.fromMs)
    const b = clip
      ? evalState(
          compileState(name, clip, doc.rest_pose),
          clip.duration_ms,
          doc.rest_pose,
          {},
        )
      : poseAt(name, spec.toMs)

    for (const ch of Object.keys(a)) {
      if (DRIVEN.has(ch)) continue
      const tol = budgetFor(ch)
      const d = Math.abs(a[ch] - b[ch])
      assert.ok(
        d <= tol,
        `${name}: channel "${ch}" jumps ${d.toFixed(3)} across the loop wrap ` +
          `(${spec.fromMs} -> ${spec.toMs}, budget ${tol})`,
      )
    }
  }
})

test('a sustain window lies inside its clip and has a forward span', () => {
  for (const [name, spec] of Object.entries(SUSTAIN)) {
    const clip = compiled.get(name)!.clip
    assert.ok(spec.fromMs >= 0, `${name}: fromMs is negative`)
    assert.ok(spec.toMs >= spec.fromMs, `${name}: window runs backwards`)
    if (!spec.clip) {
      assert.ok(
        spec.toMs <= clip.duration_ms,
        `${name}: window ends at ${spec.toMs} but the clip is ${clip.duration_ms}`,
      )
    }
  }
})

test('an outro has somewhere to play', () => {
  for (const [name, spec] of Object.entries(SUSTAIN)) {
    if (spec.outroTail) {
      const clip = compiled.get(name)!.clip
      assert.ok(
        clip.duration_ms - spec.toMs > 100,
        `${name}: outroTail leaves only ${clip.duration_ms - spec.toMs} ms of tail`,
      )
    }
    if (spec.outroClip) {
      assert.ok(spec.outroClip.duration_ms > 0, `${name}: outroClip has no duration`)
      // It has to LAND at rest, or leaving the state strands whatever it left
      // behind — the exact defect the outro exists to fix.
      const end = evalState(
        compileState(name, spec.outroClip, doc.rest_pose),
        spec.outroClip.duration_ms,
        doc.rest_pose,
        {},
      )
      for (const ch of Object.keys(end)) {
        assert.ok(
          Math.abs(end[ch] - (doc.rest_pose[ch] ?? 0)) < 1e-9,
          `${name}: outro ends with "${ch}" away from rest`,
        )
      }
    }
  }
})

test('sleep sustains with the mouth shut and the lids down', () => {
  const spec = SUSTAIN.sleep
  assert.ok(spec.clip, 'sleep must have a synthesized sustain')
  const st = compileState('sleep:sustain', spec.clip!, doc.rest_pose)
  // The reported defect was that he froze mid-yawn. Whatever else the breathing
  // loop does, it must never reopen the mouth or the eyes.
  for (let t = 0; t <= spec.clip!.duration_ms; t += 100) {
    const p = evalState(st, t, doc.rest_pose, {})
    assert.equal(p.mouth, 0, `sleep sustain opens the mouth at ${t} ms`)
    assert.equal(p.lid_u, 1, `sleep sustain opens the eyes at ${t} ms`)
  }
  // And it has to actually breathe, or it is just a different frozen pose.
  const lo = evalState(st, 1600, doc.rest_pose, {}).bend
  const hi = evalState(st, 0, doc.rest_pose, {}).bend
  assert.ok(hi - lo > 0.1, 'sleep sustain does not visibly breathe')
})

test('idle sustains forever and holds every channel at rest', () => {
  assert.ok(SUSTAIN[IDLE], 'idle must sustain, or it hands over to itself once a second')
  for (const t of [0, 250, 900]) {
    const p = poseAt(IDLE, t)
    for (const ch of Object.keys(p)) {
      assert.equal(p[ch], doc.rest_pose[ch] ?? 0, `idle moves "${ch}" at ${t} ms`)
    }
  }
})

test('the spinning glyphs get their rate from the atlas', () => {
  const a = doc.symbol_atlas
  assert.equal(spinRateFor(compiled.get('loading')!.clip, doc), a.spinner_deg_per_s)
  assert.equal(spinRateFor(compiled.get('alert_dizzy')!.clip, doc), a.spin_deg_per_s)
  // A static glyph must not spin, or the 180-degree right-eye phase turns back
  // into the horizontal mirror that made the money symbol read backwards.
  assert.equal(spinRateFor(compiled.get('alert_money')!.clip, doc), 0)
  assert.equal(spinRateFor(compiled.get('alert_star')!.clip, doc), 0)
  assert.equal(spinRateFor(compiled.get('happy')!.clip, doc), 0)
})

test("the atlas rate is the rate alert_dizzy was authored at", () => {
  // Recovering the authored ramp is the whole justification for driving the spin
  // procedurally rather than keying it, so it is worth pinning: the clip's
  // `sym_spin` runs at exactly `spin_deg_per_s`.
  const clip = compiled.get('alert_dizzy')!.clip
  const first = clip.beats.find((b) => b.pose.sym_spin !== undefined)!
  const last = [...clip.beats].reverse().find((b) => b.pose.sym_spin !== undefined)!
  const rate =
    ((last.pose.sym_spin - first.pose.sym_spin) / (last.t_ms - first.t_ms)) * 1000
  assert.ok(
    Math.abs(rate - doc.symbol_atlas.spin_deg_per_s) < 0.5,
    `authored ${rate.toFixed(2)} deg/s vs atlas ${doc.symbol_atlas.spin_deg_per_s}`,
  )
})

test('confused wears the spirals, and gets into them behind a blink', () => {
  const clip = compiled.get('confused')!.clip
  assert.equal(clip.symbol, 'dizzy', 'confused must carry the spiral glyph')
  assert.equal(spinRateFor(clip, doc), doc.symbol_atlas.spin_deg_per_s)

  const at = (t: number) => evalState(compiled.get('confused')!, t, doc.rest_pose, {})

  // Open-eyed and pupil-eyed at rest.
  assert.equal(at(0).alert, 0)
  assert.equal(at(0).lid_u, 0)

  // The swap happens with the lids DOWN. That is the whole reason there is a
  // prologue rather than a bare reel: an alert entrance is explicitly not what
  // was asked for.
  const shut = at(160)
  assert.ok(shut.lid_u > 0.9, `lids only ${shut.lid_u} down while the reel turns`)
  assert.ok(shut.alert > 0.9, `reel only ${shut.alert} through behind them`)

  // Eyes open on spirals, and they STAY spirals for the whole clip — a beat
  // that stops mentioning `alert` drops back to rest and the pupils reappear.
  for (let t = 320; t <= clip.duration_ms; t += 40) {
    assert.equal(at(t).alert, 1, `spirals dropped out at ${t} ms`)
  }
})
