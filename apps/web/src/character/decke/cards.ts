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
import type { CardArt, CardArtSystem } from './cardArt'
import { blenderEulerToThree, blenderToThree } from './constants'
import { evalCurve, makeCurve, type Curve, type Key } from './curve'
import type { Pose } from './playbook'
import { Rng } from './procedural'

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
export type Local = { x: number; y: number; z: number; rx: number; ry: number; rz: number }

const _a: Local = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 }
const _b: Local = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 }
const _c: Local = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 }
const _home: Local = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 }
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
  /** Which part of the state's life is playing. The stash flight is the one
   *  thing here that behaves differently in a sustain than in an intro: the
   *  cards go UP during the intro, hang there for as long as the sustain lasts,
   *  and only come home on the outro. */
  phase: 'intro' | 'sustain' | 'outro'
  /** Milliseconds since the state started, NOT wrapped to the clip's loop. The
   *  orbit needs the unwrapped value; see `orbitRad`. */
  tMs: number
  /** Where the state's own clip is — wrapped by the sustain loop, held at the
   *  loop point on a hold. TWO CLOCKS IS NOT AN ACCIDENT: the orbit and the
   *  stash flight are continuous motions that must not rewind, and the present
   *  gate is a position in the AUTHORED clip that must not run past its end. */
  clipTMs: number
  /** Milliseconds since the current phase started. */
  phaseTMs: number
  /**
   * Whether the BASE state is the orbit (`loading`), regardless of phase.
   *
   * Not `orb_on > 0`: that channel ramps through the crossfade, and a loose
   * card's existence must be decided by the authored spawn schedule from the
   * very first frame. See the note in `apply`.
   */
  orbit: boolean
  /**
   * His idle hover this frame, in blender units and DEGREES — the same numbers
   * that go on `DeckE_Float`. The hands hang off `Orbit_Root`, which is a
   * SIBLING of `DeckE_Float`, so nothing he does with his hover has ever reached
   * the card he is presenting. See `RIDE`.
   */
  float: { x: number; y: number; z: number; rx: number; ry: number; rz: number }
}

