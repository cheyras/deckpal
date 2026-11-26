/**
 * THE PANEL COVERS THE VISIBLE AREA. That is the whole idea, and it replaces
 * three attempts to nudge `bottom` by a keyboard-shaped number.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * WHAT IS ACTUALLY WRONG, MEASURED ON A DEVICE RATHER THAN REASONED ABOUT
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * iOS does not shrink the layout viewport for the software keyboard. It reveals
 * the focused input by SCROLLING THE DOCUMENT, and while the visual viewport is
 * offset, WebKit lets `position: fixed` layers ride that scroll — so the panel
 * lands on the keyboard by accident rather than by rule. Measured on iOS 26.5,
 * iPhone 17 Pro, with the instrument in `KbDiag.tsx`:
 *
 *   at rest            sy   1   vv.height 714   panel bottom 714   ✓
 *   composer focused   sy 338   vv.height 377   panel bottom 377   ✓ by luck
 *   then scrolled      sy 436   vv.height 377   panel bottom 279   ✗ 98px high
 *
 * The third line is the bug the owner reported as odd scrolling: the keyboard
 * has not moved, but one flick drags the composer 98px up the screen and leaves
 * a dead gap under it. Nothing about a keyboard's HEIGHT can see that — the
 * keyboard's height never changed. What changed is where a `fixed` box landed.
 *
 * The same run, scrolled the other way, unwinds iOS's reveal to `sy 0` with the
 * keyboard still up: the panel drops back to the layout viewport's floor, which
 * is now behind the keyboard, and the greeting spills up over the app header.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * SO STOP DESCRIBING THE KEYBOARD AND DESCRIBE THE VISIBLE AREA
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Two numbers put the panel where it belongs in every one of those states, and
 * neither of them is a keyboard:
 *
 *   fixedOrigin   where a `fixed; top: 0` box's top edge currently lands, in
 *                 client pixels. 0 when nothing is riding anything; negative by
 *                 exactly the scroll while WebKit is carrying fixed layers.
 *   visualHeight  `visualViewport.height` — the bottom of what can be seen, in
 *                 those same client pixels.
 *
 * Both come off ONE element: the app header, which is `position: fixed; top: 0`
 * and whose own height is the inset the panel already wanted to clear. Its
 * `top` IS the origin, by definition, on any engine — no version sniffing, no
 * `interactive-widget` (still unimplemented in Safari, WebKit #259770), no
 * `navigator.virtualKeyboard` (Chromium only), and no interpretation of what
 * the platform is doing with its keyboard.
 *
 * A NOTE ON WHAT WAS TRIED. #129 pinned `window.scrollY` and fought WebKit for
 * it every frame; that shipped and was reverted. Its replacement computed
 * `innerHeight - visualHeight - offsetTop`, which is the formula the web
 * repeats to each other — but `window.innerHeight` on iOS tracks the VISUAL
 * viewport, not the layout one, so on the device that expression reads -268 in
 * the state it was written to leave alone, and only a sanity clamp stopped it
 * moving anything. It never fired in the case it was for. Both attempts were
 * merged on green tests that faked `visualViewport`, which is why this file's
 * tests use samples copied off a real screen.
 */

/** Everything the placement needs, all in client pixels. */
export type PanelViewportSample = {
  /** Where a `fixed; top: 0` element's top edge lands right now. */
  fixedOrigin: number
  /** `visualViewport.height` — the height of what the reader can see. */
  visualHeight: number
  /** The app header's height, safe-area inset included. */
  headerOffset: number
}

/** The `top` and `height` to write on the panel, in CSS pixels. */
export type PanelBox = { top: number; height: number }

/**
 * Where the panel goes, or `null` when there is nothing believable to say and
 * the panel should keep the CSS it was authored with.
 *
 * THE HEADER IS CLEARED ONLY WHILE IT IS THERE. `Math.max(0, …)` is the whole
 * of that rule: at rest the header is at client 0 and the panel starts below
 * it, exactly as before this file existed; once WebKit has carried the header
 * off the top of the screen its bottom edge is negative, and a panel that still
 * reserved room for it would leave a band of nothing above the conversation.
 */
export function panelBox(s: PanelViewportSample | null): PanelBox | null {
  if (!s) return null
  const { fixedOrigin, visualHeight, headerOffset } = s
  if (!Number.isFinite(fixedOrigin)) return null
  if (!Number.isFinite(visualHeight) || visualHeight <= 0) return null
  if (!Number.isFinite(headerOffset) || headerOffset < 0) return null
  const topClient = Math.max(0, fixedOrigin + headerOffset)
  // A panel with no room left is not a panel to write a negative height onto.
  if (topClient >= visualHeight) return null
  return { top: Math.round(topClient - fixedOrigin), height: Math.round(visualHeight - topClient) }
}

/** The landmark both numbers are read from. See the header in `AppShell`. */
export const APP_HEADER_LANDMARK = 'data-app-header'

/**
 * Read the live viewport, or `null` where either half is missing — no
 * `visualViewport` (every browser this ships to has it, but a jsdom does not),
 * or a route with no app header, which is a route with no chat panel either.
 */
export function readPanelViewport(win: Window = window): PanelViewportSample | null {
  const vv = win.visualViewport
  if (!vv) return null
  const header = win.document.querySelector(`[${APP_HEADER_LANDMARK}]`)
  if (!header) return null
  const r = header.getBoundingClientRect()
  if (r.height <= 0) return null
  return { fixedOrigin: r.top, visualHeight: vv.height, headerOffset: r.height }
}
