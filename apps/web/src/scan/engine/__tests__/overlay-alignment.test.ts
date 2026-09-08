// THE OVERLAY MUST AGREE WITH THE VIDEO — the assertion nothing made.
//
// `frame-invariant.test.ts` fences the other direction: it proves the DISPLAY
// cannot influence DETECTION. Nothing fenced the display itself, and the
// 2026-09-04 owner session found out why that matters. `QuadOverlay.tsx:30`
// mapped the canonical square onto the camera box with `object-fit: contain`
// math (`Math.min(box.width, box.height)`) and no centring origin, while the
// video underneath it renders `object-fit: cover`. On the owner's real box
// (428x319) that drew the reticle 54.5 px left of centre at 74.5% of its true
// size; in his landscape excursion (926x136) it drew at 14.7% of true size,
// 395 px left of centre. He aimed by the drawn reticle, and his 176 recorded
// quads sit 3.5 px from where the DRAWN reticle maps back to and 49.5 px from
// the true one. The invariant held — capture was right, display was wrong —
// which is exactly the failure a display-side test catches and a
// detection-side test cannot.
//
// ── WHAT THIS FILE ASSERTS, AND WHY IT IS NOT A RE-IMPLEMENTATION ───────────
//
// It renders the SHIPPING `QuadOverlay` component to static markup and reads
// the geometry back out of the SVG it produced — the reticle `<rect>`'s own
// x/y/width/height and every quad `<polygon>`'s points. Nothing here calls the
// coordinate helpers the component uses, so a helper that agrees with itself
// cannot pass this file.
//
// The GROUND TRUTH is derived from the CSS `object-fit: cover` definition plus
// `frame.squareCrop`, and is a transcription of the ground truth
// `analysis/align-sweep.mjs` measured live in the browser against the shipped
// build (its `measure()`, lines 36-43): cover the STREAM into the box, then
// locate the stream's centre square — which is what `frame.ts` says the
// canonical frame IS — inside that. Two facts follow, and they are the
// assertions:
//
//   1. THE CANONICAL SQUARE IS ALWAYS CENTRED IN THE BOX. Cover centres its
//      overflow and the centre square's centre is the stream's centre, so the
//      reticle's centre must equal the camera box's centre at EVERY box shape.
//      That is "the reticule was not centered in the viewport", as an equation.
//   2. ITS SIDE IS `min(streamW, streamH) * max(boxW/streamW, boxH/streamH)`.
//      Note this is NOT `max(boxW, boxH)` whenever the box's limiting
//      dimension disagrees with the stream's: at the owner's landscape box
//      (926x136) against his landscape stream (1280x960) the true side is
//      694.5 px, not 926 — which is why the overlay maps through the STREAM
//      rather than assuming the box shows the square edge-to-edge.
//
// Both hold at any box shape, so this file deliberately does NOT depend on the
// camera box being square. The box being square is a separate fix and a
// separate want; the overlay has to be right either way.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it } from 'node:test'

import type { EngineState, Quad } from '../contract'
import { CANONICAL_SIZE, reticleForAspect } from '../frame'
import { QuadOverlay } from '../../ui/QuadOverlay'
import { squareSide } from '../../ui/coords'

// ── WHY THE FIXTURES ARE IN THE REPO ────────────────────────────────────────
//
// This path used to be an absolute one on the author's laptop
// (`E:/users/cheyr/deckpal/roadmap/plans/card-scanner-redesign/...`), pointing
// into a directory that is not tracked. The `if (!existsSync) return []` guard
// below reads as graceful degradation and was not: the suite then asserts the
// artifacts ARE present, so on any other machine — GitHub Actions included —
// this file could only fail. It did, on every CI run since the scanner landed
// on main, and the regressions it pins have therefore never once been checked
// by CI.
//
// The recorded sessions are gigabytes of frames and crops and stay out of git.
// The JSON the assertions actually read is a few hundred KB, so it lives here,
// addressed relative to this file. The guard is kept: it is now the honest
// thing it always claimed to be.
const SESSION = fileURLToPath(new URL('./fixtures/owner-session-1/', import.meta.url))

