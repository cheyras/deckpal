/**
 * The Deck-E controller — the object an LLM (or a dev-page button) drives.
 *
 * Deliberately framework-free: it never imports React. The character is driven
 * IMPERATIVELY by an external agent, which is the one case where a declarative
 * scene graph buys nothing and costs a reconciler between us and objects we
 * poke sixty times a second. React owns the page chrome; this owns the canvas.
 */
import {
  Clock,
  NoColorSpace,
  Object3D,
  TextureLoader,
  Vector3,
  type Mesh,
  type Texture,
} from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { createStage, type Stage } from './stage'
import { CENTRE_OFFSET, makeFraming, solveFraming, type Framing } from './framing'
import {
  BEACON,
  beaconRect,
  scrollableAncestor,
  scrollToCentre,
  type Beacon,
} from './beacon'
import { bindRig, applyLook, applyPose, resolveFacing, type RigNodes } from './rig'
import {
  CARD_BACK_URL,
  createCardArt,
  type CardArt,
  type CardArtSystem,
  type CardSlot,
} from './cardArt'
import { fixupMaterials } from './materials'
import { createRiderSystem, type RiderSystem } from './riders'
import { createEyeSocket, type EyeSocket } from './eyeSocket'
import {
  bindCards,
  createCardSystem,
  loadCards,
  type CardSystem,
} from './cards'
import {
  createEyeMaterial,
  syncEyeUniforms,
  type EyeControls,
  type EyeMaterial,
} from './eyes/eyeMaterial'
import {
  compilePlaybook,
  compileState,
  evalState,
  loadPlaybook,
  type Beat,
  type CompiledState,
  type PlaybookDoc,
  type Pose,
  type StateClip,
} from './playbook'
import { createProcedural } from './procedural'
import {
  CLIP_PATCH,
  IDLE,
  ONE_SHOT,
  SUSTAIN,
  spinRateFor,
  synthesizedStates,
  windowClip,
  type SustainSpec,
} from './sustain'
import { blenderToThree, DEG, MOUTH } from './constants'
import { sampleTrack, solveFlight, type FlightSample, type FlightTrack } from './flight'
import {
  homeCorner,
  parkBeside,
  resolveRect,
  shapeFor,
  type Depth,
  type FlyTarget,
  type Side,
} from './dom'
import {
  clearHighlight,
  highlightElement,
  highlighted,
} from '../../components/ui/elementHighlight'

/** Facing is a YAW, never a reflection: `scale.x` cannot animate through zero
 *  without collapsing him, so a mirror could only ever be an instant flip, and
 *  he has to be able to turn in full view. */
const FACING_YAW_DEG = 80.39
/**
 * How long the turn takes.
 *
 * The authored value is 866.7 ms — 26 frames at 30 fps, measured off
 * `DeckE_Control["facing"]`. It was reviewed on screen as too slow: "when I
 * click these, it could be a bit faster. Like, twice the speed, maybe? Or maybe
 * just a little bit less than twice the speed." 1.75x is that, and it keeps the
 * turn long enough that the near/far asymmetry still washes visibly through
 * zero as he passes face-on, which is the whole reason the turn is a yaw and not
 * a flip.
 */
const FACING_TURN_MS = 866.7 / 1.75

/**
 * The default crossfade between base states.
 *
 * WAS 100 ms, measured from the Banjo-Kazooie decompilation. That number is
 * right for a game that crossfades CLIPS between poses a few degrees apart; it
 * is far too short here, where a state's sustain pose and rest can be most of a
 * body length apart, and a 100 ms move across that distance is a cut. Reviewed
 * as "it's like snapping, the animation is snapping at the end and it shouldn't
 * — that makes it look bad", and separately as the general rule "it should never
 * snap to being done, it should animate to stillness".
 *
 * 320 ms with an eased interpolant is the fix. The ease matters as much as the
 * length: a linear crossfade starts and stops with a velocity step, which reads
 * as a snap at either end no matter how long you make it.
 */
const DEFAULT_BLEND_MS = 320

/** Blend applied when a state changes PHASE — into a synthesized sustain, or out
 *  through an outro. Phase changes are continuous by construction everywhere
 *  except `sleep`, whose sustain deliberately closes the mouth the yawn left
 *  open, so this only ever has visible work to do there. */
const PHASE_BLEND_MS = 420

/** The reserved name an agent-authored clip is registered under. One slot, so a
 *  second custom clip replaces the first rather than growing the state table for
 *  the life of the page. */
export const CUSTOM_STATE = 'custom'

/** How quiet a resize has to go before a parked presentation chases its
 *  element's new position. */
const RE_PARK_SETTLE_MS = 250

/** How long `talk` takes to fade in and out.
 *
 *  It used to be a hard 0 -> 1 -> 0 on the weight, so stopping a sentence
 *  slammed the jaw shut on whatever syllable it was mid-way through: "when it
 *  stops, it just snaps to a stop. It should always animate to a stop." */
const TALK_RAMP_MS = 220

export type FlyOptions = {
  depth?: Depth
  side?: Side
  /** Ring the target on arrival. Defaults to true for a selector target and
   *  false for a bare viewport coordinate, which has nothing to ring. */
  highlight?: boolean
  /** A state to enter once he lands — `point`, `card_show`, `happy`. */
  then?: string
}

export type DeckEOptions = {
  canvas: HTMLCanvasElement
  baseUrl: string
  clearColor?: readonly [number, number, number] | null
  onReady?: () => void
  onError?: (e: unknown) => void
  /**
   * Called when he leaves the viewport, and again with null when he comes back.
   *
   * The controller owns the GEOMETRY of this — it is the only thing that knows
   * where he actually is — and the chip itself is a React component, because it
   * is page chrome with a click target. See `beacon.ts`.
   */
  onBeacon?: (beacon: Beacon | null) => void
  /** How tall he should be on screen, in CSS pixels. Dollies the camera along
   *  its own axis, so the 3/4 view the facing system depends on is unchanged. */
  characterHeightPx?: number | null
  /**
   * Where he is when the page finishes loading.
   *
   * `home` is the product answer and the default — "I'd like it so that when he
   * first loads, he is at home, not like dead center in the screen." `staging`
   * leaves him at the world origin, which is the one place the framing solve is
   * the identity and every parity still was taken from, so the comparison
   * harness must ask for it.
   */
  startAt?: 'home' | 'staging'
}

/**
 * Where he is parked, as a thing that can be RE-SOLVED rather than a coordinate.
 *
 * A coordinate is wrong for the same reason `homeCorner` is derived from the
 * viewport rather than stored: the page moves. It scrolls, it resizes, its
 * layout settles. An element station is a promise to stay beside a DOM rect, and
 * keeping the promise means recomputing it whenever that rect can have moved.
 */
type Station =
  | { kind: 'home' }
  | { kind: 'element'; target: FlyTarget; depth: Depth; side: Side }

type Transition = { from: Pose; started: number; durationMs: number } | null

/** Where a state is in its own life. See `sustain.ts`. */
export type Phase = 'intro' | 'sustain' | 'outro'

export type SetStateOptions = {
  blendMs?: number
  /**
   * `sustain` (the default) enters the state and STAYS there until something
   * else is asked for. `once` plays the clip through and hands over to `then`.
   *
   * The reviewer asked for both, in one sentence: "I'd like the agent to be able
   * to tell him to do a state in a way that makes it ongoing and continuous, or
   * it should be able to tell it to do a state for a set amount of time, after
   * which it would just go back to idle." `nod_yes` is the case that needs both
   * — "the LLM that's driving this gets to decide... is it a loop, or is it just
   * play one and then return to idle?"
   */
  mode?: 'sustain' | 'once'
  /** Sustain for this long, then leave. Implies `mode: 'sustain'`. */
  durationMs?: number
  /** Where to go when this state ends. Defaults to `idle`. */
  then?: string
}

