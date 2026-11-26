/**
 * A SHEET WITH A TEXT FIELD, AND THE iOS KEYBOARD.
 *
 * This is the Deck-E chat's keyboard fix (`lib/viewport/panelViewport.ts` and
 * `lib/viewport/panelScrollLock.ts`, decision 2026-08-28) applied to `Sheet`,
 * which every other text field in the app sits inside: the bug reporter, the
 * list and Add Cards modals, New Deck, Log a Battle, and the rest.
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
 * 2. While that placement is applied, a mostly-vertical one-finger drag that
 *    nothing inside the sheet can absorb is refused, so a flick cannot drag the
 *    page (and the riding sheet) off the keyboard. `consumesScroll` is reused
 *    as-is; "a field is focused" counts text-entry fields only
 *    (`textEntryFocused`), never a radio, checkbox or slider.
 * 3. While the keyboard is up, the bottom safe-area inset is dropped. WebKit
 *    keeps reporting `env(safe-area-inset-bottom)` with the keyboard covering
 *    the home indicator (WebKit 217754), which is a ~34px dead gap above it.
 *
 * Outside "keyboard up", NOTHING IS WRITTEN: a sheet with no field focused, on
 * any device, every sheet on a desktop, and a sheet on a phone in landscape
 * (see `SHEET_MIN_VISIBLE_PX`), keeps exactly its authored CSS.
 */

import { panelBox, type PanelBox } from '../../lib/viewport/panelViewport'
import { keyboardLikelyUp, type KeyboardSample } from '../../lib/viewport/keyboard'

/** What the placement needs, all in client pixels. */
export type SheetViewportSample = KeyboardSample & {
  /** Where a `fixed; top: 0` box's top edge lands right now. */
  fixedOrigin: number
}

/**
 * The least visible height worth placing a sheet into. Below it — a phone in
 * landscape with the keyboard up leaves roughly 130–170px — a scrim shrunk to
 * the visible area squeezes the panel's header, body and footer until the
 * focused field itself has no room and disappears. There it is better to write
 * nothing: the authored CSS stands and iOS's own reveal scroll keeps the field
 * on screen, which is how every sheet behaved before this file. Portrait phones
 * with the keyboard up measure 377–410px, well clear of it.
 */
export const SHEET_MIN_VISIBLE_PX = 240

/**
 * Where the scrim goes while the keyboard is up, or `null` for "keep the
 * authored `inset: 0`". The scrim is full-bleed, so there is no header to
 * clear; that makes it `panelBox` with a header of zero.
 */
export function sheetBox(s: SheetViewportSample | null): PanelBox | null {
  if (!s || !keyboardLikelyUp(s)) return null
  // Written as a negated `>=` so a NaN also lands on "write nothing".
  if (!(s.visualHeight >= SHEET_MIN_VISIBLE_PX)) return null
  return panelBox({ fixedOrigin: s.fixedOrigin, visualHeight: s.visualHeight, headerOffset: 0 })
}
