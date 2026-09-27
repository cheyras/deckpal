---
date: "2026-09-27"
title: "Browser journeys run one at a time within each CI shard"
decided_by: "Claude, on Chey's standing instruction to keep the merge line moving"
areas: ["general"]
supersedes: []
---
## 2026-09-27 — Browser journeys run one at a time within each CI shard
**Decided by:** Claude, on Chey's standing instruction to keep the merge line moving

**Decision:** `scripts/test-browser.mjs` runs the suites of a shard one at a time (`pool(1)`) instead of four at once.
The eight CI shards still run in parallel with each other.

**Why:** Four Chromium journeys sharing one runner made timing-sensitive checks fail at random on PRs that never
touched them. Examples from 2026-09-27: `checkUpcoming`'s full-page screenshot ("Unable to capture screenshot"), the
queue list-failure message, and the chat "Text selection must not dismiss" check. Each random failure cost a manual
rerun of about 4 minutes and stalled the merge line. Measured cost of running serially: the slowest shard went from
3.7 to 4.7 minutes (#215's run against main at c0c8295), well inside the 15-minute shard timeout.

**Implications:** A browser check takes about a minute longer. Suites no longer compete for CPU, so a timing failure
now points at the suite itself. `scripts/browser-shards.mjs` duration estimates were already per-suite, so shard
balancing is unchanged. If the slowest shard approaches the timeout, add a shard rather than returning to parallel
suites.
