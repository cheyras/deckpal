/**
 * The three always-on procedural layers: idle float, blink, and gaze.
 *
 * These are REBUILT as algorithms rather than baked as clips, deliberately.
 * Baked randomness loops visibly, and the whole point of these layers is that
 * he never quite repeats. Because they are specified as deterministic maths with
 * a fixed seed, Blender and the browser produce the IDENTICAL schedule — which
 * is what makes "rebuild it exactly" achievable for a stochastic layer.
 *
 * Every constant here comes from the playbook, which is generated from
 * `decke_proc.py` / `decke_idle.py`. Nothing is hardcoded, because two of these
 * numbers were recalibrated after the wiki prose was written and the prose is
 * still wrong (gaze flit amplitude is 0.68/0.46, not the documented 0.16/0.11).
 */
import type { PlaybookDoc } from './playbook'

/**
 * Lehmer / Park-Miller minimal standard: `s = (s * 48271) mod 2147483647`.
 *
 * Three lines, no dependency, exactly reproducible. Note `s * 48271` stays well
 * inside 2^53 because `s < 2^31`, so plain JS numbers are exact here — do NOT
 * "optimise" this into BigInt, and do not reach for Math.random().
 */
export class Rng {
  private s: number
  constructor(seed: number, private readonly a: number, private readonly m: number) {
    this.s = seed % m || 1
  }
  next(): number {
    this.s = (this.s * this.a) % this.m
    return this.s / this.m
  }
  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next()
  }
}

export type FloatChannels = { x: number; y: number; z: number; rx: number; ry: number; rz: number }
const CHANNELS = ['x', 'y', 'z', 'rx', 'ry', 'rz'] as const

/**
 * The idle float: a sum of three sines per channel with MUTUALLY IRRATIONAL
 * frequency ratios (1, the golden ratio, the silver ratio).
 *
 * Chosen over Perlin for a specific reason: this is a closed-form equation a
 * future implementation can type in and get a bit-identical curve from, with no
 * noise library to match and no seed to agree on. Because the ratios are
 * irrational the composite never repeats and no two channels ever synchronise,
 * which is what stops it reading as mechanical.
 *
 * Position is in blender units, rotation in DEGREES.
 */
export class IdleFloat {
  /** The float's own clock. See `advance`. */
  tau = 0
  private readonly f0: number
  private readonly ratios: readonly number[]
  private readonly weights: readonly number[]
  private readonly amp: Record<string, number>
  private readonly phase: Record<string, readonly number[]>

  constructor(doc: PlaybookDoc) {
    const f = doc.procedural.idle_float
    this.f0 = f.base_hz
    this.ratios = f.ratios
    this.weights = f.weights
    this.amp = f.amplitude
    this.phase = f.phase
  }

  /**
   * Integrate the rate, then evaluate at tau.
   *
   * THE RATE MUST NOT SCALE `t` DIRECTLY. Scaling t makes the phase jump the
   * instant the rate changes, producing a visible pop on every state entry. The
   * clock is integrated separately so a rate change is phase-continuous.
   */
  advance(dtSeconds: number, rateMul = 1): number {
    this.tau += dtSeconds * rateMul
    return this.tau
  }

  channel(name: string, tau = this.tau): number {
    const a = this.amp[name]
    const ph = this.phase[name]
    let sum = 0
    for (let k = 0; k < 3; k++) {
      sum += a * this.weights[k] * Math.sin(2 * Math.PI * this.f0 * this.ratios[k] * tau + ph[k])
    }
    return sum
  }

  /** All six channels at once, scaled by the state's amplitude multiplier. */
  evaluate(ampMul: number, out: FloatChannels): FloatChannels {
    for (const c of CHANNELS) out[c] = this.channel(c) * ampMul
    return out
  }
}

export type Blink = { time: number }

/**
 * Blink scheduling and curve.
 *
 * Real blinks close faster than they open, and that asymmetry is most of what
 * sells it: 70 ms shut, 30 ms held, 120 ms open.
 */
export class Blinker {
  private schedule: number[] = []
  private cursor = 0
  /** The blinker's own integrated clock. See `at`. */
  tau = 0
  private lastT: number | null = null
  private readonly c: number
  private readonly h: number
  private readonly o: number
  readonly lowerLidRatio: number

