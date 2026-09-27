---
date: "2026-08-20"
title: "The issue sweep for #46–#57, and what \"already fixed\" turned out to mean"
decided_by: "Claude Opus 5 on behalf of @cheyras."
areas: ["general"]
supersedes: []
---
## 2026-08-20 — The issue sweep for #46–#57, and what "already fixed" turned out to mean
**Decided by:** Claude Opus 5 on behalf of @cheyras.

**Decision:** Work the ten open in-app reports as one sweep, but verify each one
against the RUNNING product before writing any code — production first, the
local stack second — rather than trusting the report, the code, or a previous
commit's claim to have fixed it.

**Why:** Four of the ten (#46, #47, #49, #53) were already fixed and nobody had
noticed. #46 and #47 were the recovered `design-system` stash that landed as
6baf4cc, filed the day before that commit; #53 was collateral damage from
premium.css being unlayered (#44) and was healed by the layering fix in 148cc77.
Reading those four as open work would have meant re-fixing code that was already
correct — and reading the *commit message* as proof would have been the same
mistake in the other direction. Both were settled by loading the pages.

**Implications:**
- Verified live on deckpal.app: the back control renders as the recessed
  left-pointing plate (#46); series rows bleed the logo panel to the card's
  top/left/bottom edges (#47); the LVL badge sits inside the sprite tile (#53).
  Closed as fixed, with the commit that fixed each.
- #49 ("a lot of animation I'm not seeing") is the one with no defect behind it.
  Diffing the design-system base (fcbef90) against HEAD shows nothing
  motion-related was lost: every removal is a documented replacement —
  `px-rise` `both`→`backwards` (the containing-block trap), `px-modal-in` folded
  into the Sheet primitive in theme.css, and `background-attachment: fixed`
  swapped for a fixed-position overlay *precisely because iOS Safari ignores the
  former*. Driven in a browser, `px-rise`, `px-draw`, `px-ping`,
  `sheet-scrim-in`, `sheet-panel-up` and the nav-row transitions all run, on
  cold load and on client-side navigation alike. The remaining explanation is
  the reporter's own `prefers-reduced-motion`, which the skin deliberately
  honours by collapsing every duration to 1ms. Left open pending the owner
  checking iOS Reduce Motion — an agent must not close a report by asserting a
  device setting it cannot see.
- The QA account's collection is empty, which HIDES the surfaces several of
  these issues live on (no LVL badge, no collected series, no series links). The
  fix was to stage the read with a Playwright route interception rather than
  write capture data to the live backend — the component under test stays the
  real one, only its data is staged.