/** The owner's two real box shapes, from telemetry: 428x319 in portrait for
 *  175 of the 176 events, and 926x136 for the landscape excursion at t+80 s. */
const OWNER_PORTRAIT = { box: { width: 428, height: 319 }, stream: { width: 960, height: 1280 } }
const OWNER_LANDSCAPE = { box: { width: 926, height: 136 }, stream: { width: 1280, height: 960 } }

/** Box shapes to sweep. The first four rows are `align-sweep.mjs`'s own
 *  measured boxes at viewport heights 900/780/540 plus the owner's; the rest
 *  cover shapes the phone layout does not produce today but the overlay must
 *  still not lie about (a square box, and a box TALLER than it is wide). */
const SHAPES = [
  { name: "owner's portrait box (428x319)", ...OWNER_PORTRAIT },
  { name: "owner's landscape box (926x136)", ...OWNER_LANDSCAPE },
  { name: 'sweep 430x900 -> 414.7x390.8', box: { width: 414.7, height: 390.8 }, stream: { width: 960, height: 1280 } },
  { name: 'sweep 430x780 -> 414.7x318.8', box: { width: 414.7, height: 318.8 }, stream: { width: 960, height: 1280 } },
  { name: 'sweep 430x540 -> 414.7x174.8', box: { width: 414.7, height: 174.8 }, stream: { width: 960, height: 1280 } },
  { name: 'a genuinely square box', box: { width: 390, height: 390 }, stream: { width: 960, height: 1280 } },
  { name: 'a square box, landscape stream', box: { width: 390, height: 390 }, stream: { width: 1280, height: 960 } },
  { name: 'a TALL box (height > width)', box: { width: 300, height: 500 }, stream: { width: 960, height: 1280 } },
  { name: 'a tall box, landscape stream', box: { width: 300, height: 500 }, stream: { width: 1280, height: 960 } },
  { name: 'a square stream', box: { width: 428, height: 319 }, stream: { width: 720, height: 720 } },
]

// ---------------------------------------------------------------------------
// ground truth — the CSS spec, not our helpers
// ---------------------------------------------------------------------------

/**
 * Where the canonical square lands on screen. `object-fit: cover` scales the
 * source by `max(boxW/srcW, boxH/srcH)` and centres the overflow; the canonical
 * frame is the source's CENTRE SQUARE (`frame.squareCrop`), so its top-left sits
 * half the cropped-away margin further in.
 */
function truthSquare(box: { width: number; height: number }, stream: { width: number; height: number }) {
  const cover = Math.max(box.width / stream.width, box.height / stream.height)
  const oX = (box.width - stream.width * cover) / 2
  const oY = (box.height - stream.height * cover) / 2
  const cs = Math.min(stream.width, stream.height)
  return {
    x: oX + ((stream.width - cs) / 2) * cover,
    y: oY + ((stream.height - cs) / 2) * cover,
    side: cs * cover,
    scale: (cs * cover) / CANONICAL_SIZE,
  }
}

function truthPoint(t: ReturnType<typeof truthSquare>, x: number, y: number): [number, number] {
  return [t.x + x * t.scale, t.y + y * t.scale]
}

// ---------------------------------------------------------------------------
// render the shipping component and read its SVG back
// ---------------------------------------------------------------------------

const RETICLE = reticleForAspect()

function stateFor(stream: { width: number; height: number }, quads: Quad[]): EngineState {
  return {
    frame: { width: CANONICAL_SIZE, height: CANONICAL_SIZE },
    stream,
    reticle: RETICLE,
    hasObj: 0.99,
    stable: quads.map((quad, i) => ({ id: i + 1, quad, age: 9, coasting: false })),
    pending: [],
    locked: null,
    saturation: 0.3,
    perf: { detectMs: 30, hz: 7.5, jitterPx: 1 },
  } as unknown as EngineState
}

interface Drawn {
  reticle: { x: number; y: number; w: number; h: number }
  polygons: Array<Array<[number, number]>>
}

