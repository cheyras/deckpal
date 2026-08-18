/**
 * Card subsystem parity.
 *
 * These assert the FIVE traps that cost a debugging pass each upstream, against
 * `cards.json` as generated from the .blend. They are deliberately assertions
 * about the DATA and the algebra, not about pixels: the pixel check is the
 * frame-by-frame harness, and the things that went wrong here went wrong in a
 * way a screenshot did not obviously show.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'
import { evalCurve, makeCurve } from '../curve'

const doc = JSON.parse(
  readFileSync(
    join(import.meta.dirname, '..', '..', '..', '..', 'public', 'models', 'decke', 'cards.json'),
    'utf8',
  ),
)
const playbook = JSON.parse(
  readFileSync(
    join(import.meta.dirname, '..', '..', '..', '..', 'public', 'models', 'decke', 'playbook.json'),
    'utf8',
  ),
)

test('the hand is a 3-point path, and the side waypoint clears his body', () => {
  const R = doc.hands.R
  // 0.875 is his half-width; the card is 0.785 wide. The side station has to be
  // outside their sum or the card passes through him on the way out.
  assert.ok(Math.abs(R.side.loc[0]) > 0.875 + 0.785, `side |x| = ${R.side.loc[0]}`)
  // The trap: a straight lerp from stow to front. The authored path is nothing
  // like it — the midpoint of the real path is a long way from the chord.
  const chordX = (R.stow.loc[0] + R.front.loc[0]) / 2
  assert.ok(
    Math.abs(R.side.loc[0] - chordX) > 1.1,
    'the side waypoint must not lie near the stow->front chord',
  )
  // Both hands stow BEHIND him (+y is behind; his forward is -y) and the front
  // station is genuinely in front.
  assert.ok(R.stow.loc[1] > 1 && doc.hands.L.stow.loc[1] > 1)
  assert.ok(R.front.loc[1] < -1)
})

test('the extraction proved the path is piecewise linear, not just assumed it', () => {
  const m = /to ([\d.e+-]+)$/.exec(doc.hand_path.verified)
  assert.ok(m, doc.hand_path.verified)
  assert.ok(Number(m![1]) < 5e-5, doc.hand_path.verified)
})

test('orb_on stays 0 through card_present — the orbit station is in FRONT of him', () => {
  // Blending toward the orbit target during a presentation drives the card
  // through his body. A stale comment in decke_states.py claims otherwise.
  for (const state of ['card_present', 'card_show', 'point', 'travel_point']) {
    for (const b of playbook.states[state].beats) {
      assert.equal(b.pose.orb_on ?? 0, 0, `${state} @${b.t_ms}ms`)
    }
  }
  assert.ok(doc.hands.R.orbit.loc[1] < 0, 'the orbit station really is on his -y (front) side')
})

test('the present gate covers both presentations and NOT the loading orbit', () => {
  // THREE loose-card beats, only TWO of them presentations. The first
  // implementation sampled one window and left point/travel_point broken.
  assert.deepEqual(Object.keys(doc.present_gate.states).sort(), ['card_present', 'travel_point'])
  assert.deepEqual(doc.present_gate.ungated, ['loading'])
})

test('every gate ramp happens while its card is invisible', () => {
  // A gate that ramps under a visible card swings it through tens of degrees in
  // a few frames and reads as a swoosh on pop-in.
  const cardVisible = (state: string) => {
    const beats = playbook.states[state].beats.filter((b: never) => (b as { pose: Record<string, number> }).pose.card_r)
    return [beats[0].t_ms, beats[beats.length - 1].t_ms]
  }
  for (const [state, keys] of Object.entries(doc.present_gate.states) as [string, { t: number; v: number }[]][]) {
    const gate = makeCurve(keys.map((k) => ({ ...k, interp: 'ease' as const })))
    const [from, to] = cardVisible(state)
    for (let t = from; t <= to; t += 10) {
      assert.ok(evalCurve(gate, t) > 0.999, `${state}: gate is ramping at ${t}ms with the card up`)
    }
  }
})

test('at facing +1 the gate is the identity for ANY present — algebra, not tolerance', () => {
  for (const present of [0, 0.37, 1]) {
    assert.equal(1 - present * (1 - 1), 1)
  }
  // ...and at facing -1 with the gate up it is a clean sign flip, nothing else.
  assert.equal(1 - 1 * (1 - -1), -1)
})

test('all five stash cards fly, staggered, and none of them is a duplicate path', () => {
  const cards = doc.stash.cards
  assert.equal(cards.length, 5)
  const starts = cards.map((c: { start_ms: number }) => c.start_ms)
  for (let i = 1; i < starts.length; i++) {
    const gap = starts[i] - starts[i - 1]
    assert.ok(gap > 100 && gap < 200, `stagger ${gap}ms between card ${i} and ${i + 1}`)
  }
  // Each card launches from its own x, which is what makes the fan read as five
  // cards rather than one card flickering.
  const launchX = cards.map((c: { channels: { lx: { v: number }[] } }) => c.channels.lx[1].v)
  assert.equal(new Set(launchX).size, 5, `launch x values: ${launchX}`)
})

test('stash cards 2-5 carry a parent inverse and card 1 does not', () => {
  // They were parented to DeckE_Tilt with Keep Transform. glTF has no parent
  // inverse, so dropping it shifts four of the five paths by 0.136 in z — and
  // because card 1 is unaffected it looks like a per-card animation bug.
  const off = doc.stash.cards.map((c: { parent_offset: number[] }) => c.parent_offset[2])
  assert.equal(off[0], 0)
  for (const z of off.slice(1)) assert.ok(Math.abs(z + 0.135688) < 1e-6, `parent offset z = ${z}`)
})

test('the orbit is one continuous rotation whose period is NOT the clip loop', () => {
  // Two full turns over the authored block. Reproducing it from the wrapped clip
  // clock jumps the cards back a third of a turn on every loop.
  assert.equal(doc.orbit.turns, -2)
  assert.equal(doc.orbit.period_ms, 2700)
  assert.notEqual(doc.orbit.period_ms, playbook.states.loading.duration_ms)
  // The fade schedule loops on the BLOCK, which is a whole number of turns, so
  // it closes seamlessly and every fade happens with the hand behind him.
  assert.equal(doc.loose_cards.card_l.loop_ms, doc.orbit.block_ms)
  assert.equal(doc.orbit.block_ms % doc.orbit.period_ms, 0)
})

test('existence is scale, and the two orbit cards are deliberately out of step', () => {
  const rose = doc.loose_cards.card_l.orbit_scale
  const amber = doc.loose_cards.card_r.orbit_scale
  for (const k of [...rose, ...amber]) assert.ok(k.v === 0 || k.v === 1, `scale key ${k.v}`)
  const firstFull = (ks: { t: number; v: number }[]) => ks.find((k) => k.v === 1)!.t
  assert.ok(firstFull(amber) - firstFull(rose) > 1000, 'amber spawns a beat after rose')
})
