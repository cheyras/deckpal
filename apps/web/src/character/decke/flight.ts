/**
 * Flight: how he travels from where he is to a point beside a DOM element.
 *
 * Ported from `decke_flight.py`, with two deliberate departures documented
 * below. The shape of the motion is normative; the staging is not.
 *
 * THE PROFILE IS A RUNTIME CONTROLLER, NOT A BAKED CURVE. The wiki describes
 * Catmull-Rom `PROFILE_*` tables; those were deleted when the timing was rebuilt
 * as a first-order chase with asymmetric acceleration limits, and the upstream
 * page was never updated. The controller is what the port wants anyway — it is
 * C1 by construction so it cannot judder, and it is distance-adaptive, so short
 * hops stay crisp and long traverses get dramatic for free.
 *
 * WHY IT IS BAKED ON TRIGGER AND THEN PLAYED BACK:
 * `_simulate` is a fixed-step integrator with NO `dt` anywhere. `a_acc`/`a_dec`
 * are per-frame-squared and the epsilons are per-frame. Driving it straight from
 * requestAnimationFrame does not merely drift — a single long frame can make it
 * undershoot its brake and enter a limit cycle. Worse, the orientation layer is
 * NON-CAUSAL: `vref`/`aref` are percentiles over the whole finished leg and the
 * smoother reads i±2, so frame i cannot be evaluated without simulating the
 * whole leg. So: solve once at a virtual 30 Hz, then interpolate the track
 * against real time. Playback is dt-safe; the solver is not.
 */
import { Camera, Vector3 } from 'three'
import { blenderToThree } from './constants'

// --- controller constants, from decke_flight.py ---------------------------
const ACC_FRAMES = 20.0 // long accel...
const DEC_FRAMES = 6.5 // ...short decel. The ~4:1 asymmetry IS the design:
// holding a constant cruise is what made the old hand-authored profile read
// mechanical.
const ANTIC_ARC = 0.055
const ANTIC_FRAMES = 7
const REF_PATH = 6.5
const SETTLE_EPS = 0.0022
const POS_EPS = 0.004
const SMOOTH_TAPS = 5
const OVERSHOOT_FRAC = 0.035
const OVERSHOOT_MAX = 0.075
const SCREEN_MIX = 0.14
export const FPS = 30

/**
 * How much faster than the solved profile a leg is actually PLAYED.
 *
 * The solver has no duration input — it integrates until it arrives — so the
 * shipped pace was whatever the controller constants happened to produce, and
 * what they produced was slow: a measured foreground leg 2733 ms, a background
 * leg 3067, the trip home 4200.
 *
 *   "We need to make the travel a lot quicker from foreground to background.
 *    Right now it takes way too long. I would make it take like LESS THAN HALF
 *    of the time that it currently takes for him to get from foreground to
 *    background and vice versa. Just more snappy."
 *
 * Scaling the finished track is the safe half of that. The obvious knob is the
 * cruise speed in `shapeFor`, and it does not work: the controller's
 * stopping-distance law assumes a continuous velocity, so past about 2x the
 * discrete step overshoots the settle window every frame and the leg runs to the
 * 600-frame cap instead of arriving — 20167 ms, measured. Playing the SOLVED
 * track faster scales every velocity uniformly, keeps the accel:decel asymmetry,
 * the arc, the bow and the overshoot exactly as reviewed, and has no feedback
 * left in it to destabilise.
 *
 * 2.2 puts a background leg at 1394 ms — 45% of what it was, inside the "less
 * than half" that was asked for, with the trip home the longest at 1909.
 */
export const TRAVEL_RATE = 2.2

// --- orientation constants -------------------------------------------------
const LEAD_ACC = 26.0 // degrees. Lean follows ACCELERATION, not speed:
const LEAD_SPD = 13.0 // theta = arctan(a/g) is the real physics of anything
const LEAD_MAX = 34.0 // that flies by vectoring thrust. A speed-driven lean
// holds the extreme pose flat through cruise (measured 36 degrees sustained for
// six frames, which read as toppling) and — decisively — cannot tip him
// BACKWARD to brake, because speed has no sign.
const YAW_MAX = 20.0
const CURVE_GAIN = 0.62
const WHIP_GAIN = 0.85
const CURVE_CLAMP = 0.72
const TWIST_GAIN = 0.22
const WHIP_LAG_MS = 66.0
const STRETCH = 0.15 // NOT the wiki's 0.27, which pumped the face vertically
const SQUASH_ANT = -0.13
const SQUASH_LAND = -0.15
const LID_CRUISE = 0.055
const LID_MAX = 0.075 // ~4 degrees. His interior is bright rose against cyan,
const LID_DRAG_GAIN = 0.07 // so the gape is far louder than its angle suggests,
const LID_LAG_MS = 100.0 // and his EYES are mounted on the lid.

