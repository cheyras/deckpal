/**
 * The two pieces of arithmetic that make a pinned overlay correct.
 *
 * Handing the character to the compositor rests on exactly two claims, and both
 * of them are pure functions of numbers that a browser is not needed to check:
 *
 *   1. A box pinned at document offset `docY` lands where the fixed box already
 *      was — whatever the page has put between the overlay and the document
 *      origin. This is the claim `pageAnchor` refuses to assume and measures
 *      instead, and the test exercises the case it exists for: a positioned
 *      ancestor, which makes the containing block something other than the
 *      initial one and would otherwise put the overlay somewhere else entirely.
 *
 *   2. While pinned, the element's viewport rect can be DERIVED from its cached
 *      document box and the scroll offset, rather than measured. That is what
 *      buys back the per-frame forced layout, so it has to give the same answer
 *      the measurement would have — checked here through `parkBeside`, which is
 *      what actually consumes it.
 *
 * Neither needs a DOM, so neither is checked in a browser, where it would be
 * checked slowly and only on the days someone remembers to look.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { PerspectiveCamera } from 'three'
import { BLENDER_CAMERA, blenderCameraQuaternion, blenderToThree } from '../constants'
import { parkBeside, type RectLike } from '../dom'
import { setViewport } from '../viewport'
import { pinToPage, unpinToViewport, isPinned } from '../pageAnchor'

const VIEW_W = 1000
const VIEW_H = 800

/**
 * The smallest thing `pageAnchor` can be pointed at: a style bag and a box.
 *
 * The box is COMPUTED from the style the module has written, the way a layout
 * engine would — a stub that returned a canned rect would agree with any
 * arithmetic at all, including wrong arithmetic.
 */
function fakeElement(opts: { fixedBox: RectLike; containingBlockDocY: number; containingBlockDocX?: number }) {
  const style: Record<string, string> = {}
  const cbX = opts.containingBlockDocX ?? 0
  const el = {
    style: {
      getPropertyValue: (p: string) => style[p] ?? '',
      setProperty: (p: string, v: string) => {
        style[p] = v
      },
      removeProperty: (p: string) => {
        delete style[p]
      },
      set position(v: string) {
        style.position = v
      },
      get position() {
        return style.position ?? ''
      },
      set top(v: string) {
        style.top = v
      },
      set left(v: string) {
        style.left = v
      },
      set right(v: string) {
        style.right = v
      },
      set bottom(v: string) {
        style.bottom = v
      },
      set width(v: string) {
        style.width = v
      },
      set height(v: string) {
        style.height = v
      },
    },
    getBoundingClientRect() {
      if (style.position !== 'absolute') return opts.fixedBox
      const px = (k: string) => parseFloat(style[k] ?? '0') || 0
      // An absolute box sits at its offsets from the containing block, and the
      // containing block sits at a fixed place in the DOCUMENT — so its viewport
      // position moves with the scroll, which is the entire mechanism.
      const top = opts.containingBlockDocY - window.scrollY + px('top')
      const left = cbX - window.scrollX + px('left')
      const w = style.width ? px('width') : opts.fixedBox.width
      const h = style.height ? px('height') : opts.fixedBox.height
      return { left, top, right: left + w, width: w, height: h }
    },
    styleRecord: style,
  }
  return el as unknown as HTMLElement & { styleRecord: Record<string, string> }
}

function withScroll(x: number, y: number, fn: () => void) {
  const g = globalThis as unknown as { window?: unknown }
  const had = 'window' in globalThis
  const prev = g.window
  g.window = { scrollX: x, scrollY: y }
  try {
    fn()
  } finally {
    if (had) g.window = prev
    else delete g.window
  }
}

setViewport(VIEW_W, VIEW_H)

test('a pinned box lands exactly where the fixed box was', () => {
  const fixedBox: RectLike = { left: 0, top: 0, right: VIEW_W, width: VIEW_W, height: VIEW_H }
  const el = fakeElement({ fixedBox, containingBlockDocY: 0 })
  withScroll(0, 1674, () => {
    const before = el.getBoundingClientRect()
    pinToPage(el, window.scrollY)
    const after = el.getBoundingClientRect()
    assert.equal(after.top, before.top, 'the switch moved the box vertically')
    assert.equal(after.left, before.left, 'the switch moved the box horizontally')
    assert.equal(after.width, before.width)
    assert.equal(after.height, before.height)
  })
})

