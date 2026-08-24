/**
 * WHICH WAY HE GOES, AND WHEN HE SETS OFF.
 *
 * Two decisions that used to be constants and are now judgements, both filed
 * against C35 — *"And that needs to be, like, a smooth animation. Right now, it
 * wasn't. It kind of just, like, became big."*
 *
 *   1. `viaBackground` — is this hop worth routing through the far plane? Bare
 *      `flyTo` has asked since the distance threshold landed. `travelAfterRoute`
 *      answered `via: 'background'` unconditionally, which is the mechanism the
 *      brief names for the complaint.
 *   2. The settle — after a navigation, WAIT for the new page to stop moving
 *      before flying at it. The first mutation that resolves the selector is
 *      usually the skeleton, and landing on a skeleton is how he ended up "large,
 *      centred, over a loading spinner" in the complaint's own frames.
 *
 * ── A FAKE DOM, IN A SUITE THAT DELIBERATELY HAS NONE ────────────────────────
 *
 * `uiTools.test.ts` says in its header that the DOM branches are left to the
 * browser gates, and for the *authorisation* branches that is right — a fake
 * `closest()` proves nothing about what a real page does. The settle is a
 * different kind of claim. It is about ORDER AND TIMING — he must not fly on the
 * first mutation, he must fly after the churn stops, and he must re-resolve the
 * target at launch rather than trusting the match that armed the wait — and
 * those are exactly the properties a video capture is worst at pinning and a
 * fake clock is best at. So the fake here is deliberately tiny and models only
 * what the sequencing touches.
 *
 * Node's test runner gives each file its own process, so the globals installed
 * below do not reach any other suite.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { after, test } from 'node:test'
import { PerspectiveCamera, Vector3 } from 'three'

import {
  BACKGROUND_HOP_FRACTION,
  runUiTool,
  viaBackground,
  type UiToolContext,
} from '../uiTools'
import {
  BLENDER_CAMERA,
  BODY_H,
  blenderCameraQuaternion,
  blenderToThree,
} from '../../decke/constants'
import { homeCorner, parkOn, shapeFor, solvePark, type RectLike } from '../../decke/dom'
import { solveFlight } from '../../decke/flight'
import { setViewport } from '../../decke/viewport'

const UI_TOOLS_SRC = fileURLToPath(new URL('../uiTools.ts', import.meta.url))

// ── the pure threshold ───────────────────────────────────────────────────────

test('viaBackground: a third of the viewport away is the line', () => {
  const W = 1200
  const third = W * BACKGROUND_HOP_FRACTION
  // Measured from HIM when we know where he is, which is the whole point of the
  // first argument: the same target is a hop or a traverse depending on where he
  // is standing, and the shipped rule could not tell those apart.
  assert.equal(viaBackground(200, 200 + third + 1, W), true)
  assert.equal(viaBackground(200, 200 + third - 1, W), false)
  assert.equal(viaBackground(200, 200 - third - 1, W), true, 'the rule is symmetric')
  // Exactly on the line is NOT far. A strict comparison keeps the boundary in
  // one place instead of leaving it to whichever way a float rounded.
  assert.equal(viaBackground(200, 200 + third, W), false)
})

test('viaBackground: no known position falls back to the viewport centre', () => {
  // This is the SHIPPED rule, reproduced exactly. `screenRect()` returns null
  // until the model has a resolved position, and a character who has not loaded
  // yet must not change the answer to something new — he must get the answer
  // this code gave before it learned to ask him.
  const W = 900
  assert.equal(viaBackground(null, W / 2 + W / 3 + 1, W), true)
  assert.equal(viaBackground(null, W / 2 + W / 3 - 1, W), false)
})

test('viaBackground: nonsense in, straight there', () => {
  // A hop that cannot be measured is a hop that goes directly. The far-plane
  // round trip is the expensive answer — ten times the distance, played at the
  // top of the rate ramp — so it is the one that has to be EARNED, and a NaN
  // rect or a zero-width viewport has earned nothing.
  //
  // STATED HONESTLY: the NaN-target line below is not independently failable
  // against the current implementation, because every comparison with NaN is
  // already false. It is here as a BEHAVIOUR assertion — it would catch a
  // rewrite that special-cased an unmeasurable target into the expensive route —
  // not as cover for a guard, and there is deliberately no guard to cover.
  assert.equal(viaBackground(100, Number.NaN, 1000), false)
  assert.equal(viaBackground(100, 900, 0), false)
  assert.equal(viaBackground(100, 900, Number.NaN), false)
  // A `him` that is not a number is the same case as not knowing where he is —
  // it falls back to the viewport centre rather than quietly comparing against
  // NaN, which would make every hop "near" and delete the rule.
  for (const x of [500, 900, 100]) {
    assert.equal(
      viaBackground(Number.NaN, x, 1000),
      viaBackground(null, x, 1000),
      `an unmeasurable him must answer as the null case does, at target ${x}`,
    )
  }
})

test('the post-navigation flight no longer hard-codes the long way round', () => {
  // The C35 mechanism, pinned as a drift guard rather than as a behaviour: the
  // only place `'background'` may now appear is as the value chosen by the
  // shared decision. A literal `via: 'background'` anywhere in this file means
  // somebody has reintroduced an unconditional depth change.
  // Comments stripped first, and that is not fussiness: the file EXPLAINS the
  // old constant at length, quoting it, so a naive grep matches the explanation
  // and the guard fires on the very change it is guarding.
  const src = readFileSync(UI_TOOLS_SRC, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
  assert.equal(
    /via:\s*'background'/.test(src),
    false,
    "uiTools.ts hard-codes `via: 'background'` again — the whole of C35 is that " +
      'this must be a judgement about distance, not a constant',
  )
})

// ── the measurement the threshold is FOR ─────────────────────────────────────
//
// A threshold with no number behind it is a preference. These are the numbers,
// solved with the real flight solver at the shipped desktop framing, so that
// deleting the threshold costs somebody an argument rather than a diff.

const VIEW_W = 1440
const VIEW_H = 900
setViewport(VIEW_W, VIEW_H)

/** `characterHeightBeside(100, 1440, 900)` — a ~100px composer card. */
const CHAR_PX = Math.round(Math.min(100 * 2.9, VIEW_W * 0.28, VIEW_H * 0.24))

