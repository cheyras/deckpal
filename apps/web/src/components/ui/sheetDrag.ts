/**
 * The physics of dragging a sheet, as pure functions.
 *
 * Kept out of Sheet.tsx so the numbers can be tested without a browser, and so
 * the decisions — when a let-go sheet leaves, how it travels when it does, how
 * it comes back when it does not — are written down in one place instead of
 * being implied by an event handler.
 *
 * Every rule here is borrowed from how iOS treats the same gesture, because the
 * owner's ask was "as close to native" and native is a specific, documented
 * thing: the projection and deceleration rate are UIScrollView's, the rubber
 * band is UIScrollView's, and the spring is parameterised the way SwiftUI's
 * `.spring(response:dampingFraction:)` is.
 */

// ── Following the finger ─────────────────────────────────────────────────────

/**
 * Rubber band: how far a surface moves when pulled `overshoot` px past where it
 * is allowed to go. iOS's formula — the further you pull the less it gives, and
 * it can never give more than `dimension`. Used for pulling a sheet UP past its
 * resting height, which is not a direction it can go, so it gives a little and
 * pulls back.
 */
export function rubberband(overshoot: number, dimension: number, constant = 0.55): number {
  if (overshoot <= 0 || dimension <= 0) return 0
  return (1 - 1 / ((overshoot * constant) / dimension + 1)) * dimension
}

/**
 * Where the sheet sits for a finger that has moved `dy` px since the drag began
 * (positive is down), starting from `origin` (non-zero when the drag caught the
 * sheet mid-entrance). Down tracks the finger 1:1 — that is what makes a sheet
 * feel held rather than nudged. Up is a rubber band against a short limit.
 */
export function dragOffset(origin: number, dy: number, upLimit = 64): number {
  const raw = origin + dy
  return raw >= 0 ? raw : -rubberband(-raw, upLimit)
}

// ── Velocity ─────────────────────────────────────────────────────────────────

interface Sample {
  t: number
  y: number
}

/**
 * Release velocity from recent pointer samples, in px/ms (positive is down).
 *
 * Only the last `windowMs` count. The whole gesture would average a slow start
 * into a fast flick, and the last pair alone is noise (two events can land a
 * millisecond apart). A finger that stopped and then lifted reports zero: if
 * the newest sample is older than the window, nothing is moving.
 */
export function createVelocityTracker(windowMs = 80) {
  let samples: Sample[] = []
  return {
    reset() {
      samples = []
    },
    add(t: number, y: number) {
      samples.push({ t, y })
      const cutoff = t - windowMs * 2
      while (samples.length > 2 && samples[0].t < cutoff) samples.shift()
    },
    velocity(now: number): number {
      if (samples.length < 2) return 0
      const last = samples[samples.length - 1]
      if (now - last.t > windowMs) return 0
      let first = samples[0]
      for (const s of samples) {
        if (last.t - s.t <= windowMs) {
          first = s
          break
        }
      }
      const dt = last.t - first.t
      return dt > 0 ? (last.y - first.y) / dt : 0
    },
  }
}

// ── Letting go ───────────────────────────────────────────────────────────────

/** UIScrollView's normal deceleration rate, per millisecond. */
export const DECELERATION_RATE = 0.998

/**
 * How much further a throw at `velocity` (px/ms) would carry before friction
 * stopped it. Apple's projection, from "Designing Fluid Interfaces": a
 * 1000 px/s flick carries about 500px.
 */
export function project(velocity: number, rate = DECELERATION_RATE): number {
  return (velocity * rate) / (1 - rate)
}

/** A flick at least this fast (px/ms, downward) dismisses wherever it started. */
export const FLICK_VELOCITY = 0.4
/** …and a release moving back up this fast never does. */
export const RETURN_VELOCITY = -0.15
/** Where a projected release has to land, as a share of the sheet's height. */
export const DISMISS_FRACTION = 0.35

/**
 * Does a let-go sheet leave, or come back?
 *
 * By where the throw would LAND, not where the finger happened to be: a short
 * fast flick dismisses, a long slow drag that is then eased back up does not,
 * and both are what a hand expects. The flick floor is there because a quick
 * downward swipe on a tall sheet is an unambiguous "go away" even when its
 * projection falls short of the line.
 */