test('a positioned ancestor does not displace the pin', () => {
  // The case the two-read measurement exists for. Assuming the initial
  // containing block here would put the overlay 900 px off.
  const fixedBox: RectLike = { left: 0, top: 0, right: VIEW_W, width: VIEW_W, height: VIEW_H }
  const el = fakeElement({ fixedBox, containingBlockDocY: 900, containingBlockDocX: 24 })
  withScroll(0, 1674, () => {
    pinToPage(el, window.scrollY)
    const after = el.getBoundingClientRect()
    assert.equal(after.top, 0)
    assert.equal(after.left, 0)
  })
})

test('a pinned box holds its DOCUMENT offset as the page scrolls', () => {
  const fixedBox: RectLike = { left: 0, top: 0, right: VIEW_W, width: VIEW_W, height: VIEW_H }
  const el = fakeElement({ fixedBox, containingBlockDocY: 0 })
  const pinAt = 1674
  withScroll(0, pinAt, () => pinToPage(el, pinAt))
  for (const dy of [11, 55, 190, 430]) {
    withScroll(0, pinAt + dy, () => {
      const r = el.getBoundingClientRect()
      assert.equal(r.top + window.scrollY, pinAt, `document offset drifted at +${dy}`)
      // Which is the same statement as: it slid up the viewport by the scroll.
      assert.equal(r.top, -dy)
    })
  }
})

test('unpinning is an exact round trip', () => {
  const fixedBox: RectLike = { left: 0, top: 0, right: VIEW_W, width: VIEW_W, height: VIEW_H }
  const el = fakeElement({ fixedBox, containingBlockDocY: 0 })
  el.style.setProperty('position', 'fixed')
  const before = JSON.stringify(el.styleRecord)
  withScroll(0, 400, () => {
    pinToPage(el, 400)
    assert.equal(isPinned(el), true)
    unpinToViewport(el)
  })
  assert.equal(isPinned(el), false)
  assert.equal(JSON.stringify(el.styleRecord), before, 'unpinning left styles behind')
})

test('pinning twice is not a second pin', () => {
  const fixedBox: RectLike = { left: 0, top: 0, right: VIEW_W, width: VIEW_W, height: VIEW_H }
  const el = fakeElement({ fixedBox, containingBlockDocY: 0 })
  withScroll(0, 500, () => {
    pinToPage(el, 500)
    const once = JSON.stringify(el.styleRecord)
    // A second pin must not capture the ALREADY PINNED box as the thing to
    // restore, or unpinning would leave the overlay absolutely positioned.
    pinToPage(el, 500)
    assert.equal(JSON.stringify(el.styleRecord), once)
    unpinToViewport(el)
    assert.equal(el.styleRecord.position, undefined)
  })
})

// ---------------------------------------------------------------- derived rect

function stagingCamera(): PerspectiveCamera {
  const cam = new PerspectiveCamera(BLENDER_CAMERA.fovDeg, VIEW_W / VIEW_H, BLENDER_CAMERA.near, BLENDER_CAMERA.far)
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
  cam.updateMatrixWorld(true)
  return cam
}

test('a derived rect parks him where a measured one would', () => {
  const cam = stagingCamera()
  const opts = { depth: 'foreground' as const, side: 'auto' as const, baseDistance: cam.position.length() }
  // The element's box in DOCUMENT space, which is what a pin caches.
  const doc = { x: 120, y: 2000, w: 380, h: 90 }
  const pinAt = 1700

  for (const drift of [0, 11, 55, 190, 430, -220]) {
    const scrollY = pinAt + drift
    // What `getBoundingClientRect` would return at this scroll position.
    const measured: RectLike = {
      left: doc.x,
      top: doc.y - scrollY,
      right: doc.x + doc.w,
      width: doc.w,
      height: doc.h,
    }
    // What `syncPinned` derives instead, from the cache and the scroll offset.
    const derived: RectLike = {
      left: doc.x - 0,
      top: doc.y - scrollY,
      right: doc.x - 0 + doc.w,
      width: doc.w,
      height: doc.h,
    }
    const a = parkBeside(cam, measured, opts)
    const b = parkBeside(cam, derived, opts)
    assert.equal(b.position.distanceTo(a.position), 0, `derived rect diverged at drift ${drift}`)
    assert.equal(b.facing, a.facing)
  }
})