function shippedCamera(): PerspectiveCamera {
  const cam = new PerspectiveCamera(
    BLENDER_CAMERA.fovDeg,
    VIEW_W / VIEW_H,
    BLENDER_CAMERA.near,
    BLENDER_CAMERA.far,
  )
  cam.position.copy(
    blenderToThree(BLENDER_CAMERA.position.x, BLENDER_CAMERA.position.y, BLENDER_CAMERA.position.z),
  )
  cam.quaternion.copy(
    blenderCameraQuaternion(
      BLENDER_CAMERA.rotationEuler.x,
      BLENDER_CAMERA.rotationEuler.y,
      BLENDER_CAMERA.rotationEuler.z,
    ),
  )
  // `Stage.applyDolly`, restated: for a camera aimed at the origin, setting his
  // on-screen height is setting the length of the camera's position.
  const vFov = (cam.fov * Math.PI) / 180
  cam.position.setLength((BODY_H * VIEW_H) / (2 * CHAR_PX * Math.tan(vFov / 2)))
  cam.updateMatrixWorld(true)
  return cam
}

const cam = shippedCamera()
const baseDistance = cam.position.length()
const tanHalfFovY = Math.tan(((cam.fov * Math.PI) / 180) / 2)

const rectOf = (left: number, top: number, width: number, height: number): RectLike =>
  ({ left, top, width, height, right: left + width }) as RectLike

const standBeside = (r: RectLike, side: 'left' | 'auto' = 'auto') =>
  solvePark(cam, r as DOMRect, { depth: 'foreground', side, baseDistance }).position

