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
import { bindRig, applyPose, resolveFacing, type RigNodes } from './rig'
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
  evalState,
  loadPlaybook,
  type CompiledState,
  type PlaybookDoc,
  type Pose,
} from './playbook'
import { createProcedural } from './procedural'
import { DEG, MOUTH } from './constants'
import { sampleTrack, solveFlight, type FlightSample, type FlightTrack } from './flight'
import { parkBeside, resolveRect, shapeFor, type Depth, type FlyTarget, type Side } from './dom'

/** Facing is a YAW, never a reflection: `scale.x` cannot animate through zero
 *  without collapsing him, so a mirror could only ever be an instant flip, and
 *  he has to be able to turn in full view. */
const FACING_YAW_DEG = 80.39
/** 26 frames at 30 fps, measured off `DeckE_Control["facing"]`. */
const FACING_TURN_MS = 866.7
/** Measured from the Banjo-Kazooie decompilation, not estimated. */
const DEFAULT_BLEND_MS = 100

export type DeckEOptions = {
  canvas: HTMLCanvasElement
  baseUrl: string
  clearColor?: readonly [number, number, number] | null
  onReady?: () => void
  onError?: (e: unknown) => void
  /** How tall he should be on screen, in CSS pixels. Dollies the camera along
   *  its own axis, so the 3/4 view the facing system depends on is unchanged. */
  characterHeightPx?: number | null
}

type Transition = { from: Pose; started: number; durationMs: number } | null

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

export class DeckE {
  readonly stage: Stage
  private rig!: RigNodes
  private riderSystem!: RiderSystem
  /** Null if the parent vertices could not be resolved in the exported mesh. */
  private eyeSocket: EyeSocket | null = null
  private cards!: CardSystem
  private doc!: PlaybookDoc
  /** One entry per eye: the patched material and the empties it reads. */
  private eyes: { mat: EyeMaterial; ctrls: EyeControls }[] = []
  private states!: Map<string, CompiledState>
  private proc!: ReturnType<typeof createProcedural>

  private readonly clock = new Clock()
  private elapsed = 0
  private raf = 0
  private disposed = false

  /** Base-layer state. */
  private current = 'boot'
  private stateStart = 0
  private transition: Transition = null

  /** `talk` is an OVERLAY, never a base state — he has to be able to talk while
   *  happy, while presenting, while thinking. A hub-and-spoke talk state would
   *  force him back to neutral to speak. */
  private talkWeight = 0
  private talkClock = 0

  private facing = 1
  private facingTarget = 1
  private facingFrom = 1
  private facingT = 1

