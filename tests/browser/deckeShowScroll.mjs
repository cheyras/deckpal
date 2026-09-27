// WebKit can settle by a few CSS pixels after the navigation throw, before
// the flight starts. Counting those samples turns one throw into a "glide".
// Keep that measurement noise bounded in total, not an allowance per frame.
export const MAX_SETTLING_PX = 5
const RUN_NOISE_PX = 4

export function analyseScroll(frames, viewportHeight) {
  let jumps = 0, glides = 0, reversals = 0, settlingPx = 0
  let run = 0, still = 99, low = 0, high = 0, distance = 0
  let direction = 0, extreme = frames[0]?.y ?? 0
  const close = () => {
    if (run) {
      const travel = high - low
      if (travel <= RUN_NOISE_PX) settlingPx += distance
      else {
        // A wide run can still wobble: charge all travel beyond its range,
        // including tiny oscillations attached to the start/end of a glide.
        settlingPx += distance - travel
        if (run >= 3) glides++
        else jumps++
      }
    }
    run = 0
    distance = 0
  }
  for (let i = 1; i < frames.length; i++) {
    const y = frames[i].y, previous = frames[i - 1].y
    const dy = y - previous
    // Measure reversals from the furthest point reached, so a slow backwards
    // drift cannot disappear into a per-frame tolerance.
    if (!direction) {
      if (Math.abs(y - extreme) > RUN_NOISE_PX) {
        direction = Math.sign(y - extreme)
        extreme = y
      }
    } else if ((y - extreme) * direction > 0) extreme = y
    else if ((extreme - y) * direction > RUN_NOISE_PX) {
      reversals++
      direction *= -1
      extreme = y
    }
    if (Math.abs(dy) <= 0.5) { still++; continue }
    // throwNear only throws beyond half a viewport. Split it immediately:
    // adjacent 1px layout samples must not relabel that jump as a glide, and
    // two adjacent throws must still count as two jumps.
    if (Math.abs(dy) > viewportHeight / 2) {
      close()
      jumps++
      still = 99
      continue
    }
    if (still >= 4) close()
    if (!run) low = high = previous
    low = Math.min(low, y)
    high = Math.max(high, y)
    still = 0
    run++
    distance += Math.abs(dy)
  }
  close()
  return { jumps, glides, reversals, settlingPx }
}