  constructor(private readonly doc: PlaybookDoc, private readonly rng: Rng) {
    const b = doc.procedural.blink
    this.c = b.close_ms
    this.h = b.hold_ms
    this.o = b.open_ms
    this.lowerLidRatio = b.lower_lid_ratio
    this.regenerate(600)
  }

  /** Pre-generate a schedule. The draw ORDER matters for reproducibility. */
  private regenerate(durationS: number) {
    const b = this.doc.procedural.blink
    const out: number[] = []
    let t = this.rng.range(b.first_offset_s[0], b.first_offset_s[1])
    const total = (this.c + this.h + this.o + b.double_gap_ms) / 1000
    while (t < durationS) {
      out.push(t)
      if (this.rng.next() < b.double_p) {
        const t2 = t + total
        if (t2 < durationS) out.push(t2)
        t = t2
      }
      t += this.rng.range(b.interval_s[0], b.interval_s[1])
    }
    this.schedule = out
    this.cursor = 0
  }

  /** 0 = open, 1 = shut. `tMs` is measured from the blink start. */
  curve(tMs: number): number {
    const { c, h, o } = this
    if (tMs < 0 || tMs > c + h + o) return 0
    if (tMs <= c) return (tMs / c) ** 0.75 // snap shut
    if (tMs <= c + h) return 1
    const u = (tMs - c - h) / o
    return 1 - u * u // ease open, slower
  }

  /**
   * The blink amount at wall-clock `tSeconds`.
   *
   * `rateMul` scales how often he blinks; 0 means never, which several states
   * use deliberately — the absence of blinking is a large part of why the alert
   * freeze reads as a mode switch rather than a pause.
   */
  at(tSeconds: number, rateMul: number): number {
    if (this.schedule.length === 0) return 0
    // INTEGRATE the rate; never scale `tSeconds` by it. This is the same rule
    // `IdleFloat.advance` documents two screens up, and the blinker had the bug
    // that rule exists to prevent: with `scaled = t * rate` and a monotonic
    // cursor, dropping the rate makes `scaled` jump BACKWARDS while the cursor
    // stays where it was, so he simply stops blinking until wall-clock catches
    // up. Measured: happy (1.3) for 120 s then sad (0.45) gave the next blink
    // at t = 343 s — 3.7 minutes of no blinking, from an ordinary emote change.
    const prev = this.lastT
    this.lastT = tSeconds
    if (prev === null || tSeconds < prev || tSeconds - prev > SEEK_GAP_S) {
      // First call, or a seek (the parity harness rewinds `elapsed`). Resync
      // rather than integrate a meaningless delta.
      this.tau = tSeconds * rateMul
      this.cursor = 0
    } else if (rateMul > 0) {
      this.tau += (tSeconds - prev) * rateMul
    }
    if (rateMul <= 0) return 0
    const scaled = this.tau
    while (this.cursor < this.schedule.length - 1 && this.schedule[this.cursor + 1] <= scaled) {
      this.cursor++
    }
    // Check this blink and the next, since they can overlap on a double.
    let v = 0
    for (const i of [this.cursor, this.cursor + 1]) {
      const start = this.schedule[i]
      if (start === undefined) continue
      v = Math.max(v, this.curve((scaled - start) * 1000))
    }
    if (scaled > this.schedule[this.schedule.length - 1] + 10) this.regenerate(scaled + 600)
    return v
  }
}

export type GazeOffset = { gx: number; gz: number }

/** How far ahead the gaze schedules are generated, and how close to the end we
 *  allow the clock to get before extending them. */
const GAZE_HORIZON_S = 600
const GAZE_REGEN_MARGIN_S = 60

/** A jump larger than this between successive `at` calls is a SEEK, not a
 *  frame. Real frames are milliseconds; the parity harness rewinds by minutes. */
const SEEK_GAP_S = 1

/**
 * Gaze: micro-saccades ("flits") plus blink-masked glance-aways.
 *
 * Flits are the cheapest single thing that makes him feel alive — he always
 * reads as looking at you, but his eyes never sit perfectly still. The
 * amplitudes here (0.68 / 0.46) are the RECALIBRATED values; the wiki's
 * documented 0.16 / 0.11 produced a pupil movement of about one pixel and was
 * invisible.
 *
 * Glance-aways are blink-masked on purpose: the brain suppresses visual input
 * during a blink, so he reopens already looking elsewhere and the change is
 * invisible. Without the mask the eyes visibly slide and it reads as a slow,
 * pointed look-away instead of a natural glance.
 */