  private readonly pose: Pose = {}
  private readonly scratch: Pose = {}
  private readonly overlayPose: Pose = {}
  private readonly floatOut = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 }
  private readonly gazeOut = { gx: 0, gz: 0 }

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
  /** Re-solving on every scroll event would leave him permanently crouched in
   *  anticipation and never arriving, so a move is only chased once it is worth
   *  chasing. */
  private pendingTarget: { target: FlyTarget; depth: Depth; side: Side } | null = null
  private lastResolveAt = 0

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
    this.proc = createProcedural(doc)

    const model: Object3D = gltf.scene
    this.stage.scene.add(model)
    // Repair what glTF's fixed material model flattened, before anything binds.
    fixupMaterials(model)
    this.rig = bindRig(model)
    this.riderSystem = createRiderSystem(model)
    this.eyeSocket = createEyeSocket(model)
    this.cards = createCardSystem(cards, bindCards(model, cards))
    atlas.colorSpace = NoColorSpace
    this.bindEyes(model, atlas)

    for (const k in doc.rest_pose) this.pose[k] = doc.rest_pose[k]

    this.setState('boot', { blendMs: 0 })
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
      const mat = createEyeMaterial({ side: s.side, atlas })
      mesh.material = mat
      this.eyes.push({ mat, ctrls: { eye: mesh, ...s.ctrls } })
    }
  }

  setEnvironment(hdr: Texture) {
    this.stage.setEnvironment(hdr)
  }

  // ---------------------------------------------------------------- control

  /** Every authored state, in playbook order. */
  get stateNames(): string[] {
    return this.doc?.order ?? []
  }

  getState() {
    return {
      state: this.current,
      facing: this.facing,
      talking: this.talkWeight > 0,
      overrides: Object.fromEntries(this.overrides),
      elapsedMs: (this.elapsed - this.stateStart) * 1000,
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
  setState(name: string, opts: { blendMs?: number } = {}) {
    if (!this.states.has(name)) throw new Error(`decke: unknown state "${name}"`)

    // Stepped-register clips turn to mush when crossfaded, so they snap.
    const snap =
      this.doc.transition.snap_states.includes(name) ||
      this.doc.transition.snap_states.includes(this.current)
    // Alert is a MODE, not an emotion. It pre-empts anything, hard — it opens
    // with a crouch that reads as anticipation from any pose.
    const isAlert = name.startsWith('alert_')

    const blend = opts.blendMs ?? (snap || isAlert ? 0 : DEFAULT_BLEND_MS)

    if (blend > 0) {
      const from: Pose = {}
      for (const k in this.pose) from[k] = this.pose[k]
      this.transition = { from, started: this.elapsed, durationMs: blend }
    } else {
      this.transition = null
    }

    this.current = name
    this.stateStart = this.elapsed
  }

  setOverlay(name: 'talk' | null, weight = 1) {
    this.talkWeight = name === 'talk' ? Math.max(0, Math.min(1, weight)) : 0
  }

  /** `facing` is continuous over [-1, +1]. Animated over 867 ms by default. */
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
  flyTo(target: FlyTarget, opts: { depth?: Depth; side?: Side } = {}) {
    const depth = opts.depth ?? 'foreground'
    const side = opts.side ?? 'auto'
    const rect = resolveRect(target)
    if (!rect) throw new Error('decke: flyTo target did not resolve to an element')

    const camera = this.stage.camera
    const baseDistance = camera.position.length()
    const park = parkBeside(camera, rect, { depth, side, baseDistance })

    this.launch(park.position)
    // Hold facing steady for the duration of a presentation; turning mid-flight
    // fights the flight layer's own yaw.
    this.setFacing(park.facing)
    this.pendingTarget = { target, depth, side }
  }

  returnHome() {
    this.pendingTarget = null
    this.launch(new Vector3(0, 0, 0))
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
    }
    this.raf = requestAnimationFrame(tick)
  }

  stop() {
    cancelAnimationFrame(this.raf)
  }

  private update(dt: number) {
    if (!this.rig) return

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
    const st = this.states.get(this.current)!
    const clip = st.clip
    // Keep BOTH clocks. The clip wraps, but the card orbit is one continuous
    // rotation whose period (2700 ms) is deliberately not the loop (1800 ms) —
    // driving it from the wrapped clock jumps it back a third of a turn on
    // every loop.
    const tRaw = (this.elapsed - this.stateStart) * 1000
    let t = tRaw
    if (clip.loop) t %= clip.duration_ms
    evalState(st, t, this.doc.rest_pose, this.pose)

    // ---- crossfade -----------------------------------------------------
    if (this.transition) {
      const u = (this.elapsed - this.transition.started) * 1000 / this.transition.durationMs
      if (u >= 1) {
        this.transition = null
      } else {
        const from = this.transition.from
        for (const k in this.pose) this.pose[k] = from[k] + (this.pose[k] - from[k]) * u
      }
    }

    // ---- talk overlay --------------------------------------------------
    // The composition rule is a DESIGNED CHOICE, not a recovered one: no rule
    // survives anywhere in the sources. `mouth` takes the max (following the
    // flight layer's precedent, so talk can never close a mouth a state is
    // holding open), and the shape channels blend by weight.
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
    this.pose.gx += this.gazeOut.gx
    this.pose.gz += this.gazeOut.gz

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
      this.pose.px += f.pos.x
      this.pose.py += f.pos.y
      this.pose.pz += f.pos.z
      this.pose.rx += f.rx
      this.pose.ry += f.ry
      this.pose.rz += f.rz
      this.pose.sq += f.sq
      this.pose.bend += f.bend
      this.pose.lean += f.lean
      this.pose.twist += f.twist
      // The flight lid can never be closed by an expression key — max, not add.
      this.pose.mouth = Math.max(this.pose.mouth, f.mouth)
      if (tf >= this.track.durationMs) this.track = null
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

    // ---- apply ----------------------------------------------------------
    applyPose(this.rig, this.pose, { facing: this.facing })

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
      tMs: tRaw,
    })

    // ---- eye shader ------------------------------------------------------
    // The eye reads the WORLD matrix of seven control empties per side, so the
    // graph has to be flushed here rather than left to the renderer: sampling
    // it first would hand the shader last frame's reel position.
    if (this.eyes.length) {
      this.stage.scene.updateMatrixWorld(true)
      const symbol = this.states.get(this.current)?.clip.symbol ?? null
      for (const e of this.eyes) syncEyeUniforms(e.mat, e.ctrls, this.pose, symbol)
    }
  }

  resize(width: number, height: number) {
    this.stage.setSize(width, height)
  }

  dispose() {
    this.disposed = true
    this.stop()
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
    if (INSTANCES.get(this.opts.canvas) === this) INSTANCES.delete(this.opts.canvas)
  }
}

export const DECKE_HOME = new Vector3(0, 0, 0)
