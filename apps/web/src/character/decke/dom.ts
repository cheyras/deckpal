/**
 * Mapping a DOM element to a place for Deck-E to stand.
 *
 * Nothing in the character wiki covers this — it specifies how he flies, not
 * where to. Everything here is a designed decision, and the reasoning is spelled
 * out because there is no upstream source to check it against.
 */
import { PerspectiveCamera, Plane, Raycaster, Vector2, Vector3 } from 'three'
import { BODY_H, BODY_W } from './constants'
import { canvasHeight, viewHeight, viewWidth } from './viewport'

export type Depth = 'foreground' | 'background'
export type Side = 'auto' | 'left' | 'right'

export type FlyTarget =
  | { selector: string }
  | { rect: DOMRect }
  | { x: number; y: number }

/**
 * Apparent scale at the background plane, matching the Blender staging: he
 * recedes to a third of his foreground size. Implemented as distance rather than
 * a scale, so perspective does the work and he genuinely looks further away.
 */
export const BACKGROUND_SCALE = 0.333

/** How far to his side of the element he parks, as a multiple of his own width.
 *  He stands BESIDE the thing he is showing, never on top of it. */
const SIDE_MARGIN = 0.9

/** Where `returnHome` puts him, as a fraction of the viewport in from the
 *  bottom-right corner. "For now, let's have home be, like, actually in the
 *  bottom right corner" — a parking spot, not a stage mark, and it will move
 *  again once he is wired into the real product chrome. */
const HOME_INSET = { x: 0.17, y: 0.22 } as const

/**
 * HIS DRAWN SILHOUETTE, as a multiple of what `BODY_H` spans on screen.
 *
 * MEASURED, not derived. `characterHeightPx` is what the deck box spans, and he
 * is not only a deck box: the bolts sit outside it and the 3/4 view turns his
 * 1.15-deep body so that some of its DEPTH counts toward his width. Taken off a
 * composite at 390x844 with `characterPx` at 107 by thresholding the corner
 * strip where nothing but him is drawn: 103 x 136, i.e. 1.28 as tall as the
 * deck box and 0.76 as wide as he is tall.
 *
 * `DeckeChat.tsx` carries the same two numbers, and the duplication is forced
 * rather than sloppy: the host ships in the main bundle and this module is
 * inside the lazily-imported engine chunk (`host/runtime.ts` — "nothing here is
 * imported statically"), so a shared constant would pull three.js into every
 * page load. If one moves, move both.
 */
const SILHOUETTE = 1.28

/**
 * THE KEEP-OUT REGION: bands of the viewport he may not stand in.
 *
 * WHY THIS EXISTS. His canvas is deliberately at `z-30`, above the app's own
 * chrome at `--z-chrome: 20`, because "he has to be able to park beside and
 * point at a nav item". That is right and stays. What follows from it is that
 * nothing but this stops him painting straight over the app header — the header
 * the chat's scrim now deliberately leaves sharp — or over the PWA "Install"
 * pill in the bottom corner. The top band is also what keeps the top of his head
 * out of the strip the viewport clips, which is the same missing clamp seen from
 * the other side. One mechanism, four symptoms.
 *
 * IT IS A CLAMP, NOT A VETO. He is pushed to the nearest legal spot rather than
 * refused the park, because refusing would break the very thing his z-index is
 * for: asked to present a nav item in the header, he stands just BELOW the
 * header, in the item's column, turned back across it. "Beside" gains a vertical
 * component exactly when the horizontal one is forbidden. He still presents it;
 * he no longer covers it.
 *
 * THE HOST SETS IT, THE ENGINE APPLIES IT — the same division `reduced` already
 * uses ("the host owns the media query; the engine owns the behaviour"). These
 * bands are the app's own furniture, published by `AppShell` as `--app-header-h`
 * and `--app-sidebar-w` and composed with `env(safe-area-inset-*)`. Resolving
 * that here would mean a `getComputedStyle` on every solve, and a solve runs on
 * every scrolled frame — which is precisely the forced layout `viewport.ts` and
 * `documentHeight`'s TTL exist to keep off this path. So the host measures, once
 * per layout change, and hands numbers in.
 *
 * A MODULE SINGLETON, for the reason `viewport.ts` gives at length: one canvas
 * and one controller per document, and threading a region through
 * `parkBeside`, `parkOn`, `homeCorner` and `solvePark` for a value identical to
 * all of them buys nothing.
 */
