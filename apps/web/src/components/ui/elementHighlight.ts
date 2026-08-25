/**
 * The highlight ring — "the thing being talked about is THIS one".
 *
 * A DESIGN-SYSTEM primitive, deliberately, and living here rather than beside
 * the character who prompted it: "I would build the highlighting functionality
 * into the design system itself... let's just come up with a way to make it look
 * like it's being very clearly highlighted." Deck-E is its first caller and will
 * not be its last — anything that has to say *this element* (a tour step, a
 * search result the agent found, a row a background job just changed) wants the
 * same treatment, and none of those should have to import a mascot to get it.
 *
 * It is imperative rather than a component because the elements it rings are
 * usually not the caller's to wrap: an agent has a selector, not a JSX tree.
 * `HighlightRing.tsx` is the declarative wrapper for the cases that do.
 *
 * WHAT IT DRAWS. A chasing border: "maybe it's like whatever element it is gets
 * a marching — you know, what would you call it — a chasing border with rainbow,
 * so it would have our cyan, our rose and our yellow, maybe, as a rainbow
 * effect... I feel like that's kind of a shorthand for something agentic going
 * on." Which it is: a travelling multi-hue edge is the one border treatment no
 * static UI state uses, so it cannot be confused with focus, selection, error or
 * hover.
 *
 * It is built from the PRODUCT'S OWN hue scales rather than a literal ROYGBIV
 * ("or, you know, maybe it is just actually rainbow, like the whole Roy G Biv"),
 * because a true rainbow on this dark surface reads as a novelty gradient and
 * fights the palette everywhere else on the page. `theme.css` already carries
 * exactly the three the note names — brand primary is cyan, secondary is
 * pink/rose, tertiary is amber — so the ring sweeps those and returns to cyan.
 * It reads as "not a normal border" while still looking like this product, and
 * it recolors with the theme instead of pinning hexes into a module nobody
 * thinks to update.
 *
 * WHY AN OVERLAY AND NOT A CLASS ON THE ELEMENT.
 *
 *  - It must work on elements this module has never seen, including ones inside
 *    `overflow: hidden` parents, ones with their own borders, and ones it must
 *    not reflow. An absolutely-positioned sibling in a fixed-position layer
 *    touches none of that.
 *  - The character is rendered into a full-viewport canvas at `z-30`. The ring
 *    has to be able to sit under him and over the page, which a border on the
 *    element itself cannot do.
 *  - Removing a highlight must be total. Deleting one node is; unwinding class
 *    names from an element some other code may have re-rendered is not.
 *
 * The whole thing is `position: fixed` and follows the element on scroll and
 * resize, so it stays put without the caller having to think about it — EXCEPT
 * while `setHighlightAnchor` has pinned the layer into the page, when the ring
 * on the anchored element stops being recomputed because it no longer needs to
 * be. Rings on any OTHER element keep following per frame, because for those the
 * pin's premise does not hold. See `setHighlightAnchor`.
 */

import { pinToPage, unpinToViewport } from '../../character/decke/pageAnchor'

const LAYER_ID = 'decke-highlight-layer'
const CYCLE_MS = 2600
/** How far outside the element's box the ring sits. Enough to clear a 1px border
 *  and a focus ring without looking detached. Exported so `ringRect`'s test can
 *  state its assertions in terms of this constant rather than a copied `-6`. */
export const INSET = -6

/** A box in the same shape `getBoundingClientRect()` returns — narrowed to the
 *  four fields `ringRect` actually needs, so a test can hand it a plain object
 *  instead of a real DOMRect. */
export type BoxLike = { left: number; top: number; width: number; height: number }

/**
 * The ring's own box, in the layer's coordinate space, given the box being rung
 * and the layer's current drift (0 unless the layer is pinned into the page —
 * see `place` and `setHighlightAnchor`).
 *
 * Pulled out to a pure function rather than left inline in `place()` because
 * this arithmetic used to be checkable only by opening a browser and eyeballing
 * whether a ring's edge cleared a card's footer — which is exactly how the
 * GridView regression this file's test now pins (ring bleeding into the next
 * row) shipped unnoticed in the first place. Given a DOMRect-shaped box, none of
 * this needs a DOM at all.
 */
export function ringRect(box: BoxLike, drift = 0): BoxLike {
  return {
    left: box.left + INSET,
    top: box.top + drift + INSET,
    width: box.width - INSET * 2,
    height: box.height - INSET * 2,
  }
}

type HighlightOptions = {
  /** Rounded-corner radius in px. Defaults to the element's own, so it traces
   *  the shape the reader already sees rather than boxing it. */
  radius?: number
  /** Drop the highlight automatically after this long. */
  durationMs?: number
}

type Live = {
  el: Element
  ring: HTMLElement
  timer: number | null
}

