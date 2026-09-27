---
date: "2026-08-15"
title: "One Sheet primitive; `animation-fill-mode: both` is banned on transforms"
decided_by: "Claude, on the user's report that \"none of the modals are"
areas: ["general"]
supersedes: []
---
## 2026-08-15 — One Sheet primitive; `animation-fill-mode: both` is banned on transforms
**Decided by:** Claude, on the user's report that "none of the modals are
working right" on mobile.

**Decision:** Every overlay in the app renders through one primitive,
`components/ui/Sheet.tsx` — a bottom sheet below `nav:`, a centred dialog above
it. Callers pass content and an `onClose`; positioning, scroll-lock, focus,
Escape and both animations belong to the primitive, not to the caller.

**The three bugs this closes, all measured on a 375×667 viewport:**

1. **`fill-mode: both` retained a transform, which re-parented every modal.**
   `px-rise` (premium.css) animated `.app-content > *` and ended on
   `transform: none` — but an *animated* transform resolves to an interpolated
   matrix, and `both` retains the final keyframe forever, so every routed page
   permanently carried `transform: matrix(1,0,0,1,0,0)`. Any transform other
   than `none` makes an element the containing block for `position: fixed`
   descendants, so the "fixed" scrim was sized to a 20,329px page instead of the
   viewport and the card sheet opened at y≈18,579 — the user had to scroll
   thousands of pixels to find it. **Rule: never `both` on a keyframe that
   touches `transform`; use `backwards`.** The end state is the element's
   natural style, so nothing is worth retaining.

2. **`items-end` + `overflow-y: auto` on the scrim is not scrollable.** Flex
   overflow past the START edge is unreachable — `scrollHeight` equals
   `clientHeight`, so there is nothing to scroll to. The bug reporter's panel
   was 750px in a 667px viewport at `top: -83` (and `-430` with the keyboard
   open), putting its textarea permanently off-screen. The scrim no longer
   scrolls at all: the panel is capped at `92dvh` and its BODY scrolls.

3. **No scroll-lock on the shared Modal**, so the page drifted behind it.
   Locked via body-pinning (iOS ignores `overflow: hidden`), ref-counted for
   stacked sheets, exact scroll position restored on close.

**Also fixed, found on the way:** `.bg-surface-tertiary.rounded-full` set
`position: relative` at specificity (0,3,0), beating Tailwind's `.absolute`
(0,1,0) and silently forcing those elements back into flow — it was displacing
the card sheet's close button and the profile level badge. Now wrapped in
`:where()` so decorative defaults lose to layout utilities.

**Implications:**
- New overlays use `Sheet`. `Modal` in ListModals.tsx is a thin compat wrapper.
- Long-form sheets put actions in `footer`, which is pinned below the scroll
  area and survives a short screen or an open keyboard.
- `Sheet` portals to `document.body`, so a future transformed ancestor cannot
  reintroduce bug 1 even if the CSS regresses.

