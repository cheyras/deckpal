---
date: "2026-07-24"
title: "Port block 3700–3709, localhost-bound"
decided_by: "lead agent. 3700 API, 3701 image service, 3702 reserved,"
areas: ["general"]
supersedes: []
---
## 2026-07-24 — Port block 3700–3709, localhost-bound
**Decided by:** lead agent. 3700 API, 3701 image service, 3702 reserved,
3703 dev server. All bound to `127.0.0.1`, fronted by the existing nginx vhosts.
Verified free via `ss -tln`. (Note: the BRIEF's Part B port list is stale in both
directions — 3597/4700/5250/9091 are listed as taken but are not bound, while
3600 and 36793 are bound and unlisted.)

