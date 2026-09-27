---
date: "2026-07-24"
title: "Stack: match the box, not the brief"
decided_by: "user, at the Phase 1 checkpoint."
areas: ["general"]
supersedes: ["BRIEF Python 3.11 + FastAPI and docker-compose.arm64.yml deliverable"]
---
## 2026-07-24 — Stack: match the box, not the brief
**Decided by:** user, at the Phase 1 checkpoint.
**Decision:** Node/TS API + a process manager + an nginx location block, matching
the existing first-party services. The BRIEF's Python 3.11 + FastAPI and its named
`docker-compose.arm64.yml` deliverable are **superseded**; the deliverable becomes
a process-manager config fragment + nginx config.

**Why:** same operational shape and debugging path as everything else the user
runs; no container memory overhead on a box that recently OOM'd; and it dissolves
the BRIEF Part B constraint 7 (Python 3.13 vs 3.11) entirely. Docker remains in
use on this box only for third-party appliances.