export type FlightSample = {
  tMs: number
  pos: Vector3 // Blender frame
  rx: number
  ry: number
  rz: number
  sq: number
  bend: number
  lean: number
  twist: number
  mouth: number
}

export type FlightTrack = {
  durationMs: number
  samples: FlightSample[]
}

/**
 * The arc-length metric.
 *
 * Cumulative SCREEN distance plus 14% of world distance. Measuring in world
 * units is the mistake that made this read janky no matter how smooth the
 * numbers looked: tracking the rendered silhouette gave 4-64 px/frame with
 * frame-to-frame jumps of 20-27 px, where reference footage gives 1-2. Constant
 * world speed is not constant motion.
 *
 * The world term keeps the metric conditioned when he flies almost straight at
 * or away from the lens, where screen displacement alone goes to zero.
 *
 * DEPARTURE FROM THE SOURCE: the Python normalises by the staging camera's
 * horizontal half-FOV, which makes every duration aspect-dependent — the same
 * `cruise` would give materially different timings on a 390px phone and a
 * desktop. We normalise by the VERTICAL half-FOV instead, which is the axis we
 * hold fixed on resize, so a traverse takes the same time on both.
 */
function makeMetric(camera: Camera, tanHalfFovY: number) {
  const rel = new Vector3()
  const camPos = new Vector3()
  const fwd = new Vector3()
  const right = new Vector3()
  const up = new Vector3()
  camera.getWorldPosition(camPos)
  camera.getWorldDirection(fwd)
  right.set(1, 0, 0).applyQuaternion(camera.quaternion)
  up.set(0, 1, 0).applyQuaternion(camera.quaternion)

  return function ndc(pBlender: Vector3, out: { x: number; y: number; z: number }) {
    // +1.20 is a mid-body probe height, not the root: the metric tracks the
    // part of him the eye follows.
    const p = blenderToThree(pBlender.x, pBlender.y, pBlender.z + 1.2, rel)
    rel.copy(p).sub(camPos)
    const z = Math.max(rel.dot(fwd), 0.25)
    out.x = rel.dot(right) / z / tanHalfFovY
    out.y = rel.dot(up) / z / tanHalfFovY
    out.z = z
    return out
  }
}

/**
 * The velocity profile.
 *
 * Three rules, each learned from a failure:
 *  - the target speed is the STOPPING-DISTANCE curve `sqrt(2*a*remaining)`,
 *    capped at cruise. A plain proportional controller has no idea how much room
 *    it needs to stop: it holds full speed until it is almost there, blows 2.7
 *    units past the mark, and limit-cycles forever.
 *  - the rate limit is chosen by whether speed is RISING OR FALLING, not by the
 *    sign of the error. By error sign, the return pass after an overshoot
 *    accelerates at braking strength and rings.
 *  - overshoot is AIMED, not emergent: he targets past the mark and retargets
 *    the frame he crosses it. Letting it emerge from optimistic braking produced
 *    a ringing settle with four visible bounces over 60 frames.
 */
