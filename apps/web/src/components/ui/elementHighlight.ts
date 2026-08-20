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
 * resize, so it stays put without the caller having to think about it.
 */

const LAYER_ID = 'decke-highlight-layer'
const CYCLE_MS = 2600
/** How far outside the element's box the ring sits. Enough to clear a 1px border
 *  and a focus ring without looking detached. */
const INSET = -6

export type HighlightOptions = {
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
  s.left = `${r.left + INSET}px`
  s.top = `${r.top + INSET}px`
  s.width = `${r.width - INSET * 2}px`
  s.height = `${r.height - INSET * 2}px`
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
  place(live)
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
