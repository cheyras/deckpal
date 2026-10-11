// The look and the look re-arm (engine/look.ts, ui/rearm.ts): a different card
// put down where the last one was is a new card; the same card still there,
// or one still sliding into place, or one whose capture came out turned, is not.
import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { Quad } from '../../engine/contract'
import type { ImageDataLike } from '../../engine/geometry'
import * as rect from '../../engine/rectify'
import { captureLook, cardLook, lookDistance } from '../../engine/look'
import { createLookRearm, REARM_NEW_MIN, REARM_STEADY_MAX } from '../rearm'

const N = 416

/** A canonical frame with a "card" in the quad's box: a colour field and a few
 *  blobs whose placement is the card's layout (its art). */
function scene(
  seed: number,
  opts: { exposure?: number; shift?: number } = {},
): { img: ImageDataLike; quad: Quad } {
  const data = new Uint8ClampedArray(N * N * 4)
  const rnd = (() => {
    let s = seed * 9301 + 49297
    return () => ((s = (s * 9301 + 49297) % 233280) / 233280)
  })()
  const base = [rnd() * 255, rnd() * 255, rnd() * 255]
  const blobs = Array.from({ length: 6 }, () => ({
    x: 120 + rnd() * 170,
    y: 60 + rnd() * 290,
    r: 20 + rnd() * 40,
    c: [rnd() * 255, rnd() * 255, rnd() * 255],
  }))
  const k = opts.exposure ?? 1
  const dx = opts.shift ?? 0
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const o = (y * N + x) * 4
      let c = [40, 40, 40]
      if (x >= 108 + dx && x < 308 + dx && y >= 40 && y < 376) {
        c = base
        for (const b of blobs) if ((x - dx - b.x) ** 2 + (y - b.y) ** 2 < b.r ** 2) c = b.c
      }
      data[o] = c[0] * k
      data[o + 1] = c[1] * k
      data[o + 2] = c[2] * k
      data[o + 3] = 255
    }
  }
  const q: Quad = [
    [108 + dx, 40],
    [308 + dx, 40],
    [308 + dx, 376],
    [108 + dx, 376],
  ]
  return { img: { width: N, height: N, data }, quad: q }
}

const lookOf = (seed: number, opts?: { exposure?: number; shift?: number }) => {
  const s = scene(seed, opts)
  const l = cardLook(s.img, s.quad)
  assert.ok(l)
  return l!
}

test('the same card reads as the same look, across exposure and a small slip of the quad', () => {
  const a = lookOf(1)
  assert.equal(lookDistance(a, a), 0)
  assert.ok(lookDistance(a, lookOf(1, { exposure: 0.8 })) < REARM_STEADY_MAX, 'a passing shadow is the same card')
  assert.ok(lookDistance(a, lookOf(1, { shift: 3 })) < REARM_STEADY_MAX, 'tracker jitter is the same card')
})

test('a different card reads as a different look', () => {
  const a = lookOf(1)
  for (const seed of [2, 3, 4, 5]) {
    assert.ok(lookDistance(a, lookOf(seed)) > REARM_NEW_MIN, `card ${seed} vs card 1: ${lookDistance(a, lookOf(seed)).toFixed(2)}`)
  }
})

test('a new card swapped onto the same track fires once it has held, judged against the capture on that track', () => {
  const r = createLookRearm()
  const one = lookOf(1)
  const two = lookOf(2)
  r.judge(7, one, [])
  r.note(one, 7) // card 1 captured on track 7
  const refusedBy = () => [r.lookOfTrack(7)]
  assert.equal(r.judge(7, one, refusedBy()), false, 'card 1 still there: the card captured here')
  assert.equal(r.judge(7, two, refusedBy()), false, 'card 2 has only just appeared: not steady yet')
  assert.equal(r.judge(7, two, refusedBy()), true, 'card 2 has held: a new card')
  r.note(two, 7) // ...and once captured, it is what the track is compared with
  assert.equal(r.judge(7, two, refusedBy()), false)
})

test('a look still changing tick to tick is not judged — the slide between two cards', () => {
  const r = createLookRearm()
  r.note(lookOf(1), 7)
  const refusers = [r.lookOfTrack(7)]
  r.judge(7, lookOf(2), refusers)
  assert.equal(r.judge(7, lookOf(3), refusers), false)
  assert.equal(r.judge(7, lookOf(4), refusers), false)
})

test('steadiness is per track: a lock that moved to another track starts over, a blink does not', () => {
  const r = createLookRearm()
  const ref = [lookOf(1)]
  r.judge(7, lookOf(2), ref)
  assert.equal(r.judge(8, lookOf(2), ref), false, 'first tick of track 8')
  assert.equal(r.judge(8, lookOf(2), ref), true)
  assert.equal(r.judge(null, null, []), false, 'no lock, no verdict')
  assert.equal(r.judge(8, lookOf(2), ref), true, 'a lock that blinked off for a coasting tick is still the same steady look')
  assert.equal(r.judge(8, lookOf(3), ref), false, 'but a changed look on it is not steady')
})