function draw(box: { width: number; height: number }, stream: { width: number; height: number }, quads: Quad[]): Drawn {
  const html = renderToStaticMarkup(createElement(QuadOverlay, { state: stateFor(stream, quads), box }))
  const rect = /<rect ([^>]*)>/.exec(html)
  assert.ok(rect, 'the overlay drew no reticle rect')
  const attr = (name: string) => {
    const m = new RegExp(`\\b${name}="([-0-9.eE]+)"`).exec(rect[1])
    assert.ok(m, `reticle rect has no ${name}`)
    return Number(m[1])
  }
  const polygons: Array<Array<[number, number]>> = []
  for (const m of html.matchAll(/<polygon points="([^"]+)"/g)) {
    polygons.push(m[1].trim().split(/\s+/).map((p) => p.split(',').map(Number) as [number, number]))
  }
  return { reticle: { x: attr('x'), y: attr('y'), w: attr('width'), h: attr('height') }, polygons }
}

/** A card-shaped quad centred at (cx, cy) in canonical pixels. */
function cardQuad(cx: number, cy: number, h: number): Quad {
  const w = h * 0.71591
  return [
    [cx - w / 2, cy - h / 2],
    [cx + w / 2, cy - h / 2],
    [cx + w / 2, cy + h / 2],
    [cx - w / 2, cy + h / 2],
  ]
}

// ---------------------------------------------------------------------------
// 1. the reticle is centred, at every box shape
// ---------------------------------------------------------------------------

describe('overlay alignment — the drawn reticle is the camera box, centred', () => {
  for (const s of SHAPES) {
    it(`centres the reticle in ${s.name}`, () => {
      const d = draw(s.box, s.stream, [])
      const cx = d.reticle.x + d.reticle.w / 2
      const cy = d.reticle.y + d.reticle.h / 2
      // THE OWNER'S COMPLAINT, AS AN EQUATION. The canonical square is centred
      // under cover and the reticle is centred inside it, so the drawn
      // reticle's centre IS the box's centre — at every shape, in either
      // orientation, with no exception for a box that failed to be square.
      assert.ok(
        Math.abs(cx - s.box.width / 2) < 0.5,
        `reticle centre x ${cx.toFixed(1)} vs box centre ${(s.box.width / 2).toFixed(1)} — off by ${(cx - s.box.width / 2).toFixed(1)} px`,
      )
      assert.ok(
        Math.abs(cy - s.box.height / 2) < 0.5,
        `reticle centre y ${cy.toFixed(1)} vs box centre ${(s.box.height / 2).toFixed(1)} — off by ${(cy - s.box.height / 2).toFixed(1)} px`,
      )
    })

    it(`draws ${s.name} at the size the video shows`, () => {
      const t = truthSquare(s.box, s.stream)
      const d = draw(s.box, s.stream, [])
      // The drawn reticle's width divided by the reticle's own fraction of the
      // canonical square recovers the displayed canonical side. It must equal
      // the side the video is actually showing.
      const drawnSide = d.reticle.w / RETICLE.w / CANONICAL_SIZE
      assert.ok(
        Math.abs(drawnSide - t.scale) < 1e-3,
        `drawn scale ${drawnSide.toFixed(4)} vs true ${t.scale.toFixed(4)} (${((drawnSide / t.scale) * 100).toFixed(1)}% of true size)`,
      )
      for (const k of ['x', 'y', 'w', 'h'] as const) {
        const truthRect = {
          x: truthPoint(t, RETICLE.x * CANONICAL_SIZE, RETICLE.y * CANONICAL_SIZE)[0],
          y: truthPoint(t, RETICLE.x * CANONICAL_SIZE, RETICLE.y * CANONICAL_SIZE)[1],
          w: RETICLE.w * CANONICAL_SIZE * t.scale,
          h: RETICLE.h * CANONICAL_SIZE * t.scale,
        }
        assert.ok(
          Math.abs(d.reticle[k] - truthRect[k]) < 0.5,
          `reticle ${k}: drawn ${d.reticle[k].toFixed(1)} vs true ${truthRect[k].toFixed(1)}`,
        )
      }
    })
  }
})

// ---------------------------------------------------------------------------
// 2. quad corners land where the video puts the card
// ---------------------------------------------------------------------------