let live: Live | null = null
let raf = 0
/** The document offset the whole layer is pinned at, or null while it is pinned
 *  to the viewport. See `setHighlightAnchor`. */
let anchorDocY: number | null = null
/** The element the anchor was taken for. A ring on anything else still has to be
 *  followed by hand — see `follow`. */
let anchorEl: Element | null = null

function layer(): HTMLElement {
  let el = document.getElementById(LAYER_ID)
  if (el) return el
  el = document.createElement('div')
  el.id = LAYER_ID
  // Below the character's canvas (z-30) and above ordinary page content, so he
  // can stand in front of the thing he is pointing at.
  el.style.cssText =
    'position:fixed;inset:0;pointer-events:none;z-index:25;contain:layout style size'
  document.body.appendChild(el)
  injectKeyframes()
  // The layer is created LAZILY, the first time anything is ringed — which can
  // happen while the character is already pinned to the page. A layer born fixed
  // in the middle of a pinned park would sit still while he rode the page.
  if (anchorDocY !== null) pinToPage(el, anchorDocY)
  return el
}

let injected = false
function injectKeyframes() {
  if (injected) return
  injected = true
  const style = document.createElement('style')
  // `--decke-chase` is animated rather than `background-position`, because a
  // registered angle property interpolates on the compositor; animating the
  // position of a conic gradient does not, and on a 60 Hz page the difference is
  // visible as a stepping edge.
  style.textContent = `
@property --decke-chase { syntax: '<angle>'; inherits: false; initial-value: 0deg; }
@keyframes decke-chase { to { --decke-chase: 360deg; } }
@keyframes decke-halo { 0%,100% { opacity: .30 } 50% { opacity: .55 } }
.decke-ring {
  position: absolute;
  border-radius: inherit;
  padding: 2px;
  background: conic-gradient(
    from var(--decke-chase),
    var(--decke-hue-1) 0deg,
    var(--decke-hue-2) 90deg,
    var(--decke-hue-3) 180deg,
    var(--decke-hue-2) 270deg,
    var(--decke-hue-1) 360deg
  );
  /* Punch the middle out so the gradient is only ever an EDGE. Two layers,
     xor-composited: the ring is the difference between the outer box and the
     inset one, which keeps the stroke width exact at every corner radius. */
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  mask-composite: exclude;
  animation: decke-chase ${CYCLE_MS}ms linear infinite;
}
.decke-ring::after {
  content: '';
  position: absolute;
  inset: -7px;
  border-radius: inherit;
  background: inherit;
  filter: blur(9px);
  opacity: .38;
  animation: decke-halo ${CYCLE_MS * 1.5}ms ease-in-out infinite;
}
@media (prefers-reduced-motion: reduce) {
  .decke-ring, .decke-ring::after { animation: none }
}
`
  document.head.appendChild(style)
}

function place(l: Live) {
  const r = l.el.getBoundingClientRect()
  const s = l.ring.style
  // The ring's offsets are relative to the LAYER, and while the layer is pinned
  // to the page the layer's top edge is at document `anchorDocY` rather than at
  // the top of the viewport. Adding the drift back converts a viewport rect into
  // a layer-relative one, which makes this the same function in both modes —
  // and, while pinned, an IDEMPOTENT one: `r.top` falls exactly as fast as the
  // drift rises, so the answer is a constant. That is the whole point, and it is
  // why `follow` stops calling this the moment the layer is pinned.
  const drift = anchorDocY === null ? 0 : window.scrollY - anchorDocY
  const box = ringRect(r, drift)
  s.left = `${box.left}px`
  s.top = `${box.top}px`
  s.width = `${box.width}px`
  s.height = `${box.height}px`
}

function follow() {
  raf = 0
  if (!live) return
  // An element that has left the document has no box, so the ring would collapse
  // to a dot near wherever it last was and sit there forever, holding a rAF loop
  // open behind it. A ringed element being unmounted is ordinary — the agent
  // rings a row and the list re-renders — so this is the common path, not a
  // paranoid guard.
  if (!live.el.isConnected) {
    clearHighlight()
    return
  }
  // Pinned, the ring's position within the layer is a constant and the layer is
  // being moved by the compositor, so there is nothing here to recompute. The
  // loop keeps running for the unmount check above, which is cheap and is the
  // only thing that still has to be watched.
  //
  // ONLY FOR THE ANCHORED ELEMENT, THOUGH. This is a design-system primitive and
  // the character is not its only caller — a tour step, a search hit, a row a
  // background job just changed. The pin says one specific element holds still
  // in the page; it says nothing about any other, and an element inside an inner
  // scroller genuinely moves while the document does not. Freezing those was a
  // ring stuck to the wrong place for the life of the pin.
  if (anchorDocY === null || live.el !== anchorEl) place(live)
  raf = requestAnimationFrame(follow)
}