export type KeepOut = {
  /** Below the app header and the notch. */
  top: number
  /** Right edge inset. */
  right: number
  /** Above the composer card, the home indicator and the PWA pills. */
  bottom: number
  /** Left edge inset — the sidebar, if it is ever wanted. See `setKeepOut`. */
  left: number
}

const region: KeepOut = { top: 0, right: 0, bottom: 0, left: 0 }

/**
 * Set the bands, in CSS pixels. `null` clears them.
 *
 * Returns whether anything actually changed, so the caller can skip a re-park
 * for the ~99% of `ResizeObserver` fires that report the same layout back.
 *
 * ON THE HORIZONTAL BANDS, which are implemented and expected to stay zero.
 * The region is a rectangle because a region with only two of its four sides is
 * a shape nobody can predict from its name. But the sidebar should NOT be fed
 * into `left`: it is 275 px open and 82 px collapsed, a quarter of a 1068 px
 * window against the header's 7% of a phone, and it is *where the nav items
 * are* — a band that size would stand him a long way from the thing he was
 * asked to present. `parkBeside`'s edge exception already flips him to the
 * inboard side of anything against an edge, so a sidebar item already puts him
 * just right of the sidebar. A band would only push him further.
 */
export function setKeepOut(next: Partial<KeepOut> | null): boolean {
  const top = Math.max(0, next?.top ?? 0)
  const right = Math.max(0, next?.right ?? 0)
  const bottom = Math.max(0, next?.bottom ?? 0)
  const left = Math.max(0, next?.left ?? 0)
  if (
    top === region.top &&
    right === region.right &&
    bottom === region.bottom &&
    left === region.left
  ) {
    return false
  }
  region.top = top
  region.right = right
  region.bottom = bottom
  region.left = left
  return true
}

/** The live region. Read-only to everyone outside this module. */
export function keepOut(): Readonly<KeepOut> {
  return region
}

/**
 * The legal span for his CENTRE between two bands, given half his drawn extent.
 *
 * Half his extent is added to the band rather than compared against it because
 * what must stay out of the band is his SILHOUETTE, not the point he is solved
 * to — the same thing the horizontal clamp has always meant by `margin`.
 *
 * A BAND OF ZERO IS NO BAND, AND DOES NOT BITE. That is the difference between
 * "clamp him into the region" and "clamp him into the viewport", and it is not a
 * detail: `beacon.ts` exists entirely because he CAN leave the viewport
 * vertically while riding a scrolling element — "he can only leave vertically:
 * `parkBeside` keeps him inside the viewport horizontally". A bare
 * viewport-edge clamp on this axis would make `edge: 'top' | 'bottom'`
 * unreachable and quietly delete that feature for every caller, including the
 * ones that never declare a region at all (`/dev/decke`). So an undeclared band
 * reproduces today's answer to the bit, and only chrome the host has actually
 * named holds him.
 */
function bandSpan(lo: number, hi: number, extent: number, half: number): { lo: number; hi: number } {
  return {
    lo: lo > 0 ? lo + half : -Infinity,
    hi: hi > 0 ? extent - hi - half : Infinity,
  }
}

/**
 * Push a value into a span.
 *
 * WHEN THE SPAN IS EMPTY HE IS CENTRED IN IT, not pinned to one edge. A region
 * taller than the space it leaves means he overlaps something whatever we do —
 * a phone in landscape with the chat open is the realistic case — and splitting
 * the overlap between the two bands is the only answer that does not silently
 * pick a favourite.
 */
function into(v: number, s: { lo: number; hi: number }): number {
  return s.lo > s.hi ? (s.lo + s.hi) / 2 : Math.min(s.hi, Math.max(s.lo, v))
}