test('only the captures behind the refusal are asked — a look-alike captured elsewhere does not refuse', () => {
  const r = createLookRearm()
  const one = lookOf(1)
  r.judge(7, one, [])
  // Card 1 was captured long ago on another track, in another place: not a refuser.
  r.note(one, 3)
  // Here, card 2 was captured on track 7, and card 1 is now swapped in.
  r.note(lookOf(2), 7)
  r.judge(7, one, [r.lookOfTrack(7)])
  assert.equal(r.judge(7, one, [r.lookOfTrack(7)]), true, 'card 1 is not the card captured HERE')
})

test('a card held for a minute is never new — its capture refuses for as long as it refuses', () => {
  const r = createLookRearm()
  const one = lookOf(1)
  r.note(one, 7)
  r.judge(7, one, [r.lookOfTrack(7)])
  for (let i = 0; i < 500; i++) assert.equal(r.judge(7, one, [r.lookOfTrack(7)]), false)
})

test('cannot tell refuses: no refuser, or a refuser without a look, keeps the refusal', () => {
  const r = createLookRearm()
  r.judge(1, lookOf(1), [])
  assert.equal(r.judge(1, lookOf(1), []), false, 'not refused, nothing to license')
  assert.equal(r.judge(1, lookOf(1), [null]), false, 'a capture noted without a look')
  assert.equal(r.judge(1, lookOf(1), [lookOf(2), null]), false, 'one unknown among them is enough')
  r.note(null, 9)
  assert.equal(r.lookOfTrack(9), null)
})

test('the look of the captured pixels matches a later tick of the same card', () => {
  // captureLook reads the rectified capture (card + CAPTURE_MARGIN, full res);
  // cardLook reads the working image. Same card, same look.
  const s = scene(1)
  const { rectifyImageData, expandQuad, CAPTURE_MARGIN } = rect
  const raw = rectifyImageData(s.img, expandQuad(s.quad, CAPTURE_MARGIN), 480, 670)!
  const fromCapture = captureLook(raw)!
  assert.ok(lookDistance(fromCapture, lookOf(1)) < REARM_STEADY_MAX)
  assert.ok(lookDistance(fromCapture, lookOf(2)) > REARM_NEW_MIN)
})

/** The capture() of scene `seed` when the corner order came out `turn` quarter
 *  turns off (orderQuadForCard picks the top-left by position, so a card lying
 *  past 45° is warped sideways or upside down): the expanded quad warped from
 *  corner `turn` instead of the card's own top-left, at the device's 480x670. */
function capturedTurned(seed: number, turn: number) {
  const s = scene(seed)
  const q = rect.expandQuad(s.quad, rect.CAPTURE_MARGIN)
  const ordered = [0, 1, 2, 3].map((i) => q[(i + turn) % 4]) as Quad
  return rect.warpQuad(s.img, ordered, 480, 670)!
}

test('a capture carries its four quarter turns; turn 0 is byte for byte the look of the capture as taken', async () => {
  const { LOOK_BYTES, LOOK_TURNS, lookTurns } = await import('../../engine/look')
  const raw = capturedTurned(1, 0)
  const look = captureLook(raw)!
  assert.equal(lookTurns(look), LOOK_TURNS)
  assert.equal(lookTurns(lookOf(1)), 1, "a tick's look is just itself")
  // What captureLook was before it carried turns: cardLook of the card's rectangle inside the margin.
  const m = rect.CAPTURE_MARGIN
  const mx = (raw.width * m) / (1 + 2 * m)
  const my = (raw.height * m) / (1 + 2 * m)
  const inner: Quad = [
    [mx, my],
    [raw.width - mx, my],
    [raw.width - mx, raw.height - my],
    [mx, raw.height - my],
  ]
  assert.deepEqual(look.subarray(0, LOOK_BYTES), cardLook(raw, inner))
})