/** What `flyTo(via: 'background')` inserts: the far plane, above the target. */
const farPlaneWaypoint = (r: RectLike) =>
  parkOn(cam, r.left + r.width / 2, r.top + r.height / 2, { depth: 'background', baseDistance })

/** Duration, and how far off vertical his body gets, for one solved leg. */
function fly(a: Vector3, b: Vector3, legIndex = 0, rate?: number) {
  const track = solveFlight(a, b, { camera: cam, tanHalfFovY, ...shapeFor(a, b, legIndex), rate })
  let peakTiltDeg = 0
  for (const s of track.samples) peakTiltDeg = Math.max(peakTiltDeg, Math.hypot(s.rx, s.ry))
  return { ms: track.durationMs, peakTiltDeg, worldUnits: a.distanceTo(b) }
}

test('a per-leg rate scales playback exactly, and nothing else', () => {
  // The chat open/close legs play at 2× — "I'd like that to be nice and
  // snappy" — and the whole point of `rate` living on the PLAYBACK side of
  // the solve is that it cannot change what was solved: same samples, same
  // path, same tilt, half the time. If this ever drifts, someone routed the
  // rate into the integrator, which is the knob that wakes the frame guard.
  const a = standBeside(rectOf(1000, 600, 300, 58), 'left')
  const b = homeCorner(cam, baseDistance)
  const plain = fly(a, b)
  const snappy = fly(a, b, 0, 2)
  assert.ok(plain.ms > 0, 'the premise: the leg takes time at all')
  assert.ok(
    Math.abs(snappy.ms - plain.ms / 2) < 1,
    `rate 2 must halve the duration: ${plain.ms.toFixed(1)} → ${snappy.ms.toFixed(1)}`,
  )
  assert.equal(
    snappy.peakTiltDeg.toFixed(6),
    plain.peakTiltDeg.toFixed(6),
    'playback speed must not touch the solved pose',
  )
})

test('the far-plane round trip costs multiples of the hop it replaces', () => {
  // The composer he stands beside, and a card near the middle of a page he has
  // just navigated to — the ordinary `goTo(route, selector)`.
  const composer = rectOf(420, 760, 620, 100)
  const card = rectOf(650, 330, 160, 220)

  const him = standBeside(composer, 'left')
  const waypoint = farPlaneWaypoint(card)
  const mark = standBeside(card)

  const straight = fly(him, mark)
  const out = fly(him, waypoint, 0)
  const back = fly(waypoint, mark, 1)
  const roundTrip = out.ms + back.ms

  // The engine's own note: "a depth change is 24-27 world units while every
  // same-depth leg is under 3." At this framing the hop is single digits and
  // each half of the round trip is thirty-odd.
  assert.ok(
    out.worldUnits > straight.worldUnits * 3,
    `the far-plane leg should dwarf the hop; got ${out.worldUnits.toFixed(1)} vs ${straight.worldUnits.toFixed(1)} units`,
  )
  assert.ok(
    roundTrip > straight.ms * 2,
    `going via the background should cost more than double; got ${roundTrip.toFixed(0)}ms vs ${straight.ms.toFixed(0)}ms`,
  )
  // And it is not only longer, it is more violent — which is the half the
  // complaint was actually about. `travelRate` plays a depth change at the top
  // of its ramp, and the lean follows acceleration.
  assert.ok(
    Math.max(out.peakTiltDeg, back.peakTiltDeg) > straight.peakTiltDeg,
    `the round trip should lean him further than the hop; got ${Math.max(out.peakTiltDeg, back.peakTiltDeg).toFixed(1)} vs ${straight.peakTiltDeg.toFixed(1)} degrees`,
  )
})