/**
 * How big he is on screen at a given depth, in CSS pixels.
 *
 * `bodyW` is the deck box, which is what the side gap and the long-standing
 * horizontal margin are sized from; `drawnH` is the SILHOUETTE, which is what a
 * clearance has to be measured against.
 */
function bodySpan(camera: PerspectiveCamera, distance: number) {
  const vFov = (camera.fov * Math.PI) / 180
  const worldPerPx = (2 * Math.tan(vFov / 2) * distance) / viewHeight()
  return {
    bodyW: BODY_W / worldPerPx,
    drawnH: (BODY_H / worldPerPx) * SILHOUETTE,
  }
}

/**
 * Clamp a viewport Y — his CENTRE, which is what every solve here places —
 * into the vertical keep-out region.
 *
 * `shift` IS THE ONE THING THAT MAKES THIS SAFE WHILE HE IS PINNED, and leaving
 * it out would have been a silent, scroll-dependent error. Pinned, the canvas is
 * slid off the viewport by `shift` and the rect handed to the solve is in CANVAS
 * coordinates, with a compensating frustum offset — `pageAnchor.test.ts` pins
 * that the pinned and tracked solves agree exactly for any shift. A clamp is not
 * linear, so it cannot cancel the way the unprojection does: it has to be
 * evaluated in the space the bands are actually expressed in. Viewport Y is
 * canvas Y plus the shift, so we convert, clamp, and convert back.
 */
function clampY(y: number, halfDrawn: number, shift: number, clamp = true): number {
  if (!clamp) return y
  const s = bandSpan(region.top, region.bottom, viewHeight(), halfDrawn)
  return into(y + shift, s) - shift
}

export function resolveRect(target: FlyTarget): DOMRect | null {
  if ('selector' in target) {
    const el = document.querySelector(target.selector)
    return el ? el.getBoundingClientRect() : null
  }
  if ('rect' in target) return target.rect
  // A `{x, y}` that is not actually a point — an Element passed by mistake, most
  // often — used to produce a DOMRect of NaN rather than a failure. NaN survives
  // `parkBeside`, survives the flight solve, and lands him at a position no test
  // asserts on and no error names; it cost a debugging session. `flyTo` already
  // throws a clear message when this returns null.
  if (!Number.isFinite(target.x) || !Number.isFinite(target.y)) return null
  return new DOMRect(target.x, target.y, 0, 0)
}

/**
 * Unproject a viewport point onto a plane at a chosen distance in front of the
 * camera, and return it in the BLENDER frame (which is what the flight solver
 * and the rig both speak).
 */
export function viewportToBlender(
  camera: PerspectiveCamera,
  clientX: number,
  clientY: number,
  distance: number,
  out = new Vector3(),
): Vector3 {
  // NDC SPANS THE CANVAS, NOT THE VIEWPORT, and those stopped being the same
  // thing when the canvas grew to cover the strip Safari's toolbar vacates. The
  // canvas is top-anchored, so a viewport Y and a canvas Y are the same number —
  // only the denominator differs.
  const ndc = new Vector2(
    (clientX / viewWidth()) * 2 - 1,
    -(clientY / canvasHeight()) * 2 + 1,
  )
  const ray = new Raycaster()
  ray.setFromCamera(ndc, camera)

  const fwd = new Vector3()
  camera.getWorldDirection(fwd)
  const camPos = new Vector3()
  camera.getWorldPosition(camPos)
  const planePoint = camPos.clone().addScaledVector(fwd, distance)
  const plane = new Plane().setFromNormalAndCoplanarPoint(fwd.clone().negate(), planePoint)

  const hit = new Vector3()
  if (!ray.ray.intersectPlane(plane, hit)) hit.copy(planePoint)

  // three Y-up -> Blender Z-up, and drop him to his own base (the rig's origin
  // is at his feet, so an unadjusted point puts his base at the element's centre
  // and his body above it).
  return out.set(hit.x, -hit.z, hit.y)
}

