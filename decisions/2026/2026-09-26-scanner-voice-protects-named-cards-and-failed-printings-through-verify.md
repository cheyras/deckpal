---
date: "2026-09-26"
title: "Scanner voice protects named cards and failed printings through Verify"
decided_by: "Chey (via Claude)"
areas: ["scanner","catalog"]
supersedes: []
---
## 2026-09-26 — Scanner voice protects named cards and failed printings through Verify
**Decided by:** Chey (via Claude)

**Decision:** Filler words match exactly, so a spoken card name inside a command cannot be consumed by a fuzzy filler phrase; it targets that named capture or the command is refused, even when the name is absent from the list. When a spoken printing change fails, or a command for an in-flight capture cannot settle, Verify keeps its warning visible and Add waits until the reader explicitly chooses to continue without the voice change. Pending changes settle synchronously when Verify is tapped, before the step changes.

**Why:** “Remove the Seel” could otherwise remove the latest capture. A failed printing change or a command whose capture was still identifying could lose its warning as the camera caption disappeared, allowing the default printing to be committed without notice.

**Implications:** A reader may need to repeat an ambiguous command or acknowledge a failed printing before adding the batch. The scanner tests cover both paths, and the focused browser test checks the Verify warning at desktop and phone widths. No schema, permission or deployment change.