/**
 * Ring an element. Highlighting a second element moves the ring rather than
 * adding one — he can only be presenting one thing at a time, and two rings
 * would read as a multi-select.
 */
export function highlightElement(
  target: Element | string,
  opts: HighlightOptions = {},
): Element | null {
  const el = typeof target === 'string' ? document.querySelector(target) : target
  if (!el) return null

  clearHighlight()

  const ring = document.createElement('div')
  ring.className = 'decke-ring'
  ring.setAttribute('aria-hidden', 'true')
  const radius =
    opts.radius ?? (parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0)
  ring.style.borderRadius = `${radius + Math.abs(INSET)}px`
  // Read from the design tokens so the ring restyles with the theme instead of
  // pinning three hex values into a module nobody thinks to update.
  const css = getComputedStyle(document.documentElement)
  const hue = (name: string, fallback: string) =>
    css.getPropertyValue(name).trim() || fallback
  // The three brand hue scales: primary = cyan, secondary = pink/rose,
  // tertiary = amber. Tertiary is read one step lighter than the other two
  // because amber-400 is a darker value than cyan-400 or pink-400 and drops out
  // of the sweep against this surface; -300 sits at the same visual weight.
  ring.style.setProperty('--decke-hue-1', hue('--color-brand-primary-400', '#00d3f3'))
  ring.style.setProperty('--decke-hue-2', hue('--color-brand-secondary-400', '#fb64b6'))
  ring.style.setProperty('--decke-hue-3', hue('--color-brand-tertiary-300', '#ffd230'))

  layer().appendChild(ring)
  live = { el, ring, timer: null }
  place(live)
  if (!raf) raf = requestAnimationFrame(follow)

  if (opts.durationMs !== undefined) {
    live.timer = window.setTimeout(clearHighlight, opts.durationMs)
  }
  return el
}

export function clearHighlight() {
  if (!live) return
  if (live.timer !== null) clearTimeout(live.timer)
  live.ring.remove()
  live = null
  if (raf) {
    cancelAnimationFrame(raf)
    raf = 0
  }
}

/** The element currently ringed, if any. */
export function highlighted(): Element | null {
  return live?.el ?? null
}

/**
 * Shift the whole ring layer, in CSS pixels, to ride the page's elastic bounce.
 *
 * The ring is a `position: fixed` layer, so it does not participate in the
 * rubber band — "that highlight and him don't go down with it". Where the engine
 * reports the bounce (WebKit does; Chrome pins every readable metric flat)
 * `DeckE` reads the offset and hands it here so the ring and the character take
 * the SAME translation. Anything less and the two overlays disagree with each
 * other as well as with the page, which is worse than either one being still.
 *
 * A transform on the layer rather than on each ring: it is one composited
 * property on one element, and the per-frame `place()` loop that positions the
 * rings inside it is left completely alone.
 */
export function setHighlightShift(px: number) {
  const el = document.getElementById(LAYER_ID)
  if (!el) return
  el.style.transform = px === 0 ? '' : `translate3d(0, ${px}px, 0)`
}

/**
 * Move the whole ring layer out of the viewport and into the page, at document
 * offset `docY`; `null` puts it back.
 *
 * The ring has exactly the character's problem and had exactly his workaround —
 * a `position: fixed` layer with a per-frame loop reading the element's rect and
 * writing the ring's offsets, which is smooth only as often as the browser hands
 * out frames. Pinned, both stop: the ring's offsets within the layer are
 * constant (see `place`), and the layer is carried by whatever moves the
 * scrolling contents.
 *
 * THE TWO LAYERS HAVE TO AGREE, which is why this is driven from `DeckE` rather
 * than decided here. He is drawn into a canvas at `z-30` and the ring sits under
 * him at `z-25`; one of them riding the compositor while the other chases on the
 * main thread would put visible daylight between a character and the thing he is
 * pointing at, which is worse than both of them being chunky together.
 */
export function setHighlightAnchor(docY: number | null, el: Element | null = null) {
  if (docY === anchorDocY && el === anchorEl) return
  anchorDocY = docY
  anchorEl = docY === null ? null : el
  // No layer means nothing is ringed. The offset is still recorded, because
  // `layer()` reads it when one is created later.
  const layerEl = document.getElementById(LAYER_ID)
  if (!layerEl) return
  if (docY === null) unpinToViewport(layerEl)
  else pinToPage(layerEl, docY)
  // Either direction changes what "layer-relative" means, so the ring has to be
  // re-placed in the same frame — the switch is invisible only if nothing inside
  // the layer moves while the layer itself does not.
  if (live) place(live)
}
