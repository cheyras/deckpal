---
date: "2026-08-22"
title: "A journey is one plan, executed in the browser"
decided_by: "owner's design, executed by Claude."
areas: ["general"]
supersedes: []
---
## 2026-08-22 — A journey is one plan, executed in the browser
**Decided by:** owner's design, executed by Claude.
**Decision:** a `journey` tool takes an ordered, capped step list of landmark
references; the browser runs it as a timeline. One leg, not one per hop.

**Why:** the selectors are constructible from ids the data tools return before
anything moves, so per-hop reasoning buys nothing. A four-leg escort re-bills
~17k prompt tokens; one journey leg is ~5.1k.

**Implications:**
- **Landmark references, never free CSS** — a free selector is a capability, and
  the allowlist exists to bound it. Validated at parse time, so a bad plan is
  refused whole before step 0.
- **No wait verb and no duration field**: a fixed delay after a click is wrong on
  a slow connection, and making it inexpressible beats a rule against it.
- **`ensure`**, because the determinism premise is false — on `/series` the
  uncollected series exist only after a one-shot disclosure, and for the QA
  account every series is uncollected.
- **A trusted-event guard is load-bearing**: the sequencer performs its own
  clicks, and without `isTrusted` the first would cancel the journey running it.
- A hidden control is still a clickable control: below the nav breakpoint the
  sidebar links are `display:none` but present, so a step that needs him to be
  SEEN refuses a target with no box.
- A journey that stops half way is `partial`, not `error`, and its summary is
  built from what ran rather than from what was planned.