/**
 * Does this element hold still in the PAGE, or in the window?
 *
 * The compositor hand-off rests on one claim — that while he is parked on an
 * element and on screen, his position in document space is constant — and a
 * `sticky` or `fixed` element is precisely the case where that claim is false.
 * A stuck header's document position changes with every scrolled pixel, so a
 * pinned character slides off it by the full scroll delta until something
 * notices; and nothing would, quickly, because a stuck element resizes nothing,
 * so the `ResizeObserver` never fires and only the slow poll corrects it. The
 * result is worse than the hand-tracked path it replaced, which handles these
 * perfectly: their rect is constant in VIEWPORT space, which is the space it
 * works in.
 *
 * Worth guarding rather than treating as exotic, because `parkBeside`'s own edge
 * exception already names the case out loud — "the nav over here on a standard
 * page" — and navs are the canonical sticky element.
 */
export function ridesThePage(el: Element): boolean {
  let n: Element | null = el
  while (n && n !== document.documentElement) {
    const pos = getComputedStyle(n).position
    if (pos === 'fixed' || pos === 'sticky') return false
    n = n.parentElement
  }
  return true
}

export type ParkResult = {
  /** Where to fly to, in the Blender frame. */
  position: Vector3
  /** Which way he should face so he looks INWARD at the element. */
  facing: number
}

/**
 * The parts of a `DOMRect` the parking solve actually reads.
 *
 * Named, and used in place of `DOMRect`, so that a rect can be held rather than
 * measured. While the overlays are pinned to the page the element's box INSIDE
 * THE CANVAS is a constant — the two are pinned to the same page, so neither
 * moves relative to the other — so `DeckE` caches one of these at the pin and
 * hands it back every frame. That is the difference between a forced layout
 * every frame and none at all. See `DeckE.syncPinned`, which pairs it with a
 * frustum shift rather than with a recomputed rect.
 */
export type RectLike = Pick<DOMRect, 'left' | 'top' | 'right' | 'width' | 'height'>

/**
 * Choose a spot beside an element and the facing that looks at it.
 *
 * `auto` puts him on whichever side has more room. Facing is then whichever
 * direction turns him toward the element — the whole point is that he presents
 * the thing rather than turning his back on it.
 */