test('a capture that came out sideways or upside down still matches its card — and no other', async () => {
  const { LOOK_BYTES, LOOK_TURN_COST } = await import('../../engine/look')
  for (const turn of [1, 2, 3]) {
    const look = captureLook(capturedTurned(1, turn))!
    // The bug this fixes: read as taken, the turned capture is "a different card".
    assert.ok(lookDistance(look.subarray(0, LOOK_BYTES), lookOf(1)) > REARM_NEW_MIN, `turn ${turn}, as taken`)
    const d = lookDistance(lookOf(1), look)
    assert.ok(d <= LOOK_TURN_COST + REARM_STEADY_MAX, `turn ${turn}: ${d.toFixed(2)}`)
    assert.ok(d >= LOOK_TURN_COST, 'a turn other than the capture as taken costs LOOK_TURN_COST')
    assert.equal(lookDistance(look, lookOf(1)), d, 'either way round')
    for (const seed of [2, 3, 4, 5]) {
      const other = lookDistance(lookOf(seed), look)
      assert.ok(other > REARM_NEW_MIN, `card ${seed} vs card 1 captured at turn ${turn}: ${other.toFixed(2)}`)
    }
  }
  // ...and an upright capture of card 1 is no nearer to another card at any of its turns.
  for (const seed of [2, 3, 4, 5]) assert.ok(lookDistance(lookOf(seed), captureLook(capturedTurned(1, 0))!) > REARM_NEW_MIN)
})

test('the re-arm does not re-capture a card whose capture came out sideways (owner session 1, Marill)', () => {
  const r = createLookRearm()
  r.judge(7, lookOf(1), [])
  r.note(captureLook(capturedTurned(1, 1)), 7)
  const refusedBy = () => [r.lookOfTrack(7)]
  for (let i = 0; i < 20; i++) assert.equal(r.judge(7, lookOf(1), refusedBy()), false, 'card 1, still there, upright now')
  assert.equal(r.judge(7, lookOf(2), refusedBy()), false, 'card 2, not yet steady')
  assert.equal(r.judge(7, lookOf(2), refusedBy()), true, 'card 2, steady: a new card')
})

test('a card lying near 45 degrees has no look — its corner order is a coin toss', async () => {
  const { orderUndecided } = await import('../../engine/look')
  const rot = (deg: number): Quad => {
    const a = (deg * Math.PI) / 180
    const c = [208, 208]
    const corners: Array<[number, number]> = [
      [-100, -140],
      [100, -140],
      [100, 140],
      [-100, 140],
    ]
    return corners.map(([x, y]) => [c[0] + x * Math.cos(a) - y * Math.sin(a), c[1] + x * Math.sin(a) + y * Math.cos(a)]) as Quad
  }
  assert.equal(orderUndecided(rot(0)), false)
  assert.equal(orderUndecided(rot(20)), false)
  assert.equal(orderUndecided(rot(45)), true)
  assert.equal(orderUndecided(rot(44)), true)
  assert.equal(orderUndecided(rot(-45)), true)
  assert.equal(orderUndecided(rot(70)), false)
  const s = scene(1)
  assert.equal(cardLook(s.img, rot(45)), null, 'no look, so the re-arm cannot fire on it')
})

test('a spot asks only its newest captures — a long stack does not pile up refusers', async () => {
  const { createCapturedRegions, REGION_LOOKS_ASKED } = await import('../regions')
  const R = createCapturedRegions()
  const q = scene(1).quad
  for (let i = 0; i < 30; i++) {
    R.note(q, 7, i * 400, lookOf(i + 1))
    R.tick(i * 400 + 120, [{ id: 7, quad: q }])
  }
  const asked = R.suppressingLooks(q)
  assert.equal(asked.length, REGION_LOOKS_ASKED)
  assert.equal(lookDistance(asked[asked.length - 1]!, lookOf(30)), 0, 'the newest capture is always asked')
})

test('decideAutoCapture: the shipping rule, clause by clause', async () => {
  const { decideAutoCapture } = await import('../autoCapture')
  const { createCapturedRegions } = await import('../regions')
  const regions = createCapturedRegions()
  const rearm = createLookRearm()
  const refractory = new Set<number>()
  const lock = { id: 7, quad: scene(1).quad }
  const one = lookOf(1)
  const two = lookOf(2)
  const m = (busy = false) => ({ refractory, busy, regions, rearm })
  assert.equal(decideAutoCapture(null, null, m()).fire, false, 'no lock')
  assert.equal(decideAutoCapture(lock, one, m(true)).fire, false, 'busy')
  assert.deepEqual(decideAutoCapture(lock, one, m()), { fire: true, repeat: false, newByLook: false }, 'a fresh lock fires')
  // ...it was captured:
  refractory.add(7)
  regions.note(lock.quad, 7, 0, one)
  rearm.note(one, 7)
  assert.equal(decideAutoCapture(lock, one, m()).fire, false, 'the same card, still there')
  assert.equal(decideAutoCapture(lock, two, m()).fire, false, 'a new card, not yet steady')
  assert.deepEqual(decideAutoCapture(lock, two, m()), { fire: true, repeat: true, newByLook: true }, 'a new card, steady')
  assert.equal(decideAutoCapture(lock, two, m(true)).fire, false, 'busy still waits')
})
