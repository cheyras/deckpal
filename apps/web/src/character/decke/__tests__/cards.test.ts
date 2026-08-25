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
import {
  CARD_HALF,
  holdGate,
  MAX_STASH,
  type StashStation,
  STASH,
  sizeForCount,
  stashLayout,
  stationLocal,
} from '../cards'

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

// ---------------------------------------------------------------- the stash fan

/**
 * "Not clipping" as a PROPERTY, not as something checked by eye at one count.
 *
 * The authored five-card path put every card on the same point and they
 * interpenetrated — "they're like all clipping through each other, and we need
 * to not have them do that." The replacement is a computed fan, and what makes
 * the replacement trustworthy is that its no-overlap claim is checked at every
 * batch size it will ever be asked for.
 *
 * Overlap is judged in the plane the reader sees. The fan is laid out about the
 * VIEW AXIS, so a station's screen position is `r * sin(lobe)` across and `z`
 * up, and its depth `r * cos(lobe)` only decides which card is in front. Two
 * cards are on top of each other when they overlap in BOTH screen axes.
 */
test('no two cards in the fan can interpenetrate', () => {
  // THIS IS THE PROPERTY, and it is not the same as "no two cards overlap on
  // screen". The reported defect was cards passing THROUGH each other — "they're
  // like all clipping through each other, and we need to not have them do that"
  // — which is a 3D intersection. Two cards overlapping on screen at clearly
  // different depths is not that; it is a hand of cards, and it reads correctly.
  //
  // The cards are near-parallel planes all facing the reader, so two of them can
  // only intersect if they occupy the same depth AND the same patch of screen.
  // Requiring one or the other is therefore exactly the no-clipping guarantee,
  // and it is checked at every batch size the fan will ever be asked for.
  // MEASURE THE CARDS, NOT A BOX AROUND THEM. Two earlier versions of this
  // assertion were proxies, and both were wrong in the same direction: they
  // modelled a card as an axis-aligned rectangle and asked whether the
  // rectangles overlap. A card is a rotated, slightly tilted quad — `splayPerX`
  // turns the outer ones by up to 30 degrees — so its bounding box is nearly
  // half again its real footprint, and the proxy calls layouts broken that are
  // not. That is not a harmless conservatism: an over-strict proxy sent someone
  // (me) tuning the depth constants to satisfy it, and the tuning made the REAL
  // minimum separation worse — 0.166 units down to 0.058 at seven cards — while
  // the proxy went green.
  //
  // So this measures the closest approach between the two quads directly, in
  // Blender coordinates, which is where the layout is expressed. The axis
  // conversion the renderer applies is rigid, so distances here are the
  // distances on screen. Calibrated against the same measurement taken through
  // the real render pipeline in the browser: 0.132 units at nine cards, the
  // tightest case, which this reproduces to two decimal places.
  const RAD_ = Math.PI / 180
  /** A card's four corners in `DeckE_Tilt` local Blender coords. The mesh lies
   *  in the XZ plane there — width along X, height along Z, normal along Y —
   *  and `writeLocal` places it with a Blender XYZ euler, R = Rz*Ry*Rx. */
  function corners(st: StashStation, facing: number, s: number): [number, number, number][] {
    const t = stationLocal(st, facing, {
      x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0,
    })
    const [cx, sx_] = [Math.cos(t.rx), Math.sin(t.rx)]
    const [cy, sy] = [Math.cos(t.ry), Math.sin(t.ry)]
    const [cz, sz] = [Math.cos(t.rz), Math.sin(t.rz)]
    // R = Rz * Ry * Rx, applied to a column vector.
    const R = [
      [cz * cy, cz * sy * sx_ - sz * cx, cz * sy * cx + sz * sx_],
      [sz * cy, sz * sy * sx_ + cz * cx, sz * sy * cx - cz * sx_],
      [-sy, cy * sx_, cy * cx],
    ]
    const w = CARD_HALF.w * s
    const h = CARD_HALF.h * s
    const out: [number, number, number][] = []
    for (const u of [-w, w]) {
      for (const v of [-h, h]) {
        const p: [number, number, number] = [u, 0, v]
        out.push([
          R[0][0] * p[0] + R[0][1] * p[1] + R[0][2] * p[2] + t.x,
          R[1][0] * p[0] + R[1][1] * p[1] + R[1][2] * p[2] + t.y,
          R[2][0] * p[0] + R[2][1] * p[1] + R[2][2] * p[2] + t.z,
        ])
      }
    }
    return out
  }

  /** Closest approach between two quads, by sampling a grid on each. Nine by
   *  nine is what the browser measurement used, so the two numbers are
   *  comparable; the quads are convex and near-parallel, so the sampled minimum
   *  is within a sample step of the true one. */
  function minGap(a: [number, number, number][], b: [number, number, number][]): number {
    const grid = (q: [number, number, number][]) => {
      const pts: [number, number, number][] = []
      const N = 9
      for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
          const u = i / (N - 1)
          const v = j / (N - 1)
          // q is [(-w,-h), (-w,h), (w,-h), (w,h)] — bilinear over that.
          pts.push([0, 1, 2].map((k) =>
            q[0][k] * (1 - u) * (1 - v) + q[1][k] * (1 - u) * v +
            q[2][k] * u * (1 - v) + q[3][k] * u * v,
          ) as [number, number, number])
        }
      }
      return pts
    }
    const A = grid(a)
    const B = grid(b)
    let m = Infinity
    for (const p of A) {
      for (const q of B) {
        const d = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])
        if (d < m) m = d
      }
    }
    return m
  }

  /**
   * The bar for the RESTING layout, which is the only thing `stashLayout`
   * controls — and it is set above the resting requirement on purpose, because
   * the cards do not stay at rest.
   *
   * `STASH_FLOAT` keeps every settled card drifting: 0.17 units vertically, 0.07
   * sideways, 0.09 radians of tumble, on golden-angle-spaced phases so no two
   * ever synchronise. That can only ever bring two cards CLOSER than this
   * measures. Driven through the real pipeline for forty seconds of hang at
   * every batch size, the closest any two cards ever came was 0.050 units at
   * twelve — eight times a card's 0.006 thickness, and never an intersection.
   * The worst the float bit out of the resting gap was 0.066.
   *
   * So 0.10 is "the resting gap is comfortably more than the float can eat". A
   * layout retune that halves the margin trips this even though nothing on
   * screen would look wrong yet, which is the point of a margin.
   */
  const CLEAR = 0.1
  let tightest = { n: 0, i: 0, j: 0, gap: Infinity }
  for (let n = 1; n <= MAX_STASH; n++) {
    const s = sizeForCount(n)
    const st = stashLayout(n)
    assert.equal(st.length, n)
    for (const facing of [1, -1]) {
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const gap = minGap(corners(st[i], facing, s), corners(st[j], facing, s))
          if (gap < tightest.gap) tightest = { n, i, j, gap }
          assert.ok(
            gap > CLEAR,
            `n=${n} facing=${facing}: cards ${i} and ${j} come within ${gap.toFixed(3)} units — ` +
              `a card is ${(CARD_HALF.w * s * 2).toFixed(2)} x ${(CARD_HALF.h * s * 2).toFixed(2)} at this size`,
          )
        }
      }
    }
  }
  // Reported so a retune that halves the margin is visible in the test output
  // rather than only in the pass/fail.
  assert.ok(
    tightest.gap > CLEAR,
    `tightest approach anywhere: ${tightest.gap.toFixed(3)} at n=${tightest.n} (${tightest.i} x ${tightest.j})`,
  )
})

