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
let ch = 0

/**
 * Record both sizes. Called from `DeckE.resize`, the single entry point for a
 * size change.
 *
 * TWO SIZES, AND THE DIFFERENCE IS THE WHOLE OF THE ONE-BAR-TALL STRIP AT THE
 * BOTTOM. `height` is the viewport he is ALLOWED to occupy and everything is
 * measured against — stable, because it is `100svh`, the viewport with Safari's
 * toolbars showing. `canvasHeight` is how much surface is actually drawn into,
 * which has to be `100lvh`, the viewport with them hidden, or the moment they
 * slide away there is a strip of screen the canvas does not reach:
 *
 *   "The bottom of him is often getting cut off. It's always cut off at the
 *    bottom where the full height of the bottom bar in Safari would be... and
 *    then sometimes he's just cut off a bit at the bottom even in the middle of
 *    the screen."
 *
 * Both of those are one defect. The clip line was `100svh` from the top, which
 * is a bar's height ABOVE the bottom of a screen whose toolbar has collapsed —
 * so a character standing low enough was cut off well short of the edge, which
 * is what "even in the middle of the screen" is describing.
 *
 * The naive fix is to size everything from the visible viewport, and that is the
 * defect this module exists to prevent: `innerHeight` moves as the toolbars
 * slide, and keying his SIZE to a moving number is "his height scales with that
 * going away, and then he readjusts and snaps back". Hence two numbers, both
 * stable, with the larger used only for coverage and the smaller for every
 * placement decision.
 */
export function setViewport(width: number, height: number, canvasHeight = height) {
  if (width > 0) w = width
  if (height > 0) h = height
  if (canvasHeight > 0) ch = canvasHeight
  // The document's scrollable range moved with it.
  docHAt = -1e9
}

/**
 * The height of the drawing surface, which is at least `viewHeight()` and is
 * more than it exactly when the browser has furniture that can slide away.
 *
 * Only two things may use it: the projection, because NDC spans the canvas and
 * not the viewport, and the pin's containment test, because the canvas edge is
 * what clips him. Everything about WHERE he is allowed to stand is
 * `viewHeight()`.
 */
export function canvasHeight(): number {
  return ch || viewHeight()
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

/**
 * How far past the end of the document the page is currently drawn, in CSS
 * pixels. Negative above the top, positive past the bottom, 0 the rest of the
 * time — which is almost always.
 *
 * THE ELASTIC BOUNCE, WHERE IT IS OBSERVABLE AT ALL. "When I scroll beyond the
 * limit, that highlight and him don't go down with it." They cannot, in Chrome:
 * the bounce is a compositor paint transform that never touches the layout tree,
 * `scrollY` is clamped, and Chrome deliberately shipped
 * `FixedElementsDontOverscroll` in 2022 so a fixed layer is pinned through it by
 * design. Measured here under a synthesised compositor gesture: `scrollY`,
 * `getBoundingClientRect().top`, `visualViewport.offsetTop` and `.pageTop` are
 * all flat for the whole bounce. There is nothing to read.
 *
 * WebKit is the opposite, and it is documented rather than incidental — MDN says
 * plainly that "Safari responds to overscrolling by updating scrollY beyond the
 * maximum scroll position", and that it may go negative at the top. So on the
 * engine the phone actually runs, the offset IS readable, and this returns it.
 *
 * So the answer is genuinely per-engine, and the code does not have to choose:
 * where the number exists it is tracked, and where it does not this returns 0
 * forever and the `overscroll-behavior-y` lock stays on to remove the
 * disagreement instead. See `DeckE`.
 */
let docH = 0
let docHAt = -1e9

/**
 * How tall the document is, cached on a short TTL.
 *
 * `scrollHeight` FORCES LAYOUT, and both callers run every frame — the bounce
 * probe below, and the pinned path's check that the canvas is not about to be
 * placed past the end of the page. Reading it per frame would put back a large
 * part of the cost this whole runtime was restructured to remove.
 *
 * A quarter of a second of staleness is safe for both: a document's height
 * changes when content loads or the viewport changes, neither of which happens
 * at frame rate, and `setViewport` invalidates it explicitly when the second one
 * does. The worst it can do is mis-time the first frame of a bottom bounce, or
 * take one extra tick to notice that a pin would now overhang the page.
 */
export function documentHeight(): number {
  const now = performance.now()
  if (now - docHAt > 250) {
    docHAt = now
    docH = document.documentElement.scrollHeight
  }
  return docH
}

/**
 * Is the document's scroll pinned by a sheet or the chat panel?
 *
 * `lockScroll` (see `components/ui/Sheet.tsx`) holds the body at
 * `position: fixed; top: -<scrollY>px; overflow: hidden`. Reading the INLINE
 * style is deliberate and is the reason this is affordable per frame: it is a
 * string compare against a property the lock itself wrote, with no computed
 * style and therefore no forced layout. `getComputedStyle` here would put a
 * reflow in the middle of every frame the chat is open.
 *
 * It is also intentionally a question about the BODY rather than about who
 * locked it. Anything that pins the page produces the same hazard below, and a
 * predicate that asks "is the page pinned" cannot fall out of step with a list
 * of the things that pin it.
 */
function scrollPinned(): boolean {
  return document.body.style.position === 'fixed'
}

export function elasticOffset(): number {
  // ── A PINNED PAGE HAS NO RUBBER BAND, AND `scrollY` LIES ABOUT IT ──────────
  //
  // THE DEFECT, on a phone with the chat open and the keyboard coming up:
  //
  //   "Deck-E disappears, and then if I scroll up a little he comes back into
  //    view... he scrolls at a faster rate than the rest of the page."
  //
  // `lockScroll` pins the body, which collapses the document to the viewport —
  // measured with the chat open at 375x812, `scrollHeight` and the viewport are
  // both 812, so `maxScroll` below is exactly 0. iOS then does the one thing the
  // lock cannot stop it doing: focusing a text field makes Safari scroll the
  // document to reveal it EVEN THOUGH the body is `position: fixed`. `scrollY`
  // goes positive against a `maxScroll` of 0, and every pixel of it is returned
  // here as though the page were being rubber-banded.
  //
  // `followElastic` then sets `translate3d(0, -scrollY, 0)` on the canvas. The
  // first frame throws him a whole keyboard's height off the top of the screen —
  // that is the disappearance — and from then on he carries the page's own
  // movement a second time, which is why he travels at exactly TWICE the rate of
  // everything around him.
  //
  // The bounce is a property of a scrollable document. While the page is pinned
  // there is nothing to bounce, so there is nothing to follow, and any `scrollY`
  // is by definition the browser doing something else with it.
  if (scrollPinned()) return 0
  const y = window.scrollY
  // Cheap case first, and it is the top bounce — no layout read at all.
  if (y < 0) return y
  const maxScroll = Math.max(0, documentHeight() - viewHeight())
  return y > maxScroll ? y - maxScroll : 0
}