export class Gaze {
  private flits: { t: number; x: number; z: number }[] = []
  private glances: { t: number; x: number; z: number; hold: number }[] = []
  private readonly moveS: number
  /** How far the generated schedules currently reach, in seconds. */
  private horizon = 0

  constructor(private readonly doc: PlaybookDoc, private readonly rng: Rng) {
    this.moveS = doc.procedural.gaze_flit.move_ms / 1000
    this.regenerate(600)
  }

  private regenerate(durationS: number) {
    this.horizon = durationS
    const f = this.doc.procedural.gaze_flit
    const g = this.doc.procedural.glance_away
    this.flits = []
    let t = this.rng.range(f.first_offset_s[0], f.first_offset_s[1])
    while (t < durationS) {
      this.flits.push({
        t,
        x: this.rng.range(-f.amp_x, f.amp_x),
        z: this.rng.range(-f.amp_z, f.amp_z),
      })
      t += this.rng.range(f.interval_s[0], f.interval_s[1])
    }
    this.glances = []
    t = this.rng.range(g.first_offset_s[0], g.first_offset_s[1])
    while (t < durationS) {
      const mag = this.rng.range(g.amp_x[0], g.amp_x[1])
      const sign = this.rng.next() < 0.5 ? 1 : -1
      this.glances.push({
        t,
        x: mag * sign,
        z: this.rng.range(g.amp_z[0], g.amp_z[1]),
        hold: this.rng.range(g.hold_ms[0], g.hold_ms[1]),
      })
      t += this.rng.range(g.interval_s[0], g.interval_s[1])
    }
  }

  /**
   * @param gazeLocked  States where gaze already carries meaning suppress the
   *   large glances but KEEP the subtle flits. A stray look-away landing on a
   *   nod destroys the read entirely — the head says yes while the eyes leave
   *   the conversation.
   * @param frozen  Alert states freeze everything: no tracking, no flits, no
   *   blinking. The fixed stare is exactly the uncanny quality wanted.
   */
  at(tSeconds: number, gazeLocked: boolean, frozen: boolean, out: GazeOffset): GazeOffset {
    out.gx = 0
    out.gz = 0
    if (frozen) return out
    // Extend the schedule only when we are actually running out of it. The
    // guard used to be `tSeconds > 500`, which is true on EVERY frame from 500 s
    // onward — so past 8m20s this rebuilt both schedules once per frame, and
    // since each rebuild draws fresh random offsets the pupils became 60 Hz
    // noise (measured: gx -0.181 -> +0.381 -> -0.037 over three frames) while
    // the arrays grew without bound. `Blinker` had the correct guard; this did
    // not. Regenerating on a horizon also keeps the layer DETERMINISTIC, which
    // a per-frame rebuild had quietly destroyed.
    if (tSeconds > this.horizon - GAZE_REGEN_MARGIN_S) {
      this.regenerate(tSeconds + GAZE_HORIZON_S)
    }

    // Saccades are near-instant (66 ms), so the flit is a fast ramp to the new
    // offset which then simply holds until the next one.
    let cur = this.flits[0]
    for (const f of this.flits) {
      if (f.t > tSeconds) break
      cur = f
    }
    if (cur) {
      const u = Math.min(1, Math.max(0, (tSeconds - cur.t) / this.moveS))
      const e = u * u * (3 - 2 * u)
      out.gx = cur.x * e
      out.gz = cur.z * e
    }

    if (!gazeLocked) {
      for (const g of this.glances) {
        const end = g.t + g.hold / 1000
        if (tSeconds >= g.t && tSeconds <= end) {
          out.gx = g.x
          out.gz = g.z
          break
        }
      }
    }
    return out
  }
}

export function createProcedural(doc: PlaybookDoc) {
  const p = doc.procedural.prng
  // One RNG per layer, each independently seeded from the same constant, so the
  // layers do not consume each other's draws — the schedules are only
  // reproducible if the draw order within a layer is stable.
  return {
    float: new IdleFloat(doc),
    blink: new Blinker(doc, new Rng(p.seed, p.a, p.m)),
    gaze: new Gaze(doc, new Rng(p.seed, p.a, p.m)),
  }
}