export function releaseDecision({
  offset,
  velocity,
  height,
}: {
  offset: number
  velocity: number
  height: number
}): 'dismiss' | 'restore' {
  if (offset <= 0) return 'restore'
  if (velocity <= RETURN_VELOCITY) return 'restore'
  if (velocity >= FLICK_VELOCITY) return 'dismiss'
  return offset + project(Math.max(0, velocity)) > height * DISMISS_FRACTION ? 'dismiss' : 'restore'
}

// ── Travelling after release ─────────────────────────────────────────────────

/**
 * A damped spring, as a CSS `linear()` easing plus the duration it needs.
 *
 * WHY A SPRING. The sheet is let go MOVING. A fixed curve starts from rest, so
 * a sheet released at speed would visibly stop dead and then start again in
 * the other direction — the "choppy" the owner felt. A spring takes the
 * release velocity as its starting condition, so the motion that follows is
 * continuous with the motion the finger was making.
 *
 * `response` is roughly the period in seconds and `damping` the fraction of
 * critical damping — SwiftUI's two spring parameters. 1 never overshoots.
 *
 * `from`/`to` are positions in px and `velocity` is px/ms in the same
 * direction as them. The easing describes progress from `from` (0) to `to`
 * (1), and may briefly exceed 1 when the spring overshoots.
 */
export function springEasing({
  from,
  to,
  velocity,
  response = 0.38,
  damping = 0.86,
  maxMs = 900,
  clampOvershoot = false,
}: {
  from: number
  to: number
  velocity: number
  response?: number
  damping?: number
  maxMs?: number
  /** Stop AT the target rather than swinging past it. */
  clampOvershoot?: boolean
}): { easing: string; duration: number } {
  const distance = to - from
  if (Math.abs(distance) < 0.5) return { easing: 'linear', duration: 0 }
  const omega = (2 * Math.PI) / response // rad/s
  const k = omega * omega
  const c = 2 * damping * omega
  // Simulate the DISPLACEMENT from the target, in px and px/s.
  let x = -distance
  let v = velocity * 1000
  const dt = 1 / 240
  const points: number[] = [0]
  let t = 0
  const restPx = 0.5
  while (t * 1000 < maxMs) {
    // Semi-implicit Euler: stable at this step for these stiffnesses.
    v += (-k * x - c * v) * dt
    x += v * dt
    t += dt
    const p = 1 + x / distance
    if (clampOvershoot && p >= 1) break
    points.push(p)
    if (Math.abs(x) < restPx && Math.abs(v) < 20) break
  }
  const duration = Math.round(t * 1000)
  // ~60 stops is smooth to the eye and short enough to keep in a style.
  const step = Math.max(1, Math.ceil((points.length - 1) / 60))
  const stops: string[] = []
  for (let i = 0; i < points.length - 1; i += step) stops.push(fmt(points[i]))
  // It ends AT the target, exactly: the last simulated sample is within half a
  // pixel of it, and a rest that is half a pixel off is a blurry edge.
  stops.push('1')
  return { easing: `linear(${stops.join(', ')})`, duration }
}

/**
 * The fallback for engines without `linear()`: a cubic whose STARTING slope
 * matches the release velocity, then settles. Same continuity, no overshoot.
 */
export function velocityCubic({
  distance,
  velocity,
  duration,
}: {
  distance: number
  velocity: number
  duration: number
}): string {
  if (distance === 0 || duration <= 0) return 'linear'
  // Normalised initial slope: how much of the journey the release speed would
  // cover per unit of the animation's time.
  const slope = Math.max(0, (velocity * duration) / distance)
  const x1 = 0.3
  const y1 = Math.min(1, slope * x1)
  return `cubic-bezier(${x1}, ${fmt(y1)}, 0.3, 1)`
}

/**
 * How long a dismissal takes to clear `distance` px when let go at `velocity`.
 * Fast throws leave fast; a sheet that was merely pushed past the line glides
 * out at the token's own pace. Never slower than an ordinary exit.
 */
export function throwDuration(distance: number, velocity: number, min = 160, max = 280): number {
  if (distance <= 0) return min
  // A decelerating throw averages a bit under its starting speed.
  const speed = Math.max(velocity, 0.001) / 1.2
  return Math.round(Math.min(max, Math.max(min, distance / speed)))
}

function fmt(n: number): string {
  return String(Math.round(n * 10000) / 10000)
}