/**
 * One live instance per canvas, enforced.
 *
 * A browser hands back the SAME WebGL context for repeated `getContext` calls on
 * one canvas, so two `WebGLRenderer`s built on the same element silently share
 * GL state — and one disposing frees resources the other is still using. React
 * 19's StrictMode double-invokes effects in dev, which hits this every single
 * mount: the symptom was two characters drawn at once, the second washed out
 * because it had lost the environment.
 *
 * Forcing context loss on teardown "fixes" it by making the canvas unusable for
 * the remount, which is worse. Adopting the previous instance and disposing it
 * before building a new one is the honest fix.
 */
const INSTANCES = new WeakMap<HTMLCanvasElement, DeckE>()

/** Scratch for the beacon's silhouette probe. Module scope, not per instance:
 *  it never outlives one call. */
const _top = new Vector3()

export class DeckE {
  readonly stage: Stage
  private rig!: RigNodes
  /** The loaded glTF root. The beacon frames its BOUNDS, not just his body — a
   *  fan of cards is wider than he is. */
  private model: Object3D | null = null
  /**
   * How big his bounds are AT REST, so the beacon can measure how much bigger
   * than usual he currently is.
   *
   * It has to be measured rather than assumed: at rest the model's bounds come
   * out 4.86 units across against a body that is 2.4 tall, because the exported
   * meshes carry their morph-target extents and several are authored
   * pre-transform. See `Stage.renderInset`.
   */
  private restExtent = 0
  private riderSystem!: RiderSystem
  /** Null if the parent vertices could not be resolved in the exported mesh. */
  private eyeSocket: EyeSocket | null = null
  private cards!: CardSystem
  /** The artwork on the cards he handles. Public because the app layer decides
   *  WHICH cards; see `cardSource.ts`. */
  art!: CardArtSystem
  private doc!: PlaybookDoc
  /** One entry per eye: the patched material and the empties it reads. */
  private eyes: { mat: EyeMaterial; ctrls: EyeControls }[] = []
  private states!: Map<string, CompiledState>
  /**
   * The compiled SUSTAIN clip per state — the loop window as a cyclic clip of
   * its own. Built once at load rather than on every entry, because a state can
   * be entered many times a second by an agent and compiling ten curves each
   * time to get the same answer is work nobody asked for.
   *
   * Absent for a hold (`toMs === fromMs`) and for the one-shots; see
   * `windowClip`.
   */
  private sustainClips!: Map<string, CompiledState>
  private proc!: ReturnType<typeof createProcedural>

  private readonly clock = new Clock()
  private elapsed = 0
  private raf = 0
  private disposed = false

  /**
   * Base-layer state, and the little machine that keeps him IN it.
   *
   * `intro` plays the clip from 0; `sustain` loops the state's window forever;
   * `outro` plays the authored (or synthesized) way out. Without a `durationMs`
   * or an explicit change, a state never leaves `sustain` — which is the whole
   * point. See `sustain.ts`.
   */
  private current = 'boot'
  private phase: Phase = 'intro'
  private stateStart = 0
  /** When the current phase started, in elapsed seconds. Only `outro` needs its
   *  own origin; intro and sustain both measure from `stateStart`. */
  private phaseStart = 0
  private spec: SustainSpec | null = null
  /** The compiled synthesized sustain, when the state has one (`sleep`). */
  private sustainClip: CompiledState | null = null
  private outroClip: CompiledState | null = null
  /** Elapsed seconds at which to leave, when the caller asked for a duration. */
  private leaveAt: number | null = null
  /** Where to go when this state ends. Defaults to `idle`. */
  private nextState: string = IDLE
  /** A state change that is waiting for the current state's outro to finish. */
  private queued: { name: string; opts: SetStateOptions } | null = null
  /** The sustain for the agent-authored clip, if it asked to loop. */
  private customSustain: SustainSpec | null = null
  private transition: Transition = null

  /** `talk` is an OVERLAY, never a base state — he has to be able to talk while
   *  happy, while presenting, while thinking. A hub-and-spoke talk state would
   *  force him back to neutral to speak. */
  private talkWeight = 0
  private talkTarget = 0
  private talkClock = 0

  private facing = 1
  private facingTarget = 1
  private facingFrom = 1
  private facingT = 1

