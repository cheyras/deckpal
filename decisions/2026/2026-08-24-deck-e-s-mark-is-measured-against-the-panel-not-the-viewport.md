---
date: "2026-08-24"
title: "Deck-E's mark is measured against the panel, not the viewport"
decided_by: "@cheyras (report), agent (root cause and fix)"
areas: ["agents","decks"]
supersedes: []
---
## 2026-08-24 — Deck-E's mark is measured against the panel, not the viewport

**Decided by:** @cheyras (report), agent (root cause and fix)

**Decision:** `composerTop` in `DeckeChat.tsx` — the number the mobile park box
is positioned from — is now measured as `panel.getBoundingClientRect().bottom -
composer.getBoundingClientRect().top` rather than `window.innerHeight -
composer.getBoundingClientRect().top`. Three other things follow from it:

1. A `panelRef` exists solely to be that reference. The park box is
   `position: absolute` inside the panel, so the panel is the coordinate space
   its `bottom` offset actually resolves in; the viewport was never the right
   reference, only a coincidentally equal one.
2. `reflow`'s layout effect gained `composerTop` as a dependency.
3. `.decke-composer`'s `padding-left: calc(16px + var(--decke-gutter, 0px))` is
   deleted. The transcript's gutter (`.decke-shift`, `.decke-bubble`,
   `.decke-figure`) is untouched.

**Why:** The 2026-08-24 pass that moved him ON to the composer's top edge
(`PARK_ABOVE`) was correct and was never the placement being used. The panel
enters under `sheet-panel-up`, whose `from` is `translateY(100%)` with a
`backwards` fill — so the from-state is already applied when the measuring
`useLayoutEffect` fires, and the composer was measured a full panel-height below
the screen. Measured at 375x812: `composerTop` latched to **-670** and the park
box got `bottom: -662px`.

Nothing ever corrected it. A `ResizeObserver` on the composer does not fire for
an ancestor's transform — the composer's own box never changes size — and
neither `scroll` nor `resize` fires when an entrance animation finishes. The
wrong number was latched for the life of the panel.

Both of the owner's reports were that one number:

- *"Deck-E is still too low."* `DeckeHost`'s `onScreen()` check rejected the
  off-screen box and fell back to `STAND_MOBILE`, which is the OLD low corner.
- *"The functionality where the messages and tool calls clear his right edge
  broke."* `reflow` reads the same box. A `limit` of ~2078 marks EVERY bubble
  clear, so the clearance silently stopped happening — measured before the fix:
  both `.decke-shift` rows `data-clear="true"`, `margin-left: 0px`.

The composer's gutter is a separate call and a consequence of the move: he
stands above the input now, so there is nothing beside it to clear, and the
reserved 108px was carving a hole out of the one control on screen. *"The input
text should be fully left justified rather than clearing a space for him to
fit."*

**Implications:**

- **The measurement is correct DURING the entrance, not merely after it.** Under
  a translate both rects move by the same amount and the difference is exact.
  That is what lets him fly to the right mark on the first frame instead of
  jumping when the panel lands, and it is why the fix is the panel rect rather
  than a re-measure on `animationend`.
- **The `ResizeObserver` now watches the panel as well as the composer**, since
  the panel is a term in the subtraction and its height moves on its own — a
  phone keyboard shortens the visual viewport without firing `resize` everywhere.
- **`reflow` needed `composerTop` independently of this bug.** A textarea growing
  to a third line moves the park box, and therefore the line a bubble has to be
  above, through a `ResizeObserver` that is not a React render. Every
  `data-clear` decision taken against the old position was stale. That latent
  bug is fixed here too.
- **Verified in the browser at 375x812, not reasoned about.** After the fix the
  park box sits at `bottom: 86px` (78 + `PARK_ABOVE`), and his settled drawn
  silhouette — read off the WebGL colour buffer across the idle bob — spans
  y 593→723-726 against a park floor of 726 and a composer top of 734, x 14.5→116
  against a box of 10→112. Feet on the composer's top edge with daylight under
  them, nothing clipped at the screen edge. The transcript rows behave again:
  the row above his head `data-clear="true"` at `margin-left: 0`, the row beside
  him indented to `margin-left: 108px` (x=124, clear of his right edge at 112 by
  `PARK_GAP`).
- **A frozen animation clock will lie to you here.** Both the panel entrance and
  the `margin-left` transition sit at `currentTime: 0` in a throttled headless
  pane, and a mid-flight character reads as clipped and standing in the composer.
  Step the loop by hand (`__decke.update(1/60)` in a loop) and let it SETTLE
  before believing a frame — the first reading taken this way was 24px out.

---

