---
date: "2026-09-26"
title: "Scanner voice refuses crossed clauses and named Undo"
decided_by: "Chey (via Codex gpt-6-sol)"
areas: ["scanner"]
supersedes: []
---
## 2026-09-26 — Scanner voice refuses crossed clauses and named Undo
**Decided by:** Chey (via Codex gpt-6-sol)
**Decision:** Treat “then” and punctuation as clause breaks alongside “and” when a named card and a later reference could point to different captures. Refuse a named Undo because the current Undo command can only address the latest action.
**Why:** A named printing followed by “then that one” could apply the second printing to the named card; “undo the Charizard” could instead reverse Venonat's latest action. Both violate the scanner's one-command, one-target invariant.
**Implications:** The reader repeats either instruction as a separate command. The grammar tests cover these refusals and their recognizer alternatives; no schema or deployment change.

