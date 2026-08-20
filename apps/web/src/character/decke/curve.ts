/**
 * Curve evaluation for authored beats.
 *
 * WHY THIS IS NOT "just a bezier":
 *
 * The animation was authored in Blender as F-curves with per-keyframe bezier
 * handles. Reproducing that faithfully is harder than it looks, and an
 * adversarial review caught an earlier version of this file getting it wrong in
 * four separate ways. For the record, Blender's AUTO_CLAMPED rule is NOT
 * "handles at 1/3 the interval along the neighbour slope":
 *
 *   - the handle length is `interval / 2.5614` (~0.3904), not 1/3;
 *   - the slope is the MEAN OF THE TWO ONE-SIDED SECANTS, not the neighbour
 *     slope, and not Catmull-Rom's `(y2-y0)/(x2-x0)` — which differ whenever
 *     the spacing is uneven, and these beats are very unevenly spaced (`happy`
 *     has adjacent 100 ms and 900 ms gaps);
 *   - AUTO_CLAMPED additionally clamps each handle's y to the neighbouring key
 *     value so the curve can never overshoot a key it passes through;
 *   - terminal keys get HORIZONTAL handles, which is where the ease at every
 *     clip boundary comes from.
 *
 * And even that may not be what the file evaluates: every F-curve carries an
 * `auto_smoothing` mode, and "Continuous Acceleration" replaces the local
 * per-triple rule with a global tridiagonal solve over the whole curve.
 *
 * So we do not reimplement the rule at all. `handle_left`/`handle_right` are
 * stored in the .blend as POST-SOLVE absolute coordinates regardless of
 * smoothing mode, so the exact path here evaluates a plain cubic bezier from
 * given handles. That is correct by construction and immune to the question.
 *
 * The fallback below is used only for beats that have no dumped handles yet. It
 * is deliberately a monotone cubic (Fritsch-Carlson) rather than a guess at
 * Blender's rule: it is well-defined, it cannot overshoot a plateau, and it is
 * honestly labelled as an approximation instead of pretending to be exact.
 */

/** A keyframe. `hl`/`hr` are ABSOLUTE (time, value) handle coordinates as stored
 *  by Blender — not offsets, not tangents. */
export type Key = {
  t: number
  v: number
  hl?: [number, number]
  hr?: [number, number]
  interp: 'ease' | 'lin' | 'step'
}

/**
 * Blender's `correct_bezpart`: if the two handles' combined x-extent exceeds the
 * segment width, scale BOTH down proportionally.
 *
 * Without this a segment can double back on itself in time, and the x-for-t
 * solve below stops having a unique answer. Blender applies this at evaluation
 * time, not at authoring time, so the stored handles may well need it.
 */
function correctBezpart(
  x1: number, y1: number,
  x2: number, y2: number,
  x3: number, y3: number,
  x4: number, y4: number,
): [number, number, number, number] {
  const h1x = x1 - x2
  const h1y = y1 - y2
  const h2x = x4 - x3
  const h2y = y4 - y3
  const len = x4 - x1
  const len1 = Math.abs(h1x)
  const len2 = Math.abs(h2x)
  if (len1 + len2 === 0) return [x2, y2, x3, y3]
  if (len1 + len2 > len) {
    const fac = len / (len1 + len2)
    return [x1 - h1x * fac, y1 - h1y * fac, x4 - h2x * fac, y4 - h2y * fac]
  }
  return [x2, y2, x3, y3]
}

const cubic = (a: number, b: number, c: number, d: number, t: number) => {
  const mt = 1 - t
  return mt * mt * mt * a + 3 * mt * mt * t * b + 3 * mt * t * t * c + t * t * t * d
}

/**
 * Solve the x-cubic for the parameter t, then read y.
 *
 * A bezier F-curve is parametric: x is itself a cubic in t, so you cannot use
 * the normalised time directly as t — that is the classic mistake and it shifts
 * every eased beat. Newton with a bisection guard converges in a handful of
 * iterations and never escapes the bracket.
 */
function solveBezier(
  x1: number, y1: number, x2: number, y2: number,
  x3: number, y3: number, x4: number, y4: number,
  x: number,
): number {
  ;[x2, y2, x3, y3] = correctBezpart(x1, y1, x2, y2, x3, y3, x4, y4)

  let lo = 0
  let hi = 1
  let t = (x - x1) / (x4 - x1 || 1) // a good first guess: the linear parameter

  for (let i = 0; i < 32; i++) {
    const xt = cubic(x1, x2, x3, x4, t)
    const err = xt - x
    if (Math.abs(err) < 1e-9) break
    if (err > 0) hi = t
    else lo = t

    // dx/dt
    const mt = 1 - t
    const d =
      3 * mt * mt * (x2 - x1) + 6 * mt * t * (x3 - x2) + 3 * t * t * (x4 - x3)
    const next = d !== 0 ? t - err / d : (lo + hi) / 2
    t = next > lo && next < hi ? next : (lo + hi) / 2
  }

  return cubic(y1, y2, y3, y4, t)
}