export function parkBeside(
  camera: PerspectiveCamera,
  rect: RectLike,
  opts: {
    depth: Depth
    side: Side
    baseDistance: number
    shift?: number
    clamp?: boolean
    /** See `solvePark`. `bottom` puts his base on the target's bottom edge. */
    anchor?: 'centre' | 'bottom'
  },
): ParkResult {
  const distance =
    opts.depth === 'background' ? opts.baseDistance / BACKGROUND_SCALE : opts.baseDistance

  // How wide is he, in CSS pixels, at this depth? Needed so the margin is a real
  // gap rather than a guess that collapses at the background plane.
  const { bodyW: bodyPx, drawnH } = bodySpan(camera, distance)

  // WHICH SIDE HE STANDS ON IS DECIDED BY THE ELEMENT'S HALF OF THE SCREEN,
  // NOT BY WHERE THERE HAPPENS TO BE ROOM.
  //
  // The old rule put him wherever the larger gap was, which for anything left
  // of centre means "over on the right", a long way from the thing he is meant
  // to be presenting. Reviewed as: "these targets are not really accurate — I
  // clicked this and I would expect him to be flying right HERE instead of
  // where he is."
  //
  // The rule asked for instead: "if the DOM element is anywhere on the right
  // half of the screen, he should go to the right of that element and face
  // inward. If it's to the left of the screen, then he should go to the left of
  // that element and face inward toward the center of the screen." So he ends
  // up OUTBOARD of the element and looks back across it — the element sits
  // between him and the middle of the page, which is where the reader is.
  const centre = rect.left + rect.width / 2
  let side: 'left' | 'right' =
    opts.side !== 'auto' ? opts.side : centre >= viewWidth() / 2 ? 'right' : 'left'

  const gap = bodyPx * SIDE_MARGIN
  // Half his width, near enough: 0.6 of the deck box is 0.44 of his height,
  // against a measured silhouette half-width of 0.49. Left exactly as it was,
  // so a zero keep-out region reproduces every previous answer to the bit.
  const margin = bodyPx * 0.6
  // THE HORIZONTAL KEEP-OUT IS THE SAME RULE WITH A WIDER INSET, deliberately,
  // rather than a second clamp layered on top. A second one would fight the edge
  // exception immediately below: the flip exists to rescue a park that would
  // land in the forbidden strip, so it has to be tested against the strip that
  // is ACTUALLY forbidden. Widen the inset and the test and the clamp both
  // follow for free, and there is no second rule to keep in step with the first.
  //
  // On this axis the bare viewport edge bites even with no band, because it
  // always has — this is the clamp that was already here, with the bands added
  // to it. A band is never negative, so "the edge, or the band, whichever is
  // further in" is just the band added to the margin.
  const across = { lo: region.left + margin, hi: viewWidth() - region.right - margin }
  // THE EDGE EXCEPTION, and it is the only one: "if he's flying to something
  // that is right on the edge — like the nav over here on a standard page —
  // obviously if he goes to the left of that, he's off the screen. So that
  // would be the only exception; I would have him go to the right of it and
  // look that way." Outboard is a preference; being on screen is not.
  const outboard = side === 'right' ? rect.right + gap : rect.left - gap
  if (outboard < across.lo || outboard > across.hi) {
    side = side === 'right' ? 'left' : 'right'
  }

  let x = side === 'right' ? rect.right + gap : rect.left - gap
  // Never let him leave the viewport — or the keep-out region — however cramped
  // the layout is.
  x = into(x, across)
  // THE VERTICAL CLAMP D6 IS THE OTHER SIDE OF. There has never been one: a
  // target near the top of the page put the top of his head above the top of the
  // screen and it was simply cut off. It is a clamp and not a flip because
  // vertically there is only one way back in, and because standing below a
  // header while facing across it is a perfectly good way to present it.
  // ── WHERE HE STANDS ON THE VERTICAL, AND WHY IT IS A CHOICE ─────────────
  //
  // Centring him on the target is right for something tall — a sidebar row, a
  // card — where his middle lines up with its middle and he reads as beside it.
  //
  // It is WRONG for the composer, and visibly so. That card is 58px tall and he
  // is ~216px drawn, so centring puts ~79px of him below its bottom edge. With
  // the composer where it actually lives in a conversation — hard against the
  // bottom of the window — that is 79px past the edge, and `clampY` then rescues
  // him by shoving him up until his base is flush with the window bottom.
  // Reported from use as "he's vertically centered with it which means that he's
  // too low, and going off the bottom edge of the browser. Cut off."
  //
  // `anchor: 'bottom'` puts his BASE on the target's bottom edge instead, so he
  // stands on the composer's floor with his head well above it — which is what
  // "standing beside the input" looks like when the input is a short wide box.
  const cy =
    opts.anchor === 'bottom'
      ? rect.top + rect.height - drawnH / 2
      : rect.top + rect.height / 2
  const y = clampY(cy, drawnH / 2, opts.shift ?? 0, opts.clamp ?? true)

  const position = viewportToBlender(camera, x, y, distance)
  // His ROOT is at his base, not his centre — the rig origin sits at his feet
  // and the body extends 2.4 units up from it. Dropping the target by half his
  // height is what makes him straddle the element's centre line instead of
  // standing on it with his whole body above.
  position.z -= BODY_H / 2

  // FACING IS IN HIS FRAME, NOT THE VIEWER'S, AND THIS HAD IT BACKWARDS.
  //
  // "When he goes to present something, he's facing away from it, which is
  // incorrect. He's always facing away from it." Always, and on both sides,
  // which is the signature of a sign rather than of a rule.
  //
  // The rule itself was right: standing to the viewer's right of a thing means
  // turning toward the viewer's LEFT to look at it. What was wrong is which
  // `facing` value that is. `facing` is named from HIS point of view — the
  // reviewer's note is "we need to remember that these are talking about his
  // right and his left rather than viewer right and viewer left" — so `+1` turns
  // him to HIS right, which the viewer sees as turning to screen LEFT.
  // Confirmed on screen at both ends before this was changed.
  //
  // So: on the viewer's right of the element, face `+1`. It holds after the edge
  // exception too — whichever side he ended up on, he turns back across it.
  const facing = side === 'right' ? 1 : -1
  return { position, facing }
}

