/**
 * The cards: the orbit, the two hands, the presented card and the stash flight.
 *
 * These are the six pose channels the rig never consumed — `hand_l`, `hand_r`,
 * `card_l`, `card_r`, `single` and `orb_on` — plus the five `Stash_Card_*`
 * meshes, which have no channel at all and fly a scripted path.
 *
 * Their waypoints are NOT in the playbook. `gen-playbook.py` says so in as many
 * words ("per-card XYZ waypoints are ABSENT from every source"), because the
 * upstream Python only ever carried the timing. They were read back out of the
 * .blend's baked F-curves by `scripts/decke/gen-cards.py` into `cards.json`,
 * which this module consumes.
 *
 * FIVE RULES, EACH OF WHICH COST SOMEONE A DEBUGGING PASS:
 *
 * 1. EXISTENCE IS SCALE. `card_l`/`card_r`/`single` at 0 mean scale 0 — the card
 *    is genuinely despawned, not faded. Blender animates `scale`, and a metallic
 *    card at opacity 0 still catches the environment.
 *
 * 2. `hand_l`/`hand_r` ARE A 3-POINT PATH, not a lerp: 0 = stowed behind him,
 *    0.5 = out to his SIDE (|x| = 2.05, clear of his 0.875 half-width plus the
 *    card), 1.0 = presented in front. Interpolating 0 -> 1 directly cuts the
 *    corner and drives the card THROUGH his body. Verified against the file: all
 *    15 authored `Hand_R_Ctrl` keyframes reproduce from those three waypoints by
 *    piecewise-linear blend to 4.7e-07.
 *
 * 3. `orb_on` MUST STAY 0 DURING `card_present`. The orbit waypoint sits in
 *    FRONT of him, so blending toward it drives the card through his body. A
 *    stale block comment in `decke_states.py` claims `orb_on` rides to 1
 *    mid-move; the inline comment and the data both say 0, and the data wins.
 *
 * 4. ORBITING, FLYING AND STASHED CARDS GET NO FACING COMPENSATION AT ALL. They
 *    rotate rigidly with him. This was verified three ways upstream and two
 *    earlier "fixes" both made it worse — `Card_Unturn` froze card POSITIONS in
 *    world space so they despawned to his side, and `CardFace_L/R` froze
 *    ORIENTATION while position still rotated, decoupling the two by exactly
 *    80.39 degrees so the cards sliced through their own orbit edge-first.
 *
 * 5. THE PRESENTED CARD IS THE EXCEPTION, and it takes a gated SELF-MIRROR, not
 *    an un-turn. See `writeLocal` below.
 */
import { Object3D, Quaternion, Vector3 } from 'three'
import { blenderEulerToThree, blenderToThree } from './constants'
import { evalCurve, makeCurve, type Curve, type Key } from './curve'
import type { Pose } from './playbook'

// ------------------------------------------------------------------ the data

type Waypoint = { loc: [number, number, number]; rot: [number, number, number] }

type HandDoc = {
  node: string
  stow: Waypoint
  side: Waypoint
  front: Waypoint
  orbit: Waypoint
  deploy_source: string
}

export type CardsDoc = {
  schema: string
  fps: number
  orbit: {
    root_location: [number, number, number]
    period_ms: number
    block_ms: number
    turns: number
  }
  hands: { L: HandDoc; R: HandDoc }
  loose_cards: Record<
    'card_l' | 'card_r',
    { node: string; hand: 'L' | 'R'; orbit_scale: Key[]; loop_ms: number }
  >
  stash: {
    cards: {
      node: string
      start_ms: number
      /** `matrix_parent_inverse` translation — see the note in `apply`. */
      parent_offset: [number, number, number]
      channels: Record<string, Key[]>
    }[]
  }
  present_gate: { states: Record<string, Key[]> }
  single: { node: string }
}

export async function loadCards(baseUrl: string): Promise<CardsDoc> {
  const res = await fetch(`${baseUrl}models/decke/cards.json`)
  if (!res.ok) throw new Error(`cards: ${res.status} ${res.statusText}`)
  return (await res.json()) as CardsDoc
}

// ------------------------------------------------------------------ the nodes

export type CardNodes = {
  orbitRoot: Object3D
  handL: Object3D
  handR: Object3D
  cardL: Object3D
  cardR: Object3D
  cardSingle: Object3D
  stash: Object3D[]
}