function simulate(pathLen: number, cruise: number): number[] {
  const k = Math.min(1, Math.max(0.25, pathLen / REF_PATH))
  const aAcc = cruise / Math.max(ACC_FRAMES * k, 1e-6)
  const aDec = cruise / Math.max(DEC_FRAMES * Math.max(0.45, k), 1e-6)
  const antic = Math.max(3, Math.round(ANTIC_FRAMES * Math.max(0.5, k)))
  const over = Math.min(OVERSHOOT_MAX, OVERSHOOT_FRAC * pathLen)

  let s = 0
  let v = 0
  const out: number[] = [0]

  const step = (target: number) => {
    const rem = target - s
    let vDes = 0
    if (Math.abs(rem) >= POS_EPS) {
      const mag = Math.min(cruise, Math.sqrt(2 * aDec * Math.abs(rem)))
      vDes = rem >= 0 ? mag : -mag
    }
    const dv = vDes - v
    const speeding = Math.abs(vDes) > Math.abs(v) && vDes * v >= 0
    const lim = speeding ? aAcc : aDec
    v += Math.max(-lim, Math.min(lim, dv))
    s += v
  }

  for (let i = 0; i < antic; i++) {
    step(-ANTIC_ARC)
    out.push(s)
  }
  let passed = false
  for (let i = 0; i < 600; i++) {
    if (!passed && s >= pathLen) passed = true
    step(passed ? pathLen : pathLen + over)
    out.push(s)
    if (passed && Math.abs(pathLen - s) < POS_EPS && Math.abs(v) < SETTLE_EPS) break
  }

  // Jerk-limit the RESULT, not the loop. Jerk-limiting inside destabilises the
  // controller: braking can no longer ramp fast enough to stop in the distance
  // the stopping curve assumed. A smoothing pass over the finished track rounds
  // the same corners and cannot destabilise anything, because there is no
  // feedback left to destabilise.
  const half = (SMOOTH_TAPS - 1) / 2
  const sm = out.slice()
  for (let i = half; i < out.length - half; i++) {
    let acc = 0
    for (let j = -half; j <= half; j++) acc += out[i + j]
    sm[i] = acc / SMOOTH_TAPS
  }
  sm[sm.length - 1] = pathLen // land exactly on the mark
  return sm
}

const boxcar = (a: number[], reps = 1) => {
  let cur = a
  for (let r = 0; r < reps; r++) {
    const next = cur.slice()
    for (let i = 2; i < cur.length - 2; i++) {
      next[i] = (cur[i - 2] + cur[i - 1] + cur[i] + cur[i + 1] + cur[i + 2]) / 5
    }
    cur = next
  }
  return cur
}

const percentile = (a: number[], p: number) => {
  const s = a.slice().sort((x, y) => x - y)
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))))]
}

export type SolveOptions = {
  camera: Camera
  tanHalfFovY: number
  arc?: number
  bow?: number
  cruise?: number
}

/**
 * Solve one leg. `a` and `b` are in the BLENDER frame.
 *
 * `arc` lifts along world Z; `bow` sweeps along camera-right. Bow is the single
 * control that decides whether a long move reads as flight or as a zoom — motion
 * along the view axis produces almost no screen displacement, and the original
 * `travel_far` measured less than one frame width of travel over 1900 ms before
 * bow was added.
 */