/**
 * Stand ON a viewport point, rather than beside it.
 *
 * `parkBeside` is the right solve for presenting: it puts him OUTBOARD of an
 * element so the element sits between him and the middle of the page. That is
 * wrong for a space he is meant to occupy — a well cut into a panel, say —
 * where the gap it adds pushes him half out of the container.
 *
 * This is the same geometry `homeCorner` already uses, generalised: unproject
 * the point onto the depth plane, then drop by half a body so his ROOT sits
 * below the point and his centre lands on it. His facing is left to the caller,
 * because a point has no inward.
 *
 * THE KEEP-OUT REGION APPLIES HERE TOO, and the case that makes that worth
 * saying is the phone chat's park box, which deliberately overlaps the composer
 * — "about half of him overlaps it. That overlap is the point." Exempting a
 * named point would have been the easy way to protect it, and it would have been
 * the wrong one: the exemption belongs to the MOMENT, not to the call. The host
 * already re-measures the region on every layout change and already knows
 * whether the chat is open, so the composer band is simply absent while the
 * composer is his own furniture. A per-call flag would have to be threaded
 * through `flyTo`, the `Station` and the re-solve, and the last time an intent
 * was carried by the launch and not by the station it took a shipped bug and
 * `solvePark` to fix. See the note on that function.
 */
export function parkOn(
  camera: PerspectiveCamera,
  x: number,
  y: number,
  opts: { depth: Depth; baseDistance: number; shift?: number; clamp?: boolean },
): Vector3 {
  const distance =
    opts.depth === 'background' ? opts.baseDistance / BACKGROUND_SCALE : opts.baseDistance
  const { bodyW, drawnH } = bodySpan(camera, distance)
  // `bodyW * 0.6` for the half-width, which is `parkBeside`'s long-standing
  // `margin` and not the measured silhouette half-width (0.44 of his height
  // against 0.49). One rule for both solves beats a marginally better number in
  // one of them, and changing `parkBeside`'s would move every park that has ever
  // shipped for a reason that has nothing to do with the keep-out region.
  const p = viewportToBlender(
    camera,
    (opts.clamp ?? true) ? into(x, bandSpan(region.left, region.right, viewWidth(), bodyW * 0.6)) : x,
    clampY(y, drawnH / 2, opts.shift ?? 0, opts.clamp ?? true),
    distance,
  )
  p.z -= BODY_H / 2
  return p
}

/**
 * A STATION BECOMES A POSITION HERE, and only here.
 *
 * `flyTo` and the station re-solve are the same question asked at two different
 * moments — where does he stand, given this target? — and they were two
 * different pieces of code. So they could disagree, and they did: `flyTo`
 * honoured `centre` and the re-solve did not, which meant he flew to the middle
 * of his mark and the first resize, scroll or dirty-station poll quietly moved
 * him beside it instead.
 *
 * That is not a small drift when the mark is against the left edge of the
 * screen. `parkBeside` has an edge exception that flips him to the far side of
 * anything he would otherwise hang off the screen for, so a mark in the
 * bottom-left corner threw him a body's width to the RIGHT — on top of the
 * layout the mark existed to keep him clear of.
 *
 * One function, both callers, so the two can no longer drift apart.
 *
 * `facing` is absent for a centre park, deliberately: a point has no inward, so
 * the caller's facing is left alone rather than being invented here.
 */
