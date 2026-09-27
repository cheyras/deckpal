---
date: "2026-08-21"
title: "`showScreen`: the palette gets a producer"
decided_by: "Claude, per the original brief (\"ad-hoc screens composed from a"
areas: ["frontend"]
supersedes: []
---
## 2026-08-21 — `showScreen`: the palette gets a producer
**Decided by:** Claude, per the original brief ("ad-hoc screens composed from a
fixed component library").
**Decision:** A `showScreen` server tool takes a `Screen`, sanitises it, and puts
it on a **transient** `data-decke-screen` part. The client attaches it to the
message being streamed and renders it full-width beneath the bubble.

**Why now:** the schema, the renderer and their tests all existed and nothing
produced one — the whole palette was dead code.

**Implications:**
- **Held on the MESSAGE, not as one "current screen".** Scrolling back to a haul
  from four questions ago should show that haul.
- **Transient**, like `express`: a screen echoed into history is re-read as
  context next turn and invites the model to rebuild it.
- **`showScreen` counts as acting in the stop condition.** Left out, a step that
  spoke AND drew a panel failed "spoke && moved", the loop opened another step,
  and he delivered a second closing line. Measured on the probe before the fix.
- **An empty bubble is not rendered**, so a panel-only turn does not open with a
  stray empty pill.

