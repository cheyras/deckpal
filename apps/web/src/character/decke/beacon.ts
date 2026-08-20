/**
 * The off-screen beacon — "he is still over there, just past the edge".
 *
 * Once he scrolls with the thing he is presenting (see `DeckE.syncStation`), he
 * can leave the viewport with the element, and a character who simply is not
 * there any more reads as a bug rather than as a scroll position. The reviewer
 * asked for the fighting-game answer:
 *
 *   "If he goes off the screen, I was thinking we'd give him a small indicator,
 *    like they do in Smash Bros... I would make this triangle here be part of
 *    the thing, but it's actually pointing at where he is, and it shows what
 *    he's actually doing in here. And I would make it styled like our app, app
 *    colour — or actually, maybe it's the rainbow gradient. And then if you click
 *    on it, it scrolls back up so that he's vertically centred as much as
 *    possible... do like a smooth scroll with some easing. And as soon as he is
 *    visible, that little indicator would go away."
 *
 * SHOWING WHAT HE IS DOING IS THE WHOLE POINT, and it is why this is not an
 * icon. The beacon is a live second view of the same scene: the renderer draws
 * the character a second time into the chip's rectangle, from a camera on the
 * same sight-line, so whatever he is doing off-screen — thinking, loading,
 * holding up a card — is what the reader sees in the chip. See
 * `Stage.renderInset`.
 *
 * SIZE IS A CONSTRAINT, not a preference: "make it fairly small — I don't want
 * it to be huge. He should look smaller in that little frame than he is in
 * person. So fairly small, especially on mobile; that's gonna look really bad if
 * it's like any more than a button size. You know, like how we do our circular
 * buttons, I would keep it about that big." The app's circular icon buttons are
 * 44 px, so the chip is 52 and the character fills a little over half of it.
 */

export const BEACON = {
  /** The chip's diameter, in CSS pixels. The app's round icon buttons are 44. */
  size: 52,
  /** How far the chip sits in from the viewport edge it is pinned to. */
  edgeInset: 12,
  /** How close to the left/right edge the chip may be pushed. */
  sideMargin: 10,
  /** How much of the chip's height the character fills. Deliberately not all of
   *  it — "he should look smaller in that little frame than he is in person". */
  fill: 0.56,
  /** The pointer's height beyond the chip. */
  arrow: 9,
} as const

export type Beacon = {
  /** Where his centre is, horizontally, in viewport CSS pixels — already clamped
   *  so the chip cannot be pushed off the side while chasing him. */
  x: number
  /** Which edge he is past. He can only leave vertically: `parkBeside` keeps him
   *  inside the viewport horizontally, and home is viewport-relative. */
  edge: 'top' | 'bottom'
}

/**
 * The nearest ancestor that actually scrolls, or null for the document.
 *
 * The character's scroll listener is capture-phase specifically so that an
 * element inside a nested scroll container still drags him along. The way BACK
 * has to find the same container: scrolling the document when the offset lives
 * in an inner pane moves the page and leaves him exactly where he was.
 */
export function scrollableAncestor(el: Element | null): HTMLElement | null {
  let n = el instanceof HTMLElement ? el.parentElement : null
  while (n && n !== document.body && n !== document.documentElement) {
    const o = getComputedStyle(n)
    const scrolls = /auto|scroll|overlay/.test(o.overflowY)
    if (scrolls && n.scrollHeight > n.clientHeight + 1) return n
    n = n.parentElement
  }
  return null
}

/** The chip's rectangle in CSS pixels, top-left origin — what the renderer needs
 *  to draw the inset, and what the DOM chip is positioned at. One function so
 *  the two can never disagree by a pixel. */
export function beaconRect(b: Beacon): { x: number; y: number; w: number; h: number } {
  const s = BEACON.size
  return {
    x: Math.round(b.x - s / 2),
    y: Math.round(
      b.edge === 'top' ? BEACON.edgeInset : window.innerHeight - BEACON.edgeInset - s,
    ),
    w: s,
    h: s,
  }
}

/**
 * Where the page would have to be scrolled for him to sit vertically centred.
 *
 * "It scrolls back up so that he's kind of vertically centred as much as
 * possible — like if he's at the top, obviously he's not going to be vertically
 * centred." Which is what clamping to the document's own scroll range does, so
 * that is the whole of the "as much as possible".
 */
export function scrollToCentre(centreY: number, scroller?: HTMLElement | null): number {
  if (scroller) {
    // `centreY` is in the VIEWPORT, and the container's own scroll is relative
    // to its box, so the shift is measured against the container's midpoint
    // rather than the viewport's.
    const box = scroller.getBoundingClientRect()
    const target = scroller.scrollTop + centreY - (box.top + box.height / 2)
    const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
    return Math.min(max, Math.max(0, target))
  }
  const target = window.scrollY + centreY - window.innerHeight / 2
  const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight)
  return Math.min(max, Math.max(0, target))
}