function req(scene: Object3D, name: string): Object3D {
  const o = scene.getObjectByName(name)
  if (!o) throw new Error(`decke cards: node "${name}" missing from the glb`)
  return o
}

export function bindCards(scene: Object3D, doc: CardsDoc): CardNodes {
  return {
    orbitRoot: req(scene, 'Orbit_Root'),
    handL: req(scene, doc.hands.L.node),
    handR: req(scene, doc.hands.R.node),
    cardL: req(scene, doc.loose_cards.card_l.node),
    cardR: req(scene, doc.loose_cards.card_r.node),
    cardSingle: req(scene, doc.single.node),
    stash: doc.stash.cards.map((c) => req(scene, c.node)),
  }
}

// --------------------------------------------------------------- the mechanics

/** A Blender-frame rigid transform, before axis conversion. */
type Local = { x: number; y: number; z: number; rx: number; ry: number; rz: number }

const _a: Local = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 }
const _b: Local = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 }
const _c: Local = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 }
const _v = new Vector3()
const _q = new Quaternion()

function fromWaypoint(w: Waypoint, out: Local): Local {
  out.x = w.loc[0]
  out.y = w.loc[1]
  out.z = w.loc[2]
  out.rx = w.rot[0]
  out.ry = w.rot[1]
  out.rz = w.rot[2]
  return out
}

function lerpLocal(a: Local, b: Local, u: number, out: Local): Local {
  out.x = a.x + (b.x - a.x) * u
  out.y = a.y + (b.y - a.y) * u
  out.z = a.z + (b.z - a.z) * u
  out.rx = a.rx + (b.rx - a.rx) * u
  out.ry = a.ry + (b.ry - a.ry) * u
  out.rz = a.rz + (b.rz - a.rz) * u
  return out
}

/**
 * Write a Blender-frame local transform onto a three.js node, mirrored by `k`.
 *
 * THE GATED SELF-MIRROR. `k = 1 - present * (1 - facing)` is +1 normally and -1
 * while presenting at `facing = -1`, and it is applied to `loc.x`, `rot.y` and
 * `rot.z` — which is exactly `M' = S * M * S` with `S = diag(-1, 1, 1)` for a
 * rigid transform.
 *
 * Applied at EVERY node of the loose-card chain the adjacent `S`s telescope, so
 * the whole chain composes to `S * (O * H * C) * S`. That maps mirrored inputs
 * to mirrored outputs: the card's PLACEMENT mirrors while the card's own
 * geometry is left alone, so the ARTWORK stays readable. A single
 * `scale.x = -1` would mirror the placement AND reverse the text (verified in
 * Blender: the flipped pass read "KNIWMOSSOJB" where it should read
 * "BLOSSOMWINK").
 *
 * IT IS A MIRROR, NOT AN UN-TURN. The chain lives below the yaw, and because a
 * rotation composed with a reflection is a reflection with its plane rotated by
 * half the angle, `M_world = R_yaw . S_body` — so achieving the world mirror
 * needs only `S_body`, with no counter-yaw at all. Cancelling the yaw instead
 * lands the card at the SAME screen position as the unmirrored pass when the
 * goal is the mirrored one, which is why the first attempt read as "not
 * mirrored" rather than as obviously broken.
 *
 * At `facing = +1`, `k = 1` for ANY value of `present`. The gate cannot disturb
 * the authored pass — that is algebra, not tolerance.
 */
function writeLocal(node: Object3D, t: Local, k: number) {
  node.position.copy(blenderToThree(t.x * k, t.y, t.z, _v))
  node.quaternion.copy(blenderEulerToThree(t.rx, t.ry * k, t.rz * k, _q))
}

// --------------------------------------------------------------- the system

export type CardFrame = {
  facing: number
  /** The base state's name — the stash flight and the present gate are keyed to
   *  it, because neither has a pose channel of its own. */
  state: string
  /** Milliseconds since the state started, NOT wrapped to the clip's loop. The
   *  orbit needs the unwrapped value; see `orbitRad`. */
  tMs: number
}

export type CardSystem = { apply(pose: Pose, frame: CardFrame): void }

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

