---
date: "2026-09-26"
title: "Insights values belong to the selected range"
decided_by: "Chey (via Claude)"
areas: ["general"]
supersedes: []
---
## 2026-09-26 — Insights values belong to the selected range

**Decided by:** Chey (via Claude)

**Decision:** The Insights page renders a value response only when its returned
range and currency match the selected controls. While another range is loading,
the chart, change figure, and movers show loading states.

**Why:** React Query retains the previous response during a range change. The
new range label could briefly appear above the old range's change figure.

**Implications:** A browser regression test holds the new range request open,
checks that the old figure disappears, then checks the new figure after the
response arrives at desktop and phone widths.

