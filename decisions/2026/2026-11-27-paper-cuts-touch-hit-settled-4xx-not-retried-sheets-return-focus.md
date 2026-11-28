---
date: "2026-11-27"
title: "Paper cuts: touch-hit, settled 4xx not retried, sheets return focus"
decided_by: "Chey (via Claude Opus 5.5)"
areas: ["frontend"]
supersedes: []
---
## 2026-11-27 — Paper cuts: touch-hit, settled 4xx not retried, sheets return focus
**Decided by:** Chey (via Claude Opus 5.5)

**Decision:** The account and app-chrome paper-cut loop (the owner's "keep looping… fix little paper cuts" instruction) settles four app-wide behaviours. Everything else it changed is local to one page.

- **`touch-hit` utility** (theme.css, `@utility`). On a coarse pointer it centres an invisible box of at least `--spacing-hit` (44px) on a control drawn smaller, so dense rows keep their look and still take a thumb. It sets `position: relative` and uses `::after`, so it must not go on a control that paints its own `::after`: premium.css draws the sheen of `.btn-fill-*`, `.bg-action-*` and `.bg-surface-tertiary.rounded-full` there, and those rules are unlayered, so they win. The back plate gets the same 44px box through its own `.back-plate::after`. KebabMenu rows use `pointer-coarse:min-h-hit`.
- **A settled 4xx is not retried.** The QueryClient's `retry` is now `failures < 1 && !isSettledAnswer(error)`. A settled answer is an `ApiError` 400–499, except 408 and 429. The retry held a missing list or deck on a blank page for an extra second or more before the page could say "not found". 5xx and network failures still get their single retry.
- **Sheets return focus to their opener.** `Sheet` reads `document.activeElement` during its first render, before a child's `autoFocus` (which React applies at commit, before effects) can move focus inside. On close it returns focus only once the panel has left the document, so StrictMode's rehearsal unmount does not take focus off the autofocused field, and only to a node that is still connected. KebabMenu moves focus back to the ⋮ before running an item, because the item unmounts with the menu. Deck-E's chat no longer treats `<body>` as a return target, and it looks for the remounted launcher for up to about 90 frames, not one.
- **Small overlays enter on the motion tokens.** New `popover-in` (KebabMenu: `fast`, `ease-enter`, 4px drop and 0.97 scale from the trigger's corner) and `toast-in` (save/undo toast, PWA update toast, offline banner: `base`, `ease-enter`, 8px rise). Under reduced motion both only fade.

**Why:** Each of these was a paper cut the owner asked to have removed, and each recurred in more than one place. Measured at 390/428 touch: deck-row steppers were 26px, the back plate 28px, menu rows 36px, and the Deck-E chips 34px. Five sheets (New Deck, Import, both Add Cards pickers, and anything opened from a ⋮ menu) dropped focus on `<body>` when they closed.

**Implications:**
- Use `touch-hit` rather than enlarging a control's drawing when a row is dense. Leave about 12px between neighbours so the 44px boxes barely meet.
- A query that wants a 4xx retried (none does today) must set its own `retry`.
- Deck-E's launcher stays bright and tappable above the open phone drawer on purpose. Tapping it closes the drawer and opens the chat (the `a11y-drawer-to-chat` case in tests/browser/a11y.mjs). It is not a paper cut to dim it.
- Not verified on a physical iPhone. Touch was emulated in Chromium (`hasTouch`, `isMobile`, `pointer: coarse`).