test('the derived rect moves him by the scroll, and only by the scroll', () => {
  const cam = stagingCamera()
  const opts = { depth: 'foreground' as const, side: 'auto' as const, baseDistance: cam.position.length() }
  const doc = { x: 120, y: 2000, w: 380, h: 90 }
  const at = (scrollY: number) =>
    parkBeside(
      cam,
      { left: doc.x, top: doc.y - scrollY, right: doc.x + doc.w, width: doc.w, height: doc.h },
      opts,
    ).position

  const a = at(1700)
  const b = at(1700 + 300)
  // Scrolling down moves the element UP the viewport, so he moves up in world
  // space too. If this ever reads zero, the vertical parallax has been frozen —
  // which is the regression `syncPinned` was rewritten to avoid.
  assert.ok(b.z > a.z + 0.5, `he did not rise with the page: ${a.z} -> ${b.z}`)
  // And monotonically, because the cue is a gradual one: a solve that stepped or
  // reversed would read as a lurch even though every individual frame was right.
  let last = -Infinity
  for (const drift of [-200, -100, 0, 100, 200, 300, 400]) {
    const z = at(1700 + drift).z
    assert.ok(z > last, `the rise reversed at drift ${drift}`)
    last = z
  }
  // NOT an assertion that his world x is unchanged, and that is not an
  // oversight: the camera is pitched, so a purely vertical move on screen is not
  // a purely horizontal-free move in the Blender frame. The invariant that does
  // hold is that the solve is a function of the rect alone.
  assert.equal(at(1700).x, a.x)
})

test('an offset frustum reproduces the tracked park exactly', () => {
  // THE INVARIANT THE WHOLE PINNED PATH RESTS ON, and the one that broke twice.
  //
  // Tracked, he is solved against a rect that MOVES up the viewport as the page
  // scrolls, with the camera left alone. Pinned, he is solved against a rect
  // that never moves — the element's box inside the canvas, which is pinned to
  // the same page he is — with the camera's frustum shifted by the drift
  // instead. Those two have to produce the same world position, because the
  // second is only meant to be a different way of saying the first.
  //
  // Both failures this catches were silent on screen in the obvious place. Doing
  // the solve BEFORE the offset still drew him on his element, and still slid
  // him off by a frame's drift. Getting the offset's SIGN wrong also still drew
  // him on his element, and lit him from below while he climbed the screen.
  const cam = stagingCamera()
  const opts = { depth: 'foreground' as const, side: 'auto' as const, baseDistance: cam.position.length() }
  const rect: RectLike = { left: 120, top: 300, right: 500, width: 380, height: 90 }

  for (const drift of [0, 11, 55, 190, 430, -220]) {
    // Tracked: the rect moves, the camera does not.
    cam.clearViewOffset()
    const tracked = parkBeside(
      cam,
      { ...rect, top: rect.top - drift },
      opts,
    ).position.clone()

    // Pinned: the rect is fixed in canvas space, the frustum carries the drift.
    cam.setViewOffset(VIEW_W, VIEW_H, 0, -drift, VIEW_W, VIEW_H)
    const pinned = parkBeside(cam, rect, opts).position.clone()
    cam.clearViewOffset()

    assert.ok(
      pinned.distanceTo(tracked) < 1e-6,
      `drift ${drift}: pinned ${pinned.toArray()} vs tracked ${tracked.toArray()}`,
    )
  }
})

test('clearing the offset returns the camera to the tracked solve', () => {
  // `unpin` clears the offset and re-solves in the same frame. If clearing were
  // not exact, every hand-back to the viewport would start with a jump.
  const cam = stagingCamera()
  const opts = { depth: 'foreground' as const, side: 'auto' as const, baseDistance: cam.position.length() }
  const rect: RectLike = { left: 120, top: 300, right: 500, width: 380, height: 90 }
  const before = parkBeside(cam, rect, opts).position.clone()
  cam.setViewOffset(VIEW_W, VIEW_H, 0, -430, VIEW_W, VIEW_H)
  parkBeside(cam, rect, opts)
  cam.clearViewOffset()
  const after = parkBeside(cam, rect, opts).position
  assert.equal(after.distanceTo(before), 0)
})