describe('overlay alignment — quad corners land on the card', () => {
  /** Max corner error, in CSS px, over a set of quads at one box shape. */
  function maxCornerError(
    box: { width: number; height: number },
    stream: { width: number; height: number },
    quads: Quad[],
  ): number {
    const t = truthSquare(box, stream)
    const d = draw(box, stream, quads)
    assert.equal(d.polygons.length, quads.length, 'every quad must be drawn')
    let worst = 0
    for (let i = 0; i < quads.length; i++) {
      for (let c = 0; c < 4; c++) {
        const [tx, ty] = truthPoint(t, quads[i][c][0], quads[i][c][1])
        worst = Math.max(worst, Math.hypot(d.polygons[i][c][0] - tx, d.polygons[i][c][1] - ty))
      }
    }
    return worst
  }

  const SYNTHETIC = [cardQuad(208, 208, 300), cardQuad(120, 150, 180), cardQuad(320, 300, 240), cardQuad(208, 208, 380)]

  for (const s of SHAPES) {
    it(`corner error stays under 2 CSS px in ${s.name}`, () => {
      const worst = maxCornerError(s.box, s.stream, SYNTHETIC)
      assert.ok(worst < 2, `max corner error ${worst.toFixed(1)} px`)
    })
  }
})

// ---------------------------------------------------------------------------
// 3. THE OWNER'S OWN 176 QUADS
// ---------------------------------------------------------------------------
//
// The synthetic quads above are card-shaped and well placed. These are the real
// ones: every quad the owner's 39.5-minute session recorded, at the box shape
// his phone actually produced. `D-quad-vs-card.png` measured the shipped
// build's error on one of them at 74.1 px; this asserts it on all 176.

interface Ev {
  type?: string
  quad?: Quad
  cameraBox?: { width: number; height: number }
  frame?: { width: number; height: number }
  saturation?: number
  trigger?: string
}

function ownerEvents(): Ev[] {
  const p = SESSION + 'events.json'
  if (!fs.existsSync(p)) return []
  return (JSON.parse(fs.readFileSync(p, 'utf8')) as Ev[]).filter(
    (e) => (e.type === 'lock-event' || e.type === 'capture-event') && Array.isArray(e.quad),
  )
}

const OWNER = ownerEvents()
const haveOwner = OWNER.length > 0

describe("overlay alignment — the owner's own session", () => {
  it('the owner-session artifacts are present', { skip: haveOwner ? false : 'artifacts unavailable' }, () => {
    assert.equal(OWNER.length, 176, '134 lock-events + 42 capture-events')
  })

  it('every one of the 176 recorded quads draws within 2 CSS px of the card', {
    skip: haveOwner ? false : 'artifacts unavailable',
  }, () => {
    // The stream is recoverable from the box: `capture-event.frame` carries the
    // video's own dimensions, and the two box shapes partition the session
    // exactly — 175 events at 428x319 (portrait stream 960x1280) and the single
    // landscape excursion at 926x136 (1280x960). A lock-event's `frame` is
    // canonical 416x416 by design and says nothing about the sensor, so the box
    // is what pairs it with its stream.
    let worst = 0
    let worstAt = ''
    for (const e of OWNER) {
      const box = e.cameraBox!
      const shape = box.width > box.height * 2 ? OWNER_LANDSCAPE : OWNER_PORTRAIT
      assert.deepEqual(box, shape.box, 'unexpected camera box in the session')
      const t = truthSquare(box, shape.stream)
      const d = draw(box, shape.stream, [e.quad!])
      for (let c = 0; c < 4; c++) {
        const [tx, ty] = truthPoint(t, e.quad![c][0], e.quad![c][1])
        const err = Math.hypot(d.polygons[0][c][0] - tx, d.polygons[0][c][1] - ty)
        if (err > worst) {
          worst = err
          worstAt = `${e.type} in ${box.width}x${box.height}`
        }
      }
    }
    assert.ok(worst < 2, `max corner error over 176 recorded quads: ${worst.toFixed(1)} px (${worstAt})`)
  })

  it("the owner's cards now sit where the reticle is drawn, not 53 px left of it", {
    skip: haveOwner ? false : 'artifacts unavailable',
  }, () => {
    // The session's independent proof of the bug: he aimed at the DRAWN
    // reticle, so his quads' mean centroid landed 3.5 px from where the drawn
    // reticle maps back to and 49.5 px from the true reticle centre. With the
    // overlay drawing the truth, the two are the same point — so a reader
    // filling the drawn reticle is filling the real one, and the mean centroid
    // of a correctly-aimed session would sit on canonical (208, 208).
    const d = draw(OWNER_PORTRAIT.box, OWNER_PORTRAIT.stream, [])
    const t = truthSquare(OWNER_PORTRAIT.box, OWNER_PORTRAIT.stream)
    const drawnCentre: [number, number] = [d.reticle.x + d.reticle.w / 2, d.reticle.y + d.reticle.h / 2]
    // Map the drawn centre back into canonical space through the video's real
    // mapping — the exact calculation the session used to predict a 53 px
    // aiming offset from the code alone.
    const backX = (drawnCentre[0] - t.x) / t.scale
    const backY = (drawnCentre[1] - t.y) / t.scale
    assert.ok(
      Math.abs(backX - CANONICAL_SIZE / 2) < 0.5 && Math.abs(backY - CANONICAL_SIZE / 2) < 0.5,
      `the drawn reticle maps back to canonical (${backX.toFixed(1)}, ${backY.toFixed(1)}), not (208, 208) — a reader aiming at it is off by ${(CANONICAL_SIZE / 2 - backX).toFixed(1)} px in x`,
    )
  })
})