export function solvePark(
  camera: PerspectiveCamera,
  rect: RectLike,
  opts: {
    depth: Depth
    side: Side
    baseDistance: number
    centre?: boolean
    /**
     * Which part of HIM lines up with the target on the vertical.
     *
     * `centre` (default) matches his middle to the target's middle. `bottom`
     * puts his base on the target's bottom edge — for a target much shorter
     * than he is, where centring hangs most of him below it.
     */
    anchor?: 'centre' | 'bottom'
    /**
     * Where the canvas's top edge sits in the viewport, when `rect` is in CANVAS
     * coordinates rather than viewport ones — which is to say, while he is
     * pinned. 0 or absent otherwise. See `clampY`.
     */
    shift?: number
    /**
     * Hold him inside the keep-out region.
     *
     * TRUE FOR A PLACEMENT, FALSE WHILE TRACKING A SCROLL, and the distinction
     * is what keeps the off-screen beacon alive. The beacon exists entirely
     * because he can leave the viewport vertically while riding a scrolling
     * element — `beacon.ts` says so in as many words. A clamp applied on the
     * per-frame scroll re-solve would hold him at the band for ever, so he
     * could never leave, so `edge: 'top' | 'bottom'` would become unreachable
     * and the chip that brings him back would be dead code nobody had deleted.
     *
     * A clamp belongs where he is BEING PUT somewhere: a flight, a re-park
     * after a resize, a keep-out change. It does not belong where he is
     * FOLLOWING something the reader is scrolling away.
     */
    clamp?: boolean
  },
): { position: Vector3; facing?: number } {
  if (opts.centre) {
    return {
      position: parkOn(camera, rect.left + rect.width / 2, rect.top + rect.height / 2, {
        depth: opts.depth,
        baseDistance: opts.baseDistance,
        shift: opts.shift,
      }),
    }
  }
  return parkBeside(camera, rect, opts)
}

/**
 * The parking spot `returnHome` flies to, in the BLENDER frame.
 *
 * Bottom-right of the VIEWPORT rather than the origin of the world. The origin
 * is where he is STAGED for review — it is what the Blender camera frames and
 * where every parity still is taken — but it is the worst place to leave an
 * assistant on a page, because it is on top of the content. Deriving it from the
 * viewport also means it survives a resize, which a world coordinate cannot.
 *
 * (This doc comment had drifted one function up the file, above `parkOn`, when
 * `parkOn` was inserted between the two. It belongs here, and `homeCorner` now
 * calls `parkOn` rather than restating it — which `parkOn`'s own header already
 * claimed it was a generalisation of.)
 */
export function homeCorner(camera: PerspectiveCamera, baseDistance: number): Vector3 {
  // Home is VIEWPORT-relative and is never pinned (`canPin` refuses a station
  // that is not a selector), so there is no canvas shift to correct for.
  return parkOn(camera, viewWidth() * (1 - HOME_INSET.x), viewHeight() * (1 - HOME_INSET.y), {
    depth: 'foreground',
    baseDistance,
  })
}

/**
 * Path shaping for an arbitrary A->B.
 *
 * The three `arc`/`bow` values in the source are hand-picked constants for three
 * hand-picked Blender legs; an arbitrary DOM destination needs them derived.
 * Both scale with distance, and `bow` alternates sign per leg so an out-and-back
 * traces a lens rather than retracing one line.
 */
export function shapeFor(a: Vector3, b: Vector3, legIndex: number) {
  const dist = a.distanceTo(b)
  return {
    // He rises into the trip and descends onto the mark.
    arc: Math.min(1.1, 0.18 + dist * 0.06),
    // Lateral sweep is what makes a long move read as flight rather than a zoom.
    bow: Math.min(4, dist * 0.22) * (legIndex % 2 === 0 ? 1 : -1),
    // Short hops are crisper; the long traverse gets a lower cruise so it reads
    // as covering ground rather than darting.
    //
    // NOT the knob for overall pace, however much it looks like one. These are
    // the solver's INTEGRATION speeds, and it integrates until it arrives:
    // raising them shortens the trip right up to the point where the
    // stopping-distance law overshoots its own settle window every frame and the
    // leg limit-cycles out to the 600-frame cap. Measured, raising the long
    // cruise from 0.08 to 0.185 turned a 3067 ms leg into a 20167 ms one — the
    // cap exactly. Pace is set by `travelRate()` in `flight.ts`, which scales the
    // finished track and cannot destabilise a controller that has already run.
    cruise: dist > 4 ? 0.08 : 0.1,
  }
}