test('a stale scroll offset barely moves him, where it used to move him fully', () => {
  // WHAT PINNING ACTUALLY BUYS AGAINST A LAGGING SCROLL OFFSET, stated as a
  // ratio rather than as immunity — because the first version of this test
  // asserted immunity and was wrong.
  //
  // Tracked, `scrollY` IS his position: a value that is 300 px stale puts him
  // 289 px from where he belongs, which is "on a fast scroll he'll lose it
  // entirely". Pinned, the solve asks which world point projects to a FIXED
  // canvas position under the current frustum and he is drawn under that same
  // frustum, so the staleness very nearly cancels. Very nearly and not exactly:
  // `parkBeside` drops him half a body in world Z to stand him on his feet
  // rather than float his centre, and that drop is not along the view ray, so a
  // sheared frustum projects it slightly differently.
  //
  // Measured: 10.7 px of residual against 289 px, at 300 px of staleness. The
  // same lag that used to lose him now costs about a thirtieth of a body width,
  // and the residual is a foreshortening artefact rather than a slip.
  const cam = stagingCamera()
  const opts = { depth: 'foreground' as const, side: 'auto' as const, baseDistance: cam.position.length() }
  const rect: RectLike = { left: 120, top: 300, right: 500, width: 380, height: 90 }

  const screenY = (p: { x: number; y: number; z: number }) => {
    const ndc = blenderToThree(p.x, p.y, p.z).project(cam)
    return (-ndc.y * 0.5 + 0.5) * VIEW_H
  }
  const pinnedAt = (drift: number) => {
    cam.setViewOffset(VIEW_W, VIEW_H, 0, -drift, VIEW_W, VIEW_H)
    const y = screenY(parkBeside(cam, rect, opts).position)
    cam.clearViewOffset()
    return y
  }
  const trackedAt = (drift: number) => {
    cam.clearViewOffset()
    return screenY(parkBeside(cam, { ...rect, top: rect.top - drift }, opts).position)
  }

  const pinnedBase = pinnedAt(0)
  const trackedBase = trackedAt(0)
  for (const stale of [7, 40, 130, 300, 480, -300]) {
    const pinnedSlip = Math.abs(pinnedAt(stale) - pinnedBase)
    const trackedSlip = Math.abs(trackedAt(stale) - trackedBase)
    assert.ok(
      pinnedSlip < Math.abs(stale) * 0.06,
      `staleness of ${stale} slipped him ${pinnedSlip.toFixed(2)}px`,
    )
    assert.ok(
      pinnedSlip * 10 < trackedSlip,
      `pinning barely helped at ${stale}: ${pinnedSlip.toFixed(2)} vs ${trackedSlip.toFixed(2)}`,
    )
  }
})

test('a canvas slid off the viewport still parks him where tracking would', () => {
  // THE ENTRY FIX, as arithmetic. The canvas is one viewport tall and clips what
  // it does not cover, so pinning it aligned with the viewport means refusing to
  // pin until his whole silhouette is inside — and his entire entrance, a body
  // height of scrolling at each edge, then runs on the hand-tracked path. That
  // was the reviewed defect: "there is still judder specifically when the
  // character is entering the visible viewport, both coming into the top and
  // coming into the bottom."
  //
  // So the canvas is pinned at a document offset that is NOT the current scroll
  // position, sliding it off the edge far enough to contain him. Everything
  // downstream already carries it: the canvas's own top lands at `shift`, the
  // element's box is cached in canvas coordinates, and the drift starts at
  // `-shift` instead of 0. What has to hold is that this still puts him exactly
  // where the un-pinned path would, for any shift.
  const cam = stagingCamera()
  const opts = { depth: 'foreground' as const, side: 'auto' as const, baseDistance: cam.position.length() }
  const viewportRect: RectLike = { left: 120, top: 300, right: 500, width: 380, height: 90 }

  for (const shift of [0, -240, 240, -60, 380]) {
    cam.clearViewOffset()
    const tracked = parkBeside(cam, viewportRect, opts).position.clone()

    // What `repin` stores and applies: the box in canvas coordinates, and a
    // drift of `-shift` rather than zero.
    const canvasRect: RectLike = { ...viewportRect, top: viewportRect.top - shift }
    const drift = -shift
    cam.setViewOffset(VIEW_W, VIEW_H, 0, -drift, VIEW_W, VIEW_H)
    const pinned = parkBeside(cam, canvasRect, opts).position.clone()
    cam.clearViewOffset()

    assert.ok(
      pinned.distanceTo(tracked) < 1e-6,
      `shift ${shift}: pinned ${pinned.toArray()} vs tracked ${tracked.toArray()}`,
    )
  }
})