test('D8 is closed: the close and reopen legs bank without toppling', () => {
  // A GATE NOW. The previous version of this test was a recorded MEASUREMENT
  // that the defect was still present (`peakTiltDeg > 20` on both long legs),
  // with its own instruction: "if a future change to the lean law makes this
  // assertion fail, that is very likely GOOD NEWS — go and look at
  // `close-reopen` in the visual harness, and if he now reads as upright,
  // close D8 and delete this test." The 2026-08-24 animation pass made that
  // change (`flight.ts` — LEAD_MAX 34 → 12 and the body-curl clamp 0.72 →
  // 0.35, the acceleration law kept; apparent tilt is the SUM of the root
  // rotation and the curl morphs, the arithmetic the old numbers skipped), the
  // vision judge had read a frame of the old capture as "nearly upside-down
  // as it falls", and rather than deleting the test it is inverted: the same
  // two legs, the same measurement, pinned on the healthy side. 18 leaves
  // the law headroom without readmitting the band.
  const composer = rectOf(420, 760, 620, 100)
  const launcher = rectOf(1372, 832, 44, 44)

  const mark = standBeside(composer, 'left')
  const home = homeCorner(cam, baseDistance)
  const atLauncher = solvePark(cam, launcher as DOMRect, {
    depth: 'foreground',
    side: 'auto',
    baseDistance,
    centre: true,
  }).position

  const closing = fly(mark, home)
  const reopening = fly(atLauncher, mark)

  // The owner caught him "tilted roughly 25-35 degrees off vertical" on close
  // and "tilted the other way" on reopen. Neither leg may produce that band
  // again — and the legs must still be LONG, or this gate is testing a hop
  // too short to lean in the first place.
  for (const [name, leg] of [
    ['closing (returnHome)', closing],
    ['reopening (launcher → his mark)', reopening],
  ] as const) {
    assert.ok(
      leg.peakTiltDeg > 4,
      `${name}: a long leg with no lean at all reads as sliding; got ${leg.peakTiltDeg.toFixed(1)} degrees`,
    )
    assert.ok(
      leg.peakTiltDeg <= 18,
      `${name}: D8 is back — peak tilt ${leg.peakTiltDeg.toFixed(1)} degrees is past banking`,
    )
    assert.ok(
      leg.worldUnits > 5,
      `${name}: expected a long leg, the premise of the measurement; got ${leg.worldUnits.toFixed(1)} units`,
    )
  }
})

// ── the settle, against a fake page ──────────────────────────────────────────

type Mutate = () => void

