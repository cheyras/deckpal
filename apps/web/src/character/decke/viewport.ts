/**
 * ONE ANSWER TO "HOW BIG IS THE SCREEN", for the whole character runtime.
 *
 * THE DEFECT. Every part of this runtime used to read `window.innerWidth` and
 * `window.innerHeight` for itself, at the moment it happened to need them — the
 * renderer's drawing buffer, the camera aspect, the dolly that sets his apparent
 * height, the unprojection that turns a DOM rect into a world position, the home
 * corner, the beacon's edge inset. On a desktop those all agree and the
 * duplication is invisible. On an iPhone they do not, because `innerHeight` is
 * the VISUAL viewport and it changes by roughly a hundred pixels every time
 * Safari's toolbars slide away and come back:
 *
 *   "Down here we have the bottom of the browser, and when I scroll down and it
 *    goes away, his height scales with that going away, and then he readjusts
 *    and snaps back to his proper size, and that shouldn't be happening... when
 *    it comes back the same thing happens. He scales down a little and then pops
 *    back into proper."
 *
 *   "If I scroll up at the top like this, he becomes more thin."
 *
 * Two separate failures, one cause. The renderer was sized from `innerHeight`
 * while the canvas is `position: fixed; inset: 0` and therefore sized by CSS to
 * the LAYOUT viewport, so the drawing buffer and the box it is stretched into
 * disagreed by exactly the height of the toolbar — a non-uniform scale, which is
 * "more thin". And his target height in pixels was itself computed from
 * `innerHeight`, so the toolbar sliding away genuinely asked for a different
 * character size and the re-park that followed flew him to a new spot.
 *
 * THE RULE, and it is the whole point of this module: nothing under
 * `character/decke/` may read `window.innerWidth` or `window.innerHeight` again.
 * The size is measured ONCE per resize, from the canvas's own client box — the
 * surface actually being drawn into — and everything downstream reads it here.
 * Buffer, camera, dolly, parking and projection then cannot disagree with each
 * other or with what is on screen, whatever the browser is doing with its own
 * furniture.
 *
 * A MODULE SINGLETON, deliberately. There is one full-screen fixed canvas and
 * one controller per document; making this an instance field would mean
 * threading a size through `viewportToBlender`, `parkBeside`, `homeCorner`,
 * `solveBeacon` and `beaconRect` for a value that is the same for all of them.
 * The cost of the shortcut is that two controllers in one document would share a
 * viewport, which is not a configuration that exists.
 */

let w = 0
let h = 0

/** Record the size of the surface being drawn into. Called from `DeckE.resize`,
 *  which is the single entry point for a size change. */
export function setViewport(width: number, height: number) {
  if (width > 0) w = width
  if (height > 0) h = height
}

/**
 * The fallbacks are for the window between construction and the first
 * `resize()` — a real gap, because `homeCorner` runs during `load()` to decide
 * where he starts. They are the only `window.inner*` reads left in the runtime,
 * and they are read once each.
 */
export function viewWidth(): number {
  return w || window.innerWidth
}

export function viewHeight(): number {
  return h || window.innerHeight
}
