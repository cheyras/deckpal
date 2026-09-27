---
date: "2026-08-22"
title: "The chat is the content pane, and the scrim fix is geometric"
decided_by: "owner (chrome stays sharp, content dims), executed by Claude."
areas: ["agents"]
supersedes: []
---
## 2026-08-22 — The chat is the content pane, and the scrim fix is geometric
**Decided by:** owner (chrome stays sharp, content dims), executed by Claude.
**Decision:** the panel occupies the content pane between the sidebar and the
right edge, below the header; both stay sharp and usable. On a phone the scrim
starts below the app header **by offset, not by z-index**.

**Why:** `backdrop-filter` samples whatever composites behind it regardless of
paint order, so dropping the scrim below the header would still blur what is under
it. The blurred element must not extend under the header at all.

**Implications:**
- `AppShell` publishes `--app-header-h` and `--app-sidebar-w`: the only thing that
  knows the sidebar's current width is the component that collapses it.
- The panel is glass and pointer-transparent on both platforms; the composer is
  the opaque thing. The phone panel's "dead grey band" was never a rendered
  element — it was the reader looking through to the scrim.
- `--color-surface-raised` is stone-500 and wrong for a card of composer width.
- The premium skin's "inputs are wells" rule is qualified for this one control by
  counted specificity, not by `!important`.

