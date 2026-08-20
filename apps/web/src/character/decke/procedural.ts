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

/**
 * A global slow-down on the hover, applied to EVERY state's own `float_rate`.
 *
 * "I would have his, like, floating, uh, subtle bob, be a little bit slower all
 * the time. Right now it's a little bit quick."
 *
 * All the time is the operative phrase, which is why this is one multiplier on
 * the rate rather than an edit to twenty-seven authored `float_rate` values: the
 * playbook's rates express how a state differs from the others (`sleep` 0.4,
 * `loading` 1.35), and that RELATIVE structure is right — it was the overall
 * tempo that was fast. Scaling preserves every relationship and gives the tempo
 * one number to tune.
 *
 * It scales the RATE, which is integrated, so changing it is phase-continuous —
 * see `IdleFloat.advance`. Setting it as a `t` multiplier instead would put a
 * pop on the very frame it changed.
 */
export const FLOAT_RATE_SCALE = 0.8

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
    this.tau += dtSeconds * rateMul * FLOAT_RATE_SCALE
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
  /** The next unscheduled moment, in the blinker's own clock. See `extend`. */
  private next: number | null = null
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
    this.extend(SCHEDULE_HORIZON_S)
  }

  /**
   * Grow the schedule out to `untilS`. The draw ORDER matters for
   * reproducibility, so this only ever APPENDS.
   *
   * It used to rebuild from zero every time the horizon was reached, which
   * silently replaced the whole schedule — including the blink he was in the
   * middle of — once every ten minutes. Extending keeps the cursor valid, keeps
   * the draws in one unbroken sequence, and means a character that has been on
   * screen for an hour is running the same schedule he started with.
   */
  private extend(untilS: number) {
    const b = this.doc.procedural.blink
    const total = (this.c + this.h + this.o + b.double_gap_ms) / 1000
    let t =
      this.next ?? (this.next = this.rng.range(b.first_offset_s[0], b.first_offset_s[1]))
    while (t < untilS) {
      this.schedule.push(t)
      if (this.rng.next() < b.double_p) {
        const t2 = t + total
        this.schedule.push(t2)
        t = t2
      }
      t += this.rng.range(b.interval_s[0], b.interval_s[1])
    }
    this.next = t
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
    if (scaled > this.schedule[this.schedule.length - 1] - SCHEDULE_MARGIN_S) {
      this.extend(scaled + SCHEDULE_HORIZON_S)
    }
    return v
  }
}

export type GazeOffset = { gx: number; gz: number }

/** How far ahead the schedules are generated, and how close to the end we allow
 *  the clock to get before extending them. */
const SCHEDULE_HORIZON_S = 600
const SCHEDULE_MARGIN_S = 60

/** A jump larger than this between successive `at` calls is a SEEK, not a
 *  frame. Real frames are milliseconds; the parity harness rewinds by minutes. */
const SEEK_GAP_S = 1

/** How many spent entries to let accumulate behind a cursor before dropping
 *  them. Trimming on every frame would be a splice per frame for nothing. */
const PRUNE_AT = 64

/**
 * The reviewed flit tuning, which OVERRIDES the playbook's authored numbers.
 *
 * The playbook is generated from the .blend and its job is to reproduce it
 * faithfully, so a product decision does not belong in it — the same argument
 * `sustain.ts` makes for `CLIP_PATCH`. These are product decisions, taken off
 * the 2026-08-20 screen recording, and they are stated here against the
 * authored values they replace.
 *
 * WHAT WAS WRONG. Three separate things, in the reviewer's words:
 *
 *   "The eye flitting back and forth — it's happening too often."
 *   "Sometimes it'll be like, boom, boom. Like, it'll go really quick."
 *   "Some of the movements are a little bit too big... put a maximum on that as
 *    well, to keep them all just kind of micro eye movements."
 *
 * and one instruction for how to fix the second: "there needs to be like a gate
 * on that — because I do want it to be randomized, but there needs to be like a
 * max frequency. It's at most every half second maybe."
 *
 * SO THE GATE IS A GATE, not a wider interval range. `MIN_GAP_S` is enforced on
 * the generated schedule regardless of what the interval draw returns, which is
 * what makes "no two flits closer than this" an invariant a test can assert
 * rather than a property that merely tends to hold. Widening the range alone
 * would not do it: a uniform draw on [0.45, 1.6] puts two flits 450 ms apart
 * roughly one time in twenty, which at this cadence is every half-minute — often
 * enough to be exactly the "boom, boom" that was reported.
 *
 * AND THE AMPLITUDE IS IN TARGET SPACE, so its visible size has to be converted
 * before it can be judged. At the staging camera the left eye sits 5.06 blender
 * units from it, so `look.ts` turns an offset of `a` into a pupil movement of
 * `a / 5.06 * GAZE_GAIN`. The authored 0.68 is therefore 0.0345 units of pupil,
 * against a roam half-width of 0.115 — 30% of the eye's entire travel, per flit.
 * 0.28 brings that to 12%, which is a flit you notice as life rather than as an
 * eye moving.
 */
const GAZE_TUNING = {
  /** Was `interval_s: [0.45, 1.6]`. Less often, overall. */
  intervalS: [1.2, 3.6] as const,
  /** The gate. No two flits are ever closer than this, whatever the draw says. */
  minGapS: 0.9,
  /** Was `amp_x: 0.68`. 12% of the pupil's lateral travel, not 30%. */
  ampX: 0.28,
  /** Was `amp_z: 0.46`. */
  ampZ: 0.22,
} as const

