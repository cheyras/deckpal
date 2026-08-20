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
import type { Beat, StateClip } from '../playbook'
import {
  CLIP_PATCH,
  IDLE,
  IDLE_STATE,
  ONE_SHOT,
  SUSTAIN,
  spinRateFor,
  windowClip,
} from '../sustain'

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

/**
 * The compiled sustain, exactly as `DeckE` builds it — the loop window as its
 * own cyclic clip, not a pair of times into the authored one.
 */
function sustainOf(name: string): { clip: StateClip; st: ReturnType<typeof compileState> } | null {
  const spec = SUSTAIN[name]
  const src = compiled.get(name)
  if (!src) return null
  const clip = spec.clip ?? windowClip(src, spec)
  if (!clip) return null // a HOLD: a constant has no seam
  return { clip, st: compileState(name, clip, doc.rest_pose) }
}

/**
 * Whether the segment arriving at the seam is a STEP for this channel.
 *
 * A stepped channel is SUPPOSED to jump across the wrap: `confused` and
 * `frustrated` are authored in a robot register and the alerts carry a 15 Hz
 * `px` vibrate, and all three were explicitly kept — "some of them, that's on
 * purpose... All of the UNINTENTIONAL pops in the loop should be eliminated."
 * So the tests below exempt exactly those and nothing else.
 */
function steppedAtSeam(clip: StateClip, ch: string): boolean {
  if (clip.linear_channels?.includes(ch)) return false
  let ease: Beat['ease'] = 'ease'
  for (const b of clip.beats) {
    if (b.t_ms >= clip.duration_ms) break
    ease = b.ease
  }
  return ease === 'step'
}

test('a sustain window is built with its two ends already equal', () => {
  // The CONSTRUCTION, not the outcome. A window used to be two hand-picked beat
  // times that had to be checked for agreement; now the tail beat is a copy of
  // the head, so no window can drift however it is retuned. This asserts that
  // property directly, because it is the thing every test below relies on.
  for (const name of Object.keys(SUSTAIN)) {
    const spec = SUSTAIN[name]
    if (spec.clip) continue // hand-written; checked separately
    const src = compiled.get(name)
    if (!src) continue
    const clip = windowClip(src, spec)
    if (!clip) continue
    const head = clip.beats[0]
    const tail = clip.beats[clip.beats.length - 1]
    assert.equal(head.t_ms, 0, `${name}: window does not start at 0`)
    assert.equal(tail.t_ms, clip.duration_ms, `${name}: window does not end at its duration`)
    assert.deepEqual(tail.pose, head.pose, `${name}: the loop's two ends are not the same pose`)
    // And the head is COMPLETE — every channel the state moves, including the
    // ones the authored beat at `fromMs` left out. That omission is the whole
    // defect: `curious`'s beat 1250 has no `pz`, so it read as rest, and the
    // loop popped him up 0.04 units once a second.
    assert.deepEqual(
      new Set(Object.keys(head.pose)),
      new Set(src.curves.keys()),
      `${name}: the window's head does not pin every channel the state moves`,
    )
  }
})

test('a sustain window wraps without a pop', () => {
  for (const name of Object.keys(SUSTAIN)) {
    const made = sustainOf(name)
    if (!made) continue
    const { clip, st } = made
    // Just before the wrap against just after it. NOT the final key's value: on
    // a stepped segment that key never renders, because the clock wraps before
    // it reaches it — which is why the old test read `frustrated` as popping
    // 0.08 of jaw when what actually plays is a clean two-step chatter.
    const a = evalState(st, 0, doc.rest_pose, {})
    const b = evalState(st, clip.duration_ms - 0.001, doc.rest_pose, {})
    for (const ch of Object.keys(a)) {
      if (DRIVEN.has(ch)) continue
      if (steppedAtSeam(clip, ch)) continue
      const tol = budgetFor(ch)
      const d = Math.abs(a[ch] - b[ch])
      assert.ok(
        d < tol,
        `${name}: channel "${ch}" jumps ${d.toFixed(3)} across the loop wrap (budget ${tol})`,
      )
    }
  }
})

test('a sustain window wraps without a kick', () => {
  // The second half of a seam, and the half a value comparison cannot see. The
  // two ends of a window are INTERIOR keys of the authored clip, and their
  // tangents were solved for neighbours the window cuts away — `thinking`
  // measured a 32.6 deg/s step in `ry` across a seam whose values matched
  // exactly. `cyclic: true` gives the seam one shared tangent instead of two.
  const H = 0.25 // ms
  for (const name of Object.keys(SUSTAIN)) {
    const made = sustainOf(name)
    if (!made) continue
    const { clip, st } = made
    const dur = clip.duration_ms
    const at = (t: number): Pose => evalState(st, t, doc.rest_pose, {})
    const a0 = at(0)
    const a1 = at(H)
    const b1 = at(dur - H)
    const b0 = at(dur)
    for (const ch of Object.keys(a0)) {
      if (DRIVEN.has(ch)) continue
      if (steppedAtSeam(clip, ch)) continue
      // Units per second, one-sided either side of the wrap.
      const vOut = ((a1[ch] - a0[ch]) / H) * 1000
      const vIn = ((b0[ch] - b1[ch]) / H) * 1000
      // Budgeted in the same visible units as the position test, per second: a
      // channel may not change speed across the seam by more than it is allowed
      // to change POSITION in a second.
      const tol = budgetFor(ch) * 4
      assert.ok(
        Math.abs(vIn - vOut) < tol,
        `${name}: channel "${ch}" changes speed by ${Math.abs(vIn - vOut).toFixed(3)}/s across the wrap (budget ${tol.toFixed(3)})`,
      )
    }
  }
})

