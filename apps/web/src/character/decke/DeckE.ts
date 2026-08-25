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
import { installLtcTables } from './ltc'
import { CENTRE_OFFSET, makeFraming, solveFraming, type Framing } from './framing'
import { ENTRY_MS, bodySpan, clampEntryScale, entryScaleAt } from './entry'
import {
  canvasHeight,
  documentHeight,
  elasticOffset,
  setCanvasOrigin,
  setViewport,
  viewHeight,
  viewWidth,
} from '../viewport'
import {
  BEACON,
  beaconRect,
  scrollableAncestor,
  scrollToCentre,
  type Beacon,
} from '../beacon'
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
  type Modulation,
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
import { blenderToThree, BODY_H, BODY_W, DEG, MOUTH } from './constants'
import { sampleTrack, solveFlight, type FlightSample, type FlightTrack } from './flight'
import {
  homeCorner,
  parkOn,
  resolveRect,
  setKeepOut as setKeepOutRegion,
  shapeFor,
  ridesThePage,
  solvePark,
  type Depth,
  type FlyTarget,
  type KeepOut,
  type RectLike,
  type Side,
} from './dom'
import {
  clearHighlight,
  highlightElement,
  highlighted,
  setHighlightAnchor,
  setHighlightShift,
} from '../../components/ui/elementHighlight'
import { pinToPage, pinWindow, unpinToViewport } from './pageAnchor'

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
 * The shortest a turn may be compressed to when it rides a flight.
 *
 * A turn matched to a 240 ms nudge would be a flick rather than a yaw, and the
 * near/far asymmetry that makes it read as a TURN needs time to wash through
 * zero (see `FACING_TURN_MS` above). So a short leg's turn finishes with the
 * leg where it can, and lands a little after it where it cannot — the flinch
 * this bounds is a turn that outlasts its flight by 100-250 ms, and 280 ms is
 * inside every shipped leg except the two shortest.
 */
const FACING_TURN_MIN_MS = 280

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

/**
 * While travelling the hover bob is DAMPED, not off. He is under power and
 * steering, so a full-amplitude idle float on top of a flight path reads as an
 * unstable wobble rather than as hovering — and the blink rate drops because he
 * is concentrating.
 *
 * This does not go through a state change, so it gets its own ramp. `240` is
 * shorter than a state blend because the flight it belongs to has already begun
 * moving him: the damping should be in by the time he is up to speed.
 */
const TRAVEL_MOD: Modulation = { float_amp: 0.5, float_rate: 1.15, blink_rate: 0.8 }
const TRAVEL_MOD_MS = 240

/** The reserved name an agent-authored clip is registered under. One slot, so a
 *  second custom clip replaces the first rather than growing the state table for
 *  the life of the page. */
export const CUSTOM_STATE = 'custom'

/** How quiet a resize has to go before a parked presentation chases its
 *  element's new position. */
const RE_PARK_SETTLE_MS = 250


/**
 * The BACKSTOP interval for re-reading a pinned element, behind the
 * `ResizeObserver` that does the real work.
 *
 * Pinning trades per-frame correctness for compositor smoothness, so something
 * has to notice when the trade stops being valid — an image loading above the
 * fold, an accordion opening, a font swapping in. A poll alone would do it, and
 * it was the first version, but the lag is visible: a 150 px reflow measured
 * here left the ring 150 px off its element for as long as the interval, where
 * the per-frame version it replaces corrected inside one frame. Trading a
 * scroll-rate defect for a reflow-rate one is not a fix.
 *
 * So the trigger is a `ResizeObserver` on the element and on the document, which
 * fires when a reflow actually happens and gets the correction back to a single
 * frame for every cause that changes a box. This interval remains for the causes
 * that do not — an element MOVED by something that resized nothing observable —
 * at a rate that is 1.5% of the layout reads this whole change removes.
 */
const PIN_RECHECK_MS = 400

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
  /**
   * Called on the frame he lands, once, after the ring and the `then` state.
   *
   * `then` covers "do something WITH HIM when he gets there"; this covers the
   * caller needing to know, which `then` cannot express. The dismissal is the
   * case that wanted it: he flies back into the launcher and is scaled away on
   * arrival, and before this existed the host had to guess how long that took —
   * a fixed 520 ms timer against a flight measured at ~1300 ms, so he winked
   * out in mid-air and the rest of the trip was flown by nobody.
   *
   * FIRES ON THE CUT PATH TOO, which is what makes it safe under reduced
   * motion: `flyTo` ends in `settleCut`, so an instant flight arrives
   * synchronously and the callback runs with no branch at the call site. See
   * `settleCut`.
   *
   * `playEntry({ onDone })` is the same contract on the entrance, deliberately
   * — the way out mirrors the way in, and one shape of "tell me when" beats two.
   *
   * `aborted` is true when the flight was REPLACED before it landed — another
   * `flyTo` or a `returnHome` took over. The ring and the `then` state are
   * skipped in that case (he is not there), and the callback must not do its
   * arrival work either; it is being told so it can stop waiting, not so it
   * can pretend.
   */
  arrived?: (aborted: boolean) => void
  /**
   * Stand ON the target rather than beside it.
   *
   * The default is to park OUTBOARD, which is what presenting an element wants:
   * the element ends up between him and the middle of the page. A container he
   * is meant to sit INSIDE wants the opposite, and the outboard gap pushes him
   * halfway out of it — measured at ~150 px outside a 393 px chat panel.
   *
   * Only meaningful for a point or a rect whose centre is the intended spot.
   * Facing is left alone, because a point has no inward to face.
   */
  centre?: boolean
  /**
   * Which part of HIM lines up with the target on the vertical.
   *
   * `bottom` puts his BASE on the target's bottom edge instead of matching his
   * middle to its middle. For a target much shorter than he is — the composer
   * is 58px against his ~216 — centring hangs most of him below it, which at
   * the bottom of a window means cut off.
   *
   * `optical` is `bottom` sunk by a fraction of his drawn height, so the
   * target's baseline lands UP his body and he reads as standing alongside it
   * rather than perched on it. See `OPTICAL_OVERLAP` in `dom.ts`.
   */
  anchor?: 'centre' | 'bottom' | 'optical'
  /**
   * Where he faces when he lands, in [-1, +1] — honoured EVEN WITH `centre`.
   *
   * `solvePark`'s centre branch deliberately returns no facing (a point has no
   * inward), and without this option `flyTo` then re-asserts whatever he was
   * already turned to — which for a fresh page is the boot default of +1,
   * screen-left, i.e. his back to the composer he was just parked in front of.
   *
   * THE FIX BELONGS HERE AND NOT IN `solvePark`. Making a centre park invent a
   * facing would put the geometry solve back in the business of guessing intent
   * — `park.test.ts` pins that it does not, and `dom.ts` records that unifying
   * the two callers on one solve was itself a bug fix. The caller knows which
   * way the thing he is standing in front of faces; the geometry does not.
   *
   * Survives a re-solve for free: `syncStation` only re-asserts a facing when
   * the park returns one, and a centre park never does.
   */
  facing?: number
  /**
   * ARRIVE WITHOUT TRAVELLING — the reduced-motion path, per call.
   *
   * Defaults to the instance's `reduced` flag. It is a different code path, not
   * a disabled animation: he still lands exactly where the flight would have put
   * him, still takes the station, still turns, still rings the target and still
   * enters `then`. See `launch`.
   */
  instant?: boolean
  /**
   * Go via the background plane instead of straight there.
   *
   * Two legs: out to the far plane above the destination's column, then in to
   * the destination. It reads as him pulling back, crossing, and coming in —
   * which is what a character moving a long way across a page should look like,
   * and what a straight line between two foreground points never does.
   *
   * NOT free, and not always right. A short hop is worse this way: the depth
   * change is 24-27 world units against a same-depth leg of under 3, so a
   * two-leg trip across a card grid spends most of its time going nowhere. The
   * caller decides; `flyTo` does not guess.
   */
  via?: 'background'
  /**
   * Tween the entrance scale to this value ACROSS THE FLIGHT, driven by the
   * flight's own progress rather than a clock of its own.
   *
   * `scaleTo: 0` is the exit the owner asked for by name — "jump back to his
   * chat bubble and scale down to zero so that it looks like he's jumping into
   * his chat bubble/hiding". The change is eased toward the destination end
   * for a shrink (he flies most of the way at size and dives into the target)
   * and toward the origin end for a grow, and because the driver is flight
   * progress, "gone" and "landed" are the same frame by construction — no
   * duration to guess, no mid-air wink-out. With `via: 'background'` the
   * scale rides the FINAL leg. Instant flights simply arrive at the scale.
   */
  scaleTo?: number
  /**
   * Extra playback speed for this flight, multiplied on top of the distance-
   * ramped `travelRate`. Scales playback of the solved track only — it cannot
   * destabilise the integrator or wake the frame guard (see `SolveOptions.rate`).
   * The chat open/close legs pass 2, per the owner: "twice as fast … nice and
   * snappy", without touching the pace of anything else he does. A `via:
   * 'background'` trip carries it across both legs.
   */
  rate?: number
  /**
   * Scroll the page under him while he travels, so the net effect is HIM moving
   * through the page rather than the page jumping and him following.
   *
   * Only meaningful for a target that is off-screen or near an edge; a target
   * already comfortably in view needs no scroll and gets none.
   *
   * A USER SCROLL CANCELS IT. Native smooth scrolling was chosen everywhere else
   * in this file precisely because it is interruptible, and a driven scroll that
   * fights the reader's own wheel is worse than no scroll at all.
   */
  scrollWith?: boolean
}