/**
 * Gaze: micro-saccades ("flits") plus blink-masked glance-aways.
 *
 * Flits are the cheapest single thing that makes him feel alive — he always
 * reads as looking at you, but his eyes never sit perfectly still. Their
 * cadence and size come from `GAZE_TUNING` above, NOT from the playbook: the
 * authored 0.68 / 0.46 were themselves a recalibration of the wiki's invisible
 * 0.16 / 0.11, and then overshot the other way.
 *
 * Glance-aways are blink-masked on purpose: the brain suppresses visual input
 * during a blink, so he reopens already looking elsewhere and the change is
 * invisible. Without the mask the eyes visibly slide and it reads as a slow,
 * pointed look-away instead of a natural glance.
 */
export class Gaze {
  private flits: { t: number; x: number; z: number }[] = []
  private glances: { t: number; x: number; z: number; hold: number }[] = []
  private lastT = -Infinity
  private readonly moveS: number
  /** How far the generated schedules currently reach, in seconds. */
  private horizon = 0
  /** The next unscheduled moment for each schedule. See `extend`. */
  private nextFlit: number | null = null
  private nextGlance: number | null = null
  /** How far into each schedule the clock has reached. Both are MONOTONIC in
   *  wall-clock and are reset by a seek; see `at`. */
  private flitCursor = 0
  private glanceCursor = 0

  constructor(private readonly doc: PlaybookDoc, private readonly rng: Rng) {
    this.moveS = doc.procedural.gaze_flit.move_ms / 1000
    this.extend(SCHEDULE_HORIZON_S)
  }

  /**
   * Grow both schedules out to `untilS`, APPENDING only.
   *
   * This used to rebuild from zero, and that was wrong in two ways that only
   * showed up past the first horizon. It replaced the live schedule wholesale,
   * so the flit he was in the middle of jumped to a different one every ten
   * minutes; and it made the flit gate a property of one generation rather than
   * of the schedule, because the rebuild's `first_offset` draw could land
   * arbitrarily close to the last flit of the run it replaced. Extending makes
   * the gate an invariant over the whole life of the character, which is what a
   * gate is supposed to be — see `GAZE_TUNING`.
   *
   * Both schedules are grown in ONE call, flits first, so the draws stay in a
   * single documented order however the horizon happens to fall.
   */
  private extend(untilS: number) {
    const f = this.doc.procedural.gaze_flit
    const g = this.doc.procedural.glance_away
    const [lo, hi] = GAZE_TUNING.intervalS
    let t =
      this.nextFlit ?? (this.nextFlit = this.rng.range(f.first_offset_s[0], f.first_offset_s[1]))
    while (t < untilS) {
      this.flits.push({
        t,
        x: this.rng.range(-GAZE_TUNING.ampX, GAZE_TUNING.ampX),
        z: this.rng.range(-GAZE_TUNING.ampZ, GAZE_TUNING.ampZ),
      })
      // THE GATE. Clamped after the draw, not folded into it, so the floor holds
      // even if the range is ever retuned below it — and so the draw ORDER is
      // untouched, which is what keeps the whole schedule reproducible.
      t += Math.max(GAZE_TUNING.minGapS, this.rng.range(lo, hi))
    }
    this.nextFlit = t

    t =
      this.nextGlance ??
      (this.nextGlance = this.rng.range(g.first_offset_s[0], g.first_offset_s[1]))
    while (t < untilS) {
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
    this.nextGlance = t
    this.horizon = untilS
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
    // not. Extending on a horizon also keeps the layer DETERMINISTIC, which a
    // per-frame rebuild had quietly destroyed.
    if (tSeconds > this.horizon - SCHEDULE_MARGIN_S) {
      this.extend(tSeconds + SCHEDULE_HORIZON_S)
    }

    // A CURSOR, not a scan. The schedule now EXTENDS rather than rebuilds, so it
    // grows for as long as the page is open — about 1500 flits an hour — and
    // walking it from index 0 on every frame of every layer made the cost of the
    // gaze grow linearly with session length. `Blinker` always had this; this did
    // not. Entries behind the cursor are dropped, so the arrays stay small too.
    if (tSeconds < this.lastT) {
      // A seek (the parity harness rewinds). Re-find rather than walk backwards.
      this.flitCursor = 0
      this.glanceCursor = 0
    }
    this.lastT = tSeconds
    while (
      this.flitCursor + 1 < this.flits.length &&
      this.flits[this.flitCursor + 1].t <= tSeconds
    ) {
      this.flitCursor++
    }
    if (this.flitCursor > PRUNE_AT) {
      this.flits.splice(0, this.flitCursor)
      this.flitCursor = 0
    }
    const cur = this.flits[this.flitCursor]
    if (cur && cur.t <= tSeconds) {
      const u = Math.min(1, Math.max(0, (tSeconds - cur.t) / this.moveS))
      const e = u * u * (3 - 2 * u)
      out.gx = cur.x * e
      out.gz = cur.z * e
    }

    while (
      this.glanceCursor + 1 < this.glances.length &&
      this.glances[this.glanceCursor + 1].t <= tSeconds
    ) {
      this.glanceCursor++
    }
    if (this.glanceCursor > PRUNE_AT) {
      this.glances.splice(0, this.glanceCursor)
      this.glanceCursor = 0
    }
    if (!gazeLocked) {
      const g = this.glances[this.glanceCursor]
      if (g && tSeconds >= g.t && tSeconds <= g.t + g.hold / 1000) {
        out.gx = g.x
        out.gz = g.z
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