test('the intentional register still steps across the wrap', () => {
  // The other side of the ledger, and the reason the two tests above have an
  // exemption at all. Over-fixing this is a real risk: a seam rule that smoothed
  // everything would quietly sand the robot register off `confused` and
  // `frustrated` and take the vibrate out of every alert, and nothing else in
  // the suite would notice.
  const REGISTER: [string, string, number][] = [
    ['confused', 'rz', 5],
    ['frustrated', 'mouth', 0.1],
    ['alert_star', 'px', 0.01],
    ['alert_dizzy', 'px', 0.01],
  ]
  for (const [name, ch, atLeast] of REGISTER) {
    const made = sustainOf(name)
    assert.ok(made, `${name} has no sustain clip`)
    const { clip, st } = made
    const a = evalState(st, 0, doc.rest_pose, {})
    const b = evalState(st, clip.duration_ms - 0.001, doc.rest_pose, {})
    assert.ok(
      Math.abs(a[ch] - b[ch]) >= atLeast,
      `${name}: "${ch}" no longer steps across the wrap (${Math.abs(a[ch] - b[ch]).toFixed(3)} < ${atLeast})`,
    )
  }
})

test('confused loops on an even stepped cadence', () => {
  // "The loop point is a little too quick, so the little back-and-forth motions
  // he's doing are kind of uneven in feel. I would just pad out the end of that
  // animation a little bit."
  //
  // The unevenness was one EASED beat inside a stepped bar: the old window
  // opened at 420, which is `ease`, so the loop began with a 140 ms smooth slide
  // and then snapped into held steps. Every beat inside the window must now step.
  const made = sustainOf('confused')
  assert.ok(made)
  const { clip } = made
  for (const b of clip.beats.slice(0, -1)) {
    assert.equal(b.ease, 'step', `confused beat ${b.t_ms} is "${b.ease}", not a step`)
  }
  // Even slots, and long enough to breathe. Every shake is one 140 ms slot; the
  // final gap is the PAD — whole slots of the last head position, so he shakes,
  // then holds for a beat, then goes again. A head-shake that never pauses reads
  // as a machine, which is the other half of the note.
  const gaps = clip.beats.slice(1).map((b, i) => b.t_ms - clip.beats[i].t_ms)
  const shakes = gaps.slice(0, -1)
  const pad = gaps[gaps.length - 1]
  for (const g of shakes) assert.equal(g, 140, `uneven shake: ${gaps.join(', ')}`)
  assert.equal(pad % 140, 0, `the pad is not a whole slot: ${pad}`)
  assert.ok(pad > 140, `the end was not padded: ${gaps.join(', ')}`)
})

test('embarrassed holds the expression instead of shaking', () => {
  // "He's like rapidly shaking, and I don't really like that. It should just kind
  // of hold on the facial expression rather than having this vibration."
  const spec = SUSTAIN.embarrassed
  assert.equal(spec.fromMs, spec.toMs, 'embarrassed still loops a window')
  assert.equal(windowClip(compiled.get('embarrassed')!, spec), null)
  // And the flinch itself survives, in the INTRO — the entrance is good, it was
  // only holding it forever that was wrong.
  const flutter = compiled.get('embarrassed')!.clip.beats.filter((b) => b.ease === 'step')
  assert.equal(flutter.length, 3, 'the flinch beats were removed rather than left to the intro')
  assert.ok(spec.fromMs > flutter[flutter.length - 1].t_ms, 'the hold lands inside the flutter')
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

/**
 * The channels that mean SOMETHING IS ON SCREEN.
 *
 * These are what an outro exists to put away — the five stash cards, the two
 * orbiting ones, the card inside him, the alert reel, the deployed hands. A
 * state that ends with one of them away from rest has left an object hanging in
 * the air, and no crossfade can be trusted to clean that up gracefully: `single`
 * and `card_*` are SCALE, so blending them is a card shrinking in mid-air rather
 * than a card being put away.
 */
const DEPLOYMENT = ['single', 'card_l', 'card_r', 'orb_on', 'hand_l', 'hand_r', 'alert']

/** How far from rest any OTHER channel may end. An outro hands over through the
 *  ordinary 320 ms crossfade, so an expression is free to end mid-thought — that
 *  is what lets `card_stash` finish on a small satisfied smile instead of
 *  snapping to neutral. A whole body length is not. */
const OUTRO_HANDOVER = 0.8

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
      const end = evalState(
        compileState(name, spec.outroClip, doc.rest_pose),
        spec.outroClip.duration_ms,
        doc.rest_pose,
        {},
      )
      for (const ch of DEPLOYMENT) {
        assert.ok(
          Math.abs(end[ch] - (doc.rest_pose[ch] ?? 0)) < 1e-9,
          `${name}: outro ends with "${ch}" deployed — an object is stranded on screen`,
        )
      }
      for (const ch of Object.keys(end)) {
        assert.ok(
          Math.abs(end[ch] - (doc.rest_pose[ch] ?? 0)) < OUTRO_HANDOVER,
          `${name}: outro ends ${Math.abs(end[ch] - (doc.rest_pose[ch] ?? 0)).toFixed(2)} from rest on "${ch}" — too far to hand over in a crossfade`,
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