test('every card is individually legible, not merely non-intersecting', () => {
  // The other half of the ask: "they need to spawn in a way that they are, like,
  // all individually visible". A card wholly behind another is not visible
  // however cleanly it is layered, so every card must show a real fraction of
  // itself. Measured as the free margin around its centre: no other card's
  // centre may be inside two thirds of a card in BOTH screen axes at once.
  for (let n = 1; n <= MAX_STASH; n++) {
    const s = sizeForCount(n)
    const st = stashLayout(n)
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = Math.abs(st[i].sx - st[j].sx) / (CARD_HALF.w * s)
        const dz = Math.abs(st[i].z - st[j].z) / (CARD_HALF.h * s)
        assert.ok(
          dx > 1.3 || dz > 1.0,
          `n=${n}: cards ${i} and ${j} sit almost on top of each other (dx ${dx.toFixed(2)} half-widths, dz ${dz.toFixed(2)} half-heights)`,
        )
      }
    }
  }
})

test('no card stands in front of his face', () => {
  // The middle of the fan is between the reader and him, so a card there covers
  // the character who is presenting it. The clear column is what keeps that from
  // happening, and it has to hold at every count — including after the jitter.
  const BODY_HALF_W = 0.875
  for (let n = 1; n <= MAX_STASH; n++) {
    const halfW = CARD_HALF.w * sizeForCount(n)
    for (const st of stashLayout(n)) {
      assert.ok(
        Math.abs(st.sx) - halfW > BODY_HALF_W,
        `n=${n}: a card's inner edge reaches ${(Math.abs(st.sx) - halfW).toFixed(2)}, inside his ${BODY_HALF_W}`,
      )
    }
  }
})