export type CardSystem = {
  apply(pose: Pose, frame: CardFrame): void
  /** How many cards the next `card_stash` shows, on the placeholder art baked
   *  into the glb. Sugar for `setStashCards` with a run of nulls. Takes effect
   *  on the next ENTRY, never mid-state. */
  setCount(n: number): void
  /**
   * The cards the next `card_stash` shows, in order.
   *
   * Longer than `MAX_STASH` is not an error — it is the normal case, and it is
   * what makes this a run of BATCHES rather than one fan. `autoClose` makes the
   * last batch file itself in too, so the whole run is a complete gesture; left
   * off, the last batch hangs until something releases him, which is the
   * behaviour every earlier review was given.
   */
  setStashCards(arts: (CardArt | null)[], opts?: { autoClose?: boolean }): void
  /**
   * Whether entering `state` would apply a run that has been set but not shown.
   *
   * The state machine asks, and it has to: re-issuing the state he is already in
   * is deliberately a NO-OP (an agent saying "still thinking" three turns
   * running must not restart him), and that rule silently swallowed "now show
   * these OTHER cards" — the run landed as pending and waited for an entry that
   * might never come, so he went on holding up the previous batch. A pending run
   * is a real change, the same way `durationMs` and `then` are.
   */
  hasPending(state: string): boolean
  /**
   * Whether the stash run has shown everything it was asked to and is waiting
   * to be let go. Only ever true when the run asked for `autoClose`; the state
   * machine polls it and starts the outro, so that the lid closing and the last
   * batch diving in stay the single choreographed beat they were authored as.
   */
  wantsClose(): boolean
  /** Called when the base state changes, before the first frame of the new one.
   *  The one place a pending layout may safely land. */
  enter(state: string): void
  /**
   * Whether anything this system owns is currently on screen.
   *
   * The state machine asks, because "is there something to put away" is the only
   * honest test for whether an interrupted state owes an outro. Phase is not
   * that test: `card_stash`'s first card leaves the mouth inside the intro and
   * `loading`'s left card is fully spawned at 200 ms of a 900 ms one, so cutting
   * away during an intro used to delete a visible card outright.
   */
  deployed(): boolean
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

/**
 * How much of his hover the hands carry.
 *
 * "On card present, let's have the card kind of bobbing with him, like it's a
 * rider on him... maybe have it doing the same motions as him, but a little less
 * of a magnitude — like half of the amount of movement of him."
 *
 * Half, then. It is applied at `Orbit_Root`, which is the parent of both hands
 * and therefore of the presented card AND the two orbiting ones — a card held
 * out in front of a character who is bobbing and a card that is not are two
 * different objects, and the eye reads the second as pinned to the screen rather
 * than to him.
 */
const RIDE = 0.5

const RAD = Math.PI / 180

/**
 * How long the spawn pop takes, having been stretched.
 *
 * The authored pop is 0 -> 1.15 in TWO FRAMES (67 ms). At 30 fps that is not a
 * pop, it is an appearance: "these cards are just appearing, they should be
 * popping in with like a scale up." The overshoot the animator wrote is real and
 * correct — it is just far too fast to see.
 */
const POP_MS = 280

/**
 * The spawn pop, as ONE curve every card shares.
 *
 * It used to be read per card, from that card's own baked `s` F-curve. All five
 * are the same curve at different offsets, and there are only five of them —
 * which stops being true the moment the batch size is dynamic. Deriving one
 * curve from the first card keeps the animator's overshoot and its settle
 * verbatim while making it something a thirteenth card could also use.
 */
function popCurveFrom(keys: Key[]): Curve {
  const peak = keys.reduce((best, k) => (k.v > (best?.v ?? -Infinity) ? k : best), keys[0])
  const settle = keys.find((k) => k.t > peak.t)
  const overshoot = peak?.v ?? 1
  const settleMs = settle ? settle.t - peak.t : POP_MS
  return makeCurve([
    { t: 0, v: 0, interp: 'ease' },
    { t: POP_MS, v: overshoot, interp: 'ease' },
    { t: POP_MS + settleMs, v: settle?.v ?? 1, interp: 'ease' },
  ])
}

/**
 * The free float each stashed card takes while it hangs in the air.
 *
 * "I'd like them to pop up and kind of float a little for just a little bit
 * longer... they're not all locked together and they're not floating with him,
 * but they're kind of just floating all around."
 *
 * NOT FLOATING WITH HIM COMES FREE: the stash cards hang off `DeckE_Tilt`, a
 * SIBLING of `DeckE_Float`, so his hover has never reached them. Not being
 * locked to each other is what this supplies — one sine per card per axis, with
 * the phases spaced by the golden angle so no two cards ever synchronise and the
 * set never reads as a rigid constellation. Same reasoning as the idle float's
 * irrational frequency ratios, one dimension down.
 */
const STASH_FLOAT = {
  hz: 0.27,
  /** Blender units, vertical. About a tenth of a card height. */
  amp: 0.17,
  /** Sideways drift, deliberately smaller so the set stays legible. */
  ampX: 0.07,
  /** Radians of lazy tumble. */
  ampRot: 0.09,
  /** The golden angle, in radians. */
  phaseStep: 2.39996,
  /** How long the float takes to reach full amplitude once a card settles, so
   *  it eases in rather than switching on. */
  rampMs: 420,
  /** And how long it takes to let go again on the way home. */
  releaseMs: 220,
}

/**
 * The stash flight, respecified.
 *
 * THE AUTHORED PATH CANNOT BE USED. Its five cards all converge on the same
 * point: their apexes are (-0.378, -0.550, 3.450), (0.342, -0.550, 3.314),
 * (-0.198, ...), (0.414, ...), (0.054, ...) — an x spread of 0.79 for a card
 * that is 1.57 wide. They are drawn ON TOP OF EACH OTHER by construction, and
 * they interpenetrate, which is what the reviewer described: "the way that they
 * are all here, they're like all clipping through each other, and we need to not
 * have them do that." The stack also sits directly in front of his face, so the
 * character presenting them is hidden behind them.
 *
 * WHAT IT IS FOR, which is what makes the fix a respecification rather than a
 * nudge: "the way that I see this being used is like they add a whole bunch of
 * cards to their collection, and this is his way of showing the actual cards
 * they added going down into the deck box. So they need to spawn in a way that
 * they are, like, all individually visible and stay there... I would honestly
 * have them all spawn so that they are in front of him a little bit and then
 * spaced out all around him in a randomized way. And then when they're ready to
 * go in, they all come up together like this, but hopefully so they're not
 * clipping, and then quickly go down in."
 *
 * So: a computed fan, not five baked paths. Every card gets its own station on
 * an arc around his front, and the arc is sized from the card's own width so
 * that "not clipping" is a property of the layout rather than something to check
 * by eye.
 *
 * TWO RINGS, BECAUSE ONE CANNOT HOLD THEM. A card of half-width `h` at radius
 * `r` occupies `2 asin(h/r)` of arc — 45 degrees at full size on the near ring.
 * Five of those need 225 degrees and there are only 168 usable before a card is
 * behind him. Alternating cards between a near-low ring and a far-high one
 * doubles the spacing available to each, and shrinking the cards as the batch
 * grows (see `sizeForCount`) buys the rest: the layout stays collision-free to
 * twelve, which is the cap.
 */
export const STASH = {
  /** Where a card is born, in `DeckE_Tilt` local blender coords: the open mouth.
   *  His feet are z = 0 and he is 2.4 tall, so this is just inside the lid. */
  mouth: { x: 0, y: -0.2, z: 2.3 },
  /** The crest it rises to before fanning out — clear of his head, so the fan
   *  reads as cards leaving him rather than as cards passing through him. */
  crest: { x: 0, y: -0.6, z: 3.4 },
  /**
   * How long the lid takes to get out of the way.
   *
   * The authored gape does not reach its full 115 degrees until 400 ms, and the
   * respecified launch schedule started card 0 at t = 0 — so the first card rose
   * through a lid that was still opening. The authored `start_ms` values carried
   * this delay (400, 533, 667, ...) and the respecification dropped it; this puts
   * it back as a named constant rather than as an accident of the data.
   */
  gapeMs: 380,
  /** Mouth -> crest, then crest -> station. */
  riseMs: 240,
  travelMs: 460,
  /** Between one card leaving and the next. They file out, they do not erupt. */
  staggerMs: 130,
  /**
   * The most the launch may take in total, however many cards there are.
   *
   * A fixed per-card gap is right up to about seven cards and wrong at twelve:
   * 130 ms x 11 is 1.4 seconds during which nothing has happened but cards
   * appearing, and with several batches to get through that is most of the
   * animation. Capping the SPAN keeps the authored cadence exactly where it was
   * reviewed (any batch of seven or fewer is unchanged to the millisecond) and
   * tightens only the batches that did not exist then. Same reasoning as
   * `fileSpanMs`, which already does this for the way in.
   */
  launchSpanMaxMs: 900,
  /**
   * How long a batch hangs there before it files in, when another batch is
   * waiting behind it.
   *
   * "The next X-card batch pops up for a little, then goes in." Long enough to
   * read a card and see that it is a different card from the last lot; short
   * enough that four batches is a flourish rather than a wait. Measured from the
   * LAST card's arrival, so a big batch is not cut short by its own stagger.
   *
   * The FINAL batch ignores this and hangs — see `run.autoClose`.
   */
  holdMs: 900,

  // ---- the fan, laid out in what the READER sees ------------------------
  //
  // THE LAYOUT IS IN SCREEN AXES, NOT IN HIS. Two goes at this were polar —
  // cards on rings at even angular spacing — and the second one is why these are
  // the constants that exist. Even angles are not even positions: `sin` flattens
  // out near 90 degrees, so a card at 38 degrees and one at 105 degrees on the
  // same ring land 0.67 units apart on screen when they need 0.78, and they
  // overlap. `__tests__/cards.test.ts` caught it at five cards.
  //
  // So the fan is a grid in the plane the reader is looking at: columns out to
  // each side, rows up the frame, and a clear column down the middle where he
  // stands. Depth then only decides which card is in front of which, and can be
  // used for life rather than for spacing.
  //
  // His own bearing relative to the camera is a constant now (see `framing.ts`),
  // so "the plane the reader is looking at" is expressible in his local frame
  // without threading a camera down here: it is `CAM_BEARING_DEG * facing`.

  /** Heights, low to high. Rows are `rowStep` apart, which has to clear a card's
   *  height at the largest size a batch is drawn at. */
  rowZ: [1.0, 2.15, 3.25],
  /** The clear column down the middle. Wide enough that a card's inner edge
   *  still clears his 0.875 half-width. */
  gapX: 1.5,
  /** How far apart columns sit, across the screen. */
  stepX: 0.9,
  /** How many columns each side may use. Three rows x two sides x two columns is
   *  twelve slots, which is `MAX_STASH`. */
  cols: 2,
  /**
   * How far in front of him (toward the camera) each row sits, and how much
   * further each column out. Depth is for LIFE, not for spacing — it stops the
   * fan being a flat wall without affecting whether two cards overlap.
   */
  depthBase: 0.5,
  depthPerRow: -0.28,
  depthPerCol: 0.3,
  /** Per-card jitter, so the fan reads as scattered rather than as a diagram.
   *  Drawn from a seeded PRNG — never `Math.random`, so the same batch of cards
   *  lays out the same way every time it is played. */
  jitterX: 0.12,
  jitterZ: 0.16,
  jitterDepth: 0.2,
  /**
   * How far each card turns away from square-on, per unit of screen offset.
   *
   * 0 is a readable but dead grid; too much turns the outer cards edge-on, which
   * is what the polar layout did. This splays the widest card by about 25
   * degrees, i.e. 90% of its width still facing the reader.
   */
  splayPerX: 0.16,
  jitterTilt: 0.15,

  // ---- the way home -----------------------------------------------------
  /** Gather to a stack above the mouth, then dive in. */
  gatherMs: 380,
  diveMs: 240,
  /**
   * How long the whole file-in takes, SHARED between however many cards there
   * are — not a per-card gap.
   *
   * A fixed gap makes the outro's length a function of the batch size, and the
   * body's way out (`STASH_CLOSE`) is one authored clip. Dividing a fixed span
   * keeps the two in step at any count: two cards file in leisurely, twelve file
   * in fast, and the lid closes at the same moment either way.
   */
  fileSpanMs: 200,
  /**
   * A beat between one batch going in and the next coming out.
   *
   * NOT DECORATION. Without it the next batch starts on the exact frame the last
   * card of the previous one finishes its dive, and "exact frame" is a race the
   * dive loses: the batch advances first, so the final card of every
   * intermediate batch vanished without ever reaching the top of the deck. The
   * observable symptom was the stack's face skipping a card at every batch
   * boundary — c10 straight to c12 in a twenty-card run.
   *
   * It also reads better than an instant restart: one card lands, the deck shows
   * it, and then the next lot comes up.
   */
  betweenMs: 200,
  /** Where they gather. Just above and in front of the open lid. */
  cluster: { x: 0, y: -0.5, z: 3.3 },
  /** How far apart in the stack, so the gather is a neat pile and not a single
   *  point five cards deep. */
  clusterStep: 0.055,
} as const

/** The card's own half-size, from the mesh: 1.570 x 2.198 at scale 1. */
export const CARD_HALF = { w: 0.785, h: 1.099 } as const

/**
 * Where the camera sits in his local frame, in degrees off his forward.
 *
 * The staging camera is 40.195 degrees off camera-forward at either end of the
 * facing sweep — that IS the facing system's 3/4 view, and it is what makes the
 * sign symmetric. So at `facing = +1` the camera bears +40.195 from his forward
 * and at -1 it bears -40.195, and in between it interpolates with him.
 */
const CAM_BEARING_DEG = 40.195

/** The seed for the stash layout jitter. Its own constant so the layout cannot
 *  drift when some other layer changes how many draws it makes. */
const STASH_SEED = 20260820

/**
 * The card's size in the fan, at rest.
 *
 * The authored card is 1.570 x 2.198 — very nearly the size of the character
 * himself (1.75 x 2.4), which is right for ONE card held up as a hero and
 * impossible for a fan of five: at full size they cover him and each other
 * whatever the spacing. Two thirds is a card he is holding out rather than a
 * poster he is standing behind.
 */
const FAN_SCALE = 0.62

/**
 * And they shrink further as the batch grows.
 *
 * A dozen cards at full size cannot be spaced without overlap, and they would be
 * a wall rather than a hand — the whole point is that the reader can see WHICH
 * cards they just added. The square-root law keeps the total area they cover
 * roughly constant; the floor stops a big batch becoming confetti.
 *
 * The floor being 0.62 as well is a COINCIDENCE, not a relationship: one is what
 * a card he is holding out looks like, the other is how small a card may get
 * before it stops being readable. They are free to diverge.
 */
const FAN_FLOOR = 0.62

export function sizeForCount(n: number): number {
  return FAN_SCALE * Math.min(1, Math.max(FAN_FLOOR, Math.sqrt(5 / Math.max(1, n))))
}

/** An angle folded into (-pi, pi]. The same rotation, expressed as the shortest
 *  one — which is what makes scaling it toward zero a small move. */
function wrapAngle(a: number): number {
  const turn = 2 * Math.PI
  const m = ((a % turn) + turn) % turn
  return m > Math.PI ? m - turn : m
}

/** One card's place in the fan, before it is attached to a node. */
export type StashStation = {
  /** Across the screen, in blender units. Negative is the reader's left. */
  sx: number
  /** How high. */
  z: number
  /** Toward the reader from him. Positive is in front. */
  depth: number
  /** Resting tilt, added to the resolved bearing. */
  rz: number
  rx: number
  ry: number
}

/**
 * Lay out `n` cards in the fan. PURE and DETERMINISTIC: same `n`, same fan,
 * every time — which is what lets `__tests__/cards.test.ts` assert that the
 * layout cannot produce two overlapping cards, rather than someone checking by
 * eye at one count and hoping.
 *
 * Slots are filled from the middle outward and alternating sides, so a small
 * batch is balanced and a large one grows outward rather than piling up on one
 * side. Rows before columns, because a taller fan reads better than a wider one
 * and the viewport is wider than it is tall.
 */
export function stashLayout(n: number): StashStation[] {
  const rng = new Rng(STASH_SEED, 48271, 2147483647)
  const rows = STASH.rowZ.length
  // Middle row first, then out: the eye starts at his own height.
  const rowOrder = [...STASH.rowZ.keys()].sort(
    (a, b) => Math.abs(a - (rows - 1) / 2) - Math.abs(b - (rows - 1) / 2),
  )
  const slots: { row: number; side: number; col: number }[] = []
  for (let col = 0; col < STASH.cols; col++) {
    for (const row of rowOrder) {
      for (const side of [-1, 1]) slots.push({ row, side, col })
    }
  }
  const out: StashStation[] = []
  for (let i = 0; i < Math.min(n, slots.length); i++) {
    const { row, side, col } = slots[i]
    const sx = side * (STASH.gapX + (col + 0.5) * STASH.stepX) + (rng.next() - 0.5) * STASH.jitterX
    out.push({
      sx,
      z: STASH.rowZ[row] + (rng.next() - 0.5) * STASH.jitterZ,
      depth:
        STASH.depthBase +
        row * STASH.depthPerRow +
        col * STASH.depthPerCol +
        (rng.next() - 0.5) * STASH.jitterDepth,
      rz: -sx * STASH.splayPerX + (rng.next() - 0.5) * STASH.jitterTilt,
      rx: (rng.next() - 0.5) * STASH.jitterTilt,
      ry: (rng.next() - 0.5) * STASH.jitterTilt,
    })
  }
  return out
}

/** Three rows, two sides, two columns. More than this is confetti: at twelve the
 *  cards are already down to 62% of the fan size. It is therefore also the most
 *  that can be on screen AT ONCE — see `BATCH_MAX`. */
export const MAX_STASH = STASH.rowZ.length * 2 * STASH.cols

/**
 * The most cards one batch shows.
 *
 * The fan is collision-free to twelve and no further, so this is the layout's
 * limit rather than a taste call — which is exactly why the answer to "they
 * added thirty" is more batches and not a bigger fan. See `splitBatches`.
 */
export const BATCH_MAX = MAX_STASH

/**
 * The most batches one run plays.
 *
 * Four batches of twelve is around sixteen seconds, which is already a long
 * time to watch a deck box eat cards. Someone who imports a two-hundred-card
 * collection is not owed a two-minute animation, and the alternative to a cap
 * is that the character is unavailable for other work for minutes at a time.
 * Anything past this is dropped and SAID SO — see `splitBatches`, which warns
 * rather than truncating quietly.
 */
export const MAX_BATCHES = 4

/** The most cards a single run will show. Past this the rest are dropped. */
export const MAX_RUN = BATCH_MAX * MAX_BATCHES

/**
 * Split a run into batches, filling each to the brim before starting the next.
 *
 * NOT BALANCED ACROSS BATCHES on purpose. Thirteen cards could be 7 + 6, and
 * that reads as two half-hearted fans; 12 + 1 reads as "here they are" followed
 * by "and one more", which is what actually happened. The count is information.
 */
/**
 * How far into GIVING UP ITS CARDS a batch is, or null while it is still holding
 * them up.
 *
 * PURE AND EXPORTED because this one expression is where the worst bug in the
 * batching work lived, and it is invisible in a still frame. Two clocks can
 * start a close and they have to COMPOSE, not choose:
 *
 *   - a batch that is not the last closes on its OWN clock, at `closeAt`;
 *   - ANY batch closes when the state outros, because the outro is the lid
 *     coming down and nothing may still be in the air when it does.
 *
 * Choosing between them was the defect. The batch clock `tb` freezes when the
 * outro begins — it has to, or an unlaunched card would spawn inside the
 * animation whose job is to put things away — so an intermediate batch that had
 * not reached `closeAt` yet froze with it. Measured: cut a thirty-card run at
 * 2.1 s and all twelve cards hung motionless at a mean height of 2.11 for a full
 * second, float and all, and then vanished at the state change. That is exactly
 * the "objects deleted out from under the reader" the outro machinery exists to
 * prevent, reintroduced by batching.
 *
 * So the answer is the batch's own progress AT THE FREEZE, continued by the
 * state's outro clock. For a last batch the frozen progress is zero and this is
 * exactly `outroTMs`, which is the animation that was reviewed and signed off.
 * For an intermediate batch mid-gather it picks up where it left off, so the
 * gather can never jump backwards.
 *
 * @param tb       the batch's own clock, already frozen if the state is outroing
 * @param closeAt  when this batch closes itself, or null if it hangs
 * @param outroTMs ms since the state's outro began, or null if it is not
 */
export function closeProgress(
  tb: number,
  closeAt: number | null,
  outroTMs: number | null,
): number | null {
  const own = closeAt === null ? null : tb - closeAt
  if (outroTMs !== null) return Math.max(0, own ?? 0) + outroTMs
  return own !== null && own >= 0 ? own : null
}

/** When one card leaves the mouth, tops out and reaches its station — all in the
 *  BATCH's own clock, which restarts for every batch. */
export type Launch = { outMs: number; crestMs: number; arriveMs: number }

/**
 * A batch's whole timeline, as arithmetic on `STASH` and nothing else.
 *
 * PURE AND EXPORTED because the two things that went wrong here are both
 * arithmetic, and neither is visible in a screenshot until you already know to
 * look. The first is the launch span (a fixed per-card gap makes a twelve-card
 * batch spend 1.4 seconds doing nothing but appearing). The second is the
 * boundary: `endMs` has to be strictly LATER than the last card's dive, because
 * the batch advances on `>=` and the dive completes on `>=`, so an `endMs` equal
 * to the last dive means the next batch wins the frame and the final card of
 * every intermediate batch vanishes without ever reaching the top of the deck.
 * That one shipped as "the stack's face skips a card at every boundary".
 *
 * @param first Whether this batch has to wait for the lid. Only the first does.
 * @param last  The last batch HANGS: its close is the state's outro, so that the
 *   lid shutting and the cards diving in stay one authored beat. `closeAt` is
 *   null and `endMs` is what the run WOULD take if something closed it.
 */
export function batchSchedule(
  n: number,
  { first, last }: { first: boolean; last: boolean },
): { launch: Launch[]; closeAt: number | null; endMs: number } {
  const count = Math.max(1, Math.round(n))
  const gape = first ? STASH.gapeMs : 0
  const span = Math.min(STASH.staggerMs * (count - 1), STASH.launchSpanMaxMs)
  const step = count > 1 ? span / (count - 1) : 0
  const launch: Launch[] = []
  for (let i = 0; i < count; i++) {
    const outMs = gape + i * step
    launch.push({
      outMs,
      crestMs: outMs + STASH.riseMs,
      arriveMs: outMs + STASH.riseMs + STASH.travelMs,
    })
  }
  const settled = launch[launch.length - 1].arriveMs + STASH.holdMs
  return {
    launch,
    closeAt: last ? null : settled,
    endMs: settled + STASH.gatherMs + STASH.fileSpanMs + STASH.diveMs + STASH.betweenMs,
  }
}

export function splitBatches<T>(items: T[], size = BATCH_MAX): T[][] {
  // No cards is NO BATCHES, not one empty one. A zero-length batch divides by
  // zero in the file-in stagger and lays out a fan of nothing, and the clamp
  // that produced it (`Math.max(1, ...)` on the cap) read as defensive.
  // `createCardSystem.enter` substitutes a single placeholder card long before
  // this is reached, so nothing depends on the old behaviour — but a function
  // that CAN emit a degenerate batch is one somebody eventually gets from.
  if (!items.length) return []
  const cap = Math.min(items.length, size * MAX_BATCHES)
  if (items.length > cap) {
    console.warn(
      `decke cards: ${items.length} stash cards requested, showing ${cap} (${MAX_BATCHES} batches of ${size})`,
    )
  }
  const out: T[][] = []
  for (let i = 0; i < cap; i += size) out.push(items.slice(i, Math.min(i + size, cap)))
  return out
}

/**
 * A station, resolved into `DeckE_Tilt` local blender coordinates.
 *
 * PURE and exported so the frame conversion is testable. It is the one step of
 * the layout that is not expressed in what the reader sees, and a sign error
 * here — screen-right flipped, or the fan laid out behind him at `facing = -1` —
 * would pass every property test in station space while putting the whole fan
 * somewhere nobody can see it.
 */
export function stationLocal(st: StashStation, facing: number, out: Local): Local {
  // The view axis in his local frame. His forward is -Y, so a bearing of theta
  // is the direction (sin, -cos); the camera bears `CAM_BEARING_DEG * facing`.
  const theta = CAM_BEARING_DEG * RAD * facing
  const towardX = Math.sin(theta)
  const towardY = -Math.cos(theta)
  // Screen-right is that bearing turned a quarter turn.
  const rightX = Math.cos(theta)
  const rightY = Math.sin(theta)
  out.x = towardX * st.depth + rightX * st.sx
  out.y = towardY * st.depth + rightY * st.sx
  out.z = st.z
  out.rx = st.rx
  out.ry = st.ry
  // Square to the camera, splayed by how far out it sits.
  out.rz = theta + st.rz
  return out
}

/**
 * @param art The artwork system, if there is one. OPTIONAL because the flight
 *   is meaningful without it — the glb ships placeholder card art and every
 *   earlier review was done on it — and because the pure geometry is then
 *   testable without a WebGL context. When it is present, this module is what
 *   drives it: it is the only thing that knows which card is in which slot of
 *   which batch, and the only thing that knows the moment a card lands.
 */
export function createCardSystem(
  doc: CardsDoc,
  nodes: CardNodes,
  art?: CardArtSystem,
): CardSystem {
  const gate = new Map<string, Curve>()
  for (const [state, keys] of Object.entries(doc.present_gate.states)) {
    gate.set(state, makeCurve(keys))
  }

  const looseScale = {
    card_l: makeCurve(doc.loose_cards.card_l.orbit_scale),
    card_r: makeCurve(doc.loose_cards.card_r.orbit_scale),
  }

  // ---- the stash fan ---------------------------------------------------
  // The five exported meshes are a POOL, not the animation. Anything past the
  // fifth is a clone of one of them (three shares the geometry and the material
  // by reference, so a clone is a transform and nothing else), because the batch
  // size is whatever the user just added to their collection — "this needs to
  // really be dynamic".
  const stashParent = nodes.stash[0]?.parent ?? null
  const pool: Object3D[] = [...nodes.stash]
  const first = doc.stash.cards[0]
  const popCurve = popCurveFrom(first?.channels.s ?? [])

  function ensurePool(n: number) {
    if (!stashParent) return
    while (pool.length < n) {
      const src = nodes.stash[pool.length % nodes.stash.length]
      const clone = src.clone(true)
      clone.name = `${src.name}_x${pool.length}`
      clone.scale.setScalar(0)
      stashParent.add(clone)
      pool.push(clone)
      // A clone shares its source's MATERIAL, which by now may be carrying
      // another card's art. Giving it its own is not an optimisation; without it
      // the thirteenth card and the first are the same card, forever.
      art?.adoptStash(clone)
    }
  }

  type Station = StashStation & {
    node: Object3D
    /** Its own float phase, spaced by the golden angle so no two synchronise. */
    phase: number
    /** When it leaves the mouth, when it tops out, and when it arrives — all in
     *  the BATCH's own clock, not the state's. */
    outMs: number
    crestMs: number
    arriveMs: number
  }

  /**
   * One batch of the run: a fan, the cards in it, and when it gives up its
   * cards.
   *
   * `closeAt` is the batch's local time at which the gather begins, and `null`
   * means "hangs" — which is what the LAST batch does, because the last batch is
   * exactly the animation every earlier review looked at. See `runClose`.
   */
  type Batch = {
    stations: Station[]
    arts: (CardArt | null)[]
    scale: number
    /** State-clock ms at which this batch's own clock starts. */
    startMs: number
    closeAt: number | null
    /** Local ms at which the last card is fully inside him. */
    endMs: number
  }

  let batches: Batch[] = []
  let batchIndex = 0
  let autoClose = false
  /** Set once the final batch has hung long enough and the run asked to finish
   *  by itself. Read by the state machine; see `CardSystem.wantsClose`. */
  let closeWanted = false
  /** Requested but not yet applied. See `setStashCards`. */
  let pending: { arts: (CardArt | null)[]; autoClose: boolean } | null = null
  /** Whether anything was drawn last frame. See `CardSystem.deployed`. */
  let anyDeployed = false
  /** Which pool index most recently finished its dive, so the deck's top card
   *  can become that card. -1 while nothing has landed this batch. */
  let landed = -1

  /**
   * A RUN CHANGE LANDS ON THE NEXT ENTRY, never mid-state.
   *
   * Building the batches rebuilds the stations, the card scale AND the per-card
   * timings, so doing it while cards are in the air teleports the ones that
   * exist to a different fan and pops any extras into being at full size, their
   * launch long past. The command surface makes this reachable in one message —
   * `{op: "state", value: "card_stash", cards: [...]}` sets the run and then
   * queues the state behind whatever is playing — so it has to be safe, not
   * merely undocumented.
   */
  function setStashCards(arts: (CardArt | null)[], opts: { autoClose?: boolean } = {}) {
    pending = { arts, autoClose: opts.autoClose === true }
  }

  function setCount(n: number) {
    const count = Math.max(1, Math.round(n))
    setStashCards(new Array(count).fill(null))
  }

  function enter(state: string) {
    // Cleared for EVERY state, not just this one. It is a request made of the
    // state machine, and a request that outlives the state that made it would
    // fire `beginOutro` on whatever he did next — an outro for `idle`, which
    // has none.
    closeWanted = false
    if (state !== 'card_stash') return
    // Re-entering with nothing new asked for replays the run he was given, which
    // is what an agent saying "show that again" means. A count of zero cannot
    // arise: `setCount` floors at one and `splitBatches` at one batch.
    if (pending) {
      buildRun(pending.arts, pending.autoClose)
      pending = null
    }
    batchIndex = 0
    landed = -1
    applyBatchArt(0)
  }

  function buildRun(arts: (CardArt | null)[], auto: boolean) {
    autoClose = auto
    const groups = splitBatches(arts.length ? arts : [null])
    let startMs = 0
    batches = groups.map((group, gi) => {
      const n = group.length
      ensurePool(n)
      const sched = batchSchedule(n, { first: gi === 0, last: gi === groups.length - 1 })
      const stations: Station[] = stashLayout(n).map((st, i) => ({
        ...st,
        node: pool[i],
        phase: i * STASH_FLOAT.phaseStep,
        ...sched.launch[i],
      }))
      const batch: Batch = {
        stations,
        arts: group,
        scale: sizeForCount(n),
        startMs,
        closeAt: sched.closeAt,
        endMs: sched.endMs,
      }
      startMs += sched.endMs
      return batch
    })
  }

  /**
   * Which batch is on screen, advancing the run as batches finish.
   *
   * THE RUN IS FROZEN DURING THE OUTRO, for the same reason the loose cards'
   * spawn schedule is: the state clock keeps running through the way out, so a
   * run left to advance would start the next batch INSIDE the animation whose
   * whole job is to put the current one away. `card_stash` only ever reaches an
   * outro on its last batch anyway — but "only ever" held for the loose cards
   * too, right up until a sustain made it false.
   */
  function currentBatch(
    tMs: number,
    phase: 'intro' | 'sustain' | 'outro',
    phaseTMs: number,
  ): Batch | null {
    if (!batches.length) return null
    const t = phase === 'outro' ? tMs - phaseTMs : tMs
    // The close is happening. Asking for it again would re-enter the outro every
    // frame and it would never finish.
    if (phase === 'outro') closeWanted = false
    if (phase !== 'outro') {
      while (
        batchIndex < batches.length - 1 &&
        t >= batches[batchIndex].startMs + batches[batchIndex].endMs
      ) {
        batchIndex++
        landed = -1
        applyBatchArt(batchIndex)
      }
    }
    const b = batches[batchIndex]
    // The last batch hangs. If the run was asked to finish by itself, this is
    // where it says so — and it says so rather than acting, because the thing
    // that has to happen next is the LID closing, which belongs to the state
    // machine. See `CardSystem.wantsClose`.
    if (autoClose && phase !== 'outro' && b.closeAt === null) {
      const lastArrive = b.stations.length ? b.stations[b.stations.length - 1].arriveMs : 0
      if (t - b.startMs >= lastArrive + STASH.holdMs) closeWanted = true
    }
    return b
  }

  /** Put this batch's cards on the pool nodes, and warm the batch behind it so
   *  its first card does not pop in on a placeholder. */
  function applyBatchArt(index: number) {
    const b = batches[index]
    if (!b || !art) return
    art.setStash(
      b.stations.map((st) => st.node),
      b.arts,
    )
    const next = batches[index + 1]
    if (next) void art.preload(next.arts)
  }

  buildRun([null, null, null, null, null], false)

  /**
   * Resolve a station against the current facing, into `DeckE_Tilt` local
   * blender coordinates.
   *
   * His forward is -Y, so a bearing of zero is straight ahead and the view axis
   * sits `CAM_BEARING_DEG * facing` off it.
   */
  const resolveStation = (st: Station, facing: number, out: Local): Local =>
    stationLocal(st, facing, out)


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
  // When each orbiting card has finished its authored fade-IN. Past that point
  // the fade schedule is ignored; see the note in `apply`.
  const spawnDone = (keys: Key[]) => keys.find((k) => k.v >= 1)?.t ?? 0
  const loose = [
    {
      node: nodes.cardL,
      ch: 'card_l' as const,
      curve: looseScale.card_l,
      cfg: doc.loose_cards.card_l,
      spawnDoneMs: spawnDone(doc.loose_cards.card_l.orbit_scale),
    },
    {
      node: nodes.cardR,
      ch: 'card_r' as const,
      curve: looseScale.card_r,
      cfg: doc.loose_cards.card_r,
      spawnDoneMs: spawnDone(doc.loose_cards.card_r.orbit_scale),
    },
  ]

  /** The facing of the frame being drawn. `hangPose` needs it and is called from
   *  two places; threading it would mean passing it through every helper. */
  let facingNow = 1

  function apply(pose: Pose, frame: CardFrame) {
    const { facing, state, tMs, clipTMs, phase, phaseTMs, orbit, float } = frame
    facingNow = facing

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
    //
    // AND IT IS SAMPLED ON THE CLIP CLOCK. `card_present`'s gate keys run
    // (-533, 0) (-133, 1) (2266, 1) (2666, 0) with constant extrapolation, so on
    // unwrapped time a SUSTAINED presentation walks off the end of its own gate:
    // 2.3 s into a hold the ramp falls 1 -> 0 with the card fully visible, `k`
    // swings -1 -> +1, and the whole chain sweeps through his body — which is
    // precisely the swoosh the note above says can never happen. It could not,
    // while a state was a one-shot. `clipTMs` holds at the loop point, so the
    // gate holds with the pose it belongs to.
    const g = gate.get(state)
    const present = g ? clamp01(evalCurve(g, clipTMs)) : 0
    const k = 1 - present * (1 - facing)

    const orb = clamp01(pose.orb_on ?? 0)

    // ---- Orbit_Root ------------------------------------------------------
    _a.x = root[0]
    _a.y = root[1]
    _a.z = root[2]
    _a.rx = 0
    _a.ry = 0
    // Scaled by `orb` so the angle unwinds to zero as the state blends out,
    // rather than leaving the hands parked at a stale rotation — but WRAPPED to
    // (-pi, pi] first.
    //
    // `orbitRad` is unbounded unwrapped time, so scaling it down is scaling down
    // however many turns have accumulated: after eleven seconds of loading the
    // 520 ms outro used to spin the hands back four revolutions, after a minute
    // twenty-two. It was invisible while `loading` was a one-shot that never ran
    // past two turns, and it is the single worst artefact the sustain work
    // introduced. Wrapping costs nothing at `orb = 1`, because a rotation is
    // already modulo a full turn, and it makes the unwind at most half a turn.
    _a.rz = orb * wrapAngle(orbitRad(tMs))
    // HIS HOVER, AT HALF. `Orbit_Root` is a sibling of `DeckE_Float`, so
    // everything hanging off it — both hands, the presented card, the two
    // orbiting ones — has never moved with him. See `RIDE`.
    //
    // The `k` factors CANCEL the mirror rather than taking it: `writeLocal`
    // multiplies x, ry and rz by `k`, and his hover is his actual motion, not a
    // mirrored placement. Multiplying here by the same +/-1 undoes it exactly.
    _a.x += float.x * RIDE * k
    _a.y += float.y * RIDE
    _a.z += float.z * RIDE
    _a.rx += float.rx * RIDE * RAD
    _a.ry += float.ry * RIDE * RAD * k
    _a.rz += float.rz * RIDE * RAD * k
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
      // WHILE THE STATE IS THE ORBIT, THE SCHEDULE IS THE ONLY AUTHORITY.
      //
      // The two sources disagree on purpose. The playbook channel says both
      // cards exist from beat 240; the baked fade schedule says the right one
      // does not spawn until 1533, and staggering them 1.3 s apart is the whole
      // entrance. The schedule wins.
      //
      // It used to win by a LERP on `orb_on` — `base + (orbital - base) * orb` —
      // and that let the channel leak in through the crossfade, because `orb`
      // ramps 0 -> 1 over the blend while `base` ramps up alongside it. Measured
      // on entry to `loading`: the right-hand card reached 19% scale at 150 ms,
      // travelled a third of the way round the orbit and shrank back to nothing
      // by 300 ms. That is exactly the report — "right at the beginning we see
      // one of the cards like very small, zoom off and then disappear, and then
      // it comes out properly."
      //
      // Keying off the STATE rather than off the channel also fixes the same
      // leak in the other direction: leaving a sustained `loading` before 1533 ms
      // used to pop the unspawned card into existence at full size, because the
      // outro's own `card_r` beat is 1.
      //
      // THE SCHEDULE IS A SPAWN, NOT A LOOP. Playing it round and round is what
      // produced "these shouldn't be going away and then coming back — they
      // should stay just circling him until told to stop". Its despawns were
      // authored for a clip that ENDED; the fade-in is honoured and everything
      // after it is held. They leave on the outro, riding the hands home, which
      // is what `orb` falling to zero does.
      // AND THE SCHEDULE'S CLOCK STOPS WHEN THE OUTRO STARTS.
      //
      // `tMs` is the state's own UNWRAPPED clock and it keeps running through
      // the way out, so a card that had not spawned when the state was cut short
      // would cross its spawn time DURING the outro and appear — at whatever
      // `orb_on` had faded to by then. Measured: sustain `loading` for one second
      // and release, and the right-hand card (whose real spawn is at 1533 ms)
      // rises to 0.081 and vanishes 170 ms later. That is the same "pops up
      // small, zooms off and disappears" this rule exists to remove, relocated to
      // the exit — and it is the same mistake the stash flight makes if its
      // `born` is not frozen the same way.
      const schedTMs = phase === 'outro' ? tMs - phaseTMs : tMs
      const schedule =
        schedTMs <= c.spawnDoneMs ? evalCurve(c.curve, schedTMs % c.cfg.loop_ms) : 1
      c.node.scale.setScalar(orbit ? schedule * orb : base)
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

    // ---- the stash fan ---------------------------------------------------
    // Cards out of the 115-degree gape, spread around him, held for as long as
    // he is asked to hold them, then gathered and filed back in. There is no
    // pose channel for these — the state name is the gate — and the whole path
    // is computed, because the batch size is dynamic. See `STASH`.
    //
    // Stashed cards take NO facing compensation: they are children of the tilt
    // node and rotate rigidly with him, which is correct and was verified three
    // ways upstream. They also do not take his hover, deliberately — "they're
    // not floating with him, they're kind of just floating all around" — which
    // is why `STASH_FLOAT` exists and `RIDE` is not applied here.
    const stashing = state === 'card_stash'
    let deployed = false
    // Where the outro gathers FROM: the moment it began, in the card's own
    // clock. Evaluating the hang pose there rather than snapping to the station
    // is what keeps the gather continuous — the cards are on independent floats
    // and are never exactly at their stations.
    const tAtOutro = tMs - phaseTMs

    // ---- which batch, and where in it ------------------------------------
    //
    // A RUN IS A SEQUENCE OF BATCHES ON ONE CLOCK. "If the user is adding more
    // cards than that, the animation will play in multiple batches: X cards show
    // up, go in neatly... he does not close until all batches are in, then the
    // next X-card batch pops up for a little, then goes in — until ALL cards
    // called for are in, then he closes."
    //
    // Every batch but the last is a complete cycle with its own local clock, and
    // the LAST batch is exactly the animation that shipped: it hangs, and its
    // close is the state's outro, so the lid shutting and the cards diving in
    // stay one choreographed beat rather than two things that have to be kept in
    // step. `closeAt` carries that distinction and nothing else does.
    const batch = stashing ? currentBatch(tMs, phase, phaseTMs) : null
    const stations = batch?.stations ?? []
    const count = stations.length
    const scale = batch?.scale ?? 1
    // The batch's own clock, frozen at the outro exactly as the state clock is —
    // see the loose cards above for why a schedule that keeps running through
    // the way out spawns things nobody asked for.
    const tb = (phase === 'outro' ? tAtOutro : tMs) - (batch?.startMs ?? 0)
    // Ms since this batch began giving its cards up, or null while it hangs.
    // Two clocks can start that and they compose rather than choose — see
    // `closeProgress`, which is where the worst bug in this work lived.
    const closeT =
      batch === null
        ? null
        : closeProgress(tb, batch.closeAt, phase === 'outro' ? phaseTMs : null)

    for (let i = 0; i < pool.length; i++) {
      const st = stations[i]
      if (!stashing || !st) {
        pool[i].scale.setScalar(0)
        // AND PARK IT INSIDE HIM. A scale-0 node still has a position, and
        // `Box3.setFromObject` still counts it — so a card abandoned three units
        // out at its station keeps inflating the character's bounds long after
        // it is invisible, and the off-screen beacon (which frames those bounds)
        // silently zooms out to hold a card nobody can see.
        parkAtMouth(pool[i])
        continue
      }
      // A card that had not launched when the outro began never appears. Without
      // this, leaving `card_stash` early — a short `durationMs`, or an agent
      // changing its mind — popped every unlaunched card into existence at full
      // size at its station and then filed it in.
      const born = tb
      if (born < st.outMs) {
        pool[i].scale.setScalar(0)
        parkAtMouth(pool[i])
        continue
      }
      let s = scale * evalCurve(popCurve, born - st.outMs)

      if (closeT !== null) {
        // GATHER, THEN DIVE. "When they're ready to go in, they all come up
        // together like this, but hopefully so they're not clipping, and then
        // quickly go down in." The stack is separated along the card's own
        // normal, which is what makes it a deck rather than five coplanar cards
        // fighting for the same pixels.
        //
        // The float is released over `releaseMs` rather than switched off, so
        // the gather starts at the speed the hang left off at. Cutting it dead
        // put a jump of up to 0.18 units — a tenth of a card — on every card at
        // once, which is the same jutter this pass exists to remove, moved to
        // the phase boundary.
        // The hang is evaluated at the moment the close began — the cards are on
        // independent floats and are never exactly at their stations, so
        // gathering from where each one WAS is what keeps it continuous.
        const tAtClose = tb - closeT
        hangPose(st, tAtClose, 1 - clamp01(closeT / STASH_FLOAT.releaseMs), _b)
        const g = clamp01(closeT / STASH.gatherMs)
        const ge = g * g * (3 - 2 * g)
        const cx = STASH.cluster.x
        const cy = STASH.cluster.y - i * STASH.clusterStep
        const cz = STASH.cluster.z
        const diveAt =
          STASH.gatherMs + (count > 1 ? (i / (count - 1)) * STASH.fileSpanMs : 0)
        const d = clamp01((closeT - diveAt) / STASH.diveMs)
        const de = d * d * d // the dive ACCELERATES; they drop in, they do not glide
        _a.x = cx + (_b.x - cx) * (1 - ge) + (STASH.mouth.x - cx) * de
        _a.y = cy + (_b.y - cy) * (1 - ge) + (STASH.mouth.y - cy) * de
        _a.z = cz + (_b.z - cz) * (1 - ge) + (STASH.mouth.z - cz) * de
        // Square up as they gather, so the stack is a stack.
        _a.rx = _b.rx * (1 - ge)
        _a.ry = _b.ry * (1 - ge)
        _a.rz = _b.rz * (1 - ge)
        // Gone by the time the lid meets them: the last third of the dive.
        s *= 1 - clamp01((d - 0.66) / 0.34)
        // THE TOP OF THE STACK IS THE CARD THAT JUST WENT IN. "The topmost
        // facing card in the stack should update to the card that most recently
        // went all the way in." The dive is staggered, so this fires once per
        // card, in the order they file — which is what makes the deck read as
        // filling up rather than as one cut at the end.
        if (d >= 1 && i > landed) {
          landed = i
          const a = batch!.arts[i]
          if (a && art) art.set('deck', a)
        }
      } else {
        hangPose(st, tb, 1, _a)
      }

      if (s <= 0) {
        pool[i].scale.setScalar(0)
        parkAtMouth(pool[i])
        continue
      }
      deployed = true
      // `writeLocal` sets position and rotation; the scale is ours, and it has
      // to be written AFTER, because existence is scale.
      writeLocal(pool[i], _a, 1)
      pool[i].scale.setScalar(s)
    }
    anyDeployed =
      deployed ||
      nodes.cardL.scale.x > 1e-4 ||
      nodes.cardR.scale.x > 1e-4
  }

  function parkAtMouth(node: Object3D) {
    _c.x = STASH.mouth.x
    _c.y = STASH.mouth.y
    _c.z = STASH.mouth.z
    _c.rx = 0
    _c.ry = 0
    _c.rz = 0
    writeLocal(node, _c, 1)
  }

  /**
   * Where a card is at time `t` of its launch-and-hang, float included.
   *
   * Written as a function of t alone so the outro can ask where the card WAS
   * when the outro began, without anything having to be remembered between
   * frames. `floatW` fades the free float; see the outro branch.
   */
  function hangPose(st: Station, t: number, floatW: number, out: Local): Local {
    const home = resolveStation(st, facingNow, _home)
    if (t <= st.crestMs) {
      const u = clamp01((t - st.outMs) / STASH.riseMs)
      const e = u * u * (3 - 2 * u)
      out.x = STASH.mouth.x + (STASH.crest.x - STASH.mouth.x) * e
      out.y = STASH.mouth.y + (STASH.crest.y - STASH.mouth.y) * e
      out.z = STASH.mouth.z + (STASH.crest.z - STASH.mouth.z) * e
      out.rx = 0
      out.ry = 0
      out.rz = 0
      return out
    }
    const u = clamp01((t - st.crestMs) / STASH.travelMs)
    const e = 1 - (1 - u) ** 3 // decelerate onto the station
    out.x = STASH.crest.x + (home.x - STASH.crest.x) * e
    out.y = STASH.crest.y + (home.y - STASH.crest.y) * e
    out.z = STASH.crest.z + (home.z - STASH.crest.z) * e
    // A lift over the middle of the traverse, so the card ARCS out to its place
    // rather than sliding there in a straight line.
    out.z += Math.sin(u * Math.PI) * 0.22
    out.rx = home.rx * e
    out.ry = home.ry * e
    out.rz = home.rz * e
    // The free float fades in as it settles, so it never switches on in view.
    const w = floatW * clamp01((t - st.arriveMs + STASH_FLOAT.rampMs) / STASH_FLOAT.rampMs)
    if (w > 0) addStashFloat(out, t, st.phase, w)
    return out
  }

  /**
   * The free float each stashed card takes while it hangs.
   *
   * One sine per card per axis, phases spaced by the golden angle so no two
   * cards ever synchronise and the set never reads as a rigid constellation.
   * Same reasoning as the idle float's irrational frequency ratios, one
   * dimension down.
   */
  function addStashFloat(t: Local, tMs: number, phase: number, w: number) {
    const th = 2 * Math.PI * STASH_FLOAT.hz * (tMs / 1000) + phase
    t.x += Math.sin(th * 0.83) * STASH_FLOAT.ampX * w
    t.z += Math.sin(th) * STASH_FLOAT.amp * w
    t.rz += Math.sin(th * 0.61) * STASH_FLOAT.ampRot * w
  }

  return {
    apply,
    setCount,
    setStashCards,
    hasPending: (state) => state === 'card_stash' && pending !== null,
    enter,
    wantsClose: () => closeWanted,
    deployed: () => anyDeployed,
  }
}
