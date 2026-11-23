---
date: "2026-11-23"
title: "Sheets place themselves against the visible area while the iOS keyboard is up"
decided_by: "@cheyras (asked for the Deck-E keyboard fix on every input sheet), Claude"
areas: ["general"]
supersedes: []
---
## 2026-11-23 — Sheets place themselves against the visible area while the iOS keyboard is up
**Decided by:** @cheyras (asked for the Deck-E keyboard fix on every input sheet), Claude

**Decision:** `Sheet` reuses the two mechanisms the Deck-E chat panel shipped
on 2026-08-28, and drops the bottom safe-area inset under the keyboard:

1. While a text field in the sheet has focus and a software keyboard is
   covering the screen, the scrim is placed against the visible area
   (`panelBox` with no header to clear; `top` from the scrim's own client rect,
   `height` from `visualViewport.height`). The panel is also capped at 100% of
   the scrim, because `dvh` does not track the iOS keyboard.
2. While a text field in the sheet has focus, a one-finger drag nothing in the
   sheet can absorb is refused (`consumesScroll`), so a flick cannot drag the
   riding sheet off the keyboard.
3. While the keyboard is up, `env(safe-area-inset-bottom)` is replaced by 0 in
   the sheet's content and footer padding, and in the Deck-E composer's
   padding (WebKit 217754: the inset keeps reporting the home indicator the
   keyboard is covering, a ~34px dead gap).

`lockScroll` is unchanged and still shared.

**Why:** Every input sheet had the shape the Deck-E chat had before its fix:
a text field inside a `fixed` panel. iOS's reveal scroll carried the panel up
off the top of the screen, left it pannable, and padded it for a home
indicator under the keyboard. The owner asked for the same fix everywhere
(Todoist: "Audit the other input sheets for the iOS keyboard bug").

The page lock was deliberately left alone. Deck-E swapped it for an
`overflow: hidden` hold, but the shared lock backs every sheet in the app
(card detail, the billing sheet, the bug reporter's screenshot, which is taken
while the lock is held), and the placement above measures where the scrim actually
landed rather than assuming the lock held, so it does not depend on the lock.
If a device test still shows the yank, swapping the lock is the next single
change to try, not a bundle with this one.

**Implications:**

- Outside "a field is focused and a keyboard is up" nothing is written: every
  sheet on desktop, and every sheet on a phone with no field focused, keeps
  its authored CSS exactly.
- `keyboardLikelyUp` reads `visualViewport` only as a coarse yes/no (120px or
  more of the layout viewport hidden, scale 1). It never decides geometry.
- NOT VERIFIED ON A DEVICE YET. No headless browser has a software keyboard;
  the unit tests pin the arithmetic to the 2026-08-28 simulator samples. The
  owner checks the Vercel preview on his iPhone before merge.