export function solveFlight(a: Vector3, b: Vector3, opts: SolveOptions): FlightTrack {
  const arc = opts.arc ?? 0
  const bow = opts.bow ?? 0
  const cruise = opts.cruise ?? 0.08
  const ndc = makeMetric(opts.camera, opts.tanHalfFovY)

  const camRight = new Vector3(1, 0, 0).applyQuaternion(opts.camera.quaternion)
  // Express camera-right in the Blender frame so the bow is applied there.
  const bowDir = new Vector3(camRight.x, -camRight.z, camRight.y)

  const N = 400
  const pts: Vector3[] = []
  for (let i = 0; i <= N; i++) {
    const s = i / N
    const p = new Vector3().lerpVectors(a, b, s)
    const bulge = Math.sin(Math.PI * s)
    if (bow) p.addScaledVector(bowDir, bow * bulge)
    if (arc) p.z += arc * bulge
    pts.push(p)
  }

  // Arc table in the mixed metric.
  const L: number[] = [0]
  const n0 = { x: 0, y: 0, z: 0 }
  const n1 = { x: 0, y: 0, z: 0 }
  for (let i = 1; i <= N; i++) {
    ndc(pts[i - 1], n0)
    ndc(pts[i], n1)
    const screen = Math.hypot(n1.x - n0.x, n1.y - n0.y)
    const world = pts[i].distanceTo(pts[i - 1])
    L.push(L[i - 1] + screen + SCREEN_MIX * world)
  }
  const pathLen = L[N]
  if (pathLen < 1e-6) return { durationMs: 0, samples: [] }

  const arcs = simulate(pathLen, cruise)
  const nf = arcs.length - 1
  const durationMs = (nf * 1000) / (FPS * TRAVEL_RATE)

  // Position at a given arc length, extrapolating along the end tangent outside
  // the path so anticipation and overshoot have somewhere to go.
  const at = (d: number): Vector3 => {
    if (d <= 0) {
      const t = new Vector3().subVectors(pts[1], pts[0])
      const len = t.length() || 1
      return new Vector3().copy(pts[0]).addScaledVector(t, d / len)
    }
    if (d >= pathLen) {
      const t = new Vector3().subVectors(pts[N], pts[N - 1])
      const len = t.length() || 1
      return new Vector3().copy(pts[N]).addScaledVector(t, (d - pathLen) / len)
    }
    let lo = 0
    let hi = N
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (L[mid] <= d) lo = mid
      else hi = mid
    }
    const span = L[hi] - L[lo] || 1
    return new Vector3().lerpVectors(pts[lo], pts[hi], (d - L[lo]) / span)
  }

  const positions = arcs.map(at)

  // --- orientation, off the (loop-free) position track --------------------
  const dt = 1 / FPS
  const vel: Vector3[] = []
  for (let i = 0; i < positions.length; i++) {
    const i0 = Math.max(0, i - 1)
    const i1 = Math.min(positions.length - 1, i + 1)
    vel.push(
      new Vector3().subVectors(positions[i1], positions[i0]).divideScalar((i1 - i0) * dt),
    )
  }
  const rawSpeed = boxcar(vel.map((v) => v.length()))
  const vref = percentile(rawSpeed, 0.8) || 1
  const spd = rawSpeed.map((s) => Math.min(1.15, s / vref))

  const accRaw: number[] = spd.map((_, i) => {
    const i0 = Math.max(0, i - 1)
    const i1 = Math.min(spd.length - 1, i + 1)
    return (spd[i1] - spd[i0]) / ((i1 - i0) / spd.length)
  })
  const aref = percentile(accRaw.map(Math.abs), 0.9) || 1
  const acc = accRaw.map((x) => Math.max(-1.2, Math.min(1.2, x / aref)))

  const lag = Math.round((WHIP_LAG_MS / 1000) * FPS)
  const lidLag = Math.round((LID_LAG_MS / 1000) * FPS)

  const rx: number[] = []
  const ry: number[] = []
  const rz: number[] = []
  const sq: number[] = []
  const bend: number[] = []
  const lean: number[] = []
  const twist: number[] = []
  const mouth: number[] = []

  for (let i = 0; i < positions.length; i++) {
    const d = vel[i].clone().normalize()
    const theta = Math.max(
      -LEAD_MAX,
      Math.min(LEAD_MAX, LEAD_ACC * acc[i] + LEAD_SPD * spd[i]),
    )

    // Yaw: he turns INTO the move but never shows his back. The half-factor is
    // what stops him fully facing his travel direction.
    const dh = new Vector3(d.x, d.y, 0)
    if (dh.lengthSq() > 1e-9) dh.normalize()
    const psiRaw = Math.atan2(dh.x, -dh.y) * 0.5
    const psi =
      Math.max(-YAW_MAX * (Math.PI / 180), Math.min(YAW_MAX * (Math.PI / 180), psiRaw)) *
      spd[i]

    // Lean about the axis perpendicular to travel, in the Blender frame.
    rx.push(theta * -d.y)
    ry.push(theta * d.x)
    rz.push((psi * 180) / Math.PI)

    sq.push(STRETCH * spd[i])

    const prev = spd[Math.max(0, i - lag)]
    const amt = Math.max(
      -CURVE_CLAMP,
      Math.min(CURVE_CLAMP, CURVE_GAIN * spd[i] + WHIP_GAIN * (spd[i] - prev)),
    )
    const cs = Math.cos(-psi)
    const sn = Math.sin(-psi)
    const lx = dh.x * cs - dh.y * sn
    const ly = dh.x * sn + dh.y * cs
    bend.push(ly * amt)
    lean.push(lx * amt)
    twist.push(TWIST_GAIN * (spd[i] - prev) * lx)

    const prevLid = spd[Math.max(0, i - lidLag)]
    mouth.push(
      Math.min(LID_MAX, LID_CRUISE * spd[i] + LID_DRAG_GAIN * Math.abs(spd[i] - prevLid)),
    )
  }

  // The landing lid resolve — a clack, a bounce, and a smaller second bounce.
  // An elif CHAIN, not three sequential clamps: sequential mins would pin the
  // lid shut for the whole final 12% and delete the bounce entirely.
  // Applied BEFORE smoothing; clamping after puts the steps back in.
  for (let i = 0; i < mouth.length; i++) {
    const t = i / (mouth.length - 1)
    if (t > 0.965) mouth[i] = Math.min(mouth[i], 0.03)
    else if (t > 0.925) mouth[i] = Math.min(mouth[i], 0.075)
    else if (t > 0.88) mouth[i] = Math.min(mouth[i], 0.015)
  }

  const sRx = boxcar(rx)
  const sRy = boxcar(ry)
  const sRz = boxcar(rz)
  // `mouth` and `sq` get three passes: they act through a lever on the eyes, so
  // residual steps there are magnified into visible face judder.
  const sSq = boxcar(sq, 3)
  const sMouth = boxcar(mouth, 3)
  const sBend = boxcar(bend)
  const sLean = boxcar(lean)
  const sTwist = boxcar(twist)

  // Squash blends at the SIMULATED event frames, not hand-guessed times, so they
  // stay attached to the real anticipation and overshoot. Blended over 7 frames:
  // stamping a single frame after smoothing put back a 78% one-frame pop.
  const iAnt = arcs.indexOf(Math.min(...arcs))
  const iLand = arcs.indexOf(Math.max(...arcs))
  const blendAt = (i0: number, val: number) => {
    for (let j = -3; j <= 3; j++) {
      const i = i0 + j
      if (i < 0 || i >= sSq.length) continue
      let w = 1 - Math.abs(j) / 4
      w = w * w * (3 - 2 * w)
      sSq[i] = sSq[i] * (1 - w) + val * w
    }
  }
  blendAt(iAnt, SQUASH_ANT)
  if (iLand > arcs.length / 2) blendAt(iLand, SQUASH_LAND)

  const samples: FlightSample[] = positions.map((pos, i) => ({
    tMs: (i * 1000) / FPS,
    pos,
    rx: sRx[i],
    ry: sRy[i],
    rz: sRz[i],
    sq: sSq[i],
    bend: sBend[i],
    lean: sLean[i],
    twist: sTwist[i],
    mouth: sMouth[i],
  }))

  // Endpoint cleanup: strip every transient. Carrying them over left him holding
  // a pose mid-stretch, tilted, with his lid hanging open — and nothing in the
  // beat data afterwards said so.
  const last = samples[samples.length - 1]
  last.sq = last.bend = last.lean = last.twist = last.mouth = 0
  last.rx = last.ry = last.rz = 0
  last.pos.copy(b)
  const first = samples[0]
  first.sq = first.bend = first.lean = first.twist = first.mouth = 0

  return { durationMs, samples }
}