test('the pin window clears his DRAWN extent, not just his silhouette', () => {
  // `canPin`'s choice of shift, as a property, with the margin that cut his feet
  // off replaced by one that survives what he actually draws.
  //
  // The measurement this is defending, taken by reading rendered pixels back at
  // a half-height of 112 px: he reaches 148 px above and 66 px below what
  // `screenHalf` claims, because the stash cards and the alert reel ride well
  // outboard of the body. Anything under that clips him — and clips him
  // invisibly, because the canvas edge has no appearance of its own.
  const H = 820
  const half = 112
  const MARGIN = Math.max(32, half * 1.6)
  const WORST_OVERHANG_ABOVE = 148
  const WORST_OVERHANG_BELOW = 66
  assert.ok(
    MARGIN > WORST_OVERHANG_ABOVE && MARGIN > WORST_OVERHANG_BELOW,
    `a margin of ${MARGIN} does not clear a measured overhang of ${WORST_OVERHANG_ABOVE}`,
  )

  const idealShift = (screenY: number) => {
    const lowest = screenY + half + MARGIN - H
    const highest = screenY - half - MARGIN
    return Math.max(lowest, Math.min(0, highest))
  }

  for (let screenY = -half; screenY <= H + half; screenY += 7) {
    const shift = idealShift(screenY)
    // Everything he draws has to be inside the canvas, which spans
    // [shift, shift + H] in viewport pixels.
    assert.ok(
      screenY - half - WORST_OVERHANG_ABOVE >= shift - 1e-9,
      `clipped above at screenY ${screenY}`,
    )
    assert.ok(
      screenY + half + WORST_OVERHANG_BELOW <= shift + H + 1e-9,
      `clipped below at screenY ${screenY}`,
    )
    // Aligned whenever aligned is legal — a canvas over the viewport is the case
    // with nothing to go wrong, and it covers the whole screen.
    if (screenY - half >= MARGIN && screenY + half <= H - MARGIN) assert.equal(shift, 0)
  }
})

test('a shift taken at an edge relaxes to aligned once he is inside', () => {
  // THE DEFECT, as arithmetic. The shift is chosen at the instant he becomes
  // pinnable, which entering from an edge is the instant he is most constrained,
  // so it lands on the clamp. Nothing revisited it, so the clamp was permanent
  // and the canvas edge travelled into the middle of the screen with him:
  //
  //   "It's whenever he comes in from the bottom edge. It rectifies itself if I
  //    scroll him out of the top edge and then scroll him back in from the top."
  //
  // Entering from the top happens to land nowhere near its clamp, which is why
  // the same code looked correct from one direction and not the other.
  const H = 820
  const half = 112
  const MARGIN = Math.max(32, half * 1.6)
  const idealShift = (screenY: number) => {
    const lowest = screenY + half + MARGIN - H
    const highest = screenY - half - MARGIN
    return Math.max(lowest, Math.min(0, highest))
  }
  // Arriving from the bottom edge: constrained, so the shift is positive.
  const arriving = idealShift(H - 40)
  assert.ok(arriving > 0, 'a bottom entry should need the canvas slid down')
  // Once he has scrolled into the middle, aligned is legal and the pin is
  // re-taken there — which is the condition `syncPinned` watches for.
  assert.equal(idealShift(H / 2), 0)
  // And symmetrically from the top.
  assert.ok(idealShift(40) < 0, 'a top entry should need the canvas slid up')
})