export type DeckEOptions = {
  canvas: HTMLCanvasElement
  baseUrl: string
  /**
   * Which glb under `models/decke/` to load. Defaults to the shipped
   * `decke.glb`.
   *
   * This exists for `/dev/decke-compare`, which runs two controllers side by
   * side — the shipped asset and an optimized candidate — driven from one set
   * of buttons, so a size win can be judged against the thing it costs.
   */
  modelFile?: string
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
  /**
   * The reader has asked for reduced motion.
   *
   * THE HOST OWNS THE MEDIA QUERY; THE ENGINE OWNS THE BEHAVIOUR. Nothing in
   * `character/decke/` calls `matchMedia` and nothing should: this module is
   * framework-free and page-free by design, and it already relies on the same
   * division for scrolling (native smooth scroll honours the query "without this
   * module having to know that exists"). So the flag comes in from outside, and
   * `setReducedMotion` keeps it live because the query can change under a
   * running page.
   *
   * What it changes, all of it a DIFFERENT path rather than a disabled one:
   *   - `playEntry` arrives at full size with no grow;
   *   - `flyTo` and `returnHome` cut to the destination instead of flying it,
   *     while still arriving — station, facing, ring and `then` all happen.
   * `{ instant }` on the call overrides it either way.
   */
  reduced?: boolean
  /**
   * Bands of the viewport he may not stand in — the app header, the composer,
   * whatever else the page owns. Same division as `reduced`: the host measures
   * the chrome, the engine decides what standing clear of it means. See
   * `setKeepOut` in `dom.ts`, and `DeckE.setKeepOut` to change it while running,
   * which the host must, because the header and the composer are not the same
   * height on every route or with the chat open.
   *
   * Absent means no bands, and no band reproduces the old placement exactly.
   */
  keepOut?: Partial<KeepOut>
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
  | {
      kind: 'element'
      target: FlyTarget
      depth: Depth
      side: Side
      /**
       * ON the target rather than beside it — `flyTo`'s `centre` option, kept.
       *
       * It has to live here and not just in the flight, and leaving it out was a
       * bug with a long fuse: `centre` was honoured for the LAUNCH and forgotten
       * by the re-solve, so he flew to the middle of his mark and then the first
       * resize, scroll or dirty-station poll quietly moved him beside it. On a
       * target in the middle of the page that reads as a small drift. On one
       * against the left edge it is not small at all — `parkBeside` has an edge
       * exception that flips him to the far side of anything he would otherwise
       * hang off the screen for, so a mark in the bottom-left corner threw him a
       * body's width to the RIGHT, on top of the thing the mark existed to keep
       * him clear of.
       */
      centre: boolean
      /** Carried for the same reason `centre` is: a re-solve must not lose it.
       *  All three values, `optical` included — the whole point of the note
       *  above is that a vertical intent the re-solve does not know about is a
       *  bug with a long fuse. */
      anchor?: 'centre' | 'bottom' | 'optical'
    }

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
/** Scratch for `screenRect`'s body span. Same rule. */
const _feet = new Vector3()
const _head = new Vector3()
/** Scratch for the Blender->three conversion inside `screenRect`. */
const _proj = new Vector3()

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

  /**
   * The float/blink modulation ACTUALLY in effect, which eases rather than
   * switching.
   *
   * THE DEFECT this exists for: "on the boot animation when he's done there's a
   * hard jump back into idle... like a frame skip, and it happens every time".
   * It was not a frame skip and it was not in the pose — every authored channel
   * is continuous across that handoff, and the camera, the anchor and the
   * framing quaternion are all byte-identical on either side of it. It was
   * this: `boot` runs at `float_amp: 0` and `idle` at `1`, the crossfade only
   * ever covered the POSE, and the float's phase keeps advancing while its
   * amplitude is zero. So on the frame boot ended, the hover appeared at
   * whatever point of its cycle it had silently reached — measured at 0.0174
   * units of travel in a single frame against a 0.0012 ceiling for an ordinary
   * one, a 14x step, and 0.98 radians on `rx`.
   *
   * Blending the modulation on the same schedule as the pose costs nothing when
   * the two states agree, which is most of them, and is the whole fix when they
   * do not.
   */
  private modNow: Modulation = { float_amp: 1, float_rate: 1, blink_rate: 1 }
  private modFrom: Modulation | null = null
  private modStart = 0
  private modMs = 0

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
  /** Playback-rate multiplier for the current flight's legs. Written by the
   *  two public flight entry points, read by `launch`. See `FlyOptions.rate`. */
  private legRate = 1
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
    // The very same events that move his mark can move the CANVAS he is drawn
    // into — iOS slides every fixed layer when it reveals a focused input.
    this.originDirty = true
  }
  /** How he is turned toward the viewer where he stands. See `framing.ts`. */
  /** How long the last frame took INSIDE this class — update, render, and the
   *  beacon's second pass. Read by the dev page's instrument. */
  tickMs = 0
  /** The last size `resize` was given, so a no-op resize can be recognised. */
  private viewW = 0
  private viewH = 0
  private canvasH = 0
  /** The document's own `overscroll-behavior-y`, restored on dispose. */
  private overscrollWas = ''
  /** Set the first time the engine admits to a bounce. Once true the lock is
   *  released for the life of the page and the offset is followed instead. */
  private reportsElastic = false
  /** The bounce currently applied to the overlays, so a no-op frame writes no
   *  style — this runs every frame and is 0 for almost all of them. */
  private elasticNow = 0
  /** Set while something is holding the document still — see `holdElastic`. */
  private elasticHeld = false
  /** The canvas's client origin needs re-measuring — see `canvasOriginY`. */
  private originDirty = true
  /** The document offset the overlays are pinned at, or null while they are
   *  pinned to the viewport and he is tracking by hand. See `pageAnchor.ts`. */
  private pinnedAt: number | null = null
  /** The pinned element's box in DOCUMENT coordinates, so a reflow underneath
   *  him can be recognised without a layout read on the frames that do not need
   *  one. See `syncPinned`. */
  private readonly pinnedBox = { x: 0, y: 0, w: 0, h: 0 }
  private pinCheckAt = 0
  /** The element a pinned park is anchored to, resolved once by `canPin` so the
   *  pin itself does not query the document a second time. */
  private pinEl: Element | null = null
  /** Where the canvas's top edge sits in the viewport while pinned, in CSS
   *  pixels — 0 when the canvas and the viewport are aligned, and non-zero when
   *  the canvas has been slid off the viewport to keep him inside it. See
   *  `canPin`. */
  private pinShift = 0
  /** The pinned element's box in CANVAS coordinates — which is to say its
   *  viewport box at the moment of pinning, because that is the moment the two
   *  spaces coincide. Constant for the life of the pin: the element and the
   *  canvas are pinned to the same page, so neither moves relative to the
   *  other. See `syncPinned`. */
  private readonly pinnedRect = { left: 0, top: 0, right: 0, width: 0, height: 0 }
  /** Watches the pinned element and the document for a reflow. See
   *  `PIN_RECHECK_MS` for why this exists as well as the interval. */
  private pinWatch: ResizeObserver | null = null
  private pinStale = false
  /** How far the page has scrolled since the overlays were pinned — the
   *  difference between where the canvas thinks it is and where it is being
   *  drawn. Zero unless pinned, and read by the beacon, `scrollIntoView` and the
   *  dev page's instrument, all of which want VIEWPORT coordinates. */
  driftPx = 0
  private readonly framing: Framing = makeFraming()
  /** The same solve with the vertical give-back taken back out, for the beacon
   *  chip's pass. Solved only on the frames the chip is actually drawn. */
  private readonly framingLevel: Framing = makeFraming()
  private readonly rootThree = new Vector3()
  /** His centre in world space, and the same point projected to the viewport.
   *  Both are wanted every frame by the beacon; neither is worth allocating. */
  private readonly centreThree = new Vector3()
  private readonly screen = new Vector3()
  /** His silhouette on the viewport, as `updateBeacon` last measured it: centre
   *  and half-height in CSS pixels, and whether he is behind the camera. The
   *  beacon needs it to decide on the chip and `canPin` needs it to decide
   *  whether he is far enough from the edges to be handed over. */
  private screenY = 0
  private screenHalf = 0
  private screenBehind = false
  /** The beacon as last reported, so the callback fires on CHANGE rather than
   *  sixty times a second — it drives React state. */
  private beacon: Beacon | null = null
  /** The pending trailing-edge re-park. See `resize`. */
  private rePark: ReturnType<typeof setTimeout> | null = null
  /** Set when a flight is in the air; applied the frame it lands. See `update`.
   *  Fired with `aborted: true` when a new flight replaces it before it lands —
   *  silence was worse: the ring, the `then` state and the caller's callback
   *  all vanished with nothing to say so, and the host's "scale him away on
   *  arrival" is exactly the kind of cleanup that must run or be told why not. */
  private onArrive: ((aborted: boolean) => void) | null = null

  /** Fire-and-clear the pending arrival, exactly once. */
  private fireOnArrive(aborted: boolean) {
    const arrived = this.onArrive
    this.onArrive = null
    arrived?.(aborted)
  }

  // ---- entrance and reduced motion -------------------------------------
  /** The whole-body entrance scale on the rig root. 1 is "fully here". */
  private entryNow = 1
  /** The grow (or shrink — see `playEntry`'s `to`) in progress, if any. */
  private entryTween:
    | { from: number; to: number; started: number; durationMs: number; onDone?: () => void }
    | null = null
  /**
   * A scale change RIDING THE FLIGHT rather than running on its own clock.
   *
   * `entryTween` answers "grow over N ms, wherever you are". The exit wants
   * the other contract: "be gone exactly when you land" — a fixed-duration
   * tween against a flight whose duration is solved, not chosen, is how the
   * old host vanished him in mid-air at 520 ms of a 1300 ms trip. So the
   * flight's own progress drives the scale, eased so the change concentrates
   * at the destination end (shrinks dive INTO the target, grows pop OUT of
   * the origin), and arrival and full-scale are the same frame by
   * construction. Set by `flyTo({ scaleTo })`; null whenever no flight owns
   * the scale.
   */
  private flightScale: { from: number; to: number } | null = null
  /** The reader's reduced-motion preference, as told to us. See `DeckEOptions`. */
  private reduced = false
  /**
   * A flight that CUT rather than flew, waiting to be declared arrived.
   *
   * It cannot fire from inside `launch`: `flyTo` installs `onArrive` after the
   * launch returns, so an arrival fired there would find the slot empty and
   * silently drop the highlight ring and the `then` state — precisely the
   * half-state this path exists to avoid. So the cut sets this and the two
   * public entry points settle it once they have finished setting up.
   */
  private cutPending = false

  constructor(private readonly opts: DeckEOptions) {
    INSTANCES.get(opts.canvas)?.dispose()
    this.reduced = !!opts.reduced
    // ALWAYS, INCLUDING WITH NO OPTION. The region is a module singleton in
    // `dom.ts` for the reason `viewport.ts` is one, and a singleton outlives its
    // controller: a page that mounts the host, navigates to `/dev/decke` and
    // builds a second controller there would otherwise inherit the app shell's
    // bands on a page that has no app shell.
    setKeepOutRegion(opts.keepOut ?? null)
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
    // meshopt, never Draco: `KHR_draco_mesh_compression` structurally cannot
    // carry morph targets, and every body deformation on this character is one.
    // `scripts/decke/shrink.mjs` takes the raw export to 2.92 MB;
    // `scripts/decke/optimize.mjs` is the second pass that quantises it.
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
    const [gltf, doc, cards, , atlas] = await Promise.all([
      // The default is spelled out as a LITERAL and not interpolated, because
      // `scripts/check-precache.mjs` proves the assets exist by scanning this
      // directory for `models/decke/<file>` — a fully templated path hides the
      // name from that gate, and the failure it exists to catch (a 404 in
      // production and nowhere else) comes back.
      loader.loadAsync(
        this.opts.modelFile
          ? `${baseUrl}models/decke/${this.opts.modelFile}`
          : `${baseUrl}models/decke/decke.glb`,
      ),
      loadPlaybook(baseUrl),
      loadCards(baseUrl),
      // The RectAreaLight BRDF tables. Must land before the first render — see
      // `ltc.ts`. Fetched here rather than at construction so it shares this
      // waterfall instead of adding one.
      installLtcTables(baseUrl),
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

    // STOP THE PAGE RUBBER-BANDING OUT FROM UNDER HIM.
    //
    //   "When I scroll beyond like the limit, that highlight and him don't go
    //    down with it, for some reason. Let's fix that. I'm not sure why those
    //    aren't going down with the rest of the page."
    //
    // Because they CANNOT, and this is the one complaint in the round that has
    // no version of "follow it better". Elastic overscroll is done in the
    // compositor: the content is drawn translated without anything in the
    // document model moving, and he and the ring both live in `position: fixed`
    // layers, which the bounce does not touch. Measured, past the top of the
    // document every scroll metric a follow could read is pinned flat —
    // `scrollY` 0, `getBoundingClientRect().top` 0, `visualViewport.offsetTop` 0
    // and `.pageTop` 0 — through the whole gesture. There is no offset to read,
    // so there is nothing to chase.
    //
    // The disagreement is removable even though the bounce is not observable:
    // don't let the document bounce while he is on it. That is one line, it
    // needs no per-frame work, and it makes the page and the character agree by
    // construction rather than by tracking. Restored on dispose, because it is
    // his constraint and not the app's.
    this.overscrollWas = document.documentElement.style.overscrollBehaviorY
    // The lock is the FALLBACK, not the policy. It goes on now and comes off the
    // first frame the engine reports a bounce, because an engine that reports one
    // can be followed and does not need its bounce taken away. On WebKit that is
    // the first overscroll the user performs; on Chrome it never happens and the
    // lock stays, which is correct there.
    document.documentElement.style.overscrollBehaviorY = 'none'

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
      // The named node may hold the mesh itself or carry it as a child — a
      // quantised glb parks the de-quantisation on a `__qmesh` wrapper so that
      // `riders.ts` and `cards.ts` can keep overwriting the rig node's TRS.
      // `eyeSocket.ts` has always resolved its mesh this way; this used to cast
      // the node straight to `Mesh` and would have set `.material` on a node
      // that has none, losing the eye shader with no error at all.
      const node = model.getObjectByName(s.mesh)
      let mesh: Mesh | undefined
      node?.traverse((o) => {
        const m = o as Mesh
        if (!mesh && m.isMesh) mesh = m
      })
      if (!mesh) throw new Error(`decke eyes: mesh "${s.mesh}" missing from the glb`)
      const mat = createEyeMaterial({
        side: s.side,
        atlas,
        spinPhaseDeg: this.doc.symbol_atlas.spin_phase_deg[s.side],
      })
      mesh.material = mat
      // `eye` is the NODE, not the mesh, and the distinction is load-bearing:
      // it feeds `uEyeObjectInverse`, which the shader uses as `mat3(...)` to
      // carry the view direction into the eye's object space. A `__qmesh`
      // wrapper carries the de-quantisation SCALE, so passing the mesh would
      // fold that scale into the parallax basis and sink every eye feature to
      // the wrong depth. The node is the same object the unquantised glb gave.
      this.eyes.push({ mat, ctrls: { eye: node ?? mesh, ...s.ctrls } })
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

  /**
   * Roughly where he is on screen, in viewport pixels.
   *
   * For callers that need to position DOM beside him — the speech bubble, today.
   * Deliberately APPROXIMATE and deliberately cheap: it projects his anchor and
   * the top of his reference body, and takes `BODY_W` as the width. It is not
   * his silhouette, which is a good deal larger once the bolts, the open lid and
   * the deformation field are counted, and which would cost a per-frame bounds
   * computation over every mesh to know exactly.
   *
   * That is the right trade here. A bubble placed against a box that is a little
   * smaller than he is sits slightly closer to him than intended; a bubble that
   * cost a full scene traversal every frame would be a real regression in the
   * render loop for a few pixels of placement.
   *
   * Returns null while he has no resolved position — before the model loads.
   */
  screenRect(): { left: number; top: number; right: number; bottom: number; width: number; height: number } | null {
    if (!this.rig) return null
    const cam = this.stage.camera
    const base = this.track ? this.flightSample.pos : this.anchor
    // ── THE FRAME, WHICH THIS GOT WRONG FOR ITS WHOLE LIFE ──────────────────
    //
    // `base` is a BLENDER-frame vector — `anchor` comes from `solvePark`'s
    // `viewportToBlender`, and `flightSample.pos` from a solver whose own header
    // says "`a` and `b` are in the BLENDER frame" — and `bodySpan` extends it
    // along Blender's +Z, which is up. The camera is three.js. Projecting the
    // raw vector therefore treats his UP as the camera's DEPTH.
    //
    // Measured against his silhouette read off the canvas alpha: this reported a
    // 37x51 box for a character actually drawn 167x214, about 90px from where he
    // is. The comment below calls the WIDTH an approximation and that part is
    // true; the frame was not an approximation, it was a bug, and it reached two
    // real callers — the speech bubble's placement, and `himX` in `uiTools`,
    // which decides whether a hop goes the long way round via the background.
    const toScreen = (v: Vector3) => {
      const p = blenderToThree(v.x, v.y, v.z, _proj).project(cam)
      return {
        x: ((p.x + 1) / 2) * viewWidth(),
        y: ((1 - p.y) / 2) * canvasHeight(),
      }
    }
    // MEASURED AT HIS CURRENT ENTRANCE SCALE, not at his nominal size. The
    // bubble is placed against this box, and during the grow a box the size of a
    // character who is not there yet puts it well off him. At scale 1 the span
    // is exactly `base` to `base + BODY_H`, as it always was.
    bodySpan(base, this.entryNow, _feet, _head)
    const feet = toScreen(_feet)
    const head = toScreen(_head)
    const height = Math.abs(feet.y - head.y)
    // Width from the same projection ratio rather than a second unproject: his
    // reference body is 1.75 wide against 2.4 tall, and at this distance the
    // perspective difference across that span is smaller than the approximation
    // already accepted above.
    const width = height * (BODY_W / BODY_H)
    const top = Math.min(feet.y, head.y)
    const left = feet.x - width / 2
    return { left, top, right: left + width, bottom: top + height, width, height }
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
      /**
       * The depth plane he is STANDING ON — `background` is a third his size,
       * on the far plane, which is where a presentation parks him.
       *
       * Published because a caller that flies him somewhere else has to be able
       * to keep it. `flyTo` defaults `depth` to `foreground`, so the dismissal
       * — which omitted it — was flying him from the far plane to the near one
       * on his way into the chip. Measured on the return leg: his drawn height
       * went 43.3 px to 62.9, a 45% SWELL, before the `scaleTo: 0` shrink took
       * him down. The chat-exit contract says in as many words that he "never
       * grows during the trip", and that is the number that broke it.
       */
      depth: this.station.kind === 'element' ? this.station.depth : ('foreground' as const),
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
  /**
   * Start easing the modulation toward whatever the next frame asks for, from
   * wherever it actually is now.
   *
   * Separate from `blendFrom` because the two things that change modulation do
   * not both go through a state change: a flight damps the hover to 0.5 without
   * entering anything. Same treatment either way — snapshot the live value, not
   * the outgoing clip's nominal one, so interrupting a ramp continues from
   * mid-ramp instead of restarting.
   */
  private rampMod(ms: number) {
    if (ms <= 0) {
      this.modFrom = null
      return
    }
    this.modFrom = { ...this.modNow }
    this.modStart = this.elapsed
    this.modMs = ms
  }

  private blendFrom(ms: number) {
    // The modulation rides the pose crossfade: a state that snaps its pose
    // (`confused`, `frustrated`, `embarrassed`, every `alert_`) is meant to
    // arrive as a cut, and easing its hover in behind the cut would be a
    // different kind of wrong.
    this.rampMod(ms)
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

  /**
   * Tell him the reader's motion preference has changed.
   *
   * Live rather than construction-only because `matchMedia` fires: a reader can
   * turn reduced motion on with the page open, and a character who keeps flying
   * until the next reload has not honoured it. Turning it ON does not cancel a
   * flight already in the air — that would be a jump cut mid-motion, which is
   * the one thing worse than the motion — it applies from the next one.
   */
  setReducedMotion(on: boolean) {
    this.reduced = on
  }

  get reducedMotion(): boolean {
    return this.reduced
  }

  /**
   * Change the keep-out bands while running, and re-park him for them.
   *
   * THE HOST HAS TO CALL THIS, and not just pass the option: the header is 64 px
   * on a phone and 78 on a desktop, the composer band exists only while the chat
   * is open, and both change under a running page. It belongs in the same
   * `measure()` the `ResizeObserver` already drives — one number that moved is
   * one re-park, and the change check below is what keeps the other ninety-nine
   * fires free.
   *
   * A SNAP, NOT A FLIGHT. The region changing is the same kind of event as a
   * resize's `home` branch: nothing about the page moved relative to itself, the
   * frame around it changed, and flying across the screen to say so would read
   * as him reacting to a keyboard opening. `unpin` first for the reason every
   * other re-solve does it — a pinned canvas carries an off-axis frustum, and
   * the bands are viewport-space.
   */
  setKeepOut(region: Partial<KeepOut> | null) {
    // The module-level setter in `dom.ts`, aliased on import so this line does
    // not read like a recursive call.
    if (!setKeepOutRegion(region)) return
    this.unpin()
    this.stationDirty = true
  }

  /**
   * How tall he is on screen, in CSS pixels — the dolly, WITH the re-solve it
   * was always missing.
   *
   * `Stage.setCharacterHeight` moves the CAMERA (see `stage.ts` — the height
   * is in the dolly's denominator), which changes the pixel-to-world mapping
   * for the whole scene. His station is a fixed world-space point, so moving
   * the camera without re-solving it renders the same point at a different
   * screen position and a different apparent size — the measured "he's
   * suddenly massive / he snapped off-screen" pair. Callers used to reach
   * through `decke.stage` and the invariant was enforced by hand-ordering at
   * every call site; this method IS the invariant. Same shape as `setKeepOut`:
   * unpin (a pinned rect was captured under the old distance and cannot
   * self-correct), mark the station dirty, and `syncStation` re-solves at the
   * top of the next `update`, before anything is drawn — same-frame, no seam.
   * A flight in the air is corrected too: `syncStation` measures the shift
   * against `trackDest` and ramps it in with the flight's own progress.
   *
   * A CALL THAT CHANGES NOTHING DOES NOTHING. `resize` has always had that
   * guard (`if (width === this.viewW …) return`) and this did not, which is a
   * real cost rather than a tidiness point: `measure()` runs on every
   * ResizeObserver fire and on every settled composer move, and most of those
   * arrive at the height he already has — but the unpin and the dirty flag
   * were paid anyway, dropping a page pin and re-solving a station that had no
   * reason to move. Both are visible whenever the re-solve lands fractionally
   * away from where he is already standing.
   */
  setCharacterHeight(px: number | null) {
    if (px === this.characterHeightPx) return
    this.characterHeightPx = px
    this.stage.setCharacterHeight(px)
    this.unpin()
    this.stationDirty = true
  }

  /**
   * The height last applied, so the guard above has something to compare
   * against. `Stage` keeps its own copy for the dolly; this one exists because
   * a getter through `this.stage` would be a second reader of a private the
   * stage does not publish.
   */
  private characterHeightPx: number | null = null

  /**
   * "The page is being held still — stop chasing its scroll offset."
   *
   * Called by whatever is holding the document (today: the chat panel, for as
   * long as it is open). See `followElastic` for what goes wrong without it: a
   * held page still gets scrolled by iOS to reveal a focused input, and every
   * pixel of that scroll reads as a rubber band that does not exist.
   *
   * A flag rather than a teardown because the hold is temporary and the bounce
   * is a real feature the rest of the time — this suspends the follow, it does
   * not remove it.
   */
  holdElastic(held: boolean) {
    this.elasticHeld = held
  }

  /**
   * Let go of the page — WITHOUT going anywhere.
   *
   * Whoever is about to freeze the document has to get his canvas out of
   * DOCUMENT space first, because `pageAnchor` parks it at an absolute offset
   * that the freeze and the later restore both move underneath it. The chat
   * panel used to do that by calling `returnHome()`, which does release the pin
   * — on its way to LAUNCHING A FLIGHT to the abstract home corner.
   *
   * That flight was the problem. `DeckeHost` decides where he stands and parks
   * him on exactly the same edges the panel runs on (open, and every return
   * from a presentation), so both fired in one commit and the second one
   * replaced the first mid-air. A leg abandoned in its deceleration and
   * re-opened toward somewhere else is precisely "he makes to stop right here,
   * before then continuing to where he's supposed to go" — reported on the tape
   * as happening on nearly every hop, and it is also how he ends up shrinking
   * into a spot well above the launcher instead of into it, because
   * `returnHome` clears `flightScale` and the dive's shrink freezes wherever it
   * had got to.
   *
   * So: the narrow call, for the narrow reason. The station is left alone; it
   * is solved from a `getBoundingClientRect`, which is viewport-relative and
   * stays true whether or not the document is held.
   */
  releasePin() {
    this.unpin()
  }

  /**
   * "The thing you are standing beside — or flying toward — has moved. Look
   * again."
   *
   * The engine re-solves a station on its own for the events it can see: a
   * scroll, a resize, a keep-out change, a dolly. It cannot see a PANEL
   * ANIMATING, because that moves an element without any of those firing — and
   * the entrance needs exactly that. The chip-to-composer leg is launched while
   * the chat panel is still playing its own entrance, so that the grow and the
   * hop overlap; the composer is then a hundred pixels from where it will end
   * up, and something has to keep pointing him at it.
   *
   * `syncStation` has always known how to steer a leg already in the air — it
   * differences the new destination against `trackDest` and ramps the shift in
   * with the flight's own progress, so the correction arrives as part of the arc
   * rather than as a second hop. This is the switch that lets a caller who KNOWS
   * something moved say so, which is what makes launching the leg early safe.
   * Cheap: one `querySelector` and a solve on the next frame, and nothing at all
   * if the station is `home`.
   */
  restation() {
    this.stationDirty = true
  }

  /** The live entrance scale on the rig root. 1 unless a `playEntry` is running
   *  or a caller has pinned it. See `entry.ts`. */
  get entryScale(): number {
    return this.entryNow
  }

  /**
   * Mirror "is he actually on screen" onto the canvas as `data-decke-present`.
   *
   * He is mounted and rendering on every page since the warm moved off hover,
   * at `entryScale` 0 — a third of a pixel tall, drawing nothing, until
   * `playEntry` brings him. So a visible CANVAS stopped being the same question
   * as a visible CHARACTER, and the "two Deck-Es" probe in
   * `scripts/visual-harness/capture-decke.mjs` was asking the first one.
   *
   * That probe can read `__decke.entryScale` in dev, and `__decke` is stripped
   * from production — which left it reporting the defect on every production
   * run. A harness that cries wolf is a harness people stop reading, so the
   * invariant gets a signal that ships: one attribute, written only when the
   * answer changes, so it costs nothing per frame.
   */
  private presentBit: boolean | null = null

  private markPresence(): void {
    const present = this.entryNow > 0.01
    if (present === this.presentBit) return
    this.presentBit = present
    try {
      this.opts.canvas.dataset.deckePresent = present ? '1' : '0'
    } catch {
      /* A detached canvas during teardown is not worth taking a frame down for. */
    }
  }

  /**
   * Pin the entrance scale, with no animation.
   *
   * For the frames BEFORE the entrance: the host places him at the launcher's
   * rect and holds him at 0 so that "absent" is really absent rather than a
   * full-sized character behind an opacity ramp. Also the way out of an
   * entrance that has to be abandoned.
   */
  setEntryScale(s: number) {
    this.entryTween = null
    this.flightScale = null
    this.entryNow = clampEntryScale(s)
  }

  /**
   * Grow him from nothing to full size, where he stands.
   *
   * The entrance beat of C3: absent -> grows at the launcher's rect -> travels
   * to his stand point. This is the middle third; the placement before it and
   * the `flyTo` after it are the caller's, because only the caller knows the
   * button's rect and the mark he is heading for.
   *
   * Returns the number of milliseconds it will take, so a caller can schedule
   * the travel leg without duplicating the constant. Under reduced motion that
   * is 0 and he is simply there — presence without the entrance, which is the
   * reduced form of this beat rather than its absence.
   */
  playEntry(
    opts: {
      from?: number
      /** Where the tween ends. Defaults to 1 — the entrance. `0` is the exit,
       *  clamped to `ENTRY_MIN` like every other scale the rig is handed. */
      to?: number
      durationMs?: number
      instant?: boolean
      onDone?: () => void
    } = {},
  ): number {
    const instant = opts.instant ?? this.reduced
    const to = clampEntryScale(opts.to ?? 1)
    this.flightScale = null
    if (instant) {
      this.entryTween = null
      this.entryNow = to
      opts.onDone?.()
      return 0
    }
    const durationMs = Math.max(0, opts.durationMs ?? ENTRY_MS)
    const from = Math.min(1, clampEntryScale(opts.from ?? 0))
    if (durationMs === 0) {
      this.entryTween = null
      this.entryNow = to
      opts.onDone?.()
      return 0
    }
    this.entryNow = from
    this.entryTween = { from, to, started: this.elapsed, durationMs, onDone: opts.onDone }
    return durationMs
  }

  /**
   * `facing` is continuous over [-1, +1]. Animated over `turnMs`, which
   * defaults to `FACING_TURN_MS`.
   *
   * ASKING FOR THE TURN HE IS ALREADY MAKING IS NOT A NEW TURN. Every caller
   * that re-solves his station also re-asserts his facing, and several of them
   * run on a timer — so without this guard a turn is restarted from wherever it
   * had got to, over and over, and the result is the yaw judder the review
   * describes as "an odd little shift back and forth on his yaw axis". The
   * comparison is against the TARGET, not the current value: mid-turn, `facing`
   * is somewhere between the two and would never match.
   *
   * `turnMs` exists because a fixed 495 ms outlasts a short hop. See `flyTo`.
   */
  setFacing(value: number, opts: { animate?: boolean; turnMs?: number } = {}) {
    const v = Math.max(-1, Math.min(1, value))
    if (opts.animate === false) {
      this.facing = v
      this.facingFrom = v
      this.facingTarget = v
      this.facingT = 1
      this.facingMs = FACING_TURN_MS
      return
    }
    if (v === this.facingTarget) return
    this.facingFrom = this.facing
    this.facingTarget = v
    this.facingT = 0
    this.facingMs = Math.max(FACING_TURN_MIN_MS, opts.turnMs ?? FACING_TURN_MS)
  }

  /**
   * How long the turn in progress takes, in ms.
   *
   * A FIELD, not the constant, because a turn taken as part of a flight has to
   * be over when the flight is — the review's "after arriving in the right spot
   * he does an unnecessary turn/adjustment that feels like a flinch". The
   * shipped short hop is 303-385 ms and the nudge 242-313 ms (`flight.ts`),
   * all of them under the 495 ms this used to always take, so the last stretch
   * of every short leg's turn played out after he had already landed.
   */
  private facingMs = FACING_TURN_MS

  /**
   * Fly to a spot beside a DOM element (or a viewport coordinate).
   *
   * He parks BESIDE the target, never on it, and turns to face inward — the
   * whole point is that he presents the thing rather than obscuring it.
   */
  flyTo(target: FlyTarget, opts: FlyOptions = {}) {
    // BEFORE THE SOLVE, and this is not tidiness. While he is pinned the camera
    // carries an off-axis frustum worth the distance scrolled since he parked,
    // and `parkBeside` unprojects through whatever frustum it is handed — so
    // solving first aims the flight at a spot exactly `drift` pixels wrong.
    // `launch` unpins too, but it runs after the destination has been computed,
    // which is what made this look like: "sometimes when I change where he is on
    // the screen, he will go to the wrong place, and then as soon as I scroll a
    // little bit he snaps to the right place." The snap was the next scroll
    // re-solving him correctly. It only happened after scrolling first, because
    // an unscrolled pin has a zero offset and hides the bug.
    this.unpin()
    const depth = opts.depth ?? 'foreground'
    const side = opts.side ?? 'auto'
    const rect = resolveRect(target)
    if (!rect) throw new Error('decke: flyTo target did not resolve to an element')

    const camera = this.stage.camera
    const baseDistance = camera.position.length()
    const park = solvePark(camera, rect, {
      depth,
      side,
      baseDistance,
      centre: opts.centre,
      anchor: opts.anchor,
    })

    // SCROLL INTENT, computed before the launch that consumes it.
    //
    // Only when the destination is actually out of comfortable view: a target
    // already on screen needs no scroll, and driving one anyway makes a short
    // hop lurch. `scrollToCentre` clamps to the document's own range, so a
    // target near the top or bottom simply gets as centred as it can.
    if (opts.scrollWith) {
      const cy = rect.top + rect.height / 2
      const h = window.innerHeight
      const offscreen = cy < h * 0.2 || cy > h * 0.8
      this.pendingScroll = offscreen ? scrollToCentre(cy, scrollableAncestor(document.body)) : null
    }

    // THE SCALE RIDES THE FLIGHT. Decided before the launch so an instant
    // flight can arrive already at the asked-for scale, and cleared of any
    // clock-driven tween so there is exactly one writer of `entryNow` at a
    // time. See `flightScale`.
    const instant = opts.instant ?? this.reduced
    this.legRate = opts.rate ?? 1
    if (opts.scaleTo !== undefined) {
      if (instant) {
        this.setEntryScale(opts.scaleTo)
      } else {
        this.entryTween = null
        this.flightScale = { from: this.entryNow, to: clampEntryScale(opts.scaleTo) }
      }
    } else {
      this.flightScale = null
    }

    // VIA THE BACKGROUND: queue the destination, fly the waypoint first. The
    // waypoint is directly above the destination's column on the far plane, so
    // the second leg comes straight in rather than crossing twice.
    if (opts.via === 'background') {
      const waypoint = parkOn(
        camera,
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
        { depth: 'background', baseDistance },
      )
      this.legQueue = [park.position.clone()]
      this.launch(waypoint, instant)
    } else {
      this.legQueue.length = 0
      this.launch(park.position, instant)
    }
    // Hold facing steady for the duration of a presentation; turning mid-flight
    // fights the flight layer's own yaw. `park.facing` is always +/-1, so he
    // lands on one of his two authored directions rather than somewhere in
    // between — "he should still have his standard directions, so either this or
    // this."
    // A centre park returns no facing — a point has no inward — so the CALLER's
    // facing is used if it gave one, and only failing that is his current
    // heading re-asserted. Without `opts.facing` that fallback is how a fresh
    // page ends up standing him at the composer with his back to it: the boot
    // default is +1, screen-left. See `FlyOptions.facing`.
    //
    // AND IT IS OVER WHEN THE FLIGHT IS. The turn's own 495 ms is longer than
    // every short leg the flight solver produces, so a nudge or a short hop
    // used to land and then keep turning for another 100-250 ms — read back on
    // the tape as "after arriving in the right spot he does an unnecessary
    // turn/adjustment that feels like a flinch". `this.track` was set by the
    // `launch` above, so its solved duration is available here; a leg longer
    // than the default keeps the default rather than being slowed to match.
    const legMs = this.track?.durationMs
    this.setFacing(opts.facing ?? park.facing ?? this.facingTarget, {
      turnMs: legMs !== undefined ? Math.min(FACING_TURN_MS, legMs) : undefined,
    })
    this.station = { kind: 'element', target, depth, side, centre: !!opts.centre, anchor: opts.anchor }

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
    const arrived = opts.arrived
    // A flight still in the air is being replaced RIGHT NOW — tell its caller,
    // as an abort, before installing the new arrival. Silence here is how the
    // host lost its own "scale him away when he lands" and left a full-size
    // character parked over the page.
    this.fireOnArrive(true)
    this.onArrive = (aborted) => {
      if (aborted) {
        arrived?.(true)
        return
      }
      if (ring && selector) highlightElement(selector)
      if (then) this.setState(then)
      // LAST, so the caller's callback sees the ring raised and the state
      // entered rather than racing them — and so a throw in a caller's
      // callback cannot swallow the two things the flight itself promised.
      arrived?.(false)
    }
    // A cut has already put him there; this is where it becomes an ARRIVAL.
    // Last, so `onArrive` above exists to be fired.
    this.settleCut()
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

  returnHome(opts: { instant?: boolean } = {}) {
    // Same trap as `flyTo`: `homeCorner` unprojects through the camera, and it
    // is evaluated as an ARGUMENT to `launch` — so the pin's frustum offset is
    // still in place when it runs, however early `launch` unpins.
    this.unpin()
    this.station = { kind: 'home' }
    // The trip home replaces whatever flight was pending, and its caller is
    // TOLD — an abort, not a silence. See `fireOnArrive`.
    this.fireOnArrive(true)
    this.flightScale = null
    this.legRate = 1
    clearHighlight()
    this.launch(
      homeCorner(this.stage.camera, this.stage.camera.position.length()),
      opts.instant ?? this.reduced,
    )
    // Nothing to fire — the trip home rings nothing and enters nothing — but the
    // flag still has to be cleared, or the next flight would inherit it.
    this.settleCut()
  }

  /**
   * Re-solve the current station, in the Blender frame.
   *
   * Returns null when an element station no longer resolves — the element was
   * removed, or is not laid out yet. Staying where he is beats teleporting to
   * the origin, which is what a null-means-zero reading would do.
   */
  private solveStation(known?: RectLike): { position: Vector3; facing?: number } | null {
    const camera = this.stage.camera
    const baseDistance = camera.position.length()
    if (this.station.kind === 'home') {
      // Home is VIEWPORT-relative, so scrolling does not move it and must not:
      // at home he is page chrome rather than an annotation on the content.
      return { position: homeCorner(camera, baseDistance) }
    }
    // `known` is a rect the caller already has, which while pinned is a rect
    // nobody had to force a layout to get. See `syncPinned`.
    const rect = known ?? resolveRect(this.station.target)
    if (!rect) return null
    // THE SAME SOLVE `flyTo` USED TO GET HERE — literally the same function, so
    // a re-solve reproduces the launch rather than quietly replacing it with a
    // different intent. See `solvePark`.
    return solvePark(camera, rect, {
      depth: this.station.depth,
      side: this.station.side,
      baseDistance,
      centre: this.station.centre,
      anchor: this.station.anchor,
      // `known` is the PINNED rect, which is in canvas coordinates, and the
      // keep-out bands are in viewport ones. Everything else in the solve
      // cancels the difference against the frustum offset; a clamp cannot,
      // because a clamp is not linear. See `clampY`.
      //
      // `-driftPx` AND NOT `pinShift`: the canvas is pinned to the PAGE, so its
      // top edge sits at `-driftPx` in the viewport and that number moves with
      // every scrolled pixel. `pinShift` is only where it started, and the two
      // agree on exactly one frame — the pin itself, where `drift` is `-shift`.
      // This is the same conversion the beacon makes to find his screen Y.
      shift: known ? -this.driftPx : 0,
      // NOT WHILE TRACKING A SCROLL. `known` is set by exactly one caller —
      // `syncPinned`, which runs every frame he is pinned and whose whole job
      // is to follow an element the reader is moving. Clamping there would hold
      // him at the keep-out band for ever, so he could never leave the viewport
      // — and the off-screen beacon exists precisely because he can. It would
      // have become unreachable code with nothing failing to say so.
      clamp: !known,
    })
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
  /**
   * Ride the rubber band, where there is one to ride.
   *
   * Applied as a TRANSFORM on the overlays rather than by moving him in world
   * space, for two reasons. It is what the compositor is already doing to the
   * page — so the character, the highlight ring and the content all take the
   * same translation and cannot disagree — and it is a composited property, so
   * it costs no layout and does not re-render the WebGL scene at the exact
   * moment the main thread is busiest.
   */
  private followElastic() {
    // ── WHILE THE PAGE IS HELD THERE IS NO BOUNCE TO RIDE ─────────────────────
    //
    // MEASURED ON A REAL iPhone, chat open, tapping the composer: iOS reveals a
    // focused input by scrolling the document — and it does this even when the
    // page is held and there is no scroll range to scroll through, so `scrollY`
    // goes positive against a `maxScroll` of 0. `elasticOffset` then reports
    // every pixel of it as a rubber band, and the line below translates his
    // whole canvas up by that much. He leaves the top of the screen while the
    // panel he is standing on stays exactly where it should be:
    //
    //   "Deck-E disappears, and then if I scroll up a little he comes back into
    //    view... he scrolls at a faster rate than the rest of the page."
    //
    // Twice the rate, because the page moved once and he moved with it and then
    // again by the same amount. The holder tells him when the page is held, and
    // a held page cannot bounce, so there is nothing to follow.
    if (this.elasticHeld) {
      if (this.elasticNow !== 0) {
        this.elasticNow = 0
        this.opts.canvas.style.transform = ''
        setHighlightShift(0)
      }
      return
    }
    const e = elasticOffset()
    if (e !== 0 && !this.reportsElastic) {
      // Evidence beats the default. This engine reports the bounce, so it can be
      // followed, so it does not need to be suppressed.
      this.reportsElastic = true
      document.documentElement.style.overscrollBehaviorY = this.overscrollWas
    }
    if (e === this.elasticNow) return
    this.elasticNow = e
    this.opts.canvas.style.transform = e === 0 ? '' : `translate3d(0, ${-e}px, 0)`
    setHighlightShift(-e)
  }

  /**
   * Decide, once per frame, whether the overlays should be riding the page or
   * the viewport.
   *
   * Called AFTER `updateBeacon`, and that ordering is the whole safety argument.
   * The chip is drawn into the canvas at viewport coordinates, so the canvas
   * must be pinned to the viewport on every frame the chip exists; asking the
   * beacon what it decided — rather than re-deriving it here — makes the two
   * decisions the same decision, and there is no frame where they can disagree.
   */
  private repin() {
    if (this.beacon !== null) {
      // He has left the screen entirely, which is exactly when the chip needs a
      // canvas that is still over the viewport.
      this.unpin()
      return
    }
    if (this.pinnedAt !== null || !this.canPin() || !this.pinEl) return
    const rect = this.pinEl.getBoundingClientRect()
    const y = window.scrollY
    const shift = this.pinShift
    this.pinnedAt = y + shift
    this.pinnedBox.x = rect.left + window.scrollX
    this.pinnedBox.y = rect.top + y
    this.pinnedBox.w = rect.width
    this.pinnedBox.h = rect.height
    // In CANVAS coordinates, which are the viewport's slid by `shift`.
    this.pinnedRect.left = rect.left
    this.pinnedRect.top = rect.top - shift
    this.pinnedRect.right = rect.right
    this.pinnedRect.width = rect.width
    this.pinnedRect.height = rect.height
    this.pinCheckAt = this.elapsed
    this.pinStale = false
    if (typeof ResizeObserver !== 'undefined') {
      this.pinWatch = new ResizeObserver(() => {
        this.pinStale = true
      })
      // The element for its own box, the document for everything that moves the
      // element without resizing it — content loading in above it being the case
      // that actually happens.
      this.pinWatch.observe(this.pinEl)
      this.pinWatch.observe(document.documentElement)
    }
    pinToPage(this.opts.canvas, this.pinnedAt)
    setHighlightAnchor(this.pinnedAt, this.pinEl)
    // The canvas has just moved by `shift`, so the frustum has to move with it
    // in the same frame or the switch is a jump. A pin aligned with the viewport
    // is the `shift === 0` case of the same line, not a separate path.
    this.applyDrift(-shift)
  }

  /**
   * Put the frustum where the reader's screen is, and re-solve him for it.
   *
   * Shared by the pin itself and by every frame that scrolls afterwards, because
   * they are the same operation: the canvas is somewhere other than the viewport
   * by `drift` pixels, and the camera has to say so.
   */
  private applyDrift(drift: number) {
    this.driftPx = drift
    this.stage.setViewShift(drift)
    // AFTER the offset, and that ordering is the whole correctness argument.
    // `viewportToBlender` inverts through the camera's CURRENT projection, so
    // solving first would place him for the old frustum and the new one would
    // then shift him again — a double compensation that reads as him sliding
    // off the element by exactly the distance scrolled. Measured at 390x780
    // before this was reordered: track error -40 px at 120 px of scroll, -120
    // at 240, which is one frame's drift every time.
    const park = this.solveStation(this.pinnedRect)
    if (park) {
      this.anchor.copy(park.position)
      if (park.facing !== undefined && park.facing !== this.facingTarget) {
        this.setFacing(park.facing)
      }
    }
  }

  /**
   * Is this a park the compositor can be trusted with?
   *
   * Every clause is a way the answer "his document position is constant" stops
   * being true, and each of them was cheaper to enumerate than to debug.
   */
  private canPin(): boolean {
    this.pinEl = null
    if (this.station.kind !== 'element') return false
    // HOME IS VIEWPORT-RELATIVE and so is a raw `{x, y}` or `{rect}` target: the
    // caller named a place on the screen, not a place in the page, and pinning
    // one would send him scrolling away from the spot he was asked to hold.
    // Only a selector names something the page owns.
    if (!('selector' in this.station.target)) return false
    // A flight is a world-space move every frame, so there is nothing constant
    // to freeze yet. They are short; he pins when he lands.
    if (this.track || this.elasticNow !== 0) return false
    if (this.screenBehind) return false
    const el = document.querySelector(this.station.target.selector)
    // AN INNER SCROLLER MOVES ITS CONTENT WITHOUT MOVING THE DOCUMENT, so an
    // element inside one has a document position that is emphatically not
    // constant. The character's scroll listener is capture-phase precisely so
    // these still drag him along; they keep the hand-tracked path.
    if (!el || scrollableAncestor(el)) return false
    // AND AN ELEMENT THAT HOLDS STILL IN THE WINDOW rather than in the page is
    // the same problem by a different route. See `ridesThePage`.
    if (!ridesThePage(el)) return false
    // THE CANVAS HAS TO CONTAIN HIM. It does not have to line up with the
    // viewport, and assuming it did is what made him judder on the way in.
    //
    // The canvas is one viewport tall and draws nothing outside itself, so a
    // character half over the top edge is half clipped. The first version
    // therefore refused to pin until his whole silhouette was comfortably inside
    // the VIEWPORT — which meant his entire entrance, a full body height of
    // scrolling at each end, ran on the hand-tracked path. Reviewed as: "there
    // is still judder specifically when the character is entering the visible
    // viewport, both coming into the top and coming into the bottom."
    //
    // But the canvas is only pinned to a document offset, and nothing says that
    // offset has to be the current scroll position. Slide it off the viewport by
    // `pinShift` and it still covers him while he is half on screen; the part
    // hanging past the edge simply is not seen. The frustum offset that already
    // carries the drift carries this too, so it costs no new machinery — see
    // `syncPinned`.
    const shift = this.idealShift()
    if (shift === null) return false
    this.pinShift = shift
    this.pinEl = el
    return true
  }

  /**
   * Where the canvas's top edge wants to be, or null if there is nowhere legal.
   * The geometry lives in `pageAnchor.ts`, where it is a pure function and the
   * tests can reach the real one instead of a copy of it.
   */
  private idealShift(): number | null {
    return pinWindow({
      screenY: this.screenY,
      halfPx: this.screenHalf,
      canvasH: canvasHeight(),
      // Cached on a TTL — see `documentHeight`. Reading `scrollHeight` here
      // per frame would put back a forced layout on exactly the path that
      // exists to have none.
      roomBelow: documentHeight() - canvasHeight() - window.scrollY,
    })
  }

  private unpin() {
    if (this.pinnedAt === null) return
    this.pinnedAt = null
    this.driftPx = 0
    this.pinWatch?.disconnect()
    this.pinWatch = null
    this.pinStale = false
    this.pinEl = null
    // Back to no drift — NOT `clearViewOffset`, which would also throw away the
    // shift that makes the frustum cover the taller canvas. See `setViewShift`.
    this.stage.setViewShift(0)
    unpinToViewport(this.opts.canvas)
    setHighlightAnchor(null)
    // Everything inside those layers was solved for where the page was when they
    // were pinned, and they have just been put back on a viewport that has moved
    // since. Re-solve NOW rather than marking it dirty: this runs inside
    // `update`, so a re-solve here is drawn by this frame's render and a deferred
    // one would put a frame of him at the old offset on screen.
    this.stationDirty = true
    this.syncStation()
  }

  /**
   * The pinned frame: everything `syncStation` did, minus the two things that
   * were actually expensive.
   *
   * IT WOULD BE A MISTAKE TO SIMPLY FREEZE HIM, and the first version of this
   * did. Pinning makes his position in the page constant, so it is tempting to
   * stop solving — but his position in the page was never the whole of what the
   * solve produced. The camera is fixed and aimed at the world origin, so how he
   * is SEEN depends on where he sits in the frustum, and that is the vertical
   * parallax the review asked for by name:
   *
   *   "At the top of the page it's like he's above the camera, at the bottom of
   *    the page it's like he's below the camera, in the middle of the page he's
   *    kind of aligned with the camera, on a vertical."
   *
   * Freezing his world position froze that too, and the difference is not
   * subtle: rendered side by side at the same place on screen, the frozen one
   * shows the top of his head where the tracked one is looking up at him from
   * below. See `framing.ts` — the cue is in the frustum, not in the quaternion,
   * which is why nothing about the framing solve catches it.
   *
   * So the world solve stays, at full rate. What goes is the FORCED LAYOUT: the
   * element's viewport rect is its cached document box minus the scroll offset,
   * which is arithmetic. And what the world solve would now do to his position
   * on the canvas is cancelled by an equal offset on the camera, so the canvas
   * picture holds still while the compositor carries the canvas.
   *
   * The division of labour that leaves is the point of the whole change. His
   * POSITION — the thing the eye reads as chunk when it stutters — is moved by
   * the compositor at the display's rate. His PERSPECTIVE — a gradual
   * foreshortening — is updated in here at whatever rate the browser gives us,
   * because nobody has ever seen a foreshortening stutter.
   */
  private syncPinned() {
    // RELAX BACK TO ALIGNED THE MOMENT HE FITS, and this is not tidiness either.
    //
    // The shift is chosen once, at the instant he becomes pinnable — which for a
    // character arriving from the bottom edge is the instant he is MOST
    // constrained, so it lands on the clamp and puts his feet the bare margin
    // from the canvas edge. Nothing revisited it, so that bare margin was
    // permanent: as he scrolled inward the canvas edge rose with him into the
    // middle of the screen and cut him off there, for the whole life of the pin.
    //
    //   "He's still cut off on the bottom. It's whenever he comes in from the
    //    bottom edge. It rectifies itself if I scroll him out of the top edge
    //    and then scroll him back in from the top."
    //
    // Which is the tell: entering from the top lands the shift nowhere near its
    // clamp (measured -277 against a -526 clearance, where the bottom entry got
    // +194 and 32), so the same code looked correct from one direction only.
    //
    // Re-pinning is the ordinary path — `unpin` re-solves him against the live
    // rect and `repin` takes a fresh shift later in the same frame — and it is
    // invisible for the same reason the first pin is. It happens once per
    // entrance, when zero becomes legal.
    if (this.pinShift !== 0 && this.idealShift() === 0) {
      this.unpin()
      return
    }
    const drift = window.scrollY - (this.pinnedAt ?? 0)
    // MOVE THE CAMERA, NOT HIM. The element's position INSIDE the pinned canvas
    // is a constant — both are pinned to the same page — so `pinnedRect` never
    // changes and neither does where he has to be drawn. What changes is where
    // the reader's screen is, and an off-axis frustum is how that is said.
    if (drift !== this.driftPx) this.applyDrift(drift)
    // The observer is the trigger and the interval is the backstop, so the
    // common reflow is corrected on the next frame rather than on the next tick.
    const due = this.pinStale || (this.elapsed - this.pinCheckAt) * 1000 >= PIN_RECHECK_MS
    if (!due) return
    this.pinStale = false
    this.pinCheckAt = this.elapsed
    if (!this.pinEl?.isConnected) {
      this.unpin()
      return
    }
    const rect = this.pinEl.getBoundingClientRect()
    const b = this.pinnedBox
    const moved =
      Math.abs(rect.left + window.scrollX - b.x) > 0.5 ||
      Math.abs(rect.top + window.scrollY - b.y) > 0.5 ||
      Math.abs(rect.width - b.w) > 0.5 ||
      Math.abs(rect.height - b.h) > 0.5
    // Unpin rather than adjust in place. `unpin` re-solves him against the live
    // rect, and `repin` runs later in the same frame and pins again from the new
    // one — so the correction takes the ordinary path, and there is no second
    // implementation of it to keep in step with the first.
    if (moved) this.unpin()
  }

  /**
   * Move the page under him, and stop the moment the reader disagrees.
   *
   * The eased position is written every frame from the flight's own progress,
   * so the scroll and the character share one clock — which is what makes the
   * page appear to move BECAUSE he is moving, rather than alongside him.
   *
   * THE CANCEL IS THE IMPORTANT HALF. Between frames, `window.scrollY` should
   * equal what this last wrote; anything else is the reader's wheel, their
   * trackpad, or a keyboard, and a driven scroll that fights them is worse than
   * none. `DeckE.scrollIntoView` uses native smooth scrolling for exactly this
   * reason, and it is not available here because a native scroll cannot be
   * slaved to a flight's progress.
   */
  private driveScroll(t: number) {
    const d = this.scrollDrive
    if (!d) return
    if (Math.abs(window.scrollY - d.own) > 2) {
      this.scrollDrive = null
      return
    }
    // Eased on the same curve the flight uses, so neither leads the other.
    const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
    const y = Math.round(d.from + (d.to - d.from) * Math.min(1, Math.max(0, e)))
    d.own = y
    window.scrollTo(0, y)
  }

  /**
   * Re-solve the station, if something has said it moved.
   *
   * A FAILED SOLVE LEAVES THE FLAG UP. `solveStation` returns null when the
   * station's element cannot be measured this instant — a selector that does
   * not resolve mid-commit, a rect of zero while the panel is still laying
   * out — and clearing the flag on that path threw the correction away for
   * good: nothing re-arms it until some unrelated event (a scroll, another
   * resize) happens along, so he stands at a position solved against a camera
   * that has since moved, for as long as that takes. That is the "wrong for
   * ten or twenty seconds, then a hop" half of the size-pop report. Leaving it
   * dirty costs one `querySelector` per frame until the element is measurable,
   * which is the same work the next frame would have done anyway.
   */
  private syncStation() {
    if (!this.stationDirty) return
    const park = this.solveStation()
    if (!park) return
    this.stationDirty = false
    if (this.track) this.trackShift.copy(park.position).sub(this.trackDest)
    this.anchor.copy(park.position)
    // Only when it actually changed: `setFacing` restarts the turn, and calling
    // it every scroll frame would leave him permanently mid-turn.
    if (park.facing !== undefined && park.facing !== this.facingTarget) {
      this.setFacing(park.facing)
    }
  }

  /**
   * Legs still to fly after the current one.
   *
   * A flight is ONE leg — `solveFlight` interpolates a straight line between two
   * points with a lateral bow and a vertical arc, and `onArrive` is a single
   * slot that cannot start another. Anything multi-leg has to be queued, and
   * this is the queue: `launch` shifts the next one when a leg lands, before
   * the arrival callback runs, so `then` fires once at the END of the journey
   * rather than once per leg.
   */
  private legQueue: Vector3[] = []

  /**
   * The page scroll being driven by the current flight, if any.
   *
   * `from`/`to` are absolute scroll offsets; `own` is the last value this code
   * wrote. Anything that moves the scroll away from `own` between frames was
   * the reader, and the drive gives up immediately — see `driveScroll`.
   */
  private scrollDrive: { from: number; to: number; own: number } | null = null
  /** Set by `flyTo` immediately before `launch`, consumed there. */
  private pendingScroll: number | null = null

  private launch(to: Vector3, instant = false) {
    // THE SINGLE CHOKE POINT for every flight, which makes it the right place to
    // give the page back. A flight is a world-space move on every frame, so
    // there is no constant document position left to freeze, and `from` below
    // has to be read in the coordinates he is actually parked in.
    this.unpin()
    if (instant) {
      this.cut(to)
      return
    }
    const from = this.track
      ? this.flightSample.pos.clone()
      : this.anchor.clone()
    const shape = shapeFor(from, to, this.legIndex++)
    const vFov = (this.stage.camera.fov * Math.PI) / 180
    this.track = solveFlight(from, to, {
      camera: this.stage.camera,
      tanHalfFovY: Math.tan(vFov / 2),
      ...shape,
      // Playback speed only — a queued (via-background) leg launched from the
      // arrival branch inherits the same rate, so the whole trip is one pace.
      rate: this.legRate,
    })
    this.trackStart = this.elapsed
    this.rampMod(TRAVEL_MOD_MS)
    // A queued leg inherits the drive already in progress; only a fresh flight
    // starts or clears one, and `flyTo` sets it just before calling in.
    if (!this.legQueue.length && this.pendingScroll === null) this.scrollDrive = null
    if (this.pendingScroll !== null) {
      const from = window.scrollY
      this.scrollDrive =
        Math.abs(this.pendingScroll - from) < 8
          ? null
          : { from, to: this.pendingScroll, own: from }
      this.pendingScroll = null
    }
    this.anchor.copy(to)
    this.trackDest.copy(to)
    this.trackShift.set(0, 0, 0)
  }

  /**
   * ARRIVE WITHOUT TRAVELLING — the whole of the reduced-motion flight path.
   *
   * A "skip the animation" that leaves the flight layer half-set is worse than
   * the animation, so this touches every piece of state a landing normally
   * leaves behind, in the same order `launch` and `update`'s arrival branch
   * leave it:
   *
   *   - `track` null, so `update` takes the PARKED branch and adds the anchor to
   *     the pose rather than sampling a stale sample;
   *   - the LAST leg wins. `flyTo(via: 'background')` queues the destination and
   *     launches the waypoint, so cutting to `to` would land him out on the far
   *     plane above the target, one leg short and with a queue nobody will ever
   *     shift because no leg is going to finish. Cutting is not "fly the first
   *     leg instantly"; it is "be at the end of the journey";
   *   - `anchor` and `trackDest` both moved, so the next scroll's `syncStation`
   *     measures its shift against where he actually is;
   *   - `trackShift` cleared, because a shift accumulated for a flight that no
   *     longer exists would be applied to the next one;
   *   - the driven page scroll JUMPS rather than easing. `scrollWith` exists so
   *     the page moves under him instead of him chasing it; under reduced motion
   *     the page still has to end up where the target is, and a 700 ms eased
   *     scroll is exactly the motion being declined.
   *
   * The modulation is deliberately NOT ramped: `TRAVEL_MOD` damps his hover
   * because he is under power, and he never was.
   */
  private cut(to: Vector3) {
    const dest = this.legQueue.length ? this.legQueue[this.legQueue.length - 1] : to
    this.legQueue.length = 0
    // Cutting ON TOP of a flight already in the air still has to hand the hover
    // back, exactly as a landing does. `TRAVEL_MOD` damps `float_amp` to 0.5
    // while he is under power, and dropping the track without the ramp steps it
    // to 1.0 in one frame — the same class of pop the modulation crossfade
    // exists for. A cut that never travelled has nothing to ramp.
    if (this.track) this.rampMod(TRAVEL_MOD_MS)
    this.track = null
    this.anchor.copy(dest)
    this.trackDest.copy(dest)
    this.trackShift.set(0, 0, 0)
    this.scrollDrive = null
    if (this.pendingScroll !== null) {
      const y = this.pendingScroll
      this.pendingScroll = null
      window.scrollTo(0, y)
    }
    this.cutPending = true
  }

  /**
   * Declare a cut flight arrived.
   *
   * Separate from `cut` because `flyTo` installs `onArrive` AFTER it launches:
   * firing from inside the cut would find an empty slot and drop the ring and
   * the `then` state on the floor. Called by both public entry points once they
   * have finished setting up, and a no-op after an ordinary flight.
   */
  private settleCut() {
    if (!this.cutPending) return
    this.cutPending = false
    this.fireOnArrive(false)
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

  /**
   * Compile every shader program the scene needs BEFORE the first frame tries
   * to draw with them.
   *
   * THIS IS THE SINGLE BIGGEST COST OF PUTTING HIM ON SCREEN, and it is not the
   * download. Measured on an RTX 5080 through ANGLE/D3D11, with the whole
   * payload already in memory:
   *
   *   import the module        84 ms
   *   construct the renderer   40 ms
   *   load() — glb, atlas…     34 ms
   *   HDRI fetch + parse        7 ms
   *   PMREM prefilter         326 ms
   *   FIRST FRAME            6184 ms   <-- all of it shader compilation
   *   second frame              1 ms
   *
   * The scene needs 12 distinct programs (the eye shader, the clearcoated body,
   * the iridescent card fronts, and the morph/non-morph variants of several of
   * those), and `WebGLRenderer` compiles and links each one synchronously the
   * first time it is asked to draw with it. Six seconds of a thread that never
   * yields, which is exactly what "it chugs when I hover" is.
   *
   * `compileAsync` compiles the same programs through
   * `KHR_parallel_shader_compile`, which lets the driver do the work on its own
   * threads while this one keeps answering. Same machine, same scene: **720 ms,
   * with a worst main-thread stall of 16 ms**, and a 53 ms first frame after it.
   *
   * ORDER MATTERS. Call this AFTER `setEnvironment`, never before: an
   * environment map changes the program's define set, so compiling first would
   * compile the wrong variants and every one of them would be compiled again on
   * the first real frame — strictly worse than not calling this at all.
   *
   * Never throws. Where the extension is missing (a software rasteriser, an old
   * driver) this degrades to what happened before — compilation on the first
   * frame — and a failure to PRE-compile must not be a failure to appear.
   */
  async precompile(): Promise<void> {
    try {
      await this.stage.renderer.compileAsync(this.stage.scene, this.stage.camera)
    } catch {
      /* Falls back to compiling on the first frame, as it always did. */
    }
  }

  start() {
    this.clock.start()
    const tick = () => {
      if (this.disposed) return
      this.raf = requestAnimationFrame(tick)
      // Clamp dt so a backgrounded tab cannot hand the integrators a huge step.
      const dt = Math.min(this.clock.getDelta(), 0.1)
      this.frame(dt)
    }
    this.raf = requestAnimationFrame(tick)
  }

  /**
   * Advance and draw exactly one frame, on a caller-supplied clock.
   *
   * `start()` is a rAF loop against wall time, which is right for the product
   * and wrong for any comparison: two controllers in one document get their own
   * `Clock`s and their own `getDelta()`, so they drift apart within a second and
   * every difference you then see between them is timing rather than the thing
   * you were trying to look at.
   *
   * `/dev/decke-compare` drives two controllers from ONE rAF with the same `dt`,
   * which makes their frames identical by construction and any remaining
   * difference attributable to the asset. It is also the supported form of the
   * trick the parity harness has always done by hand — headless Chromium runs
   * rAF at about 1 Hz, so measuring a running loop there measures a still frame,
   * and `README.md` tells you to stop the loop and step it. That advice reached
   * for `elapsed` and `update`, both private; this is the same thing with a door
   * on it.
   *
   * Do not call this while `start()` is running — they would both advance the
   * same integrators.
   */
  step(dt: number) {
    if (this.disposed) return
    this.frame(Math.min(dt, 0.1))
  }

  private frame(dt: number) {
    {
      this.markPresence()
      // What OUR frame actually costs, so a slow character can be told apart
      // from a browser that is not calling us often — on a phone those look
      // identical from the outside and have completely different fixes.
      const t0 = performance.now()
      this.elapsed += dt
      this.update(dt)
      this.stage.renderer.render(this.stage.scene, this.stage.camera)
      // The beacon's window, drawn into the same canvas over the chip. Second
      // pass, same context — see `Stage.renderInset`.
      if (this.beacon) {
        // LEVEL, whatever the page is doing.
        //
        //   "When he's in this little pointer, as we go down you notice that his
        //    angle goes down, and I don't want that to happen when he's in here.
        //    That really only applies to when he's in the DOM... When he's in
        //    here I'd like it to be as though the camera is just on his level.
        //    Vertically centred with him."
        //
        // The chip only exists when he has left the screen, which is exactly
        // when the vertical cue has nothing left to say: it is telling you he is
        // below you, and so is the chip, twice. Re-solving the framing at
        // `pitchFollow = 0` gives the alignment WITHOUT the give-back — the
        // staging elevation, seen along whatever the current line of sight
        // happens to be — so the chip holds the pose the character was authored
        // in. His azimuth and his 3/4 facing are untouched; only the vertical
        // angle is.
        solveFraming(this.stage.camera, this.rootThree, this.framingLevel, 0)
        this.rig.root.position.copy(this.framingLevel.position)
        this.rig.root.quaternion.copy(this.framingLevel.quaternion)
        this.stage.renderInset(
          beaconRect(this.beacon),
          this.centreThree,
          this.model,
          this.restExtent,
        )
        // Back to the on-screen framing. Nothing reads it between here and the
        // next `applyPose`, but leaving the rig in the chip's pose would put a
        // frame of it on screen the moment the beacon stops being drawn.
        this.rig.root.position.copy(this.framing.position)
        this.rig.root.quaternion.copy(this.framing.quaternion)
      }
      this.tickMs = performance.now() - t0
    }
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
    // NDC spans the CANVAS. `viewHeight()` is where he is allowed to stand; this
    // is how many pixels the projection actually covers.
    const h = canvasHeight()
    // PROJECTION ANSWERS IN CANVAS SPACE, and while the overlays are pinned the
    // canvas is not the viewport — it is a rectangle of the page that the reader
    // has scrolled `driftPx` past. Every question below is a question about the
    // viewport ("has he left the screen"), so the drift is taken off here, once,
    // and everything downstream is in the coordinates it thinks it is in.
    const cy = (-this.screen.y * 0.5 + 0.5) * h - this.driftPx
    const cx = (this.screen.x * 0.5 + 0.5) * viewWidth()

    _top.copy(this.centreThree)
    // Scaled by the entrance, for the same reason `screenRect` is: this half
    // -height is his SILHOUETTE, and the chip's whole question is whether any
    // part of him is on screen. His centre is unaffected — the entrance scale
    // pivots about it — so only the span moves.
    _top.y += CENTRE_OFFSET * this.entryNow
    _top.project(cam)
    // A half-height is a difference, so the drift cancels and is not applied.
    const halfPx = Math.abs((-_top.y * 0.5 + 0.5) * h - (cy + this.driftPx))
    this.screenY = cy
    this.screenHalf = halfPx
    this.screenBehind = this.screen.z > 1

    // Behind the camera: `project` flips the sign there, and a character behind
    // you is as absent as one above you. Treat him as past the top rather than
    // reporting a mirrored position.
    const behind = this.screenBehind
    const above = cy + halfPx < 0
    const below = cy - halfPx > h
    const next: Beacon | null =
      behind || above || below
        ? {
            x: Math.min(
              viewWidth() - BEACON.size / 2 - BEACON.sideMargin,
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
    // Viewport coordinates, so the pinned canvas's offset comes off — same
    // reason as in `updateBeacon`. In practice this is reached from the beacon
    // chip, which only exists while unpinned, but the caller is public.
    const cy = (-this.screen.y * 0.5 + 0.5) * canvasHeight() - this.driftPx
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

    // ---- and the CANVAS may have moved ----------------------------------
    //
    // Re-measured only when something that can move it has happened, because
    // `getBoundingClientRect` forces layout and this runs every frame. The
    // dirty flag is set by the same capture-phase `scroll` listener that marks
    // the station dirty, by `visualViewport` resize, and by `resize` — which is
    // the complete list of things that can slide a `fixed` canvas, iOS's
    // reveal-the-focused-input scroll very much included. See `canvasOriginY`.
    if (this.originDirty) {
      this.originDirty = false
      const b = this.opts.canvas.getBoundingClientRect()
      setCanvasOrigin(b.left, b.top)
    }

    // ---- the page may have moved ---------------------------------------
    // Or it may have moved him, which is the cheaper of the two and the one this
    // runtime now aims for. Pinned, the compositor is carrying both overlays and
    // there is nothing to track and no bounce to apply by hand — see `repin` at
    // the end of this method, and `pageAnchor.ts` for why.
    if (this.pinnedAt === null) {
      this.syncStation()
      this.followElastic()
    } else {
      this.syncPinned()
    }

    // ---- the entrance ----------------------------------------------------
    // Advanced from the state clock like everything else in here, so a paused
    // engine pauses the grow too rather than finishing it while nothing is being
    // drawn. `onDone` fires on the frame it lands, once.
    if (this.entryTween) {
      const e = this.entryTween
      const u = ((this.elapsed - e.started) * 1000) / e.durationMs
      if (u >= 1) {
        this.entryNow = clampEntryScale(e.to)
        this.entryTween = null
        e.onDone?.()
      } else {
        this.entryNow = clampEntryScale(entryScaleAt(u, e.from, e.to))
      }
    }

    // ---- facing --------------------------------------------------------
    if (this.facingT < 1) {
      this.facingT = Math.min(1, this.facingT + (dt * 1000) / this.facingMs)
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
    const want = this.track ? TRAVEL_MOD : clip.modulation
    const mod = this.modNow
    if (this.modFrom) {
      const u = ((this.elapsed - this.modStart) * 1000) / this.modMs
      if (u >= 1) {
        this.modFrom = null
        mod.float_amp = want.float_amp
        mod.float_rate = want.float_rate
        mod.blink_rate = want.blink_rate
      } else {
        // The same easeInOutCubic the pose crossfade uses, for the same reason:
        // a linear ramp arrives at full speed, so its far end still reads as
        // the step it was put there to remove.
        const e = u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2
        const f = this.modFrom
        mod.float_amp = f.float_amp + (want.float_amp - f.float_amp) * e
        mod.float_rate = f.float_rate + (want.float_rate - f.float_rate) * e
        mod.blink_rate = f.blink_rate + (want.blink_rate - f.blink_rate) * e
      }
    } else {
      mod.float_amp = want.float_amp
      mod.float_rate = want.float_rate
      mod.blink_rate = want.blink_rate
    }
    // Only a state that has ARRIVED at zero hover is holding still; one still
    // easing down to it is not, and freezing his gaze early would put the two
    // layers back out of step in the other direction.
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
      // THE SCALE RIDES THE FLIGHT — the final leg of it, so a via-background
      // trip shrinks into its destination rather than into its waypoint. The
      // ease is directional: a shrink is cubed toward arrival (he flies most
      // of the way at size and dives into the target), a grow is cubed away
      // from departure (he pops out of the origin and cruises the rest).
      if (this.flightScale && this.legQueue.length === 0) {
        const s = this.flightScale
        const e = s.to < s.from ? u * u * u : 1 - (1 - u) ** 3
        this.entryNow = clampEntryScale(s.from + (s.to - s.from) * e)
      }
      this.driveScroll(tf / this.track.durationMs)
      if (tf >= this.track.durationMs) {
        this.track = null
        // MID-JOURNEY LEGS DO NOT ARRIVE. Only the last one does — `onArrive`
        // rings the target and enters a state, and firing it at a waypoint
        // would have him pointing at nothing from halfway across the page.
        const next = this.legQueue.shift()
        if (next) {
          this.launch(next)
        } else {
          // The exact asked-for scale, not the last sampled one — landing and
          // "at scale" are the same frame by contract.
          if (this.flightScale) {
            this.entryNow = clampEntryScale(this.flightScale.to)
            this.flightScale = null
          }
          this.rampMod(TRAVEL_MOD_MS)
          this.fireOnArrive(false)
        }
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
    // Immediately after the beacon, because it consumes the beacon's own answer
    // rather than a second opinion about where he is. See `repin`.
    this.repin()
    this.stage.setFraming(this.framing.position, this.framing.quaternion, this.framing.yaw)

    // ---- apply ----------------------------------------------------------
    applyPose(this.rig, this.pose, {
      facing: this.facing,
      framing: this.framing,
      scale: this.entryNow,
    })

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

  resize(width: number, height: number, canvasH = height) {
    // THE one place the runtime learns how big the screen is. Everything else
    // asks `viewport.ts`; see the note there for why that matters on a phone.
    setViewport(width, height, canvasH)
    this.originDirty = true
    this.stage.setSize(width, height, canvasH)
    // A resize that did not change anything is not a resize. Safari's toolbars
    // slide away on a fast scroll and slide back when it stops, and each of
    // those fires `resize` — so without this the debounce below re-parks him,
    // which launches a FLIGHT, which is what "he's down lower and then he has to
    // re-travel up to the element, and that shouldn't be happening" was.
    if (width === this.viewW && height === this.viewH && canvasH === this.canvasH) return
    this.viewW = width
    this.viewH = height
    this.canvasH = canvasH
    // A pinned canvas carries an explicit pixel box, measured from the viewport
    // it was pinned against. That viewport is now a different size, so the box
    // is stale — give it back and let `repin` take a fresh one once the re-park
    // below has settled.
    this.unpin()
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
      // AGAIN before the solve. `resize` unpinned him a moment ago, but this is
      // a trailing debounce and `repin` runs every frame — so by the time it
      // fires he has usually pinned again, and `solveStation` would unproject
      // through the pin's frustum. Same trap as `flyTo`, reached down a path
      // that already looked like it had handled it.
      this.unpin()
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
      // A LEG ALREADY IN THE AIR IS STEERED, NOT REPLACED. `launch` throws the
      // current track away and opens a new one with its own anticipation dip —
      // so a resize that lands mid-flight reads as him starting to stop at
      // nowhere in particular and then setting off again, which is "he makes to
      // stop right here before continuing" from the review, reported as
      // happening on nearly every hop. `syncStation` has always steered instead
      // (it differences the new destination against `trackDest` and ramps the
      // shift in with the flight's own progress); this path simply never
      // learned to, and there is no reason for the two to disagree.
      if (this.track) {
        this.stationDirty = true
        this.syncStation()
      } else {
        this.launch(park.position)
      }
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
    document.documentElement.style.overscrollBehaviorY = this.overscrollWas
    // Before `clearHighlight` below, which removes the ring but not the layer:
    // a layer left pinned would sit at a stale document offset for whatever
    // rings something next. Not `unpin()` — that re-solves his station, and this
    // instance is already gone.
    unpinToViewport(this.opts.canvas)
    setHighlightAnchor(null)
    // The observer outlives the controller otherwise: it holds the element, the
    // document element, and a closure over `this`. React 19's StrictMode mounts
    // twice in dev, so a leak here is two of everything on the first load.
    this.pinWatch?.disconnect()
    this.pinWatch = null
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