  private readonly pose: Pose = {}
  /**
   * The pose as of the BASE layer only — the state clip plus any crossfade, and
   * nothing after it. This is what a crossfade blends from.
   *
   * It has to be a separate copy. `pose` accumulates the talk overlay, the
   * procedural layers, the resolved facing and the parked anchor on top, and
   * snapshotting THAT as the crossfade's `from` double-composes every one of
   * them: the blend lerps toward a base pose from a fully-composited one, and
   * then the pipeline adds the anchor, the gaze and the facing flip a second
   * time. Measured: parked beside an element, `setState` threw the root about
   * 1.4 world units — over half his body height — and snapped back over the
   * blend. That is precisely the flyTo-then-emote sequence the LLM driver does.
   */
  private readonly basePose: Pose = {}
  private readonly scratch: Pose = {}
  private readonly overlayPose: Pose = {}
  private readonly floatOut = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 }
  private readonly gazeOut = { gx: 0, gz: 0 }
  /** The procedural gaze, resolved for facing, in target-space blender units. */
  private readonly micro = { x: 0, z: 0 }

  /** Channel overrides an external driver has pinned. Applied last, so an LLM
   *  can hold `bend` at 0.37 while a state plays underneath. */
  private readonly overrides = new Map<string, number>()

  // ---- flight ----------------------------------------------------------
  private track: FlightTrack | null = null
  private trackStart = 0
  private legIndex = 0
  /** Where he is parked when not flying, in the Blender frame. */
  private readonly anchor = new Vector3(0, 0, 0)
  private readonly flightSample: FlightSample = {
    tMs: 0,
    pos: new Vector3(),
    rx: 0, ry: 0, rz: 0, sq: 0, bend: 0, lean: 0, twist: 0, mouth: 0,
  }
  /** Where he is parked, as something re-solvable. See `Station`. */
  private station: Station = { kind: 'home' }
  /** Set by the scroll listener; consumed once per frame. Reading a DOMRect is a
   *  forced layout, so it happens at most once a frame and only when something
   *  has actually moved. */
  private stationDirty = false
  /** Where the current flight was solved to land, and how far the page has moved
   *  under it since. See `syncStation`. */
  private readonly trackDest = new Vector3()
  private readonly trackShift = new Vector3()
  private readonly onScroll = () => {
    this.stationDirty = true
  }
  /** How he is turned toward the viewer where he stands. See `framing.ts`. */
  private readonly framing: Framing = makeFraming()
  private readonly rootThree = new Vector3()
  /** His centre in world space, and the same point projected to the viewport.
   *  Both are wanted every frame by the beacon; neither is worth allocating. */
  private readonly centreThree = new Vector3()
  private readonly screen = new Vector3()
  /** The beacon as last reported, so the callback fires on CHANGE rather than
   *  sixty times a second — it drives React state. */
  private beacon: Beacon | null = null
  /** The pending trailing-edge re-park. See `resize`. */
  private rePark: ReturnType<typeof setTimeout> | null = null
  /** Set when a flight is in the air; applied the frame it lands. See `update`. */
  private onArrive: (() => void) | null = null

  constructor(private readonly opts: DeckEOptions) {
    INSTANCES.get(opts.canvas)?.dispose()
    this.stage = createStage({
      canvas: opts.canvas,
      clearColor: opts.clearColor,
      // `??` would be wrong here: an EXPLICIT null means "use Blender's exact
      // staging distance" (parity mode) and must not fall through to the
      // default. Only an absent option gets the default.
      characterHeightPx:
        opts.characterHeightPx === undefined ? 300 : opts.characterHeightPx,
    })
    INSTANCES.set(opts.canvas, this)
  }

  async load(): Promise<void> {
    const { baseUrl } = this.opts
    // The shipped glb is meshopt-compressed and quantized (7.48 MB -> 1.39 MB).
    // meshopt, never Draco: `KHR_draco_mesh_compression` structurally cannot
    // carry morph targets, and every body deformation on this character is one.
    // See `scripts/decke/shrink.mjs` for how the asset is produced.
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
    const [gltf, doc, cards, atlas] = await Promise.all([
      loader.loadAsync(`${baseUrl}models/decke/decke.glb`),
      loadPlaybook(baseUrl),
      loadCards(baseUrl),
      // The SDF atlas is Non-Color data, not an image: decoding it as sRGB
      // shifts the 0.5 edge and every glyph comes out fat and soft.
      new TextureLoader().loadAsync(`${baseUrl}models/decke/symbol_sdf_atlas.png`),
    ])
    if (this.disposed) return

    this.doc = doc
    this.states = compilePlaybook(doc)
    // The synthesized states (`idle`, and the sustain/outro clips) compile
    // through the same path as the authored ones, so nothing downstream — the
    // evaluator, the crossfade, the command validator — can tell them apart.
    for (const [name, clip] of Object.entries(synthesizedStates())) {
      this.states.set(name, compileState(name, clip, doc.rest_pose))
    }
    for (const [name, patch] of Object.entries(CLIP_PATCH)) {
      const base = this.states.get(name)
      if (base) this.states.set(name, compileState(name, patch(base.clip), doc.rest_pose))
    }
    // AFTER the patches, not before: `confused`'s window is expressed against
    // the spiral prologue `withSpiralEyes` inserts, so building its loop from
    // the unpatched clip would be 310 ms out of step with what plays.
    this.sustainClips = new Map()
    for (const [name, spec] of Object.entries(SUSTAIN)) {
      const src = this.states.get(name)
      if (!src) continue
      const clip = spec.clip ?? windowClip(src, spec)
      if (clip) this.sustainClips.set(name, compileState(`${name}:sustain`, clip, doc.rest_pose))
    }
    this.proc = createProcedural(doc)

    const model: Object3D = gltf.scene
    this.model = model
    this.stage.scene.add(model)
    // Repair what glTF's fixed material model flattened, before anything binds.
    fixupMaterials(model)
    this.rig = bindRig(model)
    this.riderSystem = createRiderSystem(model)
    this.eyeSocket = createEyeSocket(model)
    // Before the card system, which drives it: the art has to exist before
    // anything can be put in a slot, and the pool's clones have to be adopted at
    // the moment they are made.
    this.art = createCardArt(model, {
      maxAnisotropy: this.stage.renderer.capabilities.getMaxAnisotropy(),
    })
    this.cards = createCardSystem(cards, bindCards(model, cards), this.art)
    // The real back, from the first frame. Not deferred behind a setting: the
    // baked one is AI-generated placeholder art, and a card whose back is not the
    // back of a card is wrong in the same way its front would be.
    this.art.setBack(`${baseUrl}${CARD_BACK_URL}`)
    atlas.colorSpace = NoColorSpace
    this.bindEyes(model, atlas)

    for (const k in doc.rest_pose) this.pose[k] = doc.rest_pose[k]

    // `boot` is a lifecycle event, not a state: it plays once and hands over to
    // `idle`, which is where he lives. Previously it was entered and never left,
    // and because its modulation is `float_amp: 0, blink_rate: 0` that left a
    // freshly-loaded page showing a character who never moved at all.
    // The beacon's reference size, measured through the REAL pipeline at the
    // rest pose — the same path a frame takes, so the number means the same
    // thing as the one measured live. Everything below overwrites this pose on
    // the first frame, so it costs one throwaway apply at load.
    applyPose(this.rig, this.pose, { facing: 1 })
    this.riderSystem.apply(0, 0, 0, 0)
    this.eyeSocket?.apply()
    this.cards.apply(this.pose, {
      facing: 1,
      state: IDLE,
      phase: 'intro',
      tMs: 0,
      clipTMs: 0,
      phaseTMs: 0,
      orbit: false,
      float: this.floatOut,
    })
    this.stage.scene.updateMatrixWorld(true)
    this.restExtent = this.stage.measureExtent(model)

    // WHERE HE STARTS. "I'd like it so that when he first loads, he is at home,
    // not like dead center in the screen." The origin is where he is STAGED for
    // review — it is what the Blender camera frames — and it is the worst place
    // to leave an assistant on a page, because it is on top of the content. He
    // is placed there, not flown: `boot` is his arrival and a flight on top of it
    // would be two entrances at once.
    if (this.opts.startAt !== 'staging') {
      this.anchor.copy(homeCorner(this.stage.camera, this.stage.camera.position.length()))
      this.trackDest.copy(this.anchor)
    }
    // A parked presentation is anchored to a DOM RECT, and the page can move
    // that rect out from under him at any moment. Capture phase so a nested
    // scroll container counts too — the element he is presenting is very often
    // inside one.
    window.addEventListener('scroll', this.onScroll, { passive: true, capture: true })

    this.setState('boot', { blendMs: 0, mode: 'once', then: IDLE })
    this.opts.onReady?.()
  }

  /**
   * Swap the exported glTF eye materials for the analytic one.
   *
   * The export carries two flat white ovals: every feature — pupil, shine, eye
   * line, lids, alert glyph — is procedural and lives only in the node graph,
   * so without this the face is blank.
   */
  private bindEyes(model: Object3D, atlas: Texture) {
    const r = this.rig
    const sides = [
      {
        side: 'L' as const,
        mesh: 'Eyeball_L_anim',
        ctrls: {
          pupil: r.ctrlPupilL, shine: r.ctrlShineL, line: r.ctrlLineL,
          lidU: r.ctrlLidUL, lidL: r.ctrlLidLL,
          symbol: r.ctrlSymbolL, symLine: r.ctrlSymLineL,
        },
      },
      {
        side: 'R' as const,
        mesh: 'Eyeball_R_anim',
        ctrls: {
          pupil: r.ctrlPupilR, shine: r.ctrlShineR, line: r.ctrlLineR,
          lidU: r.ctrlLidUR, lidL: r.ctrlLidLR,
          symbol: r.ctrlSymbolR, symLine: r.ctrlSymLineR,
        },
      },
    ]
    for (const s of sides) {
      const mesh = model.getObjectByName(s.mesh) as Mesh | undefined
      if (!mesh) throw new Error(`decke eyes: mesh "${s.mesh}" missing from the glb`)
      const mat = createEyeMaterial({
        side: s.side,
        atlas,
        spinPhaseDeg: this.doc.symbol_atlas.spin_phase_deg[s.side],
      })
      mesh.material = mat
      this.eyes.push({ mat, ctrls: { eye: mesh, ...s.ctrls } })
    }
  }

  setEnvironment(hdr: Texture) {
    this.stage.setEnvironment(hdr)
  }

  // ---------------------------------------------------------------- control

  /** Every authored state, in playbook order. */
  /** The 47 legal pose channels, in the order the playbook declares them. The
   *  command validator needs this to reject a misspelled channel rather than
   *  silently accept it. */
  get channelNames(): string[] {
    return Object.keys(this.doc.rest_pose)
  }

  get stateNames(): string[] {
    // The synthesized states are real states and the command validator has to
    // accept them, so this reads the compiled table rather than the document's
    // authored order. `custom` is deliberately absent until one exists.
    //
    // `talk` is EXCLUDED, and that is not tidiness. It is an overlay — the one
    // thing he must be able to do while happy, while presenting, while thinking
    // — and a model handed it in the state enum will reach for it as a state,
    // which forces him to neutral to speak and makes it impossible to combine.
    // `op: "talk"` is how it is driven; leaving it in the enum invites exactly
    // the mistake the overlay exists to prevent.
    return this.states ? [...this.states.keys()].filter((n) => n !== 'talk') : []
  }

  getState() {
    return {
      state: this.current,
      phase: this.phase,
      facing: this.facing,
      talking: this.talkTarget > 0,
      overrides: Object.fromEntries(this.overrides),
      elapsedMs: (this.elapsed - this.stateStart) * 1000,
      flying: !!this.track,
      /** Whether anything is ringed, and its id if it has one. `highlighted`
       *  used to be `el.id || null`, which reports an id-less element as NOT
       *  highlighted — a lie to the one caller that cannot look at the screen. */
      highlighting: !!highlighted(),
      highlighted: highlighted()?.id || null,
    }
  }

  /**
   * Play a base state.
   *
   * Because we crossfade RESOLVED POSES rather than clips, "blend from wherever
   * he actually is" is the natural implementation — which is what makes
   * interrupting an emote half-way through look right instead of snapping to
   * rest first.
   */
  setState(name: string, opts: SetStateOptions = {}) {
    if (!this.states.has(name)) throw new Error(`decke: unknown state "${name}"`)
    // Validate NOW, for the reason `flyTo` gives: `then` is consumed later,
    // inside the animation frame, where a throw is an unhandled error in a rAF
    // callback with no stack pointing at the mistake — and because `tick`
    // re-schedules itself BEFORE calling `update`, it then throws on every frame
    // for the life of the page rather than once.
    if (opts.then !== undefined && !this.states.has(opts.then)) {
      throw new Error(`decke: setState "then" names an unknown state "${opts.then}"`)
    }

    // LET THE OUTGOING STATE FINISH ITS SENTENCE. Two states end with something
    // the viewer is owed rather than a return to rest — `card_stash`'s five
    // cards are in the air, `loading`'s orbit is deployed — and cutting away
    // from either makes objects vanish. So the change is queued behind the
    // outro, exactly as asked: "once told to stop, that's when they all file in
    // and it animates into him and then he closes."
    //
    // The queue is depth ONE and the newest request wins, so a rapid-fire
    // sequence lands on the last thing asked for rather than replaying a
    // backlog.
    // Already playing one: REPLACE the queue, do not cut the outro short. The
    // guard used to be `phase !== 'outro'`, which meant a second request during
    // the outro fell straight through to `enter` and abandoned the cards
    // mid-flight — the exact defect the queue exists to prevent, reachable by
    // clicking twice. Newest request wins, but it wins the QUEUE.
    // RE-ISSUING THE STATE HE IS ALREADY IN IS A NO-OP, NOT A RESTART.
    //
    // An agent that says "still thinking" on three consecutive turns should not
    // make him re-enter `thinking` three times, and for the two states that
    // deploy objects a restart is destructive: re-entering `card_stash` mid-hang
    // reset the clock, which despawned every card in the air and re-dealt them
    // from the mouth. Only a request that changes the state's LIFETIME — how
    // long it lasts, or where it goes next — is a real change.
    //
    // A PENDING STASH RUN IS A REAL CHANGE, for the same reason `durationMs` is.
    // "Now put these other cards away" arrives as `setStashCards` followed by
    // `setState('card_stash')`, and while he is already in `card_stash` that
    // second call used to be swallowed here — so the run sat pending, waiting
    // for an entry that might never come, and he went on holding up the previous
    // batch as though nothing had been asked. Silently showing the wrong cards
    // is the one failure this whole feature cannot have.
    if (
      name === this.current &&
      this.phase !== 'outro' &&
      opts.durationMs === undefined &&
      opts.mode !== 'once' &&
      !this.cards.hasPending(name) &&
      (opts.then === undefined || opts.then === this.nextState)
    ) {
      return
    }

    if (this.phase === 'outro') {
      this.queued = { name, opts }
      return
    }
    // `name !== this.current` normally, so that a lifetime-only change does not
    // make him put everything away and start again — EXCEPT when the change is a
    // new set of cards, where putting the old ones away first is exactly right.
    // He is holding twelve cards up; "show these twenty instead" should file
    // those twelve in and then deal the new lot, not swap them mid-air.
    if (this.hasOutro(true) && (name !== this.current || this.cards.hasPending(name))) {
      this.queued = { name, opts }
      this.beginOutro()
      return
    }
    this.queued = null
    this.enter(name, opts)
  }

  /** Enter a state immediately, skipping any outro. */
  private enter(name: string, opts: SetStateOptions) {
    // Stepped-register clips turn to mush when crossfaded, so they snap.
    const snap =
      this.doc.transition.snap_states.includes(name) ||
      this.doc.transition.snap_states.includes(this.current)
    // Alert is a MODE, not an emotion. It pre-empts anything, hard — it opens
    // with a crouch that reads as anticipation from any pose.
    const isAlert = name.startsWith('alert_')

    this.blendFrom(opts.blendMs ?? (snap || isAlert ? 0 : DEFAULT_BLEND_MS))

    // Before the first frame of the new state, so a pending stash count lands
    // here and never mid-flight. See `CardSystem.setCount`.
    this.cards.enter(name)

    this.current = name
    this.stateStart = this.elapsed
    this.phaseStart = this.elapsed
    this.phase = 'intro'
    this.nextState = opts.then ?? IDLE

    const once = opts.mode === 'once' || ONE_SHOT.has(name)
    const sustain = name === CUSTOM_STATE ? this.customSustain : (SUSTAIN[name] ?? null)
    this.spec = once ? null : sustain
    // `custom` is the one state whose clip did not exist at load, so its window
    // is compiled here. Everything else is a table lookup.
    this.sustainClip = !this.spec
      ? null
      : name === CUSTOM_STATE
        ? (() => {
            const clip = windowClip(this.states.get(name)!, this.spec)
            return clip ? compileState(`${name}:sustain`, clip, this.doc.rest_pose) : null
          })()
        : (this.sustainClips.get(name) ?? null)
    // A SYNTHESIZED outro survives `mode: 'once'`; an authored TAIL does not,
    // and the asymmetry is not an oversight. The tail is part of the clip, so
    // playing the clip through has already played it — `card_stash` run once
    // files its own cards back in at 1900 ms. `loading` has no tail at all (it
    // loops from its first beat to its last with the orbit fully deployed), so
    // without its synthesized landing a one-shot `loading` would end with two
    // cards mid-orbit and simply delete them.
    this.outroClip = sustain?.outroClip
      ? compileState(`${name}:outro`, sustain.outroClip, this.doc.rest_pose)
      : null

    this.leaveAt =
      opts.durationMs !== undefined ? this.elapsed + opts.durationMs / 1000 : null

    // A state with neither a sustain nor a duration is a one-shot: it ends when
    // its clip does. Recorded here so `update` has one rule rather than three.
    if (!this.spec && this.leaveAt === null) {
      this.leaveAt = this.elapsed + this.states.get(name)!.clip.duration_ms / 1000
    }
  }

  /**
   * @param interrupted True when the caller is cutting the state short rather
   *   than letting it run out. An outro exists to put away what the SUSTAIN put
   *   on screen, so if the sustain was never reached there is nothing to put
   *   away — and playing it anyway is actively wrong: `LOADING_LAND`'s first
   *   beat assumes a fully deployed orbit, so running it from the intro pops two
   *   cards INTO existence inside the animation whose job is to remove them.
   */
  private hasOutro(interrupted = false): boolean {
    if (!this.outroClip && !this.spec?.outroTail) return false
    if (!interrupted) return true
    // PHASE IS NOT THE TEST. It was, on the theory that a sustain never reached
    // has deployed nothing to put away — and that is false for both states that
    // have an outro. `card_stash`'s first card leaves the mouth inside its
    // 400 ms intro and `loading`'s left card is fully spawned 200 ms into a
    // 900 ms one, so cutting away during an intro deleted a card the reader was
    // looking at. Asking the card system what is actually on screen is the
    // honest test, and it is exact rather than a timing guess.
    return this.phase === 'sustain' || this.cards.deployed()
  }

  private beginOutro() {
    this.phase = 'outro'
    this.phaseStart = this.elapsed
    this.leaveAt = null
    this.blendFrom(PHASE_BLEND_MS)
  }

  /** Start a crossfade from wherever the BASE layer currently is. */
  private blendFrom(ms: number) {
    if (ms <= 0) {
      this.transition = null
      return
    }
    // Snapshot the BASE pose, not the composited one — see `basePose`.
    const from: Pose = {}
    for (const k in this.basePose) from[k] = this.basePose[k]
    this.transition = { from, started: this.elapsed, durationMs: ms }
  }

  /**
   * Stop sustaining and go home — the explicit "he's done now" the whole
   * sustain design implies. Plays the outro if the state has one.
   */
  release(to: string = IDLE) {
    if (this.current === to && this.phase !== 'outro') return
    this.setState(to)
  }

  /**
   * `talk` is a ramped weight, not a switch.
   *
   * Setting it to 0 outright cut the jaw off mid-syllable, which is the
   * "when it stops, it just snaps to a stop — it should always animate to a
   * stop" note. The ramp costs 220 ms of tail and removes the whole class.
   */
  setOverlay(name: 'talk' | null, weight = 1) {
    this.talkTarget = name === 'talk' ? Math.max(0, Math.min(1, weight)) : 0
  }

  /** `facing` is continuous over [-1, +1]. Animated over `FACING_TURN_MS`. */
  setFacing(value: number, opts: { animate?: boolean } = {}) {
    const v = Math.max(-1, Math.min(1, value))
    if (opts.animate === false) {
      this.facing = v
      this.facingFrom = v
      this.facingTarget = v
      this.facingT = 1
    } else {
      this.facingFrom = this.facing
      this.facingTarget = v
      this.facingT = 0
    }
  }

  /**
   * Fly to a spot beside a DOM element (or a viewport coordinate).
   *
   * He parks BESIDE the target, never on it, and turns to face inward — the
   * whole point is that he presents the thing rather than obscuring it.
   */
  flyTo(target: FlyTarget, opts: FlyOptions = {}) {
    const depth = opts.depth ?? 'foreground'
    const side = opts.side ?? 'auto'
    const rect = resolveRect(target)
    if (!rect) throw new Error('decke: flyTo target did not resolve to an element')

    const camera = this.stage.camera
    const baseDistance = camera.position.length()
    const park = parkBeside(camera, rect, { depth, side, baseDistance })

    this.launch(park.position)
    // Hold facing steady for the duration of a presentation; turning mid-flight
    // fights the flight layer's own yaw. `park.facing` is always +/-1, so he
    // lands on one of his two authored directions rather than somewhere in
    // between — "he should still have his standard directions, so either this or
    // this."
    this.setFacing(park.facing)
    this.station = { kind: 'element', target, depth, side }

    // Presenting is a TWO-part signal: he stands beside the thing, and the thing
    // is ringed. Doing only the first is a robot standing near a box. Ringing on
    // ARRIVAL rather than on departure means the highlight appears as he settles
    // rather than racing him across the page.
    const selector = 'selector' in target ? target.selector : null
    const ring = opts.highlight ?? !!selector
    const then = opts.then
    // Validate NOW, not on arrival. `onArrive` runs inside the animation frame,
    // where a throw is an unhandled error in a rAF callback with no call stack
    // pointing at the mistake — and it would land two seconds after the code
    // that made it.
    if (then !== undefined && !this.states.has(then)) {
      throw new Error(`decke: flyTo "then" names an unknown state "${then}"`)
    }
    this.onArrive = () => {
      if (ring && selector) highlightElement(selector)
      if (then) this.setState(then)
    }
  }

  /**
   * How many cards the next `card_stash` shows.
   *
   * "This needs to really be dynamic, because it's gonna depend — the way that I
   * see this being used is like they add a whole bunch of cards to their
   * collection, and this is his way of showing the actual cards they added going
   * down into the deck box." So the count is an input, not a property of the
   * five meshes that happen to be in the glb.
   */
  setStashCount(n: number) {
    this.cards.setCount(n)
  }

  /**
   * The actual cards the next `card_stash` puts away.
   *
   * Any length: past what fits on screen at once the flight runs in batches, and
   * `autoClose` decides whether the last batch hangs (the reviewed behaviour, and
   * the default) or files itself in and closes him too — which is what "until ALL
   * cards called for are in, then he closes" describes for a run that is a
   * complete gesture rather than an ongoing display.
   *
   * Takes effect on the next ENTRY. Setting it while cards are in the air would
   * re-deal the ones on screen; see `CardSystem.setStashCards`.
   */
  setStashCards(arts: (CardArt | null)[], opts: { autoClose?: boolean } = {}) {
    this.cards.setStashCards(arts, opts)
  }

  /** Put art in one of the four single-card slots, or `null` for the
   *  placeholder baked into the model. */
  setCardArt(slot: CardSlot, art: CardArt | null) {
    this.art.set(slot, art)
  }

  /** Ring an element without moving. */
  highlight(target: Element | string, opts: { durationMs?: number } = {}) {
    highlightElement(target, opts)
  }

  clearHighlight() {
    clearHighlight()
  }

  returnHome() {
    this.station = { kind: 'home' }
    this.onArrive = null
    clearHighlight()
    this.launch(homeCorner(this.stage.camera, this.stage.camera.position.length()))
  }

  /**
   * Re-solve the current station, in the Blender frame.
   *
   * Returns null when an element station no longer resolves — the element was
   * removed, or is not laid out yet. Staying where he is beats teleporting to
   * the origin, which is what a null-means-zero reading would do.
   */
  private solveStation(): { position: Vector3; facing?: number } | null {
    const camera = this.stage.camera
    const baseDistance = camera.position.length()
    if (this.station.kind === 'home') {
      // Home is VIEWPORT-relative, so scrolling does not move it and must not:
      // at home he is page chrome rather than an annotation on the content.
      return { position: homeCorner(camera, baseDistance) }
    }
    const rect = resolveRect(this.station.target)
    if (!rect) return null
    const park = parkBeside(camera, rect, {
      depth: this.station.depth,
      side: this.station.side,
      baseDistance,
    })
    return { position: park.position, facing: park.facing }
  }

  /**
   * Follow the page.
   *
   * "When he's presenting on the DOM, when we scroll, he should really scroll
   * with it, because he's showing that thing." So this SNAPS rather than easing:
   * the element is not moving in the document, the viewport is moving over it,
   * and anything less than exact tracking reads as him sliding off the thing he
   * is pointing at. His vertical angle follows for free, because `solveFraming`
   * is re-solved from wherever he ends up — which is the other half of the same
   * note.
   *
   * A flight in the air gets the same treatment, scaled by how far along it is,
   * so the destination tracks the element while the launch point stays where he
   * actually took off from.
   */
  private syncStation() {
    if (!this.stationDirty) return
    this.stationDirty = false
    const park = this.solveStation()
    if (!park) return
    if (this.track) this.trackShift.copy(park.position).sub(this.trackDest)
    this.anchor.copy(park.position)
    // Only when it actually changed: `setFacing` restarts the turn, and calling
    // it every scroll frame would leave him permanently mid-turn.
    if (park.facing !== undefined && park.facing !== this.facingTarget) {
      this.setFacing(park.facing)
    }
  }

  private launch(to: Vector3) {
    const from = this.track
      ? this.flightSample.pos.clone()
      : this.anchor.clone()
    const shape = shapeFor(from, to, this.legIndex++)
    const vFov = (this.stage.camera.fov * Math.PI) / 180
    this.track = solveFlight(from, to, {
      camera: this.stage.camera,
      tanHalfFovY: Math.tan(vFov / 2),
      ...shape,
    })
    this.trackStart = this.elapsed
    this.anchor.copy(to)
    this.trackDest.copy(to)
    this.trackShift.set(0, 0, 0)
  }

  /**
   * Play an ad-hoc clip the caller wrote, as a first-class state.
   *
   * The reviewer's note on this was the one unambiguously positive one in the
   * pass: "I like the idea of agents being able to just define some kind of
   * custom little thing that he can do... it has a set of pre-built animations
   * it can use, but it can also get creative if it wants."
   *
   * So it is not a special case bolted on beside the playbook — the beats are
   * compiled by the SAME `compileState` the authored clips go through and
   * registered under a reserved name, which means the crossfade, the sustain
   * machine, the talk overlay, the procedural layers and the flight all compose
   * with it exactly as they do with `happy`. A custom clip is a state; it simply
   * did not exist a moment ago.
   *
   * `loop: true` makes it its own sustain and it runs until something else is
   * asked for. Otherwise it plays once and hands over to `then`.
   */
  playKeyframes(
    beats: Beat[],
    opts: { loop?: boolean; then?: string; blendMs?: number } = {},
  ) {
    const clip: StateClip = {
      kind: 'clip',
      symbol: null,
      duration_ms: beats[beats.length - 1]?.t_ms ?? 0,
      mod: 'idle',
      modulation: { float_amp: 1, float_rate: 1, blink_rate: 1 },
      beats,
      ...(opts.loop ? { loop: true as const } : {}),
    }
    this.states.set(CUSTOM_STATE, compileState(CUSTOM_STATE, clip, this.doc.rest_pose))
    // Held on the INSTANCE, not written into the shared `SUSTAIN` table: that
    // table is module state, and one canvas authoring a clip must not change
    // what another canvas is playing.
    this.customSustain = opts.loop ? { fromMs: 0, toMs: clip.duration_ms } : null
    this.setState(CUSTOM_STATE, { blendMs: opts.blendMs, then: opts.then })
  }

  /** Pin a raw channel. Pass `null` to release it. */
  setChannel(channel: string, value: number | null) {
    if (value === null) this.overrides.delete(channel)
    else this.overrides.set(channel, value)
  }

  clearOverrides() {
    this.overrides.clear()
  }

  // ------------------------------------------------------------------ loop

  start() {
    this.clock.start()
    const tick = () => {
      if (this.disposed) return
      this.raf = requestAnimationFrame(tick)
      // Clamp dt so a backgrounded tab cannot hand the integrators a huge step.
      const dt = Math.min(this.clock.getDelta(), 0.1)
      this.elapsed += dt
      this.update(dt)
      this.stage.renderer.render(this.stage.scene, this.stage.camera)
      // The beacon's window, drawn into the same canvas over the chip. Second
      // pass, same context — see `Stage.renderInset`.
      if (this.beacon) {
        this.stage.renderInset(
          beaconRect(this.beacon),
          this.centreThree,
          this.model,
          this.restExtent,
        )
      }
    }
    this.raf = requestAnimationFrame(tick)
  }

  stop() {
    cancelAnimationFrame(this.raf)
  }

  /**
   * Advance the intro -> sustain -> outro machine.
   *
   * Loops rather than recursing because `enter` resets the clocks this reads,
   * and a state can legitimately fall straight through — a zero-length intro
   * into a sustain, or a one-shot whose successor is itself a one-shot. The
   * guard is a backstop against a misconfigured pair, not an expected path.
   */
  private advancePhase() {
    for (let guard = 0; guard < 4; guard++) {
      const tRaw = (this.elapsed - this.stateStart) * 1000

      if (this.phase === 'intro' && this.spec && tRaw >= this.spec.fromMs) {
        this.phase = 'sustain'
        this.phaseStart = this.elapsed
        // Entering a sustain is continuous by construction — a window clip's
        // head beat is SAMPLED at `fromMs`, so it is the pose the intro just
        // arrived at, to the last digit. The one exception is a hand-written
        // sustain (`spec.clip`), which is a different animation: `sleep`'s
        // deliberately closes the mouth and settles the arch the yawn left open,
        // and that wants an animated settle rather than a cut.
        if (this.spec.clip) this.blendFrom(PHASE_BLEND_MS)
      }

      if (this.phase === 'outro') {
        if ((this.elapsed - this.phaseStart) * 1000 < this.outroDurationMs()) return
        const q = this.queued
        this.queued = null
        this.enter(q?.name ?? this.nextState, q?.opts ?? {})
        continue
      }

      // THE STASH RUN CAN END ITSELF. A run given a card list and asked to play
      // through says so when its last batch has been up long enough — "until ALL
      // cards called for are in, then he closes" — and the closing is this
      // machine's outro, not the card system's business. Routed through
      // `beginOutro` rather than through `leaveAt` because the outro is the point:
      // the lid shutting and the final batch diving in are one authored beat.
      if (this.cards.wantsClose()) {
        this.beginOutro()
        continue
      }

      if (this.leaveAt !== null && this.elapsed >= this.leaveAt) {
        // Not an interrupt: the state ran its course, so whatever it deployed is
        // deployed and the outro has work to do.
        if (this.hasOutro()) {
          this.beginOutro()
          continue
        }
        this.enter(this.nextState, {})
        continue
      }

      return
    }
  }

  private outroDurationMs(): number {
    if (this.outroClip) return this.outroClip.clip.duration_ms
    const clip = this.states.get(this.current)!.clip
    return Math.max(0, clip.duration_ms - (this.spec?.toMs ?? 0))
  }

  /** The clip the current phase plays — the authored one unless the phase has a
   *  synthesized clip of its own. */
  private activeState(): CompiledState {
    if (this.phase === 'sustain' && this.sustainClip) return this.sustainClip
    if (this.phase === 'outro' && this.outroClip) return this.outroClip
    return this.states.get(this.current)!
  }

  /** Where in that clip we are. */
  private clipTime(): number {
    const tRaw = (this.elapsed - this.stateStart) * 1000

    if (this.phase === 'outro') {
      const tOut = (this.elapsed - this.phaseStart) * 1000
      // A synthesized outro is its own clip and starts at 0; an authored tail is
      // the SAME clip resumed at the loop's far end.
      return this.outroClip ? tOut : (this.spec?.toMs ?? 0) + tOut
    }

    if (this.phase === 'sustain') {
      if (this.sustainClip) {
        return ((this.elapsed - this.phaseStart) * 1000) % this.sustainClip.clip.duration_ms
      }
      // No sustain clip means a HOLD: `windowClip` returns null for a zero-width
      // window, because a constant has no seam to make cyclic and evaluating the
      // authored clip at one frozen instant is both cheaper and identical.
      return this.spec!.fromMs
    }

    const clip = this.states.get(this.current)!.clip
    return clip.loop ? tRaw % clip.duration_ms : tRaw
  }

  /**
   * Is he off the viewport, and if so where — the beacon's whole input.
   *
   * Measured against his SILHOUETTE, not his centre: "as soon as he is visible,
   * that little indicator would go away", so any part of him on screen means no
   * chip. His on-screen half-height is derived by projecting a second point one
   * half-body up, rather than assumed, because his apparent size changes with
   * depth (`background` parks him at a third scale) and with the dolly.
   */
  private updateBeacon() {
    const cam = this.stage.camera
    this.centreThree.copy(this.rootThree)
    this.centreThree.y += CENTRE_OFFSET
    this.screen.copy(this.centreThree).project(cam)
    const h = window.innerHeight
    const cy = (-this.screen.y * 0.5 + 0.5) * h
    const cx = (this.screen.x * 0.5 + 0.5) * window.innerWidth

    _top.copy(this.centreThree)
    _top.y += CENTRE_OFFSET
    _top.project(cam)
    const halfPx = Math.abs((-_top.y * 0.5 + 0.5) * h - cy)

    // Behind the camera: `project` flips the sign there, and a character behind
    // you is as absent as one above you. Treat him as past the top rather than
    // reporting a mirrored position.
    const behind = this.screen.z > 1
    const above = cy + halfPx < 0
    const below = cy - halfPx > h
    const next: Beacon | null =
      behind || above || below
        ? {
            x: Math.min(
              window.innerWidth - BEACON.size / 2 - BEACON.sideMargin,
              Math.max(BEACON.size / 2 + BEACON.sideMargin, cx),
            ),
            edge: below ? 'bottom' : 'top',
          }
        : null

    const same =
      (next === null && this.beacon === null) ||
      (next !== null &&
        this.beacon !== null &&
        next.edge === this.beacon.edge &&
        Math.abs(next.x - this.beacon.x) < 1)
    if (next === null && this.beacon !== null) this.stage.resetInset()
    this.beacon = next
    if (!same) this.opts.onBeacon?.(next)
  }

  /**
   * Scroll the page so he is vertically centred.
   *
   * Native smooth scrolling rather than a hand-rolled tween: it is eased, it is
   * interruptible by the user's own scroll, and it respects
   * `prefers-reduced-motion` without this module having to know that exists.
   */
  scrollIntoView() {
    const cam = this.stage.camera
    this.centreThree.copy(this.rootThree)
    this.centreThree.y += CENTRE_OFFSET
    this.screen.copy(this.centreThree).project(cam)
    const cy = (-this.screen.y * 0.5 + 0.5) * window.innerHeight
    // THE SCROLLER MIGHT NOT BE THE DOCUMENT. The scroll listener is
    // capture-phase precisely so that an element inside a nested scroll
    // container still drags him along — so the way back has to find the same
    // container, or clicking the beacon scrolls the page and he does not move.
    const el =
      this.station.kind === 'element' && 'selector' in this.station.target
        ? document.querySelector(this.station.target.selector)
        : null
    const scroller = scrollableAncestor(el)
    if (scroller) {
      scroller.scrollTo({ top: scrollToCentre(cy, scroller), behavior: 'smooth' })
      return
    }
    window.scrollTo({ top: scrollToCentre(cy), behavior: 'smooth' })
  }

  private update(dt: number) {
    if (!this.rig) return

    // ---- the page may have moved ---------------------------------------
    this.syncStation()

    // ---- facing --------------------------------------------------------
    if (this.facingT < 1) {
      this.facingT = Math.min(1, this.facingT + (dt * 1000) / FACING_TURN_MS)
      const u = this.facingT
      const e = u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2 // easeInOutCubic
      this.facing = this.facingFrom + (this.facingTarget - this.facingFrom) * e
    }
    // Cross-fade the lights and rotate the HDRI with him. NEVER yaw the lights:
    // that swings the key behind him relative to a fixed camera (measured 4.3%
    // brightness delta and visibly darker) where the cross-fade measures 0.68%.
    this.stage.setFacing(this.facing)
    this.rig.facing.rotation.y = ((1 - this.facing) / 2) * FACING_YAW_DEG * DEG

    // ---- base state ----------------------------------------------------
    this.advancePhase()
    const st = this.activeState()
    const clip = st.clip
    // Keep BOTH clocks. The phase clock wraps every loop; the card orbit and the
    // symbol spin are one continuous rotation each, and the orbit's period
    // (2700 ms) is deliberately not the loop (1800 ms) — driving either from the
    // wrapped clock jumps it backwards on every wrap. That is the same bug in
    // two places: it made the orbit stutter a third of a turn, and it is why
    // `alert_dizzy`'s authored `sym_spin` ramp cannot survive being looped.
    const tRaw = (this.elapsed - this.stateStart) * 1000
    const tClip = this.clipTime()
    evalState(st, tClip, this.doc.rest_pose, this.pose)

    // ---- crossfade -----------------------------------------------------
    if (this.transition) {
      const u = (this.elapsed - this.transition.started) * 1000 / this.transition.durationMs
      if (u >= 1) {
        this.transition = null
      } else {
        // EASED, not linear. A linear crossfade arrives and departs at full
        // speed, so however long you make it the ends still read as cuts —
        // which is what "the animation is snapping at the end" was describing.
        const e = u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2 // easeInOutCubic
        const from = this.transition.from
        for (const k in this.pose) this.pose[k] = from[k] + (this.pose[k] - from[k]) * e
      }
    }

    // Everything above this line is the base layer. Everything below composes
    // ON TOP of it and must not be captured by the next crossfade's snapshot.
    for (const k in this.pose) this.basePose[k] = this.pose[k]

    // ---- symbol motion ---------------------------------------------------
    // Applied ABOVE the base layer on purpose, so it is never captured by a
    // crossfade snapshot: blending a continuously-growing angle from one state's
    // 3000 degrees down to the next state's zero spins the glyph backwards for
    // the length of the blend.
    const spinRate = spinRateFor(clip, this.doc)
    if (spinRate) this.pose.sym_spin = (tRaw / 1000) * spinRate
    if (clip.symbol === 'scribble') {
      // The authored `sym_frame` steps do not start until 625 ms in — "the
      // scribbles are waiting too long to start animating, they should be
      // animating from the get go". Driving the frame from the atlas's own
      // `scribble_hz` starts it on frame one and survives the loop.
      const hz = this.doc.symbol_atlas.scribble_hz
      this.pose.sym_frame = Math.floor((tRaw / 1000) * hz) % 3
    }

    // ---- talk overlay --------------------------------------------------
    // The composition rule is a DESIGNED CHOICE, not a recovered one: no rule
    // survives anywhere in the sources. `mouth` takes the max (following the
    // flight layer's precedent, so talk can never close a mouth a state is
    // holding open), and the shape channels blend by weight.
    if (this.talkWeight !== this.talkTarget) {
      const step = (dt * 1000) / TALK_RAMP_MS
      this.talkWeight =
        this.talkWeight < this.talkTarget
          ? Math.min(this.talkTarget, this.talkWeight + step)
          : Math.max(this.talkTarget, this.talkWeight - step)
    }
    if (this.talkWeight > 0) {
      const talk = this.states.get('talk')!
      this.talkClock = (this.talkClock + dt * 1000) % talk.clip.duration_ms
      evalState(talk, this.talkClock, this.doc.rest_pose, this.overlayPose)
      const w = this.talkWeight
      this.pose.mouth = Math.max(this.pose.mouth, this.overlayPose.mouth * w)
      for (const ch of ['m_curve', 'm_s', 'bend'] as const) {
        const delta = this.overlayPose[ch] - this.doc.rest_pose[ch]
        this.pose[ch] += delta * w
      }
    }

    // ---- procedural layers ---------------------------------------------
    // While travelling the hover bob is DAMPED, not off. He is under power and
    // steering, so a full-amplitude idle float on top of a flight path reads as
    // an unstable wobble rather than as hovering — and the blink rate drops
    // because he is concentrating.
    const mod = this.track
      ? { float_amp: 0.5, float_rate: 1.15, blink_rate: 0.8 }
      : clip.modulation
    const frozen = mod.float_amp === 0
    this.proc.float.advance(dt, mod.float_rate)
    this.proc.float.evaluate(mod.float_amp, this.floatOut)

    const blink = this.proc.blink.at(this.elapsed, mod.blink_rate)
    if (blink > 0) {
      // The blink layer takes the MAX of the state's close amount and the blink
      // curve, so a blink during `sad` still fully shuts rather than fighting
      // the pose. The lower lid rises to 0.75x the upper — both move, but the
      // upper does most of the work, which is how real lids behave.
      this.pose.lid_u = Math.max(this.pose.lid_u, blink)
      this.pose.lid_l = Math.max(this.pose.lid_l, blink * this.proc.blink.lowerLidRatio)
    }

    // Travel is gaze-locked: his gaze LEADS the move, and a stray glance-away
    // fights the lead. Subtle flits still run.
    this.proc.gaze.at(this.elapsed, !!clip.gaze_lock || !!this.track, frozen, this.gazeOut)
    // NOT composed into `pose.gx/gz`. The procedural layer is EYE motion, and it
    // has to survive the aim's roam clamp, which at this staging is saturated
    // 2.3x over — see the `GazeOffset` note in `look.ts`. It is handed to
    // `applyLook` instead, which applies it past the clamp.
    //
    // That moves the facing negation here, where it is explicit. It used to be
    // an ordering invariant: the layer composed into `pose.gx` and `resolveFacing`
    // ran afterwards, and running it early made every glance go the wrong way at
    // facing = -1. Same correction, stated rather than implied.
    this.micro.x = this.gazeOut.gx * this.facing
    this.micro.z = this.gazeOut.gz

    // ---- facing resolution ---------------------------------------------
    // MUST run after the procedural layers, not before. Resolve first and the
    // flits and glance-aways bypass the `gx` negation, so at facing = -1 every
    // glance goes the wrong way.
    resolveFacing(this.pose, this.facing)

    // ---- flight ----------------------------------------------------------
    // The solved track is authoritative for position and for the transient pose
    // channels while a leg is playing; the state layer keeps the face.
    if (this.track) {
      const tf = (this.elapsed - this.trackStart) * 1000
      sampleTrack(this.track, tf, this.flightSample)
      const f = this.flightSample
      // The page moving under a flight shifts its DESTINATION, not its origin —
      // so the shift ramps in with the flight's own progress. See `syncStation`.
      const u = Math.min(1, Math.max(0, tf / this.track.durationMs))
      this.pose.px += f.pos.x + this.trackShift.x * u
      this.pose.py += f.pos.y + this.trackShift.y * u
      this.pose.pz += f.pos.z + this.trackShift.z * u
      this.pose.rx += f.rx
      this.pose.ry += f.ry
      this.pose.rz += f.rz
      this.pose.sq += f.sq
      this.pose.bend += f.bend
      this.pose.lean += f.lean
      this.pose.twist += f.twist
      // The flight lid can never be closed by an expression key — max, not add.
      this.pose.mouth = Math.max(this.pose.mouth, f.mouth)
      if (tf >= this.track.durationMs) {
        this.track = null
        const arrived = this.onArrive
        this.onArrive = null
        arrived?.()
      }
    } else {
      // ADD the parked anchor, never overwrite. The authored `px/py/pz` carry
      // the state's OWN motion — the alert pop, the boot bounce, the sad sink —
      // and replacing them with the anchor silently deletes all of it. That
      // showed up as a 33.7px vertical error against Blender on `alert_star`,
      // which is exactly the 0.24-unit pop the state is supposed to have.
      this.pose.px += this.anchor.x
      this.pose.py += this.anchor.y
      this.pose.pz += this.anchor.z
    }

    // ---- external overrides --------------------------------------------
    for (const [ch, v] of this.overrides) this.pose[ch] = v

    // ---- framing ---------------------------------------------------------
    // Solved from the FINAL position — after the flight, the anchor and any
    // pinned channel — because it is a function of where he actually ends up on
    // screen this frame, not of where he was asked to go. At the staging origin
    // it is the identity, which is what keeps parity mode honest.
    blenderToThree(this.pose.px, this.pose.py, this.pose.pz, this.rootThree)
    solveFraming(this.stage.camera, this.rootThree, this.framing)
    this.updateBeacon()
    this.stage.setFraming(this.framing.position, this.framing.quaternion, this.framing.yaw)

    // ---- apply ----------------------------------------------------------
    applyPose(this.rig, this.pose, { facing: this.facing, framing: this.framing })

    // The float is the single additive layer and lives on its own node between
    // the keyed root and the squash, because Blender cannot drive and keyframe
    // the same channel — and that separation is what makes it clean here too.
    this.rig.float.position.set(this.floatOut.x, this.floatOut.z, -this.floatOut.y)
    this.rig.float.rotation.set(
      this.floatOut.rx * DEG,
      this.floatOut.rz * DEG,
      -this.floatOut.ry * DEG,
    )

    // Fold the mouth's back-arch into the field's bend input, CLAMPED. It
    // saturates at mouth = 1 (measured frame by frame — see MOUTH.secondaryMax);
    // folding it unclamped and un-folding it again inside the rider pass, as an
    // earlier version did, is the same answer by a route where the caller passes
    // a wrong value and the callee quietly corrects it.
    this.riderSystem.apply(
      (this.pose.bend - MOUTH.archAtFull * Math.min(this.pose.mouth, MOUTH.secondaryMax)) * 18,
      this.pose.lean * 15,
      this.pose.twist * 12,
      this.pose.mouth,
    )

    // Cards run AFTER the riders, and that ordering is load-bearing:
    // `Card_Single_anim` is a rider, so `riders.apply` decomposes a full matrix
    // onto it and resets its scale to 1. Existence is scale, so the `single`
    // channel has to be the last word or the card he stashes never disappears.
    // `Eye_Rig` follows the MORPHED lid surface, not the analytic field, so this
    // must run after the rider pass — it deliberately overwrites what riders.ts
    // wrote for that one node — and before the eye shader samples world matrices.
    this.eyeSocket?.apply()

    this.cards.apply(this.pose, {
      facing: this.facing,
      state: this.current,
      phase: this.phase,
      tMs: tRaw,
      clipTMs: tClip,
      phaseTMs: (this.elapsed - this.phaseStart) * 1000,
      // The BASE state's own flag, not the active phase's clip: `loading`'s
      // synthesized outro is a different clip and does not carry `orbit`, and
      // the loose cards have to keep obeying the spawn schedule through it.
      orbit: !!this.states.get(this.current)?.clip.orbit,
      float: this.floatOut,
    })

    // ---- eye shader ------------------------------------------------------
    // The eye reads the WORLD matrix of seven control empties per side, so the
    // graph has to be flushed here rather than left to the renderer: sampling
    // it first would hand the shader last frame's reel position.
    this.stage.scene.updateMatrixWorld(true)

    // The look-at solve needs those world matrices and then writes back into
    // the two eye subtrees, so it sits between the flush and the uniform push.
    applyLook(this.rig, this.stage.camera, this.pose, this.micro)

    if (this.eyes.length) {
      const symbol = clip.symbol
      for (const e of this.eyes) syncEyeUniforms(e.mat, e.ctrls, this.pose, symbol)
    }
  }

  resize(width: number, height: number) {
    this.stage.setSize(width, height)
    // A parked presentation is anchored to a DOM RECT, and the rect moved. Chase
    // it, but only once the layout has SETTLED — a TRAILING debounce, restarted
    // by every event, so the move that actually gets chased is the last one.
    //
    // A leading-edge throttle looks like the same three lines and is the wrong
    // shape: it fires on the first event of a drag and drops the trailing edge,
    // so a continuous resize leaves him parked beside where the element used to
    // be, which is the failure this is supposed to prevent.
    if (this.rePark !== null) clearTimeout(this.rePark)
    this.rePark = setTimeout(() => {
      this.rePark = null
      if (this.disposed) return
      const park = this.solveStation()
      if (!park) return
      // HOME SNAPS, AN ELEMENT IS FLOWN TO. Home is a parking spot in the
      // viewport, so after a resize it is simply somewhere else and flying to it
      // would be a journey to the same place. A presentation has genuinely moved
      // relative to the content, and the flight is what makes that legible.
      if (this.station.kind === 'home') {
        this.anchor.copy(park.position)
        this.trackDest.copy(this.anchor)
        return
      }
      this.launch(park.position)
      if (park.facing !== undefined) this.setFacing(park.facing)
    }, RE_PARK_SETTLE_MS)
  }

  dispose() {
    this.disposed = true
    this.stop()
    // Before the scene walk below, which disposes every material it finds: the
    // art system owns CLONED materials and the textures it fetched, and it is
    // the only thing that knows which textures came from the glb (and are the
    // walk's to free) and which are its own.
    this.art?.dispose()
    window.removeEventListener('scroll', this.onScroll, { capture: true })
    // Tear the scene down properly, not just the loop. React 19's StrictMode
    // mounts effects twice in dev, so a partial teardown leaves a SECOND
    // WebGLRenderer bound to the same canvas — both keep drawing, and the
    // survivor renders without the environment, which shows up as a washed-out
    // duplicate character. Releasing the context is what actually stops it.
    this.stage.scene.traverse((o) => {
      const m = o as unknown as {
        geometry?: { dispose(): void }
        material?: { dispose(): void } | { dispose(): void }[]
      }
      m.geometry?.dispose()
      if (Array.isArray(m.material)) m.material.forEach((x) => x.dispose())
      else m.material?.dispose()
    })
    this.stage.scene.clear()
    this.stage.dispose()
    if (this.rePark !== null) clearTimeout(this.rePark)
    clearHighlight()
    if (INSTANCES.get(this.opts.canvas) === this) INSTANCES.delete(this.opts.canvas)
  }
}

