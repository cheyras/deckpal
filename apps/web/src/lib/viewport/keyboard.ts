/**
 * IS A SOFTWARE KEYBOARD UP? A coarse yes/no, shared by the Deck-E chat panel
 * (`character/host/DeckeChat.tsx`, for its composer's bottom inset) and every
 * `Sheet` (`components/ui/sheetKeyboard.ts`, for whether to place itself).
 *
 * It lives here, beside `panelViewport.ts` and `panelScrollLock.ts`, so neither
 * of those two callers imports the other.
 */

/** What the yes/no needs, all in client pixels. No placement, so no origin. */
export type KeyboardSample = {
  /** `visualViewport.height`. */
  visualHeight: number
  /** `visualViewport.scale` — 1 unless the reader has pinch-zoomed. */
  scale: number
  /** The layout viewport's height (`documentElement.clientHeight`). */
  layoutHeight: number
}

/**
 * How much of the layout viewport has to be hidden before it counts as a
 * keyboard. Phone keyboards cover roughly 260–340px; a collapsing Safari
 * toolbar is well under this, and makes the visual viewport TALLER, not
 * shorter, so it never trips it.
 */
export const KEYBOARD_MIN_PX = 120

/**
 * Is a software keyboard covering the bottom of the screen?
 *
 * A COARSE SIGNAL ONLY, and callers only ask it while a text field has focus.
 * It decides whether to act, never where. A pinch-zoomed page shrinks the
 * visual viewport too, so a scale away from 1 answers no rather than mistake a
 * zoom for a keyboard.
 */
export function keyboardLikelyUp(s: KeyboardSample | null): boolean {
  if (!s) return false
  const { visualHeight, scale, layoutHeight } = s
  if (!Number.isFinite(visualHeight) || !Number.isFinite(layoutHeight)) return false
  if (!Number.isFinite(scale) || Math.abs(scale - 1) > 0.01) return false
  return layoutHeight - visualHeight >= KEYBOARD_MIN_PX
}
