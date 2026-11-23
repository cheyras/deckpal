/**
 * A SHEET WITH A TEXT FIELD, AND THE iOS KEYBOARD.
 *
 * This is the Deck-E chat's keyboard fix (`character/host/panelViewport.ts` and
 * `panelScrollLock.ts`, decision 2026-08-28) applied to `Sheet`, which every
 * other text field in the app sits inside: the bug reporter, the list and
 * Add Cards modals, New Deck, Log a Battle, and the rest.
 *
 * ── WHAT GOES WRONG WITHOUT IT ──────────────────────────────────────────────
 *
 * iOS does not shrink the layout viewport for the software keyboard. It reveals
 * the focused field by scrolling the document — even under `overflow: hidden`,
 * which WebKit's own regression test asserts is deliberate — and lets every
 * `position: fixed` layer ride that scroll. A bottom sheet's scrim is one of
 * those layers, so the panel lands wherever the reveal happened to leave it:
 * yanked up until its header is off the top of the screen, pannable by any
 * drag, and padded underneath for a home indicator the keyboard is covering.
 *
 * ── WHAT THIS DOES INSTEAD ──────────────────────────────────────────────────
 *
 * The same three things Deck-E does, and none of them is a keyboard height:
 *
 * 1. While the keyboard is up, the scrim is placed against the VISIBLE AREA —
 *    `top` from where a `fixed; top: 0` box currently lands, `height` from
 *    `visualViewport.height` — so the bottom-anchored panel's floor is the top
 *    of the keyboard by construction, not by luck. `panelBox` is reused as-is,
 *    with no header to clear.
 * 2. While a text field in the sheet has focus, a one-finger drag that nothing
 *    inside the sheet can absorb is refused, so a flick cannot drag the page
 *    (and the riding sheet) off the keyboard. `consumesScroll` and
 *    `composerFocused` are reused as-is.
 * 3. While the keyboard is up, the bottom safe-area inset is dropped. WebKit
 *    keeps reporting `env(safe-area-inset-bottom)` with the keyboard covering
 *    the home indicator (WebKit 217754), which is a ~34px dead gap above it.
 *
 * Outside "keyboard up", NOTHING IS WRITTEN: a sheet with no field focused, on
 * any device, and every sheet on a desktop, keeps exactly its authored CSS.
 */

import { panelBox, type PanelBox } from '../../character/host/panelViewport'

/** What the placement needs, all in client pixels. */
export type SheetViewportSample = {
  /** Where a `fixed; top: 0` box's top edge lands right now. */
  fixedOrigin: number
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
 * A COARSE SIGNAL ONLY, and it is only ever asked while a text field in the
 * sheet has focus. It decides whether to place the sheet, never where — the
 * where comes from `panelBox`. A pinch-zoomed page shrinks the visual viewport
 * too, so a scale away from 1 answers no rather than mistake a zoom for a
 * keyboard.
 */
export function keyboardLikelyUp(s: SheetViewportSample | null): boolean {
  if (!s) return false
  const { visualHeight, scale, layoutHeight } = s
  if (!Number.isFinite(visualHeight) || !Number.isFinite(layoutHeight)) return false
  if (!Number.isFinite(scale) || Math.abs(scale - 1) > 0.01) return false
  return layoutHeight - visualHeight >= KEYBOARD_MIN_PX
}

/**
 * Where the scrim goes while the keyboard is up, or `null` for "keep the
 * authored `inset: 0`". The scrim is full-bleed, so there is no header to
 * clear; that makes it `panelBox` with a header of zero.
 */
export function sheetBox(s: SheetViewportSample | null): PanelBox | null {
  if (!keyboardLikelyUp(s)) return null
  return panelBox({ fixedOrigin: s!.fixedOrigin, visualHeight: s!.visualHeight, headerOffset: 0 })
}
