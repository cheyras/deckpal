---
date: "2026-09-26"
title: "Browser boundaries run as verified parallel shards"
decided_by: "Chey (via Codex)"
areas: ["general"]
supersedes: []
---
## 2026-09-26 — Browser boundaries run as verified parallel shards
**Decided by:** Chey (via Codex)
**Decision:** Distribute discovered browser suites by stable names and measured durations across eight GitHub-hosted runners. The first four-shard run showed that cloud feedback alone took 386 seconds, so feedback checks became separate named suites by viewport and lifecycle. Later runs measured cloud admin at 231 seconds, then its controls at 168 seconds; journey, table viewports and access checks are now separate suites. A catalog screenshot failed once while sharing a runner with the heavy 428px cloud feedback suite, so that suite gets a runner to itself. Each shard builds only the app variants its suites exercise and uploads its own evidence. A final job retains the required `browser` check name and verifies all shards succeeded and all 176 current cases ran exactly once, including the offline-banner, write-recovery and error-boundary checks merged from main.
**Why:** The instrumented single-runner browser job on this PR took 12 minutes 39 seconds; cloud consumed 682.6 seconds, self-host 272.2 seconds, and chat 51.1 seconds while those suites overlapped. Parallel runners shorten the pull-request wait while the case inventory prevents the split from quietly dropping coverage.
**Implications:** New browser cases must update the checked-in case inventory, and suite-duration weights should be refreshed after material timing changes. A single requested shard still runs all suites. A failed or cancelled shard blocks `browser`; individual shard artifacts preserve debugging evidence. The admin table fixture holds its delayed search long enough to observe loading under runner load and waits past that response before asserting stale data stayed hidden.