export function createCardSystem(doc: CardsDoc, nodes: CardNodes): CardSystem {
  const gate = new Map<string, Curve>()
  for (const [state, keys] of Object.entries(doc.present_gate.states)) {
    gate.set(state, makeCurve(keys))
  }

  const looseScale = {
    card_l: makeCurve(doc.loose_cards.card_l.orbit_scale),
    card_r: makeCurve(doc.loose_cards.card_r.orbit_scale),
  }

  // The stash flight, compiled once. Channels absent from a card (its `rx`/`ry`
  // never move) simply do not appear.
  const stash = doc.stash.cards.map((c, i) => ({
    node: nodes.stash[i],
    offset: c.parent_offset,
    curves: Object.fromEntries(
      Object.entries(c.channels).map(([ch, keys]) => [ch, makeCurve(keys)]),
    ) as Record<string, Curve>,
  }))

  /**
   * ONE CONTINUOUS ROTATION, not per-card phase.
   *
   * `orb_l`/`orb_r` look like per-card orbit phase and are DEAD — the .blend has
   * a single `Orbit_Root.rotation_euler[2]` running 0 -> -12.566371 rad (two
   * full turns) over 162 frames, keyed LINEAR. One revolution is therefore
   * 2700 ms, which is deliberately NOT the 1800 ms `loading` clip loop: the two
   * beat against each other so the orbit never visibly repeats with the mouth
   * bob. That is only reproducible from UNWRAPPED state time — drive it from
   * the looped clip clock and the cards jump back a third of a turn every loop.
   */
  const period = doc.orbit.period_ms
  const dir = Math.sign(doc.orbit.turns) || -1
  const orbitRad = (tMs: number) => dir * 2 * Math.PI * (tMs / period)

  const root = doc.orbit.root_location
  const hands = [
    { doc: doc.hands.L, node: nodes.handL, ch: 'hand_l' as const },
    { doc: doc.hands.R, node: nodes.handR, ch: 'hand_r' as const },
  ]
  const loose = [
    { node: nodes.cardL, ch: 'card_l' as const, curve: looseScale.card_l, cfg: doc.loose_cards.card_l },
    { node: nodes.cardR, ch: 'card_r' as const, curve: looseScale.card_r, cfg: doc.loose_cards.card_r },
  ]

  function apply(pose: Pose, frame: CardFrame) {
    const { facing, state, tMs } = frame

    // ---- the present gate ----------------------------------------------
    // ENUMERATE THE BEATS, DO NOT SAMPLE ONE. There are THREE loose-card beats
    // and only TWO are presentations: `card_present` and `travel_point` are
    // gated, the `loading` orbit is not. An earlier implementation found the
    // window by sampling one beat and left `point`/`travel_point` broken.
    //
    // The ramps are authored 8-12 frames wide and sit entirely OUTSIDE the
    // card's scale pop, so the gate only ever swings while the card is
    // invisible. A gate that ramps under a visible card rotates it through tens
    // of degrees in a few frames and reads as a swoosh on pop-in.
    const g = gate.get(state)
    const present = g ? clamp01(evalCurve(g, tMs)) : 0
    const k = 1 - present * (1 - facing)

    const orb = clamp01(pose.orb_on ?? 0)

    // ---- Orbit_Root ------------------------------------------------------
    _a.x = root[0]
    _a.y = root[1]
    _a.z = root[2]
    _a.rx = 0
    _a.ry = 0
    // Scaled by `orb` so the angle unwinds to zero as the state blends out,
    // rather than leaving the hands parked at a stale rotation.
    _a.rz = orb * orbitRad(tMs)
    writeLocal(nodes.orbitRoot, _a, k)

    // ---- the hands -------------------------------------------------------
    for (const h of hands) {
      const v = clamp01(pose[h.ch] ?? 0)
      // The DEPLOY path: stow -> side -> front, piecewise linear in `hand_*`.
      if (v <= 0.5) {
        lerpLocal(fromWaypoint(h.doc.stow, _a), fromWaypoint(h.doc.side, _b), v / 0.5, _a)
      } else {
        lerpLocal(fromWaypoint(h.doc.side, _a), fromWaypoint(h.doc.front, _b), (v - 0.5) / 0.5, _a)
      }
      // `orb_on` selects the target, so the same channel means "how far out" in
      // both modes: at 1 the hand runs straight from its stow to its orbit
      // station instead of via the deploy path.
      if (orb > 0) {
        lerpLocal(fromWaypoint(h.doc.stow, _b), fromWaypoint(h.doc.orbit, _c), v, _b)
        lerpLocal(_a, _b, orb, _a)
      }
      writeLocal(h.node, _a, k)
    }

    // ---- the loose cards -------------------------------------------------
    // Their location and rotation are identically zero for the whole timeline —
    // the card's offset and tilt live in the MESH, relative to the hand — so the
    // only thing to drive is existence. (They still take the mirror in the chain
    // above; with an identity transform `S * I * S` is the identity, which is
    // why the telescoping product still comes out as `S * (O*H*C) * S`.)
    for (const c of loose) {
      const base = clamp01(pose[c.ch] ?? 0)
      // During the orbit the authored fade schedule wins over the pose channel,
      // and it runs on ITS OWN 5400 ms period, not the 1800 ms clip loop. The
      // playbook channel drops to 0 at every clip boundary, and 1800 ms in the
      // hand is 240 degrees round — in FRONT of him — so honouring it would pop
      // a card on and off on camera three times a cycle. Every authored fade
      // happens while that hand is BEHIND him, and because 5400 ms is exactly
      // two revolutions the schedule closes seamlessly. Blending by `orb` still
      // lets the pose channel take the card away as `loading` blends out.
      const orbital = evalCurve(c.curve, tMs % c.cfg.loop_ms)
      c.node.scale.setScalar(base + (orbital - base) * orb)
    }

    // ---- the card inside him ---------------------------------------------
    // `single` rests at 1, not 0: he starts with a card in him and `card_stash`
    // despawns it while the five stash cards fly.
    //
    // MULTIPLY, DO NOT SET. This node is a rider, so `riders.ts` has just
    // decomposed a field matrix onto it — and that matrix is NOT unit scale
    // (measured 0.921 x 0.921 x 1.180 on its twin at the full gape, because the
    // deformation field stretches the interior). Writing `setScalar(1)` at rest
    // silently deletes the field's own scaling and the card stops fitting the
    // slot it sits in. Multiplying is only safe because `riders.apply` rewrites
    // this node unconditionally on every frame, immediately before us — see the
    // ordering note in `DeckE.update`.
    nodes.cardSingle.scale.multiplyScalar(clamp01(pose.single ?? 1))

    // ---- the stash flight ------------------------------------------------
    // Five cards out of the 115-degree gape and back in, staggered ~133 ms
    // apart. There is no pose channel for these, so the state name is the gate:
    // the flight is a scripted one-shot that belongs to `card_stash` alone.
    // Stashed cards take NO facing compensation — they are children of the tilt
    // node and rotate rigidly with him, which is correct and was verified three
    // ways upstream.
    const stashing = state === 'card_stash'
    for (const c of stash) {
      if (!stashing) {
        c.node.scale.setScalar(0)
        continue
      }
      const s = evalCurve(c.curves.s, tMs)
      c.node.scale.setScalar(s)
      if (s <= 0) continue // despawned; no point converting a transform nobody sees
      const cv = c.curves
      // THE PARENT INVERSE. Cards 2-5 were parented to `DeckE_Tilt` with Keep
      // Transform, so in Blender `world = parent * PI * basis` and the F-curve
      // values are 0.1357 short in z. glTF has no parent inverse — the exporter
      // folded it into the node, and writing the raw F-curve value over the top
      // throws it away. Card 1's is identity, which is exactly the kind of
      // asymmetry that makes this look like a per-card animation bug.
      _a.x = c.offset[0] + (cv.lx ? evalCurve(cv.lx, tMs) : 0)
      _a.y = c.offset[1] + (cv.ly ? evalCurve(cv.ly, tMs) : 0)
      _a.z = c.offset[2] + (cv.lz ? evalCurve(cv.lz, tMs) : 0)
      _a.rx = cv.rx ? evalCurve(cv.rx, tMs) : 0
      _a.ry = cv.ry ? evalCurve(cv.ry, tMs) : 0
      _a.rz = cv.rz ? evalCurve(cv.rz, tMs) : 0
      writeLocal(c.node, _a, 1)
    }
  }

  return { apply }
}
