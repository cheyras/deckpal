---
date: "2026-09-26"
title: "Keep failed-write feedback reachable over sheets"
decided_by: "Chey (via Claude)"
areas: ["general"]
supersedes: []
---
## 2026-09-26 — Keep failed-write feedback reachable over sheets

**Decided by:** Chey (via Claude)

**Decision:** Passive PWA notices (`--z-toast: 50`) remain below sheets. The
actionable save toast gets its own `--z-toast-action: 110` layer above sheets,
so Retry stays visible and usable when a save fails inside an open sheet. While
that toast is visible, PwaUi measures its height and lifts the passive notice
stack just enough to keep the two messages from overlapping.

**Why:** After PR #219 added save-failure feedback to the shared PWA host, the
existing z-index fix for the offline banner put the new Retry action behind an
open sheet too. Astra identified that regression during review.

**Implications:** The browser write suite now hit-tests Retry above an open
sheet and checks that an offline banner and an offline save toast do not
overlap. This keeps passive status notices behind sheets without hiding the
action a person needs to recover a failed save.