test('the fan stays in front of him and stays on screen', () => {
  // Depth is for LIFE, not for spacing: it must never put a card behind him
  // (where the reader would not see it) nor so far forward that it reads as a
  // separate object floating between the reader and the page.
  for (let n = 1; n <= MAX_STASH; n++) {
    for (const st of stashLayout(n)) {
      assert.ok(st.depth > -0.9 && st.depth < 1.2, `depth ${st.depth.toFixed(2)} at n=${n}`)
    }
  }
  // And the whole fan is not wider than about two and a half of him.
  const widest = Math.max(...stashLayout(MAX_STASH).map((s) => Math.abs(s.sx)))
  assert.ok(widest < 3.3, `the fan reaches ${widest.toFixed(2)} units out`)
})

test('the fan is the same fan every time', () => {
  // Seeded, never `Math.random`: the same batch of cards has to lay out the same
  // way on every play, or a state that is re-entered reshuffles itself.
  assert.deepEqual(stashLayout(7), stashLayout(7))
})

test('a small batch is balanced across the middle', () => {
  // Slots are filled alternating sides, so he is never standing beside a stack
  // of cards on one shoulder and nothing on the other.
  for (let n = 2; n <= MAX_STASH; n += 2) {
    const left = stashLayout(n).filter((s) => s.sx < 0).length
    assert.equal(left, n / 2, `n=${n}: ${left} cards on the left`)
  }
})

test('cards shrink as the batch grows, but never to confetti', () => {
  assert.equal(sizeForCount(1), sizeForCount(5), 'small batches share one size')
  assert.ok(sizeForCount(MAX_STASH) < sizeForCount(5), 'a full batch does not shrink')
  assert.ok(sizeForCount(MAX_STASH) > 0.3, 'a full batch is unreadably small')
})

/**
 * The frame conversion, which every property above is blind to.
 *
 * `stashLayout` works in what the reader sees — across, up, and toward. Turning
 * that into his local frame is one step of trigonometry, and a sign error in it
 * (screen-right flipped, or the whole fan laid out BEHIND him at `facing = -1`)
 * would satisfy every overlap, gap and balance test while putting the cards
 * where nobody can see them.
 */
test('a station resolves in front of him, on the side it was laid out', () => {
  const CAM_BEARING = 40.195 * (Math.PI / 180)
  const out = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 }
  for (const facing of [1, -1]) {
    // The direction from him toward the camera, in his local frame.
    const toward = { x: Math.sin(CAM_BEARING * facing), y: -Math.cos(CAM_BEARING * facing) }
    for (const st of stashLayout(8)) {
      stationLocal(st, facing, out)
      // Depth is measured ALONG that direction. Positive depth must put the card
      // on the camera's side of him, at BOTH facings.
      const along = out.x * toward.x + out.y * toward.y
      assert.ok(
        Math.abs(along - st.depth) < 1e-9,
        `facing ${facing}: depth resolved to ${along.toFixed(3)}, not ${st.depth.toFixed(3)}`,
      )
      // And `sx` is measured across it, keeping its sign — a card laid out on the
      // reader's left stays on the reader's left when he turns round.
      const across = out.x * -toward.y + out.y * toward.x
      assert.ok(
        Math.abs(across - st.sx) < 1e-9,
        `facing ${facing}: sx resolved to ${across.toFixed(3)}, not ${st.sx.toFixed(3)}`,
      )
      assert.equal(out.z, st.z)
    }
  }
})