/**
 * Fritsch-Carlson monotone cubic tangents.
 *
 * APPROXIMATION — this is NOT Blender's AUTO_CLAMPED rule. It is used only for
 * beats that carry no dumped handles. It is chosen because it shares the one
 * property that actually matters visually here: it never overshoots a plateau,
 * and the beat data is full of deliberate plateaus (`happy` holds 500-1400 ms,
 * every alert holds through its freeze). A Catmull-Rom or unclamped bezier
 * bulges straight through those and reads as a wobble on a held pose.
 */
/**
 * @param cyclic Treat the last key as the SAME INSTANT as the first, so the
 *   curve's velocity flows through the seam instead of stopping dead at it.
 *
 * A looped window is a closed curve, and the two ends of it are not two terminal
 * keys — they are one interior key visited twice. Giving them the terminal
 * horizontal handle is what makes a loop stall on every wrap; giving them two
 * DIFFERENT interior tangents is what makes it kick. The seam tangent is
 * computed from the two secants either side of the wrap, by exactly the rule the
 * interior keys use, so a plateau still flattens (opposite signs -> zero, which
 * is the correct answer at `thinking`'s rock reversal) and a motion that
 * genuinely continues through the seam keeps its speed.
 */
function monotoneTangents(keys: Key[], cyclic = false): number[] {
  const n = keys.length
  const m = new Array<number>(n).fill(0)
  if (n < 2) return m

  const dx: number[] = []
  const slope: number[] = []
  for (let i = 0; i < n - 1; i++) {
    const h = keys[i + 1].t - keys[i].t
    dx.push(h)
    slope.push(h === 0 ? 0 : (keys[i + 1].v - keys[i].v) / h)
  }

  // Terminal keys get zero tangent, matching Blender's horizontal end handles.
  // A cyclic curve overrides this below: its ends are not terminal.
  m[0] = 0
  m[n - 1] = 0
  if (cyclic && n >= 3) m[0] = m[n - 1] = cyclicSeamTangent(keys)
  for (let i = 1; i < n - 1; i++) {
    const s0 = slope[i - 1]
    const s1 = slope[i]
    // A sign change (or a flat neighbour) is a local extremum: flatten it.
    m[i] = s0 * s1 <= 0 ? 0 : (s0 + s1) / 2
  }
  // Enforce monotonicity so the curve cannot overshoot either bracketing key.
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) {
      m[i] = 0
      m[i + 1] = 0
      continue
    }
    const a = m[i] / slope[i]
    const b = m[i + 1] / slope[i]
    const s = a * a + b * b
    if (s > 9) {
      const tau = 3 / Math.sqrt(s)
      m[i] = tau * a * slope[i]
      m[i + 1] = tau * b * slope[i]
    }
  }
  if (cyclic && n >= 3) {
    // Re-symmetrise AFTER the monotonicity pass, which clamps the first and last
    // segments against different neighbours and so can pull the two ends of the
    // seam apart again. Taking the smaller magnitude keeps whichever clamp was
    // the stricter one, so neither end segment can overshoot.
    const a = m[0]
    const b = m[n - 1]
    const same = a * b > 0
    m[0] = m[n - 1] = same ? (Math.abs(a) < Math.abs(b) ? a : b) : 0
  }
  return m
}

/** The seam tangent: the interior rule, applied across the wrap. */
function cyclicSeamTangent(keys: Key[]): number {
  const n = keys.length
  const dxPrev = keys[n - 1].t - keys[n - 2].t
  const dxNext = keys[1].t - keys[0].t
  const sPrev = dxPrev === 0 ? 0 : (keys[n - 1].v - keys[n - 2].v) / dxPrev
  const sNext = dxNext === 0 ? 0 : (keys[1].v - keys[0].v) / dxNext
  // A sign change (or a flat neighbour) is a local extremum: flatten it. Same
  // rule as the interior keys, and it is the RIGHT answer at a wrap — a rock
  // that reverses at the seam should reverse, not carry speed through it.
  return sPrev * sNext <= 0 ? 0 : (sPrev + sNext) / 2
}

/** Blender's bezier handle for a key with tangent `m`, one third of the way
 *  along the segment. The cubic Hermite/Bezier identity, so an exact curve and
 *  an approximated one get the SAME seam. */