// ---------------------------------------------------------------------------
// 4. THE BOX ITSELF — square by arithmetic, not by CSS negotiation
// ---------------------------------------------------------------------------
//
// Separate from everything above, and deliberately so: the overlay is correct at
// any box shape now, so this is not a dependency of it. It is the owner's other
// ask — "have a standardized reticule size within that square" — and the reason
// a quarter of the sensor's square was being thrown away on screen.

describe('the camera box is actually square', () => {
  it('the CSS the layout produced was not square, and this is the arithmetic that is', () => {
    // The owner's phone: a 428 px wide slot with 319 px of height left under the
    // card bin. `aspect-square w-full` + `max-height: 100%` gave 428x319; the
    // largest square that fits gives 319x319.
    assert.equal(squareSide(428, 319), 319)
    assert.equal(squareSide(926, 136), 136)
    // Whole pixels, so width and height are EXACTLY equal — a fractional min
    // can round differently on each axis and put the box a hair off square.
    assert.equal(squareSide(414.7, 318.8), 318)
    assert.equal(squareSide(390.2, 512.9), 390)
    // Degenerate slots produce no box rather than a negative one.
    assert.equal(squareSide(0, 300), 0)
    assert.equal(squareSide(300, 0), 0)
    assert.equal(squareSide(-5, 300), 0)
  })

  it('and a square box is where the overlay mapping degenerates to one scale factor', () => {
    // The property the old code ASSUMED and the layout never delivered. With a
    // genuinely square box the canonical square fills it exactly: origin at
    // (0, 0), scale side/416, nothing cropped and nothing wasted — in either
    // stream orientation.
    for (const stream of [{ width: 960, height: 1280 }, { width: 1280, height: 960 }, { width: 720, height: 720 }]) {
      const side = squareSide(428, 319)
      const t = truthSquare({ width: side, height: side }, stream)
      assert.ok(Math.abs(t.x) < 1e-9 && Math.abs(t.y) < 1e-9, `origin (${t.x}, ${t.y}) — a square box crops nothing`)
      assert.ok(Math.abs(t.side - side) < 1e-9, `canonical square displayed at ${t.side}, box is ${side}`)
      // ...and the drawn overlay agrees, which is the whole point.
      const d = draw({ width: side, height: side }, stream, [])
      assert.ok(Math.abs(d.reticle.x + d.reticle.w / 2 - side / 2) < 0.5)
      assert.ok(Math.abs(d.reticle.y + d.reticle.h / 2 - side / 2) < 0.5)
      assert.ok(Math.abs(d.reticle.w - RETICLE.w * side) < 0.5, 'the reticle is a fixed fraction of the square')
    }
  })
})