/** Sample a solved track at an arbitrary time. Playback is dt-safe even though
 *  the solver is not, because this only ever interpolates finished data. */
export function sampleTrack(track: FlightTrack, tMs: number, out: FlightSample): FlightSample {
  const s = track.samples
  if (s.length === 0) return out
  if (tMs <= 0) return Object.assign(out, s[0], { pos: out.pos.copy(s[0].pos) })
  if (tMs >= track.durationMs) {
    return Object.assign(out, s[s.length - 1], { pos: out.pos.copy(s[s.length - 1].pos) })
  }
  // INDEX BY PROGRESS THROUGH THE TRACK, not by wall-clock frames.
  //
  // `(tMs / 1000) * FPS` is the same thing only while the track is played at the
  // rate it was solved at, and it stopped being true the moment `TRAVEL_RATE`
  // existed: `durationMs` shrank, the indexing did not, and the guard above then
  // fired at 45% of the way along the path. Measured on a full-width leg — at 99%
  // of the playback he was 0.47 of the way to the destination, and arrived by
  // teleporting on the last frame. Identical arithmetic at `TRAVEL_RATE = 1`, and
  // correct at any other.
  const f = (tMs / track.durationMs) * (s.length - 1)
  const i = Math.min(s.length - 2, Math.floor(f))
  const u = f - i
  const a = s[i]
  const b = s[i + 1]
  out.tMs = tMs
  out.pos.lerpVectors(a.pos, b.pos, u)
  out.rx = a.rx + (b.rx - a.rx) * u
  out.ry = a.ry + (b.ry - a.ry) * u
  out.rz = a.rz + (b.rz - a.rz) * u
  out.sq = a.sq + (b.sq - a.sq) * u
  out.bend = a.bend + (b.bend - a.bend) * u
  out.lean = a.lean + (b.lean - a.lean) * u
  out.twist = a.twist + (b.twist - a.twist) * u
  out.mouth = a.mouth + (b.mouth - a.mouth) * u
  return out
}