function handleFor(t: number, v: number, m: number, dt: number): [number, number] {
  return [t + dt / 3, v + (m * dt) / 3]
}

export type Curve = {
  keys: Key[]
  /** True when every eased key carried dumped handles, i.e. this curve is exact
   *  rather than approximated. Surfaced so the dev page can show it. */
  exact: boolean
  tangents?: number[]
  /** The last key is the same instant as the first. See `monotoneTangents`. */
  cyclic?: boolean
}

export type CurveOptions = {
  /** The curve LOOPS: its last key is the first key come round again, so the
   *  seam gets one shared interior tangent instead of two terminal ones. The
   *  caller is responsible for the two end VALUES agreeing; this only makes the
   *  velocity agree. */
  cyclic?: boolean
}

export function makeCurve(keys: Key[], opts: CurveOptions = {}): Curve {
  const eased = keys.filter((k) => k.interp === 'ease')
  const exact = eased.length === 0 || eased.every((k) => k.hl && k.hr)
  const cyclic = !!opts.cyclic && keys.length >= 3
  // TANGENTS ARE ALWAYS COMPUTED, even for an exact curve. `exact` only promises
  // that every EASED key carries handles, and `evalCurve` falls through to the
  // Hermite path for any segment whose two ends do not BOTH have them — which an
  // eased key followed by a handleless `lin` or `step` key satisfies. That
  // combination does not occur in today's data, and if it ever did the
  // non-null assertion on `tangents` would be a TypeError inside the render
  // loop. Computing them is a few microseconds at load.
  if (!cyclic) {
    return { keys, exact, tangents: monotoneTangents(keys) }
  }
  if (!exact) {
    return { keys, exact, cyclic, tangents: monotoneTangents(keys, true) }
  }
  // An EXACT curve carries authored handles, and the two at the seam were
  // authored for the neighbours the window cut away. Rewrite just those two from
  // the cyclic tangent — on COPIES, because the key objects are shared with the
  // source clip and mutating them would silently re-shape the unlooped state.
  const n = keys.length
  const m = cyclicSeamTangent(keys)
  const out = keys.slice()
  const first = { ...out[0] }
  const last = { ...out[n - 1] }
  first.hr = handleFor(first.t, first.v, m, keys[1].t - first.t)
  last.hl = handleFor(last.t, last.v, m, keys[n - 2].t - last.t)
  out[0] = first
  out[n - 1] = last
  // NOT DEAD CODE, AND IT MUST NOT BE DELETED. Nothing reaches this branch
  // today, because the generated playbook carries no handles and `cards.ts` never
  // asks for a cyclic curve. It exists for the day the playbook generator starts
  // dumping Blender's handles — which is a stated goal, since it is the
  // difference between exact curves and the documented approximation. On that
  // day every sustain would silently go back to two terminal handles at the
  // seam, i.e. to the pop this whole mechanism removes, and nothing would fail.
  return { keys: out, exact, cyclic, tangents: monotoneTangents(out, true) }
}

/** Evaluate a curve at time `t` (same units as the keys — milliseconds here). */
export function evalCurve(curve: Curve, t: number): number {
  const { keys } = curve
  const n = keys.length
  if (n === 0) return 0
  if (n === 1 || t <= keys[0].t) return keys[0].v
  if (t >= keys[n - 1].t) return keys[n - 1].v

  // Binary search for the segment.
  let lo = 0
  let hi = n - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (keys[mid].t <= t) lo = mid
    else hi = mid
  }
  const k0 = keys[lo]
  const k1 = keys[hi]

  // The interpolation mode of the LEFT key governs the segment — that is
  // Blender's rule, and it is what makes the "robot register" work: a `step`
  // key holds its value until the next key regardless of what follows.
  if (k0.interp === 'step') return k0.v

  const span = k1.t - k0.t
  if (span <= 0) return k1.v
  const u = (t - k0.t) / span

  if (k0.interp === 'lin') return k0.v + (k1.v - k0.v) * u

  if (k0.hr && k1.hl) {
    return solveBezier(
      k0.t, k0.v,
      k0.hr[0], k0.hr[1],
      k1.hl[0], k1.hl[1],
      k1.t, k1.v,
      t,
    )
  }

  // Fallback: monotone cubic Hermite.
  const m = curve.tangents!
  const h00 = 2 * u ** 3 - 3 * u ** 2 + 1
  const h10 = u ** 3 - 2 * u ** 2 + u
  const h01 = -2 * u ** 3 + 3 * u ** 2
  const h11 = u ** 3 - u ** 2
  return h00 * k0.v + h10 * span * m[lo] + h01 * k1.v + h11 * span * m[hi]
}