/** The smallest page `travelAfterRoute` can be driven against. */
function installFakeDom(opts: { selector: string; left: number; width: number }) {
  const observers: (() => void)[] = []
  const el = {
    getBoundingClientRect: () => ({ left: opts.left, width: opts.width }),
    closest: (s: string) => (s === '[data-decke-landmark]' ? el : null),
  }
  const page = { present: false }

  const g = globalThis as unknown as Record<string, unknown>
  g.document = {
    body: {},
    querySelector: (s: string) => (s === opts.selector && page.present ? el : null),
  }
  g.window = {
    innerWidth: 1440,
    location: { pathname: '/series', href: 'https://deckpal.app/series' },
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clearTimeout: (id: unknown) => clearTimeout(id as ReturnType<typeof setTimeout>),
  }
  g.MutationObserver = class {
    #cb: () => void
    constructor(cb: () => void) {
      this.#cb = cb
    }
    observe() {
      observers.push(this.#cb)
    }
    disconnect() {
      const i = observers.indexOf(this.#cb)
      if (i >= 0) observers.splice(i, 1)
    }
  }

  const mutate: Mutate = () => {
    for (const cb of [...observers]) cb()
  }
  return { page, mutate, appear: () => { page.present = true } }
}

after(() => {
  const g = globalThis as unknown as Record<string, unknown>
  delete g.document
  delete g.window
  delete g.MutationObserver
})

/** A Deck-E that records what it was asked to do and nothing else. */
function fakeDecke(himScreenX: number | null) {
  const calls: { via: unknown; highlight: unknown }[] = []
  return {
    calls,
    decke: {
      getState: () => ({ flying: false }),
      screenRect: () =>
        himScreenX === null ? null : { left: himScreenX - 40, width: 80, top: 0, right: himScreenX + 40, bottom: 0, height: 0 },
      flyTo: (_t: unknown, o: { via?: unknown; highlight?: unknown }) =>
        calls.push({ via: o.via, highlight: o.highlight }),
    } as unknown as UiToolContext['decke'],
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

test('he does not set off on the first mutation — the page gets to settle', async () => {
  const dom = installFakeDom({ selector: '#grid', left: 600, width: 160 })
  const { calls, decke } = fakeDecke(400)
  const navigated: string[] = []
  const ctx: UiToolContext = { decke, navigate: (to) => navigated.push(to) }

  const pending = runUiTool(ctx, 'goTo', { route: '/decks', selector: '#grid' })
  assert.deepEqual(navigated, ['/decks'], 'the navigation itself is not deferred')

  // The skeleton appears. Under the old code this was the launch.
  dom.appear()
  dom.mutate()
  await sleep(40)
  assert.equal(calls.length, 0, 'he flew at the skeleton instead of waiting for the page')

  // The page is still filling in. Each mutation re-arms the quiet window.
  dom.mutate()
  await sleep(60)
  dom.mutate()
  await sleep(60)
  assert.equal(calls.length, 0, 'the settle window was not re-armed by later churn')

  // Quiet. Now he goes.
  await sleep(200)
  assert.equal(calls.length, 1, 'he never set off after the page went quiet')
  assert.deepEqual(await pending, { ok: true })
})

test('after a navigation, a near destination goes straight and a far one goes round', async () => {
  // He stands at x=400. The grid is at 600-760, centre 680 — 280px away, well
  // inside the 480px third of a 1440 viewport.
  {
    const dom = installFakeDom({ selector: '#grid', left: 600, width: 160 })
    const { calls, decke } = fakeDecke(400)
    const pending = runUiTool({ decke, navigate: () => {} }, 'goTo', {
      route: '/decks',
      selector: '#grid',
    })
    dom.appear()
    dom.mutate()
    await sleep(220)
    assert.deepEqual(await pending, { ok: true })
    assert.equal(calls.length, 1)
    assert.equal(calls[0]!.via, undefined, 'a near hop after a route change must go straight there')
    assert.equal(calls[0]!.highlight, true, 'the ring is the other half of presenting, and it stays')
  }
  // Same page, same character, a destination right across it: centre 1330, which
  // is 930px away. That still earns the long way round — "he travelled" is what
  // the round trip was always for.
  {
    const dom = installFakeDom({ selector: '#grid', left: 1250, width: 160 })
    const { calls, decke } = fakeDecke(400)
    const pending = runUiTool({ decke, navigate: () => {} }, 'goTo', {
      route: '/decks',
      selector: '#grid',
    })
    dom.appear()
    dom.mutate()
    await sleep(220)
    assert.deepEqual(await pending, { ok: true })
    assert.equal(calls[0]!.via, 'background', 'a traverse after a route change still goes via the far plane')
  }
})

test('already on the page, he goes at once — there is nothing to settle', async () => {
  const dom = installFakeDom({ selector: '#grid', left: 600, width: 160 })
  dom.appear()
  const { calls, decke } = fakeDecke(400)
  const navigated: string[] = []
  // `window.location.pathname` is '/series', so this is the "we are already
  // there" branch. Nothing was replaced, so a settle would only make him slow.
  const result = await runUiTool({ decke, navigate: (to) => navigated.push(to) }, 'goTo', {
    route: '/series',
    selector: '#grid',
  })
  assert.deepEqual(result, { ok: true })
  assert.deepEqual(navigated, [], 'he must not re-navigate to the page he is on')
  assert.equal(calls.length, 1, 'the same-page branch should fly immediately')
})