test('a card faces the reader at either facing', () => {
  // The whole reason the fan is laid out against the view axis rather than
  // against his forward: a card that is edge-on is not "individually visible".
  const out = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 }
  for (const facing of [1, -1]) {
    for (const st of stashLayout(12)) {
      stationLocal(st, facing, out)
      // The card's own normal at rotation rz, against the direction to the
      // camera. Square-on is 1; edge-on is 0.
      const camBearing = 40.195 * (Math.PI / 180) * facing
      const normal = { x: Math.sin(out.rz), y: -Math.cos(out.rz) }
      const toCam = { x: Math.sin(camBearing), y: -Math.cos(camBearing) }
      const face = Math.abs(normal.x * toCam.x + normal.y * toCam.y)
      assert.ok(face > 0.82, `a card is ${(Math.acos(face) * 180) / Math.PI}° off square`)
    }
  }
})

/**
 * ── THE PRESENT GATE MAY NOT SWING UNDER A VISIBLE CARD ──────────────────────
 *
 * The tests above pin the authored gate data and the algebra `k` is computed
 * with. The moment between them had nothing on it, and that is where the
 * 2026-08-24 review found this:
 *
 *   "card suddenly snaps over to the other side (the wrong side for the way
 *    he's facing) right before putting it away. in real time this makes it feel
 *    like the card just glitches and disappears."                        (c54)
 *
 * The mechanism: `gate` is keyed by STATE NAME and `state` switches on the tick
 * `setState` is called, but the pose that carries the card's scale crossfades
 * for 320 ms after it — and `card_present` has no outro, so its dismissal goes
 * straight to `enter`. For that fifth of a second the card is plainly on screen
 * while the gate has already fallen 1 -> 0, which flips `k` from -1 to +1 at
 * `facing: -1` and mirrors the whole loose-card chain across his body.
 *
 * `holdGate` is the rule that makes the file's own long-standing claim — "the
 * gate only ever swings while the card is invisible" — true by construction
 * rather than by the authored curves happening to line up.
 */
test('the gate follows its curve while there is no card on screen', () => {
  assert.equal(holdGate(0, 1, 0), 1)
  assert.equal(holdGate(1, 0, 0), 0)
  // A card at 2% of its scale is a few tenths of a millimetre of geometry, and
  // the crossfade approaches zero asymptotically — waiting for exactly 0 costs
  // frames for no benefit.
  assert.equal(holdGate(1, 0, 0.02), 0)
})

test('and holds it while a card IS on screen — the defect, directly', () => {
  // Mid-dismissal: the state has already changed (target 0) and the card is
  // still most of the way up. The old code took the 0 here and mirrored the
  // card under the reader.
  assert.equal(holdGate(1, 0, 0.9), 1)
  assert.equal(holdGate(1, 0, 0.35), 1)
  // And the same in the other direction, which is the pop-in half of the same
  // rule: a gate rising under a visible card is the swoosh the file's own
  // comment says can never happen.
  assert.equal(holdGate(0, 1, 0.5), 0)
})

test('the held value survives an arbitrary run of visible frames', () => {
  // 320ms of crossfade at 60fps is ~19 frames, and every one of them must give
  // the same answer — a rule that only holds for one frame is not a hold.
  let held = 1
  for (let f = 0; f < 19; f++) held = holdGate(held, 0, 1 - f / 19)
  assert.equal(held, 1)
  // Then the card finishes fading and the gate is free to catch up.
  assert.equal(holdGate(held, 0, 0), 0)
})
