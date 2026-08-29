/**
 * WHILE YOU ARE TYPING, A DRAG DOES NOT SCROLL THE PAGE OUT FROM UNDER YOU.
 *
 * ── WHY THIS IS THE FIX AND A CORRECTION IS NOT ──────────────────────────────
 *
 * iOS reveals the focused composer by scrolling the DOCUMENT, and lets `fixed`
 * layers ride that scroll — which is the only reason the panel lands on the
 * keyboard at all. A flick afterwards keeps riding, and drags the composer up
 * off the keyboard with a dead gap under it.
 *
 * That cannot be corrected after the fact, and this was measured rather than
 * assumed: with a rule drawn on the glass at each candidate (`KbDiag.tsx`), on
 * iOS 26.5 once the document has scrolled past iOS's own reveal, BOTH
 * `visualViewport.height` AND `window.innerHeight` under-report the visible
 * area by exactly the extra scroll. Both rules land under the composer instead
 * of on the keyboard. There is no number left on the platform that says where
 * the keyboard is, so the scroll has to not happen.
 *
 * `overscroll-behavior: contain` was tried first, because one CSS line beats
 * any listener. It does not hold on iOS Safari: measured, the document still
 * scrolled to 445.
 *
 * ── THIS IS NOT WHAT #129 DID ────────────────────────────────────────────────
 *
 * #129 pinned `window.scrollY` every frame and lost a race with WebKit, which
 * re-asserts. Nothing here writes a scroll position or reads one. This refuses
 * a GESTURE — `preventDefault` on a touch move that nothing inside the panel
 * can use — which is the sanctioned way to say "this drag is not a page
 * scroll", and is what every scroll-locking drawer and modal on the web does.
 * WebKit's own reveal is programmatic, is not a touch, and still happens.
 *
 * ── AND ONLY WHILE THE KEYBOARD IS UP ────────────────────────────────────────
 *
 * With no keyboard there is nothing to be dragged away from, and the page
 * behind a `pointer-events-none` panel is supposed to stay scrollable — the
 * reader can see it through the glass, and it was always allowed to move.
 */

/**
 * Can anything between `from` and `root` actually absorb a scroll of `dy`?
 *
 * A TRANSCRIPT WITH MESSAGES IN IT MUST STILL SCROLL, which is the whole reason
 * this is a walk and not a flat refusal. `dy > 0` is a drag that asks for
 * content further down; the answer is yes only where a real scroller has room
 * left in that direction.
 *
 * The 1px slacks are for fractional `scrollTop` on a zoomed or scaled page,
 * where a container sitting exactly at its limit reports 0.5 and would
 * otherwise look scrollable forever.
 */
/** One candidate scroller, as the browser reports it. */
export type ScrollerProbe = {
  /** The computed `overflow-y`. */
  overflowY: string
  scrollTop: number
  scrollHeight: number
  clientHeight: number
}

/**
 * Could THIS element absorb a scroll of `dy`?
 *
 * A TRANSCRIPT WITH MESSAGES IN IT MUST STILL SCROLL, which is why this is a
 * question about room remaining and not a flat refusal. `dy > 0` is a drag
 * asking for content further down; the answer is yes only where a real scroller
 * has somewhere left to go in that direction.
 *
 * The 1px slacks are for fractional `scrollTop`, which a zoomed or scaled page
 * produces: a container sitting exactly at its limit reports 0.5 and would
 * otherwise look scrollable forever.
 */
export function absorbs(p: ScrollerProbe, dy: number): boolean {
  if (p.overflowY !== 'auto' && p.overflowY !== 'scroll') return false
  const max = p.scrollHeight - p.clientHeight
  if (max <= 1) return false
  if (dy > 0) return p.scrollTop < max - 1
  if (dy < 0) return p.scrollTop > 1
  return false
}

/**
 * Walk from the touch's target out to the panel, asking `absorbs` at each step.
 * Thin on purpose: the decision is above, where it can be pinned without a DOM.
 */
export function consumesScroll(from: Element | null, root: Element, dy: number): boolean {
  let el: Element | null = from
  while (el) {
    if (el instanceof HTMLElement) {
      const s = getComputedStyle(el)
      if (
        absorbs(
          {
            overflowY: s.overflowY,
            scrollTop: el.scrollTop,
            scrollHeight: el.scrollHeight,
            clientHeight: el.clientHeight,
          },
          dy,
        )
      ) {
        return true
      }
    }
    if (el === root) return false
    el = el.parentElement
  }
  return false
}

/**
 * Is the reader typing? The keyboard is only ever up because something in the
 * panel has focus, and asking the document that is cheaper and more honest than
 * inferring a keyboard from viewport arithmetic that iOS 26 gets wrong.
 */
export function composerFocused(panel: Element, doc: Document = document): boolean {
  const a = doc.activeElement
  if (!a || !panel.contains(a)) return false
  return a.tagName === 'TEXTAREA' || a.tagName === 'INPUT' || (a as HTMLElement).isContentEditable
}
