---
date: "2026-09-26"
title: "Scanner voice preserves symbol-bearing names and gates every commit"
decided_by: "Chey (via Codex gpt-6-sol)"
areas: ["scanner"]
supersedes: []
---
## 2026-09-26 — Scanner voice preserves symbol-bearing names and gates every commit
**Decided by:** Chey (via Codex gpt-6-sol)
**Decision:** Keep gender signs and other identity-bearing symbols distinct during speech normalization; require exact names when those symbols are present. Check persistent voice warnings at the scanner write gate for both Add and “Commit without them,” and clear old unresolved-row confirmation when scanning resumes.
**Why:** Nidoran♀ and Nidoran♂ previously collapsed into one target, and the retained confirmation could save a batch without acknowledging a failed spoken change.
**Implications:** A symbol-bearing name must be spoken in full or selected manually. Every scanner commit path waits for explicit warning acknowledgement. The target matrix and both commit-path tests protect the behavior; no schema or deployment change.

